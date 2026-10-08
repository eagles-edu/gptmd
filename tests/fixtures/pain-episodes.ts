import type { PainEpisodeField, PatientScenarioProfile } from '../../services/api/src/patient-profile.ts'

type PainEpisode = PatientScenarioProfile['painEpisodes'][number]

export function makePainEpisode(
  episodeId: PainEpisode['episodeId'],
  patientDescription: string,
  values: Partial<Record<PainEpisodeField, { status: 'known' | 'negative' | 'unknown' | 'not_applicable'; value: string | number | string[] | null }>> = {}
): PainEpisode {
  const defaults = {
    whatProvokesPalliatesPain: { status: 'unknown', value: null },
    painQuality: { status: 'unknown', value: null },
    painLocationRadiationWhere: { status: 'unknown', value: null },
    'painSeverity0-10': { status: 'unknown', value: null },
    timePainOnset: { status: 'unknown', value: null },
    constantIntermittentPain: { status: 'unknown', value: null },
    durationPain: { status: 'unknown', value: null }
  } satisfies Record<PainEpisodeField, { status: 'unknown'; value: null }>

  return {
    episodeId,
    patientDescription,
    currentStatus: 'current',
    details: Object.entries({ ...defaults, ...values }).map(([field, detail]) => ({
      field: field as PainEpisodeField,
      ...detail
    })) as PainEpisode['details']
  }
}
