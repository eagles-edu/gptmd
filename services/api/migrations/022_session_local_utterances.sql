-- Persist browser-local voice repair and stop phrases with stable session order.
CREATE TABLE session_local_utterances (
  session_id text NOT NULL,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  utterance_id text NOT NULL CHECK (length(trim(utterance_id)) BETWEEN 1 AND 200),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  kind text NOT NULL CHECK (kind IN ('repair', 'stop', 'phase_transition', 'patient_repeat')),
  speaker text NOT NULL CHECK (speaker IN ('learner', 'patient')),
  phase text NOT NULL CHECK (phase = 'history'),
  modality text NOT NULL CHECK (modality IN ('realtime_transcription', 'text')),
  content text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 8000),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, utterance_id),
  UNIQUE (session_id, ordinal),
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE RESTRICT,
  CHECK (
    (kind = 'patient_repeat' AND speaker = 'patient' AND modality = 'text') OR
    (kind <> 'patient_repeat' AND speaker = 'learner' AND modality = 'realtime_transcription')
  )
);

CREATE INDEX session_local_utterances_by_transcript_order
  ON session_local_utterances (session_id, sequence, ordinal);

CREATE TRIGGER session_local_utterances_are_append_only
  BEFORE UPDATE OR DELETE ON session_local_utterances
  FOR EACH ROW EXECUTE FUNCTION reject_durable_history_mutation();

-- Local utterances need an unbounded integer position in the transcript projection.
DROP VIEW session_transcript;
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
    (1::integer, 'learner'::text, event.payload->>'learnerMessage',
      event.payload->>'learnerModality'),
    (2::integer, 'patient'::text, event.payload->>'patientResponse', 'text'::text)
) AS utterance(utterance_index, speaker, content, modality)
WHERE event.event_type = 'accepted_turn'

UNION ALL

SELECT
  local.session_id,
  local.utterance_id AS turn_id,
  local.sequence,
  local.ordinal + 2 AS utterance_index,
  local.speaker,
  local.occurred_at,
  local.phase,
  local.modality,
  local.content
FROM session_local_utterances AS local;

COMMENT ON VIEW session_transcript IS
  'Ordered projection of accepted-turn pairs and append-only local voice repair/stop utterances.';
