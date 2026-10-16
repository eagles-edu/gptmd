import { startMockSupabase } from './preflight.global-setup'

export default async function setupMobileViewerAuth(): Promise<() => Promise<void>> {
  const supabasePort = Number(process.env.PLAYWRIGHT_MOBILEVIEWER_SUPABASE_PORT ?? '3005')
  const appPort = process.env.PLAYWRIGHT_MOBILEVIEWER_HTTPS_PORT ?? '3014'
  return startMockSupabase(supabasePort, `https://localhost:${appPort}`)
}
