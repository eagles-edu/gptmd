<template>
  <article class="contact-page">
    <p class="eyebrow">Contact</p>
    <h1>Contact Us</h1>
    <p class="lead">Questions about GPTpatient or your account? Reach the team using the contact information below.</p>
    <a v-if="supportEmail" class="email-link" :href="`mailto:${supportEmail}`">{{ supportEmail }}</a>
    <v-alert v-else type="info" variant="tonal">
      Support contact details are not configured yet. Please check back when the GPTpatient support channel is available.
    </v-alert>
    <p class="privacy-note">Do not include real patient identifiers or private health information in support requests.</p>
  </article>
</template>

<script setup lang="ts">
const supportEmail = useRuntimeConfig().public.supportEmail
</script>

<style scoped>
.contact-page {
  margin: 0 auto;
  max-width: 760px;
  padding: clamp(2rem, 5vw, 4rem) 1.5rem;
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

.lead {
  color: var(--app-muted-text, #59696a);
  font-size: 1.12rem;
  line-height: 1.7;
  margin-bottom: 1.5rem;
}

.email-link {
  color: #176d70;
  font-size: 1.1rem;
  font-weight: 700;
}

.privacy-note {
  color: var(--app-muted-text, #59696a);
  font-size: 0.9rem;
  margin-top: 1.5rem;
}
</style>
