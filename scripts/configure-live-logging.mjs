import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const serviceNames = [
  'gptmd-live-web.service',
  'gptmd-live-api.service',
  'gptmd-live-worker.service'
]
const journalName = 'journald@gptmd-live.conf'
const journalTarget = `/etc/systemd/${journalName}`
const sourceRoot = new URL('../ops/systemd/', import.meta.url)
const targets = [
  ...serviceNames.map((name) => [new URL(name, sourceRoot), `/etc/systemd/system/${name}`]),
  [new URL(journalName, sourceRoot), journalTarget]
]

if (process.getuid() !== 0) throw new Error('Run this host logging configuration step with sudo.')

const originalJournalConfig = await readFile(journalTarget, 'utf8').catch(() => null)
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
const changes = []
for (const [source, target] of targets) {
  const next = await readFile(source, 'utf8')
  const previous = await readFile(target, 'utf8').catch(() => null)
  if (previous === next) continue
  const backup = previous === null ? null : `${target}.pre-gptmd-logging-${stamp}`
  if (backup) await copyFile(target, backup)
  await writeFile(target, next, { mode: 0o644 })
  changes.push({ target, previous, backup })
}

if (changes.length === 0) {
  process.stdout.write('GPTMD live journald retention is already configured.\n')
  process.exit(0)
}

async function run(command, args) {
  const { stdout, stderr } = await execFileAsync(command, args)
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
}

async function restore() {
  for (const { target, previous } of changes.reverse()) {
    if (previous === null) await rm(target, { force: true })
    else await writeFile(target, previous, { mode: 0o644 })
  }
  await run('systemctl', ['daemon-reload']).catch(() => undefined)
  if (originalJournalConfig === null) {
    await run('systemctl', ['stop', 'systemd-journald@gptmd-live.service']).catch(() => undefined)
  } else {
    await run('systemctl', ['restart', 'systemd-journald@gptmd-live.service']).catch(() => undefined)
  }
  await run('systemctl', ['restart', ...serviceNames]).catch(() => undefined)
}

try {
  await run('systemctl', ['daemon-reload'])
  await run('systemd-analyze', ['verify', ...serviceNames.map((name) => `/etc/systemd/system/${name}`)])
  await run('systemctl', ['restart', 'systemd-journald@gptmd-live.service'])
  await run('systemctl', ['restart', ...serviceNames])

  const deadline = Date.now() + 30_000
  let readiness = null
  let readinessFailure = 'Timed out waiting for local readiness.'
  while (Date.now() < deadline) {
    try {
      readiness = await Promise.all([
        fetch('http://127.0.0.1:3100/', { signal: AbortSignal.timeout(2000) }),
        fetch('http://127.0.0.1:4100/readyz', { signal: AbortSignal.timeout(2000) })
      ])
      if (readiness.every((response) => response.ok)) break
      readinessFailure = `Web/API returned ${readiness.map((response) => response.status).join('/')}.`
    } catch (error) {
      readinessFailure = error instanceof Error ? error.name : 'Readiness request failed.'
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  if (!readiness?.every((response) => response.ok)) {
    throw new Error(`Live web or API readiness failed after the logging restart. ${readinessFailure}`)
  }

  process.stdout.write(`Configured ${changes.length} GPTMD logging file(s). Backups: ${changes.map(({ backup }) => backup).filter(Boolean).join(', ') || 'none'}.\n`)
} catch (error) {
  await restore()
  throw new Error(`GPTMD journald configuration failed; restored previous service/config files. ${error.message}`, { cause: error })
}
