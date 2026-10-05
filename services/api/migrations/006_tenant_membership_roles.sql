-- Preserve existing membership access as learner access; privileged roles must be assigned explicitly.
ALTER TABLE tenant_memberships
  ADD COLUMN role text NOT NULL DEFAULT 'learner';

ALTER TABLE tenant_memberships
  ADD CONSTRAINT tenant_memberships_role_check
    CHECK (role IN ('learner', 'instructor', 'customer_admin'));
