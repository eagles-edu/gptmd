import { execFile } from 'node:child_process'
import { chmod, copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { parse } from 'dotenv'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const email = 'onlineadmin@eaglesvn.online'
const envPath = '/home/eaglesvn/.config/gptmd-live/api.env'
const subjectPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function appendSubject(source, subject) {
  if (!subjectPattern.test(subject)) throw new Error('The verified system-admin subject is not a UUID.')
  const lines = source.split(/\r?\n/)
  const matches = lines.filter((line) => line.startsWith('GPTMD_SYSTEM_ADMIN_SUBJECTS='))
  if (matches.length > 1) throw new Error('Expected at most one system-admin subject setting.')
  const existing = matches[0]?.slice('GPTMD_SYSTEM_ADMIN_SUBJECTS='.length).replace(/^("|')(.*)\1$/, '$2') ?? ''
  const subjects = existing.split(',').map((value) => value.trim()).filter(Boolean)
  if (subjects.some((value) => !subjectPattern.test(value))) {
    throw new Error('The existing system-admin subject list contains an invalid value.')
  }
  if (subjects.includes(subject)) return source
  subjects.push(subject)
  const nextLine = `GPTMD_SYSTEM_ADMIN_SUBJECTS=${subjects.join(',')}`
  if (matches.length) return lines.map((line) => line.startsWith('GPTMD_SYSTEM_ADMIN_SUBJECTS=') ? nextLine : line).join('\n')
  const suffix = source.endsWith('\n') || source.length === 0 ? '' : '\n'
  return `${source}${suffix}${nextLine}\n`
}

async function resolveSubject() {
  const { stdout } = await execFileAsync('docker', [
    'exec', 'supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
    "SELECT id::text FROM auth.users WHERE lower(email) = lower('onlineadmin@eaglesvn.online') AND deleted_at IS NULL"
  ], { encoding: 'utf8', timeout: 10_000 })
  const subjects = stdout.trim().split(/\r?\n/).filter(Boolean)
  if (subjects.length !== 1 || !subjectPattern.test(subjects[0] ?? '')) {
    throw new Error(subjects.length === 0
      ? `No active Supabase Auth identity found for ${email}.`
      : `Expected exactly one active Supabase Auth identity for ${email}; refusing to configure.`)
  }
  return subjects[0]
}

async function writeEnvironment(subject) {
  const source = await readFile(envPath, 'utf8')
  const info = await stat(envPath)
  if ((info.mode & 0o777) !== 0o600 || info.uid !== process.getuid()) {
    throw new Error('The live API environment must be owned by the current user and remain mode 0600.')
  }
  const next = appendSubject(source, subject)
  if (next === source) return false

  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
  const backup = `${envPath}.pre-system-admin-${stamp}`
  const temporary = `${envPath}.next-${process.pid}`
  await copyFile(envPath, backup)
  await chmod(backup, info.mode & 0o777)
  await writeFile(temporary, next, { mode: info.mode & 0o777 })
  await chmod(temporary, info.mode & 0o777)
  await rename(temporary, envPath)
  return true
}

async function configure() {
  const subject = await resolveSubject()
  const changed = await writeEnvironment(subject)
  const parsed = parse(await readFile(envPath, 'utf8'))
  const subjects = (parsed.GPTMD_SYSTEM_ADMIN_SUBJECTS ?? '').split(',').map((value) => value.trim())
  if (!subjects.includes(subject)) throw new Error('The verified subject was not retained in the API environment.')

  await execFileAsync('sudo', ['/usr/bin/systemctl', 'restart', 'gptmd-live-api.service'], { timeout: 20_000 })
  let ready = false
  let failure = 'API readiness timed out.'
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4100/readyz', { signal: AbortSignal.timeout(2_000) })
      if (response.ok) {
        ready = true
        break
      }
      failure = `API returned HTTP ${response.status}.`
    } catch (error) {
      failure = error instanceof Error ? error.message : 'API readiness request failed.'
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  if (!ready) throw new Error(`The system-admin identity was written, but the API did not recover. ${failure}`)
  process.stdout.write(`Verified ${email} against one active Supabase Auth identity; system-admin allowlist ${changed ? 'updated' : 'already current'}, API ready. Subject and credentials were not printed.\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configure().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
