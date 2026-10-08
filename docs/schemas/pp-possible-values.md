# Patient-profile response examples

This is a writing aid for fictional patient profiles and patient-turn answers. It is not a fixed value catalog, clinical decision rule, or source of patient data. The PP schema and the per-case patient facts remain authoritative.

Each row has two views of the **same possible fact**:

- **A — common patient wording:** natural, first-person language a fictional patient might use.
- **B — clinician-assisted rendering:** a concise structured restatement or detail prompt for an MD-facing view. It must preserve what the patient actually said. It is not a diagnosis and must not add a detail the patient did not report.

Examples are options, not required answers. Pick only facts that fit the case. Direct answers are the default; a refusal is an occasional, topic-specific response and should appear far less often than direct answers—not as boilerplate repeated across fields. Sensitive answers may include uncertainty or initial hesitation. When information matters clinically, a clinician can build rapport, explain why it matters, and invite the patient to revisit the question; the patient may then choose to share fully, share partly, defer, or continue to decline. Keep `unknown`, `not_applicable`, and a patient's choice not to answer distinct from an explicit negative. Do not convert missing information into “no.” For pain fields, retain the patient's own description and record timing, location, quality, severity, pattern, and aggravating or relieving factors only when available. Gynecologic history should use open-ended questions followed by focused clarification, with sensitive questions asked respectfully and without pressure.

Pain is repeatable across all causes, with a maximum of **two distinct pain episodes per scenario**. Each episode has its own stable identifier and independent PQRST details. For example, menstrual cramps and a new abdominal pain are separate episodes; do not combine their locations, onset, severity, or other details. `anyPain` is answered across the episode list, while a focused PQRST question is associated with each relevant episode. Pain fields belong in `painEpisodes`, not as one shared flat history value.

## Symptoms and menstrual history

| PP field | A — common patient wording | B — clinician-assisted rendering / detail to preserve |
| --- | --- | --- |
| `lastMenstrualPeriod` | “It started about two weeks ago.” / “I think it was the 13th of last month.” / “It was June 4.” / “I’m irregular—maybe two months ago.” / “I don’t remember the date.” | LMP as exact date, approximate date, or unknown; retain the patient's uncertainty. Do not infer a date from cycle regularity. |
| `typicalMenstrualPeriodDescription` | “It’s regular, lasts two or three days, and the flow is light to average; I get mild cramps sometimes.” / “It’s regular and lasts about five days, with average to heavy flow.” | Patient-described cycle interval and regularity, bleeding duration and amount, and any associated symptoms. Avoid labeling bleeding normal or abnormal from a vague description. |
| `dysmenorrheaHistory` | “I get cramps before my period.” / “The cramps are bad for the first couple of days.” / “I don’t get period cramps.” | Menstrual-associated pain: when it occurs relative to bleeding, duration, severity and effect on daily activities when stated. Do not label primary or secondary dysmenorrhea from the symptom alone. |
| `anyPain` | “Yes, I have pain.” / “Not right now.” / “Sometimes, mostly around my period.” | Presence or absence, current versus episodic, and patient-described context. “Not right now” does not mean no pain history. |
| `whatProvokesPalliatesPain` | “Walking makes it worse.” / “A heating pad helps.” / “Nothing seems to change it.” | Aggravating and relieving factors, including the activity or measure and the patient's reported effect. Do not infer cause or treatment efficacy beyond the report. |
| `painQuality` | “It’s sharp.” / “More like a dull ache.” / “It feels like cramps.” / “It burns.” | Preserve the patient's descriptor; optional standardized descriptors include sharp, dull, crampy, burning, aching, or shooting when that matches their words. Do not replace their description with a disease label. |
| `painLocationRadiationWhere` | “Above my belly button.” / “Below my navel.” / “On the right at my waistline.” / “Both sides of my stomach, under my ribs.” / “All across my abdomen.” / “Around my side and into my back.” / “From my stomach down toward my pubic area.” | Patient-indicated location, side, depth if known, and radiation path as separate details. Do not infer an organ or source from location alone. |
| `painSeverity0-10` | “It’s about a six out of ten right now.” / “At its worst it gets to a nine.” / “I can’t put a number on it.” | Numeric score with its time anchor (now, typical, or worst) and the patient's own scale response. Keep inability or unwillingness to rate as unknown/refusal, not zero. |
| `timePainOnset` | “It began last month.” / “It started this past Monday.” / “It came on all of a sudden yesterday.” / “It usually starts the day before my period.” | Preserve the patient's onset estimate and sudden/gradual description or relation to a cycle/event when stated. If the scenario marks onset unknown, the fictional patient may give a brief approximate estimate only when asked; store it as a generated patient report for consistency, not as a seeded fact. Never back-calculate an exact date from the encounter date or infer onset from cycle pattern. |
| `constantIntermittentPain` | “It’s there most of the time.” / “It comes and goes.” / “It comes in waves.” | Constant versus intermittent pattern; include frequency or pattern only if the patient gives it. |
| `durationPain` | “Each episode lasts about an hour.” / “This has been going on for three months.” | Distinguish duration of each episode from duration of the overall problem; retain the patient's timeframe and uncertainty. |
| `patientConcern` | “I’m worried it could be something serious.” / “I’m afraid this might affect having children.” / “I’m mostly worried about missing work.” | Patient's stated concern, meaning, goal, or impact. Attribute it to the patient; do not infer fear, fertility concerns, or desired treatment. |

### Example: answer an MD query, then assist with a faithful clinical restatement

| MD query | A — patient answer | B — clinician-assisted restatement |
| --- | --- | --- |
| “How would you describe the pain?” | “It’s sharp, almost like a knife.” | Patient describes sharp, stabbing-quality pain. |
| “Where is it, and does it travel anywhere?” | “It starts low on the right and goes around my side into my back.” | Right-sided lower abdominal pain with patient-reported radiation around the side to the back. |
| “Do you have dysmenorrhea or period pain?” | “I get cramps with my period, mostly during the first couple of days.” | Reports menstrual-associated cramping during the first couple of days; severity and functional impact are not established unless separately reported. |

The B response is an optional normalization for the clinician-facing view. The fictional patient should ordinarily answer in their own words, and the normalized phrasing must not make the answer sound more certain or complete than the A response.

## Medical, gynecologic, medication, and allergy history

| PP field | A — common patient wording | B — clinician-assisted rendering / detail to preserve |
| --- | --- | --- |
| `medicalHistory` | “I have asthma.” / “I was told I have anemia.” / “I don’t remember the name.” | Patient-reported condition and, if known, approximate timing or who diagnosed it. Keep uncertain names uncertain. |
| `lastPelvicExam` | “I had one last year.” / “I’ve never had one.” / “I don’t remember.” | Patient-reported exam date or estimate and any result they recall; distinguish never, unknown, and not applicable. |
| `lastPapSmear` | “My last Pap test was a few years ago.” / “I’ve never had one.” / “I don’t know.” | Patient-reported cervical-screening type/date/result only as recalled. Do not infer a result or screening eligibility. |
| `lastBreastExam` | “My clinician checked my breasts at my last visit.” / “I don’t remember having one.” | Patient-reported clinical breast-exam timing/result; distinguish a clinician exam from self-checks if relevant. |
| `lastMammogram` | “I had a mammogram last year.” / “I haven’t had one.” / “I’m not sure.” | Patient-reported mammogram date/result if known. Do not infer whether one was due or indicated. |
| `comorbidity` | “I also have high blood pressure.” / “I have a thyroid condition.” / “I’m not sure what it’s called.” | Other patient-reported conditions relevant to the case; preserve patient wording and uncertainty. Do not duplicate or reinterpret an unconfirmed diagnosis. |
| `currentMedications` | “I take a blood pressure pill every morning.” / “I use an inhaler when I need it.” / “I take a few, but I don’t know their names.” | Medication name, strength, route, frequency, and reason only to the extent reported. Never invent dose, adherence, or indication. |
| `allergies` | “Penicillin gives me a rash.” / “I’m allergic to latex.” / “I don’t know of any medication allergies.” | Suspected substance and reported reaction; distinguish a known reaction, explicit no-known-allergy report, and unknown status. Do not turn an intolerance into an allergy without the patient's account. |
| `pastMedications` | “I used to take that, but stopped because it upset my stomach.” / “I don’t remember the name.” | Prior medication and reported reason stopped, effect, or adverse reaction when known. Do not infer why it was discontinued. |
| `nutraceuticalUse` | “I take a fish-oil product.” / “I don’t use those.” / “I’m not sure what counts.” | Patient-described nutraceutical product/use, frequency if known, and uncertainty. Avoid endorsing benefit. |
| `supplementVitaminUse` | “I take a multivitamin most days.” / “I don’t take vitamins.” / “I can’t recall the brand.” | Product, dose/frequency only if reported; otherwise retain the patient's level of detail. |

## Other treatments and procedures

| PP field | A — common patient wording | B — clinician-assisted rendering / detail to preserve |
| --- | --- | --- |
| `tradChineseMedicine` | “I’ve tried an herbal remedy from a traditional medicine practitioner.” / “I don’t use those treatments.” | Patient-described traditional Chinese medicine practice/product and timing if known. Do not assign a specific ingredient or effect unless reported. |
| `homeopathicTreatmentsMeds` | “I tried a homeopathic product.” / “No, I haven’t.” | Patient-described product/practice and reported use; do not equate it with a proven treatment or assume ingredients. |
| `acupunctureHistory` | “I tried acupuncture a few times.” / “I’ve never had it.” | Patient-reported acupuncture use, approximate timing, and perceived effect only if stated. |
| `surgicalHistory` | “I had my appendix removed as a teenager.” / “I’ve never had surgery.” / “I’m not sure what the procedure was called.” | Procedure and approximate date/indication only as reported; preserve uncertainty and avoid inferring operative details. |

## Pregnancy and reproductive history

**Gravidity** is the total number of confirmed pregnancies, including a current pregnancy. A person with no prior pregnancy is a **nulligravida** (G0); a person in a first pregnancy is a **primigravida** (G1); and a person with two or more pregnancies is a **multigravida** (G2 or higher), regardless of outcomes. In this PP, **parity** counts prior pregnancies reaching 20 weeks or later, once per pregnancy and regardless of outcome or number of fetuses. A pregnancy ending in stillbirth after that threshold contributes to parity; the count of live-born infants does not define parity by itself. For example, if exactly two of three pregnancies reached 20 weeks and each resulted in a singleton live birth, the shorthand is G3P2. If the person is now pregnant for a fourth time, gravidity becomes G4 while parity remains P2. Keep pregnancy-level outcomes, infant counts, and living children separate; local documentation standards may use a different gestational threshold.

| PP field | A — common patient wording | B — clinician-assisted rendering / detail to preserve |
| --- | --- | --- |
| `obstetricalHistory` | “I’ve been pregnant twice; one pregnancy ended in a miscarriage and I have one child.” / “I’ve never been pregnant.” / “I’m pregnant for the first time.” | Narrative pregnancy history with chronology, outcomes, and complications only when reported; reconcile with separate count fields without inventing missing outcomes, gestational ages, parity, or complications. Use nulligravida/primigravida/multigravida only when the known total supports the term. |
| `numberPregnancies` | “I’ve been pregnant twice.” / “I’ve never been pregnant.” / “I’m pregnant for the first time.” / “I’m not sure.” | Total confirmed pregnancies, including a current pregnancy; this is gravidity (G). Nulligravida = 0, primigravida = 1, multigravida = 2 or more. Preserve unknown rather than inferring from birth or outcome counts. |
| `numberPriorPregnanciesReaching20Weeks` | “Two of my previous pregnancies made it to at least 20 weeks.” / “None of them reached 20 weeks.” / “One ended in a stillbirth after 20 weeks.” / “I’m not sure.” | This PP's parity (P) count: prior pregnancies reaching 20 weeks or later, regardless of outcome or fetal count. Count each pregnancy once, including multiple gestations and stillbirths after the threshold. Exclude a current pregnancy because it has not ended. Do not derive this count from live births, stillbirths, gravidity, or living children unless the patient explicitly reports the value. |
| `numberMiscarriage` | “I had one miscarriage.” / “None.” / “I’m not sure how many.” | Patient-reported count; preserve explicit zero and unknown distinctly. |
| `numberStillbirths` | “I had one stillbirth.” / “None.” / “I don’t know.” | Patient-reported count; do not infer from a pregnancy narrative that lacks an outcome. |
| `numberAbortions` | “I had one abortion.” / “I had one pregnancy termination.” / “None.” | Patient-reported count, if offered; use neutral, nonjudgmental language and preserve the patient's own terminology. |
| `numberEctopicPregnancies` | “I had an ectopic pregnancy once.” / “None.” / “I’m not sure.” | Patient-reported count; do not infer from surgery or treatment unless the patient states the reason. |
| `numberPregnanciesWithLiveBirth` | “One pregnancy resulted in a baby being born alive.” / “Both of those pregnancies resulted in live births.” | Count pregnancies that resulted in one or more live-born infants; a twin or triplet pregnancy counts once here. Keep this pregnancy-level outcome separate from the number of infants born alive. |
| `numberLiveBirths` | “I’ve had two babies born alive.” / “None.” / “I don’t remember.” | Patient-reported number of infants born alive; a twin delivery counts two here. Keep separate from pregnancies with a live birth and from the current number of living children. |
| `numberChildren` | “I have two children.” / “I don’t have children.” | Patient-reported number of living children if that is what the case defines; do not substitute this for number of pregnancies or live births. |
| `tubalLigation` | “I had my tubes tied after my last pregnancy.” / “No, I haven’t.” / “I’m not sure what procedure I had.” | Patient-reported procedure and timing if known; distinguish an explicit no from unknown. |
| `hysterectomyHistory` | “I had my uterus removed about ten years ago.” / “No.” / “I don’t know the name of the surgery.” | Patient-reported hysterectomy and approximate timing/type only if known. Do not infer ovarian status or current menopausal status from hysterectomy alone. |

## Menopause-related history

| PP field | A — common patient wording | B — clinician-assisted rendering / detail to preserve |
| --- | --- | --- |
| `perimenopauseStatus` | “My periods have started changing.” / “My clinician said I may be perimenopausal.” / “I don’t know.” | Patient-reported label or changes; do not independently assign status from age or one symptom. |
| `perimenopauseSymptoms` | “I get hot flashes and my sleep is worse.” / “I haven’t noticed symptoms.” | Specific patient-reported symptoms and timing; an explicit denial is not the same as unasked/unknown. |
| `menopauseStatus` | “I haven’t had a period for over a year.” / “My clinician told me I’m menopausal.” / “I’m not sure.” | Patient-reported menstrual history or clinician-stated label. Do not diagnose menopause from an incomplete timeline. |
| `menopauseSymptoms` | “I get hot flashes.” / “I haven’t noticed anything like that.” | Patient-reported symptom, frequency/impact if given; do not infer symptoms from status. |
| `postmenopauseStatus` | “I’ve been without periods for several years.” / “I don’t know what that term means.” | Preserve the patient's reported history or stated clinician label; do not assign a stage from age alone. |
| `postmenopauseSymptoms` | “I have vaginal dryness.” / “I don’t have symptoms that I’ve noticed.” | Patient-reported symptom and impact only when offered; do not infer from postmenopausal status. |
| `hormoneReplacementTherapy` | “I use an estrogen patch.” / “I don’t take hormone therapy.” / “I’m not sure if my medicine counts.” | Patient-reported product, route, and use only as known; do not infer indication or prescribe. |

## Sexual health and relationships

Ask these questions privately when possible, normalize why they are part of care, and invite the patient to answer. A patient may initially hesitate and later share after trust and context improve; model that as a case-specific progression, not a required response. If the answer matters clinically, the clinician may explain its relevance and offer the patient a chance to answer in their own way or revisit it later. Respect a continued decline without coercion, and never treat it as a negative answer.

For example, a patient may first say, “I’d rather not talk about that.” If the information is clinically important, the clinician can acknowledge the hesitation, explain why they are asking and how the information is handled (including any limits to confidentiality), then ask whether the patient would be comfortable sharing now or later. The patient may then answer more fully, share only part, defer, or continue to decline. Building trust can make disclosure possible; it does not guarantee disclosure or justify pressure.

| PP field | A — common patient wording | B — clinician-assisted rendering / detail to preserve |
| --- | --- | --- |
| `sexualActivityCurrent` | “I’m sexually active with one partner.” / “I’m not sexually active right now.” / “I have had partners in the past, but not currently.” | Patient-reported current activity and partner details only if relevant and volunteered; do not infer orientation, risk, or consent. |
| `contraceptionMethods` | “We use condoms.” / “I have an IUD.” / “I’m not using birth control.” / “I use the pill.” | Patient-reported method(s), use pattern, and uncertainty; do not infer effectiveness, adherence, or pregnancy intent. |
| `stdHistory` | “I was treated for chlamydia a few years ago.” / “I’ve never been told I had an STI.” / “I don’t know.” | Patient-reported infection, approximate date, and treatment if known. “Never told” is not proof no infection; retain that phrasing. |
| `relationshipStatus` | “I’m married.” / “I’m dating someone.” / “I’m single.” / “I’m separated.” | Patient's own label if relevant; do not infer relationship quality, partner gender, safety, or sexual activity. |

## Family, substance use, and daily life

| PP field | A — common patient wording | B — clinician-assisted rendering / detail to preserve |
| --- | --- | --- |
| `familyMedicalHistory` | “My mother has diabetes.” / “My sister has endometriosis.” / “I don’t know much about my family’s health.” | Relative and patient-reported condition; retain degree of relationship and uncertainty. Do not impute a condition to the patient. |
| `illicitDrugUse` | “I used [substance] once.” / “I don’t use recreational drugs.” / “I tried it when I was younger, but not now.” | Use the patient's wording for substance, timing, and pattern if volunteered; ask neutrally and do not stigmatize or infer a substance-use disorder. |
| `cannabisUse` | “I use cannabis some evenings.” / “I tried it once.” / “I don’t use cannabis.” | Patient-reported cannabis use, form, timing, and frequency only as stated. Do not infer impairment, dependence, or reason for use. |
| `methadoneTreatment` | “I take methadone through a treatment program.” / “I’m not taking methadone.” / “I used to take it, but not now.” | Patient-reported treatment and current/past status only; do not infer the underlying diagnosis or reason unless stated. |
| `alcoholUse` | “I have a drink on some weekends.” / “I don’t drink.” / “I’m not sure how much.” | Patient-reported type, amount, and frequency in their own terms; do not estimate standard drinks unless details support it. |
| `nutritionHabits` | “I usually eat two meals a day.” / “I’ve had less appetite lately.” / “My meals vary.” | Patient-described pattern, appetite, or recent change; do not label diet quality or cause. |
| `sleepQualityQuantity` | “I sleep about six hours.” / “Pain wakes me up.” / “My sleep is usually fine.” | Patient-reported duration, pattern, and impact; distinguish hours from perceived quality. |
| `mentalHealthCurrent` | “I’ve felt anxious lately.” / “My mood has been okay.” / “I’ve been feeling low since I lost my job.” | Patient-reported current mood/symptoms, timeframe, and functional impact if stated; do not diagnose from a single response. |
| `mentalHealthPast` | “I had counseling in college.” / “I was treated for depression several years ago.” / “I’ve never been diagnosed with a mental health condition.” | Patient-reported history and care, preserving the difference between no diagnosis, no symptoms, and unknown. |
| `homeEnvironment` | “I live with my partner and child.” / “I’m staying with relatives right now.” / “I live alone.” | Patient-described living arrangement or relevant home context. Do not infer safety from household composition. |
| `lifeStyle` | “I work nights, so my routine changes.” / “I don’t smoke.” / “My schedule is irregular.” | Specific patient-reported habits/routine; avoid broad value judgments such as “healthy lifestyle.” Keep smoking details in the appropriate field if one is added. |
| `employmentHistory` | “I work in retail.” / “I’m between jobs.” / “I’m retired.” | Patient-reported occupation/status and relevant impact; do not infer income, insurance, or ability to access care. |
| `educationalHistory` | “I finished high school.” / “I’m in college now.” / “I left school before graduating.” | Patient-reported schooling only when relevant; do not infer literacy or comprehension from credential. |
| `exerciseCurrent` | “I walk a few times a week.” / “I haven’t been exercising lately.” / “I can’t exercise because of the pain.” | Patient-reported activity, frequency, and limitation; do not treat activity level as a diagnosis or moral judgment. |

## Safety, trauma, and other information

Ask about abuse or violence privately, explain why the question is asked, and give the patient control over how much to share. Trust can support a later disclosure, but the patient sets the pace. These are example response shapes, not screening instructions or assumptions that abuse occurred.

| PP field | A — common patient wording | B — clinician-assisted rendering / detail to preserve |
| --- | --- | --- |
| `mentalAbuseHistory` | “My partner often puts me down and controls who I see.” / “No, that hasn’t happened to me.” | Record only what the patient chooses to disclose, using their terms and relevant timeframe; no inference or repeated pressure. |
| `physicalAbuseHistory` | “A partner hit me last year.” / “No, I feel safe at home.” | Patient-disclosed event/timeframe only; distinguish explicit denial from unknown. Do not ask for unnecessary detail. |
| `sexualAbuseHistory` | “Something happened that I didn’t want, and I haven’t talked about it before.” / “No, that has not happened to me.” / “I’m not ready to talk about that today.” | Patient-disclosed information only, with consent and minimum necessary detail. A decline is one possible response, not the default; do not infer or press for a narrative. |
| `dnaStudies` | “I had genetic testing, but I don’t remember the result.” / “I haven’t had genetic testing.” | Patient-reported test, approximate date, and result only if known; do not infer a genetic risk or result. |
| `miscellaneousDetailsNos` | “There’s one more thing: the pain also wakes me up.” / “I can’t think of anything else.” / “I’m not sure.” | Catch-all for case-relevant patient-reported details that do not fit another PP field. When unknown, the fictional patient may add a concise, case-consistent detail only when asked about that detail or related symptoms; accepted details stay stable. Keep each detail attributable and cue-gated; do not use it to bypass a dedicated field, create blanket negatives, or disclose unrelated private facts. |

## Vitals in the PP and values shown on the simulated chart

The learner-facing chart shows patient name, date of birth, reason for visit, pulse rate, sitting blood pressure, respiratory rate, and measured temperature. It does not show pulse rhythm or quality, supine orthostatic blood pressure, or physical-exam findings; those remain private until a completed patient-exam workflow is available. Record case-specific findings with explicit units; do not infer a normal result from an unmeasured field.

Select pulse, blood pressure, respiratory rate, and measured temperature in context of the patient's age, pregnancy status, presentation, relevant history, acuity, and established diagnosis when available. The values should agree with one another and the overall case. A chronic or non-acute condition does not itself require abnormal vitals. Significant abnormalities or apparent contradictions need a scenario-based reason; do not make vitals abnormal merely to signal the diagnosis or reuse one generic set for every case. This is generation guidance, not a diagnosis rule or a substitute for educator review.

- `currentPulse`: measured pulse rate in beats per minute; this rate appears on the chart. `pulseIrregular` records whether the rhythm is irregular, and `pulseQuality` accepts `normal`, `thready`, `pounding`, `weak`, `absent_radial`, `absent_carotid`, or `absent_radial_and_carotid`; rhythm and quality are reserved for the patient-exam workflow.
- `bpSitting`: sitting systolic/diastolic blood pressure in mmHg; this value appears on the chart. `bpOrthostaticSupine` is systolic/diastolic blood pressure measured supine and is reserved for the patient-exam workflow.
- `respiratoryRate`: breaths per minute.
- `axillaryTemp`, `oralTemp`, `analTemp`, `dermalTemp`, and `auralTemp`: temperature in degrees Celsius by the recorded site. Each site is independently nullable: populate only sites measured in the case, and do not derive or fabricate a reading from another site. `analTemp` represents a rectal measurement and is labeled “rectal” in the chart. `arulTemp` in the original request is normalized to `auralTemp`.

## Structured patient-exam findings

These objective findings are not part of the chart. Keep them available for release through a completed, authorized patient-exam workflow. That workflow is not yet implemented, so learners do not currently receive these findings. The same boundary applies to `pulseIrregular`, `pulseQuality`, and `bpOrthostaticSupine`, which remain private in the scenario profile.

- `lungAuscultation`: structured breath sounds (`normal`, `wheeze`, `fine_rales`, `coarse_rales`, `rhonchi`); rales distribution (`basilar` or `diffuse`); rhonchi severity (`none`, `mild`, `moderate`, `marked`, `critical`) and effect of coughing; accessory-muscle use; and posture tolerance. Keep `normal` separate from abnormal sound findings.
- `skinLipsSclera`: separate color observations for skin, lips, and sclera so a finding in one location is not applied to all three.
- `skinBlanche`: capillary refill time in seconds after blanching, from 0 to 3; lower is faster/better and higher is slower/worse. It is a time measurement, not a 0–3 severity grade.

Vital-sign reference ranges vary with age and clinical context; this guide does not embed one adult range as universal. These fields support fictional scenario charting and are not a diagnostic rule.

## References informing the response structure

These references inform which symptom/history dimensions clinicians commonly clarify. The example utterances above are original fictional examples, not quotations or a substitute for a local protocol.

- National Library of Medicine, [Chapter 8: Obstetrics Terminology](https://www.ncbi.nlm.nih.gov/books/NBK607441/): definitions of gravida, nulligravida, multigravida, and para.
- Merck Manual Professional Edition, [Obstetric and Gynecologic History](https://www.merckmanuals.com/professional/gynecology-and-obstetrics/approach-to-the-gynecologic-patient/obstetric-and-gynecologic-history): open-ended then focused symptom history; menstrual, sexual, urinary, prior gynecologic, family, and social history; pelvic pain location, duration, quality, triggers, and relief.
- MedlinePlus, [Period Pain](https://medlineplus.gov/periodpain.html): patient-facing description of dysmenorrhea and common symptom language, including menstrual cramping and associated symptoms.
- American College of Obstetricians and Gynecologists, [Dysmenorrhea: Painful Periods](https://www.acog.org/womens-health/faqs/dysmenorrhea-painful-periods): patient education on period pain and its relationship to menstrual timing.
- American College of Obstetricians and Gynecologists, [reVITALize Obstetrics Data Definitions](https://www.acog.org/practice-management/health-it-and-clinical-informatics/revitalize-obstetrics-data-definitions): parity is pregnancies reaching 20 weeks or later, independent of fetal count or outcome.
- American College of Obstetricians and Gynecologists, [Medical History Form](https://www.acog.org/womens-health/health-tools/medical-history-form): separates pregnancy outcome categories, multiple births, living children, and complications by live birth.
- Centers for Disease Control and Prevention, [Guide to Taking a Sexual History](https://www.cdc.gov/sti/hcp/clinical-guidance/taking-a-sexual-history.html): normalize the discussion, explain relevance, ask permission, and use focused, patient-centered questions.
- American College of Obstetricians and Gynecologists, [Caring for Patients Who Have Experienced Trauma](https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2021/04/caring-for-patients-who-have-experienced-trauma): patient input, trust and rapport, possible later disclosure, and respect when a patient does not wish to discuss trauma.
- MedlinePlus, [Vital Signs](https://medlineplus.gov/vitalsigns.html): pulse, blood pressure, respiratory rate, and temperature; normal values depend on patient characteristics.
- Merck Manual Professional Edition, [Evaluation of the Patient With Pulmonary Issues](https://www.merckmanuals.com/professional/pulmonary-disorders/approach-to-the-pulmonary-patient/evaluation-of-the-patient-with-pulmonary-issues): lung auscultation and adventitious sounds including crackles, rhonchi, and wheezes.
- NCBI Bookshelf, [Capillary refill measurement methods](https://www.ncbi.nlm.nih.gov/books/NBK553819/table/ch7.Tab2/): timing color return after pressure-induced blanching.
