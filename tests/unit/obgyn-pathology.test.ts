import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { obgynPathologyRows } from '../../app/data/obgyn-pathology'

const sharedStyles = readFileSync(new URL('../../app/assets/css/main.css', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../../app/pages/instructor/obgyn-laboratory.vue', import.meta.url), 'utf8')
const headerSource = readFileSync(new URL('../../app/components/AppHeader.vue', import.meta.url), 'utf8')
const footerSource = readFileSync(new URL('../../app/components/AppFooter.vue', import.meta.url), 'utf8')

const legacyCategoryFills = [
  '#d9e8c1', '#f6dce3', '#dbe3f5', '#f1dfd3', '#dbe6d5', '#f3dde5',
  '#cee8e8', '#f4dce1', '#cfe8e4', '#e8e3be', '#f1dfd3', '#dbe6d5'
]
const legacyDarkCategoryFills = [
  '#30332a', '#363032', '#303236', '#35312e', '#30332f', '#353132',
  '#2d3333', '#363032', '#2e3332', '#33322a', '#35312e', '#30332f'
]

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => parseInt(channel, 16) / 255) ?? []
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    )
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

function themeProperties(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = sharedStyles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1]
  if (!block) throw new Error(`Could not find theme block: ${selector}`)
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]+)/gi)].map((match) => [match[1], match[2]]))
}

function mixHex(foreground: string, background: string, foregroundPercent: number) {
  const foregroundChannels = foreground.slice(1).match(/.{2}/g)?.map((channel) => parseInt(channel, 16)) ?? []
  const backgroundChannels = background.slice(1).match(/.{2}/g)?.map((channel) => parseInt(channel, 16)) ?? []
  const amount = foregroundPercent / 100
  return `#${foregroundChannels.map((channel, index) =>
    Math.round(channel * amount + backgroundChannels[index] * (1 - amount)).toString(16).padStart(2, '0')
  ).join('')}`
}

describe('OB/GYN pathology reference data', () => {
  it('preserves all 55 source rows and eight source cells per row', () => {
    expect(obgynPathologyRows).toHaveLength(55)
    expect(obgynPathologyRows.every((row) => row.cells.length === 8)).toBe(true)
    expect(obgynPathologyRows.at(-1)?.cells.every((cell) => cell === '')).toBe(true)
    expect(obgynPathologyRows.at(-2)?.cells.every((cell) => cell === '')).toBe(true)
  })

  it('retains clinical text and distinct section color classes', () => {
    expect(obgynPathologyRows.find((row) => row.cells[2] === 'Uric Acid')?.cells[6]).toBe('spikes signal preeclampsia.')
    expect(obgynPathologyRows.find((row) => row.cells[2] === 'Nitrazine & Ferning Test')?.cells[5]).toContain('Premature Rupture of Membranes')
    expect(new Set(obgynPathologyRows.map((row) => row.colorClass)).size).toBe(12)
    expect(obgynPathologyRows.filter((row) => row.sourceCheckbox)).toHaveLength(21)
  })

  it('keeps functional checkboxes in the source document positions', () => {
    expect(obgynPathologyRows.filter((row) => row.sourceCheckbox).map((row) => row.id)).toEqual([
      1, 5, 9, 17, 19, 23, 29, 34, 37, 38, 39, 40, 41, 46, 47, 48, 49, 50, 51, 52, 53
    ])
    expect(pageSource).toContain('v-if="row.sourceCheckbox"')
    expect(pageSource).not.toContain('Student name')
    expect(pageSource).not.toContain('<style')
    expect(pageSource).not.toContain('aria-hidden="true"')
    expect(pageSource).not.toContain('<main ')
    expect(pageSource).toContain("htmlAttrs: { lang: 'en' }")
    expect(pageSource).toContain("title: 'OB/GYN Laboratory Pathology Reference | GPTpatient'")
    expect(pageSource).toContain('reference-section-heading')
  })

  it('uses the exact legacy category fills and the legacy thin solid border style', () => {
    const light = themeProperties(':root')
    const dark = themeProperties(':root[data-app-theme="dark"]')
    expect(legacyCategoryFills.map((_, index) => light[`--app-reference-category-${index + 1}`])).toEqual(legacyCategoryFills)
    expect(legacyDarkCategoryFills.map((_, index) => dark[`--app-reference-category-${index + 1}`])).toEqual(legacyDarkCategoryFills)
    const categoryColors = new Map([
      ['Electrolytes & Acid-Base', 1], ['Renal (Kidney) Function', 2], ['Hepatic (Liver) Function', 3],
      ['Pancreatic Exocrine', 4], ['Metabolic & Minerals', 5], ['Cardiovascular & Lipids', 6],
      ['Hematology (CBC)', 7], ['Blood TYPE Compatibility', 8], ['Infectious Serology', 9],
      ['Urinalysis (UA)', 10], ['Cytology & Swabs', 11], ['Fetal Screens', 12]
    ])
    for (const row of obgynPathologyRows) {
      expect(row.colorClass).toBe(`cell-ce${categoryColors.get(row.category)}`)
    }
    expect(light['--app-reference-border']).toBe('#757575')
    expect(sharedStyles).toContain('border: 0.74pt solid var(--app-reference-border)')
    expect(sharedStyles).toContain('color-mix(in srgb, var(--reference-section-color) 35%, var(--app-surface))')
    expect(sharedStyles).toContain('color-mix(in srgb, var(--reference-section-color) 55%, var(--app-surface))')
  })

  it('provides 44-pixel pointer targets for shared navigation and policy links', () => {
    expect(headerSource).toContain('min-height: 2.75rem')
    expect(headerSource).toContain('height: 2.75rem')
    expect(headerSource).toContain('width: 2.75rem')
    expect(headerSource).toContain('.brand:focus-visible')
    expect(headerSource).toContain('min-height: 2.75rem')
    expect(footerSource).toContain('.policy-links a {')
    expect(footerSource).toContain('min-height: 2.75rem')
    expect(footerSource).toContain('min-width: 2.75rem')
    expect(footerSource).toContain('.merchant-details a {')
    expect(footerSource).toContain('.site-footer a:focus-visible')
    expect(footerSource).toContain('outline: 3px solid currentcolor')
  })

  it('maintains AAA text contrast for shared table surfaces and category colors', () => {
    for (const themeSelector of [':root', ':root[data-app-theme="dark"]']) {
      const properties = themeProperties(themeSelector)
      const text = properties['--app-text']
      const categoryBackgrounds = Object.entries(properties)
        .filter(([name]) => name.startsWith('--app-reference-category-'))
        .map(([, color]) => color)
      const tableBackgrounds = [
        properties['--app-surface'],
        properties['--app-surface-muted'],
        properties['--app-surface-accent'],
        ...categoryBackgrounds,
        ...categoryBackgrounds.flatMap((category) => [
          mixHex(category, properties['--app-surface'], 35),
          mixHex(category, properties['--app-surface'], 55)
        ])
      ]

      expect(categoryBackgrounds).toHaveLength(12)
      for (const background of tableBackgrounds) {
        expect(contrastRatio(text, background), `${themeSelector}: ${text} on ${background}`).toBeGreaterThanOrEqual(7)
      }
    }

    const light = themeProperties(':root')
    const dark = themeProperties(':root[data-app-theme="dark"]')
    for (const [themeSelector, properties] of [['light', light], ['dark', dark]] as const) {
      expect(contrastRatio('#ffffff', properties['--app-header-background']), `${themeSelector} header`).toBeGreaterThanOrEqual(7)
      expect(contrastRatio(properties['--app-text-muted'], properties['--app-background']), `${themeSelector} footer`).toBeGreaterThanOrEqual(7)
      expect(contrastRatio(properties['--app-reference-border'], properties['--app-surface']), `${themeSelector} table border`).toBeGreaterThanOrEqual(3)
    }
  })
})
