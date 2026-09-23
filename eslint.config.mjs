import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  ignores: ['services/api/dist/**', 'services/api/node_modules/**']
})
