import { computed, onMounted } from 'vue'
import { useTheme } from 'vuetify'

const LIGHT_THEME = 'myCustomLightTheme'
const DARK_THEME = 'myCustomDarkTheme'
type AppThemeName = typeof LIGHT_THEME | typeof DARK_THEME

export function useAppTheme() {
  const theme = useTheme()
  const savedTheme = useCookie<AppThemeName>('gptmd-theme', {
    default: () => LIGHT_THEME,
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'lax'
  })

  const isDark = computed(() => theme.global.current.value.dark)

  function setTheme(themeName: AppThemeName) {
    savedTheme.value = themeName
    void theme.change(themeName)

    if (import.meta.client) {
      document.documentElement.dataset.appTheme = themeName === DARK_THEME ? 'dark' : 'light'
    }
  }

  function toggleTheme() {
    setTheme(isDark.value ? LIGHT_THEME : DARK_THEME)
  }

  onMounted(() => {
    const themeName = savedTheme.value === DARK_THEME ? DARK_THEME : LIGHT_THEME
    setTheme(themeName)
  })

  return { isDark, toggleTheme }
}
