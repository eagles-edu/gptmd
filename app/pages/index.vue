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
      <NuxtLink v-if="canBeginVisit" class="primary-link" to="/encounter">Begin Visit <span aria-hidden="true">→</span></NuxtLink>
      <NuxtLink v-else-if="user && membershipState === 'error'" class="primary-link" to="/account">Review account access <span aria-hidden="true">→</span></NuxtLink>
      <button v-else-if="user" class="primary-link primary-link-disabled" type="button" disabled>
        {{ membershipState === 'loading' ? 'Loading workspace…' : 'Workspace access needed' }}
      </button>
      <NuxtLink v-else class="primary-link" to="/encounter">Begin Visit <span aria-hidden="true">→</span></NuxtLink>
    </div>

    <section v-if="user" class="signed-in-panel" aria-labelledby="signed-in-title">
      <div>
        <p class="signed-in-label">Signed in</p>
        <h2 id="signed-in-title">{{ user.email || 'Google account' }}</h2>
      </div>
      <div v-if="tenantIds.length > 1" class="workspace-picker">
        <label for="home-workspace-select">Practice workspace</label>
        <select id="home-workspace-select" v-model="selectedTenantId">
          <option v-for="(tenantId, index) in tenantIds" :key="tenantId" :value="tenantId">Workspace {{ index + 1 }}</option>
        </select>
      </div>
      <p v-if="membershipMessage" class="membership-message" role="status" aria-live="polite">
        {{ membershipMessage }}
        <button v-if="membershipState === 'error'" class="retry-link" type="button" @click="loadMemberships">Retry</button>
        <NuxtLink v-if="tenantIds.length === 0 && membershipState === 'ready'" to="/contact">Contact support</NuxtLink>
      </p>
      <p v-else-if="membershipState === 'loading'" class="membership-message" role="status">Checking workspace access…</p>
      <p v-else-if="tenantIds.length === 1" class="membership-message">Workspace access is ready.</p>
    </section>

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

<script setup lang="ts">
const { user, isConfigured, loadTenantIds, selectedTenantId } = useGptmdAuth()
const tenantIds = ref<string[]>([])
const membershipState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const membershipMessage = ref('')
const hasSelectedWorkspace = computed(() => Boolean(selectedTenantId.value && tenantIds.value.includes(selectedTenantId.value)))
const canBeginVisit = computed(() => !user.value || !isConfigured.value || (membershipState.value === 'ready' && hasSelectedWorkspace.value))

async function loadMemberships(): Promise<void> {
  if (!user.value) return
  membershipState.value = 'loading'
  membershipMessage.value = ''
  try {
    tenantIds.value = await loadTenantIds()
    if (selectedTenantId.value && !tenantIds.value.includes(selectedTenantId.value)) selectedTenantId.value = null
    if (tenantIds.value.length === 0) {
      membershipMessage.value = 'This account does not have an active GPTpatient workspace yet.'
    } else if (tenantIds.value.length > 1 && !hasSelectedWorkspace.value) {
      membershipMessage.value = 'Choose a workspace before you begin a visit.'
    } else if (tenantIds.value.length === 1) {
      selectedTenantId.value = tenantIds.value[0] ?? null
    }
    membershipState.value = 'ready'
  } catch {
    membershipMessage.value = 'Workspace access could not be loaded.'
    membershipState.value = 'error'
  }
}

onMounted(loadMemberships)
</script>

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

.primary-link-disabled,
.primary-link-disabled:hover {
  background: #d5dedd;
  color: #59696a;
  cursor: not-allowed;
}

.signed-in-panel {
  align-items: center;
  background: var(--app-surface, #fff);
  border: 1px solid rgb(31 74 77 / 14%);
  border-radius: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 2rem;
  justify-content: space-between;
  margin-top: 1rem;
  padding: 1.15rem 1.4rem;
}

.signed-in-label {
  color: var(--app-muted-text, #59696a);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  margin: 0 0 0.2rem;
  text-transform: uppercase;
}

.signed-in-panel h2 {
  font-size: 1rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.workspace-picker {
  display: grid;
  gap: 0.35rem;
  min-width: min(100%, 15rem);
}

.workspace-picker label {
  font-size: 0.87rem;
  font-weight: 700;
}

.workspace-picker select {
  background: var(--app-surface, #fff);
  border: 1px solid rgb(31 74 77 / 30%);
  border-radius: 0.5rem;
  color: inherit;
  font: inherit;
  min-height: 2.6rem;
  padding: 0.4rem 0.65rem;
}

.membership-message {
  color: var(--app-muted-text, #59696a);
  flex-basis: 100%;
  line-height: 1.5;
  margin: 0;
}

.membership-message a,
.retry-link {
  color: #176d70;
  font: inherit;
  font-weight: 700;
  margin-left: 0.4rem;
  text-decoration: underline;
}

.retry-link {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
}

.retry-link:focus-visible,
.workspace-picker select:focus-visible {
  outline: 2px solid #176d70;
  outline-offset: 3px;
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
