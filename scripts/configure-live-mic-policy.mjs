import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const nginxHeaders = '/etc/nginx/snippets/security-headers.conf'
const nginxMap = '/etc/nginx/conf.d/gptmd-permissions-policy-map.conf'
const mapSource = new URL('../ops/nginx/gptmd-permissions-policy-map.conf', import.meta.url)
const restrictiveDirective = 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;'
const mappedDirective = 'add_header Permissions-Policy $gptmd_permissions_policy always;'

if (process.getuid() !== 0) {
  throw new Error('Run this host configuration step with sudo.')
}

const [headersOriginal, mapNext] = await Promise.all([
  readFile(nginxHeaders, 'utf8'),
  readFile(mapSource, 'utf8')
])
const mapOriginal = await readFile(nginxMap, 'utf8').catch(() => null)
const restrictiveCount = headersOriginal.split(restrictiveDirective).length - 1
const isMapped = headersOriginal.includes(mappedDirective)

if (!isMapped && restrictiveCount !== 1) {
  throw new Error(`Expected one known restrictive Permissions-Policy directive; found ${restrictiveCount}. No files were changed.`)
}

if (isMapped && mapOriginal === mapNext) {
  await execFileAsync('nginx', ['-t'])
  process.stdout.write('GPTMD live microphone policy is already installed and valid.\n')
  process.exit(0)
}

const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
const headersBackup = `${nginxHeaders}.pre-gptmd-mic-${stamp}`
const mapBackup = mapOriginal === null ? null : `${nginxMap}.pre-gptmd-mic-${stamp}`
const headersNext = isMapped
  ? headersOriginal
  : headersOriginal.replace(restrictiveDirective, mappedDirective)

await copyFile(nginxHeaders, headersBackup)
if (mapBackup) await copyFile(nginxMap, mapBackup)
await writeFile(nginxHeaders, headersNext)
await writeFile(nginxMap, mapNext, { mode: 0o644 })

try {
  await execFileAsync('nginx', ['-t'])
  await execFileAsync('systemctl', ['reload', 'nginx'])
} catch (error) {
  await writeFile(nginxHeaders, headersOriginal)
  if (mapOriginal === null) await rm(nginxMap, { force: true })
  else await writeFile(nginxMap, mapOriginal)
  await execFileAsync('nginx', ['-t']).catch(() => undefined)
  throw new Error(`Nginx rejected the GPTMD microphone policy; restored its prior files. Backup: ${headersBackup}. ${error.message}`, { cause: error })
}

process.stdout.write(`Installed hostname-scoped GPTMD microphone policy. Backup: ${headersBackup}${mapBackup ? `, ${mapBackup}` : ''}\n`)
