ALTER TABLE app_sessions
  ADD COLUMN ai_budget_department_assigned_at timestamptz;

UPDATE app_sessions s
SET ai_budget_department_assigned_at = s.created_at
WHERE s.ai_budget_department_code IS NOT NULL;
