# Organization AI-Time Entitlements

Consumer subscriptions and provider failover are separate product concerns;
see [Consumer AI Token Plans](consumer-ai-token-plans.md). Hospital and
corporate administrators do not control model, voice, reasoning, personality,
provider selection, or failover.

There are two administrator roles: the TEAECL system administrator controls
the platform globally; a corporate customer administrator controls only its
own organization's departments, users, allocations, records, performance,
education/training data, and token-package purchases. A corporate learner
cannot assign their own department or change their included allowance. Their
workspace shows the employer-funded monthly allowance separately from their
personal add-on tokens. Organization monthly grants expire 45 days after the
organization renewal date; individual add-on grants expire 365 days after
purchase. Included organization allowance is consumed first, followed by the
learner's eligible personal add-on balance with no mid-session funding prompt.
Show an informational modal once add-on use begins, with a dismiss action.

## Product contract

The primary entitlement is an organization-owned AI-time pool budgeted to user
groups. Token allowances are the authoritative AI-usage entitlements and are
metered from actual provider-reported token usage (`total_tokens` in the
current Responses usage records). Minute figures are relative estimates derived
from that actual usage; they are not an independent meter or a separate usage
dimension. The conversion used for estimates still needs a product-defined
rule. A user's organization membership alone does not establish an unlimited
allowance.

Model, voice, reasoning level, and personality are configurable AI settings,
not entitlements. Keep those settings distinct from the token amounts that an
organization grants. Do not treat estimated minutes, audio seconds, or elapsed
wall-clock time as actual token usage.

Initial user-group examples include `gptNURSING`, `gptRECEPTION`,
`gptTECHNICIAN`, `gptVENDOR`, and `gptCASHIER`. Groups are organization-scoped
and may be extended as customer roles require.

Departments are separate from user groups and may also carry a monthly
per-user token allotment. A member's department assignment is controlled by the
organization's customer administrator, using a department dropdown or roster
spreadsheet; learners cannot change their own department. A transfer starts a
new department allotment proportional to the time remaining in the current UTC
calendar month (so a transfer at the midpoint receives 50%). The department
assignment is snapshotted on new sessions; existing sessions keep their
department. Department assignments and budgets remain tenant-scoped.

The intended relationship is:

```text
organization AI-time pool (tokens)
  -> user-group token budgets and individual token limits
       -> department monthly per-user token allotment
            -> actual provider-reported token consumption
                 -> estimated minutes for display/reporting only

model, voice, reasoning, and personality remain separate AI settings
```

Group token budgets must be bounded by the organization's available pool.
When an included allowance is exhausted, automatically use eligible,
payment-confirmed add-on tokens in the applicable owner scope; do not prompt a
learner to choose a funding source. Existing tenant
session/Responses/audio quotas remain separate coarse capability and abuse
limits; they do not implement organization token entitlements. Model, voice,
reasoning, and personality configuration is a separate concern.

## Accepted allocation decisions

- Consumer included allowance renews on the subscription anniversary; unused
  included tokens expire at renewal. Corporate monthly allowance uses the
  organization's renewal date and remains valid for 45 days after renewal.
- Purchased add-on grants are tracked separately and each expires 365 days
  after its grant or confirmed purchase.
- Department allotments are configured per user per calendar month. A
  department transfer prorates the new allotment by the remaining portion of
  that month, and an unchanged department import does not restart that period.
  Customer administrators make department changes; learners cannot self-assign.
- The hospital customer administrator is scoped to the authenticated
  organization. Roster CSV, XLSX, and ODS export/import use that tenant's active
  member assignments only.
- Estimated minutes are relative to actual token usage, not an independently
  consumed allowance. The estimate conversion remains to be specified.
- Each organization sets its own pool allocation period. Group allocations
  draw from that organization's pool and use its configured period.
- A session is funded by exactly one budget group. When a member has more than
  one eligible group, the session must name the chosen group explicitly and
  retain that group for its lifetime; do not split one session across groups.
  Changes to a member's group assignment apply only to newly created sessions;
  an existing session keeps its pinned group.
- The unallocated part of an organization's pool is not available as a direct
  fallback. Organization tokens can be used only through a group's allocation.
- Concurrent provider calls reserve a bounded amount before the call, then
  reconcile that reservation to the provider's actual `total_tokens`. A retry
  is a separate provider call and needs its own reservation. The approved
  output caps and ambiguous-outcome hold behavior are specified below.
- Included allowance is consumed before an eligible add-on balance. For a
  corporate learner, the currently approved order is their group/department
  allowance first, then their personally purchased add-on balance; show an
  informational, dismissible notice when add-on usage starts. There is no
  learner funding-choice prompt.
- Corporate-admin-purchased add-on packages remain organization-owned. They
  must be allocated through the corporate admin's group budgets before a
  learner can consume them. Individual add-on packages belong to that learner.
  Neither balance is spendable before server-verified payment confirmation.

## Decisions required before enforcement

- Define a manual reconciliation and retention process for held reservations.
  Missing usage and ambiguous provider failures remain held; only a known
  pre-execution failure may be released. The aggregate `total_tokens` is the
  selected charge meter; breakdown reconciliation is not a second meter.
  Define the display conversion for relative minutes.
- Define how configured model, voice, reasoning, and personality choices
  affect token/minute consumption without treating the settings themselves as
  entitlements.
- Define reservation retention/expiry and cancellation reporting; never
  automatically release a reservation with an ambiguous provider outcome.
- Confirm whether group token budgets span departments or whether a later
  group-by-department allocation matrix is required.
- Define reporting dimensions and notifications before activating runtime
  enforcement for customer-configured budgets.

## Provider token reservation contract

For Responses calls, count the exact input before generation with the OpenAI
`POST /v1/responses/input_tokens` endpoint, passing the same model, conversation,
input, and structured-output format used by the generation request. Require an
explicit `max_output_tokens` on each generation request. The approved caps are
8,192 output tokens for scenario setup and 1,024 for each patient turn. Reserve
the counted input plus that output ceiling, then reconcile the reservation to
the response's actual `total_tokens`. OpenAI documents that the output ceiling includes
reasoning and other generated tokens, not only visible text. This makes the
reservation a bounded upper estimate rather than an arbitrary fixed hold.

Disable automatic SDK retries for metered generation calls. Each deliberate
retry must count and reserve independently, including scenario-validation and
patient-turn retries. Link each reservation to the eventual provider response
ID so reconciliation is idempotent. A missing usage record or ambiguous
transport failure must not silently release a potentially billable reservation;
retain it for reconciliation. Only a failure known to precede provider
execution can release immediately. These caps and hold-on-ambiguity behavior
are approved; purchased-token funding remains separate from included-budget
activation.

Settings default to draft and remain inert until a customer administrator
explicitly activates them. Active included limits are enforced locally for
new provider calls; a depleted included balance currently returns 429. The
reservation ledger and enforcement migrations (029-031) were deployed to the
OBGYN mirror on 2026-10-15. Live readiness and schema presence were verified,
but the mirror has no budget settings or reservation rows, so enforcement has
not yet been exercised with a live learner. Purchased credits and the
per-session overage funding choice are not implemented, so they must not be
described as available.

Token-credit checkout stays disabled until ACB2Pay is configured and payment
confirmation can be verified and recorded. Do not expose a purchase control or
treat a client-side checkout return as proof that credits were paid.

## Current implementation boundary

The current database and API have tenant-level visit/Responses capability
flags, tenant/user/session counters, audio-transcription policy and quota, and
provider-reported usage/cost attribution. Customer-admin controls edit those
coarse capability flags and quotas. Migrations 027-031 are applied to the live
mirror. Migration 029 adds tenant-scoped member/group and member/department
assignments, assignment audit, and session group/department snapshots.
Customer-admin controls now include a department monthly per-user token
allotment, an assignment dropdown, roster CSV/XLSX/ODS export and import, and a
prorated preview. A
department transfer starts the remaining-month allowance at save time, while
re-importing an unchanged department does not reset it. The API now counts
input tokens, reserves each Responses attempt at the approved output cap, and
settles actual `total_tokens` or retains ambiguous outcomes in migration 030's
reservation ledger for scenario setup and patient turns. Migration 031 pins
the department assignment timestamp to each session. Active settings check
the organization pool, selected group pool, per-user group-month allowance,
and prorated per-user department-month allowance inside a tenant-serialized
reservation transaction. Exhaustion returns 429 before provider generation;
draft settings remain inert. The legacy generic
`/api/openai/responses` route now returns HTTP 410 so unscoped requests cannot
bypass this reservation path. Migration 035 lets reservations hold eligible
organization group grants before personal add-on grants, and settlement records
confirmed actual usage against those grants atomically. Ambiguous usage keeps
the reservation and grant holds. The UI reports provider `total_tokens`
and response count for the configured organization period with tenant-scoped
UTC bounds. It separately reports reserved and held token ceilings and call
counts for the same tenant period; held reservations continue to count against
active limits until reconciled. The accepted
allocation policy requires group allocations only, a bounded reservation
before each provider call followed by reconciliation to actual `total_tokens`,
and session-lifetime group pinning. Group and department codes plus department
assignment time are snapshotted on new sessions. Migrations 029-031 and the
web/API release were deployed to the OBGYN mirror on 2026-10-15. The existing
onlineadmin admin test workspace now includes scsstx as its only learner while
preserving the disabled feature policy. No AI-time budget settings, group or
department assignments, or reservation rows exist. Do not relabel existing
counters as these entitlements or activate live budgets before the organization
administrator enters approved token allocations.
Model/voice/reasoning/personality settings are separate from this entitlement
model. Migrations 033-037 add the operator offer catalog, learner-only summary
query, immutable grant/debit records, reservation allocations, and durable
add-on notice acknowledgment. The token-bucket implementation passed the full
local suite and the disposable cross-service verifier. Release
`2026-10-16T072730705Z` deployed those migrations and the web/API changes to the
live mirror; post-deploy readiness, OAuth, and browser-route checks passed.
The live database currently has no catalog entries, budget settings, grants,
group assignments, or reservations, and no learner-funded session has been
run. Migrations 038 and the current API now issue organization-owned included
grants when a customer admin activates a group budget, and lazily reconcile the
active group on learner balance refresh or provider reservation at each
organization renewal period. The period's group target is capped by the
validated organization pool; repeated refreshes are idempotent. Increasing an
allocation grants only the difference. A reduction writes a negative
append-only allocation entry against unspent, unreserved tokens and is refused
if settled or held usage would exceed the revised budget. Renewal-period
changes are blocked while the prior period or its 45-day included-token window
is still active. An isolated PostgreSQL/Redis verifier covers activation,
increase, reduction, rejection below settled usage, next-period issuance, and
idempotency. This is an organization-admin-authorized allocation, not proof of
an external contract or payment; consumer purchases and ACB2Pay verification
remain disabled. No organization budgets or grants have been configured on the
live mirror, so no live learner balance or funded session has been exercised.

`provider_usage` stores Responses `total_tokens` and per-response
`duration_ms`; Realtime transcription separately records provider-observed
`audio_seconds`. Actual provider-reported token usage is the selected meter
category, with `total_tokens` the current source. Exact reconciliation of
input/output/cache/reasoning components remains open. Response duration is not
session time, and audio seconds are not token measures. These records support
reporting. The separate reservation ledger records per-attempt holds and
reconciliations. For explicitly activated local settings, reservations enforce
included organization, selected-group, group/user-month, and department/user-month
limits and allocate from eligible grants. Live learner enforcement and held-
reservation recovery remain open.

The modernization gates `a09` and `d02` remain open for this work. Runtime
implementation now issues configured corporate group allocations and the
add-on notice; test enforcement against an intentionally configured live
customer workspace, concurrency, retries, reassignment, purchase confirmation,
and held-reservation reconciliation. Keep
model/voice/reasoning/personality settings outside the entitlement accounting
model.

Customer admins can request a tenant-scoped member activity report for the
configured organization period (UTC calendar month when no budget period exists)
and export it as CSV, XLSX, or ODS. It reports active members, sessions started
and completed, provider-response count, actual provider tokens, and last AI-use
time. Migration 039 adds estimated active minutes and last-active time from
fixed 30-second pulses accepted only for an owned active session, at most once
per 25 seconds. The browser sends pulses only when the encounter is visible and
has recent interaction; the encounter preflight and privacy policy disclose
this collection. This is an approximate foreground activity signal, not
continuous monitoring, a CEU record, or independently verified attendance.
Customer admins now have a tenant-scoped completed-simulation list and can
print a factual completion record showing participant subject, start/end time,
estimated active minutes, and session reference. The printout explicitly states
that it awards or represents no CEU credit. This is not an accredited
certificate; accreditation, credit hours, eligibility, and attendance criteria
remain the responsibility of the educator or accrediting organization. Local
API, query, spreadsheet-export, print-rendering, and browser tests pass. The
report and printable records have not been deployed, and no live pulse has yet
been recorded or checked in a tenant report.
