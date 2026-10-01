export default defineNuxtRouteMiddleware((to) => {
  if (!['/account', '/encounter'].includes(to.path)) return

  const config = useRuntimeConfig()
  if (!config.public.supabaseUrl || !config.public.supabaseKey) return

  const user = useSupabaseUser()
  if (!user.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
