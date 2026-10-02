import { describe, expect, it, vi } from 'vitest'
import { createRedisPatientStateStore, type RedisJsonClient } from '../../services/api/src/patient-state-store.ts'

function createJsonRedis(isOpen = true): RedisJsonClient & { documents: Map<string, unknown>; sendCommand: ReturnType<typeof vi.fn> } {
  const documents = new Map<string, unknown>()
  const sendCommand = vi.fn(async (command: string[]) => {
    if (command[0] === 'JSON.SET') {
      const [, key, , serialized, condition] = command
      if (condition === 'NX' && documents.has(key!)) return null
      documents.set(key!, JSON.parse(serialized!))
      return 'OK'
    }
    if (command[0] === 'JSON.GET') {
      const stored = documents.get(command[1]!)
      return stored === undefined ? null : JSON.stringify(stored)
    }
    throw new Error(`Unexpected Redis command: ${command[0]}`)
  })
  return { isOpen, connect: vi.fn(), sendCommand, documents }
}

describe('Redis patient state store', () => {
  it('initializes both opaque bindings idempotently and stores the complete private profile', async () => {
    const redis = createJsonRedis()
    const store = createRedisPatientStateStore(redis)
    const sessionId = 's'.repeat(43)
    const patientProfileId = 'p'.repeat(43)

    await store.initialize(sessionId, patientProfileId)
    await store.initialize(sessionId, patientProfileId)
    await store.saveReady({
      sessionId,
      patientProfileId,
      profile: {
        fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
        reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis', history: [],
        currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
        patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
        persona: {
          mood: 'concerned', maturity: 'adult', verbosity: 'moderate',
          educationLevel: 'college', willingnessToDisclose: 'gradual'
        }
      },
      setupProjection: {
        fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
        reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis'
      },
      conversationId: 'conv_private',
      profileDigest: 'digest_private',
      schemaVersion: 1
    })

    expect(redis.connect).not.toHaveBeenCalled()
    expect(redis.documents.get(`gptmd:session:${sessionId}`)).toEqual({
      sessionId, patientProfileId, status: 'ready'
    })
    expect(redis.documents.get(`gptmd:patient:${patientProfileId}`)).toMatchObject({
      sessionId, patientProfileId, status: 'ready',
      profile: { diagnosis: 'Endometriosis' },
      setupProjection: { diagnosis: 'Endometriosis' },
      conversationId: 'conv_private', profileDigest: 'digest_private', schemaVersion: 1
    })
    expect(redis.sendCommand).toHaveBeenCalledWith(expect.arrayContaining(['JSON.SET', `gptmd:session:${sessionId}`, '$', expect.any(String), 'NX']))
  })

  it('rejects a Redis key already bound to another session or profile', async () => {
    const redis = createJsonRedis()
    redis.documents.set('gptmd:session:session-a', {
      sessionId: 'session-a', patientProfileId: 'profile-a', status: 'initializing'
    })
    const store = createRedisPatientStateStore(redis)

    await expect(store.initialize('session-a', 'profile-b')).rejects.toThrow('already bound')
  })

  it('connects a closed Redis client before initializing state', async () => {
    const redis = createJsonRedis(false)
    const store = createRedisPatientStateStore(redis)

    await store.initialize('session-a', 'profile-a')

    expect(redis.connect).toHaveBeenCalledOnce()
    expect(redis.sendCommand).toHaveBeenCalled()
  })
})
