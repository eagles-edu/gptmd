ALTER TABLE gptmd_token_entitlement_entries
  DROP CONSTRAINT gptmd_token_entitlement_entries_entry_kind_check;

ALTER TABLE gptmd_token_entitlement_entries
  ADD CONSTRAINT gptmd_token_entitlement_entries_entry_kind_check
  CHECK (entry_kind IN ('usage_debit', 'reversal', 'allocation_adjustment'));

ALTER TABLE gptmd_token_entitlement_entries
  DROP CONSTRAINT gptmd_token_entitlement_entries_check;

ALTER TABLE gptmd_token_entitlement_entries
  ADD CONSTRAINT gptmd_token_entitlement_entries_check
  CHECK (
    (entry_kind = 'usage_debit' AND token_delta < 0)
    OR (entry_kind = 'reversal' AND token_delta > 0)
    OR (entry_kind = 'allocation_adjustment' AND token_delta < 0 AND reservation_id IS NULL)
  );
