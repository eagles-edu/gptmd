import express from 'express'

const app = express()
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 4000)

if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
  throw new Error(`Refusing non-loopback HOST: ${host}`)
}

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '1mb' }))

app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok', service: 'gptmd-api' })
})

app.get('/readyz', (_request, response) => {
  response.json({ status: 'ready', service: 'gptmd-api' })
})

const server = app.listen(port, host, () => {
  console.log(`gptmd-api listening on http://${host}:${port}`)
})

const shutdown = (signal: string) => {
  console.log(`${signal}: shutting down gptmd-api`)
  server.close(() => process.exit(0))
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
