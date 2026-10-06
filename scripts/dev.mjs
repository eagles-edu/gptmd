import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const localEnvPath = fileURLToPath(new URL('../.env', import.meta.url))

if (!existsSync(localEnvPath)) {
  process.stderr.write('Missing .env. Follow the Local setup instructions in README.md first.\n')
  process.exit(1)
}

const localEnv = parseEnv(await readFile(localEnvPath, 'utf8'))
const apiPort = Number(localEnv.PORT || 4000)

process.stdout.write('Starting local PostgreSQL...\n')
const database = spawnSync('docker', [
  'compose', '--env-file', '.env', '-f', 'ops/postgres.compose.yml', 'up', '-d'
], { cwd: projectRoot, stdio: 'inherit' })

if (database.error) {
  process.stderr.write(`Could not start PostgreSQL: ${database.error.message}\n`)
  process.exit(1)
}
if (database.status !== 0) process.exit(database.status ?? 1)

const children = new Map()
let stopping = false
let exitCode = 0

function stopAll(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of children.values()) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
  if (children.size === 0) process.exit(exitCode)
}

function startService(name, executable, args) {
  process.stdout.write(`Starting ${name}...\n`)
  const child = spawn(executable, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  })
  children.set(name, child)

  child.once('error', (error) => {
    process.stderr.write(`[${name}] Could not start: ${error.message}\n`)
    exitCode = 1
    stopAll()
  })
  child.once('exit', (code, signal) => {
    children.delete(name)
    if (!stopping) {
      exitCode = code ?? 1
      process.stderr.write(`[${name}] exited${signal ? ` after ${signal}` : ` with code ${code}`}; stopping the other dev service.\n`)
      stopAll()
    } else if (children.size === 0) {
      process.exit(exitCode)
    }
  })
}

async function waitForApi() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && !stopping && children.has('API')) {
    try {
      await fetch(`http://127.0.0.1:${apiPort}/readyz`, {
        signal: AbortSignal.timeout(1_000)
      })
      return
    } catch {
      await delay(250)
    }
  }
  if (!stopping) {
    process.stderr.write(`[API] Did not respond on 127.0.0.1:${apiPort} within 30 seconds.\n`)
    exitCode = 1
    stopAll()
  }
}

process.on('SIGINT', () => stopAll('SIGINT'))
process.on('SIGTERM', () => stopAll('SIGTERM'))

startService('API', process.execPath, ['scripts/gptmd-api-env.mjs', 'dev'])
await waitForApi()
if (!stopping) startService('API worker', process.execPath, ['scripts/gptmd-api-env.mjs', 'worker:dev'])
if (!stopping) startService('Nuxt', process.execPath, ['node_modules/nuxt/bin/nuxt.mjs', 'dev', '--port', '3000'])
