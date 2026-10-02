import { createServer } from 'node:http'

export default async function setupPreflightAuth(): Promise<() => Promise<void>> {
  const user = {
    id: 'a18f0de1-7b60-49b6-8eaf-19ac1e6b1c0d',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'preflight@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Preflight Test User' },
    created_at: '2026-01-01T00:00:00.000Z'
  }
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', 'http://127.0.0.1:3002')
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
    server.listen(3003, '127.0.0.1', resolve)
  })

  return () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}
