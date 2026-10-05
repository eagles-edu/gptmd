import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose'

export interface AuthenticatedPrincipal {
  subjectId: string
  tenantId: string
  role: TenantRole
}

export const TENANT_ROLES = ['learner', 'instructor', 'customer_admin'] as const
export type TenantRole = typeof TENANT_ROLES[number]

export interface AuthenticatedIdentity {
  subjectId: string
  tenantId?: string
}

declare module 'express-serve-static-core' {
  interface Request {
    principal?: AuthenticatedPrincipal
    identity?: AuthenticatedIdentity
  }
}

export interface JwtClaims extends JWTPayload {
  sub?: string
  tenant_id?: unknown
}

export interface JwtConfiguration {
  secret: string | null
  issuer: string | null
  audience: string | null
  jwksUrl?: string | null
}

const remoteKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function isValidJwksUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}

export const isJwtConfigurationReady = (configuration: JwtConfiguration): boolean =>
  Boolean(
    (configuration.secret && Buffer.byteLength(configuration.secret) >= 32) ||
    isValidJwksUrl(configuration.jwksUrl)
  ) && Boolean(configuration.issuer && configuration.audience)

function getRemoteKeys(url: string): ReturnType<typeof createRemoteJWKSet> {
  let keySet = remoteKeys.get(url)
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(url))
    remoteKeys.set(url, keySet)
  }
  return keySet
}

export async function verifyAccessToken(
  token: string,
  configuration: JwtConfiguration,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<AuthenticatedIdentity | null> {
  const { secret, issuer, audience, jwksUrl } = configuration
  if (!isJwtConfigurationReady(configuration) || !issuer || !audience) return null

  let algorithm: string | undefined
  try {
    algorithm = decodeProtectedHeader(token).alg
  } catch {
    return null
  }
  let claims: JwtClaims
  try {
    if (algorithm === 'HS256' && secret && Buffer.byteLength(secret) >= 32) {
      const result = await jwtVerify(token, Buffer.from(secret), {
        algorithms: ['HS256'],
        issuer,
        audience,
        currentDate: new Date(nowSeconds * 1000)
      })
      claims = result.payload as JwtClaims
    } else if (algorithm === 'ES256' && isValidJwksUrl(jwksUrl)) {
      const result = await jwtVerify(token, getRemoteKeys(jwksUrl), {
        algorithms: ['ES256'],
        issuer,
        audience,
        currentDate: new Date(nowSeconds * 1000)
      })
      claims = result.payload as JwtClaims
    } else {
      return null
    }
  } catch {
    return null
  }

  if (typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 200) return null
  const tenantId = typeof claims.tenant_id === 'string' && claims.tenant_id.trim() && claims.tenant_id.length <= 200
    ? claims.tenant_id
    : undefined

  // Supabase Auth does not issue a GPTMD tenant claim. A tenant claim from an
  // existing/custom issuer may guide selection, but membership is still checked.
  return tenantId ? { subjectId: claims.sub, tenantId } : { subjectId: claims.sub }
}
