import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { getE2ECertificate } from '../../scripts/e2e-certificate.mjs'

export async function startMockSupabase(
  port = 3003,
  allowedOrigin = 'https://localhost:3002'
): Promise<() => Promise<void>> {
  const user = {
    id: 'a18f0de1-7b60-49b6-8eaf-19ac1e6b1c0d',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'preflight@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Preflight Test User' },
    created_at: '2026-01-01T00:00:00.000Z'
  }
  const { key, cert } = getE2ECertificate()
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
    response.setHeader('access-control-allow-origin', allowedOrigin)
    response.setHeader(
      'access-control-allow-headers',
      request.headers['access-control-request-headers'] ?? 'apikey, authorization, x-client-info, content-type'
    )
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    if (request.url?.startsWith('/auth/v1/user')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(user))
      return
    }
    response.writeHead(404)
    response.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', resolve)
  })

  return () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

export default async function setupPreflightAuth(): Promise<() => Promise<void>> {
  return startMockSupabase()
}
