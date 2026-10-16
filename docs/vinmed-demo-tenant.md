# VinMed Demo Tenant

`vinmed-hospital-demo` is a fictitious, isolated corporate customer tenant. The
tenant branding is returned only as part of an authenticated active membership;
the shared app header shows the tenant's local logo and display name only while
that workspace is selected. Other workspaces continue to show GPTpatient
branding.

The guarded provisioning script assigns the designated Google identity the
`customer_admin` role in this tenant. It does not grant system-admin access,
create learner memberships, or enable AI entitlements. The script refuses to
run until exactly one active Supabase Auth identity exists for the configured
account, the live database identity and required migrations match, and the
tenant does not already exist. Review the target and seed preconditions before
running:

```bash
node scripts/provision-vinmed-corporate-admin.mjs
```

Deployment `2026-10-16T110205011Z` applied `040_tenant_branding.sql` to the live
mirror and shipped the logo/UI. The email currently has no active Supabase Auth
identity, so the demo tenant, membership, and branding row have not yet been
created. After the email completes Google sign-in, run the guarded seed script;
it will verify the exact live database and refuse an existing tenant.
