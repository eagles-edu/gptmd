import { execFile } from 'node:child_process'
import { chmod, copyFile, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { parse } from 'dotenv'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const sourceEnvPath = fileURLToPath(new URL('../.env', import.meta.url))
const liveEnvPath = '/home/eaglesvn/.config/gptmd-live/api.env'

export function setAnthropicApiKey(source, key) {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('The local Anthropic API key is missing or has unsupported characters.')
  }
  const lines = source.split(/\r?\n/)
  const matches = lines.filter((line) => line.startsWith('ANTHROPIC_API_KEY='))
  if (matches.length > 1) throw new Error('Expected at most one Anthropic API key setting.')
  const nextLine = `ANTHROPIC_API_KEY=${key}`
  if (matches.length) {
    return lines.map((line) => line.startsWith('ANTHROPIC_API_KEY=') ? nextLine : line).join('\n')
  }
  const suffix = source.endsWith('\n') || source.length === 0 ? '' : '\n'
  return `${source}${suffix}${nextLine}\n`
}

async function writeLiveKey(key) {
  const source = await readFile(liveEnvPath, 'utf8')
  const info = await stat(liveEnvPath)
  if ((info.mode & 0o777) !== 0o600 || info.uid !== process.getuid()) {
    throw new Error('The live API environment must be owned by the current user and remain mode 0600.')
  }
  const current = parse(source).ANTHROPIC_API_KEY?.trim()
  if (current && current !== key) {
    throw new Error('A different Anthropic API key is already configured in the live API environment; refusing to replace it.')
  }
  if (current === key) return false

  const next = setAnthropicApiKey(source, key)
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
  const backup = `${liveEnvPath}.pre-anthropic-${stamp}`
  const temporary = `${liveEnvPath}.next-${process.pid}`
  await copyFile(liveEnvPath, backup)
  await chmod(backup, info.mode & 0o777)
  try {
    await writeFile(temporary, next, { flag: 'wx', mode: info.mode & 0o777 })
    await chmod(temporary, info.mode & 0o777)
    await rename(temporary, liveEnvPath)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return true
}

async function waitForApi() {
  let failure = 'API readiness timed out.'
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4100/readyz', { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
      failure = `API returned HTTP ${response.status}.`
    } catch (error) {
      failure = error instanceof Error ? error.message : 'API readiness request failed.'
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`The live API did not recover after Anthropic configuration. ${failure}`)
}

async function configure() {
  const source = parse(await readFile(sourceEnvPath, 'utf8'))
  const key = source.ANTHROPIC_API_KEY?.trim() ?? ''
  if (!key) throw new Error('No Anthropic API key is configured in the local .env.')

  const changed = await writeLiveKey(key)
  if (changed) {
    await execFileAsync('sudo', ['/usr/bin/systemctl', 'restart', 'gptmd-live-api.service'], { timeout: 20_000 })
  }
  await waitForApi()
  process.stdout.write(`Live Anthropic configuration ${changed ? 'updated' : 'already matched'}; API is ready. Key material was not printed.\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configure().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
