ALTER TABLE app_sessions
  ADD COLUMN addon_tokens_used boolean NOT NULL DEFAULT false,
  ADD COLUMN addon_notice_acknowledged boolean NOT NULL DEFAULT false;
