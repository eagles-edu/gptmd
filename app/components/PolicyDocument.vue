<script setup lang="ts">
export interface PolicySection {
  heading: string
  paragraphs: string[]
  bullets?: string[]
}

defineProps<{
  title: string
  subtitle: string
  vietnamese: PolicySection[]
  english: PolicySection[]
}>()
</script>

<template>
  <main class="policy-page" aria-labelledby="policy-title">
    <header class="policy-heading">
      <p class="eyebrow">GPTpatient · Service policies</p>
      <h1 id="policy-title">{{ title }}</h1>
      <p class="policy-subtitle">{{ subtitle }}</p>
      <p class="policy-status">
        GPTpatient is currently a workspace-based training application. Paid checkout and automatic
        billing are not enabled. These policies describe the current service and will be revised
        before paid sales begin.
      </p>
    </header>

    <div class="language-grid">
      <section class="language-section" aria-labelledby="vietnamese-title" lang="vi">
        <h2 id="vietnamese-title">Tiếng Việt</h2>
        <section v-for="(section, index) in vietnamese" :key="`vi-${index}`" class="policy-section">
          <h3>{{ section.heading }}</h3>
          <p v-for="(paragraph, paragraphIndex) in section.paragraphs" :key="`vi-p-${paragraphIndex}`">
            {{ paragraph }}
          </p>
          <ul v-if="section.bullets?.length">
            <li v-for="(bullet, bulletIndex) in section.bullets" :key="`vi-b-${bulletIndex}`">
              {{ bullet }}
            </li>
          </ul>
        </section>
      </section>

      <section class="language-section" aria-labelledby="english-title" lang="en">
        <h2 id="english-title">English</h2>
        <section v-for="(section, index) in english" :key="`en-${index}`" class="policy-section">
          <h3>{{ section.heading }}</h3>
          <p v-for="(paragraph, paragraphIndex) in section.paragraphs" :key="`en-p-${paragraphIndex}`">
            {{ paragraph }}
          </p>
          <ul v-if="section.bullets?.length">
            <li v-for="(bullet, bulletIndex) in section.bullets" :key="`en-b-${bulletIndex}`">
              {{ bullet }}
            </li>
          </ul>
        </section>
      </section>
    </div>

    <p class="policy-contact">
      Need help? <NuxtLink to="/contact">Contact GPTpatient support</NuxtLink>. Do not include real
      patient identifiers or private health information in support requests.
    </p>
  </main>
</template>

<style scoped>
.policy-page {
  color: var(--app-text, #183c43);
  margin: 0 auto;
  max-width: 1180px;
  padding: clamp(1.5rem, 4vw, 3.5rem) 1.25rem;
}

.policy-heading {
  margin: 0 auto 2rem;
  max-width: 78ch;
}

.eyebrow {
  color: #216a68;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  margin: 0 0 0.5rem;
  text-transform: uppercase;
}

h1 {
  font-size: clamp(2rem, 4vw, 3rem);
  letter-spacing: -0.035em;
  line-height: 1.1;
  margin: 0;
}

.policy-subtitle {
  color: var(--app-muted-text, #59696a);
  font-size: 1.1rem;
  margin: 0.75rem 0 0;
}

.policy-status {
  background: #fff7e5;
  border-left: 4px solid #bd8c32;
  border-radius: 0.25rem;
  color: #4d3d1d;
  line-height: 1.6;
  margin: 1.25rem 0 0;
  padding: 0.85rem 1rem;
}

.language-grid {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.language-section {
  background: var(--app-surface, #fff);
  border: 1px solid var(--app-border, #d9e1df);
  border-radius: 1rem;
  min-width: 0;
  padding: clamp(1rem, 2.5vw, 1.75rem);
}

.language-section > h2 {
  border-bottom: 1px solid var(--app-border, #d9e1df);
  font-size: 1.35rem;
  margin: 0 0 1.25rem;
  padding-bottom: 0.75rem;
}

.policy-section + .policy-section {
  margin-top: 1.35rem;
}

.policy-section h3 {
  font-size: 1rem;
  line-height: 1.4;
  margin: 0 0 0.5rem;
}

.policy-section p,
.policy-section li,
.policy-contact {
  color: var(--app-muted-text, #59696a);
  line-height: 1.65;
}

.policy-section p {
  margin: 0.4rem 0;
}

.policy-section ul {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
}

.policy-section li + li {
  margin-top: 0.35rem;
}

.policy-contact {
  margin: 1.5rem auto 0;
  max-width: 78ch;
}

.policy-contact a {
  color: #216a68;
  font-weight: 700;
  text-underline-offset: 0.2em;
}

@media (width <= 760px) {
  .language-grid {
    grid-template-columns: 1fr;
  }
}
</style>
