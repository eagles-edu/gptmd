import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { promptForCommitMessage, validCommitMessage } from '../../scripts/git-update.js'

const projectRoot = resolve(import.meta.dirname, '../..')

describe('git update commit message', () => {
  it('pauses on the prefilled suggested message and keeps it when Enter is pressed', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let rendered = ''
    output.on('data', (chunk: Buffer) => { rendered += chunk.toString() })

    let resolved = false
    const message = promptForCommitMessage('gptMD-dev_0.0.0.17', input, output).then((value) => {
      resolved = true
      return value
    })

    await new Promise((resolve) => setImmediate(resolve))
    expect(resolved).toBe(false)
    expect(rendered).toContain('Suggested commit message: gptMD-dev_0.0.0.17 ')
    expect(rendered).not.toContain('Commit message (')
    expect(rendered).not.toContain('Edit this message')

    input.write('\n')
    await expect(message).resolves.toBe('gptMD-dev_0.0.0.17')
    input.destroy()
    output.destroy()
  })

  it('ignores a buffered nvm use command and waits for an explicit message response', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let resolved = false
    const message = promptForCommitMessage('gptMD-dev_0.0.0.18', input, output)
      .then((value) => {
        resolved = true
        return value
      })

    input.write('nvm use\n')

    await new Promise((resolve) => setImmediate(resolve))
    expect(resolved).toBe(false)

    input.write('\n')
    await expect(message).resolves.toBe('gptMD-dev_0.0.0.18')
    input.destroy()
    output.destroy()
  })

})

describe('git update message validation', () => {
  it('rejects shell commands and keeps the project commit prefix', () => {
    expect(validCommitMessage('gptMD-dev_0.0.0.18')).toBe(true)
    expect(validCommitMessage('gptMD-dev_0.0.0.18 corrected')).toBe(true)
    expect(validCommitMessage('nvm use')).toBe(false)
  })
})

describe('git update Node initialization', () => {
  it('waits for nvm use and verifies the project Node version before running the helper', () => {
    const nvmDir = mkdtempSync(resolve(tmpdir(), 'gptmd-nvm-test-'))
    mkdirSync(nvmDir, { recursive: true })
    writeFileSync(
      resolve(nvmDir, 'nvm.sh'),
      'nvm() { printf "nvm-start\\n"; sleep 0.1; printf "nvm-complete\\n"; }\n',
    )

    try {
      const result = spawnSync('bash', ['scripts/git-update.sh', '--dry-run'], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, NVM_DIR: nvmDir },
      })

      expect(result.status).toBe(0)
      expect(result.error).toBeUndefined()
      expect(result.stdout.indexOf('nvm-start')).toBeGreaterThanOrEqual(0)
      expect(result.stdout.indexOf('nvm-start')).toBeLessThan(result.stdout.indexOf('nvm-complete'))
      expect(result.stdout.indexOf('nvm-complete')).toBeLessThan(result.stdout.indexOf('Verified Node'))
      expect(result.stdout.indexOf('Verified Node')).toBeLessThan(result.stdout.indexOf('gptMD-dev_'))
    } finally {
      rmSync(nvmDir, { recursive: true, force: true })
    }
  })

  it('retries once and refuses to run the helper when nvm selects the wrong Node version', () => {
    const nvmDir = mkdtempSync(resolve(tmpdir(), 'gptmd-nvm-test-'))
    mkdirSync(nvmDir, { recursive: true })
    writeFileSync(resolve(nvmDir, 'nvm.sh'), 'nvm() { printf "nvm-complete\\n"; }\n')
    const wrongNodeDir = mkdtempSync(resolve(tmpdir(), 'gptmd-node-test-'))
    writeFileSync(resolve(wrongNodeDir, 'node'), '#!/usr/bin/env bash\nprintf "v0.0.0\\n"\n')
    writeFileSync(resolve(wrongNodeDir, 'npm'), '#!/usr/bin/env bash\nexit 0\n')
    chmodSync(resolve(wrongNodeDir, 'node'), 0o755)
    chmodSync(resolve(wrongNodeDir, 'npm'), 0o755)

    try {
      const result = spawnSync('bash', ['scripts/git-update.sh', '--dry-run'], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, NVM_DIR: nvmDir, PATH: `${wrongNodeDir}:${process.env.PATH}` },
      })

      expect(result.status).toBe(1)
      expect(result.stdout.match(/nvm-complete/g)).toHaveLength(2)
      expect(result.stderr).toContain('refusing to start git:update')
      expect(result.stdout).not.toContain('gptMD-dev_')
    } finally {
      rmSync(nvmDir, { recursive: true, force: true })
      rmSync(wrongNodeDir, { recursive: true, force: true })
    }
  })
})
