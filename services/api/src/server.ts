import { createServiceClients } from './clients.js'
import { createApiApp } from './app.js'
import { createSessionCommitMetrics } from './session-commit-metrics.ts'
import { createProcessResourceSampler } from './process-resource-metrics.ts'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 4000)

if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
  throw new Error(`Refusing non-loopback HOST: ${host}`)
}

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

const server = app.listen(port, host, () => {
  console.log(`gptmd-api listening on http://${host}:${port}`)
})

const shutdown = (signal: string) => {
  console.log(`${signal}: shutting down gptmd-api`)
  clearInterval(sessionCommitMetricsTimer)
  clearInterval(processResourceMetricsTimer)
  server.close(() => {
    void clients.close().finally(() => process.exit(0))
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
