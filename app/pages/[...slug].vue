<script setup lang="ts">
useHead({ title: 'Page not found | GPTpatient' })
setResponseStatus(404, 'Page not found')
</script>

<template>
  <section class="not-found" aria-labelledby="not-found-title">
    <p class="eyebrow">404</p>
    <h1 id="not-found-title">Page not found</h1>
    <p>The page may have moved or the address may be incorrect.</p>
    <NuxtLink to="/">Return to GPTpatient</NuxtLink>
  </section>
</template>

<style scoped>
.not-found {
  margin: 0 auto;
  max-width: 42rem;
  padding: clamp(3rem, 8vw, 6rem) 1.5rem;
}

.eyebrow {
  color: #216a68;
  font-weight: 800;
  letter-spacing: 0.1em;
}

h1 {
  font-size: clamp(2rem, 5vw, 3rem);
}

.not-found a {
  color: #216a68;
  font-weight: 700;
  text-underline-offset: 0.2em;
}
</style>
