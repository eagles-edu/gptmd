import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function getE2ECertificate() {
  const directory = join(tmpdir(), 'gptmd-playwright-https')
  const key = join(directory, 'localhost-key.pem')
  const cert = join(directory, 'localhost-cert.pem')
  mkdirSync(directory, { recursive: true })

  if (!existsSync(key) || !existsSync(cert)) {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
      '-keyout', key, '-out', cert,
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
    ], { stdio: 'ignore' })
  }

  return { key, cert }
}
