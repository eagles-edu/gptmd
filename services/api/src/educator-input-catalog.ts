import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const EducatorCatalogSchema = z.object({
  approval_status: z.literal('approved_for_gptmd_educator_input'),
  educator_approval: z.object({
    approved_on: z.string(),
    approval_scope: z.literal('gptmd_educator_input')
  }),
  runtime_eligible: z.literal(true),
  revision: z.object({
    reviewed_on: z.string(),
    source_backed_sections: z.number().int().positive()
  }),
  disorders: z.array(z.object({
    disorder: z.string().trim().min(1),
    sections: z.record(z.string(), z.object({
      summary: z.string().trim().min(1),
      source_attribution: z.object({
        source_name: z.string().trim().min(1),
        source_url: z.string().url()
      }).passthrough()
    }).passthrough())
  }).passthrough()).min(1)
}).passthrough()

const catalogLocations = [
  process.env.GPTMD_EDUCATOR_CATALOG_PATH,
  fileURLToPath(new URL('../catalog/obgyn-disorders.reference.json', import.meta.url)),
  fileURLToPath(new URL('../../../educator-input/obgyn-disorders.reference.json', import.meta.url))
].filter((path): path is string => Boolean(path))

const catalogPath = catalogLocations.find((path) => existsSync(path))
if (!catalogPath) throw new Error('The approved GPTMD educator-input catalog is unavailable.')

const sourceJson = readFileSync(catalogPath, 'utf8')
const sourceDigest = createHash('sha256').update(sourceJson).digest('hex')
const catalog = EducatorCatalogSchema.parse(JSON.parse(sourceJson))

export const EDUCATOR_CATALOG_PROVENANCE = Object.freeze({
  catalogId: 'obgyn-disorders',
  approvalStatus: catalog.approval_status,
  approvedOn: catalog.educator_approval.approved_on,
  approvalScope: catalog.educator_approval.approval_scope,
  sourceRevision: catalog.revision.reviewed_on,
  sectionCount: catalog.revision.source_backed_sections,
  conditionCount: catalog.disorders.length,
  sha256: sourceDigest
})

export const EDUCATOR_CATALOG_PROMPT_JSON = JSON.stringify({
  catalogId: EDUCATOR_CATALOG_PROVENANCE.catalogId,
  sourceRevision: EDUCATOR_CATALOG_PROVENANCE.sourceRevision,
  sectionCount: EDUCATOR_CATALOG_PROVENANCE.sectionCount,
  disorders: catalog.disorders.map((disorder) => ({
    disorder: disorder.disorder,
    sections: Object.fromEntries(Object.entries(disorder.sections).map(([name, section]) => [name, {
      summary: section.summary,
      source: section.source_attribution.source_name,
      sourceUrl: section.source_attribution.source_url
    }]))
  }))
})

export const EDUCATOR_CATALOG_SCENARIO_SOURCE = Object.freeze({
  mode: 'primary_condition_reference_and_simulation_augmentation',
  ...EDUCATOR_CATALOG_PROVENANCE
})
