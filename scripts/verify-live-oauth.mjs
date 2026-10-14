import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const hostname = 'obgyn.eaglesvn.club'
const authorizeUrl = `https://${hostname}/auth/v1/authorize?provider=google`
const callbackUrl = `https://${hostname}/auth/v1/callback`

export function assertGoogleOAuthRedirect(status, location, label = 'OAuth') {
  let target
  try {
    target = new URL(location)
  } catch {
    throw new Error(`${label} expected HTTP 302 to Google; received HTTP ${status} without a valid Location.`)
  }

  if (
    status !== '302' ||
    target.origin !== 'https://accounts.google.com' ||
    target.searchParams.get('redirect_uri') !== callbackUrl
  ) {
    throw new Error(
      `${label} expected HTTP 302 to Google with redirect_uri=${callbackUrl}; ` +
      `received HTTP ${status} to ${target.hostname}${target.pathname}.`
    )
  }
}

async function probe(label, resolveOrigin, execute = execFileAsync) {
  const args = [
    '--silent', '--show-error', '--noproxy', '*', '--connect-timeout', '5', '--max-time', '12',
    '--output', '/dev/null', '--write-out', '%{http_code}\n%{redirect_url}',
    '--user-agent', 'curl/8.5.0'
  ]
  if (resolveOrigin) args.push('--resolve', `${hostname}:443:127.0.0.1`)
  args.push(authorizeUrl)

  let stdout
  try {
    ({ stdout } = await execute('curl', args, { encoding: 'utf8', timeout: 15_000 }))
  } catch (error) {
    throw new Error(`${label} OAuth preflight request failed: ${error.message}`, { cause: error })
  }

  const separator = stdout.indexOf('\n')
  if (separator < 0) throw new Error(`${label} OAuth preflight returned an unreadable response.`)
  assertGoogleOAuthRedirect(stdout.slice(0, separator).trim(), stdout.slice(separator + 1).trim(), label)
}

export async function verifyLiveOAuthAuthorize(execute = execFileAsync) {
  await probe('Origin', true, execute)
  await probe('Public', false, execute)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await verifyLiveOAuthAuthorize()
    process.stdout.write('Origin and public OAuth authorization checks passed.\n')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
