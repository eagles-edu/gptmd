# Organization AI-Time Entitlements

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
When an included allowance is exhausted, runtime authorization must stop unless
eligible, payment-confirmed extra credits exist and the user has selected the
funding scope required for that session. Existing tenant
session/Responses/audio quotas remain separate coarse capability and abuse
limits; they do not implement organization token entitlements. Model, voice,
reasoning, and personality configuration is a separate concern.

## Accepted allocation decisions

- Each user's included token allowance resets on the calendar-month boundary.
- Department allotments are configured per user per calendar month. A
  department transfer prorates the new allotment by the remaining portion of
  that month, and an unchanged department import does not restart that period.
  Customer administrators make department changes; learners cannot self-assign.
- The hospital customer administrator is scoped to the authenticated
  organization. The roster CSV export/import uses that tenant's active member
  assignments only.
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
  is a separate provider call and needs its own reservation. Reservation
  expiry, provider-failure release, and the maximum reservation bound still
  need implementation rules.
- Purchased extra token credits are applied after the included token allowance
  is consumed and carry forward across allocation periods. The purchaser's
  scope owns the credits: organization purchases belong to the organization,
  and individual purchases belong to that individual. A purchase is not
  spendable until payment confirmation is recorded. Token credits do not imply
  extra estimated minutes.
- If both the organization and the individual session owner have purchased
  credits available when the session reaches overage, prompt the user to choose
  which balance funds that session's overage. Do not silently prefer either
  scope. Persist the choice with the session and use it consistently for that
  session; do not switch scopes mid-session without a new explicit choice.

## Decisions required before enforcement

- Define how missing or revised provider `total_tokens` usage is handled. The
  aggregate is the selected charge meter; input/output/cache/reasoning
  breakdown reconciliation is not a second meter. Define the display
  conversion for relative minutes.
- Define how configured model, voice, reasoning, and personality choices
  affect token/minute consumption without treating the settings themselves as
  entitlements.
- Define reservation bounds and expiry, provider-failure release, cancellation
  behavior, and idempotent reconciliation of final usage.
- Confirm whether group token budgets span departments or whether a later
  group-by-department allocation matrix is required.
- Define reporting dimensions and notifications before activating runtime
  enforcement for customer-configured budgets.

## Current implementation boundary

The current database and API have tenant-level visit/Responses capability
flags, tenant/user/session counters, audio-transcription policy and quota, and
provider-reported usage/cost attribution. Customer-admin controls edit those
coarse capability flags and quotas. Migration 027 is applied to the live
mirror. Migration 029 adds tenant-scoped member/group and member/department
assignments, assignment audit, and session group/department snapshots, but it
has not been live-applied or deployed as part of this work. Customer-admin
draft controls now include a department monthly per-user token allotment, an
assignment dropdown, roster CSV export and import, and a prorated preview. A
department transfer starts the remaining-month allowance at save time, while
re-importing an unchanged department does not reset it. These controls do not
yet implement usage reservations or charging, department/group accounting,
purchased-credit balances, or runtime enforcement. The UI reports provider `total_tokens`
and response count for the configured organization period with tenant-scoped
UTC bounds; those tokens are not charged against the draft. The accepted
allocation policy requires group allocations only, a bounded reservation
before each provider call followed by reconciliation to actual `total_tokens`,
and session-lifetime group pinning. Group and department codes are snapshotted
on new sessions in code, but deployment and live migration status are
unverified. Do not relabel existing counters as these entitlements, seed live
budgets, or enable shared-pool enforcement until the accounting and purchase
paths above have regression coverage. Model/voice/reasoning/personality
settings are separate from this entitlement model.

`provider_usage` stores Responses `total_tokens` and per-response
`duration_ms`; Realtime transcription separately records provider-observed
`audio_seconds`. Actual provider-reported token usage is the selected meter
category, with `total_tokens` the current source. Exact reconciliation of
input/output/cache/reasoning components remains open. Response duration is not
session time, and audio seconds are not token measures. These records support
reporting, but none currently reserve or charge an organization, group, or
individual allowance.

The modernization gates `a09` and `d02` remain open for this work. Runtime
implementation must atomically account actual provider token usage against the
organization pool, selected group, department transfer allotment, and
calendar-month per-user allowance; and test exhaustion, concurrency, retries,
reassignment, purchase confirmation, and reconciliation. Keep
model/voice/reasoning/personality settings outside the entitlement accounting
model.
