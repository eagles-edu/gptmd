import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  EDUCATOR_CATALOG_PROMPT_JSON,
  EDUCATOR_CATALOG_PROVENANCE,
  educatorScenarioRecordPromptJson,
  selectEducatorScenarioRecord
} from '../../services/api/src/educator-input-catalog.ts'

const SectionSchema = z.object({
  source_url: z.string().url(),
  page_title: z.string().min(1),
  summary: z.string().trim().min(1),
  source_attribution: z.object({
    source_name: z.string().trim().min(1),
    source_url: z.string().url(),
    source_condition: z.string().trim().min(1),
    provenance_basis: z.string().optional()
  }).passthrough().optional(),
  related_source_urls: z.array(z.object({ url: z.string().url() }).passthrough()).optional()
}).passthrough()

const EducatorCatalogSchema = z.object({
  catalog_counts: z.object({
    condition_records: z.literal(138),
    section_records: z.literal(260),
    conditions_with_external_sources: z.literal(86),
    external_source_records: z.literal(101),
    routine_care_service_records: z.literal(8)
  }),
  approval_status: z.literal('approved_for_gptmd_educator_input'),
  educator_approval: z.object({
    approved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    approval_scope: z.literal('gptmd_educator_input'),
    approval_note: z.string().min(1)
  }),
  runtime_eligible: z.literal(true),
  clinic_probability_model: z.object({
    reviewed_on: z.literal('2026-10-15'),
    measure: z.string().min(1),
    not_a_measure_of: z.array(z.string()).min(1),
    interpretation: z.string().min(1)
  }),
  content_note: z.string().min(1),
  section_keys: z.array(z.string()).length(2),
  disorders: z.array(z.object({
    disorder: z.string().trim().min(1),
    record_type: z.string().optional(),
    clinic_encounter_probability: z.object({
      overall: z.number().min(0).max(0.99),
      estimate_type: z.string().min(1),
      confidence: z.string().min(1),
      conditional_by_visit_context: z.record(z.string(), z.number().min(0).max(0.99))
    }),
    sections: z.record(z.string(), SectionSchema),
    external_sources: z.array(z.unknown()).optional(),
    diagnostics: z.record(z.string(), z.unknown())
  }).passthrough()).length(138),
  revision: z.object({
    reviewed_on: z.literal('2026-10-16'),
    source_backed_sections: z.literal(260),
    empty_section_records_remaining: z.literal(0),
    completion_backfill: z.object({
      section_records_filled: z.array(z.string()).length(9),
      section_records_filled_count: z.literal(9),
      remaining_empty_section_records: z.literal(0)
    }).passthrough(),
    external_source_augmentation: z.object({
      current_catalog: z.object({
        conditions_with_external_sources: z.literal(86),
        external_source_records: z.literal(101)
      })
    })
  }).passthrough(),
  source_audit: z.object({
    total_section_records: z.literal(260),
    previously_missing_explicit_attribution: z.literal(148),
    attributions_added: z.literal(148),
    explicit_attributions_now: z.literal(260),
    mayo_clinic_section_records: z.literal(148),
    other_source_attribution_records: z.literal(112),
    mayo_derived_attributions_added: z.literal(148),
    previously_missing_source_url_breakdown: z.object({
      mayo_clinic_urls: z.literal(132),
      non_mayo_legacy_urls_preserved_as_related_references: z.literal(7),
      missing_urls_backfilled_from_mayo: z.literal(9),
      legacy_non_mayo_urls: z.object({
        'Pam Pearl Hospitals': z.literal(6),
        'Hanoi French Hospital': z.literal(1)
      })
    }),
    remaining_empty_section_records: z.literal(0),
    educator_review_required: z.literal(false),
    provenance_note: z.string().min(1)
  })
}).passthrough()

describe('educator input OBGYN catalog', () => {
  it('keeps condition and section counts, explicit sources, and the educator-review gate aligned', async () => {
    const raw = await readFile(new URL('../../educator-input/obgyn-disorders.reference.diagnostics-tests-cleaned.json', import.meta.url), 'utf8')
    const catalog = EducatorCatalogSchema.parse(JSON.parse(raw))
    const labels = catalog.disorders.map((condition) => condition.disorder)
    const sections = catalog.disorders.flatMap((condition) => Object.values(condition.sections))
    const conditions = catalog.disorders.filter((condition) => condition.record_type !== 'routine_care_service')
    const conditionSections = conditions.flatMap((condition) => Object.values(condition.sections))
    const routineCare = catalog.disorders.filter((condition) => condition.record_type === 'routine_care_service')
    const externalSourceRecords = conditions.flatMap((condition) => condition.external_sources ?? [])
    const mayoDerivedFromUserConfirmation = conditionSections.filter((section) => section.source_attribution?.provenance_basis?.toLowerCase().includes('user-confirmed provenance'))
    const legacySourceSections = sections.filter((section) => (section.related_source_urls ?? []).length > 0)

    expect(new Set(labels).size).toBe(138)
    expect(conditions).toHaveLength(130)
    expect(routineCare).toHaveLength(8)
    expect(sections).toHaveLength(276)
    expect(conditionSections).toHaveLength(260)
    expect(sections.every((section) => section.summary.trim().length > 0)).toBe(true)
    expect(catalog.disorders.every((record) => record.diagnostics['diagnostic_use'] && record.diagnostics['result_interpretation'])).toBe(true)
    expect(catalog.disorders.flatMap((record) => Object.values(record.diagnostics)
      .flatMap((profile) => typeof profile === 'object' && profile !== null && 'tests' in profile && Array.isArray(profile.tests) ? profile.tests : [])))
      .toHaveLength(811)
    expect(conditionSections.every((section) => section.source_url === section.source_attribution?.source_url)).toBe(true)
    expect(catalog.revision.completion_backfill.section_records_filled).toHaveLength(9)
    expect(mayoDerivedFromUserConfirmation).toHaveLength(148)
    expect(mayoDerivedFromUserConfirmation.every((section) => section.source_attribution?.source_name === 'Mayo Clinic')).toBe(true)
    expect(legacySourceSections.flatMap((section) => section.related_source_urls ?? [])).toHaveLength(7)
    expect(legacySourceSections.every((section) => section.source_attribution?.source_name === 'Mayo Clinic' && !section.summary.toLowerCase().includes('the source'))).toBe(true)
    expect(externalSourceRecords).toHaveLength(101)
    expect(catalog.source_audit.provenance_note).toContain('Seven legacy URLs')
    expect(catalog.approval_status).toBe('approved_for_gptmd_educator_input')
    expect(catalog.educator_approval.approval_scope).toBe('gptmd_educator_input')
    expect(catalog.runtime_eligible).toBe(true)
    expect(EDUCATOR_CATALOG_PROVENANCE.conditionCount).toBe(138)
    expect(EDUCATOR_CATALOG_PROVENANCE.routineCareRecordCount).toBe(8)
    expect(catalog.clinic_probability_model.not_a_measure_of).toContain('population incidence')
    expect(catalog.disorders.every((record) => record.clinic_encounter_probability.estimate_type === 'modeled encounter relevance, not population incidence')).toBe(true)
    expect(EDUCATOR_CATALOG_PROVENANCE.sha256).toBe(createHash('sha256').update(raw).digest('hex'))
    const runtimeReference = JSON.parse(EDUCATOR_CATALOG_PROMPT_JSON) as {
      disorders: Array<{ disorder: string; sections: Record<string, { summary: string; source: string; sourceUrl: string }> }>
    }
    expect(runtimeReference.disorders).toHaveLength(138)
    expect(runtimeReference.disorders.every((condition) => Object.keys(condition.sections).length === 2)).toBe(true)
    expect(runtimeReference.disorders.flatMap((condition) => Object.values(condition.sections))
      .every((section) => section.summary.length > 0 && section.source.length > 0 && section.sourceUrl.startsWith('https://'))).toBe(true)
    expect(selectEducatorScenarioRecord('s'.repeat(43))).toEqual(selectEducatorScenarioRecord('s'.repeat(43)))
    expect(selectEducatorScenarioRecord('s'.repeat(43)).name).toBe('Premenstrual syndrome (PMS)')
    expect(JSON.parse(educatorScenarioRecordPromptJson('s'.repeat(43))).diagnostics).toBeDefined()
    const selectedRecords = Array.from({ length: 2_000 }, (_, index) => {
      const seed = `test-${index.toString(36).padStart(4, '0')}${'x'.repeat(34)}`
      return selectEducatorScenarioRecord(seed)
    })
    const routineCareSelectionRate = selectedRecords.filter((record) => record.recordType === 'routine_care_service').length / selectedRecords.length
    expect(routineCareSelectionRate).toBeGreaterThan(0.11)
    expect(routineCareSelectionRate).toBeLessThan(0.20)
    expect(() => selectEducatorScenarioRecord('invalid')).toThrow('valid persisted scenario variation seed')
  })
})
