<template>
  <header class="site-header">
    <NuxtLink class="brand" to="/" aria-label="GPTpatient home" @click="closeMenu">
      <img src="/assets/images/logosing.svg" alt="GPTpatient" width="150" height="55">
    </NuxtLink>

    <button
      class="menu-toggle"
      type="button"
      :aria-label="menuOpen ? 'Close main menu' : 'Open main menu'"
      :aria-expanded="menuOpen"
      aria-controls="main-navigation"
      @click="menuOpen = !menuOpen"
    >
      <svg v-if="!menuOpen" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
      <svg v-else aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>

    <nav id="main-navigation" aria-label="Main navigation" :class="{ 'is-open': menuOpen }">
      <NuxtLink to="/" @click="closeMenu">
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg>
        <span>Home</span>
      </NuxtLink>
      <NuxtLink to="/tutorial" @click="closeMenu">
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21zM4 5.5v13A2.5 2.5 0 0 1 6.5 16H20" /></svg>
        <span>Instructions</span>
      </NuxtLink>
      <NuxtLink to="/history-taking" @click="closeMenu">
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21zM4 5.5v13A2.5 2.5 0 0 1 6.5 16H20M8 7h8M8 11h8" /></svg>
        <span>History Overview</span>
      </NuxtLink>
      <NuxtLink to="/account" @click="closeMenu">
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
        <span>Account</span>
      </NuxtLink>
      <NuxtLink to="/contact" @click="closeMenu">
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>
        <span>Contact</span>
      </NuxtLink>
      <NuxtLink class="visit-link" to="/encounter" @click="closeMenu">
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 3v18M3 12h18" /></svg>
        <span>Begin Visit</span>
      </NuxtLink>
    </nav>

    <button
      class="theme-toggle"
      type="button"
      :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
      :title="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
      :aria-pressed="isDark"
      @click="toggleTheme"
    >
      <span aria-hidden="true">{{ isDark ? "☀" : "☾" }}</span>
      <span>{{ isDark ? "Light" : "Dark" }}</span>
    </button>
  </header>
</template>

<script setup lang="ts">
const { isDark, toggleTheme } = useAppTheme();
const menuOpen = ref(false);
const route = useRoute();

function closeMenu() {
  menuOpen.value = false;
}

watch(() => route.fullPath, closeMenu);
</script>

<style scoped>
.site-header {
  align-items: center;
  background: var(--app-header-background);
  color: #fff;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  min-height: 76px;
  padding: 0.75rem max(1.25rem, calc((100vw - 1280px) / 2));
}

.brand {
  display: inline-flex;
  flex: 0 0 auto;
}

.brand img {
  display: block;
  height: 48px;
  max-width: 100%;
  object-fit: contain;
}

nav {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

nav a {
  align-items: center;
  border-radius: 0.4rem;
  color: inherit;
  display: inline-flex;
  font-size: 0.94rem;
  gap: 0.4rem;
  padding: 0.55rem 0.65rem;
  text-decoration: none;
}

nav a svg,
.menu-toggle svg {
  fill: none;
  height: 1.15rem;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  width: 1.15rem;
}

nav a:hover,
nav a:focus-visible,
nav a.router-link-active {
  background: rgb(255 255 255 / 15%);
}

nav a.visit-link {
  background: #e8c879;
  color: #183c43;
  font-weight: 700;
}

nav a.visit-link:hover,
nav a.visit-link:focus-visible {
  background: #f3dc9f;
}

.theme-toggle,
.menu-toggle {
  align-items: center;
  background: transparent;
  border: 1px solid rgb(255 255 255 / 55%);
  border-radius: 0.5rem;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  font: inherit;
  gap: 0.5rem;
  justify-content: center;
  min-height: 2.6rem;
  padding: 0.45rem 0.7rem;
}

.theme-toggle span:first-child {
  font-size: 1.2rem;
  line-height: 1;
}

.theme-toggle:hover,
.theme-toggle:focus-visible,
.menu-toggle:hover,
.menu-toggle:focus-visible {
  background: rgb(255 255 255 / 15%);
}

.theme-toggle:focus-visible,
.menu-toggle:focus-visible,
nav a:focus-visible {
  outline: 2px solid currentcolor;
  outline-offset: 3px;
}

.menu-toggle {
  display: none;
}

@media (width <=760px) {
  .site-header {
    align-content: start;
    display: grid;
    gap: 0.75rem;
    grid-template-columns: minmax(0, 1fr) auto auto;
    padding: 0.75rem 1rem;
  }

  .brand img {
    height: 42px;
    width: 132px;
  }

  .menu-toggle {
    display: inline-flex;
    height: 2.6rem;
    grid-column: 2;
    grid-row: 1;
    width: 2.6rem;
  }

  .theme-toggle {
    grid-column: 3;
    grid-row: 1;
  }

  nav {
    border-top: 1px solid rgb(255 255 255 / 20%);
    display: none;
    flex-direction: column;
    grid-column: 1 / -1;
    grid-row: 2;
    padding-top: 0.5rem;
  }

  nav.is-open {
    display: flex;
  }

  nav a {
    min-height: 2.75rem;
    width: 100%;
  }
}
</style>
