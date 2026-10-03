import { z } from 'zod'
import { PatientSetupProjectionSchema, type PatientSetupProjection } from './patient-setup.ts'
import type { PatientScenarioProfile } from './patient-profile.ts'
import {
  SessionStateSchema,
  SessionTurnSchema,
  TerminalEventSchema,
  type EncounterPhase,
  type SessionState,
  type SessionTurn,
  type TerminalEvent
} from './session-contracts.ts'
import { PatientScenarioProfileSchema } from './patient-profile.ts'

export interface RedisJsonClient {
  readonly isOpen: boolean
  connect(): Promise<unknown>
  sendCommand(command: string[]): Promise<unknown>
}

export type ReadyPatientState = {
  sessionId: string
  patientProfileId: string
  openedAt: string
  profile: PatientScenarioProfile
  setupProjection: PatientSetupProjection
  conversationId: string
  profileDigest: string
  schemaVersion: number
}

export type LivePatientState = ReadyPatientState & {
  state: SessionState
  acceptedTurns: SessionTurn[]
  terminalEvent: TerminalEvent | null
}

export type TurnCommitResult =
  | { status: 'accepted' | 'duplicate'; turnId: string; sequence: number; patientResponse: string }
  | { status: 'conflict' | 'missing_state' | 'terminal' | 'not_ready' }

export interface PatientStateStore {
  initialize(sessionId: string, patientProfileId: string): Promise<void>
  saveReady(state: ReadyPatientState): Promise<void>
  read(sessionId: string): Promise<LivePatientState | null>
  acquireTurnLock(sessionId: string, ownerToken: string): Promise<boolean>
  releaseTurnLock(sessionId: string, ownerToken: string): Promise<void>
  acceptTurn(turn: SessionTurn, phase?: EncounterPhase): Promise<TurnCommitResult>
  recordTerminal(event: TerminalEvent): Promise<'accepted' | 'duplicate' | 'conflict' | 'missing_state'>
  restore(state: LivePatientState): Promise<'restored' | 'already_current' | 'newer_live_state' | 'expired'>
}

type SessionBinding = {
  sessionId: string
  patientProfileId: string
  status: 'initializing' | 'ready' | 'active' | 'completed' | 'cancelled'
  state: SessionState | null
}

const LivePatientStateSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  patientProfileId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  openedAt: z.iso.datetime({ offset: true }),
  profile: PatientScenarioProfileSchema,
  setupProjection: PatientSetupProjectionSchema,
  conversationId: z.string().min(1),
  profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
  schemaVersion: z.number().int().positive(),
  state: SessionStateSchema,
  acceptedTurns: z.array(SessionTurnSchema),
  terminalEvent: TerminalEventSchema.nullable()
}).strict()

const COMMIT_TURN_SCRIPT = `
local prior = redis.call('HGET', KEYS[3], ARGV[7])
if prior then return {'duplicate', prior} end
local sessionJson = redis.call('JSON.GET', KEYS[1])
local patientJson = redis.call('JSON.GET', KEYS[2])
if not sessionJson or not patientJson then return {'missing_state'} end
local session = cjson.decode(sessionJson)
local patient = cjson.decode(patientJson)
if session.sessionId ~= ARGV[2] or patient.sessionId ~= ARGV[2] or
   session.patientProfileId ~= ARGV[3] or patient.patientProfileId ~= ARGV[3] then
  return {'missing_state'}
end
if not session.state or tonumber(session.state.currentTurnSequence) ~= tonumber(ARGV[1]) then
  return {'conflict'}
end
if session.state.status == 'completed' or session.state.status == 'cancelled' then
  return {'terminal'}
end
if session.state.phase ~= 'history' or session.state.interactionMode ~= 'transcript' then
  return {'not_ready'}
end
local event = cjson.decode(ARGV[4])
if event.payload.phase ~= session.state.phase then
  return {'not_ready'}
end
redis.call('JSON.SET', KEYS[1], '$', ARGV[5])
redis.call('JSON.SET', KEYS[2], '$', ARGV[6])
redis.call('HSET', KEYS[3], ARGV[7], ARGV[8])
redis.call('XADD', KEYS[4], '*', 'event', ARGV[4])
return {'accepted', ARGV[8]}
`

const RELEASE_TURN_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

const COMMIT_TERMINAL_SCRIPT = `
local prior = redis.call('HGET', KEYS[3], ARGV[6])
if prior then return {'duplicate'} end
local sessionJson = redis.call('JSON.GET', KEYS[1])
local patientJson = redis.call('JSON.GET', KEYS[2])
if not sessionJson or not patientJson then return {'missing_state'} end
local session = cjson.decode(sessionJson)
local patient = cjson.decode(patientJson)
if session.sessionId ~= ARGV[2] or patient.sessionId ~= ARGV[2] or
   session.patientProfileId ~= ARGV[3] or patient.patientProfileId ~= ARGV[3] then
  return {'missing_state'}
end
if not session.state or tonumber(session.state.currentTurnSequence) ~= tonumber(ARGV[1]) then
  return {'conflict'}
end
if session.state.status == 'completed' or session.state.status == 'cancelled' then
  if session.state.terminalEventId == ARGV[7] then return {'duplicate'} end
  return {'terminal'}
end
redis.call('JSON.SET', KEYS[1], '$', ARGV[4])
redis.call('JSON.SET', KEYS[2], '$', ARGV[5])
redis.call('HSET', KEYS[3], ARGV[6], ARGV[7])
redis.call('XADD', KEYS[4], '*', 'event', ARGV[8])
redis.call('EXPIREAT', KEYS[1], ARGV[9])
redis.call('EXPIREAT', KEYS[2], ARGV[9])
redis.call('EXPIREAT', KEYS[3], ARGV[9])
return {'accepted'}
`

const SAVE_READY_SCRIPT = `
local sessionJson = redis.call('JSON.GET', KEYS[1])
local patientJson = redis.call('JSON.GET', KEYS[2])
if sessionJson then
  local session = cjson.decode(sessionJson)
  if session.sessionId ~= ARGV[1] or session.patientProfileId ~= ARGV[2] then
    return redis.error_reply('Redis session binding mismatch')
  end
end
if patientJson then
  local patient = cjson.decode(patientJson)
  if patient.sessionId ~= ARGV[1] or patient.patientProfileId ~= ARGV[2] then
    return redis.error_reply('Redis patient binding mismatch')
  end
end
redis.call('JSON.SET', KEYS[1], '$', ARGV[3])
redis.call('JSON.SET', KEYS[2], '$', ARGV[4])
return 'OK'
`

const RESTORE_SCRIPT = `
local sessionJson = redis.call('JSON.GET', KEYS[1])
local patientJson = redis.call('JSON.GET', KEYS[2])
if sessionJson then
  local session = cjson.decode(sessionJson)
  if session.state and tonumber(session.state.currentTurnSequence) > tonumber(ARGV[1]) then
    return 'newer_live_state'
  end
  if session.state and session.state.terminalEventId and session.state.terminalEventId ~= cjson.decode(ARGV[5]).eventId then
    return 'newer_live_state'
  end
end
if patientJson then
  local patient = cjson.decode(patientJson)
  if patient.state and tonumber(patient.state.currentTurnSequence) > tonumber(ARGV[1]) then
    return 'newer_live_state'
  end
  if patient.state and patient.state.terminalEventId and patient.state.terminalEventId ~= cjson.decode(ARGV[5]).eventId then
    return 'newer_live_state'
  end
end
redis.call('JSON.SET', KEYS[1], '$', ARGV[2])
redis.call('JSON.SET', KEYS[2], '$', ARGV[3])
redis.call('DEL', KEYS[3])
local turns = cjson.decode(ARGV[4])
for _, turn in ipairs(turns) do
  redis.call('HSET', KEYS[3], 't:' .. turn.turnId,
    cjson.encode({turnId=turn.turnId, sequence=turn.sequence, patientResponse=turn.patientResponse}))
end
local terminal = cjson.decode(ARGV[5])
if terminal.eventId then redis.call('HSET', KEYS[3], 'e:' .. terminal.eventId, terminal.eventId) end
if tonumber(ARGV[6]) > 0 then
  redis.call('EXPIREAT', KEYS[1], ARGV[6])
  redis.call('EXPIREAT', KEYS[2], ARGV[6])
  redis.call('EXPIREAT', KEYS[3], ARGV[6])
end
return 'restored'
`

export function createRedisPatientStateStore(client: RedisJsonClient): PatientStateStore {
  async function ensureConnected(): Promise<void> {
    if (!client.isOpen) await client.connect()
  }

  const sessionKey = (sessionId: string) => `gptmd:session:${sessionId}`
  const patientKey = (patientProfileId: string) => `gptmd:patient:${patientProfileId}`
  const retryKey = (sessionId: string) => `gptmd:retries:${sessionId}`
  const turnLockKey = (sessionId: string) => `gptmd:turn-lock:${sessionId}`
  const streamKey = 'gptmd:session-events'

  async function getJson(key: string): Promise<unknown | null> {
    const result = await client.sendCommand(['JSON.GET', key])
    if (typeof result !== 'string') return null
    return JSON.parse(result) as unknown
  }

  return {
    async initialize(sessionId, patientProfileId) {
      await ensureConnected()
      const binding: SessionBinding = { sessionId, patientProfileId, status: 'initializing', state: null }
      const patient = {
        ...binding, openedAt: null, profile: null, setupProjection: null, conversationId: null,
        profileDigest: null, schemaVersion: null, acceptedTurns: [], terminalEvent: null
      }
      for (const [key, value] of [[sessionKey(sessionId), binding], [patientKey(patientProfileId), patient]] as const) {
        const result = await client.sendCommand(['JSON.SET', key, '$', JSON.stringify(value), 'NX'])
        if (result === 'OK') continue
        const existing = await getJson(key)
        if (!isRecord(existing) || existing.sessionId !== sessionId || existing.patientProfileId !== patientProfileId) {
          throw new Error('Redis patient state is already bound to another session or profile.')
        }
      }
    },

    async saveReady(input) {
      await ensureConnected()
      const state: SessionState = {
        sessionId: input.sessionId,
        scenarioId: input.patientProfileId,
        status: 'ready',
        phase: 'history',
        interactionMode: 'transcript',
        openedAt: input.openedAt,
        updatedAt: input.openedAt,
        currentTurnSequence: 0,
        terminalEventId: null
      }
      const binding: SessionBinding = {
        sessionId: input.sessionId, patientProfileId: input.patientProfileId, status: 'ready', state
      }
      const patient: LivePatientState = {
        ...input, state, acceptedTurns: [], terminalEvent: null
      }
      const result = await client.sendCommand([
        'EVAL', SAVE_READY_SCRIPT, '2', sessionKey(input.sessionId), patientKey(input.patientProfileId),
        input.sessionId, input.patientProfileId, JSON.stringify(binding), JSON.stringify(patient)
      ])
      if (result !== 'OK') throw new Error('Redis could not commit the ready patient state')
    },

    async read(sessionId) {
      await ensureConnected()
      const raw = await getJson(sessionKey(sessionId))
      if (!isRecord(raw) || typeof raw.patientProfileId !== 'string') return null
      const patient = await getJson(patientKey(raw.patientProfileId))
      const parsed = LivePatientStateSchema.safeParse(patient)
      if (!parsed.success || parsed.data.sessionId !== sessionId) return null
      return parsed.data
    },

    async acquireTurnLock(sessionId, ownerToken) {
      await ensureConnected()
      const result = await client.sendCommand([
        'SET', turnLockKey(sessionId), ownerToken, 'NX', 'PX', '120000'
      ])
      return result === 'OK'
    },

    async releaseTurnLock(sessionId, ownerToken) {
      await ensureConnected()
      await client.sendCommand([
        'EVAL', RELEASE_TURN_LOCK_SCRIPT, '1', turnLockKey(sessionId), ownerToken
      ])
    },

    async acceptTurn(input, phase = 'history') {
      await ensureConnected()
      const turn = SessionTurnSchema.parse(input)
      const current = await this.read(turn.sessionId)
      if (!current) return { status: 'missing_state' }
      const priorTurn = current.acceptedTurns.find((candidate) => candidate.turnId === turn.turnId)
      if (priorTurn) {
        return {
          status: 'duplicate', turnId: priorTurn.turnId, sequence: priorTurn.sequence,
          patientResponse: priorTurn.patientResponse
        }
      }
      if (turn.sequence !== current.state.currentTurnSequence + 1) return { status: 'conflict' }
      if (current.state.status === 'completed' || current.state.status === 'cancelled') return { status: 'terminal' }
      if (current.state.phase !== 'history' || current.state.interactionMode !== 'transcript') return { status: 'not_ready' }
      if (turn.phase !== current.state.phase) return { status: 'not_ready' }
      const nextState = SessionStateSchema.parse({
        ...current.state, status: 'active', phase, updatedAt: turn.acceptedAt,
        currentTurnSequence: turn.sequence
      })
      const next: LivePatientState = {
        ...current, state: nextState, acceptedTurns: [...current.acceptedTurns, turn]
      }
      const binding: SessionBinding = {
        sessionId: current.sessionId, patientProfileId: current.patientProfileId,
        status: 'active', state: nextState
      }
      const event = {
        eventId: turn.turnId, sessionId: turn.sessionId, sequence: turn.sequence,
        eventType: 'accepted_turn', occurredAt: turn.acceptedAt, payload: turn
      }
      const reply = { turnId: turn.turnId, sequence: turn.sequence, patientResponse: turn.patientResponse }
      const result = asStringArray(await client.sendCommand([
        'EVAL', COMMIT_TURN_SCRIPT, '4', sessionKey(turn.sessionId), patientKey(current.patientProfileId),
        retryKey(turn.sessionId), streamKey,
        String(current.state.currentTurnSequence), turn.sessionId, current.patientProfileId,
        JSON.stringify(event), JSON.stringify(binding), JSON.stringify(next), `t:${turn.turnId}`,
        JSON.stringify(reply)
      ]))
      if (result[0] === 'accepted' || result[0] === 'duplicate') {
        const saved = result[1] ? JSON.parse(result[1]) as typeof reply : reply
        return { status: result[0], ...saved }
      }
      if (result[0] === 'terminal') return { status: 'terminal' }
      if (result[0] === 'not_ready') return { status: 'not_ready' }
      if (result[0] === 'missing_state') return { status: 'missing_state' }
      return { status: 'conflict' }
    },

    async recordTerminal(input) {
      await ensureConnected()
      const event = TerminalEventSchema.parse(input)
      const current = await this.read(event.sessionId)
      if (!current) return 'missing_state'
      if (current.state.terminalEventId === event.eventId) return 'duplicate'
      if (event.finalTurnSequence !== current.state.currentTurnSequence) return 'conflict'
      if (current.state.status === 'completed' || current.state.status === 'cancelled') return 'conflict'
      const status = event.outcome
      const sequence = current.state.currentTurnSequence + 1
      const nextState = SessionStateSchema.parse({
        ...current.state, status, phase: 'debrief', updatedAt: event.occurredAt,
        terminalEventId: event.eventId
      })
      const next: LivePatientState = { ...current, state: nextState, terminalEvent: event }
      const binding: SessionBinding = {
        sessionId: current.sessionId, patientProfileId: current.patientProfileId, status, state: nextState
      }
      const streamEvent = {
        eventId: event.eventId, sessionId: event.sessionId, sequence,
        eventType: 'terminal', occurredAt: event.occurredAt, payload: event
      }
      const expiresAt = Math.floor(Date.parse(event.occurredAt) / 1000) + 20 * 60
      const result = asStringArray(await client.sendCommand([
        'EVAL', COMMIT_TERMINAL_SCRIPT, '4', sessionKey(event.sessionId), patientKey(current.patientProfileId),
        retryKey(event.sessionId), streamKey,
        String(current.state.currentTurnSequence), event.sessionId, current.patientProfileId,
        JSON.stringify(binding), JSON.stringify(next), `e:${event.eventId}`, event.eventId,
        JSON.stringify(streamEvent), String(expiresAt)
      ]))
      if (result[0] === 'accepted' || result[0] === 'duplicate') return result[0]
      if (result[0] === 'missing_state') return 'missing_state'
      return 'conflict'
    },

    async restore(input) {
      await ensureConnected()
      const state = LivePatientStateSchema.parse(input)
      const binding: SessionBinding = {
        sessionId: state.sessionId, patientProfileId: state.patientProfileId,
        status: state.state.status, state: state.state
      }
      const expiresAt = state.terminalEvent
        ? Math.floor(Date.parse(state.terminalEvent.occurredAt) / 1000) + 20 * 60
        : 0
      if (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000)) return 'expired'
      const terminal = state.terminalEvent ?? { eventId: null }
      const result = await client.sendCommand([
        'EVAL', RESTORE_SCRIPT, '3', sessionKey(state.sessionId), patientKey(state.patientProfileId),
        retryKey(state.sessionId), String(state.state.currentTurnSequence), JSON.stringify(binding),
        JSON.stringify(state), JSON.stringify(state.acceptedTurns), JSON.stringify(terminal), String(expiresAt)
      ])
      if (result === 'restored') return 'restored'
      if (result === 'newer_live_state') return 'newer_live_state'
      return 'already_current'
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Redis event commit returned an invalid result')
  return value.map((item) => String(item))
}
