# Patient Variant Voice and Variability Settings

Each of the ten age/body portrait variants has an independent TEAECL-managed
settings record. Only the GPTMD system administrator may control voices and
communication variability; learners and hospital administrators must not
select or edit model, voice, reasoning, or personality settings. The variant
key selects presentation settings only; it does not determine the patient's
clinical case, personality, age beyond the existing portrait bucket, or body
type beyond the portrait selection already in use.

## Variant keys

| Variant key | Age band | Body type | Voice profile | Variability profile |
| --- | --- | --- | --- | --- |
| `1019-average` | 10-19 | average | educator input required | educator input required |
| `1019-heavy` | 10-19 | heavy | educator input required | educator input required |
| `2029-average` | 20-29 | average | educator input required | educator input required |
| `2029-heavy` | 20-29 | heavy | educator input required | educator input required |
| `3039-average` | 30-39 | average | educator input required | educator input required |
| `3039-heavy` | 30-39 | heavy | educator input required | educator input required |
| `4049-average` | 40-49 | average | educator input required | educator input required |
| `4049-heavy` | 40-49 | heavy | educator input required | educator input required |
| `5059-average` | 50-59 | average | educator input required | educator input required |
| `5059-heavy` | 50-59 | heavy | educator input required | educator input required |

Each row owns a separate record and can be tuned independently. Values may be
shared deliberately, but records must not alias another variant's mutable
settings. Do not infer a voice, personality, literacy level, mood, or disclosure
behavior from age or body type.

## Settings contract

The versioned voice profile must name a stable voice choice and its provider or
browser mapping, locale, speaking rate, pitch, and volume. Runtime resolution
must report when a selected voice is unavailable and use an explicit configured
fallback; silently accepting the device's default voice does not satisfy this
contract. Voice choice affects audio presentation only, never patient facts.

The versioned variability profile must define allowed variation independently
for mood, maturity, verbosity, health-literacy level, and willingness to
disclose. Generation uses the session's persisted variation seed within these
bounds, then pins the resulting persona for that session. Variability may
change communication style, not case truth, symptoms, findings, test results,
diagnosis, or rubric expectations. Do not reuse one seed across sessions as a
promise of deterministic model prose.

The editor for all ten variants, including browser voice previews and approval,
is now exposed at `/system-admin/patient-variants`. The tenant selector and
tenant-scoped read/write API are protected by the exact TEAECL system-admin
subject allowlist. The former instructor API paths return `403`; hospital
administrators and learners cannot read or change these settings. The existing
ten-key validation, revision checks, and append-only audit are preserved.
Migration `026_patient_variant_settings.sql` is applied to the live database.

For newly generated sessions, the API applies only tenant settings whose status
is `approved`; drafts are inert. The selected variant's allowed persona values
are chosen from the persisted session seed, and its voice settings are stored
as a digest-checked snapshot with the immutable scenario. Idempotent setup
retry and PostgreSQL-to-Redis recovery reuse that same snapshot. Learner
playback waits briefly for browser voice enumeration, selects the configured
voice or explicit fallback, and uses the configured locale, rate, pitch, and
volume. If neither voice is available, the reply remains in the transcript.

Release `2026-10-16T143141766Z` deploys the system-admin authority change. The
live route and OAuth/browser preflights pass, and the deployed API bundle
contains system-admin tenant read/write routes plus explicit instructor-route
403 responses. The live settings and audit tables currently have zero rows; no
values have been approved or changed. Authenticated instructor and
system-admin browser flows are covered locally, but an authenticated live
browser session has not yet verified those roles. The current worktree adds a
server speech provider choice, an allowlisted system-admin monthly character
policy, idempotent per-turn usage charging, and a streamed API response sourced
only from the accepted patient turn. The browser currently buffers that
response before playback and falls back to the configured browser voice when
server speech is unavailable. These changes are local only: migration 043 has
not been applied or deployed, the default speech policy is disabled, and no
live generated speech has been tested. Patient/microphone recording and the
72-hour audio archive remain separate, unimplemented work. The unfilled,
machine-readable worksheet is
[`educator-input/patient-variant-settings.template.json`](../educator-input/patient-variant-settings.template.json).
