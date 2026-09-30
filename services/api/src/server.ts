import { createServiceClients } from './clients.js'
import { createApiApp } from './app.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 4000)

if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
  throw new Error(`Refusing non-loopback HOST: ${host}`)
}

const clients = createServiceClients()
const app = createApiApp(clients.dependencies)

const server = app.listen(port, host, () => {
  console.log(`gptmd-api listening on http://${host}:${port}`)
})

const shutdown = (signal: string) => {
  console.log(`${signal}: shutting down gptmd-api`)
  server.close(() => {
    void clients.close().finally(() => process.exit(0))
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
