import { createServer as createHttpsServer } from 'node:https'
import { request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { getE2ECertificate } from './e2e-certificate.mjs'

const publicPort = Number(process.argv[2])
const upstreamPort = Number(process.argv[3])
if (!Number.isInteger(publicPort) || !Number.isInteger(upstreamPort)) {
  throw new Error('Usage: node scripts/playwright-https-server.mjs <https-port> <upstream-port>')
}

const { key, cert } = getE2ECertificate()
const upstream = spawn(process.execPath, ['.output/server/index.mjs'], {
  env: {
    ...process.env,
    PORT: String(upstreamPort),
    HOST: '127.0.0.1',
    NODE_EXTRA_CA_CERTS: cert
  },
  stdio: 'inherit'
})

function waitForUpstream() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const probe = () => {
      const request = httpRequest({ host: '127.0.0.1', port: upstreamPort, path: '/', timeout: 1000 }, (response) => {
        response.resume()
        resolve()
      })
      request.on('error', () => {
        if (upstream.exitCode !== null) {
          reject(new Error(`Nuxt server exited with status ${upstream.exitCode}`))
        } else if (Date.now() - startedAt > 30_000) {
          reject(new Error('Nuxt server did not become ready within 30 seconds'))
        } else {
          setTimeout(probe, 250)
        }
      })
      request.on('timeout', () => request.destroy())
      request.end()
    }
    probe()
  })
}

await waitForUpstream()
const server = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
  const proxy = httpRequest({
    host: '127.0.0.1',
    port: upstreamPort,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, host: `localhost:${publicPort}`, 'x-forwarded-proto': 'https' }
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  proxy.on('error', () => {
    if (!response.headersSent) response.writeHead(502)
    response.end('E2E upstream unavailable')
  })
  request.pipe(proxy)
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(publicPort, '0.0.0.0', resolve)
})

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await new Promise((resolve) => server.close(resolve))
  upstream.kill('SIGTERM')
  const timer = setTimeout(() => upstream.kill('SIGKILL'), 3000)
  upstream.once('exit', () => clearTimeout(timer))
}

process.once('SIGINT', () => { void stop().finally(() => process.exit(0)) })
process.once('SIGTERM', () => { void stop().finally(() => process.exit(0)) })
