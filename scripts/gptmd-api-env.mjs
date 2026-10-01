import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const mode = process.argv[2]
if (!['dev', 'start'].includes(mode)) {
  process.stderr.write('Usage: gptmd-api-env.mjs <dev|start>\n')
  process.exit(2)
}

const apiRoot = fileURLToPath(new URL('../services/api/', import.meta.url))
const values = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'))
const allowed = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'REDIS_URL',
  'DATABASE_URL',
  'API_AUTH_JWT_SECRET',
  'API_AUTH_JWT_ISSUER',
  'API_AUTH_JWT_AUDIENCE',
  'API_AUTH_JWT_JWKS_URL',
  'API_CORS_ORIGINS',
  'HOST',
  'PORT'
]
const env = Object.fromEntries(
  allowed.flatMap((key) => values[key] ? [[key, values[key]]] : [])
)
for (const key of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'NODE_ENV']) {
  if (process.env[key]) env[key] = process.env[key]
}

const args = mode === 'dev'
  ? ['--import', 'tsx', '--watch', 'src/server.ts']
  : ['dist/server.js']
const child = spawn(process.execPath, args, {
  cwd: apiRoot,
  env,
  stdio: 'inherit'
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal))
}
child.once('error', (error) => {
  process.stderr.write(`Could not start GPTMD API: ${error.message}\n`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
