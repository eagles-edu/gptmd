// Generated from docs/schemas/pp-possible-values.md; edit the Markdown source instead.
export const PATIENT_PROFILE_RESPONSE_POLICY = "This is a writing aid for fictional patient profiles and patient-turn answers. It is not a fixed value catalog, clinical decision rule, or source of patient data. The PP schema and the per-case patient facts remain authoritative.\n\nEach row has two views of the **same possible fact**:\n\n- **A — common patient wording:** natural, first-person language a fictional patient might use.\n- **B — clinician-assisted rendering:** a concise structured restatement or detail prompt for an MD-facing view. It must preserve what the patient actually said. It is not a diagnosis and must not add a detail the patient did not report.\n\nExamples are options, not required answers. Pick only facts that fit the case. Direct answers are the default; a refusal is an occasional, topic-specific response and should appear far less often than direct answers—not as boilerplate repeated across fields. Sensitive answers may include uncertainty or initial hesitation. When information matters clinically, a clinician can build rapport, explain why it matters, and invite the patient to revisit the question; the patient may then choose to share fully, share partly, defer, or continue to decline. Keep `unknown`, `not_applicable`, and a patient's choice not to answer distinct from an explicit negative. Do not convert missing information into “no.” For pain fields, retain the patient's own description and record timing, location, quality, severity, pattern, and aggravating or relieving factors only when available. Gynecologic history should use open-ended questions followed by focused clarification, with sensitive questions asked respectfully and without pressure.\n\nPain is repeatable across all causes, with a maximum of **two distinct pain episodes per scenario**. Each episode has its own stable identifier and independent PQRST details. For example, menstrual cramps and a new abdominal pain are separate episodes; do not combine their locations, onset, severity, or other details. `anyPain` is answered across the episode list, while a focused PQRST question is associated with each relevant episode. Pain fields belong in `painEpisodes`, not as one shared flat history value."
export const PATIENT_PROFILE_RESPONSE_GUIDANCE = {
  "lastMenstrualPeriod": {
    "commonPatientWording": "“It started about two weeks ago.” / “I think it was the 13th of last month.” / “It was June 4.” / “I’m irregular—maybe two months ago.” / “I don’t remember the date.”",
    "clinicianAssistedGuidance": "LMP as exact date, approximate date, or unknown; retain the patient's uncertainty. Do not infer a date from cycle regularity."
  },
  "typicalMenstrualPeriodDescription": {
    "commonPatientWording": "“It’s regular, lasts two or three days, and the flow is light to average; I get mild cramps sometimes.” / “It’s regular and lasts about five days, with average to heavy flow.”",
    "clinicianAssistedGuidance": "Patient-described cycle interval and regularity, bleeding duration and amount, and any associated symptoms. Avoid labeling bleeding normal or abnormal from a vague description."
  },
  "dysmenorrheaHistory": {
    "commonPatientWording": "“I get cramps before my period.” / “The cramps are bad for the first couple of days.” / “I don’t get period cramps.”",
    "clinicianAssistedGuidance": "Menstrual-associated pain: when it occurs relative to bleeding, duration, severity and effect on daily activities when stated. Do not label primary or secondary dysmenorrhea from the symptom alone."
  },
  "anyPain": {
    "commonPatientWording": "“Yes, I have pain.” / “Not right now.” / “Sometimes, mostly around my period.”",
    "clinicianAssistedGuidance": "Presence or absence, current versus episodic, and patient-described context. “Not right now” does not mean no pain history."
  },
  "whatProvokesPalliatesPain": {
    "commonPatientWording": "“Walking makes it worse.” / “A heating pad helps.” / “Nothing seems to change it.”",
    "clinicianAssistedGuidance": "Aggravating and relieving factors, including the activity or measure and the patient's reported effect. Do not infer cause or treatment efficacy beyond the report."
  },
  "painQuality": {
    "commonPatientWording": "“It’s sharp.” / “More like a dull ache.” / “It feels like cramps.” / “It burns.”",
    "clinicianAssistedGuidance": "Preserve the patient's descriptor; optional standardized descriptors include sharp, dull, crampy, burning, aching, or shooting when that matches their words. Do not replace their description with a disease label."
  },
  "painLocationRadiationWhere": {
    "commonPatientWording": "“Above my belly button.” / “Below my navel.” / “On the right at my waistline.” / “Both sides of my stomach, under my ribs.” / “All across my abdomen.” / “Around my side and into my back.” / “From my stomach down toward my pubic area.”",
    "clinicianAssistedGuidance": "Patient-indicated location, side, depth if known, and radiation path as separate details. Do not infer an organ or source from location alone."
  },
  "painSeverity0-10": {
    "commonPatientWording": "“It’s about a six out of ten right now.” / “At its worst it gets to a nine.” / “I can’t put a number on it.”",
    "clinicianAssistedGuidance": "Numeric score with its time anchor (now, typical, or worst) and the patient's own scale response. Keep inability or unwillingness to rate as unknown/refusal, not zero."
  },
  "timePainOnset": {
    "commonPatientWording": "“It began last month.” / “It started this past Monday.” / “It came on all of a sudden yesterday.” / “It usually starts the day before my period.”",
    "clinicianAssistedGuidance": "Preserve the patient's onset estimate and sudden/gradual description or relation to a cycle/event when stated. If the scenario marks onset unknown, the fictional patient may give a brief approximate estimate only when asked; store it as a generated patient report for consistency, not as a seeded fact. Never back-calculate an exact date from the encounter date or infer onset from cycle pattern."
  },
  "constantIntermittentPain": {
    "commonPatientWording": "“It’s there most of the time.” / “It comes and goes.” / “It comes in waves.”",
    "clinicianAssistedGuidance": "Constant versus intermittent pattern; include frequency or pattern only if the patient gives it."
  },
  "durationPain": {
    "commonPatientWording": "“Each episode lasts about an hour.” / “This has been going on for three months.”",
    "clinicianAssistedGuidance": "Distinguish duration of each episode from duration of the overall problem; retain the patient's timeframe and uncertainty."
  },
  "patientConcern": {
    "commonPatientWording": "“I’m worried it could be something serious.” / “I’m afraid this might affect having children.” / “I’m mostly worried about missing work.”",
    "clinicianAssistedGuidance": "Patient's stated concern, meaning, goal, or impact. Attribute it to the patient; do not infer fear, fertility concerns, or desired treatment."
  },
  "medicalHistory": {
    "commonPatientWording": "“I have asthma.” / “I was told I have anemia.” / “I don’t remember the name.”",
    "clinicianAssistedGuidance": "Patient-reported condition and, if known, approximate timing or who diagnosed it. Keep uncertain names uncertain."
  },
  "lastPelvicExam": {
    "commonPatientWording": "“I had one last year.” / “I’ve never had one.” / “I don’t remember.”",
    "clinicianAssistedGuidance": "Patient-reported exam date or estimate and any result they recall; distinguish never, unknown, and not applicable."
  },
  "lastPapSmear": {
    "commonPatientWording": "“My last Pap test was a few years ago.” / “I’ve never had one.” / “I don’t know.”",
    "clinicianAssistedGuidance": "Patient-reported cervical-screening type/date/result only as recalled. Do not infer a result or screening eligibility."
  },
  "lastBreastExam": {
    "commonPatientWording": "“My clinician checked my breasts at my last visit.” / “I don’t remember having one.”",
    "clinicianAssistedGuidance": "Patient-reported clinical breast-exam timing/result; distinguish a clinician exam from self-checks if relevant."
  },
  "lastMammogram": {
    "commonPatientWording": "“I had a mammogram last year.” / “I haven’t had one.” / “I’m not sure.”",
    "clinicianAssistedGuidance": "Patient-reported mammogram date/result if known. Do not infer whether one was due or indicated."
  },
  "comorbidity": {
    "commonPatientWording": "“I also have high blood pressure.” / “I have a thyroid condition.” / “I’m not sure what it’s called.”",
    "clinicianAssistedGuidance": "Other patient-reported conditions relevant to the case; preserve patient wording and uncertainty. Do not duplicate or reinterpret an unconfirmed diagnosis."
  },
  "currentMedications": {
    "commonPatientWording": "“I take a blood pressure pill every morning.” / “I use an inhaler when I need it.” / “I take a few, but I don’t know their names.”",
    "clinicianAssistedGuidance": "Medication name, strength, route, frequency, and reason only to the extent reported. Never invent dose, adherence, or indication."
  },
  "allergies": {
    "commonPatientWording": "“Penicillin gives me a rash.” / “I’m allergic to latex.” / “I don’t know of any medication allergies.”",
    "clinicianAssistedGuidance": "Suspected substance and reported reaction; distinguish a known reaction, explicit no-known-allergy report, and unknown status. Do not turn an intolerance into an allergy without the patient's account."
  },
  "pastMedications": {
    "commonPatientWording": "“I used to take that, but stopped because it upset my stomach.” / “I don’t remember the name.”",
    "clinicianAssistedGuidance": "Prior medication and reported reason stopped, effect, or adverse reaction when known. Do not infer why it was discontinued."
  },
  "nutraceuticalUse": {
    "commonPatientWording": "“I take a fish-oil product.” / “I don’t use those.” / “I’m not sure what counts.”",
    "clinicianAssistedGuidance": "Patient-described nutraceutical product/use, frequency if known, and uncertainty. Avoid endorsing benefit."
  },
  "supplementVitaminUse": {
    "commonPatientWording": "“I take a multivitamin most days.” / “I don’t take vitamins.” / “I can’t recall the brand.”",
    "clinicianAssistedGuidance": "Product, dose/frequency only if reported; otherwise retain the patient's level of detail."
  },
  "tradChineseMedicine": {
    "commonPatientWording": "“I’ve tried an herbal remedy from a traditional medicine practitioner.” / “I don’t use those treatments.”",
    "clinicianAssistedGuidance": "Patient-described traditional Chinese medicine practice/product and timing if known. Do not assign a specific ingredient or effect unless reported."
  },
  "homeopathicTreatmentsMeds": {
    "commonPatientWording": "“I tried a homeopathic product.” / “No, I haven’t.”",
    "clinicianAssistedGuidance": "Patient-described product/practice and reported use; do not equate it with a proven treatment or assume ingredients."
  },
  "acupunctureHistory": {
    "commonPatientWording": "“I tried acupuncture a few times.” / “I’ve never had it.”",
    "clinicianAssistedGuidance": "Patient-reported acupuncture use, approximate timing, and perceived effect only if stated."
  },
  "surgicalHistory": {
    "commonPatientWording": "“I had my appendix removed as a teenager.” / “I’ve never had surgery.” / “I’m not sure what the procedure was called.”",
    "clinicianAssistedGuidance": "Procedure and approximate date/indication only as reported; preserve uncertainty and avoid inferring operative details."
  },
  "obstetricalHistory": {
    "commonPatientWording": "“I’ve been pregnant twice; one pregnancy ended in a miscarriage and I have one child.” / “I’ve never been pregnant.” / “I’m pregnant for the first time.”",
    "clinicianAssistedGuidance": "Narrative pregnancy history with chronology, outcomes, and complications only when reported; reconcile with separate count fields without inventing missing outcomes, gestational ages, parity, or complications. Use nulligravida/primigravida/multigravida only when the known total supports the term."
  },
  "numberPregnancies": {
    "commonPatientWording": "“I’ve been pregnant twice.” / “I’ve never been pregnant.” / “I’m pregnant for the first time.” / “I’m not sure.”",
    "clinicianAssistedGuidance": "Total confirmed pregnancies, including a current pregnancy; this is gravidity (G). Nulligravida = 0, primigravida = 1, multigravida = 2 or more. Preserve unknown rather than inferring from birth or outcome counts."
  },
  "numberPriorPregnanciesReaching20Weeks": {
    "commonPatientWording": "“Two of my previous pregnancies made it to at least 20 weeks.” / “None of them reached 20 weeks.” / “One ended in a stillbirth after 20 weeks.” / “I’m not sure.”",
    "clinicianAssistedGuidance": "This PP's parity (P) count: prior pregnancies reaching 20 weeks or later, regardless of outcome or fetal count. Count each pregnancy once, including multiple gestations and stillbirths after the threshold. Exclude a current pregnancy because it has not ended. Do not derive this count from live births, stillbirths, gravidity, or living children unless the patient explicitly reports the value."
  },
  "numberMiscarriage": {
    "commonPatientWording": "“I had one miscarriage.” / “None.” / “I’m not sure how many.”",
    "clinicianAssistedGuidance": "Patient-reported count; preserve explicit zero and unknown distinctly."
  },
  "numberStillbirths": {
    "commonPatientWording": "“I had one stillbirth.” / “None.” / “I don’t know.”",
    "clinicianAssistedGuidance": "Patient-reported count; do not infer from a pregnancy narrative that lacks an outcome."
  },
  "numberAbortions": {
    "commonPatientWording": "“I had one abortion.” / “I had one pregnancy termination.” / “None.”",
    "clinicianAssistedGuidance": "Patient-reported count, if offered; use neutral, nonjudgmental language and preserve the patient's own terminology."
  },
  "numberEctopicPregnancies": {
    "commonPatientWording": "“I had an ectopic pregnancy once.” / “None.” / “I’m not sure.”",
    "clinicianAssistedGuidance": "Patient-reported count; do not infer from surgery or treatment unless the patient states the reason."
  },
  "numberPregnanciesWithLiveBirth": {
    "commonPatientWording": "“One pregnancy resulted in a baby being born alive.” / “Both of those pregnancies resulted in live births.”",
    "clinicianAssistedGuidance": "Count pregnancies that resulted in one or more live-born infants; a twin or triplet pregnancy counts once here. Keep this pregnancy-level outcome separate from the number of infants born alive."
  },
  "numberLiveBirths": {
    "commonPatientWording": "“I’ve had two babies born alive.” / “None.” / “I don’t remember.”",
    "clinicianAssistedGuidance": "Patient-reported number of infants born alive; a twin delivery counts two here. Keep separate from pregnancies with a live birth and from the current number of living children."
  },
  "numberChildren": {
    "commonPatientWording": "“I have two children.” / “I don’t have children.”",
    "clinicianAssistedGuidance": "Patient-reported number of living children if that is what the case defines; do not substitute this for number of pregnancies or live births."
  },
  "tubalLigation": {
    "commonPatientWording": "“I had my tubes tied after my last pregnancy.” / “No, I haven’t.” / “I’m not sure what procedure I had.”",
    "clinicianAssistedGuidance": "Patient-reported procedure and timing if known; distinguish an explicit no from unknown."
  },
  "hysterectomyHistory": {
    "commonPatientWording": "“I had my uterus removed about ten years ago.” / “No.” / “I don’t know the name of the surgery.”",
    "clinicianAssistedGuidance": "Patient-reported hysterectomy and approximate timing/type only if known. Do not infer ovarian status or current menopausal status from hysterectomy alone."
  },
  "perimenopauseStatus": {
    "commonPatientWording": "“My periods have started changing.” / “My clinician said I may be perimenopausal.” / “I don’t know.”",
    "clinicianAssistedGuidance": "Patient-reported label or changes; do not independently assign status from age or one symptom."
  },
  "perimenopauseSymptoms": {
    "commonPatientWording": "“I get hot flashes and my sleep is worse.” / “I haven’t noticed symptoms.”",
    "clinicianAssistedGuidance": "Specific patient-reported symptoms and timing; an explicit denial is not the same as unasked/unknown."
  },
  "menopauseStatus": {
    "commonPatientWording": "“I haven’t had a period for over a year.” / “My clinician told me I’m menopausal.” / “I’m not sure.”",
    "clinicianAssistedGuidance": "Patient-reported menstrual history or clinician-stated label. Do not diagnose menopause from an incomplete timeline."
  },
  "menopauseSymptoms": {
    "commonPatientWording": "“I get hot flashes.” / “I haven’t noticed anything like that.”",
    "clinicianAssistedGuidance": "Patient-reported symptom, frequency/impact if given; do not infer symptoms from status."
  },
  "postmenopauseStatus": {
    "commonPatientWording": "“I’ve been without periods for several years.” / “I don’t know what that term means.”",
    "clinicianAssistedGuidance": "Preserve the patient's reported history or stated clinician label; do not assign a stage from age alone."
  },
  "postmenopauseSymptoms": {
    "commonPatientWording": "“I have vaginal dryness.” / “I don’t have symptoms that I’ve noticed.”",
    "clinicianAssistedGuidance": "Patient-reported symptom and impact only when offered; do not infer from postmenopausal status."
  },
  "hormoneReplacementTherapy": {
    "commonPatientWording": "“I use an estrogen patch.” / “I don’t take hormone therapy.” / “I’m not sure if my medicine counts.”",
    "clinicianAssistedGuidance": "Patient-reported product, route, and use only as known; do not infer indication or prescribe."
  },
  "sexualActivityCurrent": {
    "commonPatientWording": "“I’m sexually active with one partner.” / “I’m not sexually active right now.” / “I have had partners in the past, but not currently.”",
    "clinicianAssistedGuidance": "Patient-reported current activity and partner details only if relevant and volunteered; do not infer orientation, risk, or consent."
  },
  "contraceptionMethods": {
    "commonPatientWording": "“We use condoms.” / “I have an IUD.” / “I’m not using birth control.” / “I use the pill.”",
    "clinicianAssistedGuidance": "Patient-reported method(s), use pattern, and uncertainty; do not infer effectiveness, adherence, or pregnancy intent."
  },
  "stdHistory": {
    "commonPatientWording": "“I was treated for chlamydia a few years ago.” / “I’ve never been told I had an STI.” / “I don’t know.”",
    "clinicianAssistedGuidance": "Patient-reported infection, approximate date, and treatment if known. “Never told” is not proof no infection; retain that phrasing."
  },
  "relationshipStatus": {
    "commonPatientWording": "“I’m married.” / “I’m dating someone.” / “I’m single.” / “I’m separated.”",
    "clinicianAssistedGuidance": "Patient's own label if relevant; do not infer relationship quality, partner gender, safety, or sexual activity."
  },
  "familyMedicalHistory": {
    "commonPatientWording": "“My mother has diabetes.” / “My sister has endometriosis.” / “I don’t know much about my family’s health.”",
    "clinicianAssistedGuidance": "Relative and patient-reported condition; retain degree of relationship and uncertainty. Do not impute a condition to the patient."
  },
  "illicitDrugUse": {
    "commonPatientWording": "“I used [substance] once.” / “I don’t use recreational drugs.” / “I tried it when I was younger, but not now.”",
    "clinicianAssistedGuidance": "Use the patient's wording for substance, timing, and pattern if volunteered; ask neutrally and do not stigmatize or infer a substance-use disorder."
  },
  "cannabisUse": {
    "commonPatientWording": "“I use cannabis some evenings.” / “I tried it once.” / “I don’t use cannabis.”",
    "clinicianAssistedGuidance": "Patient-reported cannabis use, form, timing, and frequency only as stated. Do not infer impairment, dependence, or reason for use."
  },
  "methadoneTreatment": {
    "commonPatientWording": "“I take methadone through a treatment program.” / “I’m not taking methadone.” / “I used to take it, but not now.”",
    "clinicianAssistedGuidance": "Patient-reported treatment and current/past status only; do not infer the underlying diagnosis or reason unless stated."
  },
  "alcoholUse": {
    "commonPatientWording": "“I have a drink on some weekends.” / “I don’t drink.” / “I’m not sure how much.”",
    "clinicianAssistedGuidance": "Patient-reported type, amount, and frequency in their own terms; do not estimate standard drinks unless details support it."
  },
  "nutritionHabits": {
    "commonPatientWording": "“I usually eat two meals a day.” / “I’ve had less appetite lately.” / “My meals vary.”",
    "clinicianAssistedGuidance": "Patient-described pattern, appetite, or recent change; do not label diet quality or cause."
  },
  "sleepQualityQuantity": {
    "commonPatientWording": "“I sleep about six hours.” / “Pain wakes me up.” / “My sleep is usually fine.”",
    "clinicianAssistedGuidance": "Patient-reported duration, pattern, and impact; distinguish hours from perceived quality."
  },
  "mentalHealthCurrent": {
    "commonPatientWording": "“I’ve felt anxious lately.” / “My mood has been okay.” / “I’ve been feeling low since I lost my job.”",
    "clinicianAssistedGuidance": "Patient-reported current mood/symptoms, timeframe, and functional impact if stated; do not diagnose from a single response."
  },
  "mentalHealthPast": {
    "commonPatientWording": "“I had counseling in college.” / “I was treated for depression several years ago.” / “I’ve never been diagnosed with a mental health condition.”",
    "clinicianAssistedGuidance": "Patient-reported history and care, preserving the difference between no diagnosis, no symptoms, and unknown."
  },
  "homeEnvironment": {
    "commonPatientWording": "“I live with my partner and child.” / “I’m staying with relatives right now.” / “I live alone.”",
    "clinicianAssistedGuidance": "Patient-described living arrangement or relevant home context. Do not infer safety from household composition."
  },
  "lifeStyle": {
    "commonPatientWording": "“I work nights, so my routine changes.” / “I don’t smoke.” / “My schedule is irregular.”",
    "clinicianAssistedGuidance": "Specific patient-reported habits/routine; avoid broad value judgments such as “healthy lifestyle.” Keep smoking details in the appropriate field if one is added."
  },
  "employmentHistory": {
    "commonPatientWording": "“I work in retail.” / “I’m between jobs.” / “I’m retired.”",
    "clinicianAssistedGuidance": "Patient-reported occupation/status and relevant impact; do not infer income, insurance, or ability to access care."
  },
  "educationalHistory": {
    "commonPatientWording": "“I finished high school.” / “I’m in college now.” / “I left school before graduating.”",
    "clinicianAssistedGuidance": "Patient-reported schooling only when relevant; do not infer literacy or comprehension from credential."
  },
  "exerciseCurrent": {
    "commonPatientWording": "“I walk a few times a week.” / “I haven’t been exercising lately.” / “I can’t exercise because of the pain.”",
    "clinicianAssistedGuidance": "Patient-reported activity, frequency, and limitation; do not treat activity level as a diagnosis or moral judgment."
  },
  "mentalAbuseHistory": {
    "commonPatientWording": "“My partner often puts me down and controls who I see.” / “No, that hasn’t happened to me.”",
    "clinicianAssistedGuidance": "Record only what the patient chooses to disclose, using their terms and relevant timeframe; no inference or repeated pressure."
  },
  "physicalAbuseHistory": {
    "commonPatientWording": "“A partner hit me last year.” / “No, I feel safe at home.”",
    "clinicianAssistedGuidance": "Patient-disclosed event/timeframe only; distinguish explicit denial from unknown. Do not ask for unnecessary detail."
  },
  "sexualAbuseHistory": {
    "commonPatientWording": "“Something happened that I didn’t want, and I haven’t talked about it before.” / “No, that has not happened to me.” / “I’m not ready to talk about that today.”",
    "clinicianAssistedGuidance": "Patient-disclosed information only, with consent and minimum necessary detail. A decline is one possible response, not the default; do not infer or press for a narrative."
  },
  "dnaStudies": {
    "commonPatientWording": "“I had genetic testing, but I don’t remember the result.” / “I haven’t had genetic testing.”",
    "clinicianAssistedGuidance": "Patient-reported test, approximate date, and result only if known; do not infer a genetic risk or result."
  },
  "miscellaneousDetailsNos": {
    "commonPatientWording": "“There’s one more thing: the pain also wakes me up.” / “I can’t think of anything else.” / “I’m not sure.”",
    "clinicianAssistedGuidance": "Catch-all for case-relevant patient-reported details that do not fit another PP field. When unknown, the fictional patient may add a concise, case-consistent detail only when asked about that detail or related symptoms; accepted details stay stable. Keep each detail attributable and cue-gated; do not use it to bypass a dedicated field, create blanket negatives, or disclose unrelated private facts."
  }
} as const
