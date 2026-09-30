export function removeLegacyEsbuildOptions(config: { esbuild?: unknown }): void {
  delete config.esbuild
}

export const nuxtH3ReexportPlugin = {
  name: 'gptmd-fix-nuxt-h3-reexports',
  transform(code: string, id: string): string | null {
    if (!id.endsWith('/@nuxt/nitro-server/dist/h3.mjs')) return null

    return code
      .replace('import { H3Error, H3Event, ', 'import { ')
      .replace('export { H3Error, H3Event, ', 'export { ')
  }
}
