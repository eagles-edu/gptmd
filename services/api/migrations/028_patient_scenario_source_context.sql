ALTER TABLE patient_scenarios
  ADD COLUMN source_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT patient_scenarios_source_context_object
    CHECK (jsonb_typeof(source_context_json) = 'object');
