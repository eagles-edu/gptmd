ALTER TABLE app_sessions
  ADD COLUMN patient_profile_id text
    CHECK (patient_profile_id IS NULL OR patient_profile_id ~ '^[A-Za-z0-9_-]{43}$');

UPDATE app_sessions AS sessions
SET patient_profile_id = scenarios.scenario_id
FROM patient_scenarios AS scenarios
WHERE scenarios.session_id = sessions.session_id;

CREATE UNIQUE INDEX app_sessions_patient_profile_id_unique
  ON app_sessions (patient_profile_id)
  WHERE patient_profile_id IS NOT NULL;
