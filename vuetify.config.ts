import { defineVuetifyConfiguration } from 'vuetify-nuxt-module/custom-configuration'
import type { ThemeDefinition } from 'vuetify'

const myCustomLightTheme: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#f3f7f9',
    'on-background': '#203b52',
    surface: '#ffffff',
    'on-surface': '#203b52',
    'surface-bright': '#ffffff',
    'on-surface-bright': '#203b52',
    'surface-light': '#e8f1f4',
    'on-surface-light': '#203b52',
    'surface-variant': '#e8f1f4',
    'on-surface-variant': '#405a6e',
    primary: '#005eb8',
    'on-primary': '#ffffff',
    secondary: '#006c85',
    'on-secondary': '#ffffff',
    error: '#c2413a',
    'on-error': '#ffffff',
    info: '#456a8c',
    'on-info': '#ffffff',
    success: '#0b9a74',
    'on-success': '#ffffff',
    warning: '#d18a14',
    'on-warning': '#212121'
  }
}

const myCustomDarkTheme: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#121820',
    'on-background': '#e6edf3',
    surface: '#1c2530',
    'on-surface': '#e6edf3',
    'surface-bright': '#293542',
    'on-surface-bright': '#f2f6fa',
    'surface-light': '#303e4b',
    'on-surface-light': '#e6edf3',
    'surface-variant': '#2a3743',
    'on-surface-variant': '#c0ccd7',
    primary: '#78b9f2',
    'on-primary': '#10243a',
    secondary: '#67c9ba',
    'on-secondary': '#102c2c',
    error: '#f18b83',
    'on-error': '#351312',
    info: '#8bbbe4',
    'on-info': '#142637',
    success: '#65c7a2',
    'on-success': '#102c22',
    warning: '#edbd64',
    'on-warning': '#30240c'
  }
}

export default defineVuetifyConfiguration({
  theme: {
    defaultTheme: 'myCustomLightTheme',
    themes: {
      myCustomLightTheme,
      myCustomDarkTheme
    }
  }
})
