import { startMockSupabase } from './preflight.global-setup'

export default async function setupMobileViewerAuth(): Promise<() => Promise<void>> {
  return startMockSupabase(3005, 'https://localhost:3004')
}
