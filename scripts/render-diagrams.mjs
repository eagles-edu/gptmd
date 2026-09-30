import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { D2 } from '@d2lang/d2'

const sourceDirectory = new URL('../docs/diagrams/', import.meta.url)
const outputDirectory = new URL('../docs/', import.meta.url)
const checkOnly = process.argv.includes('--check')
const sources = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.d2')).sort()

function preserveViewBox(svg) {
  const rootTag = svg.match(/<svg\b[^>]*>/)?.[0]
  if (!rootTag) throw new Error('D2 output has no root SVG element.')

  const viewBox = rootTag.match(/\bviewBox="([^"]+)"/)?.[1]?.trim().split(/[\s,]+/)
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    !viewBox.every((value) => Number.isFinite(Number(value)))
  ) {
    throw new Error('D2 output has no valid four-value viewBox.')
  }

  const [, , width, height] = viewBox
  if (Number(width) <= 0 || Number(height) <= 0) {
    throw new Error('D2 output viewBox must have a positive width and height.')
  }

  return svg.replace(/<svg\b[^>]*>/g, (svgTag) => {
    const attributes = [...svgTag.matchAll(/\s+([\w:-]+)="([^"]*)"/g)]
      .filter(([, name]) => name !== 'width' && name !== 'height')
      .map(([, name, value]) => `  ${name}="${value}"`)
    return ['<svg', ...attributes, '>'].join('\n')
  })
}

if (sources.length === 0) {
  throw new Error('No D2 source files found in docs/diagrams/.')
}

const d2 = new D2()
let stale = false

try {
  for (const sourceName of sources) {
    const sourcePath = join(sourceDirectory.pathname, sourceName)
    const outputPath = join(outputDirectory.pathname, `${basename(sourceName, '.d2')}.svg`)
    const source = await readFile(sourcePath, 'utf8')
    const compiled = await d2.compile(source, { layout: 'elk' })
    const svg = preserveViewBox(await d2.render(compiled.diagram, compiled.renderOptions))

    if (checkOnly) {
      let existing
      try {
        existing = await readFile(outputPath, 'utf8')
      } catch {
        existing = ''
      }
      if (existing !== svg) {
        console.error(`${outputPath} is missing or out of date; run npm run diagrams:build.`)
        stale = true
      }
    } else {
      await writeFile(outputPath, svg)
      console.log(`Rendered ${sourceName} → ${basename(outputPath)}`)
    }
  }
} finally {
  await d2.dispose()
}

if (stale) process.exitCode = 1
