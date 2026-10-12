import { createServiceClients } from './clients.js'
import { createApiApp } from './app.js'
import { createServer } from 'node:http'
import { createSessionCommitMetrics } from './session-commit-metrics.ts'
import { createProcessResourceSampler } from './process-resource-metrics.ts'
import { resolveApiListenerHost } from './listener-config.ts'
import { API_SHUTDOWN_DRAIN_TIMEOUT_MS, drainHttpServer, withHttpDrainGate } from './http-server-shutdown.ts'

const host = resolveApiListenerHost(process.env)
const port = Number(process.env.PORT ?? 4000)

const sessionCommitMetrics = createSessionCommitMetrics()
const clients = createServiceClients(process.env, sessionCommitMetrics.record)
const processResourceSample = createProcessResourceSampler({
  readCpu: () => process.cpuUsage(),
  readMemory: () => process.memoryUsage(),
  now: () => process.hrtime.bigint()
})
const sessionCommitMetricsTimer = setInterval(() => {
  const observedAt = new Date().toISOString()
  for (const metric of sessionCommitMetrics.flush()) {
    process.stdout.write(`${JSON.stringify({ event: 'session_state_event_commit_metrics', observedAt, ...metric })}\n`)
  }
}, 30_000)
sessionCommitMetricsTimer.unref()
const processResourceMetricsTimer = setInterval(() => {
  process.stdout.write(`${JSON.stringify({
    event: 'process_resource_metrics', component: 'api', observedAt: new Date().toISOString(),
    ...processResourceSample()
  })}\n`)
}, 30_000)
processResourceMetricsTimer.unref()

const app = createApiApp({
  ...clients.dependencies,
  recordSessionCommitTiming: sessionCommitMetrics.record
})

let shuttingDown = false
let forcedShutdown = false
const server = createServer(withHttpDrainGate(app, () => shuttingDown))
server.listen(port, host, () => {
  console.log(`gptmd-api listening on http://${host}:${port}`)
})

const shutdown = (signal: string) => {
  if (shuttingDown) {
    forcedShutdown = true
    server.closeAllConnections()
    return
  }
  shuttingDown = true
  console.log(`${signal}: shutting down gptmd-api`)
  clearInterval(sessionCommitMetricsTimer)
  clearInterval(processResourceMetricsTimer)
  void drainHttpServer(server, API_SHUTDOWN_DRAIN_TIMEOUT_MS)
    .then(async (result) => {
      if (result === 'forced' || forcedShutdown) {
        process.stderr.write('API shutdown drain timed out; remaining HTTP connections were closed.\n')
      }
      await clients.close()
    })
    .then(() => { process.exitCode = 0 })
    .catch(() => {
      process.stderr.write('API shutdown could not close its storage and provider clients cleanly.\n')
      process.exitCode = 1
    })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
