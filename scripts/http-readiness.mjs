import { setTimeout as delay } from 'node:timers/promises'

export async function waitForHttpReady({
  url,
  fetchImpl = fetch,
  timeoutMs = 30_000,
  intervalMs = 250,
  requestTimeoutMs = 1_000,
  shouldStop = () => false,
  now = Date.now,
  wait = delay
}) {
  const deadline = now() + timeoutMs

  while (now() < deadline && !shouldStop()) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(requestTimeoutMs)
      })
      if (response.ok) return true
    } catch {
      // The service may still be starting or its readiness dependencies may be down.
    }

    const remainingMs = deadline - now()
    if (remainingMs > 0 && !shouldStop()) await wait(Math.min(intervalMs, remainingMs))
  }

  return false
}
