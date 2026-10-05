ALTER TABLE app_sessions
  DROP CONSTRAINT IF EXISTS app_sessions_status_check;

ALTER TABLE app_sessions
  ADD CONSTRAINT app_sessions_status_check
    CHECK (status IN ('initializing', 'failed', 'ready', 'active', 'completed', 'cancelled'));
