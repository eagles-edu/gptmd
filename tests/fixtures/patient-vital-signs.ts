import type {
  PatientPhysicalExamFindings,
  PatientVitalSigns
} from '../../services/api/src/patient-profile.ts'

/** A normal, internally consistent chart fixture shared by contract and browser tests. */
export const TEST_PATIENT_VITAL_SIGNS = {
  currentPulse: 76,
  pulseIrregular: false,
  pulseQuality: 'normal',
  bpSitting: { systolic: 118, diastolic: 74 },
  bpOrthostaticSupine: null,
  respiratoryRate: 16,
  axillaryTemp: null,
  oralTemp: 36.8,
  analTemp: null,
  dermalTemp: null,
  auralTemp: null
} satisfies PatientVitalSigns

export const TEST_PATIENT_PHYSICAL_EXAM_FINDINGS = {
  lungAuscultation: {
    breathSounds: ['normal'],
    ralesDistribution: null,
    rhonchiSeverity: 'none',
    effectOfCoughing: 'not_assessed',
    accessoryMuscleUse: false,
    postureTolerance: 'tolerates_supine'
  },
  skinLipsSclera: { skin: 'normal', lips: 'pink', sclera: 'white' },
  skinBlanche: 1
} satisfies PatientPhysicalExamFindings

export const TEST_LEARNER_CHART_VITAL_SIGNS: Pick<PatientVitalSigns,
  | 'currentPulse' | 'bpSitting' | 'respiratoryRate'
  | 'axillaryTemp' | 'oralTemp' | 'analTemp' | 'dermalTemp' | 'auralTemp'> = {
  currentPulse: TEST_PATIENT_VITAL_SIGNS.currentPulse,
  bpSitting: TEST_PATIENT_VITAL_SIGNS.bpSitting,
  respiratoryRate: TEST_PATIENT_VITAL_SIGNS.respiratoryRate,
  axillaryTemp: TEST_PATIENT_VITAL_SIGNS.axillaryTemp,
  oralTemp: TEST_PATIENT_VITAL_SIGNS.oralTemp,
  analTemp: TEST_PATIENT_VITAL_SIGNS.analTemp,
  dermalTemp: TEST_PATIENT_VITAL_SIGNS.dermalTemp,
  auralTemp: TEST_PATIENT_VITAL_SIGNS.auralTemp
}
