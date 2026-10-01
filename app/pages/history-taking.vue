<template>
  <article class="content-page history-page">
    <p class="eyebrow">History-taking overview</p>
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
</style>
