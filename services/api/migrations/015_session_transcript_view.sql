-- Project accepted, immutable turn events into ordered transcript utterances.
-- Current first-generation accepted-turn payloads require an explicit modality.
CREATE VIEW session_transcript AS
SELECT
  event.session_id,
  event.payload->>'turnId' AS turn_id,
  event.sequence,
  utterance.utterance_index,
  utterance.speaker,
  event.occurred_at,
  event.payload->>'phase' AS phase,
  utterance.modality,
  utterance.content
FROM session_events AS event
CROSS JOIN LATERAL (
  VALUES
    (1::smallint, 'learner'::text, event.payload->>'learnerMessage',
      event.payload->>'learnerModality'),
    (2::smallint, 'patient'::text, event.payload->>'patientResponse', 'text'::text)
) AS utterance(utterance_index, speaker, content, modality)
WHERE event.event_type = 'accepted_turn';

COMMENT ON VIEW session_transcript IS
  'Ordered learner/patient utterance projection over immutable accepted-turn events; patient modality is the canonical text response channel.';
