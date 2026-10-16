# VinMed Demo Tenant

`vinmed-hospital-demo` is a fictitious, isolated corporate customer tenant. The
tenant branding is returned only as part of an authenticated active membership;
the shared app header shows the tenant's local logo and display name only while
that workspace is selected. Other workspaces continue to show GPTpatient
branding.

The guarded provisioning script creates a pending email invitation for
`ayeyamsam@gmail.com` with the `customer_admin` role. The verified-email claim
flow activates membership after that account signs in. It does not grant
system-admin access, create learner memberships, or enable AI entitlements.
The script checks the live database identity and required migrations, and
refuses to overwrite an existing tenant. Review the target and seed
preconditions before running:

```bash
node scripts/provision-vinmed-corporate-admin.mjs
```

Deployment `2026-10-16T134509760Z` includes tenant branding and email
invitations. A live read-only check confirmed the tenant and branding row, plus
a pending `customer_admin` invitation for `ayeyamsam@gmail.com`. The account has
not yet claimed the invitation, and both AI session and Responses entitlements
remain disabled. Complete Google sign-in with that exact account to activate
the corporate-admin membership.

For Google OAuth testing, open Google Cloud Console > Google Auth Platform >
Audience. Set **User type** to **External**, keep **Publishing status** at
**Testing**, and add `ayeyamsam@gmail.com` under **Test users**. If the audience
is still **Internal**, adding a test user will not fix Google's `org_internal`
error. Keep the app unpublished while using this test configuration.
