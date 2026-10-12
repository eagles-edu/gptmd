import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const diagramsDirectory = new URL('../../docs/diagrams/', import.meta.url)
const checklistUrl = new URL('../../docs/plangpt-modernization-checklist.md', import.meta.url)

describe('modernization checklist inventory', () => {
  it('maps every actionable D2 node to exactly one well-formed checklist item', async () => {
    const diagramFiles = (await readdir(diagramsDirectory))
      .filter((file) => file.startsWith('plangpt-modernization-') && file.endsWith('.d2'))
    const diagramNodeIds: string[] = []

    for (const file of diagramFiles) {
      const source = await readFile(new URL(file, diagramsDirectory), 'utf8')
      for (const line of source.split('\n')) {
        const match = /^\s*([a-z]\d{2}):/.exec(line)
        if (match?.[1]) diagramNodeIds.push(match[1])
      }
    }

    const checklist = await readFile(checklistUrl, 'utf8')
    const checklistNodes = new Map<string, number[]>()
    let insideTaskInventory = false
    for (const [index, line] of checklist.split('\n').entries()) {
      if (line === '## 1. Identity and session bootstrap') insideTaskInventory = true
      if (!insideTaskInventory) continue
      if (!/\b[a-z]\d{2}\b/.test(line) || !line.includes('- [')) continue
      const match = /^\s*-\s*\[(?: |x|X)\]\s+`([a-z]\d{2})`/.exec(line)
      expect(match, `Malformed or unchecked task markup on checklist line ${index + 1}`).not.toBeNull()
      const id = match?.[1]
      if (!id) continue
      checklistNodes.set(id, [...(checklistNodes.get(id) ?? []), index + 1])
    }

    expect(diagramFiles.filter((file) => file !== 'plangpt-modernization-flow.d2')).toHaveLength(7)
    expect(diagramNodeIds).toHaveLength(286)
    const progress = checklist.match(/^\*\*Progress snapshot \([^)]+\):\*\* (\d+) of (\d+) detailed nodes are checked \(([\d.]+)%\); (\d+) remain open or deferred\.$/m)
    const inventory = checklist.match(/^\*\*Checklist inventory:\*\* (\d+) of (\d+) detailed nodes represented;/m)
    expect(progress, 'Progress snapshot must report checked, total, percent, and remaining counts').not.toBeNull()
    expect(inventory, 'Checklist inventory must report represented nodes').not.toBeNull()
    const [, checkedText = '', progressTotalText = '', percentText = '', remainingText = ''] = progress ?? []
    const [, inventoryCountText = '', inventoryTotalText = ''] = inventory ?? []
    const checked = Number(checkedText)
    const progressTotal = Number(progressTotalText)
    const remaining = Number(remainingText)
    const inventoryCount = Number(inventoryCountText)
    const inventoryTotal = Number(inventoryTotalText)
    expect(progressTotal).toBe(286)
    expect(inventoryCount).toBe(progressTotal)
    expect(inventoryTotal).toBe(progressTotal)
    expect(checked + remaining).toBe(progressTotal)
    expect(Number(percentText)).toBe(Math.round((checked / progressTotal) * 1000) / 10)
    expect([...checklistNodes.keys()].sort()).toEqual([...diagramNodeIds].sort())
    expect([...checklistNodes.entries()].filter(([, lines]) => lines.length !== 1)).toEqual([])
  })
})
