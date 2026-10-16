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
  clinic_probability_model: z.object({
    reviewed_on: z.string(),
    measure: z.string().min(1),
    not_a_measure_of: z.array(z.string()).min(1),
    interpretation: z.string().min(1)
  }),
  disorders: z.array(z.object({
    disorder: z.string().trim().min(1),
    record_type: z.string().optional(),
    clinic_encounter_probability: z.object({
      overall: z.number().min(0).max(0.99),
      estimate_type: z.string().min(1),
      confidence: z.string().min(1),
      conditional_by_visit_context: z.record(z.string(), z.number().min(0).max(0.99))
    }),
    sections: z.record(z.string(), z.object({
      summary: z.string().trim().min(1),
      source_url: z.string().url(),
      page_title: z.string().min(1),
      source_attribution: z.object({
        source_name: z.string().trim().min(1),
        source_url: z.string().url()
      }).passthrough().optional()
    }).passthrough()),
    diagnostics: z.record(z.string(), z.unknown())
  }).passthrough()).min(1)
}).passthrough()

const catalogLocations = [
  process.env.GPTMD_EDUCATOR_CATALOG_PATH,
  fileURLToPath(new URL('../catalog/obgyn-disorders.reference.json', import.meta.url)),
  fileURLToPath(new URL('../../../educator-input/obgyn-disorders.reference.diagnostics-tests-cleaned.json', import.meta.url))
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
  routineCareRecordCount: catalog.disorders.filter((record) => record.record_type === 'routine_care_service').length,
  probabilityModelReviewedOn: catalog.clinic_probability_model.reviewed_on,
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
      source: section.source_attribution?.source_name ?? section.page_title,
      sourceUrl: section.source_url
    }]))
  }))
})

const scenarioRecords = catalog.disorders.map((record) => ({
  name: record.disorder,
  recordType: record.record_type ?? 'condition',
  weight: record.clinic_encounter_probability.overall,
  probability: record.clinic_encounter_probability,
  sections: record.sections,
  diagnostics: record.diagnostics ?? {}
}))

export function selectEducatorScenarioRecord(scenarioSeed: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(scenarioSeed)) throw new Error('A valid persisted scenario variation seed is required.')
  const bucket = createHash('sha256').update(scenarioSeed).digest().readUInt32BE(0) / 0x1_0000_0000
  const totalWeight = scenarioRecords.reduce((total, record) => total + record.weight, 0)
  let cumulativeWeight = 0
  for (const record of scenarioRecords) {
    cumulativeWeight += record.weight / totalWeight
    if (bucket < cumulativeWeight) return record
  }
  return scenarioRecords.at(-1)!
}

export function educatorScenarioRecordPromptJson(scenarioSeed: string): string {
  const record = selectEducatorScenarioRecord(scenarioSeed)
  return JSON.stringify({
    selected_primary_case_focus: record.name,
    record_type: record.recordType,
    encounter_relevance: record.probability,
    reference_sections: Object.fromEntries(Object.entries(record.sections).map(([name, section]) => [name, {
      summary: section.summary,
      source: section.source_attribution?.source_name ?? section.page_title,
      sourceUrl: section.source_url
    }])),
    diagnostics: record.diagnostics
  })
}

export const EDUCATOR_CATALOG_SCENARIO_SOURCE = Object.freeze({
  mode: 'primary_condition_reference_and_simulation_augmentation',
  ...EDUCATOR_CATALOG_PROVENANCE
})

export function educatorCatalogScenarioSource(scenarioSeed: string) {
  const selected = selectEducatorScenarioRecord(scenarioSeed)
  return {
    ...EDUCATOR_CATALOG_SCENARIO_SOURCE,
    selectedPrimaryCaseFocus: selected.name,
    selectedRecordType: selected.recordType,
    estimateType: selected.probability.estimate_type
  }
}
