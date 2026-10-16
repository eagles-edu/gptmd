ALTER TABLE tenant_member_roster_invitations
  ADD COLUMN requested_role text NOT NULL DEFAULT 'learner'
    CHECK (requested_role IN ('learner', 'customer_admin')),
  ADD CONSTRAINT tenant_member_roster_admin_invitation_unassigned
    CHECK (requested_role <> 'customer_admin' OR
      (cardinality(group_codes) = 0 AND department_code IS NULL));

ALTER TABLE tenant_member_roster_invitation_audit
  DROP CONSTRAINT tenant_member_roster_invitation_audit_action_check,
  ADD CONSTRAINT tenant_member_roster_invitation_audit_action_check
    CHECK (action IN ('roster_imported', 'membership_claimed', 'customer_admin_invited')),
  ADD COLUMN requested_role text NOT NULL DEFAULT 'learner'
    CHECK (requested_role IN ('learner', 'customer_admin'));
