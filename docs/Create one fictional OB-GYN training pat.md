# gptMD Setup Prompt

```markdown
- Create one fictional OB-GYN patient as a complete medical scenario profile.
- Use the supplied structured schema and the complete canonical patient-profile parameter catalog **in the developer context**.
- Treat the catalog as the authoritative, yet not exhaustive inventory of PP fields and setup parameters.
- Include rich history fields relevant to this case; do not fill every available field.
- For each included history entry, use known for a patient-reported symptom or established detail, negative for an explicit negative, unknown when relevant but not known, and not_applicable only when the field does not.
- Unknown and not_applicable values must be null.
- Do not turn missing information into a negative.
- Represent pain in `painEpisodes`, with no more than two separate instances across all causes. Give each episode its own stable ID, patient description, current/intermittent/past status, and independent known/negative/unknown/not-applicable PQRST details. Do not put pain facts in flat history entries or blend separate pains.
- Use the dedicated fields for quality, location and radiation, severity, onset, pattern, duration, and provoking or relieving factors.
- Keep onset within the matching pain episode’s `timePainOnset` detail rather than learner-visible `reasonForVisit`.
- When case-relevant associated symptoms or negatives are not already represented by a dedicated field, include miscellaneousDetailsNos as unknown so the patient can answer on demand.
- Do not seed blanket negatives or expose these details in reasonForVisit.
- Use currentMenopausalStatus for the scenario’s present-state truth.
- Keep the separate menopauseStatus history entry for the applicable patient-reported/history detail; do not use it as a substitute for currentMenopausalStatus.
- Make the current reason, history, diagnosis if any, patient beliefs, examination findings, and test results internally consistent.
- Invent no unsupported test result.
- Gravidity (G) is the total number of confirmed pregnancies, including a current pregnancy: nulligravida = 0, primigravida = 1, and multigravida = 2 or more, regardless of outcome.
- In this PP, parity (P) is the patient-reported number of completed prior pregnancies reaching 20 weeks or later, regardless of outcome or fetal count; count each pregnancy once and exclude a current pregnancy.
- Do not infer parity from live births, stillbirths, gravidity, or living-child counts. For example, if exactly two of three pregnancies reached 20 weeks, G3P2; if a fourth pregnancy is current, G4P2.
- Keep pregnancy-level outcomes, infant counts, and living children separate.
- numberPregnanciesWithLiveBirth counts pregnancies resulting in one or more live-born infants, while numberLiveBirths counts the infants; a multiple pregnancy counts once in the former and once per live-born infant in the latter.
- numberChildren is the current living-child count and must not be inferred from births.
- Include obstetricalHistory complications only when supported by the scenario and patient report.
- Include a concise, patient-voiced primary concern as the patientConcern history field when one is relevant to the case.
- Keep it distinct from the clinician-only diagnosis and disclose it only when asked about worries or concerns.
- Use dateOfBirth in YYYY-MM-DD format.
- A 16-year-old must not have currentMenopausalStatus menopausal.
- A 75-year-old must not currently be pregnant; a coherent history of past pregnancies is allowed.
- Keep diagnosis private in this profile.
- The later learner-facing profile is a separate projection.
- Vary the persona traits once for this scenario and keep them stable for the session.
- Use the supplied scenario variation seed to make consistent choices among compatible scenario details.
- This seed is a stable variation hint, not a guarantee of identical generated text.
```
