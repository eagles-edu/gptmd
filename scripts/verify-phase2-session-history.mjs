import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { chromium } from '@playwright/test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { parseEnv } from 'node:util'
import { createApiApp } from '../services/api/src/app.ts'
import { createRedisPatientStateStore } from '../services/api/src/patient-state-store.ts'
import { createRedisRequestRateLimitStore, hashRateLimitKey } from '../services/api/src/request-rate-limit.ts'
import { createPostgresSessionStore } from '../services/api/src/session-store.ts'
import { createPostgresOrganizationAiTimeBudgetStore } from '../services/api/src/organization-ai-time-budget.ts'
import { createPostgresProviderTokenReservationStore } from '../services/api/src/provider-token-reservations.ts'
import { createPostgresSessionArchiveStore, createSessionArchiveWorker } from '../services/api/src/session-archives.ts'
import { createPostgresConsumerTokenCatalogStore } from '../services/api/src/consumer-token-catalog.ts'
import { createPostgresTokenEntitlementStore } from '../services/api/src/token-entitlements.ts'
import { createSessionEventWorker } from '../services/api/src/session-event-worker.ts'
import { createSessionIdentityVerificationWorker } from '../services/api/src/session-identity-verification-worker.ts'
import { PATIENT_TURN_SCHEMA_VERSION } from '../services/api/src/session-contracts.ts'
import { makePainEpisode } from '../tests/fixtures/pain-episodes.ts'
import { getE2ECertificate } from './e2e-certificate.mjs'
import {
  PATIENT_SCENARIO_POLICY_VERSION,
  PATIENT_SCENARIO_PROMPT_VERSION,
  PATIENT_SCENARIO_SCHEMA_VERSION
} from '../services/api/src/patient-profile.ts'

const require = createRequire(new URL('../services/api/package.json', import.meta.url))
const { Pool } = require('pg')
const { createClient } = require('redis')

async function getFreePort() {
  const server = createNetServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve an integration-test TCP port')
  const port = address.port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForHttpsServer(port, child) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    if (child.exitCode !== null) throw new Error(`Nuxt HTTPS integration server exited with status ${child.exitCode}`)
    const ready = await new Promise((resolve) => {
      const request = httpsRequest({ host: 'localhost', port, path: '/', timeout: 1_000, rejectUnauthorized: false }, (response) => {
        response.resume()
        resolve(true)
      })
      request.on('error', () => resolve(false))
      request.on('timeout', () => request.destroy())
      request.end()
    })
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Nuxt HTTPS integration server did not become ready within 30 seconds')
}

async function buildNuxtForVerifier() {
  const scriptPath = new URL('./build.mjs', import.meta.url).pathname
  await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [scriptPath], { stdio: 'inherit', env: process.env })
    build.once('error', reject)
    build.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Nuxt verification build failed (code=${code}, signal=${signal})`))
    })
  })
}

const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'))
if (!env.DATABASE_URL || !env.REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required')

const apiPort = await getFreePort()
const supabasePort = await getFreePort()
const apiBase = `http://127.0.0.1:${apiPort}`
const supabaseOrigin = `https://localhost:${supabasePort}`
process.env.NUXT_PUBLIC_API_BASE = apiBase
process.env.NUXT_PUBLIC_SUPABASE_URL = supabaseOrigin
process.env.NUXT_PUBLIC_SUPABASE_KEY = 'phase-two-verification-test-key'
await buildNuxtForVerifier()

const redis = createClient({ url: process.env.GPTMD_PHASE2_REDIS_URL ?? env.REDIS_URL })
redis.on('error', () => undefined)
await redis.connect()
const databaseConfiguration = await redis.sendCommand(['CONFIG', 'GET', 'databases'])
const databaseCount = Number(databaseConfiguration?.databases)
if (!Number.isInteger(databaseCount) || databaseCount < 2) {
  await redis.quit()
  throw new Error('Redis needs at least one empty non-default logical database for isolated local verification')
}
let isolatedRedisDatabase = null
for (let index = 1; index < databaseCount; index += 1) {
  await redis.sendCommand(['SELECT', String(index)])
  const databaseSize = Number(await redis.sendCommand(['DBSIZE']))
  if (databaseSize === 0) {
    isolatedRedisDatabase = index
    break
  }
}
if (isolatedRedisDatabase === null) {
  await redis.quit()
  throw new Error('No empty non-default Redis logical database is available for isolated local verification')
}
const streamKey = 'gptmd:session-events'
async function assertPersistedStreamEntriesWereTrimmed(stage) {
  const remaining = Number(await redis.sendCommand(['XLEN', streamKey]))
  if (remaining !== 0) {
    throw new Error(`Redis session events remained after PostgreSQL persistence at ${stage}: ${remaining}`)
  }
}
const currentStreamLength = Number(await redis.sendCommand(['XLEN', streamKey]))
if (currentStreamLength !== 0) {
  await redis.quit()
  throw new Error('Refusing local verification because the shared session event stream is not empty')
}
const persistenceConfig = await redis.sendCommand(['CONFIG', 'GET', 'appendfsync'])
if (!persistenceConfig || typeof persistenceConfig !== 'object' ||
    persistenceConfig.appendfsync !== 'everysec') {
  await redis.quit()
  throw new Error('Redis appendfsync is not configured for the documented one-second write window')
}

const temporaryDatabase = `gptmd_phase2_verify_${randomBytes(6).toString('hex')}`
const adminUrl = new URL(env.DATABASE_URL)
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 })
const testUrl = new URL(env.DATABASE_URL)
testUrl.pathname = `/${temporaryDatabase}`
let testPool
let sessionId
let patientProfileId
let apiServer
let jwksServer
let browserServer
let supabaseServer
let browser
let browserSessionId
let browserPatientProfileId
let tenantId
let subjectId

try {
  await adminPool.query(`CREATE DATABASE "${temporaryDatabase}"`)
  testPool = new Pool({ connectionString: testUrl.toString(), max: 2 })
  const migrationFiles = (await readdir(new URL('../services/api/migrations/', import.meta.url)))
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort()
  for (const file of migrationFiles) {
    const sql = await readFile(new URL(`../services/api/migrations/${file}`, import.meta.url), 'utf8')
    await testPool.query(sql)
  }
  const tokenLedgerSchema = await testPool.query(
    `SELECT to_regclass('public.gptmd_token_entitlement_grants') IS NOT NULL AS grants,
            to_regclass('public.gptmd_token_entitlement_entries') IS NOT NULL AS entries,
            to_regclass('public.gptmd_token_reservation_allocations') IS NOT NULL AS holds,
            EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'app_sessions' AND column_name = 'addon_tokens_used') AS addon_usage,
            EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'app_sessions' AND column_name = 'addon_notice_acknowledged') AS addon_acknowledgment`
  )
  if (!tokenLedgerSchema.rows[0]?.grants || !tokenLedgerSchema.rows[0]?.entries || !tokenLedgerSchema.rows[0]?.holds ||
      !tokenLedgerSchema.rows[0]?.addon_usage || !tokenLedgerSchema.rows[0]?.addon_acknowledgment) {
    throw new Error('Token bucket or add-on-notice migration did not create all required schema')
  }
  const catalogStore = createPostgresConsumerTokenCatalogStore(testPool)
  if (await catalogStore.get() !== null) throw new Error('New consumer catalog should start unconfigured')
  const catalog = {
    schemaVersion: 1, revision: 0, baseMonthlyTokens: 25_000, currency: 'USD',
    tiers: [
      { code: 'lunar', monthlyPriceMinor: 1000, status: 'draft' },
      { code: 'solar', monthlyPriceMinor: 2000, status: 'draft' },
      { code: 'stellar', monthlyPriceMinor: 3000, status: 'draft' }
    ],
    addOns: [{
      code: 'addon-small', name: 'Small pack', description: 'Test product',
      tokens: 5000, priceMinor: 500, status: 'draft'
    }]
  }
  const savedCatalog = await catalogStore.save('phase2-system-admin', catalog)
  if (savedCatalog === 'conflict' || savedCatalog.revision !== 1) {
    throw new Error('Consumer catalog did not persist at revision 1')
  }
  if (await catalogStore.save('stale-system-admin', catalog) !== 'conflict') {
    throw new Error('Stale consumer catalog write was not rejected')
  }
  const auditCount = await testPool.query(
    'SELECT count(*)::int AS count FROM gptmd_consumer_token_catalog_audit'
  )
  if (auditCount.rows[0]?.count !== 1) throw new Error('Consumer catalog audit should contain one accepted revision')
  const cleanupConversationId = `conv-verify-${randomBytes(6).toString('hex')}`
  await testPool.query(
    `INSERT INTO app_patient_scenario_conversation_cleanup (provider_conversation_id)
     SELECT unnest($1::text[])
     ON CONFLICT (provider_conversation_id) DO NOTHING`,
    [[cleanupConversationId]]
  )
  const queuedCleanup = await testPool.query(
    `SELECT provider_conversation_id FROM app_patient_scenario_conversation_cleanup
     WHERE provider_conversation_id = $1`,
    [cleanupConversationId]
  )
  if (queuedCleanup.rows[0]?.provider_conversation_id !== cleanupConversationId) {
    throw new Error('Failed setup Conversation cleanup ID did not persist in PostgreSQL')
  }

  tenantId = `phase2-${randomBytes(6).toString('hex')}`
  subjectId = randomUUID()
  const profile = {
    fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
    reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis',
    painHistoryStatus: 'present',
    painEpisodes: [makePainEpisode('pain-1', 'pelvic pain')],
    vitalSigns: {
      currentPulse: 76, pulseIrregular: false, pulseQuality: 'normal',
      bpSitting: { systolic: 118, diastolic: 74 }, bpOrthostaticSupine: null,
      respiratoryRate: 16, axillaryTemp: null, oralTemp: 36.8,
      analTemp: null, dermalTemp: null, auralTemp: null
    },
    physicalExamFindings: {
      lungAuscultation: {
        breathSounds: ['normal'], ralesDistribution: null, rhonchiSeverity: 'none',
        effectOfCoughing: 'not_assessed', accessoryMuscleUse: false, postureTolerance: 'tolerates_supine'
      },
      skinLipsSclera: { skin: 'normal', lips: 'pink', sclera: 'white' }, skinBlanche: 1
    },
    history: [{ field: 'patientConcern', status: 'unknown', value: null }],
    currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
    patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
    persona: {
      mood: 'concerned', maturity: 'adult', verbosity: 'moderate',
      educationLevel: 'college', willingnessToDisclose: 'gradual'
    }
  }
  await testPool.query('INSERT INTO tenants (tenant_id) VALUES ($1)', [tenantId])
  await testPool.query(
    `INSERT INTO tenant_entitlements (tenant_id, sessions_enabled, responses_enabled)
     VALUES ($1, true, true)`,
    [tenantId]
  )
  await testPool.query(
    `INSERT INTO tenant_memberships (tenant_id, subject_id, status, role) VALUES ($1, $2, 'active', 'learner')`,
    [tenantId, subjectId]
  )
  const tokenEntitlementStore = createPostgresTokenEntitlementStore(testPool)
  const bucketNow = new Date()
  const grantId = `verify-grant-${randomBytes(6).toString('hex')}`
  const addonGrantId = `verify-addon-${randomBytes(6).toString('hex')}`
  const grantExpiry = new Date(bucketNow.getTime() + 30 * 86_400_000)
  await testPool.query(
    `INSERT INTO gptmd_token_entitlement_grants (
       grant_id, account_scope, subject_id, bucket_kind, source_kind, source_reference,
       granted_tokens, granted_at, valid_from, renewal_at, expires_at, granted_by
     ) VALUES ($1, 'consumer', $2, 'included', 'subscription_renewal', $3,
               1000, $4, $4, $5, $5, 'phase2-system-admin')`,
    [grantId, subjectId, `verify-renewal-${grantId}`, bucketNow, grantExpiry]
  )
  await testPool.query(
    `INSERT INTO gptmd_token_entitlement_grants (
       grant_id, account_scope, subject_id, bucket_kind, source_kind, source_reference,
       granted_tokens, granted_at, valid_from, renewal_at, expires_at, granted_by
     ) VALUES ($1, 'consumer', $2, 'addon', 'verified_purchase', $3,
               10000, $4::timestamptz, $4::timestamptz, NULL,
               $4::timestamptz + interval '365 days', 'phase2-system-admin')`,
    [addonGrantId, subjectId, `verify-addon-purchase-${addonGrantId}`, bucketNow]
  )

  const allocationTenantId = `allocation-${randomBytes(6).toString('hex')}`
  const allocationAdminId = randomUUID()
  const allocationLearnerId = randomUUID()
  await testPool.query('INSERT INTO tenants (tenant_id) VALUES ($1)', [allocationTenantId])
  await testPool.query(
    `INSERT INTO tenant_memberships (tenant_id, subject_id, status, role)
     VALUES ($1, $2, 'active', 'customer_admin'), ($1, $3, 'active', 'learner')`,
    [allocationTenantId, allocationAdminId, allocationLearnerId]
  )
  const organizationBudgets = createPostgresOrganizationAiTimeBudgetStore(testPool)
  const entitlementBuckets = createPostgresTokenEntitlementStore(testPool)
  const renewalAnchor = new Date(Date.UTC(bucketNow.getUTCFullYear(), bucketNow.getUTCMonth(), 1))
  const allocationSettings = {
    schemaVersion: 1, revision: 0, status: 'active',
    organizationPeriod: { months: 1, anchorDate: renewalAnchor.toISOString().slice(0, 10) },
    organizationPool: { tokens: 12_000, estimatedMinutes: 120 },
    groups: [{
      code: 'gptnursing', name: 'GPT Nursing', tokenBudget: 12_000,
      estimatedMinuteBudget: 120, monthlyTokensPerUser: null, monthlyEstimatedMinutesPerUser: null
    }],
    departments: []
  }
  const initialAllocationSettings = await organizationBudgets.saveSettings(
    allocationTenantId, allocationAdminId, allocationSettings
  )
  if (!initialAllocationSettings || typeof initialAllocationSettings === 'string' || initialAllocationSettings.revision !== 1) {
    throw new Error('Activating corporate group budgets did not atomically issue its initial allocation')
  }
  const learnerAssignment = await organizationBudgets.saveMemberAssignment(
    allocationTenantId, allocationAdminId,
    { subjectId: allocationLearnerId, groupCodes: ['gptnursing'], departmentCode: null }
  )
  if (!learnerAssignment) throw new Error('The corporate allocation test learner could not be assigned by the admin')
  const initialBuckets = await entitlementBuckets.getSubjectBuckets(allocationTenantId, allocationLearnerId)
  if (initialBuckets.length !== 1 || initialBuckets[0]?.grantedTokens !== '12000') {
    throw new Error('The assigned learner did not see the initial organization group allowance')
  }
  const initialGrant = await testPool.query(
    `SELECT grant_id, granted_tokens::text AS granted_tokens,
            renewal_at, expires_at, source_reference
     FROM gptmd_token_entitlement_grants
     WHERE tenant_id = $1 AND group_code = 'gptnursing'
       AND account_scope = 'organization' AND bucket_kind = 'included'`,
    [allocationTenantId]
  )
  const initialGrantRow = initialGrant.rows[0]
  if (!initialGrantRow || initialGrantRow.granted_tokens !== '12000' ||
      initialGrantRow.expires_at.getTime() !== initialGrantRow.renewal_at.getTime() + 45 * 86_400_000) {
    throw new Error('The organization group grant did not retain the configured budget and 45-day expiry')
  }

  const increasedSettings = await organizationBudgets.saveSettings(allocationTenantId, allocationAdminId, {
    ...initialAllocationSettings,
    organizationPool: { tokens: 15_000, estimatedMinutes: 150 },
    groups: [{ ...initialAllocationSettings.groups[0], tokenBudget: 15_000, estimatedMinuteBudget: 150 }]
  })
  if (!increasedSettings || typeof increasedSettings === 'string') throw new Error('Increasing the active group allowance failed')
  const reducedSettings = await organizationBudgets.saveSettings(allocationTenantId, allocationAdminId, {
    ...increasedSettings,
    organizationPool: { tokens: 10_000, estimatedMinutes: 100 },
    groups: [{ ...increasedSettings.groups[0], tokenBudget: 10_000, estimatedMinuteBudget: 100 }]
  })
  if (!reducedSettings || typeof reducedSettings === 'string') throw new Error('Reducing unused group allowance failed')
  const adjustedGrants = await testPool.query(
    `SELECT grant_id, granted_tokens::text AS granted_tokens
     FROM gptmd_token_entitlement_grants
     WHERE tenant_id = $1 AND group_code = 'gptnursing' AND renewal_at = $2
     ORDER BY granted_tokens DESC`,
    [allocationTenantId, initialGrantRow.renewal_at]
  )
  const reductionEntries = await testPool.query(
    `SELECT grant_id, token_delta::text AS token_delta
     FROM gptmd_token_entitlement_entries
     WHERE grant_id = ANY($1::text[]) AND entry_kind = 'allocation_adjustment'`,
    [adjustedGrants.rows.map((row) => row.grant_id)]
  )
  if (adjustedGrants.rows.length !== 2 ||
      adjustedGrants.rows.reduce((sum, row) => sum + BigInt(row.granted_tokens), 0n) !== 15_000n ||
      reductionEntries.rows.reduce((sum, row) => sum + BigInt(row.token_delta), 0n) !== -5_000n) {
    throw new Error('Active group allocation increase/reduction did not reconcile through append-only ledger entries')
  }
  const orderedGrantIds = adjustedGrants.rows.map((row) => row.grant_id)
  await testPool.query(
    `INSERT INTO gptmd_token_entitlement_entries (
       entry_id, grant_id, entry_kind, token_delta, source_reference, occurred_at
     ) VALUES ($1, $2, 'usage_debit', -7000, $3, $4),
              ($5, $6, 'usage_debit', -2000, $7, $4)`,
    [randomUUID(), orderedGrantIds[0], `allocation-usage-a-${randomUUID()}`, bucketNow,
      randomUUID(), orderedGrantIds[1], `allocation-usage-b-${randomUUID()}`]
  )
  const refusedReduction = await organizationBudgets.saveSettings(allocationTenantId, allocationAdminId, {
    ...reducedSettings,
    organizationPool: { tokens: 8_000, estimatedMinutes: 80 },
    groups: [{ ...reducedSettings.groups[0], tokenBudget: 8_000, estimatedMinuteBudget: 80 }]
  })
  if (refusedReduction !== 'allocation_below_usage') {
    throw new Error('The organization budget accepted a reduction below already settled provider usage')
  }

  const nextRenewal = initialGrantRow.renewal_at
  const nextPeriodEnd = new Date(Date.UTC(
    nextRenewal.getUTCFullYear(), nextRenewal.getUTCMonth() + 1, 1
  ))
  const renewedBuckets = await entitlementBuckets.getSubjectBuckets(allocationTenantId, allocationLearnerId, nextRenewal)
  const repeatedRenewedBuckets = await entitlementBuckets.getSubjectBuckets(allocationTenantId, allocationLearnerId, nextRenewal)
  const renewedGrantCount = await testPool.query(
    `SELECT count(*)::int AS count FROM gptmd_token_entitlement_grants
     WHERE tenant_id = $1 AND group_code = 'gptnursing' AND renewal_at = $2`,
    [allocationTenantId, nextPeriodEnd]
  )
  if (renewedBuckets.length !== 3 || repeatedRenewedBuckets.length !== 3 || renewedGrantCount.rows[0]?.count !== 1) {
    throw new Error('The learner balance refresh did not issue one idempotent next-period group grant with 45-day carryover')
  }

  const stateStore = createRedisPatientStateStore(redis)
  const principal = { tenantId, subjectId, role: 'learner' }
  const sessionStore = createPostgresSessionStore(testPool, stateStore)
  const providerTokenReservations = createPostgresProviderTokenReservationStore(testPool)
  const sessionArchiveStore = createPostgresSessionArchiveStore(testPool)
  const sessionArchiveErrors = []
  const sessionArchiveWorker = createSessionArchiveWorker(testPool, {
    onError: (error) => sessionArchiveErrors.push(error instanceof Error ? error.message : 'unknown')
  })
  const webPort = await getFreePort()
  const upstreamPort = await getFreePort()
  const webOrigin = `https://localhost:${webPort}`
  const testIssuer = `${supabaseOrigin}/auth/v1`
  const testKeyId = 'phase2-verifier-es256-key'
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const publicJwk = { ...await exportJWK(publicKey), kid: testKeyId, alg: 'ES256', use: 'sig' }
  const jwksPort = await getFreePort()
  const jwksUrl = `http://127.0.0.1:${jwksPort}/auth/v1/.well-known/jwks.json`
  jwksServer = createHttpServer((request, response) => {
    if (request.url !== '/auth/v1/.well-known/jwks.json') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' })
    response.end(JSON.stringify({ keys: [publicJwk] }))
  })
  jwksServer.listen(jwksPort, '127.0.0.1')
  await once(jwksServer, 'listening')
  const tokenIssuedAt = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({
    tenant_id: tenantId, role: 'authenticated', email: 'phase2-browser@example.test'
  })
    .setProtectedHeader({ alg: 'ES256', kid: testKeyId, typ: 'JWT' })
    .setIssuer(testIssuer)
    .setAudience('authenticated')
    .setSubject(subjectId)
    .setIssuedAt(tokenIssuedAt)
    .setExpirationTime(tokenIssuedAt + 3600)
    .sign(privateKey)
  const setupUsage = {
    responseId: `resp-setup-${randomBytes(6).toString('hex')}`,
    model: 'gpt-6-luna', serviceTier: 'default',
    inputTokens: 900, cachedInputTokens: 0, cacheWriteTokens: 0,
    outputTokens: 300, totalTokens: 1200, durationMs: 3420,
    pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000240000000'
  }
  const patientTurnUsage = {
    responseId: `resp-${randomBytes(6).toString('hex')}`,
    model: 'gpt-6-luna', serviceTier: 'default',
    inputTokens: 120,
    cachedInputTokens: 20,
    cacheWriteTokens: 0,
    outputTokens: 30,
    totalTokens: 150,
    durationMs: 842,
    pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000025200000'
  }
  let scenarioGenerationCount = 0
  const patientTurnGenerationCounts = new Map()
  const generatedScenarios = new Map()
  apiServer = createApiApp({
    redis: { get isOpen() { return redis.isOpen }, connect: () => redis.connect(), ping: () => redis.ping() },
    postgres: { query: () => testPool.query('SELECT 1') },
    openaiConfigured: true,
    generateResponse: null,
    reserveProviderTokens: (input) => providerTokenReservations.reserve(input),
    sessionArchiveStore,
    tokenEntitlementStore,
    generatePatientScenario: async (versions, asOf, scenarioSeed, _recordTiming, _recordUsage, reserveTokens) => {
      if (versions.promptVersion !== PATIENT_SCENARIO_PROMPT_VERSION ||
          versions.modelVersion !== 'gpt-6-luna' ||
          versions.schemaVersion !== PATIENT_SCENARIO_SCHEMA_VERSION ||
          versions.policyVersion !== PATIENT_SCENARIO_POLICY_VERSION || !(asOf instanceof Date) ||
          !/^[A-Za-z0-9_-]{43}$/.test(scenarioSeed)) {
        throw new Error('Setup did not pin the current prompt, model, schema, policy, encounter date, and opaque variation seed')
      }
      scenarioGenerationCount += 1
      const setupGeneration = scenarioGenerationCount
      const conversationId = setupGeneration === 1
        ? 'verification-conversation'
        : `verification-conversation-${setupGeneration}`
      const usage = setupGeneration === 1
        ? setupUsage
        : { ...setupUsage, responseId: `${setupUsage.responseId}-${setupGeneration}` }
      const reservation = await reserveTokens?.(900, 8_192)
      const addonTokensUsed = await reservation?.settle(usage.responseId, usage.totalTokens) ?? false
      generatedScenarios.set(scenarioSeed, { conversationId, usage })
      return {
        profile, conversationId, responseId: usage.responseId,
        usage, addonTokensUsed, abandonedConversationIds: []
      }
    },
    generatePatientTurn: async (context, _recordTiming, reserveTokens) => {
      if (context.versions.schemaVersion !== PATIENT_TURN_SCHEMA_VERSION ||
          !context.conversationId.startsWith('verification-conversation') ||
          context.learnerMessage !== 'What is your biggest concern?') {
        throw new Error('The patient-turn route did not receive the pinned scenario Conversation and learner question')
      }
      const conversationTurnCount = (patientTurnGenerationCounts.get(context.conversationId) ?? 0) + 1
      patientTurnGenerationCounts.set(context.conversationId, conversationTurnCount)
      const usage = context.conversationId === 'verification-conversation'
        ? patientTurnUsage
        : { ...patientTurnUsage, responseId: `${patientTurnUsage.responseId}-${context.scenarioId}` }
      const reservation = await reserveTokens?.(120, 1_024)
      await reservation?.settle(usage.responseId, usage.totalTokens)
      return {
        responseId: usage.responseId,
        output: {
          patientResponse: 'I am worried about what is causing the pain.',
          proposedFacts: [{ field: 'patientConcern', value: 'I am worried about what is causing the pain.' }],
          historyCoverage: ['patientConcern'],
          disclosedHistoryFields: ['patientConcern'],
          painHistoryCoverage: [],
          painDisclosures: [],
          proposedPainFacts: []
        },
        providerUsage: usage
      }
    },
    createTranscriptionCall: null,
    hangupTranscriptionCall: null,
    model: 'gpt-6-luna',
    jwt: { secret: null, issuer: testIssuer, audience: 'authenticated', jwksUrl },
    sessionStore,
    requestRateLimitStore: createRedisRequestRateLimitStore(redis),
    allowedOrigins: [webOrigin]
  }).listen(apiPort, '127.0.0.1')
  await once(apiServer, 'listening')
  const address = apiServer.address()
  if (!address || typeof address === 'string') throw new Error('Setup verification API did not bind to a TCP port')
  if (address.port !== apiPort) throw new Error('Setup verification API bound to an unexpected port')
  const authHeaders = { authorization: `Bearer ${token}`, 'x-gptmd-tenant-id': tenantId }
  const membershipsResponse = await fetch(`${apiBase}/api/account/tenants`, {
    headers: { authorization: `Bearer ${token}` }
  })
  const memberships = await membershipsResponse.json()
  if (membershipsResponse.status !== 200 ||
      JSON.stringify(memberships.memberships) !== JSON.stringify([{
        tenantId, role: 'learner', sessionsEnabled: true, responsesEnabled: true,
        audioTranscriptionAvailable: false
      }])) {
    throw new Error(
      `Supabase-style ES256 authentication could not resolve the active learner tenant membership ` +
      `(HTTP ${membershipsResponse.status}; response=${JSON.stringify(memberships)})`
    )
  }
  const forgedToken = `${token.slice(0, token.lastIndexOf('.') + 1)}${randomBytes(32).toString('base64url')}`
  const forgedTokenResponse = await fetch(`${apiBase}/api/account/tenants`, {
    headers: { authorization: `Bearer ${forgedToken}` }
  })
  if (forgedTokenResponse.status !== 401) {
    throw new Error('The real Express API accepted a token with a forged ES256 signature')
  }
  const createdResponse = await fetch(`${apiBase}/api/sessions`, { method: 'POST', headers: authHeaders })
  const createdSession = await createdResponse.json()
  if (createdResponse.status !== 201 || createdSession.status !== 'initializing' ||
      !/^[A-Za-z0-9_-]{43}$/.test(createdSession.sessionId ?? '') ||
      createdSession.versions?.promptVersion !== PATIENT_SCENARIO_PROMPT_VERSION ||
      createdSession.versions?.modelVersion !== 'gpt-6-luna' ||
      createdSession.versions?.schemaVersion !== PATIENT_SCENARIO_SCHEMA_VERSION ||
      createdSession.versions?.policyVersion !== PATIENT_SCENARIO_POLICY_VERSION) {
    throw new Error(`API did not create the authenticated session: ${JSON.stringify(createdSession)}`)
  }
  sessionId = createdSession.sessionId
  const storedIdentity = await testPool.query(
    `SELECT patient_profile_id FROM app_sessions WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
    [sessionId, tenantId, subjectId]
  )
  patientProfileId = storedIdentity.rows[0]?.patient_profile_id
  if (!patientProfileId) throw new Error('PostgreSQL did not persist the reserved patient-profile ID')

  const setupKey = `verify-setup-${randomBytes(6).toString('hex')}`
  const sendSetup = () => fetch(`${apiBase}/api/sessions/${sessionId}/setup`, {
    method: 'POST', headers: { ...authHeaders, 'idempotency-key': setupKey }
  })
  const setupResponse = await sendSetup()
  const setup = await setupResponse.json()
  if (setupResponse.status !== 200 || setup.status !== 'ready' || setup.sessionId !== sessionId ||
      setup.readiness?.profile !== true || setup.readiness?.redis !== true ||
      setup.readiness?.conversation !== true || setup.patient?.fullName !== profile.fullName ||
      setup.addonSpendNotice !== true ||
      setup.patient?.dateOfBirth !== profile.dateOfBirth || setup.patient?.reasonForVisit !== profile.reasonForVisit ||
      Object.hasOwn(setup.patient ?? {}, 'diagnosis')) {
    throw new Error(`API setup did not return the learner-safe ready profile: ${JSON.stringify(setup)}`)
  }
  const scenarioRow = await testPool.query(
    `SELECT scenario_id, profile_digest, provider_conversation_id, prompt_version,
            model_version, schema_version, policy_version
     FROM patient_scenarios WHERE session_id = $1`, [sessionId]
  )
  const liveSetup = await stateStore.read(sessionId)
  if (scenarioRow.rows.length !== 1 || scenarioRow.rows[0]?.scenario_id !== patientProfileId ||
      scenarioRow.rows[0]?.provider_conversation_id !== 'verification-conversation' ||
      scenarioRow.rows[0]?.prompt_version !== PATIENT_SCENARIO_PROMPT_VERSION ||
      scenarioRow.rows[0]?.model_version !== 'gpt-6-luna' ||
      scenarioRow.rows[0]?.schema_version !== PATIENT_SCENARIO_SCHEMA_VERSION ||
      scenarioRow.rows[0]?.policy_version !== PATIENT_SCENARIO_POLICY_VERSION ||
      liveSetup?.state.status !== 'ready' || liveSetup.patientProfileId !== patientProfileId ||
      liveSetup.conversationId !== 'verification-conversation' ||
      liveSetup.profileDigest !== scenarioRow.rows[0]?.profile_digest ||
      liveSetup.setupProjection.fullName !== profile.fullName) {
    throw new Error('Scenario, Conversation ID, and learner setup projection did not persist across PostgreSQL and Redis')
  }
  const identityRows = await testPool.query(
    `SELECT session_id, tenant_id, subject_id, patient_profile_id, provider_conversation_id,
            scenario_fingerprint, schema_version
     FROM session_identity_binding WHERE session_id = $1`,
    [sessionId]
  )
  const identity = identityRows.rows[0]
  if (identityRows.rows.length !== 1 || identity?.session_id !== sessionId ||
      identity?.tenant_id !== tenantId || identity?.subject_id !== subjectId ||
      identity?.patient_profile_id !== patientProfileId ||
      identity?.provider_conversation_id !== 'verification-conversation' ||
      identity?.scenario_fingerprint !== scenarioRow.rows[0]?.profile_digest ||
      Number(identity?.schema_version) !== PATIENT_SCENARIO_SCHEMA_VERSION) {
    throw new Error('PostgreSQL did not persist the complete immutable session identity and scenario fingerprint')
  }
  const identityWorker = createSessionIdentityVerificationWorker(testPool, stateStore, {
    verificationIntervalSeconds: 900
  })
  const identityMetrics = await identityWorker.verifyOnce()
  const verifiedIdentity = await testPool.query(
    `SELECT last_verification_status FROM session_identity_binding WHERE session_id = $1`, [sessionId]
  )
  if (identityMetrics.checked !== 1 || identityMetrics.verified !== 1 ||
      verifiedIdentity.rows[0]?.last_verification_status !== 'verified') {
    throw new Error('Periodic identity verification did not match the PostgreSQL binding against Redis live state')
  }
  const immutableProfile = await testPool.query(
    `SELECT profile_json->>'diagnosis' AS diagnosis FROM patient_scenarios WHERE session_id = $1`, [sessionId]
  )
  if (immutableProfile.rows[0]?.diagnosis !== profile.diagnosis) {
    throw new Error('Clinician-only diagnosis did not remain in the private immutable scenario')
  }
  const duplicateSetupResponse = await sendSetup()
  const duplicateSetup = await duplicateSetupResponse.json()
  if (duplicateSetupResponse.status !== 200 || JSON.stringify(duplicateSetup) !== JSON.stringify(setup) ||
      scenarioGenerationCount !== 1) {
    throw new Error('Same-key setup retry did not return the stored scenario without regeneration')
  }
  const duplicateIdentityCount = await testPool.query(
    `SELECT count(*)::int AS count FROM session_identity_binding WHERE session_id = $1`, [sessionId]
  )
  if (duplicateIdentityCount.rows[0]?.count !== 1) {
    throw new Error('Same-key setup retry duplicated or lost the immutable session identity binding')
  }
  await testPool.query(
    `UPDATE tenant_entitlements
     SET audio_transcription_enabled = true,
         audio_transcription_privacy_approved = true,
         monthly_audio_transcription_session_quota = 3
     WHERE tenant_id = $1`,
    [tenantId]
  )
  const audioGrant = await sessionStore.createAudioTranscriptionGrant(
    principal, sessionId, 'gptmd-audio-transcription-v1'
  )
  if (typeof audioGrant === 'string') throw new Error(`Audio grant setup failed in isolated verifier: ${audioGrant}`)
  const audioCallId = `rtc_${randomBytes(8).toString('hex')}`
  await sessionStore.recordAudioProviderSession(audioGrant.grantId, 'realtime-session-verifier', audioCallId)
  await sessionStore.recordAudioTranscriptionUsage(audioCallId, 'event_usage_verifier', 2.75)
  await sessionStore.recordAudioTranscriptionUsage(audioCallId, 'event_usage_verifier', 2.75)
  await sessionStore.setAudioUsageObserverStatus(audioCallId, 'connected')
  const audioUsage = await testPool.query(
    `SELECT audio.usage_observer_status, audio.provider_audio_seconds,
            count(events.provider_event_id)::int AS event_count
     FROM app_audio_transcription_sessions AS audio
     LEFT JOIN app_audio_transcription_usage_events AS events USING (grant_id)
     WHERE audio.grant_id = $1
     GROUP BY audio.grant_id`,
    [audioGrant.grantId]
  )
  if (audioUsage.rows[0]?.usage_observer_status !== 'connected' ||
      Number(audioUsage.rows[0]?.provider_audio_seconds) !== 2.75 ||
      audioUsage.rows[0]?.event_count !== 1) {
    throw new Error('Provider transcription duration was not stored exactly once with observer state')
  }
  await sessionStore.setAudioUsageObserverStatus(audioCallId, 'interrupted')
  const interruptedAudioUsage = await testPool.query(
    `SELECT usage_observer_status FROM app_audio_transcription_sessions WHERE grant_id = $1`,
    [audioGrant.grantId]
  )
  if (interruptedAudioUsage.rows[0]?.usage_observer_status !== 'interrupted') {
    throw new Error('Audio usage observer interruption was not persisted')
  }
  const readySessionResponse = await fetch(`${apiBase}/api/sessions/${sessionId}`, { headers: authHeaders })
  const readySession = await readySessionResponse.json()
  if (readySessionResponse.status !== 200 || readySession.status !== 'ready' ||
      readySession.sessionId !== sessionId ||
      readySession.versions?.promptVersion !== PATIENT_SCENARIO_PROMPT_VERSION ||
      readySession.versions?.modelVersion !== 'gpt-6-luna' ||
      readySession.versions?.schemaVersion !== PATIENT_SCENARIO_SCHEMA_VERSION ||
      readySession.versions?.policyVersion !== PATIENT_SCENARIO_POLICY_VERSION) {
    throw new Error('Authenticated setup read did not return the stored ready session')
  }
  const currentEncounterResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const currentEncounter = await currentEncounterResponse.json()
  if (currentEncounterResponse.status !== 200 || currentEncounter.encounter?.sessionId !== sessionId ||
      currentEncounter.encounter?.status !== 'ready' ||
      currentEncounter.encounter?.patient?.fullName !== profile.fullName ||
      Object.hasOwn(currentEncounter.encounter ?? {}, 'conversationId') ||
      Object.hasOwn(currentEncounter.encounter?.patient ?? {}, 'diagnosis')) {
    throw new Error('Owner-scoped current-encounter lookup did not resume the learner-safe ready session')
  }
  const ownerIndexKey = `gptmd:owner-session:${createHash('sha256').update(`${tenantId}\0${subjectId}`).digest('hex')}`
  await redis.sendCommand(['DEL', `gptmd:session:${sessionId}`, `gptmd:patient:${patientProfileId}`, `gptmd:retries:${sessionId}`, ownerIndexKey])
  const resumedAfterLossResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const resumedAfterLoss = await resumedAfterLossResponse.json()
  const restoredLiveState = await stateStore.read(sessionId)
  if (resumedAfterLossResponse.status !== 200 || resumedAfterLoss.encounter?.sessionId !== sessionId ||
      resumedAfterLoss.encounter?.status !== 'ready' ||
      restoredLiveState?.patientProfileId !== patientProfileId ||
      restoredLiveState?.conversationId !== 'verification-conversation' ||
      restoredLiveState?.profileDigest !== scenarioRow.rows[0]?.profile_digest) {
    throw new Error('Current-encounter resume did not rebuild the same Redis session identity from PostgreSQL')
  }
  const worker = createSessionEventWorker(redis, testPool, { consumerName: `verify-${process.pid}`, blockMs: 1 })
  await worker.ensureGroup()
  const setupUsageEvents = await worker.processOnce()
  if (setupUsageEvents !== 1) {
    const streamLength = await redis.sendCommand(['XLEN', streamKey])
    throw new Error(`Setup provider-usage event was not persisted exactly once: processed=${setupUsageEvents}, streamLength=${streamLength}`)
  }
  const durableSetupUsage = await testPool.query(
    `SELECT operation, provider_response_id, input_tokens, output_tokens
     FROM provider_usage WHERE session_id = $1 AND provider_response_id = $2`,
    [sessionId, setupUsage.responseId]
  )
  if (durableSetupUsage.rows.length !== 1 ||
      durableSetupUsage.rows[0]?.operation !== 'scenario_generation' ||
      Number(durableSetupUsage.rows[0]?.input_tokens) !== setupUsage.inputTokens ||
      Number(durableSetupUsage.rows[0]?.output_tokens) !== setupUsage.outputTokens) {
    throw new Error('Scenario-generation usage did not persist from setup through Redis and the PostgreSQL worker')
  }
  await assertPersistedStreamEntriesWereTrimmed('setup usage')
  const turnId = `turn-${randomBytes(6).toString('hex')}`
  const learnerMessage = 'What is your biggest concern?'
  const submitTurn = (text = learnerMessage) => fetch(`${apiBase}/api/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ turnId, text, modality: 'realtime_transcription' })
  })
  const acceptedTurnResponse = await submitTurn()
  const acceptedTurnResult = await acceptedTurnResponse.json()
  if (acceptedTurnResponse.status !== 200 || acceptedTurnResult.turnId !== turnId ||
      acceptedTurnResult.text !== 'I am worried about what is causing the pain.' ||
      acceptedTurnResult.addonSpendNotice !== true) {
    throw new Error(`Authenticated Express turn route returned status ${acceptedTurnResponse.status}: ${JSON.stringify(acceptedTurnResult)}`)
  }
  const duplicateTurnResponse = await submitTurn()
  const duplicateTurnResult = await duplicateTurnResponse.json()
  if (duplicateTurnResponse.status !== 200 || JSON.stringify(duplicateTurnResult) !== JSON.stringify(acceptedTurnResult) ||
      patientTurnGenerationCounts.get('verification-conversation') !== 1) {
    throw new Error('Retrying the same API turn did not return its saved reply without regenerating it')
  }
  const conflictingTurnResponse = await submitTurn('Tell me something different.')
  if (conflictingTurnResponse.status !== 409 || patientTurnGenerationCounts.get('verification-conversation') !== 1) {
    throw new Error('Reusing an API turn ID with different learner input was not rejected before generation')
  }
  const acknowledgedNoticeResponse = await fetch(
    `${apiBase}/api/sessions/${sessionId}/addon-spend-notice/acknowledge`,
    { method: 'POST', headers: authHeaders }
  )
  const afterAcknowledgmentResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const afterAcknowledgment = await afterAcknowledgmentResponse.json()
  if (acknowledgedNoticeResponse.status !== 204 || afterAcknowledgmentResponse.status !== 200 ||
      afterAcknowledgment.encounter?.addonSpendNotice !== false) {
    throw new Error('Learner acknowledgment did not persist against its owned session through encounter restore')
  }
  const live = await stateStore.read(sessionId)
  const turn = live?.acceptedTurns[0]
  if (!turn || live.acceptedTurns.length !== 1 || live.state.currentTurnSequence !== 1 ||
      turn.learnerMessage !== learnerMessage || turn.disclosedHistoryFields[0] !== 'patientConcern') {
    throw new Error('Authenticated API turn did not update Redis state and disclose the asked patient fact exactly once')
  }

  if (await worker.processOnce() !== 2) throw new Error('Event worker did not persist the accepted turn and disclosure events')
  const transcript = await testPool.query(
    `SELECT turn_id, sequence, utterance_index, speaker, occurred_at, phase, modality, content
     FROM session_transcript WHERE session_id = $1 ORDER BY sequence, utterance_index`, [sessionId]
  )
  if (transcript.rows.length !== 2 ||
      transcript.rows[0]?.speaker !== 'learner' || transcript.rows[0]?.modality !== 'realtime_transcription' ||
      transcript.rows[0]?.content !== turn.learnerMessage ||
      transcript.rows[1]?.speaker !== 'patient' || transcript.rows[1]?.modality !== 'text' ||
      transcript.rows[1]?.content !== turn.patientResponse ||
      transcript.rows.some((row) => row.phase !== 'history' || row.turn_id !== turn.turnId ||
        Number(row.sequence) !== turn.sequence || new Date(row.occurred_at).toISOString() !== turn.acceptedAt)) {
    throw new Error('Durable transcript projection did not preserve speaker, time, phase, modality, and turn ID')
  }
  await assertPersistedStreamEntriesWereTrimmed('accepted turn and disclosure')
  const localUtteranceId = randomUUID()
  const localUtteranceRequest = {
    utteranceId: localUtteranceId, kind: 'repair', speaker: 'learner', content: 'Could you repeat that?'
  }
  const saveLocalUtterance = () => fetch(`${apiBase}/api/sessions/${sessionId}/local-utterances`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(localUtteranceRequest)
  })
  const savedLocalUtteranceResponse = await saveLocalUtterance()
  const savedLocalUtterance = await savedLocalUtteranceResponse.json()
  if (savedLocalUtteranceResponse.status !== 200 || savedLocalUtterance.utteranceId !== localUtteranceId ||
      savedLocalUtterance.sequence !== 1 || savedLocalUtterance.ordinal !== 1 ||
      savedLocalUtterance.phase !== 'history' || savedLocalUtterance.modality !== 'realtime_transcription') {
    throw new Error('Owner-scoped local voice repair was not recorded with its live turn order and transcript metadata')
  }
  const duplicateLocalUtteranceResponse = await saveLocalUtterance()
  const duplicateLocalUtterance = await duplicateLocalUtteranceResponse.json()
  if (duplicateLocalUtteranceResponse.status !== 200 ||
      JSON.stringify(duplicateLocalUtterance) !== JSON.stringify(savedLocalUtterance)) {
    throw new Error('Retrying a local voice utterance did not return the same durable record')
  }
  const conflictLocalUtteranceResponse = await fetch(`${apiBase}/api/sessions/${sessionId}/local-utterances`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ ...localUtteranceRequest, content: 'Please repeat that.' })
  })
  if (conflictLocalUtteranceResponse.status !== 409) {
    throw new Error('Reusing a local utterance ID with different content was not rejected')
  }
  const transcriptWithLocalUtterance = await testPool.query(
    `SELECT turn_id, sequence, utterance_index, speaker, phase, modality, content
     FROM session_transcript WHERE session_id = $1 ORDER BY sequence, utterance_index`, [sessionId]
  )
  const restoredWithLocalUtterance = await sessionStore.getCurrentOwnedEncounter(principal)
  if (transcriptWithLocalUtterance.rows.length !== 3 ||
      transcriptWithLocalUtterance.rows[2]?.turn_id !== localUtteranceId ||
      Number(transcriptWithLocalUtterance.rows[2]?.utterance_index) !== 3 ||
      transcriptWithLocalUtterance.rows[2]?.content !== localUtteranceRequest.content ||
      restoredWithLocalUtterance?.localUtterances[0]?.utteranceId !== localUtteranceId) {
    throw new Error('The durable transcript or owner restore omitted the local voice utterance')
  }
  await redis.sendCommand(['DEL', `gptmd:session:${sessionId}`, `gptmd:patient:${patientProfileId}`, `gptmd:retries:${sessionId}`])
  const localUtteranceRecoveryResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const localUtteranceRecovery = await localUtteranceRecoveryResponse.json()
  if (localUtteranceRecoveryResponse.status !== 200 ||
      localUtteranceRecovery.encounter?.localUtterances?.[0]?.utteranceId !== localUtteranceId) {
    throw new Error('Current-encounter recovery did not restore the local voice utterance from PostgreSQL')
  }
  const turnEnvelope = {
    eventId: turn.turnId, sessionId, sequence: 1, eventOrdinal: 0, eventType: 'accepted_turn',
    occurredAt: turn.acceptedAt, providerUsage: [patientTurnUsage], payload: turn
  }
  await redis.sendCommand(['XADD', streamKey, '*', 'event', JSON.stringify(turnEnvelope)])
  if (await worker.processOnce() !== 1) throw new Error('Worker did not acknowledge the idempotent PostgreSQL retry')
  await assertPersistedStreamEntriesWereTrimmed('idempotent PostgreSQL retry')
  const durableTurnCount = await testPool.query(
    `SELECT count(*)::int AS count FROM session_events WHERE session_id = $1`, [sessionId]
  )
  if (durableTurnCount.rows[0]?.count !== 2) throw new Error('Worker retry duplicated a PostgreSQL turn or disclosure event')
  const durableTurnUsage = await testPool.query(
    `SELECT provider_response_id, operation, model_id, service_tier, input_tokens,
            cached_input_tokens, cache_write_tokens, output_tokens, total_tokens,
            estimated_cost_usd, pricing_version, duration_ms
     FROM provider_usage WHERE session_id = $1 AND event_id = $2`, [sessionId, turnId]
  )
  if (durableTurnUsage.rows.length !== 1 ||
      durableTurnUsage.rows[0]?.provider_response_id !== patientTurnUsage.responseId ||
      durableTurnUsage.rows[0]?.operation !== 'patient_turn' ||
      durableTurnUsage.rows[0]?.model_id !== patientTurnUsage.model ||
      durableTurnUsage.rows[0]?.service_tier !== patientTurnUsage.serviceTier ||
      Number(durableTurnUsage.rows[0]?.input_tokens) !== patientTurnUsage.inputTokens ||
      Number(durableTurnUsage.rows[0]?.cached_input_tokens) !== patientTurnUsage.cachedInputTokens ||
      Number(durableTurnUsage.rows[0]?.cache_write_tokens) !== patientTurnUsage.cacheWriteTokens ||
      Number(durableTurnUsage.rows[0]?.output_tokens) !== patientTurnUsage.outputTokens ||
      Number(durableTurnUsage.rows[0]?.total_tokens) !== patientTurnUsage.totalTokens ||
      Number(durableTurnUsage.rows[0]?.estimated_cost_usd).toFixed(12) !== patientTurnUsage.estimatedCostUsd ||
      durableTurnUsage.rows[0]?.pricing_version !== patientTurnUsage.pricingVersion ||
      Number(durableTurnUsage.rows[0]?.duration_ms) !== patientTurnUsage.durationMs) {
    throw new Error('Patient-turn provider usage was not durably recorded exactly once')
  }

  const scenarioGenerationUsage = {
    responseId: `resp-${randomBytes(6).toString('hex')}`,
    model: 'gpt-6-luna', serviceTier: 'default',
    inputTokens: 900,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 300,
    totalTokens: 1200,
    durationMs: 3420,
    pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000240000000'
  }
  const scenarioUsageEvent = {
    eventId: `usage_${createHash('sha256').update(`openai\0${scenarioGenerationUsage.responseId}`).digest('hex')}`,
    sessionId,
    eventType: 'provider_usage',
    operation: 'scenario_generation',
    occurredAt: new Date().toISOString(),
    usage: scenarioGenerationUsage
  }
  await stateStore.appendProviderUsage(scenarioUsageEvent)
  if (await worker.processOnce() !== 1) throw new Error('Worker did not persist the scenario-generation usage event')
  const durableScenarioUsage = await testPool.query(
    `SELECT operation, model_id, service_tier, input_tokens, cached_input_tokens,
            cache_write_tokens, output_tokens, total_tokens, estimated_cost_usd,
            pricing_version, duration_ms
     FROM provider_usage WHERE session_id = $1 AND provider_response_id = $2`,
    [sessionId, scenarioGenerationUsage.responseId]
  )
  if (durableScenarioUsage.rows.length !== 1 ||
      durableScenarioUsage.rows[0]?.operation !== 'scenario_generation' ||
      durableScenarioUsage.rows[0]?.model_id !== scenarioGenerationUsage.model ||
      durableScenarioUsage.rows[0]?.service_tier !== scenarioGenerationUsage.serviceTier ||
      Number(durableScenarioUsage.rows[0]?.input_tokens) !== scenarioGenerationUsage.inputTokens ||
      Number(durableScenarioUsage.rows[0]?.cached_input_tokens) !== scenarioGenerationUsage.cachedInputTokens ||
      Number(durableScenarioUsage.rows[0]?.cache_write_tokens) !== scenarioGenerationUsage.cacheWriteTokens ||
      Number(durableScenarioUsage.rows[0]?.output_tokens) !== scenarioGenerationUsage.outputTokens ||
      Number(durableScenarioUsage.rows[0]?.total_tokens) !== scenarioGenerationUsage.totalTokens ||
      Number(durableScenarioUsage.rows[0]?.estimated_cost_usd).toFixed(12) !== scenarioGenerationUsage.estimatedCostUsd ||
      durableScenarioUsage.rows[0]?.pricing_version !== scenarioGenerationUsage.pricingVersion ||
      Number(durableScenarioUsage.rows[0]?.duration_ms) !== scenarioGenerationUsage.durationMs) {
    throw new Error('Scenario-generation provider usage was not durably recorded exactly once')
  }

  const auditEvent = {
    eventId: randomUUID(), sessionId, eventType: 'patient_turn_validation_failure',
    occurredAt: new Date().toISOString(),
    payload: { turnIdHash: createHash('sha256').update(`failed-${randomUUID()}`).digest('hex'), attemptCount: 2 }
  }
  await stateStore.appendAuditEvent(auditEvent)
  if (await worker.processOnce() !== 1) throw new Error('Event worker did not persist the turn audit event')
  const durableAudit = await testPool.query(
    `SELECT session_id, turn_id_hash, event_type, attempt_count FROM session_turn_audits WHERE audit_id = $1`,
    [auditEvent.eventId]
  )
  if (durableAudit.rows[0]?.session_id !== sessionId ||
      durableAudit.rows[0]?.turn_id_hash !== auditEvent.payload.turnIdHash ||
      durableAudit.rows[0]?.event_type !== auditEvent.eventType ||
      durableAudit.rows[0]?.attempt_count !== auditEvent.payload.attemptCount) {
    throw new Error('Turn audit metadata did not persist through the Redis worker')
  }

  if (await sessionStore.beginAssessment(principal, sessionId) !== 'assessment') {
    throw new Error('Redis assessment phase transition was not accepted')
  }
  const phaseState = await stateStore.read(sessionId)
  if (phaseState?.state.phase !== 'assessment') {
    throw new Error('Redis assessment phase state could not be read after the transition')
  }
  const draftFields = {
    summary: 'Pelvic pain began yesterday.',
    differential: '',
    rationale: 'The onset is acute.',
    plan: ''
  }
  const saveDraft = (revision, fields) => fetch(`${apiBase}/api/sessions/${sessionId}/assessment-draft`, {
    method: 'PUT',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ revision, ...fields })
  })
  const savedDraftResponse = await saveDraft(1, draftFields)
  const savedDraft = await savedDraftResponse.json()
  if (savedDraftResponse.status !== 200 || savedDraft.revision !== 1 ||
      savedDraft.fields.summary !== draftFields.summary || savedDraft.fields.differential !== '') {
    throw new Error('An incomplete assessment draft was not saved with its revision')
  }
  const latestDraftFields = { ...draftFields, plan: 'Assess further.' }
  const updatedDraftResponse = await saveDraft(2, latestDraftFields)
  const updatedDraft = await updatedDraftResponse.json()
  if (updatedDraftResponse.status !== 200 || updatedDraft.revision !== 2 || updatedDraft.fields.plan !== latestDraftFields.plan) {
    throw new Error('A newer assessment draft revision did not replace the earlier draft')
  }
  const staleDraftResponse = await saveDraft(1, draftFields)
  const staleDraft = await staleDraftResponse.json()
  if (staleDraftResponse.status !== 200 || staleDraft.revision !== 2 || staleDraft.fields.plan !== latestDraftFields.plan) {
    throw new Error('A late stale assessment draft overwrote the newest revision')
  }
  const restoredDraft = await sessionStore.getCurrentOwnedEncounter(principal)
  if (restoredDraft?.assessmentDraft?.revision !== 2 ||
      restoredDraft.assessmentDraft.fields.plan !== latestDraftFields.plan ||
      restoredDraft.assessment !== null) {
    throw new Error('Owner-scoped encounter recovery did not restore its unsubmitted assessment draft')
  }
  const durableDraft = await testPool.query(
    `SELECT revision, fields FROM app_assessment_drafts WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
    [sessionId, tenantId, subjectId]
  )
  if (Number(durableDraft.rows[0]?.revision) !== 2 || durableDraft.rows[0]?.fields?.plan !== latestDraftFields.plan) {
    throw new Error('The assessment draft revision was not durably saved in its owner-scoped row')
  }
  if (await worker.processOnce() !== 1) throw new Error('Worker did not persist the assessment phase event')
  const assessmentId = `assessment-${randomBytes(6).toString('hex')}`
  const assessment = await sessionStore.submitAssessment(principal, sessionId, assessmentId, {
    summary: 'Pelvic pain began yesterday.',
    differential: 'Ovarian cyst.',
    rationale: 'The reported onset was acute.',
    plan: 'Evaluate with an appropriate workup.'
  })
  if (typeof assessment !== 'object' || assessment.status !== 'unscored') {
    throw new Error(`Redis assessment submission was not accepted as unscored: ${JSON.stringify(assessment)}`)
  }
  const retainedDraftsAfterSubmit = await testPool.query(
    `SELECT count(*)::int AS count FROM app_assessment_drafts WHERE session_id = $1`, [sessionId]
  )
  if (retainedDraftsAfterSubmit.rows[0]?.count !== 0) {
    throw new Error('The submitted assessment draft was not removed after its final submission was committed')
  }
  if (await worker.processOnce() !== 2) throw new Error('Worker did not persist assessment submission and terminal events')
  const assessmentHistory = await testPool.query(
    `SELECT event_id, event_type, sequence, event_ordinal, occurred_at, payload FROM session_events
     WHERE session_id = $1 ORDER BY sequence, event_ordinal`, [sessionId]
  )
  const assessmentOrder = assessmentHistory.rows.slice(-3).map((row) => `${row.event_type}:${row.sequence}.${row.event_ordinal}`)
  if (assessmentOrder.join(',') !== 'phase_changed:1.2,assessment_submitted:1.3,terminal:2.0') {
    throw new Error('Assessment phase, submission, and terminal events were not durably ordered')
  }
  const terminalRecord = assessmentHistory.rows.find((row) => row.event_type === 'terminal')
  if (!terminalRecord) throw new Error('Persisted terminal history is missing')
  const archiveJobs = await testPool.query(
    `SELECT session_id, terminal_event_id, status, attempt_count
     FROM session_archive_jobs WHERE session_id = $1`, [sessionId]
  )
  if (archiveJobs.rows.length !== 1 || archiveJobs.rows[0]?.session_id !== sessionId ||
      archiveJobs.rows[0]?.terminal_event_id !== terminalRecord.event_id ||
      archiveJobs.rows[0]?.status !== 'pending' || Number(archiveJobs.rows[0]?.attempt_count) !== 0) {
    throw new Error('Terminal event did not atomically create one pending archive job')
  }
  const terminalEnvelope = {
    eventId: terminalRecord.event_id, sessionId,
    sequence: Number(terminalRecord.sequence), eventOrdinal: Number(terminalRecord.event_ordinal),
    eventType: 'terminal', occurredAt: new Date(terminalRecord.occurred_at).toISOString(),
    payload: terminalRecord.payload
  }
  const expectedRedisExpiry = Math.floor(Date.parse(terminalEnvelope.occurredAt) / 1000) + 20 * 60
  const terminalRedisKeys = [
    `gptmd:session:${sessionId}`, `gptmd:patient:${patientProfileId}`, `gptmd:retries:${sessionId}`
  ]
  const committedTerminalExpiries = await Promise.all(terminalRedisKeys.map(async (key) =>
    Number(await redis.sendCommand(['EXPIRETIME', key]))
  ))
  if (committedTerminalExpiries.some((expiresAt) => expiresAt !== expectedRedisExpiry)) {
    throw new Error('Terminal Redis keys do not expire at the exact terminal time +20 minutes')
  }
  await redis.sendCommand(['XADD', streamKey, '*', 'event', JSON.stringify(terminalEnvelope)])
  if (await worker.processOnce() !== 1) throw new Error('Worker did not acknowledge the duplicate terminal event')
  const retryArchiveJobs = await testPool.query(
    `SELECT count(*)::int AS count FROM session_archive_jobs WHERE session_id = $1`, [sessionId]
  )
  if (retryArchiveJobs.rows[0]?.count !== 1) throw new Error('Retrying a terminal event duplicated its archive job')

  const earlyDownloadResponse = await fetch(`${apiBase}/api/sessions/${sessionId}/archive/download`, {
    headers: authHeaders
  })
  if (earlyDownloadResponse.status !== 409) {
    throw new Error('A learner download before archive generation was not denied as pending')
  }
  const pendingEngagement = await testPool.query(
    `SELECT result FROM download_engagement WHERE session_id = $1 ORDER BY requested_at`, [sessionId]
  )
  if (pendingEngagement.rows.length !== 1 || pendingEngagement.rows[0]?.result !== 'denied') {
    throw new Error('The pending archive denial was not persisted in download engagement')
  }
  await testPool.query(`
    CREATE FUNCTION phase2_reject_archive_artifact() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'phase2_injected_archive_write_failure';
    END;
    $$;
    CREATE TRIGGER phase2_reject_archive_artifact
      BEFORE INSERT ON session_archive_artifacts
      FOR EACH ROW EXECUTE FUNCTION phase2_reject_archive_artifact();
  `)
  const failedArchiveBuild = await sessionArchiveWorker.processOnce()
  const archiveAfterFailure = await testPool.query(
    `SELECT status, attempt_count, last_error_code FROM session_archive_jobs WHERE session_id = $1`,
    [sessionId]
  )
  const artifactsAfterFailure = await testPool.query(
    `SELECT count(*)::int AS count FROM session_archive_artifacts WHERE session_id = $1`, [sessionId]
  )
  if (failedArchiveBuild !== 0 || archiveAfterFailure.rows[0]?.status !== 'pending' ||
      Number(archiveAfterFailure.rows[0]?.attempt_count) !== 1 ||
      archiveAfterFailure.rows[0]?.last_error_code !== null || artifactsAfterFailure.rows[0]?.count !== 0 ||
      !sessionArchiveErrors.includes('phase2_injected_archive_write_failure')) {
    throw new Error('Failed archive generation did not persist a bounded, content-free retry state')
  }
  await testPool.query('DROP TRIGGER phase2_reject_archive_artifact ON session_archive_artifacts')
  await testPool.query('DROP FUNCTION phase2_reject_archive_artifact()')
  await testPool.query(
    `UPDATE session_archive_jobs SET available_at = now() WHERE session_id = $1 AND status = 'pending'`,
    [sessionId]
  )
  const archiveWorkerResult = await sessionArchiveWorker.processOnce()
  if (archiveWorkerResult !== 1) {
    const failedArchiveJob = await testPool.query(
      `SELECT status, attempt_count, last_error_code, download_expires_at
       FROM session_archive_jobs WHERE session_id = $1`, [sessionId]
    )
    throw new Error(
      `The archive worker did not publish the terminal learner transcript ` +
      `(result=${archiveWorkerResult}; job=${JSON.stringify(failedArchiveJob.rows[0])}; ` +
      `terminalAt=${terminalRecord.occurred_at.toISOString()}; errors=${sessionArchiveErrors.join(',')})`
    )
  }
  const retriedArchiveJob = await testPool.query(
    `SELECT status, attempt_count FROM session_archive_jobs WHERE session_id = $1`, [sessionId]
  )
  if (retriedArchiveJob.rows[0]?.status !== 'completed' ||
      Number(retriedArchiveJob.rows[0]?.attempt_count) !== 2) {
    throw new Error('The retried archive job did not complete from its original PostgreSQL record')
  }
  const archiveListResponse = await fetch(`${apiBase}/api/account/archives`, { headers: authHeaders })
  const archiveList = await archiveListResponse.json()
  const readyArchive = archiveList.archives?.find((archive) => archive.sessionId === sessionId)
  const expectedArchiveExpiry = new Date(new Date(terminalRecord.occurred_at).getTime() + 72 * 60 * 60 * 1000).toISOString()
  if (archiveListResponse.status !== 200 || readyArchive?.status !== 'available' ||
      readyArchive.downloadExpiresAt !== expectedArchiveExpiry) {
    throw new Error('The owner-scoped archive list did not expose the private artifact through terminal time +72 hours')
  }
  const archiveDownloadResponse = await fetch(`${apiBase}/api/sessions/${sessionId}/archive/download`, {
    headers: authHeaders
  })
  const archivedTranscript = await archiveDownloadResponse.text()
  if (archiveDownloadResponse.status !== 200 ||
      archiveDownloadResponse.headers.get('cache-control') !== 'no-store, private' ||
      archiveDownloadResponse.headers.get('x-content-type-options') !== 'nosniff' ||
      !archiveDownloadResponse.headers.get('content-disposition')?.includes('.txt') ||
      !archivedTranscript.includes('Learner: What is your biggest concern?') ||
      !archivedTranscript.includes('Patient: I am worried about what is causing the pain.')) {
    throw new Error('The authenticated archive route did not return the learner-safe transcript with private download headers')
  }
  let completedEngagement
  for (let attempt = 0; attempt < 20; attempt += 1) {
    completedEngagement = await testPool.query(
      `SELECT result, bytes_downloaded FROM download_engagement WHERE session_id = $1`, [sessionId]
    )
    if (completedEngagement.rows.length === 3) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (completedEngagement?.rows.length !== 3 ||
      ['denied', 'authorized', 'completed'].some((result) =>
        completedEngagement.rows.filter((row) => row.result === result).length !== 1
      ) ||
      Number(completedEngagement.rows.find((row) => row.result === 'completed')?.bytes_downloaded) !==
        Buffer.byteLength(archivedTranscript, 'utf8')) {
    throw new Error('Pending denial, download authorization, and completed byte-count events were not all persisted')
  }

  await redis.sendCommand(['DEL', `gptmd:session:${sessionId}`, `gptmd:patient:${patientProfileId}`, `gptmd:retries:${sessionId}`])
  await sessionStore.ensureLiveState?.(principal, sessionId)
  const recovered = await stateStore.read(sessionId)
  if (recovered?.state.status !== 'completed' || recovered.acceptedTurns[0]?.turnId !== turn.turnId ||
      recovered.terminalEvent?.outcome !== 'completed' || recovered.assessment?.assessmentId !== assessmentId ||
      recovered.acceptedTurns[0]?.patientReportedFacts[0]?.factId !== turn.patientReportedFacts[0].factId ||
      recovered.acceptedTurns[0]?.disclosedFactIds[0] !== turn.patientReportedFacts[0].factId ||
      recovered.profile.history[0]?.field !== 'patientConcern' ||
      recovered.profile.painEpisodes[0]?.patientDescription !== 'pelvic pain') {
    throw new Error('PostgreSQL history did not rebuild the missing Redis state')
  }
  const redisTtl = Number(await redis.sendCommand(['TTL', `gptmd:session:${sessionId}`]))
  if (redisTtl < 1 || redisTtl > 20 * 60) throw new Error('Recovered terminal Redis state has the wrong expiry')
  const recoveredTerminalExpiries = await Promise.all(terminalRedisKeys.map(async (key) =>
    Number(await redis.sendCommand(['EXPIRETIME', key]))
  ))
  if (recoveredTerminalExpiries.some((expiresAt) => expiresAt !== expectedRedisExpiry)) {
    throw new Error('Recovered terminal Redis keys do not share the exact terminal time +20-minute expiry')
  }

  const { key, cert } = getE2ECertificate()
  const supabaseUser = {
    id: subjectId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'phase2-browser@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Phase Two Browser Learner' },
    created_at: '2026-01-01T00:00:00.000Z'
  }
  const supabaseRequests = []
  supabaseServer = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
    supabaseRequests.push(`${request.method} ${request.url}`)
    response.setHeader('access-control-allow-origin', webOrigin)
    response.setHeader('access-control-allow-credentials', 'true')
    response.setHeader('access-control-allow-headers',
      request.headers['access-control-request-headers'] ?? 'apikey, authorization, x-client-info, content-type')
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS')
    response.setHeader('vary', 'Origin')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    if (request.url === '/auth/v1/.well-known/jwks.json') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' })
      response.end(JSON.stringify({ keys: [publicJwk] }))
      return
    }
    if (request.url?.startsWith('/auth/v1/user')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(supabaseUser))
      return
    }
    response.writeHead(404)
    response.end()
  })
  supabaseServer.listen(supabasePort, '0.0.0.0')
  await once(supabaseServer, 'listening')

  browserServer = spawn(process.execPath, [
    new URL('./playwright-https-server.mjs', import.meta.url).pathname,
    String(webPort), String(upstreamPort)
  ], {
    env: {
      ...process.env,
      NUXT_PUBLIC_API_BASE: apiBase,
      NUXT_PUBLIC_SUPABASE_URL: supabaseOrigin,
      NUXT_PUBLIC_SUPABASE_KEY: 'phase-two-verification-test-key',
      NODE_EXTRA_CA_CERTS: cert
    },
    stdio: 'inherit'
  })
  await waitForHttpsServer(webPort, browserServer)
  browser = await chromium.launch({ headless: true })
  const browserContext = await browser.newContext({ ignoreHTTPSErrors: true })
  const encodeAuthCookieValue = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const authCookieValue = `base64-${encodeAuthCookieValue({
    access_token: token,
    refresh_token: `phase2-browser-${randomBytes(6).toString('hex')}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: tokenIssuedAt + 3600
  })}`
  await browserContext.addCookies([{
    name: 'sb-localhost-auth-token', value: authCookieValue, url: webOrigin, sameSite: 'Lax', secure: true
  }])
  if (!(await browserContext.cookies(webOrigin)).some((cookie) => cookie.name === 'sb-localhost-auth-token')) {
    throw new Error('Could not install the Supabase auth cookie in the signed-in browser context')
  }
  const page = await browserContext.newPage()
  const browserApiErrors = []
  const browserApiRequests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) browserApiRequests.push(`${request.method()} ${url.pathname}`)
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/api/') && response.status() >= 400) {
      browserApiErrors.push(`${response.request().method()} ${url.pathname}: ${response.status()}`)
    }
  })
  await page.goto(`${webOrigin}/`)
  await page.getByRole('heading', { name: 'Your practice space' }).waitFor({ state: 'visible' })
  await page.getByRole('heading', { name: 'phase2-browser@example.test' }).waitFor({ state: 'visible' })
  await page.getByRole('link', { name: 'Begin Visit' }).first().waitFor({ state: 'visible' })
  const sessionCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sessions')
  await page.getByRole('link', { name: 'Begin Visit' }).first().click()
  let createdInBrowser
  try {
    createdInBrowser = await sessionCreatedResponse
  } catch (error) {
    const pageText = await page.locator('body').innerText().catch(() => '')
    const publicConfig = await page.evaluate(() => window.__NUXT__?.config?.public).catch(() => null)
    throw new Error(`Browser did not create a session. URL=${page.url()} API requests=${JSON.stringify(browserApiRequests)} API errors=${JSON.stringify(browserApiErrors)} Supabase requests=${JSON.stringify(supabaseRequests)} Public config=${JSON.stringify(publicConfig)} Page=${pageText.slice(0, 1200)}`, { cause: error })
  }
  const createdInBrowserBody = await createdInBrowser.json()
  browserSessionId = createdInBrowserBody.sessionId
  if (createdInBrowser.status() !== 201 || !/^[A-Za-z0-9_-]{43}$/.test(browserSessionId ?? '')) {
    throw new Error('The signed-in browser did not create its opaque encounter through the real API')
  }
  const preflight = page.getByRole('dialog', { name: 'Before you begin' })
  await preflight.waitFor({ state: 'visible' })
  await preflight.getByRole('radio', { name: /Transcript/ }).check()
  await preflight.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await preflight.getByRole('button', { name: 'Continue with transcript' }).click()
  await page.getByRole('button', { name: 'Enter Room' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Enter Room' }).click()
  await page.getByRole('dialog', { name: 'Before you begin' }).waitFor({ state: 'hidden' })
  const addonSpendNotice = page.getByRole('dialog', { name: 'Add-on tokens are now in use' })
  await addonSpendNotice.waitFor({ state: 'visible' })
  await addonSpendNotice.getByRole('button', { name: 'Got it' }).click()
  await addonSpendNotice.waitFor({ state: 'hidden' })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const chartTab = page.getByRole('tab', { name: 'Chart' })
  if (await chartTab.getAttribute('aria-selected') !== 'true') {
    throw new Error('The browser did not open the learner chart as the default Enter Room panel')
  }
  const chart = page.getByRole('tabpanel', { name: 'Chart' })
  await chart.getByText('Ari Nguyen').waitFor({ state: 'visible' })
  await chart.getByText('Pelvic pain').waitFor({ state: 'visible' })
  await chart.getByTestId('chart-current-pulse').waitFor({ state: 'visible' })
  if (await chart.getByText('average', { exact: true }).count()) {
    throw new Error('Internal portrait body type leaked into the learner-facing chart')
  }
  const portrait = page.locator('.profile-image-wrap img')
  await portrait.waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const image = document.querySelector('.profile-image-wrap img')
    return image instanceof HTMLImageElement && image.naturalWidth > 0
  })
  const interviewTab = page.getByRole('tab', { name: 'Interview' })
  await interviewTab.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
  const interviewTabBounds = await interviewTab.boundingBox()
  const browserViewport = page.viewportSize()
  if (!interviewTabBounds || !browserViewport || interviewTabBounds.x < 0 || interviewTabBounds.y < 0 ||
      interviewTabBounds.x + interviewTabBounds.width > browserViewport.width ||
      interviewTabBounds.y + interviewTabBounds.height > browserViewport.height) {
    throw new Error(`Interview tab remained outside the browser viewport: ${JSON.stringify({ interviewTabBounds, browserViewport })}`)
  }
  await interviewTab.click()
  await page.getByLabel('Your next question').fill('What is your biggest concern?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await page.getByText('I am worried about what is causing the pain.', { exact: true }).waitFor({ state: 'visible' })
  if (browserApiErrors.length) throw new Error(`Browser encounter API requests failed: ${browserApiErrors.join('; ')}`)
  if (scenarioGenerationCount !== 2 ||
      patientTurnGenerationCounts.get('verification-conversation-2') !== 1) {
    throw new Error('Browser setup/turn did not reach the deterministic scenario and patient-turn generators exactly once')
  }
  const browserEncounterResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const browserEncounterBody = await browserEncounterResponse.json()
  if (browserEncounterResponse.status !== 200 || browserEncounterBody.encounter?.sessionId !== browserSessionId ||
      browserEncounterBody.encounter?.status !== 'active' || browserEncounterBody.encounter?.transcript?.length !== 1 ||
      browserEncounterBody.encounter?.transcript?.[0]?.patientResponse !== 'I am worried about what is causing the pain.') {
    throw new Error('The browser-created encounter turn did not return through owner-scoped API recovery')
  }
  const browserScenarioRow = await testPool.query(
    'SELECT scenario_id FROM patient_scenarios WHERE session_id = $1', [browserSessionId]
  )
  browserPatientProfileId = browserScenarioRow.rows[0]?.scenario_id
  if (typeof browserPatientProfileId !== 'string') throw new Error('Browser-created scenario was not stored in PostgreSQL')
  if (await worker.processOnce() !== 3) throw new Error('Browser setup and patient-turn usage/events were not handed to the PostgreSQL worker')
  const browserUsage = await testPool.query(
    'SELECT operation FROM provider_usage WHERE session_id = $1 ORDER BY operation', [browserSessionId]
  )
  if (browserUsage.rows.map((row) => row.operation).join(',') !== 'patient_turn,scenario_generation') {
    throw new Error('Browser-created setup and patient-turn provider usage did not persist through the worker')
  }
  const aiTimeUsageStore = createPostgresOrganizationAiTimeBudgetStore(testPool)
  const actualReservationUsage = await testPool.query(
    `SELECT COALESCE(sum(actual_total_tokens), 0)::text AS used_tokens
     FROM provider_token_reservations
     WHERE tenant_id = $1 AND subject_id = $2 AND status = 'settled'`,
    [tenantId, subjectId]
  )
  const actualUsedTokens = actualReservationUsage.rows[0]?.used_tokens
  const populatedBuckets = await tokenEntitlementStore.getSubjectBuckets(tenantId, subjectId)
  const includedBucket = populatedBuckets.find(({ bucketKind }) => bucketKind === 'included')
  const addonBucket = populatedBuckets.find(({ bucketKind }) => bucketKind === 'addon')
  const totalRemainingTokens = populatedBuckets.reduce((total, bucket) => total + BigInt(bucket.remainingTokens), 0n)
  if (populatedBuckets.length !== 2 || includedBucket?.usedTokens !== '1000' ||
      BigInt(addonBucket?.usedTokens ?? '0') + 1000n !== BigInt(actualUsedTokens ?? '0') ||
      totalRemainingTokens + BigInt(actualUsedTokens ?? '0') !== 11_000n) {
    throw new Error('Provider reservations did not consume included then add-on grants to actual total_tokens')
  }
  const bucketResponse = await fetch(`${apiBase}/api/account/token-buckets`, { headers: authHeaders })
  const bucketResponseBody = await bucketResponse.json()
  if (bucketResponse.status !== 200 ||
      bucketResponseBody.buckets?.length !== 2 ||
      bucketResponseBody.buckets.find((bucket) => bucket.bucketKind === 'included')?.usedTokens !== '1000' ||
      bucketResponseBody.buckets.find((bucket) => bucket.bucketKind === 'addon')?.usedTokens !== addonBucket?.usedTokens) {
    throw new Error('Learner token bucket API did not return reservation-reconciled usage')
  }
  const usagePeriodStart = new Date('2000-01-01T00:00:00.000Z')
  const usagePeriodEnd = new Date('2100-01-01T00:00:00.000Z')
  const actualAiTimeUsage = await aiTimeUsageStore.getUsageSummary(tenantId, usagePeriodStart, usagePeriodEnd)
  const expectedAiTimeUsage = await testPool.query(
    `SELECT COALESCE(sum(total_tokens), 0)::text AS total_tokens, count(*)::text AS response_count
     FROM provider_usage WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3`,
    [tenantId, usagePeriodStart, usagePeriodEnd]
  )
  if (actualAiTimeUsage.totalTokens !== expectedAiTimeUsage.rows[0]?.total_tokens ||
      actualAiTimeUsage.responseCount !== Number(expectedAiTimeUsage.rows[0]?.response_count)) {
    throw new Error('Organization AI-time usage summary did not match persisted tenant provider usage')
  }

  const browserCancellationResponse = await fetch(`${apiBase}/api/sessions/${browserSessionId}/cancel`, {
    method: 'POST', headers: authHeaders
  })
  const browserCancellation = await browserCancellationResponse.json()
  if (browserCancellationResponse.status !== 200 || browserCancellation.status !== 'cancelled') {
    throw new Error('The authenticated browser-created session could not be cancelled through the real API')
  }
  if (await worker.processOnce() !== 1) {
    throw new Error('The cancellation terminal event was not persisted through the Redis/PostgreSQL worker')
  }
  const repeatedCancellationResponse = await fetch(`${apiBase}/api/sessions/${browserSessionId}/cancel`, {
    method: 'POST', headers: authHeaders
  })
  const repeatedCancellation = await repeatedCancellationResponse.json()
  if (repeatedCancellationResponse.status !== 200 || repeatedCancellation.status !== 'cancelled' ||
      await worker.processOnce() !== 0) {
    throw new Error('Repeating cancellation did not return the terminal result without emitting another event')
  }
  const cancelledSession = await testPool.query(
    `SELECT s.status, o.outcome, o.final_turn_sequence,
            (SELECT count(*)::int FROM session_events e
             WHERE e.session_id = s.session_id AND e.event_type = 'terminal') AS terminal_events,
            (SELECT count(*)::int FROM session_archive_jobs j WHERE j.session_id = s.session_id) AS archive_jobs
     FROM app_sessions s JOIN session_outcomes o USING (session_id)
     WHERE s.session_id = $1`,
    [browserSessionId]
  )
  if (cancelledSession.rows[0]?.status !== 'cancelled' ||
      cancelledSession.rows[0]?.outcome !== 'cancelled' ||
      Number(cancelledSession.rows[0]?.final_turn_sequence) !== 1 ||
      Number(cancelledSession.rows[0]?.terminal_events) !== 1 ||
      Number(cancelledSession.rows[0]?.archive_jobs) !== 1) {
    throw new Error('Cancellation did not persist one matching terminal outcome and archive job')
  }

  process.stdout.write(JSON.stringify({
    isolatedRedisDatabase,
    redisAppendFsync: 'everysec',
    setup: 'real Express routes authorized a learner, created PostgreSQL session IDs, generated one deterministic fictional case, returned only learner-safe fields, stored and idempotently verified the complete session identity binding, and reused the committed scenario on same-key retry',
    sessionResume: 'owner-scoped current-encounter lookup resumed the same ready session and rebuilt the same Redis identity from PostgreSQL after deleting Redis session, profile, retry, and owner-index keys',
    turnRetry: 'saved reply returned; accepted turn and disclosure events emitted atomically',
    transcript: 'ordered learner/patient utterances and append-only voice repair projected with time, phase, modality, and stable IDs; same-ID retries are idempotent and conflicting retries are rejected',
    workerRetry: 'turn and disclosure persisted once; acknowledged and trimmed after commit',
    providerUsage: 'patient-turn and scenario-generation token counts, model/tier metadata, versioned public-rate estimates, and duration persisted through the worker',
    aiTimeUsage: `tenant-scoped organization-period summary matched provider usage: ${actualAiTimeUsage.totalTokens} tokens across ${actualAiTimeUsage.responseCount} responses`,
    tokenBuckets: `provider reservations consumed included tokens first then add-on tokens, reconciling ${actualUsedTokens} actual tokens across both balances; the learner-scoped API returned both buckets`,
    organizationAllocations: 'active corporate settings issued a group grant; increases and unused-token reductions reconciled append-only, over-consumption reductions rolled back, and account refresh issued one idempotent next-period grant with 45-day carryover',
    addonSpendNotice: 'actual scenario-setup and patient-turn debit exposed the one-time notice; learner acknowledgment persisted and remained dismissed after owner-scoped encounter restore',
    turnFailureAudit: 'identifier-only failure metadata persisted through Redis and the PostgreSQL worker',
    assessmentOutcome: 'confirmed phase, unscored submission, and terminal events persisted in order',
    archiveJob: 'one pending archive job was committed with the terminal outcome and remained unique on event replay',
    sessionArchive: 'real Express denied a premature download, the worker built a learner/patient-only 72-hour transcript, and the authenticated download persisted denial, authorization, and completion byte counts',
    terminalRedisExpiry: `terminal commit and PostgreSQL recovery both set session, patient, and retry keys to ${expectedRedisExpiry} (terminal event +20 minutes)`,
    browserCancellation: 'authenticated browser-created session cancellation persisted through Express, Redis, and PostgreSQL; repeat returned cancelled without duplicating terminal event or archive job',
    assessmentDraft: 'partial assessment fields survive owner-scoped restore; monotonically increasing revisions reject late stale saves',
    realtimeAudioUsage: 'migration 023 applied to the disposable database; provider-event duration stored once despite duplicate delivery and observer interruption persisted without storing transcript text',
    missingStateRecovery: 'rebuilt accepted patient fact, disclosure, assessment, and terminal event from PostgreSQL while preserving the immutable seeded profile',
    browserSessionLoop: 'signed-in Nuxt browser displayed the authenticated account and active workspace access, created and set up a patient through real Express/PostgreSQL/Redis, entered with Chart selected, submitted a transcript question, restored the accepted reply through the owner route, and persisted provider usage through the worker',
    terminalRedisTtlSeconds: redisTtl
  }, null, 2) + '\n')
} finally {
  if (browser) await browser.close()
  if (browserServer && browserServer.exitCode === null) {
    browserServer.kill('SIGTERM')
    const killTimer = setTimeout(() => browserServer.kill('SIGKILL'), 3_000)
    await once(browserServer, 'exit')
    clearTimeout(killTimer)
  }
  if (supabaseServer) {
    await new Promise((resolve, reject) => supabaseServer.close((error) => error ? reject(error) : resolve()))
  }
  if (jwksServer) {
    await new Promise((resolve, reject) => jwksServer.close((error) => error ? reject(error) : resolve()))
  }
  if (apiServer) {
    await new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()))
  }
  const sessionIdsToClean = [sessionId, browserSessionId].filter((id) => typeof id === 'string')
  if (sessionIdsToClean.length) {
    const streamRows = await redis.sendCommand(['XRANGE', streamKey, '-', '+'])
    const matchingIds = Array.isArray(streamRows)
      ? streamRows.flatMap((row) => {
          if (!Array.isArray(row) || !Array.isArray(row[1])) return []
          const fields = row[1]
          const fieldIndex = fields.indexOf('event')
          if (fieldIndex < 0 || typeof fields[fieldIndex + 1] !== 'string') return []
          try {
            const event = JSON.parse(fields[fieldIndex + 1])
            return sessionIdsToClean.includes(event.sessionId) ? [String(row[0])] : []
          } catch { return [] }
        })
      : []
    if (matchingIds.length) await redis.sendCommand(['XDEL', streamKey, ...matchingIds])
    const redisKeys = sessionIdsToClean.flatMap((id) => [`gptmd:session:${id}`, `gptmd:retries:${id}`])
    for (const profileId of [patientProfileId, browserPatientProfileId]) {
      if (profileId) redisKeys.push(`gptmd:patient:${profileId}`)
    }
    const ownerIndexKey = `gptmd:owner-session:${createHash('sha256').update(`${tenantId}\0${subjectId}`).digest('hex')}`
    await redis.sendCommand(['DEL', ...redisKeys, ownerIndexKey, streamKey])
  }
  const rateLimitKeys = [hashRateLimitKey('ip', '127.0.0.1')]
  if (tenantId && subjectId) {
    rateLimitKeys.push(hashRateLimitKey('identity', `${tenantId}\0${subjectId}`))
  }
  await redis.sendCommand(['DEL', ...rateLimitKeys])
  await testPool?.end()
  await adminPool.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}"`)
  await adminPool.end()
  await redis.quit()
}
