import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const [serverName] = process.argv.slice(2)
if (!['redis', 'postgres'].includes(serverName)) {
  process.stderr.write('Usage: gptmd-mcp-launcher.mjs <redis|postgres>\n')
  process.exit(2)
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const localEnv = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'))
const inherited = Object.fromEntries(
  ['PATH', 'HOME', 'LANG', 'TMPDIR'].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : [])
)

let command
let args
const env = { ...inherited }

if (serverName === 'redis') {
  const value = localEnv.REDIS_URL
  if (!value) throw new Error('REDIS_URL is missing from the ignored .env file.')
  const url = new URL(value)
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://.')
  }

  command = '/home/eaglesvn/.local/bin/uvx'
  args = ['-qq', '--with', 'mcp<2', '--from', 'redis-mcp-server@0.2.0', 'redis-mcp-server']
  Object.assign(env, {
    REDIS_HOST: url.hostname,
    REDIS_PORT: url.port || '6379',
    REDIS_DB: url.pathname.slice(1) || '0',
    REDIS_USERNAME: decodeURIComponent(url.username) || 'default',
    REDIS_PWD: decodeURIComponent(url.password),
    REDIS_SSL: url.protocol === 'rediss:' ? 'true' : 'false'
  })
} else {
  const connectionString = localEnv.POSTGRES_MCP_CONNECTION_STRING
  if (!connectionString) {
    throw new Error('POSTGRES_MCP_CONNECTION_STRING is missing from the ignored .env file.')
  }

  command = '/usr/bin/npx'
  args = ['-y', '@microsoft/postgres-mcp@0.2.0', 'run', '--no-telemetry']
  Object.assign(env, {
    POSTGRES_MCP_CONNECTION_STRING: connectionString,
    POSTGRES_MCP_PROFILE_NAME: 'gptmd_local_ro',
    POSTGRES_MCP_DISABLE_CWD_ACCESS: '1'
  })
}

const child = spawn(command, args, {
  cwd: projectRoot,
  env,
  stdio: 'inherit'
})
child.once('error', (error) => {
  process.stderr.write(`Could not start ${serverName} MCP: ${error.message}\n`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
