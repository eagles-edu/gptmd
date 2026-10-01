<template>
  <section class="confirm-page" aria-live="polite">
    <h1>Finishing sign-in</h1>
    <p>Verifying your Google session with GPTpatient.</p>
  </section>
</template>

<script setup lang="ts">
useHead({ title: 'Finishing sign-in | GPTpatient' })

const user = useSupabaseUser()
const redirectInfo = useSupabaseCookieRedirect()

watch(user, (value) => {
  if (!value) return
  const requestedPath = redirectInfo.pluck()
  const target = requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
    ? requestedPath
    : '/account'
  return navigateTo(target, { replace: true })
}, { immediate: true })
</script>

<style scoped>
.confirm-page {
  margin: 0 auto;
  max-width: 560px;
  padding: 4rem 1.5rem;
}
</style>
