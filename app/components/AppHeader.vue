<template>
  <header class="site-header">
    <NuxtLink class="brand" to="/" aria-label="GPTpatient home">
      <img src="/assets/images/logosing.svg" alt="GPTpatient" width="150" height="55">
    </NuxtLink>
    <nav aria-label="Main navigation">
      <NuxtLink to="/">Encounter</NuxtLink>
      <NuxtLink to="/about">About</NuxtLink>
      <NuxtLink to="/tutorial">Tutorial</NuxtLink>
      <NuxtLink to="/commands">Commands</NuxtLink>
      <NuxtLink to="/help">Help</NuxtLink>
    </nav>
    <button
    class="theme-toggle" type="button" :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
      :title="isDark ? 'Switch to light theme' : 'Switch to dark theme'" :aria-pressed="isDark" @click="toggleTheme">
      <span aria-hidden="true">{{ isDark ? "☀" : "☾" }}</span>
      <span>{{ isDark ? "Light" : "Dark" }}</span>
    </button>
  </header>
</template>

<script setup lang="ts">
const { isDark, toggleTheme } = useAppTheme();
</script>

<style scoped>
.site-header {
  align-items: center;
  background: var(--app-header-background);
  color: #fff;
  display: flex;
  gap: 2rem;
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
  gap: 0.4rem;
}

nav a {
  border-radius: 0.4rem;
  color: inherit;
  font-size: 0.94rem;
  padding: 0.55rem 0.7rem;
  text-decoration: none;
}

nav a:hover,
nav a:focus-visible,
nav a.router-link-active {
  background: rgb(255 255 255 / 15%);
}

.theme-toggle {
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
  min-height: 2.6rem;
  padding: 0.45rem 0.7rem;
}

.theme-toggle span:first-child {
  font-size: 1.2rem;
  line-height: 1;
}

.theme-toggle:hover,
.theme-toggle:focus-visible {
  background: rgb(255 255 255 / 15%);
}

.theme-toggle:focus-visible {
  outline: 2px solid currentcolor;
  outline-offset: 3px;
}

@media (width <=700px) {
  .site-header {
    align-items: center;
    gap: 0.6rem;
    padding: 1rem;
    flex-flow: row wrap;
    justify-content: space-between;
  }

  nav {
    flex: 1 1 100%;
    gap: 0.1rem;
    order: 1;
  }

  nav a {
    padding-inline: 0.5rem;
  }
}
</style>
