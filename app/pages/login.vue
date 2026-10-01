<template>
  <section class="login-page" aria-labelledby="login-title">
    <p class="eyebrow">GPTpatient account</p>
    <h1 id="login-title">Sign in to continue</h1>
    <p class="intro">Use your Google account to open your practice workspace.</p>
    <v-alert v-if="!isConfigured" type="warning" variant="tonal">
      Self-hosted Supabase is not configured. Set the public Supabase URL and publishable key in the app environment.
    </v-alert>
    <v-alert v-if="errorMessage" type="error" variant="tonal">{{ errorMessage }}</v-alert>
    <button class="google-button" type="button" :disabled="!isConfigured || pending" @click="signIn">
      <span aria-hidden="true">G</span>
      {{ pending ? 'Connecting to Google…' : 'Continue with Google' }}
    </button>
    <p class="privacy-note">Your practice access is checked against GPTpatient account membership.</p>
  </section>
</template>

<script setup lang="ts">
useHead({ title: 'Sign in | GPTpatient' })

const { isConfigured, signInWithGoogle } = useGptmdAuth()
const pending = ref(false)
const errorMessage = ref('')

async function signIn() {
  pending.value = true
  errorMessage.value = ''
  try {
    await signInWithGoogle()
  } catch {
    errorMessage.value = 'Google sign-in could not be started. Check the self-hosted Supabase Auth configuration.'
  } finally {
    pending.value = false
  }
}
</script>

<style scoped>
.login-page {
  margin: 0 auto;
  max-width: 560px;
  padding: clamp(2rem, 7vw, 5rem) 1.5rem;
}

.eyebrow {
  color: #267a75;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  font-size: clamp(2.2rem, 5vw, 3.5rem);
  letter-spacing: -0.04em;
  margin: 0.5rem 0;
}

.intro,
.privacy-note {
  color: var(--app-muted-text, #59696a);
  line-height: 1.6;
}

.google-button {
  align-items: center;
  background: #fff;
  border: 1px solid #aab6b6;
  border-radius: 0.65rem;
  color: #233b3e;
  cursor: pointer;
  display: flex;
  font: inherit;
  font-weight: 750;
  gap: 0.75rem;
  justify-content: center;
  margin-top: 1.25rem;
  min-height: 3.25rem;
  padding: 0.7rem 1rem;
  width: 100%;
}

.google-button span {
  color: #4285f4;
  font-size: 1.25rem;
  font-weight: 900;
}

.google-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.google-button:focus-visible {
  outline: 3px solid #267a75;
  outline-offset: 3px;
}
</style>
