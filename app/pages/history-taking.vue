<script setup lang="ts">
import { computed, ref } from 'vue'
import catalog from '../data/history-taking-training-prompts.json'

const search = ref('')
const selectedPracticeType = ref('all')
const practiceTypes = [
  { value: 'all', label: 'All prompt types' },
  { value: 'history_question', label: 'History questions' },
  { value: 'examination_instruction', label: 'Examination instructions' },
  { value: 'communication_repair', label: 'Communication repair' }
]

const filteredPrompts = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return catalog.prompts.filter((prompt) => {
    const matchesType = selectedPracticeType.value === 'all' || prompt.practiceType === selectedPracticeType.value
    const matchesText = !query || `${prompt.text} ${prompt.sectionPath.join(' ')}`.toLocaleLowerCase().includes(query)
    return matchesType && matchesText
  })
})

const promptGroups = computed(() => {
  const groups = new Map<string, typeof filteredPrompts.value>()
  for (const prompt of filteredPrompts.value) {
    const key = prompt.sectionPath.join(' / ')
    groups.set(key, [...(groups.get(key) ?? []), prompt])
  }
  return [...groups.entries()].map(([section, prompts]) => ({ section, prompts }))
})
</script>

<template>
  <article class="content-page history-page">
    <p class="eyebrow">Clinical communication practice</p>
    <h1>Let the patient’s story lead</h1>
    <p class="lead">A useful history is structured enough to be complete and flexible enough to follow what matters to the patient.</p>

    <ol class="history-steps">
      <li>
        <span class="step-number">1</span>
        <div><h2>Begin with an open invitation</h2><p>Ask what brought the patient in today. Give them room to describe the concern before narrowing the focus.</p></div>
      </li>
      <li>
        <span class="step-number">2</span>
        <div><h2>Clarify the concern</h2><p>Explore onset, timing, location, character, severity, context, and what makes the symptom better or worse.</p></div>
      </li>
      <li>
        <span class="step-number">3</span>
        <div><h2>Ask relevant background</h2><p>Cover associated symptoms and pertinent medical, medication, allergy, family, social, gynecologic, and obstetric history.</p></div>
      </li>
      <li>
        <span class="step-number">4</span>
        <div><h2>Use care with sensitive topics</h2><p>Explain why you are asking, use neutral language, and respect a patient who chooses not to answer.</p></div>
      </li>
      <li>
        <span class="step-number">5</span>
        <div><h2>Summarize and check</h2><p>Reflect the main points back to the patient and invite corrections before moving to your assessment.</p></div>
      </li>
    </ol>

    <section class="prompt-library" aria-labelledby="prompt-library-title">
      <div class="library-heading">
        <div>
          <p class="eyebrow">English prompt library</p>
          <h2 id="prompt-library-title">Practice the questions</h2>
        </div>
        <span class="result-count" aria-live="polite" aria-atomic="true">{{ filteredPrompts.length }} / {{ catalog.promptCount }}</span>
      </div>

      <div class="filters">
        <label class="search-field">
          <span>Search prompts</span>
          <input v-model="search" type="search" placeholder="Search a question or section">
        </label>
        <label class="type-field">
          <span>Prompt type</span>
          <select v-model="selectedPracticeType">
            <option v-for="type in practiceTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
          </select>
        </label>
      </div>

      <p class="audio-status" role="status">Reference recordings are not available yet. No learner recording or automated score is collected here.</p>

      <div v-if="promptGroups.length" class="prompt-groups">
        <details v-for="group in promptGroups" :key="group.section" class="prompt-group">
          <summary><span>{{ group.section }}</span><span class="group-count">{{ group.prompts.length }}</span></summary>
          <ol class="prompt-list">
            <li v-for="prompt in group.prompts" :key="prompt.id">{{ prompt.text }}</li>
          </ol>
        </details>
      </div>
      <p v-else class="empty-state">No prompts match this search.</p>
    </section>

    <NuxtLink class="start-link" to="/encounter">Practice with a patient <span aria-hidden="true">→</span></NuxtLink>
  </article>
</template>

<style scoped>
.history-page {
  margin: 0 auto;
  max-width: 900px;
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
  line-height: 1.1;
  margin: 0.5rem 0 1rem;
}

.lead {
  color: var(--app-muted-text, #59696a);
  font-size: 1.15rem;
  line-height: 1.7;
  max-width: 64ch;
}

.history-steps {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  margin: 2rem 0;
  padding: 0;
}

.history-steps li {
  align-items: flex-start;
  border-bottom: 1px solid rgb(31 74 77 / 13%);
  display: flex;
  gap: 1rem;
  padding: 1.2rem 0;
}

.step-number {
  align-items: center;
  background: #e9f2ef;
  border-radius: 50%;
  color: #216a68;
  display: inline-flex;
  flex: 0 0 2.4rem;
  font-weight: 800;
  height: 2.4rem;
  justify-content: center;
}

h2 {
  font-size: 1.12rem;
  margin: 0 0 0.35rem;
}

.history-steps p {
  color: var(--app-muted-text, #59696a);
  line-height: 1.6;
  margin: 0;
}

.start-link {
  align-items: center;
  background: #176d70;
  border-radius: 0.65rem;
  color: #fff;
  display: inline-flex;
  font-weight: 700;
  gap: 1rem;
  min-height: 3rem;
  padding: 0.75rem 1.1rem;
  text-decoration: none;
}

.start-link:hover,
.start-link:focus-visible {
  background: #123e49;
}

.prompt-library {
  border-top: 1px solid rgb(31 74 77 / 18%);
  margin-top: 3rem;
  padding-top: 2rem;
}

.library-heading {
  align-items: end;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.library-heading h2 {
  font-size: 1.45rem;
  margin: 0.3rem 0 0;
}

.result-count,
.group-count {
  color: var(--app-muted-text, #59696a);
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.filters {
  align-items: end;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(12rem, 2fr) minmax(12rem, 1fr);
  margin: 1.25rem 0;
}

.filters label {
  display: grid;
  gap: 0.4rem;
  font-size: 0.9rem;
  font-weight: 700;
}

.filters input,
.filters select {
  background: var(--app-surface, #fff);
  border: 1px solid rgb(31 74 77 / 30%);
  border-radius: 4px;
  color: inherit;
  font: inherit;
  min-height: 2.8rem;
  padding: 0.5rem 0.65rem;
  width: 100%;
}

.audio-status {
  background: #f0f5f3;
  border-left: 3px solid #267a75;
  color: #34494a;
  line-height: 1.5;
  margin: 1.5rem 0;
  padding: 0.75rem 1rem;
}

.prompt-groups {
  border-top: 1px solid rgb(31 74 77 / 13%);
}

.prompt-group {
  border-bottom: 1px solid rgb(31 74 77 / 13%);
}

.prompt-group summary {
  align-items: center;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  min-height: 3.25rem;
  padding: 0.65rem 0;
}

.prompt-group summary span:first-child {
  line-height: 1.4;
}

.prompt-list {
  color: var(--app-muted-text, #59696a);
  line-height: 1.6;
  margin: 0;
  padding: 0.25rem 0 1rem 1.4rem;
}

.prompt-list li {
  padding: 0.35rem 0;
}

.empty-state {
  color: var(--app-muted-text, #59696a);
  padding: 1.5rem 0;
}

@media (width <= 600px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
