-- One durable archive queue entry is created with each terminal session outcome.
ALTER TABLE session_outcomes
  ADD CONSTRAINT session_outcomes_session_terminal_unique
  UNIQUE (session_id, terminal_event_id);

CREATE TABLE session_archive_jobs (
  session_id text PRIMARY KEY,
  terminal_event_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR length(trim(last_error_code)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, terminal_event_id)
    REFERENCES session_outcomes (session_id, terminal_event_id) ON DELETE RESTRICT,
  CHECK ((status = 'processing') = (claimed_at IS NOT NULL)),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

INSERT INTO session_archive_jobs (session_id, terminal_event_id)
SELECT session_id, terminal_event_id FROM session_outcomes
ON CONFLICT (session_id) DO NOTHING;

CREATE INDEX session_archive_jobs_pending_by_available
  ON session_archive_jobs (available_at, created_at)
  WHERE status = 'pending';
