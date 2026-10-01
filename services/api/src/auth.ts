import { createHmac, timingSafeEqual } from 'node:crypto'

export interface AuthenticatedPrincipal {
  subjectId: string
  tenantId: string
}

declare module 'express-serve-static-core' {
  interface Request {
    principal?: AuthenticatedPrincipal
  }
}

interface JwtClaims {
  sub?: unknown
  tenant_id?: unknown
  iss?: unknown
  aud?: unknown
  exp?: unknown
  nbf?: unknown
}

export interface JwtConfiguration {
  secret: string | null
  issuer: string | null
  audience: string | null
}

export const isJwtConfigurationReady = (configuration: JwtConfiguration): boolean =>
  Boolean(
    configuration.secret && Buffer.byteLength(configuration.secret) >= 32 &&
    configuration.issuer && configuration.audience
  )

const decodeJson = (segment: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const audienceMatches = (audience: unknown, expected: string): boolean =>
  audience === expected || (Array.isArray(audience) && audience.includes(expected))

export function verifyAccessToken(
  token: string,
  configuration: JwtConfiguration,
  nowSeconds = Math.floor(Date.now() / 1000)
): AuthenticatedPrincipal | null {
  const { secret, issuer, audience } = configuration
  if (!isJwtConfigurationReady(configuration) || !secret || !issuer || !audience) return null

  const segments = token.split('.')
  if (segments.length !== 3) return null
  const [encodedHeader, encodedClaims, encodedSignature] = segments
  if (!encodedHeader || !encodedClaims || !encodedSignature) return null

  const header = decodeJson(encodedHeader)
  const claims = decodeJson(encodedClaims) as JwtClaims | null
  if (header?.alg !== 'HS256' || header.typ !== 'JWT' || !claims) return null

  const expected = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedClaims}`)
    .digest()
  let supplied: Buffer
  try {
    supplied = Buffer.from(encodedSignature, 'base64url')
  } catch {
    return null
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null

  if (claims.iss !== issuer || !audienceMatches(claims.aud, audience)) return null
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds) return null
  if (claims.nbf !== undefined && (
    typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > nowSeconds
  )) return null
  if (typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 200) return null
  if (typeof claims.tenant_id !== 'string' || !claims.tenant_id.trim() || claims.tenant_id.length > 200) return null

  return { subjectId: claims.sub, tenantId: claims.tenant_id }
}
