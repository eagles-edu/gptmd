import type { PatientSetupProjection } from './patient-setup.ts'
import type { PatientScenarioProfile } from './patient-profile.ts'

export interface RedisJsonClient {
  readonly isOpen: boolean
  connect(): Promise<unknown>
  sendCommand(command: string[]): Promise<unknown>
}

export type ReadyPatientState = {
  sessionId: string
  patientProfileId: string
  profile: PatientScenarioProfile
  setupProjection: PatientSetupProjection
  conversationId: string
  profileDigest: string
  schemaVersion: number
}

export interface PatientStateStore {
  initialize(sessionId: string, patientProfileId: string): Promise<void>
  saveReady(state: ReadyPatientState): Promise<void>
}

type SessionBinding = {
  sessionId: string
  patientProfileId: string
  status: 'initializing' | 'ready'
}

type PatientReceptacle = {
  sessionId: string
  patientProfileId: string
  status: 'initializing' | 'ready'
  profile: PatientScenarioProfile | null
  setupProjection: PatientSetupProjection | null
  conversationId: string | null
  profileDigest: string | null
  schemaVersion: number | null
}

export function createRedisPatientStateStore(client: RedisJsonClient): PatientStateStore {
  async function ensureConnected(): Promise<void> {
    if (!client.isOpen) await client.connect()
  }

  async function setIfMissing(key: string, value: SessionBinding | PatientReceptacle): Promise<void> {
    const result = await client.sendCommand([
      'JSON.SET', key, '$', JSON.stringify(value), 'NX'
    ])
    if (result === 'OK') return

    const stored = await client.sendCommand(['JSON.GET', key])
    if (typeof stored !== 'string') {
      throw new Error('Redis patient state could not be read after an idempotent initialization.')
    }
    const parsed: unknown = JSON.parse(stored)
    if (!isRecord(parsed) ||
        parsed.sessionId !== value.sessionId ||
        parsed.patientProfileId !== value.patientProfileId) {
      throw new Error('Redis patient state is already bound to another session or profile.')
    }
  }

  return {
    async initialize(sessionId, patientProfileId) {
      await ensureConnected()
      await setIfMissing(`gptmd:session:${sessionId}`, {
        sessionId,
        patientProfileId,
        status: 'initializing'
      })
      await setIfMissing(`gptmd:patient:${patientProfileId}`, {
        sessionId,
        patientProfileId,
        status: 'initializing',
        profile: null,
        setupProjection: null,
        conversationId: null,
        profileDigest: null,
        schemaVersion: null
      })
    },

    async saveReady(state) {
      await ensureConnected()
      const binding: SessionBinding = {
        sessionId: state.sessionId,
        patientProfileId: state.patientProfileId,
        status: 'ready'
      }
      const patient: PatientReceptacle = {
        ...binding,
        profile: state.profile,
        setupProjection: state.setupProjection,
        conversationId: state.conversationId,
        profileDigest: state.profileDigest,
        schemaVersion: state.schemaVersion
      }
      await client.sendCommand([
        'JSON.SET', `gptmd:patient:${state.patientProfileId}`, '$', JSON.stringify(patient)
      ])
      await client.sendCommand([
        'JSON.SET', `gptmd:session:${state.sessionId}`, '$', JSON.stringify(binding)
      ])
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
