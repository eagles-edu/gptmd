# Patient Variant Voice and Variability Settings

Each of the ten age/body portrait variants has an independent, educator-owned
settings record. The variant key selects presentation settings only; it does
not determine the patient's clinical case, personality, age beyond the existing
portrait bucket, or body type beyond the portrait selection already in use.

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

The instructor workspace now has tenant-scoped draft controls for all ten
variants, browser voice previews, and an approval action. The API requires an
instructor membership, validates the complete ten-key structure, persists a
revision and append-only before/after audit, and rejects stale revisions.
Approval is rejected until all ten voice profiles and five variability bounds
per profile are explicit. Migration `026_patient_variant_settings.sql` is
applied to the live database.

For newly generated sessions, the API applies only tenant settings whose status
is `approved`; drafts are inert. The selected variant's allowed persona values
are chosen from the persisted session seed, and its voice settings are stored
as a digest-checked snapshot with the immutable scenario. Idempotent setup
retry and PostgreSQL-to-Redis recovery reuse that same snapshot. Learner
playback waits briefly for browser voice enumeration, selects the configured
voice or explicit fallback, and uses the configured locale, rate, pitch, and
volume. If neither voice is available, the reply remains in the transcript.

The implementation is deployed, but the live settings and audit tables are
empty. No educator values have been approved for live use and the instructor
workflow has not been exercised on a signed-in live account. The unfilled,
machine-readable worksheet is
[`educator-input/patient-variant-settings.template.json`](../educator-input/patient-variant-settings.template.json).
