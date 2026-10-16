export interface ObgynPathologyRow {
  id: number
  cells: readonly [string, string, string, string, string, string, string, string]
  category: string
  colorClass: string
  sourceCheckbox: boolean
}

export const obgynPathologyRows: readonly ObgynPathologyRow[] = [
  {
    id: 1,
    cells: ["☐", "Electrolytes & Acid-Base", "Sodium (Na⁺)", "135 – 145 mEq/L", "135 – 145 mEq/L", "Governs extracellular fluid levels and nerve signaling.", "", ""],
    category: "Electrolytes & Acid-Base",
    colorClass: 'cell-ce1',
    sourceCheckbox: true
  },
  {
    id: 2,
    cells: ["", "", "Potassium (K⁺)", "3.5 – 5.1 mEq/L", "3.5 – 5.1 mEq/L", "Essential for skeletal and cardiac muscle contraction.", "", ""],
    category: "Electrolytes & Acid-Base",
    colorClass: 'cell-ce1',
    sourceCheckbox: false
  },
  {
    id: 3,
    cells: ["", "", "Chloride (Cl⁻)", "98 – 107 mEq/L", "98 – 107 mEq/L", "Works with sodium to preserve blood pressure and fluid distribution.", "", ""],
    category: "Electrolytes & Acid-Base",
    colorClass: 'cell-ce1',
    sourceCheckbox: false
  },
  {
    id: 4,
    cells: ["", "", "Carbon Dioxide (CO₂ / HCO₃⁻)", "22 – 29 mEq/L", "18 – 26 mEq/L", "Acts as a chemical buffer to maintain strict blood pH.", "", ""],
    category: "Electrolytes & Acid-Base",
    colorClass: 'cell-ce1',
    sourceCheckbox: false
  },
  {
    id: 5,
    cells: ["☐", "Renal (Kidney) Function", "Blood Urea Nitrogen (BUN)", "7 – 20 mg/dL", "5 – 12 mg/dL", "Measures waste products from routine protein breakdown.", "", ""],
    category: "Renal (Kidney) Function",
    colorClass: 'cell-ce2',
    sourceCheckbox: true
  },
  {
    id: 6,
    cells: ["", "", "Creatinine", "0.50 – 1.10 mg/dL", "0.40 – 0.80 mg/dL", "Evaluates muscle tissue breakdown and general kidney clearance.", "", ""],
    category: "Renal (Kidney) Function",
    colorClass: 'cell-ce2',
    sourceCheckbox: false
  },
  {
    id: 7,
    cells: ["", "", "BUN/Creatinine Ratio", "10:1 – 20:1", "10:1 – 20:1", "Differentiates between physical tissue damage and dehydration.", "", ""],
    category: "Renal (Kidney) Function",
    colorClass: 'cell-ce2',
    sourceCheckbox: false
  },
  {
    id: 8,
    cells: ["", "", "Uric Acid", "2.5 – 6.0 mg/dL", "Drops early, then rises", "Evaluates purine breakdown", "spikes signal preeclampsia.", ""],
    category: "Renal (Kidney) Function",
    colorClass: 'cell-ce2',
    sourceCheckbox: false
  },
  {
    id: 9,
    cells: ["☐", "Hepatic (Liver) Function", "Alanine Aminotransferase (ALT)", "4 – 36 U/L", "4 – 36 U/L", "Liver enzyme that rises rapidly during cellular tissue injury.", "", ""],
    category: "Hepatic (Liver) Function",
    colorClass: 'cell-ce3',
    sourceCheckbox: true
  },
  {
    id: 10,
    cells: ["", "", "Aspartate Aminotransferase (AST)", "8 – 33 U/L", "8 – 33 U/L", "Tracks active cell destruction in liver, heart, and muscles.", "", ""],
    category: "Hepatic (Liver) Function",
    colorClass: 'cell-ce3',
    sourceCheckbox: false
  },
  {
    id: 11,
    cells: ["", "", "Alkaline Phosphatase (ALP)", "30 – 120 U/L", "Can double or triple", "Identifies biliary blockage, bone disease, or placental growth.", "", ""],
    category: "Hepatic (Liver) Function",
    colorClass: 'cell-ce3',
    sourceCheckbox: false
  },
  {
    id: 12,
    cells: ["", "", "Gamma-Glutamyl Transferase (GGT)", "5 – 40 U/L", "5 – 40 U/L", "Sensitive marker for bile duct irritation or toxicity.", "", ""],
    category: "Hepatic (Liver) Function",
    colorClass: 'cell-ce3',
    sourceCheckbox: false
  },
  {
    id: 13,
    cells: ["", "", "Total Bilirubin", "0.2 – 1.2 mg/dL", "0.2 – 1.2 mg/dL", "Evaluates waste pigment from recycled red blood cells.", "", ""],
    category: "Hepatic (Liver) Function",
    colorClass: 'cell-ce3',
    sourceCheckbox: false
  },
  {
    id: 14,
    cells: ["", "", "Total Protein", "6.4 – 8.3 g/dL", "6.0 – 7.0 g/dL", "Measures the overall sum of protein floating in serum.", "", ""],
    category: "Hepatic (Liver) Function",
    colorClass: 'cell-ce3',
    sourceCheckbox: false
  },
  {
    id: 15,
    cells: ["", "", "Albumin", "3.5 – 5.0 g/dL", "3.0 – 4.2 g/dL", "Holds fluid inside blood vessels to prevent tissue swelling.", "", ""],
    category: "Hepatic (Liver) Function",
    colorClass: 'cell-ce3',
    sourceCheckbox: false
  },
  {
    id: 16,
    cells: ["", "", "pad", "2.3 – 3.4 g/dL", "2.3 – 3.4 g/dL", "Measures circulating immune system proteins (antibodies).", "", ""],
    category: "Hepatic (Liver) Function",
    colorClass: 'cell-ce3',
    sourceCheckbox: false
  },
  {
    id: 17,
    cells: ["☐", "Pancreatic Exocrine", "Amylase", "30 – 110 U/L", "30 – 110 U/L", "Enzyme tasked with digesting complex carbohydrates.", "", ""],
    category: "Pancreatic Exocrine",
    colorClass: 'cell-ce4',
    sourceCheckbox: true
  },
  {
    id: 18,
    cells: ["", "", "Lipase", "0 – 160 U/L", "0 – 160 U/L", "Specific enzyme tracking localized pancreas inflammation.", "", ""],
    category: "Pancreatic Exocrine",
    colorClass: 'cell-ce4',
    sourceCheckbox: false
  },
  {
    id: 19,
    cells: ["☐", "Metabolic & Minerals", "Fasting Glucose", "70 – 99 mg/dL", "< 95 mg/dL", "Measures baseline sugar energy levels in the bloodstream.", "", ""],
    category: "Metabolic & Minerals",
    colorClass: 'cell-ce5',
    sourceCheckbox: true
  },
  {
    id: 20,
    cells: ["", "", "Calcium", "8.6 – 10.2 mg/dL", "Drops slightly", "Crucial for cell signals, bone health, and blood clotting.", "", ""],
    category: "Metabolic & Minerals",
    colorClass: 'cell-ce5',
    sourceCheckbox: false
  },
  {
    id: 21,
    cells: ["", "", "Phosphorus", "2.5 – 4.5 mg/dL", "2.5 – 4.5 mg/dL", "Partners with calcium to regulate cellular energy storage.", "", ""],
    category: "Metabolic & Minerals",
    colorClass: 'cell-ce5',
    sourceCheckbox: false
  },
  {
    id: 22,
    cells: ["", "", "Magnesium", "1.5 – 2.5 mg/dL", "1.5 – 2.5 mg/dL", "Controls electrical enzyme signaling and muscle movements.", "", ""],
    category: "Metabolic & Minerals",
    colorClass: 'cell-ce5',
    sourceCheckbox: false
  },
  {
    id: 23,
    cells: ["☐", "Cardiovascular & Lipids", "Total Cholesterol", "< 200 mg/dL", "Rises to 250–300+", "Building blocks for cellular membranes and vital hormones.", "", ""],
    category: "Cardiovascular & Lipids",
    colorClass: 'cell-ce6',
    sourceCheckbox: true
  },
  {
    id: 24,
    cells: ["", "", "HDL (\"Good\") Cholesterol", "> 50 mg/dL", "> 50 mg/dL", "Transports cholesterol away from arteries back to the liver.", "", ""],
    category: "Cardiovascular & Lipids",
    colorClass: 'cell-ce6',
    sourceCheckbox: false
  },
  {
    id: 25,
    cells: ["", "", "LDL (\"Bad\") Cholesterol", "< 100 mg/dL", "Variable", "Tracks circulating particles linked to arterial plaque buildup.", "", ""],
    category: "Cardiovascular & Lipids",
    colorClass: 'cell-ce6',
    sourceCheckbox: false
  },
  {
    id: 26,
    cells: ["", "", "Triglycerides", "< 150 mg/dL", "Can double or triple", "Primary fat storage particle used for systemic energy.", "", ""],
    category: "Cardiovascular & Lipids",
    colorClass: 'cell-ce6',
    sourceCheckbox: false
  },
  {
    id: 27,
    cells: ["", "", "hs-CRP (Inflammation)", "< 1.0 mg/L", "< 1.0 mg/L", "Measures systemic inflammation to predict cardiac vessel risk.", "", ""],
    category: "Cardiovascular & Lipids",
    colorClass: 'cell-ce6',
    sourceCheckbox: false
  },
  {
    id: 28,
    cells: ["", "", "High-Sensitivity Troponin", "< 14 ng/L", "< 14 ng/L", "Premier emergency marker to rule out acute heart damage.", "", ""],
    category: "Cardiovascular & Lipids",
    colorClass: 'cell-ce6',
    sourceCheckbox: false
  },
  {
    id: 29,
    cells: ["☐", "Hematology (CBC)", "White Blood Cells (WBC)", "4.5 – 11.0 x10³/µL", "5.6 – 14.9 x10³/µL", "Monitors the body's acute immune responses and screens for infections.", "", ""],
    category: "Hematology (CBC)",
    colorClass: 'cell-ce7',
    sourceCheckbox: true
  },
  {
    id: 30,
    cells: ["", "", "Red Blood Cells (RBC)", "3.80 – 5.10 x10⁶/µL", "3.20 – 4.50 x10⁶/µL", "Evaluates the concentration of oxygen-carrying red blood cells.", "", ""],
    category: "Hematology (CBC)",
    colorClass: 'cell-ce7',
    sourceCheckbox: false
  },
  {
    id: 31,
    cells: ["", "", "Hemoglobin", "11.7 – 15.5 g/dL", "11.0 – 14.0 g/dL", "Directly measures oxygen-binding proteins to screen for maternal anemia.", "", ""],
    category: "Hematology (CBC)",
    colorClass: 'cell-ce7',
    sourceCheckbox: false
  },
  {
    id: 32,
    cells: ["", "", "Hematocrit", "35.0% – 45.0%", "28.0% – 40.0%", "Represents the packed cell volume percentage of red blood cells.", "", ""],
    category: "Hematology (CBC)",
    colorClass: 'cell-ce7',
    sourceCheckbox: false
  },
  {
    id: 33,
    cells: ["", "", "Platelets", "140 – 400 x10³/µL", "100 – 330 x10³/µL", "Assesses natural blood-clotting capability to prevent hemorrhaging.", "", ""],
    category: "Hematology (CBC)",
    colorClass: 'cell-ce7',
    sourceCheckbox: false
  },
  {
    id: 34,
    cells: ["☐", "Blood TYPE Compatibility", "ABO Group", "Type A, B, AB, or O", "Type A, B, AB, or O", "Identifies the basic biological blood type group of the individual.", "", ""],
    category: "Blood TYPE Compatibility",
    colorClass: 'cell-ce8',
    sourceCheckbox: true
  },
  {
    id: 35,
    cells: ["", "", "Rh Factor Type", "Positive or Negative", "Rh-Positive", "If Rh-Negative, identifies the risk for maternal-fetal blood group conflict.", "", ""],
    category: "Blood TYPE Compatibility",
    colorClass: 'cell-ce8',
    sourceCheckbox: false
  },
  {
    id: 36,
    cells: ["", "", "RBC Antibody Screen", "Negative", "Negative", "Checks for irregular immune antibodies that could attack fetal red blood cells.", "", ""],
    category: "Blood TYPE Compatibility",
    colorClass: 'cell-ce8',
    sourceCheckbox: false
  },
  {
    id: 37,
    cells: ["☐", "Infectious Serology", "Rubella Antibody (IgG)", "Negative (Non-Immune)", "Positive (Immune)", "Confirms existing vaccine-induced or natural protective immunity to German Measles.", "", ""],
    category: "Infectious Serology",
    colorClass: 'cell-ce9',
    sourceCheckbox: true
  },
  {
    id: 38,
    cells: ["☐", "Infectious Serology", "Hep B Surface Ag (HBsAg)", "Negative (Non-Reactive)", "Negative (Non-Reactive)", "Screens for active maternal Hepatitis B infection to protect newborns at delivery.", "", ""],
    category: "Infectious Serology",
    colorClass: 'cell-ce9',
    sourceCheckbox: true
  },
  {
    id: 39,
    cells: ["☐", "Infectious Serology", "Syphilis Serology (RPR)", "Negative (Non-Reactive)", "Negative (Non-Reactive)", "Screens for active syphilis infection to prevent severe congenital defects.", "", ""],
    category: "Infectious Serology",
    colorClass: 'cell-ce9',
    sourceCheckbox: true
  },
  {
    id: 40,
    cells: ["☐", "Infectious Serology", "HIV-1 / HIV-2 Screen", "Negative (Non-Reactive)", "Negative (Non-Reactive)", "Identifies HIV status to allow early antiviral therapy to prevent vertical transmission.", "", ""],
    category: "Infectious Serology",
    colorClass: 'cell-ce9',
    sourceCheckbox: true
  },
  {
    id: 41,
    cells: ["☐", "Urinalysis (UA)", "Urine Protein", "Negative to Trace", "1+ to 4+ Protein", "Key screening marker for preeclampsia or severe renal stress.", "", ""],
    category: "Urinalysis (UA)",
    colorClass: 'cell-ce10',
    sourceCheckbox: true
  },
  {
    id: 42,
    cells: ["", "", "Urine Glucose", "Negative", "Positive (Glucosuria)", "Detects renal threshold spillover, indicating gestational diabetes.", "", ""],
    category: "Urinalysis (UA)",
    colorClass: 'cell-ce10',
    sourceCheckbox: false
  },
  {
    id: 43,
    cells: ["", "", "Leukocyte Esterase & Nitrites", "Negative", "Positive", "Rapid screen for asymptomatic or acute Urinary Tract Infections (UTIs).", "", ""],
    category: "Urinalysis (UA)",
    colorClass: 'cell-ce10',
    sourceCheckbox: false
  },
  {
    id: 44,
    cells: ["", "", "Urine Culture & Sensitivity", "No Growth", ">100,000 CFU/mL", "Identifies the exact bacterial strain to guide safe antibiotic selection.", "", ""],
    category: "Urinalysis (UA)",
    colorClass: 'cell-ce10',
    sourceCheckbox: false
  },
  {
    id: 45,
    cells: ["", "", "Urine hCG", "Negative (Unless pregnant)", "Positive", "Qualitatively detects human chorionic gonadotropin to verify pregnancy.", "", ""],
    category: "Urinalysis (UA)",
    colorClass: 'cell-ce10',
    sourceCheckbox: false
  },
  {
    id: 46,
    cells: ["☐", "Cytology & Swabs", "Liquid-Based Pap Smear", "Negative for Malignancy", "ASCUS, LSIL, HSIL", "Screens cervical cells for precancerous changes or carcinoma.", "", ""],
    category: "Cytology & Swabs",
    colorClass: 'cell-ce11',
    sourceCheckbox: true
  },
  {
    id: 47,
    cells: ["☐", "Cytology & Swabs", "High-Risk HPV Co-test", "Negative", "Positive", "Detects high-risk oncogenic viral strains (e.g., HPV 16 and 18).", "", ""],
    category: "Cytology & Swabs",
    colorClass: 'cell-ce11',
    sourceCheckbox: true
  },
  {
    id: 48,
    cells: ["☐", "Cytology & Swabs", "Vaginal Wet Mount (Prep)", "Normal Lactobacilli", "Clue cells, hyphae, trichomonads", "Diagnoses Bacterial Vaginosis (BV), yeast infections, or parasites.", "", ""],
    category: "Cytology & Swabs",
    colorClass: 'cell-ce11',
    sourceCheckbox: true
  },
  {
    id: 49,
    cells: ["☐", "Cytology & Swabs", "Chlamydia & Gonorrhea NAAT", "Negative", "Positive", "Molecular screening for common, often asymptomatic STIs.", "", ""],
    category: "Cytology & Swabs",
    colorClass: 'cell-ce11',
    sourceCheckbox: true
  },
  {
    id: 50,
    cells: ["☐", "Cytology & Swabs", "Group B Strep (GBS) Culture", "Negative (at 36-37 wks)", "Positive", "Dictates the need for IV antibiotics during labor to protect the newborn.", "", ""],
    category: "Cytology & Swabs",
    colorClass: 'cell-ce11',
    sourceCheckbox: true
  },
  {
    id: 51,
    cells: ["☐", "Fetal Screens", "Cell-Free DNA (NIPT)", "Low Risk", "High Risk", "Analyzes fetal DNA in maternal blood for Trisomies (13, 18, 21).", "", ""],
    category: "Fetal Screens",
    colorClass: 'cell-ce12',
    sourceCheckbox: true
  },
  {
    id: 52,
    cells: ["☐", "Fetal Screens", "Fetal Fibronectin (fFN)", "Negative", "Positive", "Evaluates the immediate, short-term risk of preterm delivery.", "", ""],
    category: "Fetal Screens",
    colorClass: 'cell-ce12',
    sourceCheckbox: true
  },
  {
    id: 53,
    cells: ["☐", "Fetal Screens", "Nitrazine & Ferning Test", "Negative (pH 4.5–6.0)", "Positive (pH > 7.0 / Fern)", "Confirms Premature Rupture of Membranes (PROM) (broken water).", "", ""],
    category: "Fetal Screens",
    colorClass: 'cell-ce12',
    sourceCheckbox: true
  },
  {
    id: 54,
    cells: ["", "", "", "", "", "", "", ""],
    category: "Fetal Screens",
    colorClass: 'cell-ce12',
    sourceCheckbox: false
  },
  {
    id: 55,
    cells: ["", "", "", "", "", "", "", ""],
    category: "Fetal Screens",
    colorClass: 'cell-ce12',
    sourceCheckbox: false
  },
]

export const obgynPathologySectionClasses = {
  "Electrolytes & Acid-Base": "cell-ce1",
  "Renal (Kidney) Function": "cell-ce2",
  "Hepatic (Liver) Function": "cell-ce3",
  "Pancreatic Exocrine": "cell-ce4",
  "Metabolic & Minerals": "cell-ce5",
  "Cardiovascular & Lipids": "cell-ce6",
  "Hematology (CBC)": "cell-ce7",
  "Blood TYPE Compatibility": "cell-ce8",
  "Infectious Serology": "cell-ce9",
  "Urinalysis (UA)": "cell-ce10",
  "Cytology & Swabs": "cell-ce11",
  "Fetal Screens": "cell-ce12"
} as const
