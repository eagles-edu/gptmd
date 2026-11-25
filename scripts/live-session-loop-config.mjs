const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1'])
const safeSetupErrors = new Set([
  'Pinned patient scenario versions are unavailable',
  'Patient state storage is unavailable',
  'Patient setup provider capacity is unavailable; retry with the same Idempotency-Key.',
  'Patient setup capacity is unavailable; retry with the same Idempotency-Key.',
  'Patient scenario setup could not be completed'
])
const safeProviderErrorNames = new Set([
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'APIError',
  'AuthenticationError',
  'Error',
  'InternalServerError',
  'NotFoundError',
  'PatientScenarioProviderError',
  'PatientScenarioValidationError',
  'PermissionDeniedError',
  'ProviderTokenBudgetExceeded',
  'RateLimitError',
  'UnprocessableEntityError'
])
const safeProviderStages = new Set([
  'conversation_create',
  'input_token_count',
  'token_reservation',
  'response_stream'
])

export function resolveLiveSessionLoopRedisUrl(configuredUrl, overrideUrl) {
  const rawUrl = overrideUrl?.trim() || configuredUrl?.trim()
  if (!rawUrl) throw new Error('A Redis URL is required for isolated live verification.')

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Live verification Redis URL must be a valid redis:// or rediss:// URL.')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!['redis:', 'rediss:'].includes(url.protocol) || !loopbackHosts.has(hostname)) {
    throw new Error('Live session verification only runs against loopback Redis URLs.')
  }
  return url
}

export async function seedLiveSessionLoopTokenGrant(query, subjectId, grantId, grantedAt) {
  await query(
    `INSERT INTO gptmd_token_entitlement_grants (
       grant_id, account_scope, subject_id, bucket_kind, source_kind, source_reference,
       granted_tokens, granted_at, valid_from, renewal_at, expires_at, granted_by
     ) VALUES ($1, 'consumer', $2, 'addon', 'verified_purchase', $3,
               10000000, $4, $4, NULL, $4::timestamptz + interval '365 days',
               'gptmd-live-verification')`,
    [grantId, subjectId, `verification-fixture:${grantId}`, grantedAt]
  )
}

export function summarizeLiveSetupFailure(status, errorBody, retryAfter, serverTiming) {
  const timing = typeof serverTiming === 'string'
    ? serverTiming.split(',').map((entry) => {
        const match = /^\s*(setup_queue_wait|setup_provider_capacity_wait);dur=(\d+(?:\.\d+)?)\s*$/.exec(entry)
        return match ? { metric: match[1], durationMs: Number(match[2]) } : null
      }).filter((entry) => entry !== null)
    : []

  return {
    status: Number.isInteger(status) ? status : null,
    apiError: safeSetupErrors.has(errorBody?.error) ? errorBody.error : 'Unrecognized API error',
    retryAfterSeconds: typeof retryAfter === 'string' && /^\d{1,3}$/.test(retryAfter)
      ? Number(retryAfter)
      : null,
    serverTiming: timing
  }
}

export function summarizeLiveProviderFailure(error) {
  const record = error && typeof error === 'object' ? error : {}
  const providerFailure = record.providerFailure && typeof record.providerFailure === 'object'
    ? record.providerFailure
    : record
  const code = typeof providerFailure.code === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(providerFailure.code)
    ? providerFailure.code
    : null
  const type = typeof providerFailure.type === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(providerFailure.type)
    ? providerFailure.type
    : null
  return {
    errorName: typeof record.name === 'string' && safeProviderErrorNames.has(record.name)
      ? record.name
      : 'OtherError',
    providerErrorName: typeof providerFailure.name === 'string' && safeProviderErrorNames.has(providerFailure.name)
      ? providerFailure.name
      : 'OtherError',
    status: Number.isInteger(providerFailure.status) && providerFailure.status >= 100 && providerFailure.status <= 599
      ? providerFailure.status
      : null,
    code,
    type,
    stage: safeProviderStages.has(providerFailure.stage) ? providerFailure.stage : null,
    availabilityFailure: typeof record.availabilityFailure === 'boolean'
      ? record.availabilityFailure
      : null
  }
}
