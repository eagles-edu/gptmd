import { z } from 'zod'

export default defineNuxtPlugin({
  name: 'zod-strict-csp',
  enforce: 'pre',
  order: -1000,
  setup() {
    // Zod otherwise probes eval with `new Function` and emits a CSP violation in
    // browsers even though it catches the resulting exception and uses its
    // interpreter fallback. Keep validation on that no-eval path by default.
    z.config({ jitless: true })
  }
})
