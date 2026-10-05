ALTER TABLE session_events
  DROP CONSTRAINT session_events_event_type_check,
  ADD CONSTRAINT session_events_event_type_check
    CHECK (event_type IN (
      'accepted_turn', 'disclosure', 'phase_changed', 'assessment_submitted', 'terminal'
    ));

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
    (event_type = 'phase_changed' AND event_ordinal > 0 AND
      coalesce(event_id = payload->>'transitionId', false) AND
      coalesce(payload->>'from' = 'history', false) AND
      coalesce(payload->>'to' = 'assessment', false) AND
      coalesce(payload->>'turnSequence' ~ '^[1-9][0-9]*$', false)) OR
    (event_type = 'assessment_submitted' AND event_ordinal > 0 AND
      coalesce(event_id = payload->>'assessmentId', false) AND
      coalesce(payload->>'turnSequence' ~ '^[1-9][0-9]*$', false) AND
      coalesce(length(trim(payload->>'summary')) > 0, false) AND
      coalesce(length(trim(payload->>'differential')) > 0, false) AND
      coalesce(length(trim(payload->>'rationale')) > 0, false) AND
      coalesce(length(trim(payload->>'plan')) > 0, false)) OR
    (event_type = 'terminal' AND event_ordinal = 0 AND
      coalesce(event_id = payload->>'eventId', false) AND
      coalesce(payload->>'outcome' IN ('completed', 'cancelled'), false) AND
      coalesce(payload->>'finalTurnSequence' ~ '^(0|[1-9][0-9]*)$', false))
  );
