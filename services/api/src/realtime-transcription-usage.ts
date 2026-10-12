export type RealtimeAudioDurationUsage = {
  eventId: string
  seconds: number
}

/** Extract only provider-reported duration usage; never retain transcript content. */
export function parseRealtimeAudioDurationUsageEvent(value: unknown): RealtimeAudioDurationUsage | null {
  let event: unknown = value
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    try {
      event = JSON.parse(value.toString())
    } catch {
      return null
    }
  }
  if (!event || typeof event !== 'object') return null
  const record = event as Record<string, unknown>
  const usage = record.usage
  if (record.type !== 'conversation.item.input_audio_transcription.completed' ||
      typeof record.event_id !== 'string' || record.event_id.length < 1 || record.event_id.length > 128 ||
      !usage || typeof usage !== 'object') return null
  const duration = usage as Record<string, unknown>
  if (duration.type !== 'duration' || typeof duration.seconds !== 'number' ||
      !Number.isFinite(duration.seconds) || duration.seconds < 0 || duration.seconds > 900) return null
  return { eventId: record.event_id, seconds: duration.seconds }
}
