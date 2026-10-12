import { describe, expect, it } from 'vitest'
import { resolveApiListenerHost, resolveTrustedProxyAddresses } from '../../services/api/src/listener-config.ts'

describe('API listener host', () => {
  it.each(['127.0.0.1', 'localhost', '::1'])('allows loopback host %s', (host) => {
    expect(resolveApiListenerHost({ HOST: host })).toBe(host)
  })

  it('defaults to IPv4 loopback', () => {
    expect(resolveApiListenerHost({})).toBe('127.0.0.1')
  })

  it('allows all-interface binding only for the explicitly private Compose service', () => {
    expect(() => resolveApiListenerHost({ HOST: '0.0.0.0' }))
      .toThrow('Refusing non-loopback HOST: 0.0.0.0')
    expect(resolveApiListenerHost({ HOST: '0.0.0.0', GPTMD_PRIVATE_COMPOSE_BIND: 'true' }))
      .toBe('0.0.0.0')
    expect(() => resolveApiListenerHost({ HOST: '0.0.0.0', GPTMD_PRIVATE_COMPOSE_BIND: '1' }))
      .toThrow('Refusing non-loopback HOST: 0.0.0.0')
  })

  it('rejects arbitrary non-loopback interface addresses even in Compose mode', () => {
    expect(() => resolveApiListenerHost({ HOST: '192.168.1.20', GPTMD_PRIVATE_COMPOSE_BIND: 'true' }))
      .toThrow('Refusing non-loopback HOST: 192.168.1.20')
  })
})

describe('trusted reverse proxy addresses', () => {
  it('trusts no forwarded address by default', () => {
    expect(resolveTrustedProxyAddresses({})).toEqual([])
  })

  it('accepts an explicit comma-separated IP and CIDR list', () => {
    expect(resolveTrustedProxyAddresses({ API_TRUSTED_PROXY_ADDRESSES: '127.0.0.1, 2001:db8::/48' }))
      .toEqual(['127.0.0.1', '2001:db8::/48'])
  })

  it.each([
    '*',
    '0.0.0.0/0',
    '::/0',
    'proxy.internal',
    '127.0.0.1,',
    '192.0.2.1/33'
  ])('rejects unsafe or invalid proxy entry %s', (value) => {
    expect(() => resolveTrustedProxyAddresses({ API_TRUSTED_PROXY_ADDRESSES: value })).toThrow()
  })
})
