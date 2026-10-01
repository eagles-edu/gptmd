<template>
  <section class="home-page" aria-labelledby="home-title">
    <div class="welcome-panel">
      <div>
        <p class="eyebrow">GPTpatient · OBGYN clinical communication</p>
        <h1 id="home-title">Your practice space</h1>
        <p class="welcome-copy">
          Build confidence taking a focused history with fictional patients. Choose a guide to get started,
          or begin a visit when you are ready.
        </p>
      </div>
      <NuxtLink class="primary-link" to="/encounter">Begin Visit <span aria-hidden="true">→</span></NuxtLink>
    </div>

    <div class="entry-grid" role="group" aria-label="Home and account links">
      <NuxtLink class="entry-card guide-card" to="/tutorial">
        <span class="card-icon" aria-hidden="true">01</span>
        <span class="card-content">
          <strong>Instructions</strong>
          <span>Learn how to start and guide a patient encounter.</span>
        </span>
        <span class="card-arrow" aria-hidden="true">↗</span>
      </NuxtLink>
      <NuxtLink class="entry-card guide-card" to="/history-taking">
        <span class="card-icon" aria-hidden="true">02</span>
        <span class="card-content">
          <strong>History-Taking Overview</strong>
          <span>Review a practical structure for a complete, patient-led history.</span>
        </span>
        <span class="card-arrow" aria-hidden="true">↗</span>
      </NuxtLink>
      <NuxtLink class="entry-card account-card" to="/account">
        <span class="card-icon" aria-hidden="true">03</span>
        <span class="card-content">
          <strong>Account Status</strong>
          <span>Usage, metrics, downloads, and payment access.</span>
        </span>
        <span class="card-arrow" aria-hidden="true">↗</span>
      </NuxtLink>
      <NuxtLink class="entry-card account-card" to="/contact">
        <span class="card-icon" aria-hidden="true">04</span>
        <span class="card-content">
          <strong>Contact Us</strong>
          <span>Find support contact information for GPTpatient.</span>
        </span>
        <span class="card-arrow" aria-hidden="true">↗</span>
      </NuxtLink>
    </div>

    <p class="privacy-note">
      Use fictional details only. Do not enter real patient identifiers or private health information.
    </p>
  </section>
</template>

<style scoped>
.home-page {
  margin: 0 auto;
  max-width: 1180px;
  padding: clamp(2rem, 5vw, 4.5rem) 1.5rem;
}

.welcome-panel {
  align-items: flex-end;
  background: linear-gradient(125deg, #123e49, #176d70);
  border-radius: 1.5rem;
  color: #fff;
  display: flex;
  gap: 2rem;
  justify-content: space-between;
  overflow: hidden;
  padding: clamp(2rem, 5vw, 4rem);
  position: relative;
}

.welcome-panel::after {
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 50%;
  content: "";
  height: 28rem;
  pointer-events: none;
  position: absolute;
  right: -11rem;
  top: -18rem;
  width: 28rem;
}

.eyebrow {
  color: #acd9d2;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  margin: 0 0 0.9rem;
  text-transform: uppercase;
}

h1 {
  font-size: clamp(2.2rem, 5vw, 3.8rem);
  letter-spacing: -0.045em;
  line-height: 1.05;
  margin: 0;
  max-width: 14ch;
}

.welcome-copy {
  color: rgb(255 255 255 / 82%);
  font-size: 1.08rem;
  line-height: 1.65;
  margin: 1.2rem 0 0;
  max-width: 58ch;
}

.primary-link {
  align-items: center;
  background: #e8c879;
  border-radius: 0.7rem;
  color: #183c43;
  display: inline-flex;
  flex: 0 0 auto;
  font-weight: 800;
  gap: 1rem;
  justify-content: center;
  min-height: 3.3rem;
  padding: 0.85rem 1.2rem;
  position: relative;
  text-decoration: none;
  z-index: 1;
}

.primary-link:hover,
.primary-link:focus-visible {
  background: #f3dc9f;
}

.primary-link:focus-visible,
.entry-card:focus-visible {
  outline: 3px solid #c27b43;
  outline-offset: 4px;
}

.entry-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 1.4rem;
}

.entry-card {
  align-items: flex-start;
  background: var(--app-surface, #fff);
  border: 1px solid rgb(31 74 77 / 14%);
  border-radius: 1rem;
  color: inherit;
  display: flex;
  gap: 1rem;
  min-height: 8.25rem;
  padding: 1.35rem;
  text-decoration: none;
  transition: border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
}

.entry-card:hover {
  border-color: rgb(31 110 108 / 55%);
  box-shadow: 0 0.8rem 2rem rgb(17 47 53 / 8%);
  transform: translateY(-2px);
}

.card-icon {
  align-items: center;
  background: #e9f2ef;
  border-radius: 0.7rem;
  color: #216a68;
  display: flex;
  flex: 0 0 2.7rem;
  font-size: 0.8rem;
  font-weight: 800;
  height: 2.7rem;
  justify-content: center;
}

.account-card .card-icon {
  background: #f3eee2;
  color: #7a5d20;
}

.card-content {
  display: grid;
  gap: 0.45rem;
  line-height: 1.5;
}

.card-content strong {
  font-size: 1.1rem;
}

.card-content span {
  color: var(--app-muted-text, #59696a);
  font-size: 0.94rem;
}

.card-arrow {
  color: #216a68;
  font-size: 1.1rem;
  margin-left: auto;
}

.privacy-note {
  color: var(--app-muted-text, #59696a);
  font-size: 0.9rem;
  margin: 1.2rem 0 0;
}

@media (width <= 760px) {
  .welcome-panel {
    align-items: flex-start;
    flex-direction: column;
  }

  .entry-grid {
    grid-template-columns: 1fr;
  }
}
</style>
