import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const VERSION_PATTERN = /gptMD-dev\\?_(\d+)\.(\d+)\.(\d+)\.(\d+)/i

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.status}`)
  }

  return result.stdout?.trim() ?? ''
}

function formatVersion(parts) {
  return parts.map((part, index) => {
    const width = index === 3 || (index === 2 && part > 0) ? 2 : 1
    return String(part).padStart(width, '0')
  }).join('.')
}

function nextVersion(commits) {
  for (const commit of commits.split('\n')) {
    const match = commit.match(VERSION_PATTERN)
    if (!match) continue

    const parts = match.slice(1).map(Number)
    const last = parts.length - 1
    if (parts[last] < 99) {
      parts[last] += 1
    } else {
      parts[last] = 0
      parts[last - 1] += 1
    }

    return formatVersion(parts)
  }

  return '0.0.0.01'
}

async function main() {
  const commits = runGit(['log', '--format=%s'], { capture: true })
  const version = nextVersion(commits)
  const suggestedMessage = `gptMD-dev_${version}`

  if (process.argv.includes('--dry-run')) {
    stdout.write(`${suggestedMessage}\n`)
    return
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Run npm run git:update from an interactive terminal.')
  }

  const prompt = createInterface({ input: stdin, output: stdout })
  let message
  try {
    message = (await prompt.question(`Commit message [${suggestedMessage}]: `)).trim()
  } finally {
    prompt.close()
  }

  message ||= suggestedMessage
  runGit(['add', '.'])
  runGit(['commit', '-m', message])
  runGit(['push'])
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
