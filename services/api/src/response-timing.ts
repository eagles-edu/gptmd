export type ResponsesTimingStage = 'first_token' | 'completed'
export type ResponsesTimingRecorder = (stage: ResponsesTimingStage, elapsedMs: number) => void

export function reportResponsesTiming(
  recorder: ResponsesTimingRecorder | undefined,
  stage: ResponsesTimingStage,
  startedAt: number
): void {
  if (!recorder) return
  try {
    recorder(stage, Math.max(0, performance.now() - startedAt))
  } catch {
    // Metrics are observational and cannot change provider or patient-turn behavior.
  }
}
