import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getE2ECertificate } from '../../scripts/e2e-certificate.mjs'

describe('E2E HTTPS certificate', () => {
  let temporaryDirectory = ''

  afterEach(() => {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
    temporaryDirectory = ''
  })

  it('replaces an existing certificate that is inside the renewal window', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'gptmd-e2e-cert-test-'))
    const key = join(temporaryDirectory, 'localhost-key.pem')
    const cert = join(temporaryDirectory, 'localhost-cert.pem')
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
      '-keyout', key, '-out', cert,
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
    ], { stdio: 'ignore' })

    const renewed = getE2ECertificate(temporaryDirectory)

    expect(renewed.key).toBe(key)
    expect(renewed.cert).toBe(cert)
    expect(() => execFileSync('openssl', [
      'x509', '-in', renewed.cert, '-checkend', '604800', '-noout'
    ], { stdio: 'ignore' })).not.toThrow()
  })
})
