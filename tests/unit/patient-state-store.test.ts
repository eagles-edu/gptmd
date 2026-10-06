import { describe, expect, it, vi } from 'vitest'
import { createRedisPatientStateStore, type RedisJsonClient } from '../../services/api/src/patient-state-store.ts'

function createJsonRedis(isOpen = true): RedisJsonClient & { documents: Map<string, unknown>; sendCommand: ReturnType<typeof vi.fn> } {
  const documents = new Map<string, unknown>()
  const locks = new Map<string, string>()
  const sendCommand = vi.fn(async (command: string[]) => {
    if (command[0] === 'XADD') return '1-0'
    if (command[0] === 'SET' && command[3] === 'NX') {
      if (locks.has(command[1]!)) return null
      locks.set(command[1]!, command[2]!)
      return 'OK'
    }
    if (command[0] === 'EVAL' && command[2] === '1') {
      if (locks.get(command[3]!) === command[4]) locks.delete(command[3]!)
      return 1
    }
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
    if (command[0] === 'EVAL' && command[1]?.includes("redis.call('JSON.SET', KEYS[1], '$', ARGV[3])")) {
      documents.set(command[3]!, JSON.parse(command[7]!))
      documents.set(command[4]!, JSON.parse(command[8]!))
      return 'OK'
    }
    throw new Error(`Unexpected Redis command: ${command[0]}`)
  })
  return { isOpen, connect: vi.fn(), sendCommand, documents }
}

function createAtomicJsonRedis(): ReturnType<typeof createJsonRedis> & {
  retryRecords: Map<string, string>
  events: string[]
} {
  const redis = createJsonRedis()
  const handleJson = redis.sendCommand.getMockImplementation()!
  const retryRecords = new Map<string, string>()
  const events: string[] = []
  redis.sendCommand.mockImplementation(async (command: string[]) => {
    if (command[0] === 'EVAL' && command[2] === '2') {
      redis.documents.set(command[3]!, JSON.parse(command[7]!))
      redis.documents.set(command[4]!, JSON.parse(command[8]!))
      return 'OK'
    }
    if (command[0] === 'EVAL' && command[2] === '4') {
      const session = redis.documents.get(command[3]!) as { state: { currentTurnSequence: number } }
      const retryMapKey = command[5]!
      const retryField = `${retryMapKey}:${command[13]}`
      const prior = retryRecords.get(retryField)
      if (prior) return ['duplicate', prior]
      if (session.state.currentTurnSequence !== Number(command[7])) return ['conflict']
      redis.documents.set(command[3]!, JSON.parse(command[11]!))
      redis.documents.set(command[4]!, JSON.parse(command[12]!))
      retryRecords.set(retryField, command[14]!)
      events.push(...JSON.parse(command[10]!) as string[])
      return ['accepted', command[14]!]
    }
    return handleJson(command)
  })
  return { ...redis, retryRecords, events }
}

describe('Redis patient state store', () => {
  it('queues only bounded turn audit identifiers and categories in the worker stream', async () => {
    const redis = createJsonRedis()
    const store = createRedisPatientStateStore(redis)
    const audit = {
      eventId: '58fa91f0-77f4-4dc7-a055-7783f0270c00',
      sessionId: 's'.repeat(43),
      eventType: 'patient_turn_validation_failure' as const,
      occurredAt: '2026-10-05T00:00:00.000Z',
      payload: { turnIdHash: 'a'.repeat(64), attemptCount: 2 }
    }

    await store.appendAuditEvent(audit)

    expect(redis.sendCommand).toHaveBeenCalledWith([
      'XADD', 'gptmd:session-events', '*', 'event', JSON.stringify(audit)
    ])
    expect(JSON.stringify(audit)).not.toMatch(/learnerMessage|patientResponse|prompt|raw/i)
  })

  it('serializes a session turn with an owner checked Redis lock', async () => {
    const redis = createJsonRedis()
    const store = createRedisPatientStateStore(redis)
    const sessionId = 's'.repeat(43)

    expect(await store.acquireTurnLock(sessionId, 'owner-a')).toBe(true)
    expect(await store.acquireTurnLock(sessionId, 'owner-b')).toBe(false)
    await store.releaseTurnLock(sessionId, 'owner-b')
    expect(await store.acquireTurnLock(sessionId, 'owner-b')).toBe(false)
    await store.releaseTurnLock(sessionId, 'owner-a')
    expect(await store.acquireTurnLock(sessionId, 'owner-b')).toBe(true)
  })

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
      openedAt: '2026-10-01T00:00:00.000Z',
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
      profileDigest: 'a'.repeat(64),
      schemaVersion: 5
    })

    expect(redis.connect).not.toHaveBeenCalled()
    expect(redis.documents.get(`gptmd:session:${sessionId}`)).toMatchObject({
      sessionId, patientProfileId, status: 'ready', state: { currentTurnSequence: 0 }
    })
    expect(redis.documents.get(`gptmd:patient:${patientProfileId}`)).toMatchObject({
      sessionId, patientProfileId, state: { status: 'ready' }, acceptedTurns: [],
      profile: { diagnosis: 'Endometriosis' },
      setupProjection: { diagnosis: 'Endometriosis' },
      conversationId: 'conv_private', profileDigest: 'a'.repeat(64), schemaVersion: 5
    })
    expect(redis.sendCommand).toHaveBeenCalledWith(expect.arrayContaining(['EVAL', expect.any(String), '2', `gptmd:session:${sessionId}`]))

    const commandsBeforeUnsupportedVersion = redis.sendCommand.mock.calls.length
    await expect(store.saveReady({
      sessionId, patientProfileId, openedAt: '2026-10-01T00:00:00.000Z',
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
      conversationId: 'conv_private', profileDigest: 'digest_private', schemaVersion: 3
    } as never)).rejects.toThrow()
    expect(redis.sendCommand).toHaveBeenCalledTimes(commandsBeforeUnsupportedVersion)
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

  it('commits an accepted reply and recovery event once and returns the saved reply to a racing retry', async () => {
    const redis = createAtomicJsonRedis()
    const store = createRedisPatientStateStore(redis)
    const sessionId = 's'.repeat(43)
    const patientProfileId = 'p'.repeat(43)
    const openedAt = '2026-10-01T00:00:00.000Z'
    await store.initialize(sessionId, patientProfileId)
    await store.saveReady({
      sessionId, patientProfileId, openedAt,
      profile: {
        fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
        reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis',
        history: [{ field: 'anyPain', status: 'known', value: 'Pelvic pain' }],
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
      conversationId: 'conv_private', profileDigest: 'a'.repeat(64), schemaVersion: 5
    })
    const turn = {
      turnId: 'turn-1', sessionId, sequence: 1, acceptedAt: '2026-10-01T00:01:00.000Z',
      phase: 'history', learnerModality: 'typed',
      versions: {
        promptVersion: 'patient-turn-prompt-v7', modelVersion: 'gpt-6-luna',
        schemaVersion: 3, policyVersion: 'patient-turn-policy-v7', rubricVersion: null
      },
      learnerMessage: 'What brings you in?', patientResponse: 'I have pelvic pain.',
      patientReportedFacts: [], historyCoverage: [], disclosedHistoryFields: ['anyPain'],
      disclosedFactIds: ['seed:scenario-1:anyPain'], historyCoverageState: [], clinicalActions: []
    }

    const recordTiming = vi.fn()
    const results = await Promise.all([store.acceptTurn(turn, [], recordTiming), store.acceptTurn(turn, [])])

    expect(results).toEqual([
      { status: 'accepted', turnId: 'turn-1', sequence: 1, patientResponse: 'I have pelvic pain.' },
      { status: 'duplicate', turnId: 'turn-1', sequence: 1, patientResponse: 'I have pelvic pain.' }
    ])
    const turnCommitCommands = redis.sendCommand.mock.calls
      .map(([command]) => command)
      .filter((command) => command[0] === 'EVAL' && command[2] === '4')
    expect(turnCommitCommands).toHaveLength(2)
    const commitCommand = turnCommitCommands[0]!
    expect(commitCommand[1]).toContain("redis.call('JSON.SET', KEYS[1], '$', ARGV[5])")
    expect(commitCommand[1]).toContain("redis.call('JSON.SET', KEYS[2], '$', ARGV[6])")
    expect(commitCommand[1]).toContain('redis.call(\'HSET\', KEYS[3], ARGV[7], ARGV[8])')
    expect(commitCommand[1]).toContain("redis.call('XADD', KEYS[4], '*', 'event', streamEvent)")
    expect(JSON.parse(commitCommand[10]!).map((event: string) => JSON.parse(event).eventType))
      .toEqual(['accepted_turn', 'disclosure'])
    expect(commitCommand[13]).toBe('t:turn-1')
    expect(JSON.parse(commitCommand[14]!)).toEqual({
      turnId: 'turn-1', sequence: 1, patientResponse: 'I have pelvic pain.'
    })
    expect(redis.events).toHaveLength(2)
    expect(redis.events.map((serialized) => JSON.parse(serialized!).eventType)).toEqual(['accepted_turn', 'disclosure'])
    expect(JSON.parse(redis.events[1]!)).toMatchObject({
      eventOrdinal: 1,
      payload: { turnId: 'turn-1', turnSequence: 1, field: 'anyPain', factId: 'seed:scenario-1:anyPain', source: 'scenario_seed' }
    })
    expect(recordTiming).toHaveBeenCalledWith('turn', expect.any(Number))
    expect(await store.read(sessionId)).toMatchObject({
      state: { status: 'active', currentTurnSequence: 1 }, acceptedTurns: [turn]
    })
  })
})
