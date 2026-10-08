export type TenantRole = 'learner' | 'instructor' | 'customer_admin'
export interface TenantMembership {
  tenantId: string
  role: TenantRole
}
type TenantMembershipResponse = { memberships: TenantMembership[] }

function parseTenantMemberships(value: unknown): TenantMembership[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as TenantMembershipResponse).memberships)
    || !(value as TenantMembershipResponse).memberships.every((membership) =>
      membership && typeof membership === 'object' &&
      typeof membership.tenantId === 'string' && membership.tenantId.length > 0 &&
      ['learner', 'instructor', 'customer_admin'].includes(membership.role))) {
    throw new Error('The account service returned an invalid workspace membership list.')
  }
  return (value as TenantMembershipResponse).memberships
}

export function useGptmdAuth() {
  const config = useRuntimeConfig()
  const user = useSupabaseUser()
  const session = useSupabaseSession()
  const selectedTenantId = useState<string | null>('gptmd-selected-tenant', () => null)
  const memberships = useState<TenantMembership[]>('gptmd-tenant-memberships', () => [])
  const membershipLookupStatus = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'gptmd-tenant-membership-status', () => 'idle'
  )
  const isConfigured = computed(() => Boolean(config.public.supabaseUrl && config.public.supabaseKey))

  async function loadTenantMemberships(): Promise<TenantMembership[]> {
    membershipLookupStatus.value = 'loading'
    try {
      const result = await $fetch<unknown>(`${String(config.public.apiBase).replace(/\/$/, '')}/api/account/tenants`, {
        headers: await accessHeaders(false)
      })
      memberships.value = parseTenantMemberships(result)
      membershipLookupStatus.value = 'ready'
      return memberships.value
    } catch (error) {
      membershipLookupStatus.value = 'error'
      throw error
    }
  }

  async function accessHeaders(requireTenant = true): Promise<Record<string, string>> {
    const accessToken = session.value?.access_token
    if (!accessToken) {
      if (!isConfigured.value) return {}
      throw new Error('Sign in to use your GPTpatient account.')
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` }
    if (!requireTenant) return headers

    if (!selectedTenantId.value) {
      const tenantIds = (await loadTenantMemberships()).map((membership) => membership.tenantId)
      if (tenantIds.length === 1) selectedTenantId.value = tenantIds[0] ?? null
      else if (tenantIds.length === 0) throw new Error('This Google account does not have an active GPTpatient workspace yet.')
      else throw new Error('Choose a GPTpatient workspace from your account page before continuing.')
    }

    if (!selectedTenantId.value) throw new Error('Choose an active GPTpatient workspace before continuing.')
    headers['X-GPTMD-Tenant-ID'] = selectedTenantId.value
    return headers
  }

  async function signInWithGoogle(): Promise<void> {
    if (!isConfigured.value) throw new Error('Self-hosted Supabase is not configured.')
    const supabase = useSupabaseClient()
    const redirectInfo = useSupabaseCookieRedirect()
    const route = useRoute()
    const requestedPath = route.query.redirect
    redirectInfo.path.value = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//')
      ? requestedPath
      : '/'
    const redirectTo = new URL('/confirm', window.location.origin).toString()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    })
    if (error) throw error
  }

  async function signOut(): Promise<void> {
    const supabase = useSupabaseClient()
    await supabase.auth.signOut()
    selectedTenantId.value = null
    memberships.value = []
    membershipLookupStatus.value = 'idle'
    await navigateTo('/login')
  }

  return {
    user,
    session,
    memberships,
    membershipLookupStatus,
    selectedTenantId,
    isConfigured,
    accessHeaders,
    loadTenantMemberships,
    signInWithGoogle,
    signOut
  }
}
