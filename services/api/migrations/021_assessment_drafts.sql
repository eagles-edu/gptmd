-- In-progress learner assessment text is mutable and separate from append-only submissions.
CREATE TABLE app_assessment_drafts (
  session_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  fields jsonb NOT NULL CHECK (
    jsonb_typeof(fields) = 'object' AND
    fields - ARRAY['summary', 'differential', 'rationale', 'plan']::text[] = '{}'::jsonb AND
    coalesce(jsonb_typeof(fields->'summary') = 'string', false) AND
    coalesce(jsonb_typeof(fields->'differential') = 'string', false) AND
    coalesce(jsonb_typeof(fields->'rationale') = 'string', false) AND
    coalesce(jsonb_typeof(fields->'plan') = 'string', false) AND
    coalesce(length(fields->>'summary') <= 4000, false) AND
    coalesce(length(fields->>'differential') <= 4000, false) AND
    coalesce(length(fields->>'rationale') <= 8000, false) AND
    coalesce(length(fields->>'plan') <= 4000, false)
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE RESTRICT
);

CREATE INDEX app_assessment_drafts_by_owner
  ON app_assessment_drafts (tenant_id, subject_id, updated_at DESC);
