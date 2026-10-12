import { execFile } from 'node:child_process'
import { access, mkdir, readFile, readlink, readdir, rename, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { parse } from 'dotenv'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const deployRoot = '/home/obgyn.eaglesvn.club/gptmd'
const stageRoot = join(deployRoot, 'staging')
const releaseRoot = join(deployRoot, 'releases')
const currentLink = join(deployRoot, 'current')
const liveEnvPath = '/home/eaglesvn/.config/gptmd-live/api.env'
const freeFileSync = '/usr/bin/FreeFileSync'
const batchJobs = [
  join(repoRoot, 'ops/freefilesync/gptmd-live-web.ffs_batch'),
  join(repoRoot, 'ops/freefilesync/gptmd-live-api.ffs_batch')
]

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, { timeout: 120_000, ...options })
  } catch (error) {
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message
    throw new Error(`${command} failed: ${detail}`, { cause: error })
  }
}

async function assertNoSecrets(directory, hits = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await assertNoSecrets(path, hits)
    } else if (/^\.env(?:\.|$)|\.pem$|\.key$/i.test(entry.name)) {
      hits.push(path)
    }
  }
  return hits
}

async function waitFor(url, label) {
  let lastStatus = 'unreachable'
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
      lastStatus = String(response.status)
      if (response.ok) return
    } catch (error) {
      lastStatus = error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`${label} did not become ready (${lastStatus}).`)
}

if (process.getuid() === 0) {
  throw new Error('Run npm run deploy:live as eaglesvn so release files keep the service owner.')
}

await access(liveEnvPath)
await mkdir(join(stageRoot, 'web'), { recursive: true })
await mkdir(join(stageRoot, 'api'), { recursive: true })
for (const job of batchJobs) await run(freeFileSync, [job])

const apiStage = join(stageRoot, 'api')
const expected = [
  join(stageRoot, 'web/server/index.mjs'),
  join(apiStage, 'dist/server.js'),
  join(apiStage, 'dist/worker.js'),
  join(apiStage, 'catalog/patient-profile.json'),
  join(apiStage, 'package.json'),
  join(apiStage, 'package-lock.json')
]
for (const path of expected) await access(path)

await run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: apiStage })
const secretFiles = await assertNoSecrets(stageRoot)
if (secretFiles.length) {
  throw new Error(`Refusing release with secret-looking files: ${secretFiles.map((path) => path.slice(stageRoot.length + 1)).join(', ')}`)
}

const liveEnv = parse(await readFile(liveEnvPath, 'utf8'))
if (!liveEnv.DATABASE_URL || !liveEnv.REDIS_URL) {
  throw new Error('The private GPTMD live API environment must set DATABASE_URL and REDIS_URL.')
}
const pgModule = await import(pathToFileURL(join(apiStage, 'node_modules/pg/lib/index.js')))
const Client = pgModule.Client ?? pgModule.default.Client
const database = new Client({ connectionString: liveEnv.DATABASE_URL })
await database.connect()
await database.query(`
  CREATE TABLE IF NOT EXISTS gptmd_schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`)
const migrationsRoot = join(apiStage, 'migrations')
const migrationFiles = (await readdir(migrationsRoot)).filter((name) => name.endsWith('.sql')).sort()
for (const filename of migrationFiles) {
  const applied = await database.query('SELECT 1 FROM gptmd_schema_migrations WHERE filename = $1', [filename])
  if (applied.rowCount) continue
  await database.query(await readFile(join(migrationsRoot, filename), 'utf8'))
  await database.query('INSERT INTO gptmd_schema_migrations (filename) VALUES ($1)', [filename])
  process.stdout.write(`Applied database migration ${filename}\n`)
}
await database.end()

const previousRelease = await readlink(currentLink).catch(() => '')
const releaseId = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
const release = join(releaseRoot, releaseId)
await rename(stageRoot, release)
const nextLink = join(deployRoot, `current.next-${process.pid}`)
await symlink(release, nextLink)
await rename(nextLink, currentLink)

try {
  await run('sudo', ['systemctl', 'restart', 'gptmd-live-web.service', 'gptmd-live-api.service', 'gptmd-live-worker.service'])
  await waitFor('http://127.0.0.1:3100/', 'GPTMD web service')
  await waitFor('http://127.0.0.1:4100/readyz', 'GPTMD API')
} catch (error) {
  if (previousRelease) {
    const rollbackLink = join(deployRoot, `current.rollback-${process.pid}`)
    await symlink(previousRelease, rollbackLink)
    await rename(rollbackLink, currentLink)
    await run('sudo', ['systemctl', 'restart', 'gptmd-live-web.service', 'gptmd-live-api.service', 'gptmd-live-worker.service']).catch(() => undefined)
  }
  throw error
}

process.stdout.write(`GPTMD release ${releaseId} is ready on loopback; Nginx routes the live hostname separately.\n`)
