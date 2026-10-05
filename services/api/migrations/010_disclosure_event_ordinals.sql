-- Add first-class disclosure events while preserving ordered, idempotent history.
ALTER TABLE session_events
  DROP CONSTRAINT session_events_session_id_sequence_key,
  ADD COLUMN event_ordinal smallint NOT NULL DEFAULT 0 CHECK (event_ordinal >= 0),
  ADD CONSTRAINT session_events_session_id_sequence_ordinal_key
    UNIQUE (session_id, sequence, event_ordinal);

ALTER TABLE session_events
  DROP CONSTRAINT session_events_event_type_check,
  ADD CONSTRAINT session_events_event_type_check
    CHECK (event_type IN ('accepted_turn', 'disclosure', 'terminal'));

ALTER TABLE session_events
  DROP CONSTRAINT session_events_payload_matches_type,
  ADD CONSTRAINT session_events_payload_matches_type CHECK (
    (event_type = 'accepted_turn' AND event_ordinal = 0 AND
      coalesce(length(trim(payload->>'turnId')) > 0, false) AND
      coalesce(event_id = payload->>'turnId', false) AND
      coalesce(length(trim(payload->>'patientResponse')) > 0, false)) OR
    (event_type = 'disclosure' AND event_ordinal > 0 AND
      coalesce(length(trim(payload->>'turnId')) > 0, false) AND
      coalesce(payload->>'turnSequence' ~ '^[1-9][0-9]*$', false) AND
      coalesce(length(trim(payload->>'field')) > 0, false) AND
      coalesce(length(trim(payload->>'factId')) > 0, false) AND
      coalesce(payload->>'source' IN ('scenario_seed', 'patient_reported'), false)) OR
    (event_type = 'terminal' AND event_ordinal = 0 AND
      coalesce(event_id = payload->>'eventId', false) AND
      coalesce(payload->>'outcome' IN ('completed', 'cancelled'), false) AND
      coalesce(payload->>'finalTurnSequence' ~ '^(0|[1-9][0-9]*)$', false))
  );
