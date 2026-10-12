import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const sourceVhost = '/etc/nginx/sites-available/obgyn.eaglesvn.club.conf'
const defaultSink = '/etc/nginx/conf.d/00-default-sink.conf'
const overlaySource = new URL('../ops/nginx/gptmd-live-locations.conf', import.meta.url)
const overlayTarget = '/etc/nginx/snippets/gptmd-live-locations.conf'
const marker = '# GPTMD live test app routing'
const overlay = await readFile(overlaySource, 'utf8')

if (process.getuid() !== 0) {
  throw new Error('Run this host configuration step with sudo.')
}

let original
let sinkOriginal
try {
  original = await readFile(sourceVhost, 'utf8')
  sinkOriginal = await readFile(defaultSink, 'utf8')
} catch {
  throw new Error('Cannot read the selected GPTMD vhost and default TLS sink configuration.')
}

if (!original.includes('server_name obgyn.eaglesvn.club www.obgyn.eaglesvn.club;')) {
  throw new Error('The selected Nginx vhost no longer names the GPTMD test host.')
}

if (original.includes(marker)) {
  const installedOverlay = await readFile(overlayTarget, 'utf8').catch(() => '')
  if (installedOverlay !== overlay) {
    const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
    const backup = installedOverlay ? `${overlayTarget}.pre-gptmd-${stamp}` : ''
    if (backup) await copyFile(overlayTarget, backup)
    await writeFile(overlayTarget, overlay, { mode: 0o644 })
    try {
      await execFileAsync('nginx', ['-t'])
      await execFileAsync('systemctl', ['reload', 'nginx'])
    } catch (error) {
      if (installedOverlay) await writeFile(overlayTarget, installedOverlay)
      else await rm(overlayTarget, { force: true })
      await execFileAsync('nginx', ['-t']).catch(() => undefined)
      throw new Error(`Nginx rejected the updated GPTMD routing; restored the previous include${backup ? ` from ${backup}` : ''}. ${error.message}`, { cause: error })
    }
    process.stdout.write(`Updated GPTMD test routing include${backup ? `. Backup: ${backup}` : ''}.\n`)
    process.exit(0)
  }
  await execFileAsync('nginx', ['-t'])
  await execFileAsync('systemctl', ['reload', 'nginx'])
  process.stdout.write('GPTMD test routing is already installed and Nginx reloaded.\n')
  process.exit(0)
}

const sinkListen = 'listen 443 ssl default_server;'
const sinkListenCount = sinkOriginal.split(sinkListen).length - 1
if (sinkListenCount !== 1) {
  throw new Error(`Expected one default TLS sink listener before aligning HTTP/2 options; found ${sinkListenCount}.`)
}

const originProxy = 'proxy_pass http://127.0.0.1:8088;'
const proxyCount = original.split(originProxy).length - 1
if (proxyCount !== 2) {
  throw new Error(`Expected the original two OpenLiteSpeed proxy locations; found ${proxyCount}.`)
}

const cacheMarker = '    # Browser cache for static assets; dynamic responses remain uncached.'
if (!original.includes(cacheMarker)) {
  throw new Error('Cannot find the known static-asset location in the current vhost.')
}

const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
const backup = `${sourceVhost}.pre-gptmd-${stamp}`
const sinkBackup = `${defaultSink}.pre-gptmd-${stamp}`
const next = original
  .replaceAll(originProxy, 'proxy_pass http://127.0.0.1:3100;')
  .replace(cacheMarker, `    ${marker}\n    include ${overlayTarget};\n\n${cacheMarker}`)

await copyFile(sourceVhost, backup)
await copyFile(defaultSink, sinkBackup)
await writeFile(overlayTarget, overlay, { mode: 0o644 })
await writeFile(sourceVhost, next)
await writeFile(defaultSink, sinkOriginal.replace(sinkListen, 'listen 443 ssl http2 default_server;'))

try {
  await execFileAsync('nginx', ['-t'])
  await execFileAsync('systemctl', ['reload', 'nginx'])
} catch (error) {
  await writeFile(sourceVhost, original)
  await writeFile(defaultSink, sinkOriginal)
  await execFileAsync('nginx', ['-t']).catch(() => undefined)
  throw new Error(`Nginx rejected GPTMD routing; restored the vhost and TLS sink from ${backup} and ${sinkBackup}. ${error.message}`, { cause: error })
}

process.stdout.write(`Installed GPTMD routing in ${sourceVhost}. Backups: ${backup}, ${sinkBackup}\n`)
