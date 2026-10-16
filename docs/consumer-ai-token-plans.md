# Consumer AI Token Plans

## Product boundary

Consumer plans and purchased add-ons are individual entitlements. They are
separate from a hospital or other corporate tenant's organization pool,
department budgets, and group allocations described in
[Organization AI-Time Entitlements](organization-ai-time-entitlements.md).

TEAECL is the GPTMD operating organization. Its in-house operators control the
AI model, voice, reasoning, personality, provider selection, and failover
policy. Learners and corporate customer administrators must not choose or
change these settings. Customer administrators may manage only their tenant's
members, departments, group assignments, and budget allocations.

## Consumer plan catalog

The initial monthly plan structure is:

| Tier | Included monthly tokens |
| --- | ---: |
| Lunar | N |
| Solar | 2 x N |
| Stellar | 3 x N |

TEAECL configures the base amount `N`, plan prices, descriptions, and
availability. Do not ship a guessed token amount or price. The client-facing
store must use an operator-managed catalog so new subscription tiers and
one-time add-on package sizes can be added without changing learner controls.
Only payment-confirmed purchases create spendable credit. Private accounts
have two distinct balances: an included monthly allowance that renews on the
account's subscription anniversary (unused included tokens expire at renewal),
and purchased add-on tokens that expire 365 days after each grant. Display
both as separate numeric balances and gauges; show the next renewal date and
the add-on expiry countdown. Included tokens are consumed first. When they are
exhausted, eligible add-on tokens fund usage automatically and the learner sees
an informational modal that can be dismissed. The checkout remains disabled
until ACB2Pay is configured and payment confirmation is verified server-side.

The role boundary has two administrator types. A TEAECL system administrator
controls global plans, provider/model settings, and all platform operations.
A corporate customer administrator is scoped to its own organization and
manages departments, users, allocations, records, engagement, education and
training data, and organization purchases. Corporate learners cannot edit
their assigned monthly allowance; they may purchase their own add-on tokens.
Their organization-assigned monthly allowance is shown separately from their
personal add-on balance. The monthly organization allowance remains valid for
45 days from its renewal date; add-on tokens expire 365 days after purchase.
The included organization allowance is consumed before the learner's eligible
personal add-on balance. Show the same informational, dismissible notice when
personal add-ons begin funding usage.

## Provider pools and accounting

TEAECL selected Anthropic Claude Haiku 5.5 (`claude-haiku-5-5`) as the
failsafe. Anthropic announced Haiku 5.5 on October 7, 2026 and lists this API
identifier for Claude Platform use. See the [Haiku 5.5 release
page](https://www.anthropic.com/claude-haiku-5-5).
This is continuity routing, not a learner-selectable model preference. The
trigger must be an operator-defined provider-availability condition; do not
fail over for malformed input, policy refusals, or GPTMD validation errors.
The alternate provider must satisfy the same GPTMD response contracts and
safety boundaries before it is enabled. Provider choice and failover remain
in-house.

These are operational controls, not learner-selectable provider preferences.
Keep included and purchased balances distinct, while applying the same balance
order across providers. Record each provider attempt separately; reconcile confirmed actual
usage exactly once per billable attempt against that balance and the matching
provider pool. Keep ambiguous outcomes held for reconciliation rather than
silently releasing or double-counting them.

Because providers can tokenize the same input differently, cross-provider
debit semantics need an explicit implementation rule. Record each provider's
native usage and define a reviewed mapping to the customer allowance before
enforcement; do not silently treat unlike token meters as equivalent. Model
quality and provider unit costs must not be represented as clinical
validation.

## Implementation status

The repository implements tenant-scoped organization/group token budgets and
reservation enforcement, plus a revisioned, audited consumer catalog editor
behind the allowlisted system-admin API. Lunar/Solar/Stellar grants are derived
from one configured base amount; add-on products are extensible. An authenticated
read-only catalog preview exposes only published products, including to users
without a tenant workspace; the Account page labels checkout unavailable. The
repository defines immutable token grant/debit records in migration 035,
transactional reservation allocations, a learner-only bucket summary endpoint,
and Account gauges for included and add-on grants. Provider calls reserve
eligible grants, consume included balances before add-ons, and reconcile actual
`total_tokens` into append-only debit entries in the same transaction that
settles the reservation. Ambiguous reservations retain their allocations. This
path is verified against disposable PostgreSQL only; migration 035 and these
application changes are not applied to the live mirror. Trusted payment and
renewal grant issuance, anniversary processing, the add-on notice acknowledgement,
checkout, and primary/failsafe provider pools remain unimplemented. Claude
Haiku 5.5 is the selected target, not an active route: a minimal non-PHI
Messages API probe returned HTTP 200 on 2026-10-16, but the API has no
Anthropic adapter, structured-output contract tests, availability trigger, or
cross-provider allowance-meter mapping. The credential remains in local
configuration and is not recorded here. Keep failover disabled until those
gates and the required operational privacy review are complete. The Account usage ledger
shows actual provider calls, not purchase history. Do not describe catalog
offers as purchasable until verified payments create grants.
