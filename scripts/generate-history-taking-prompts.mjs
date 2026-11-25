import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import StarterKit from '@tiptap/starter-kit'
import { Markdown, MarkdownManager } from '@tiptap/markdown'

const root = new URL('../', import.meta.url)
const sourcePath = new URL('educator-input/obgyn_new_patient_interview_and_exam_english_corpus.md', root)
const outputPath = new URL('app/data/history-taking-training-prompts.json', root)
const sourceFile = 'educator-input/obgyn_new_patient_interview_and_exam_english_corpus.md'

function getText(node) {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(getText).join('')
}

function collectPrompts(nodes, headingPath, records, duplicateOrdinals) {
  let currentHeadingPath = headingPath

  for (const node of nodes ?? []) {
    if (node.type === 'heading') {
      const level = node.attrs?.level ?? 1
      currentHeadingPath = [
        ...currentHeadingPath.filter((heading) => heading.level < level),
        { level, title: getText(node).trim() }
      ]
      continue
    }

    if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const item of node.content ?? []) {
        const fullText = getText(item).trim()
        const promptMatch = fullText.match(/“([^”]+)”/)
        if (promptMatch) {
          const text = promptMatch[1].trim()
          const headings = currentHeadingPath.map(({ title }) => title)
          const identity = `${headings.join('\n')}\n${text}`
          const ordinal = (duplicateOrdinals.get(identity) ?? 0) + 1
          duplicateOrdinals.set(identity, ordinal)
          const digest = createHash('sha256').update(identity).digest('hex').slice(0, 12)
          const suffix = ordinal > 1 ? `-${ordinal}` : ''
          const section = headings.at(-1) ?? 'Uncategorized'
          const practiceType = headings.some((heading) => heading.startsWith('11. Examination commands'))
            ? 'examination_instruction'
            : headings.some((heading) => heading.startsWith('12. Useful repair phrases'))
              ? 'communication_repair'
              : 'history_question'

          records.push({
            id: `obgyn-en-${digest}${suffix}`,
            text,
            section,
            sectionPath: headings,
            practiceType,
            referenceAudio: {
              status: 'not_recorded',
              publicPath: null,
              sha256: null
            }
          })
        }
        collectPrompts(item.content, currentHeadingPath, records, duplicateOrdinals)
      }
      continue
    }

    collectPrompts(node.content, currentHeadingPath, records, duplicateOrdinals)
  }
}

export function buildHistoryTakingTrainingCatalog(markdown) {
  const parser = new MarkdownManager({ extensions: [StarterKit, Markdown] })
  const document = parser.parse(markdown)
  const prompts = []
  collectPrompts(document.content, [], prompts, new Map())

  return {
    catalogVersion: 'obgyn-history-taking-prompts-v1',
    source: {
      file: sourceFile,
      sha256: createHash('sha256').update(markdown).digest('hex'),
      scope: 'English-language patient-facing interview, exam, and repair prompts for communication practice'
    },
    promptCount: prompts.length,
    prompts
  }
}

async function main() {
  const source = await readFile(sourcePath, 'utf8')
  const generated = `${JSON.stringify(buildHistoryTakingTrainingCatalog(source), null, 2)}\n`

  if (process.argv.includes('--check')) {
    const current = await readFile(outputPath, 'utf8').catch(() => '')
    if (current !== generated) {
      process.stderr.write(`${fileURLToPath(outputPath)} is stale; run npm run training-prompts:build.\n`)
      process.exitCode = 1
    }
  } else {
    await writeFile(outputPath, generated)
    process.stdout.write(`Wrote ${JSON.parse(generated).promptCount} history-taking prompts to ${fileURLToPath(outputPath)}.\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
