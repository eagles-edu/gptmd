import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function getE2ECertificate(directory = join(tmpdir(), 'gptmd-playwright-https')) {
  const key = join(directory, 'localhost-key.pem')
  const cert = join(directory, 'localhost-cert.pem')
  mkdirSync(directory, { recursive: true })

  let shouldGenerate = !existsSync(key) || !existsSync(cert)
  if (!shouldGenerate) {
    try {
      execFileSync('openssl', ['x509', '-in', cert, '-checkend', '604800', '-noout'], { stdio: 'ignore' })
    } catch {
      shouldGenerate = true
    }
  }

  if (shouldGenerate) {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
      '-keyout', key, '-out', cert,
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
    ], { stdio: 'ignore' })
  }

  return { key, cert }
}
