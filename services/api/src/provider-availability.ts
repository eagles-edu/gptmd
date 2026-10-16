const NON_AVAILABILITY_RATE_LIMIT_CODES = new Set([
  'credit_balance_exhausted',
  'insufficient_quota',
  'organization_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'project_spend_limit_exceeded'
])

export function isOpenAiAvailabilityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'APIConnectionError' || error.name === 'APIConnectionTimeoutError') return true
  const apiError = error as Error & { status?: unknown; code?: unknown; type?: unknown }
  if (!Number.isInteger(apiError.status)) return false
  if (Number(apiError.status) >= 500 || apiError.status === 408) return true
  if (apiError.status !== 429) return false

  const code = typeof apiError.code === 'string' ? apiError.code : null
  const type = typeof apiError.type === 'string' ? apiError.type : null
  return !NON_AVAILABILITY_RATE_LIMIT_CODES.has(code ?? '') &&
    (type === 'rate_limit_error' || code === 'rate_limit_exceeded' || code === 'slow_down')
}
