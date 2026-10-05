ALTER TABLE app_sessions
  ADD COLUMN scenario_seed text
    CHECK (scenario_seed IS NULL OR scenario_seed ~ '^[A-Za-z0-9_-]{43}$');

-- Initializing sessions have no immutable scenario yet and must use the current
-- seed-aware prompt when their owner retries setup after this migration.
UPDATE app_sessions
SET prompt_version = 'patient-scenario-prompt-v2'
WHERE status = 'initializing' AND prompt_version = 'patient-scenario-prompt-v1';
