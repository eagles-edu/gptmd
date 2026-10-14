import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EDUCATOR_CATALOG_PROMPT_JSON, EDUCATOR_CATALOG_PROVENANCE } from '../../services/api/src/educator-input-catalog.ts'

const SectionSchema = z.object({
  source_url: z.string().url(),
  summary: z.string().trim().min(1),
  source_attribution: z.object({
    source_name: z.string().trim().min(1),
    source_url: z.string().url(),
    source_condition: z.string().trim().min(1),
    provenance_basis: z.string().optional()
  }).passthrough(),
  related_source_urls: z.array(z.object({ url: z.string().url() }).passthrough()).optional()
}).passthrough()

const EducatorCatalogSchema = z.object({
  catalog_counts: z.object({
    condition_records: z.literal(130),
    section_records: z.literal(260),
    conditions_with_external_sources: z.literal(86),
    external_source_records: z.literal(101)
  }),
  approval_status: z.literal('approved_for_gptmd_educator_input'),
  educator_approval: z.object({
    approved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    approval_scope: z.literal('gptmd_educator_input'),
    approval_note: z.string().min(1)
  }),
  runtime_eligible: z.literal(true),
  content_note: z.string().min(1),
  section_keys: z.array(z.string()).length(2),
  disorders: z.array(z.object({
    disorder: z.string().trim().min(1),
    sections: z.record(z.string(), SectionSchema),
    external_sources: z.array(z.unknown()).optional()
  }).passthrough()).length(130),
  revision: z.object({
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
    const raw = await readFile(new URL('../../educator-input/obgyn-disorders.reference.json', import.meta.url), 'utf8')
    const catalog = EducatorCatalogSchema.parse(JSON.parse(raw))
    const labels = catalog.disorders.map((condition) => condition.disorder)
    const sections = catalog.disorders.flatMap((condition) => Object.values(condition.sections))
    const externalSourceRecords = catalog.disorders.flatMap((condition) => condition.external_sources ?? [])
    const mayoDerivedFromUserConfirmation = sections.filter((section) => section.source_attribution.provenance_basis?.toLowerCase().includes('user-confirmed provenance'))
    const legacySourceSections = sections.filter((section) => (section.related_source_urls ?? []).length > 0)

    expect(new Set(labels).size).toBe(130)
    expect(sections).toHaveLength(260)
    expect(sections.every((section) => section.summary.trim().length > 0)).toBe(true)
    expect(sections.every((section) => section.source_url === section.source_attribution.source_url)).toBe(true)
    expect(catalog.revision.completion_backfill.section_records_filled).toHaveLength(9)
    expect(mayoDerivedFromUserConfirmation).toHaveLength(148)
    expect(mayoDerivedFromUserConfirmation.every((section) => section.source_attribution.source_name === 'Mayo Clinic')).toBe(true)
    expect(legacySourceSections.flatMap((section) => section.related_source_urls ?? [])).toHaveLength(7)
    expect(legacySourceSections.every((section) => section.source_attribution.source_name === 'Mayo Clinic' && !section.summary.toLowerCase().includes('the source'))).toBe(true)
    expect(externalSourceRecords).toHaveLength(101)
    expect(catalog.source_audit.provenance_note).toContain('Seven legacy URLs')
    expect(catalog.approval_status).toBe('approved_for_gptmd_educator_input')
    expect(catalog.educator_approval.approval_scope).toBe('gptmd_educator_input')
    expect(catalog.runtime_eligible).toBe(true)
    expect(EDUCATOR_CATALOG_PROVENANCE.conditionCount).toBe(130)
    expect(EDUCATOR_CATALOG_PROVENANCE.sha256).toMatch(/^[a-f0-9]{64}$/)
    const runtimeReference = JSON.parse(EDUCATOR_CATALOG_PROMPT_JSON) as {
      disorders: Array<{ disorder: string; sections: Record<string, { summary: string; source: string; sourceUrl: string }> }>
    }
    expect(runtimeReference.disorders).toHaveLength(130)
    expect(runtimeReference.disorders.every((condition) => Object.keys(condition.sections).length === 2)).toBe(true)
    expect(runtimeReference.disorders.flatMap((condition) => Object.values(condition.sections))
      .every((section) => section.summary.length > 0 && section.source.length > 0 && section.sourceUrl.startsWith('https://'))).toBe(true)
  })
})
