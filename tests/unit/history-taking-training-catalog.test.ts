import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildHistoryTakingTrainingCatalog } from '../../scripts/generate-history-taking-prompts.mjs'

const sourcePath = new URL('../../educator-input/obgyn_new_patient_interview_and_exam_english_corpus.md', import.meta.url)
const outputPath = new URL('../../app/data/history-taking-training-prompts.json', import.meta.url)

describe('history-taking training prompt catalog', () => {
  it('preserves source attribution, stable unique prompts, and honest audio availability', async () => {
    const source = await readFile(sourcePath, 'utf8')
    const catalog = buildHistoryTakingTrainingCatalog(source)
    const generated = JSON.parse(await readFile(outputPath, 'utf8'))

    expect(catalog.promptCount).toBe(510)
    expect(new Set(catalog.prompts.map((prompt) => prompt.id)).size).toBe(510)
    expect(catalog.prompts.every((prompt) => prompt.text && prompt.sectionPath.length > 0)).toBe(true)
    expect(catalog.prompts.every((prompt) => prompt.referenceAudio.status === 'not_recorded'
      && prompt.referenceAudio.publicPath === null && prompt.referenceAudio.sha256 === null)).toBe(true)
    expect(catalog.prompts.some((prompt) => prompt.practiceType === 'examination_instruction')).toBe(true)
    expect(catalog.prompts.some((prompt) => prompt.practiceType === 'communication_repair')).toBe(true)
    expect(catalog.source.sha256).toBe(createHash('sha256').update(source).digest('hex'))
    expect(generated).toEqual(catalog)
  })

  it('tracks headings and assigns distinct stable IDs to repeated prompts', () => {
    const catalog = buildHistoryTakingTrainingCatalog([
      '# Interview',
      '## 11. Examination commands',
      '- “Please lie back.”',
      '- “Please lie back.”',
      '- An unquoted instruction is not a prompt.',
      '## 12. Useful repair phrases',
      '- “Could you say that another way?”'
    ].join('\n'))

    expect(catalog.prompts).toHaveLength(3)
    expect(catalog.prompts[0]?.sectionPath).toEqual(['Interview', '11. Examination commands'])
    expect(catalog.prompts[0]?.practiceType).toBe('examination_instruction')
    expect(catalog.prompts[0]?.id).not.toBe(catalog.prompts[1]?.id)
    expect(catalog.prompts[2]?.practiceType).toBe('communication_repair')
  })
})
