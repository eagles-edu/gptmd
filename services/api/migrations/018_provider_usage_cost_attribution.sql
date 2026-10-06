ALTER TABLE provider_usage
  ADD COLUMN model_id text,
  ADD COLUMN service_tier text,
  ADD COLUMN cache_write_tokens integer NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  ADD COLUMN pricing_version text,
  ALTER COLUMN estimated_cost_usd TYPE numeric(20, 12);

ALTER TABLE provider_usage
  ADD CONSTRAINT provider_usage_model_id_nonempty
    CHECK (model_id IS NULL OR length(trim(model_id)) BETWEEN 1 AND 200),
  ADD CONSTRAINT provider_usage_service_tier_nonempty
    CHECK (service_tier IS NULL OR length(trim(service_tier)) BETWEEN 1 AND 50),
  ADD CONSTRAINT provider_usage_pricing_version_nonempty
    CHECK (pricing_version IS NULL OR length(trim(pricing_version)) BETWEEN 1 AND 100),
  ADD CONSTRAINT provider_usage_cache_tokens_within_input
    CHECK (cached_input_tokens + cache_write_tokens <= input_tokens),
  ADD CONSTRAINT provider_usage_estimate_has_pricing_version
    CHECK ((estimated_cost_usd IS NULL) = (pricing_version IS NULL));
