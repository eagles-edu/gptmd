import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { promptForCommitMessage } from '../../scripts/git-update.js'

describe('git update commit message', () => {
  it('waits at the message prompt and keeps the suggestion when the line is empty', async () => {
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
    expect(rendered).toContain('Suggested commit message: gptMD-dev_0.0.0.17')
    expect(rendered).toContain('Commit message (Enter keeps it; type an edited message): ')

    input.write('\n')
    await expect(message).resolves.toBe('gptMD-dev_0.0.0.17')
    input.destroy()
    output.destroy()
  })

  it('uses the message typed at the prompt', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const message = promptForCommitMessage('gptMD-dev_0.0.0.17', input, output)

    input.write('gptMD-dev_0.0.0.17 nvm setup\n')

    await expect(message).resolves.toBe('gptMD-dev_0.0.0.17 nvm setup')
    input.destroy()
    output.destroy()
  })
})
