CREATE TABLE gptmd_system_speech_policy (
  policy_id boolean PRIMARY KEY DEFAULT true CHECK (policy_id),
  enabled boolean NOT NULL DEFAULT false,
  monthly_characters_per_learner integer NOT NULL DEFAULT 0
    CHECK (monthly_characters_per_learner BETWEEN 0 AND 2147483647),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO gptmd_system_speech_policy (policy_id) VALUES (true);

CREATE TABLE gptmd_system_speech_policy_audit (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL
);

CREATE TABLE gptmd_system_speech_usage (
  usage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  session_id_hash char(64) NOT NULL,
  turn_id_hash char(64) NOT NULL,
  period_start date NOT NULL,
  character_count integer NOT NULL CHECK (character_count > 0),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gptmd_system_speech_usage_subject_period_idx
  ON gptmd_system_speech_usage (subject_id, period_start);

CREATE INDEX gptmd_system_speech_usage_period_idx
  ON gptmd_system_speech_usage (period_start);

CREATE UNIQUE INDEX gptmd_system_speech_usage_turn_idx
  ON gptmd_system_speech_usage (subject_id, session_id_hash, turn_id_hash);

ALTER TABLE gptmd_system_speech_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE gptmd_system_speech_policy_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE gptmd_system_speech_usage ENABLE ROW LEVEL SECURITY;
