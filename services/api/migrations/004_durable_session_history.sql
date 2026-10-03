-- Durable session history and engagement records. Apply after migrations 001-003.

ALTER TABLE app_sessions
  ADD CONSTRAINT app_sessions_session_owner_unique
  UNIQUE (session_id, tenant_id, subject_id);

CREATE TABLE session_events (
  event_id text NOT NULL CHECK (length(trim(event_id)) BETWEEN 1 AND 200),
  session_id text NOT NULL REFERENCES app_sessions (session_id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN ('accepted_turn', 'terminal')),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, event_id),
  UNIQUE (session_id, sequence),
  UNIQUE (session_id, event_id, event_type),
  CONSTRAINT session_events_payload_matches_type CHECK (
    (event_type = 'accepted_turn' AND
      coalesce(length(trim(payload->>'turnId')) > 0, false) AND
      coalesce(event_id = payload->>'turnId', false) AND
      coalesce(length(trim(payload->>'patientResponse')) > 0, false)) OR
    (event_type = 'terminal' AND
      coalesce(event_id = payload->>'eventId', false) AND
      coalesce(payload->>'outcome' IN ('completed', 'cancelled'), false) AND
      coalesce(payload->>'finalTurnSequence' ~ '^(0|[1-9][0-9]*)$', false))
  )
);

CREATE TABLE provider_usage (
  usage_id text PRIMARY KEY CHECK (length(trim(usage_id)) BETWEEN 1 AND 200),
  session_id text NOT NULL,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  event_id text,
  provider text NOT NULL CHECK (length(trim(provider)) BETWEEN 1 AND 100),
  operation text NOT NULL CHECK (operation IN ('scenario_generation', 'patient_turn')),
  provider_response_id text,
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens integer NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  total_tokens integer NOT NULL CHECK (total_tokens >= 0),
  estimated_cost_usd numeric(12, 6) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, event_id)
    REFERENCES session_events (session_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (provider, provider_response_id),
  CHECK (cached_input_tokens <= input_tokens),
  CHECK (total_tokens = input_tokens + output_tokens)
);

CREATE INDEX provider_usage_by_session_time
  ON provider_usage (session_id, occurred_at);

CREATE TABLE download_engagement (
  engagement_id text PRIMARY KEY CHECK (length(trim(engagement_id)) BETWEEN 1 AND 200),
  session_id text NOT NULL,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  artifact_id text,
  result text NOT NULL CHECK (result IN ('authorized', 'denied', 'expired', 'failed')),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  bytes_downloaded bigint CHECK (bytes_downloaded IS NULL OR bytes_downloaded >= 0),
  CHECK (
    (result = 'authorized' AND completed_at IS NULL) OR
    (result <> 'authorized' AND completed_at IS NOT NULL)
  ),
  CHECK (result <> 'authorized' OR artifact_id IS NOT NULL),
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE RESTRICT
);

CREATE INDEX download_engagement_by_session_time
  ON download_engagement (session_id, requested_at);

CREATE TABLE session_outcomes (
  session_id text PRIMARY KEY REFERENCES app_sessions (session_id) ON DELETE RESTRICT,
  terminal_event_id text NOT NULL,
  terminal_event_type text NOT NULL DEFAULT 'terminal' CHECK (terminal_event_type = 'terminal'),
  outcome text NOT NULL CHECK (outcome IN ('completed', 'cancelled')),
  final_turn_sequence bigint NOT NULL CHECK (final_turn_sequence >= 0),
  success boolean,
  reason text CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 500),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (session_id, terminal_event_id, terminal_event_type)
    REFERENCES session_events (session_id, event_id, event_type) ON DELETE RESTRICT
);

CREATE FUNCTION enforce_session_outcome_matches_terminal_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  terminal_payload jsonb;
BEGIN
  SELECT payload INTO terminal_payload
  FROM session_events
  WHERE session_id = NEW.session_id
    AND event_id = NEW.terminal_event_id
    AND event_type = 'terminal';

  IF FOUND AND (
    terminal_payload->>'outcome' IS DISTINCT FROM NEW.outcome OR
    terminal_payload->>'finalTurnSequence' IS DISTINCT FROM NEW.final_turn_sequence::text
  ) THEN
    RAISE EXCEPTION 'session outcome does not match its terminal event';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER session_outcome_matches_terminal_event
  BEFORE INSERT ON session_outcomes
  FOR EACH ROW EXECUTE FUNCTION enforce_session_outcome_matches_terminal_event();

CREATE FUNCTION reject_durable_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER session_events_are_append_only
  BEFORE UPDATE OR DELETE ON session_events
  FOR EACH ROW EXECUTE FUNCTION reject_durable_history_mutation();

CREATE TRIGGER provider_usage_is_append_only
  BEFORE UPDATE OR DELETE ON provider_usage
  FOR EACH ROW EXECUTE FUNCTION reject_durable_history_mutation();

CREATE TRIGGER download_engagement_is_append_only
  BEFORE UPDATE OR DELETE ON download_engagement
  FOR EACH ROW EXECUTE FUNCTION reject_durable_history_mutation();

CREATE TRIGGER session_outcomes_are_append_only
  BEFORE UPDATE OR DELETE ON session_outcomes
  FOR EACH ROW EXECUTE FUNCTION reject_durable_history_mutation();

CREATE TRIGGER patient_scenarios_are_undeletable
  BEFORE DELETE ON patient_scenarios
  FOR EACH ROW EXECUTE FUNCTION reject_durable_history_mutation();
