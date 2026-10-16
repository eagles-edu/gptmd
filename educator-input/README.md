# Educator Input Reference

## OBGYN disorder catalog

`obgyn-disorders.reference.json` is an educator-review derivative of the
user-supplied `mayo_obgyn_disorders_complete.json` received on 2026-10-14.
The supplied file's SHA-256 was
`d7011fd64bf761b7824f0195683174e6c876bdc685d22964bede7a3642319334`; the
repository copy has since been edited to reconcile metadata, add section-level
attributions, and backfill empty sections. That hash does not identify the
current repository file.

The user reviewed and approved this catalog for GPTMD educator input on
2026-10-14. It is eligible for GPTMD educator input, but this approval does not
make it a clinical standard, patient-specific answer key, or completed
case/rubric. The ordinary learner session-setup generator uses its source-
attributed summaries as factual grounding for catalog-covered conditions
while generating a new fictional patient with varied history and persona.
Each saved scenario records the catalog approval, revision, and content hash.
The latest cleaned runtime source is
`obgyn-disorders.reference.diagnostics-tests-cleaned.json`. It contains 130
disorder records and 8 routine-care service records, encounter-relevance
estimates, and structured illustrative diagnostic profiles. Runtime picks one
primary focus using the supplied overall encounter-relevance estimates as
normalized sampling weights, with selection pinned to the scenario seed.
These are modeled encounter-relevance estimates, explicitly not population
incidence, prevalence, individual risk, or diagnostic certainty. The estimates
are planning values, not measured rates from a single dataset. Preserve source
attribution and review provenance; neither catalog is a patient-specific
answer key or standalone clinical standard.

Educator review also needs to define voice and communication-variability
settings independently for each age/body portrait variant. The ten variant
keys and the target settings contract are in
[`docs/patient-variant-settings.md`](../docs/patient-variant-settings.md).
Portrait age/body labels must not be used to infer personality or clinical
content. No variant-specific voice or variability settings are currently
implemented or approved. The machine-readable worksheet is
[`patient-variant-settings.template.json`](patient-variant-settings.template.json);
it has unique voice and variability profile IDs for all ten variants, with
unfilled values intentionally kept out of runtime configuration until educator
review selects the provider, voice, delivery parameters, and permitted persona
variation values.

An instructor-only, tenant-scoped editor now exists at
`/instructor/patient-variants`. It stores drafts and an explicit approval
status with an append-only audit. Locally, newly generated scenarios consume
approved settings only; persona variation and a digest-checked voice snapshot
are pinned to the scenario and reused on setup retry and state recovery.
Learner playback resolves the selected browser voice or configured fallback.
Draft settings remain inert. Migration 026 has not been applied live, no
educator values have been approved for live use, and the route does not replace
educator review or clinical approval.

## Import audit

The current cleaned runtime source has 138 records (130 disorders plus 8
routine-care services), 276 section summaries, and 138 structured diagnostic
profiles. Its metadata reports 260 source-backed disorder sections, 86
conditions with external sources, and 101 external-source records; the eight
service records account for the additional 16 section summaries. Diagnostic
examples are sent to generation for the selected focus only, rather than
adding every test profile to every provider request. They are illustrative
mock-report language, not orders or universal thresholds. The encounter
relevance scores influence case-focus sampling but must not be described as
real-world incidence.

The older reviewed JSON parses and contains 130 unique disorder labels, two named sections per
condition (260 section records), and no empty section summaries after the
2026-10-14 backfill. All 260 sections now have explicit `source_attribution`
and section-level `source_url` values. Nine Diagnosis & treatment records were
incomplete in the supplied file: eight had blank summaries, and one had a
summary but no source URL. The eight blank summaries were backfilled, and all
nine records now link to condition-specific Mayo Clinic pages. Explicit catalog
metadata repeats the measured counts: 130 conditions, 260 sections, 86
conditions with external sources, and 101 `external_sources` records. The
catalog is not Mayo-only.

The source audit found 148 sections without explicit attribution in the
supplied file. The user confirms all 148 were derived from Mayo Clinic, and the
catalog now records that provenance. Seven legacy URL values (six Pam Pearl
Hospitals and one Hanoi French Hospital) are retained under
`related_source_urls` for educator reconciliation; the seven affected summaries
were aligned to Mayo Clinic pages, while separate `external_sources` records
remain preserved. Nine sections had no URL and were backfilled with
condition-specific Mayo Clinic links. The other 112 sections retain their
pre-existing source attribution. The user reviewed and approved the catalog
for GPTMD educator input on 2026-10-14. Accordingly, `approval_status` is
`approved_for_gptmd_educator_input`, `educator_review_required` is `false`, and
`runtime_eligible` is `true`. This status does not replace case-specific source
checks or establish an approved rubric or patient answer key.

The file contains clinical reference prose, including ordinary care
recommendations, but no GPTMD/system/developer instructions were found in the
content scan. The catalog is approved as educator input, not as standalone
clinical authority. Retain source attribution and obtain any required
case-specific review before using content as a rubric or patient answer key.
