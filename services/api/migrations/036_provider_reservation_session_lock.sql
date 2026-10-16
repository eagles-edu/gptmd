-- Provider reservations are inserted while scenario setup holds the session
-- row lock. A foreign-key key-share check would wait on that same transaction.
-- The reservation store validates session ownership and state before inserting;
-- retain the session ID as an immutable accounting reference, not a live FK.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'provider_token_reservations'::regclass
      AND confrelid = 'app_sessions'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE provider_token_reservations DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

ALTER TABLE provider_token_reservations
  ADD CONSTRAINT provider_token_reservations_session_identity_snapshot_check
  CHECK (length(trim(session_id)) > 0 AND length(trim(tenant_id)) > 0 AND length(trim(subject_id)) > 0);
