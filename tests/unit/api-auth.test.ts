import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { verifyAccessToken } from '../../services/api/src/auth.ts'

const issuer = 'https://auth.example.test/auth/v1'

describe('Supabase access-token verification', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve())
      })
    }
    server = undefined
  })

  it('verifies ES256 tokens against Supabase public JWKS without needing its private signing key', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256')
    const publicJwk = await exportJWK(publicKey)
    const keys = [{ ...publicJwk, kid: 'gptmd-test-key', alg: 'ES256', use: 'sig' }]
    server = requireHttpServer(keys)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('JWKS test server did not bind.')

    const token = await new SignJWT({ sub: 'supabase-user-uuid', aud: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'gptmd-test-key', typ: 'JWT' })
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
    const principal = await verifyAccessToken(token, {
      secret: null,
      issuer,
      audience: 'authenticated',
      jwksUrl: `http://127.0.0.1:${address.port}/auth/v1/.well-known/jwks.json`
    })

    expect(principal).toEqual({ subjectId: 'supabase-user-uuid' })
  })
})

function requireHttpServer(keys: object[]): Server {
  const created = createServer((request, response) => {
    if (request.url !== '/auth/v1/.well-known/jwks.json') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' })
    response.end(JSON.stringify({ keys }))
  })
  created.listen(0, '127.0.0.1')
  return created
}
