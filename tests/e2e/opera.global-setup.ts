import { startMockSupabase } from './preflight.global-setup'

export default async function setupOperaAuth(): Promise<() => Promise<void>> {
  return startMockSupabase(3005, 'https://localhost:3001')
}
