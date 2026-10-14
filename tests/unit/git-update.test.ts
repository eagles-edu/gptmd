import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { promptForCommitMessage } from '../../scripts/git-update.js'

describe('git update commit message', () => {
  it('waits for Enter and falls back to the suggested text when the line is empty', async () => {
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
    expect(rendered).toContain('Edit commit message; Enter accepts, Ctrl+C cancels:')

    input.write('\n')
    await expect(message).resolves.toBe('gptMD-dev_0.0.0.17')
    input.destroy()
    output.destroy()
  })
})
