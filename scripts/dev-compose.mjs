import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  composeEnvironment,
  validateComposeLogPolicy,
  validateComposeNetworkTopology
} from './dev-compose-config.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const localEnvPath = fileURLToPath(new URL('../.env', import.meta.url))

if (!existsSync(localEnvPath)) {
  process.stderr.write('Missing .env. Follow the Local setup instructions in README.md first.\n')
  process.exit(1)
}

const localEnv = parseEnv(await readFile(localEnvPath, 'utf8'))
let composeValues
try {
  composeValues = composeEnvironment(localEnv)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Invalid local Compose settings'}\n`)
  process.exit(1)
}

const configOnly = process.argv.includes('--config')
const downOnly = process.argv.includes('--down')
if (configOnly && downOnly) {
  process.stderr.write('Choose either --config or --down.\n')
  process.exit(1)
}
const args = [
  'compose', '--env-file', '.env', '-f', 'ops/dev.compose.yml',
  ...(configOnly ? ['config', '--format', 'json'] : downOnly ? ['down'] : ['up', '--build'])
]

let composeConfig = ''
const compose = spawn('docker', args, {
  cwd: projectRoot,
  stdio: configOnly ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  env: { ...process.env, ...composeValues }
})

if (configOnly) compose.stdout.setEncoding('utf8').on('data', (chunk) => { composeConfig += chunk })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => compose.kill(signal))
}

compose.once('error', (error) => {
  process.stderr.write(`Could not start Docker Compose: ${error.message}\n`)
  process.exitCode = 1
})
compose.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
  if (process.exitCode === 0 && configOnly) {
    try {
      const config = JSON.parse(composeConfig)
      validateComposeNetworkTopology(config)
      validateComposeLogPolicy(config)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'Invalid local Compose network topology'}\n`)
      process.exitCode = 1
    }
  }
})
