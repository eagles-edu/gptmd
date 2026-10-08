import { createHash } from 'node:crypto'
import { z } from 'zod'
import { PatientSetupProjectionSchema, type PatientSetupProjection } from './patient-setup.ts'
import {
  PATIENT_SCENARIO_SCHEMA_VERSION,
  PatientScenarioProfileSchema,
  type PatientScenarioProfile
} from './patient-profile.ts'
import {
  SessionStateSchema,
  SessionTurnSchema,
  SessionHistoryEventSchema,
  SessionProviderUsageEventSchema,
  SessionAuditEventSchema,
  type SessionAuditEvent,
  AssessmentSubmissionSchema,
  type SessionHistoryEvent,
  type SessionProviderUsageEvent,
  TerminalEventSchema,
  type AssessmentSubmission,
  type ProviderUsageSample,
  type SessionState,
  type SessionTurn,
  type TerminalEvent
} from './session-contracts.ts'

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
  schemaVersion: typeof PATIENT_SCENARIO_SCHEMA_VERSION
}

export type LivePatientState = ReadyPatientState & {
  state: SessionState
  acceptedTurns: SessionTurn[]
  assessment: AssessmentSubmission | null
  terminalEvent: TerminalEvent | null
}

export type TurnCommitResult =
  | { status: 'accepted' | 'duplicate'; turnId: string; sequence: number; patientResponse: string }
  | { status: 'conflict' | 'missing_state' | 'terminal' | 'not_ready' }
export type SessionCommitOperation = 'turn' | 'phase' | 'assessment' | 'terminal'
export type SessionCommitTimingRecorder = (
  operation: SessionCommitOperation | 'audit_event_enqueue',
  elapsedMs: number
) => void
export type PhaseChangeResult = 'accepted' | 'duplicate' | 'conflict' | 'missing_state' | 'not_ready'
export type AssessmentCommitResult = 'accepted' | 'duplicate' | 'conflict' | 'missing_state' | 'not_ready'

export interface PatientStateStore {
  rememberOwnedSession(tenantId: string, subjectId: string, sessionId: string): Promise<void>
  findOwnedSession(tenantId: string, subjectId: string): Promise<string | null>
  initialize(sessionId: string, patientProfileId: string): Promise<void>
  saveReady(state: ReadyPatientState): Promise<void>
  read(sessionId: string): Promise<LivePatientState | null>
  acquireTurnLock(sessionId: string, ownerToken: string): Promise<boolean>
  releaseTurnLock(sessionId: string, ownerToken: string): Promise<void>
  appendAuditEvent(event: SessionAuditEvent): Promise<void>
  appendProviderUsage(event: SessionProviderUsageEvent): Promise<void>
  acceptTurn(turn: SessionTurn, providerUsage: ProviderUsageSample[], recordTiming?: SessionCommitTimingRecorder): Promise<TurnCommitResult>
  changePhase(event: Extract<SessionHistoryEvent, { eventType: 'phase_changed' }>, recordTiming?: SessionCommitTimingRecorder): Promise<PhaseChangeResult>
  acceptAssessment(event: Extract<SessionHistoryEvent, { eventType: 'assessment_submitted' }>, recordTiming?: SessionCommitTimingRecorder): Promise<AssessmentCommitResult>
  recordTerminal(event: TerminalEvent, recordTiming?: SessionCommitTimingRecorder): Promise<'accepted' | 'duplicate' | 'conflict' | 'missing_state'>
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
  schemaVersion: z.literal(PATIENT_SCENARIO_SCHEMA_VERSION),
  state: SessionStateSchema,
  acceptedTurns: z.array(SessionTurnSchema),
  assessment: AssessmentSubmissionSchema.nullable(),
  terminalEvent: TerminalEventSchema.nullable()
}).strict()

const COMMIT_PHASE_CHANGE_SCRIPT = `
local sessionJson = redis.call('JSON.GET', KEYS[1])
local patientJson = redis.call('JSON.GET', KEYS[2])
if not sessionJson or not patientJson then return {'missing_state'} end
local session = cjson.decode(sessionJson)
local patient = cjson.decode(patientJson)
if session.sessionId ~= ARGV[1] or patient.sessionId ~= ARGV[1] or
   session.patientProfileId ~= ARGV[2] or patient.patientProfileId ~= ARGV[2] then
  return {'missing_state'}
end
if session.state.phase == 'assessment' then return {'duplicate'} end
if session.state.phase ~= 'history' or tonumber(session.state.currentTurnSequence) < 1 or
   tonumber(session.state.currentTurnSequence) ~= tonumber(ARGV[3]) then return {'not_ready'} end
local event = cjson.decode(ARGV[4])
if event.sequence ~= tonumber(ARGV[3]) or event.payload.from ~= 'history' or event.payload.to ~= 'assessment' then
  return {'conflict'}
end
redis.call('JSON.SET', KEYS[1], '$.state.phase', '"assessment"')
redis.call('JSON.SET', KEYS[1], '$.state.updatedAt', cjson.encode(event.occurredAt))
redis.call('JSON.SET', KEYS[2], '$.state.phase', '"assessment"')
redis.call('JSON.SET', KEYS[2], '$.state.updatedAt', cjson.encode(event.occurredAt))
redis.call('XADD', KEYS[3], '*', 'event', ARGV[4])
return {'accepted'}
`

const COMMIT_ASSESSMENT_SCRIPT = `
local sessionJson = redis.call('JSON.GET', KEYS[1])
local patientJson = redis.call('JSON.GET', KEYS[2])
if not sessionJson or not patientJson then return {'missing_state'} end
local session = cjson.decode(sessionJson)
local patient = cjson.decode(patientJson)
if session.sessionId ~= ARGV[1] or patient.sessionId ~= ARGV[1] or
   session.patientProfileId ~= ARGV[2] or patient.patientProfileId ~= ARGV[2] then
  return {'missing_state'}
end
if type(patient.assessment) == 'table' then
  local event = cjson.decode(ARGV[5])
  local submitted = event.payload
  local existing = patient.assessment
  if existing.assessmentId == submitted.assessmentId and existing.sessionId == submitted.sessionId and
     existing.turnSequence == submitted.turnSequence and existing.submittedAt == submitted.submittedAt and
     existing.summary == submitted.summary and existing.differential == submitted.differential and
     existing.rationale == submitted.rationale and existing.plan == submitted.plan then
    return {'duplicate'}
  end
  return {'conflict'}
end
if session.state.phase ~= 'assessment' or tonumber(session.state.currentTurnSequence) ~= tonumber(ARGV[4]) then
  return {'not_ready'}
end
if type(patient.assessment) == 'table' then return {'conflict'} end
local event = cjson.decode(ARGV[5])
if event.sequence ~= tonumber(ARGV[4]) or event.eventType ~= 'assessment_submitted' then return {'conflict'} end
redis.call('JSON.SET', KEYS[1], '$.state.phase', '"debrief"')
redis.call('JSON.SET', KEYS[1], '$.state.updatedAt', cjson.encode(event.occurredAt))
redis.call('JSON.SET', KEYS[2], '$.assessment', cjson.encode(event.payload))
redis.call('JSON.SET', KEYS[2], '$.state.phase', '"debrief"')
redis.call('JSON.SET', KEYS[2], '$.state.updatedAt', cjson.encode(event.occurredAt))
redis.call('XADD', KEYS[3], '*', 'event', ARGV[5])
return {'accepted'}
`

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
local events = cjson.decode(ARGV[4])
local event = cjson.decode(events[1])
if event.payload.phase ~= session.state.phase then
  return {'not_ready'}
end
redis.call('JSON.SET', KEYS[1], '$', ARGV[5])
redis.call('JSON.SET', KEYS[2], '$', ARGV[6])
redis.call('HSET', KEYS[3], ARGV[7], ARGV[8])
for _, streamEvent in ipairs(events) do
  redis.call('XADD', KEYS[4], '*', 'event', streamEvent)
end
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
  if type(session.state) == 'table' and (
    tonumber(session.state.currentTurnSequence or 0) > 0 or
    session.state.phase ~= 'history' or
    session.state.status == 'completed' or session.state.status == 'cancelled'
  ) then
    return 'preserved_live'
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
local terminal = cjson.decode(ARGV[5])
local terminalId = nil
if type(terminal) == 'table' and type(terminal.eventId) == 'string' then terminalId = terminal.eventId end
local sessionJson = redis.call('JSON.GET', KEYS[1])
local patientJson = redis.call('JSON.GET', KEYS[2])
if sessionJson then
  local session = cjson.decode(sessionJson)
  if session.state and tonumber(session.state.currentTurnSequence) > tonumber(ARGV[1]) then
    return 'newer_live_state'
  end
  if session.state and type(session.state.terminalEventId) == 'string' and
     session.state.terminalEventId ~= terminalId then
    return 'newer_live_state'
  end
end
if patientJson then
  local patient = cjson.decode(patientJson)
  if patient.state and tonumber(patient.state.currentTurnSequence) > tonumber(ARGV[1]) then
    return 'newer_live_state'
  end
  if patient.state and type(patient.state.terminalEventId) == 'string' and
     patient.state.terminalEventId ~= terminalId then
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
if terminalId then redis.call('HSET', KEYS[3], 'e:' .. terminalId, terminalId) end
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
  const ownerSessionKey = (tenantId: string, subjectId: string) =>
    `gptmd:owner-session:${createHash('sha256').update(`${tenantId}\0${subjectId}`).digest('hex')}`
  const retryKey = (sessionId: string) => `gptmd:retries:${sessionId}`
  const turnLockKey = (sessionId: string) => `gptmd:turn-lock:${sessionId}`
  const streamKey = 'gptmd:session-events'

  async function getJson(key: string): Promise<unknown | null> {
    const result = await client.sendCommand(['JSON.GET', key])
    if (typeof result !== 'string') return null
    return JSON.parse(result) as unknown
  }

  return {
    async rememberOwnedSession(tenantId, subjectId, sessionId) {
      await ensureConnected()
      await client.sendCommand(['SET', ownerSessionKey(tenantId, subjectId), sessionId])
    },

    async findOwnedSession(tenantId, subjectId) {
      await ensureConnected()
      const value = await client.sendCommand(['GET', ownerSessionKey(tenantId, subjectId)])
      return typeof value === 'string' ? value : null
    },

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
        ...input, state, acceptedTurns: [], assessment: null, terminalEvent: null
      }
      const validatedPatient = LivePatientStateSchema.parse(patient)
      await ensureConnected()
      const result = await client.sendCommand([
        'EVAL', SAVE_READY_SCRIPT, '2', sessionKey(input.sessionId), patientKey(input.patientProfileId),
        input.sessionId, input.patientProfileId, JSON.stringify(binding), JSON.stringify(validatedPatient)
      ])
      if (result !== 'OK' && result !== 'preserved_live') {
        throw new Error('Redis could not commit the ready patient state')
      }
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

    async appendAuditEvent(input) {
      await ensureConnected()
      const event = SessionAuditEventSchema.parse(input)
      await client.sendCommand([
        'XADD', streamKey, '*', 'event', JSON.stringify(event)
      ])
    },

    async appendProviderUsage(input) {
      await ensureConnected()
      const event = SessionProviderUsageEventSchema.parse(input)
      await client.sendCommand([
        'XADD', streamKey, '*', 'event', JSON.stringify(event)
      ])
    },

    async acceptTurn(input, providerUsage, recordTiming) {
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
        ...current.state, status: 'active', phase: turn.phase, updatedAt: turn.acceptedAt,
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
        eventOrdinal: 0,
        eventType: 'accepted_turn', occurredAt: turn.acceptedAt, providerUsage, payload: turn
      }
      const allDisclosures = [
        ...turn.disclosedHistoryFields.map((field, index) => ({
          field,
          painEpisodeId: null,
          factId: turn.disclosedFactIds[index]
        })),
        ...turn.painDisclosures
      ]
      const disclosureEvents = allDisclosures.map(({ field, painEpisodeId, factId }, index) => {
        if (!factId) throw new Error('A disclosed history field is missing its fact ID')
        const eventDigest = createHash('sha256')
          .update(`${turn.turnId}\0${painEpisodeId ?? ''}\0${field}\0${factId}`)
          .digest('hex')
        return {
          eventId: `disclosure_${eventDigest}`,
          sessionId: turn.sessionId,
          sequence: turn.sequence,
          eventOrdinal: index + 1,
          eventType: 'disclosure',
          occurredAt: turn.acceptedAt,
          payload: {
            turnId: turn.turnId,
            turnSequence: turn.sequence,
            field,
            painEpisodeId,
            factId,
            source: factId.startsWith('seed:') ? 'scenario_seed' as const : 'patient_reported' as const
          }
        }
      })
      const reply = { turnId: turn.turnId, sequence: turn.sequence, patientResponse: turn.patientResponse }
      const result = asStringArray(await measureSessionCommit('turn', recordTiming, () => client.sendCommand([
        'EVAL', COMMIT_TURN_SCRIPT, '4', sessionKey(turn.sessionId), patientKey(current.patientProfileId),
        retryKey(turn.sessionId), streamKey,
        String(current.state.currentTurnSequence), turn.sessionId, current.patientProfileId,
        JSON.stringify([event, ...disclosureEvents].map((streamEvent) => JSON.stringify(streamEvent))),
        JSON.stringify(binding), JSON.stringify(next), `t:${turn.turnId}`,
        JSON.stringify(reply)
      ])))
      if (result[0] === 'accepted' || result[0] === 'duplicate') {
        const saved = result[1] ? JSON.parse(result[1]) as typeof reply : reply
        return { status: result[0], ...saved }
      }
      if (result[0] === 'terminal') return { status: 'terminal' }
      if (result[0] === 'not_ready') return { status: 'not_ready' }
      if (result[0] === 'missing_state') return { status: 'missing_state' }
      return { status: 'conflict' }
    },

    async changePhase(input, recordTiming) {
      await ensureConnected()
      const event = SessionHistoryEventSchema.parse(input)
      if (event.eventType !== 'phase_changed') return 'conflict'
      const current = await this.read(event.sessionId)
      if (!current) return 'missing_state'
      if (current.state.phase === 'assessment') return 'duplicate'
      if (current.state.phase !== 'history' || current.state.currentTurnSequence < 1 ||
          current.state.status === 'completed' || current.state.status === 'cancelled') return 'not_ready'
      const lastTurn = current.acceptedTurns.at(-1)
      const expectedOrdinal = (lastTurn?.disclosedHistoryFields.length ?? 0) +
        (lastTurn?.painDisclosures.length ?? 0) + 1
      if (event.sequence !== current.state.currentTurnSequence || event.eventOrdinal !== expectedOrdinal) return 'conflict'
      const result = asStringArray(await measureSessionCommit('phase', recordTiming, () => client.sendCommand([
        'EVAL', COMMIT_PHASE_CHANGE_SCRIPT, '3', sessionKey(event.sessionId),
        patientKey(current.patientProfileId), streamKey,
        event.sessionId, current.patientProfileId, String(current.state.currentTurnSequence), JSON.stringify(event)
      ])))
      if (result[0] === 'accepted') return 'accepted'
      if (result[0] === 'duplicate') return 'duplicate'
      if (result[0] === 'missing_state') return 'missing_state'
      if (result[0] === 'not_ready') return 'not_ready'
      return 'conflict'
    },

    async acceptAssessment(input, recordTiming) {
      await ensureConnected()
      const event = SessionHistoryEventSchema.parse(input)
      if (event.eventType !== 'assessment_submitted') return 'conflict'
      const current = await this.read(event.sessionId)
      if (!current) return 'missing_state'
      if (current.assessment) {
        return JSON.stringify(current.assessment) === JSON.stringify(event.payload) ? 'duplicate' : 'conflict'
      }
      if (current.state.phase !== 'assessment' || current.state.status === 'completed' ||
          current.state.status === 'cancelled') return 'not_ready'
      const lastTurn = current.acceptedTurns.at(-1)
      const expectedOrdinal = (lastTurn?.disclosedHistoryFields.length ?? 0) +
        (lastTurn?.painDisclosures.length ?? 0) + 2
      if (event.sequence !== current.state.currentTurnSequence || event.eventOrdinal !== expectedOrdinal) return 'conflict'
      const result = asStringArray(await measureSessionCommit('assessment', recordTiming, () => client.sendCommand([
        'EVAL', COMMIT_ASSESSMENT_SCRIPT, '3', sessionKey(event.sessionId),
        patientKey(current.patientProfileId), streamKey,
        event.sessionId, current.patientProfileId, event.eventId,
        String(current.state.currentTurnSequence), JSON.stringify(event)
      ])))
      if (result[0] === 'accepted') return 'accepted'
      if (result[0] === 'duplicate') return 'duplicate'
      if (result[0] === 'missing_state') return 'missing_state'
      if (result[0] === 'not_ready') return 'not_ready'
      return 'conflict'
    },

    async recordTerminal(input, recordTiming) {
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
        eventOrdinal: 0,
        eventType: 'terminal', occurredAt: event.occurredAt, payload: event
      }
      const expiresAt = Math.floor(Date.parse(event.occurredAt) / 1000) + 20 * 60
      const result = asStringArray(await measureSessionCommit('terminal', recordTiming, () => client.sendCommand([
        'EVAL', COMMIT_TERMINAL_SCRIPT, '4', sessionKey(event.sessionId), patientKey(current.patientProfileId),
        retryKey(event.sessionId), streamKey,
        String(current.state.currentTurnSequence), event.sessionId, current.patientProfileId,
        JSON.stringify(binding), JSON.stringify(next), `e:${event.eventId}`, event.eventId,
        JSON.stringify(streamEvent), String(expiresAt)
      ])))
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

async function measureSessionCommit<T>(
  operation: SessionCommitOperation,
  recordTiming: SessionCommitTimingRecorder | undefined,
  commit: () => Promise<T>
): Promise<T> {
  if (!recordTiming) return commit()
  const startedAt = performance.now()
  try {
    return await commit()
  } finally {
    try {
      recordTiming(operation, Math.max(0, performance.now() - startedAt))
    } catch {
      // Timing observers must not affect the payload-critical commit.
    }
  }
}
