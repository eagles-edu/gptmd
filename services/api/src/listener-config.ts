import { isIP } from 'node:net'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export function resolveApiListenerHost(env: NodeJS.ProcessEnv): string {
  const host = env.HOST ?? '127.0.0.1'
  if (LOOPBACK_HOSTS.has(host)) return host
  if (host === '0.0.0.0' && env.GPTMD_PRIVATE_COMPOSE_BIND === 'true') return host
  throw new Error(`Refusing non-loopback HOST: ${host}`)
}

export function resolveTrustedProxyAddresses(env: NodeJS.ProcessEnv): string[] {
  const raw = env.API_TRUSTED_PROXY_ADDRESSES?.trim()
  if (!raw) return []

  const addresses = raw.split(',').map((value) => value.trim())
  if (addresses.some((value) => value.length === 0)) {
    throw new Error('API_TRUSTED_PROXY_ADDRESSES must be a comma-separated list of IP addresses or CIDRs')
  }

  for (const value of addresses) {
    const [address, prefix, ...extra] = value.split('/')
    const version = address ? isIP(address) : 0
    const maxPrefix = version === 4 ? 32 : version === 6 ? 128 : 0
    const parsedPrefix = prefix === undefined ? maxPrefix : Number(prefix)
    if (version === 0 || extra.length > 0 || !Number.isInteger(parsedPrefix) || parsedPrefix < 1 || parsedPrefix > maxPrefix) {
      throw new Error('API_TRUSTED_PROXY_ADDRESSES must contain valid IP addresses or non-default CIDRs')
    }
  }

  return addresses
}
