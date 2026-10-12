import { chmod, copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function setEnvValue(source, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  const lines = source.split(/\r?\n/)
  const matches = lines.reduce((count, line) => count + Number(line.startsWith(`${key}=`)), 0)
  if (matches > 1) throw new Error(`Expected at most one ${key} setting.`)
  if (pattern.test(source)) return source.replace(pattern, `${key}=${value}`)
  const suffix = source.endsWith('\n') || source.length === 0 ? '' : '\n'
  return `${source}${suffix}${key}=${value}\n`
}

export function appendEnvListValue(source, key, value) {
  const match = source.match(new RegExp(`^${key}=(.*)$`, 'm'))
  if (!match) return setEnvValue(source, key, value)
  const existing = match[1].replace(/^(["'])(.*)\1$/, '$2')
  const values = existing.split(',').map((item) => item.trim()).filter(Boolean)
  if (values.includes(value)) return source
  return setEnvValue(source, key, [...values, value].join(','))
}

async function updateFile(path, transform) {
  const original = await readFile(path, 'utf8')
  const next = transform(original)
  if (next === original) return false

  const details = await stat(path)
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
  const backup = `${path}.pre-gptmd-auth-${stamp}`
  await copyFile(path, backup)
  const temporary = `${path}.next-${process.pid}`
  await writeFile(temporary, next, { mode: details.mode })
  await chmod(temporary, details.mode)
  await rename(temporary, path)
  return true
}

const host = 'https://obgyn.eaglesvn.club'
const authUrl = `${host}/auth/v1`
const edits = [
  ['/home/eaglesvn/.config/gptmd-live/web.env', (text) =>
    setEnvValue(text, 'NUXT_PUBLIC_SUPABASE_URL', host)],
  ['/home/eaglesvn/.config/gptmd-live/api.env', (text) => {
    let next = setEnvValue(text, 'API_AUTH_JWT_ISSUER', authUrl)
    next = setEnvValue(next, 'API_AUTH_JWT_AUDIENCE', 'authenticated')
    next = setEnvValue(next, 'API_AUTH_JWT_JWKS_URL', 'http://127.0.0.1:8000/auth/v1/.well-known/jwks.json')
    return setEnvValue(next, 'API_CORS_ORIGINS', host)
  }],
  ['/home/eaglesvn/dockerz/supabase-project/.env', (text) => {
    let next = setEnvValue(text, 'SUPABASE_PUBLIC_URL', host)
    next = setEnvValue(next, 'API_EXTERNAL_URL', authUrl)
    next = setEnvValue(next, 'SITE_URL', host)
    return appendEnvListValue(next, 'ADDITIONAL_REDIRECT_URLS', `${host}/confirm`)
  }]
]

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changed = []
  for (const [path, transform] of edits) {
    if (await updateFile(path, transform)) changed.push(path)
  }

  process.stdout.write(`Configured same-origin GPTMD test authentication (${changed.length} file${changed.length === 1 ? '' : 's'} updated).\n`)
}
