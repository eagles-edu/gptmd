import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, chown, copyFile, mkdir, open, readFile, stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const apiEnvPath = '/home/eaglesvn/.config/gptmd-live/api.env'
const keyPath = '/etc/gptmd-ops/hmac-key'
const groupName = 'gptmd-ops'
const unitDirectory = '/etc/systemd/system'
const agentPath = '/usr/local/lib/gptmd/gptmd-ops-agent.mjs'

export function validateKeyFileState({ contents, uid, gid, mode }, expectedGid) {
  if (!/^[a-f0-9]{64,}$/.test(contents) || contents.length % 2 !== 0 ||
      uid !== 0 || gid !== expectedGid || (mode & 0o777) !== 0o640) {
    throw new Error('The existing GPTMD operations key must be root-owned, group-readable by gptmd-ops, mode 0640, and contain at least 32 random bytes.')
  }
}

async function run(command, args) {
  return await execFileAsync(command, args, { encoding: 'utf8', timeout: 15_000 })
}

async function groupId() {
  const { stdout } = await run('/usr/bin/getent', ['group', groupName])
  const gid = Number(stdout.trim().split(':')[2])
  if (!Number.isInteger(gid) || gid < 1) throw new Error('The gptmd-ops group could not be resolved.')
  return gid
}

async function ensureGroup() {
  try {
    await groupId()
  } catch {
    await run('/usr/sbin/groupadd', ['--system', groupName])
  }
  return await groupId()
}

async function ensureKey(gid) {
  await mkdir('/etc/gptmd-ops', { recursive: true, mode: 0o750 })
  await chown('/etc/gptmd-ops', 0, gid)
  await chmod('/etc/gptmd-ops', 0o750)
  try {
    const info = await stat(keyPath)
    const contents = (await readFile(keyPath, 'utf8')).trim()
    validateKeyFileState({ contents, uid: info.uid, gid: info.gid, mode: info.mode }, gid)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const handle = await open(keyPath, 'wx', 0o640)
    try {
      await handle.writeFile(randomBytes(32).toString('hex'))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chown(keyPath, 0, gid)
    await chmod(keyPath, 0o640)
  }
}

async function installFile(source, target, mode = 0o644) {
  const contents = await readFile(source)
  const current = await readFile(target).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (current && current.equals(contents)) return
  if (current) {
    const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
    await copyFile(target, `${target}.pre-gptmd-ops-${stamp}`)
  }
  await mkdir(join(target, '..'), { recursive: true, mode: 0o755 })
  await copyFile(source, target)
  await chown(target, 0, 0)
  await chmod(target, mode)
}

function signedOperatorRequest(key) {
  const body = JSON.stringify({
    action: 'overview', actor: 'gptmd-live-ops-setup', requestId: randomUUID(),
    issuedAt: Date.now(), nonce: randomUUID()
  })
  const signature = createHmac('sha256', key).update(body).digest('hex')
  return new Promise((resolve, reject) => {
    const socket = createConnection('/run/gptmd-ops.sock')
    let response = ''
    const timer = setTimeout(() => socket.destroy(new Error('GPTMD operations socket timed out.')), 5_000)
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify({ body, signature })}\n`))
    socket.on('data', (chunk) => { response += chunk })
    socket.on('end', () => {
      clearTimeout(timer)
      try { resolve(JSON.parse(response)) } catch { reject(new Error('GPTMD operations socket returned an invalid response.')) }
    })
    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

export async function configureLiveOps() {
  if (process.getuid() !== 0) throw new Error('Run npm run configure:live-ops with sudo.')
  await accessApiEnvironment()
  const gid = await ensureGroup()
  await ensureKey(gid)

  await mkdir('/usr/local/lib/gptmd', { recursive: true, mode: 0o755 })
  await chown('/usr/local/lib/gptmd', 0, 0)
  await chmod('/usr/local/lib/gptmd', 0o755)
  await installFile(join(repoRoot, 'ops/gptmd-ops-agent.mjs'), agentPath)
  await installFile(join(repoRoot, 'ops/systemd/gptmd-ops.service'), join(unitDirectory, 'gptmd-ops.service'))
  await installFile(join(repoRoot, 'ops/systemd/gptmd-ops.socket'), join(unitDirectory, 'gptmd-ops.socket'))
  await installFile(
    join(repoRoot, 'ops/systemd/gptmd-live-api-ops.conf'),
    join(unitDirectory, 'gptmd-live-api.service.d/ops.conf')
  )

  await run('/usr/bin/systemctl', ['daemon-reload'])
  await run('/usr/bin/systemd-analyze', ['verify', join(unitDirectory, 'gptmd-ops.service'), join(unitDirectory, 'gptmd-ops.socket')])
  await run('/usr/bin/systemctl', ['enable', '--now', 'gptmd-ops.socket'])
  await run('/usr/bin/systemctl', ['restart', 'gptmd-live-api.service'])

  const deadline = Date.now() + 30_000
  let ready = false
  let readinessFailure = 'Timed out waiting for API readiness.'
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4100/readyz', { signal: AbortSignal.timeout(2_000) })
      if (response.ok) {
        ready = true
        break
      }
      readinessFailure = `API returned HTTP ${response.status}.`
    } catch (error) {
      readinessFailure = error instanceof Error ? error.message : 'API readiness request failed.'
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  if (!ready) throw new Error(`The API did not recover after the operations socket setup. ${readinessFailure}`)

  const apiUnit = await run('/usr/bin/systemctl', ['show', 'gptmd-live-api.service', '-p', 'SupplementaryGroups', '--value'])
  if (!apiUnit.stdout.split(/\s+/).includes(groupName)) {
    throw new Error('The API service does not have the required gptmd-ops supplementary group.')
  }
  const operatorKey = (await readFile(keyPath, 'utf8')).trim()
  const overview = await signedOperatorRequest(operatorKey)
  if (!overview.ok || overview.units?.length !== 3) {
    throw new Error('The restricted operator did not return all three GPTMD services.')
  }
  process.stdout.write('GPTMD restricted host operator is installed and responding. No system-admin identity was added; platform actions remain denied until an exact subject is configured.\n')
}

async function accessApiEnvironment() {
  await stat(apiEnvPath)
  const info = await stat(apiEnvPath)
  if ((info.mode & 0o777) !== 0o600) throw new Error('The private live API environment must remain mode 0600.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  configureLiveOps().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
