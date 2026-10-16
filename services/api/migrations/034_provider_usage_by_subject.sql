CREATE INDEX provider_usage_by_tenant_subject_time
  ON provider_usage (tenant_id, subject_id, occurred_at)
  INCLUDE (total_tokens);
