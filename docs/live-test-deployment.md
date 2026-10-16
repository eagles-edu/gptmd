# GPTMD live test host

The live test hostname is `https://obgyn.eaglesvn.club/`. Nginx terminates TLS
and retains the host's current headers, rate limits, country filter, and bot
filter. It sends `/api/*` to Express at `127.0.0.1:4100` and the rest of the
site to Nuxt at `127.0.0.1:3100`. The same host proxies `/auth/v1/*` to the
loopback Supabase gateway at `127.0.0.1:8000`, so browser OAuth callbacks and
JWKS issuer URLs use the public HTTPS origin while keeping server credentials
in private env files. The `www` alias redirects to the canonical hostname so
the Supabase issuer and Express CORS origin remain consistent.

The deploy directory is `/home/obgyn.eaglesvn.club/gptmd/`. FreeFileSync writes
to `staging/`; a successful deployment installs runtime dependencies, applies
new SQL migrations, moves the staged files to a timestamped release, updates
the `current` symlink atomically, restarts systemd, and waits for web/API
readiness. Older releases are retained for rollback.

For `/api/*` and `/auth/v1/*`, Nginx forwards its resolved `$remote_addr` as the
single `X-Forwarded-For` value. Its real-IP module trusts only the configured
OneShield edge addresses; the API trusts only the loopback Nginx peer. This
prevents a learner-supplied forwarded-IP chain from selecting a rate-limit
bucket. The Nginx API zone is 10 requests/second with a burst of 40; Express
also enforces its shared Redis IP and authenticated-subject windows and rejects
unapproved request origins before body parsing or route work.

## FreeFileSync whitelist

Use the two batch jobs under [`ops/freefilesync/`](../ops/freefilesync/):

- `gptmd-live-web.ffs_batch` copies the built `.output` runtime, including its
  nested server dependencies and public assets.
- `gptmd-live-api.ffs_batch` copies only `dist/`, `migrations/`, `catalog/`,
  `package.json`, and `package-lock.json` from `services/api/`.

Both jobs exclude environment files, credentials, private keys, Git metadata,
and Nuxt build cache. Database and Redis data are stored outside the release
tree and are never included in a file sync. The API job has a positive include
list, so source, tests, and `node_modules` cannot be deployed from that pair.

Run `npm run build`, `npm run api:build`, then `npm run deploy:live` as the
`eaglesvn` user. The script runs the installed FreeFileSync batch jobs and
keeps the previous release if the new processes do not pass readiness. Before
activation it verifies every staged path is owned by the invoking account and
group, then removes group/other write bits without stripping executable bits.
The three live systemd units run as `eaglesvn:eaglesvn`; investigate any owner
mismatch instead of deploying or masking it with a recursive `chown`.

FreeFileSync's current standard license restricts use to private individuals;
its FAQ says business, organizational, government, or other commercial use
requires the Business Edition. Review the license if this deployment is used
outside private development.

## Live data services

PostgreSQL uses a dedicated `gptmd_live` database and `gptmd_live_app` role on
the existing loopback-only PostgreSQL service. The API's private connection
settings live in `/home/eaglesvn/.config/gptmd-live/api.env` with mode `0600`.
As of release `2026-10-16T110205011Z`, all 39 SQL migration files in this
checkout are recorded in `gptmd_schema_migrations`; there are no pending or
ledger-only migration entries.

Redis runs in a separate Redis Stack container on `127.0.0.1:6382`, protected
with its own password, AOF enabled, and a dedicated named Docker volume. The
private password is in `/home/eaglesvn/.config/gptmd-live/compose.env`; the API
uses the matching URL from `api.env`. Do not use `docker compose down -v` for
this stack.

Nuxt's public Supabase settings are in `/home/eaglesvn/.config/gptmd-live/web.env`.
OpenAI, database, and Redis credentials are present only in the API environment.
Run `npm run configure:live-auth` to align the private live runtime and local
Supabase project URLs with the test host while preserving local confirmation
redirects. It backs up every changed env file and adds the public `/confirm`
redirect once. The Google OAuth client must also list
`https://obgyn.eaglesvn.club/auth/v1/callback` as an authorized redirect URI.
The systemd services are `gptmd-live-web`, `gptmd-live-api`, and
`gptmd-live-worker`; all run as `eaglesvn` and bind application ports to
loopback.

## Host configuration and checks

Run `npm run configure:live-logging` to install the three systemd units and a
dedicated persistent `gptmd-live` journal namespace. Its logs are capped at
200 MB, retained for at most 30 days, and preserve 5 GB of free disk space;
Nginx access/error logs rotate daily and retain 14 days. After the three local
health checks pass, run
`sudo node scripts/enable-live-nginx.mjs` to install or update the API and auth location include,
change the two current web upstreams from OpenLiteSpeed to Nuxt, back up the
existing vhost, validate Nginx, and reload it.

Verify with:

```sh
systemctl is-active gptmd-live-web gptmd-live-api gptmd-live-worker
curl http://127.0.0.1:3100/
curl http://127.0.0.1:4100/readyz
curl -A 'Mozilla/5.0' --resolve obgyn.eaglesvn.club:443:127.0.0.1 https://obgyn.eaglesvn.club/
```

The Nginx vhost intentionally rejects common command-line user agents, so use
a browser or browser-style user agent for the hostname check. `public_html/`
is a temporary placeholder and is no longer the application runtime.

The test host also has an upstream OneShield bot/security layer. On 2026-10-12,
the hosted headless Playwright client received OneShield's branded 403 before
the app loaded (latest trace `01M4QT71X4B9GDX63FRA8JT3NB`; earlier trace
`01M4QSKBD26W8DXKY1B8MVJYM9`). The same `HeadlessChrome/155` user-agent
returned 200 from the host and direct Nginx origin, so the denial is not
explained by that user-agent alone. Direct origin checks also returned 200 for
ordinary Chrome; the Nginx `curl/8.5.0` 403 is its intentional bad-bot rule.
The separate Playwright browser is unauthenticated, but the existing signed-in
desktop Chrome session was reused to inspect OnePortal. Opening
`https://obgyn.eaglesvn.club/` in that real browser produced another branded 403,
trace `01M4QVRQX3F4D2AM5HTKB768MP`; the page labels the client “Guest machine”
with status “Banned” and shows OneShield and the web server active. “Guest machine —
Banned” is OneShield's classification of that blocked web request's client; it
does not mean GPTMD banned a learner account. OneShield configuration
and analytics are scoped under the protected parent domain `eaglesvn.club`,
which owns the `obgyn` DNS record. Its selected 24-hour analytics view showed
2.45K 403 responses (66.1%); this aggregate does not identify the rule or
request responsible for the new trace. The custom WAF Rules tab showed no
entries. The System WAF tab showed only the enabled test block for
`/?blockme=abc` and the enabled Google ads reviewer allow rule; both showed
zero events, and neither matches `/auth/v1/authorize`. The parent domain's
custom rate-limit rules table and System rules table both showed no data. The supplied Google OAuth
authorization URL was then opened from the app and OneShield returned a client
403 before the browser reached Google, trace
`01M4QWFC5XEEHCX961DX1WBTCK`. This confirms that the specific live OAuth start
is blocked at the edge; the portal's visible WAF and rate-limit configuration
does not identify a matching rule. A controlled OAuth-start request using a
fresh PKCE challenge and the configured public Supabase browser key returned
HTTP 302 to `accounts.google.com` both through loopback Nginx (with the public
hostname as TLS SNI/Host) and through public HTTPS from the hosting environment.
The redirect was not followed. These requests show that the origin auth proxy
and Google provider configuration work for requests accepted at the edge; they
do not reproduce the blocked visitor's client network. The OneShield
“Analytics & Access Logs” view for `eaglesvn.club` showed 4.08K requests in its
24-hour window, including 2.53K edge 403 responses (63.6%) and 931 edge 200
responses (23.4%). Those are site-wide aggregates and do not identify the
supplied trace or its visitor classification. A fresh Chrome Incognito window on the same host and network loaded
the public home page successfully, while the existing Chrome profile remained
blocked. A plain curl request still returned 403, while curl with a Chrome 130
user-agent returned 200. This narrows the observed failure to a browser/profile
signal or state; it does not identify whether browser storage, an extension, or
another OneShield client signal is responsible. The new authorization trace
does not show that Google rejected the request: the user's browser received an
edge 403 before the provider redirect, while controlled allowed requests reached
Google. No security setting was changed, and a learner's independent browser
remains unverified. To resolve the block, iNET must
correlate trace `01M4QWFC5XEEHCX961DX1WBTCK` with the edge client classification
and rule/action that generated it; the visible per-rule counters alone cannot
do that. Change only a specific rule if that evidence confirms a false
positive on learner traffic; do not allowlist shared hosted-browser egress,
disable bot protection, or broaden the origin's trusted-proxy list to work
around an edge denial. The repeatable authenticated-browser procedure is recorded in
`persistence/SOP.md`. The origin's current
Permissions-Policy allows same-origin microphone access; camera and
geolocation remain denied. The edge-injected OneShield/RUM scripts are also
blocked by the app's enforced CSP because it uses `strict-dynamic`; keep that
CSP intact unless OneShield can inject a trusted nonce or the hostname-specific
integration is adjusted without weakening script policy.

**2026-10-13 OAuth trace follow-up:** iNET checked trace
`01M4R6JG845SKV5FQN85C362PN` for `/auth/v1/authorize` and reported that the
origin Nginx User-Agent rule generated its 403; OneShield did not block this
request. The active `obgyn.eaglesvn.club` vhost has the matching rule at
`/etc/nginx/sites-available/obgyn.eaglesvn.club.conf`. A current public probe
from this host using `curl/8.5.0` returned HTTP 403 with the expected 28-byte
body, while the same endpoint with a Chrome 130 User-Agent returned HTTP 302.
`sudo nginx -t` passed. This distinguishes the named authorization trace from
the earlier OneShield-branded traces on other requests. The rule was not
changed: browser OAuth already reaches the Google redirect, and command-line
probes can use a browser User-Agent when testing this endpoint. The 302 does
not prove Google callback acceptance or a completed learner sign-in.

On 2026-10-12, the public home page was visibly rendered in the live Chrome
Incognito window and the host returned HTTP 200. The accompanying console report does not
show a page-load failure: inline-script and jsDelivr Material Design Icons
CSS/font messages name a separate `Content-Security-Policy-Report-Only` policy,
so those violations were logged but not enforced. The enforced policy did block
OneShield's injected `/_rum/beacon.js` and `/_osh-cs/widget.js` scripts because
`strict-dynamic` does not accept their host source alone. This did not prevent
GPTMD's home page from rendering. A rendered public home page does not verify
Google OAuth completion or an authenticated learner session.

**2026-10-13 origin incident remediation:** The trace-specific User-Agent
denial was removed from `/etc/nginx/sites-available/obgyn.eaglesvn.club.conf`
after saving `/etc/nginx/sites-available/obgyn.eaglesvn.club.conf.bak-20261013-oauth-ua-block`.
The former rule rejected curl, Python, Java, and other command-line clients on
all paths. Nginx validated and reloaded successfully. The same public
`curl/8.5.0` OAuth request now returns HTTP 302 to Google with the configured
`/auth/v1/callback` redirect URI; direct-origin and public curl requests to `/`
return HTTP 200, and a public Chrome 130 request returns HTTP 200. The app
upstream emitted 4,123 bytes of response headers, exceeding Nginx's default
proxy header buffer; the GPTMD HTTPS vhost now uses `proxy_buffer_size 16k` and
`proxy_buffers 4 16k`. The 502 disappeared after that host-scoped adjustment.
The hosted Playwright browser still receives a OneShield-branded 403 on `/`
(trace `01M4T5V789PYJNC2G7GJ9CVKNB`); it did not reach the origin, whose access
log has no matching browser request. This separate edge classification remains
open for iNET trace correlation and must not be represented as an origin fix
failure or as verified learner sign-in. No callback was completed. Recovery:
restore the timestamped vhost backup only if a rollback is needed, validate it
with `sudo nginx -t`, and reload; if edge denial persists, have iNET inspect the
exact trace and adjust only the confirmed false-positive rule.

**2026-10-13 OneShield and browser-policy follow-up:** At the user's explicit
request for the entire `eaglesvn.club` zone, OneShield protection was switched
off in OnePortal. This disables proxy/WAF protection across every record in
that parent zone, not only `obgyn.eaglesvn.club`; zone DNS now directs clients
to origin addresses. Public DNS resolves the app to `103.72.98.158`, and live
probes returned HTTP 200 for `/` and HTTP 302 to Google's OAuth start for
`/auth/v1/authorize?provider=google`. The user confirmed the page is serving.
This is not evidence of a completed OAuth callback or learner session.

The user's 2026-10-13 console capture also showed inline-script and jsDelivr
stylesheet violations under the origin's `Content-Security-Policy-Report-Only`
header. These were reports, not enforced blocks. The live header had stale
inline hashes and omitted the page's Material Design Icons CDN origin. A first
attempt added the two exact hashes from Chrome's report to the static report-
only policy, but the CDN source update was incomplete; that temporary policy
was later replaced by the dynamic Nginx forwarding described below. The
enforced Nuxt CSP was not weakened. Backup:
`/etc/nginx/sites-available/obgyn.eaglesvn.club.conf.bak-20261013T083751-csp-report`.
The four unsupported Permissions-Policy names in that capture were absent from
the fresh public response and active Nginx configuration inspected afterward;
refresh the browser and inspect that navigation's response headers if they
persist. A separate hosted Playwright browser still returned HTTP 502 during
the transition, despite the user's browser loading the page and direct public
HTTP probes succeeding; the hosted-browser path is not considered verified.

**2026-10-13 Nginx header authority and CSP verification:** The live Nginx
overlay now strips upstream copies of fixed security headers and emits the
public values once. It forwards Nuxt's generated `Content-Security-Policy`
through Nginx so release-specific script hashes stay aligned with the served
HTML; `Content-Security-Policy-Report-Only` uses the same generated policy,
with only `upgrade-insecure-requests` omitted because browsers ignore that
directive in report-only mode. This supersedes the temporary static-hash
report-only adjustment above. The hostname-scoped Nginx map is versioned at
`ops/nginx/gptmd-permissions-policy-map.conf`, and the server overlay at
`ops/nginx/gptmd-live-locations.conf`. Nginx configuration test passed; a fresh
Chromium navigation returned HTTP 200 with no CSP, Permissions-Policy, console,
or page errors. The same-origin microphone policy remained enabled. OAuth
authorization still returns HTTP 302 to Google; callback and learner sign-in
remain unverified.

**2026-10-13 Google OAuth redirect mismatch:** The live `/auth/v1/authorize`
request returns HTTP 302 to Google with
`redirect_uri=https://obgyn.eaglesvn.club/auth/v1/callback`. The running
`supabase-auth` container reports the same `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI`,
derived from `API_EXTERNAL_URL=https://obgyn.eaglesvn.club/auth/v1` in the
Supabase project configuration. The app therefore sends the intended
same-origin callback; Google's `redirect_uri_mismatch` means this exact URI is
not authorized for the OAuth client used by the request, or the Google Cloud
Console has a different client configured. Add
`https://obgyn.eaglesvn.club/auth/v1/callback` to that client's **Authorized
redirect URIs** and confirm the client ID matches the live request. Do not add
`/confirm` or `/auth/v1/authorize` as the Google callback: `SITE_URL` and
`ADDITIONAL_REDIRECT_URLS` govern the post-auth return destination, not Google's
callback URI. Google Cloud Console registration has not been inspected or
changed, and no OAuth callback or learner session has been verified; keep
checklist node `a03` open. After updating the client, repeat sign-in and verify
Google returns to `/auth/v1/callback` before the app's post-auth redirect.

**2026-10-13 Google OAuth callback repair and browser verification:** The user
updated the existing `gptMD` Google Cloud web client to authorize the exact
live callback `https://obgyn.eaglesvn.club/auth/v1/callback`. A fresh desktop
Chrome sign-in completed the Google return and `/account` displayed
`onlineadmin@eaglesvn.online` as signed in. The callback initially returned
403 because OWASP CRS 3.3.5 rule `930120` treated Google's URI-like OAuth
`scope` argument as an OS file access attempt, adding anomaly score 5 and
triggering `949110`. The origin now has a host-and-exact-path conditional
exception that removes only `ARGS:scope` from rule `930120`; all other callback
arguments and CRS rules remain inspected. The versioned source is
`ops/modsecurity/gptmd-oauth-callback-exclusions.conf`, installed at
`/etc/modsecurity/crs/gptmd-oauth-callback-exclusions.conf` and included from
`REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf`. The live Nginx config passed
`sudo nginx -t` and was reloaded. A callback-shaped request carrying Google's
scope value but no OAuth state now reaches GoTrue and returns its expected
303 `bad_oauth_callback`, rather than ModSecurity's 403; the fresh browser flow
then completed. Backups are
`/etc/modsecurity/crs/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf.bak-20261013-oauth-scope`
and `/etc/modsecurity/crs/gptmd-oauth-callback-exclusions.conf.bak-20261013-request-uri`.
The signed-in account page reports no active GPTpatient workspace and requires
a learner role. OAuth authentication is verified; workspace provisioning and
learner entitlement are not. Earlier notes in this file describe the state
before this repair.

**2026-10-13 entitlement-controls release:** After `npm run check` passed, the
live deploy installed release `2026-10-13T152107396Z`. The deployment applied
`024_session_archive_jobs.sql` and
`025_tenant_entitlement_audit.sql` to the verified `gptmd_live` database and
restarted web, API, and worker successfully. All three services are active;
loopback web/API readiness returned HTTP 200, public `/` returned HTTP 200,
and `/auth/v1/authorize?provider=google` returned HTTP 302. The isolated
`scsstx@gmail.com` tenant is not yet seeded: its Auth identity does not exist in
the separate Supabase Auth database. Complete first Google sign-in, resolve
the subject UUID from that Auth database, then run the versioned seed against
`gptmd_live`. The seed now accepts a validated `test_subject_id` psql variable
and keeps every capability disabled. Live account controls and authorization
remain unverified until that sequence completes.

**2026-10-13 Google OAuth audience denial for the test client:** The user
attempted Google sign-in as `scsstx@gmail.com` and Google returned HTTP 403
`org_internal`, stating that `gptMD-web-oauth` can only be used within its
organization. This is an OAuth audience restriction, not a callback URI,
origin Nginx/ModSecurity, OneShield, Supabase Auth, or GPTMD entitlement error.
Google defines `org_internal` as a request from outside the Cloud project's
parent organization. For this personal Gmail test account, the intended narrow
configuration is Google Auth Platform **Audience > User type: External**, with
publishing status kept at **Testing** and `scsstx@gmail.com` explicitly added
under **Test users**. Do not publish the app or broaden requested scopes for
this fix. Google's testing guidance notes an exception for apps requesting
only basic identity scopes (`openid`, `email`, `profile`), so the test-user
list itself is not GPTMD's access-control boundary; active tenant membership
and entitlements remain that boundary. The local Chrome session was opened to
the Audience page, but the setting has not yet been changed or verified. After
the change, repeat Google sign-in; only a resulting active row in Supabase
`auth.users` proves identity creation. Then run `npm run provision:scsstx-test`
and verify the isolated tenant. Until then, no test identity or tenant is
provisioned.

**2026-10-14 learner provision and full mirror sync:** This later state
supersedes earlier dated notes above that say no test identity or tenant was
provisioned. After the user completed
Google sign-in, the provisioning checks found exactly one active Auth identity.
The live `gptmd_live` database now has two separate test workspaces: an all-off
`customer_admin` control workspace and a `learner` workspace with bounded text
visits/Responses enabled, five visits and 50 Responses monthly, 12 Responses
per visit, one concurrent visit, and voice disabled with zero audio quota. The
seed records before/after state in the append-only entitlement audit. This
verifies database provisioning, not a signed-in learner browser workflow.

The full `npm run check` passed before release `2026-10-13T173629854Z` was
activated. Web, API, and worker services are active; `/`, `/privacy`, and
`/contact` each returned public HTTP 200. A follow-up ownership audit found
every current release path owned by `eaglesvn:eaglesvn`; group/other write bits
were removed from 9,193 release paths. The deploy script now enforces that
owner/group and permission policy before future activation. The `current`
symlink itself reports mode 777, which is normal for a symlink; its target tree
is the checked release. Direct learner browser access remains to be verified
by refreshing Account and selecting the workspace labeled `Learner`.

**2026-10-14 Home workspace status and full mirror sync:** A regression test
using the provisioned control and learner workspace slugs found that Home kept
showing the customer-admin status after switching to the learner workspace,
even though visit entry became enabled. Home now clears that stale message when
the selected active workspace changes. The fixture verifies admin visit entry
stays blocked and the learner workspace enables it in Chromium, Firefox, and
WebKit. The full `npm run check` passed: 275 unit tests, 39 standard browser
tests, 44 preflight browser cases, 10 mobile viewport cases, and one Mobile
Viewer tool case, along with lint, type, schema, API, diagram, and warning-free
production-build checks. Release `2026-10-13T194537478Z` is active after
`npm run deploy:live`; all 9,193 release paths are owned by
`eaglesvn:eaglesvn`, with zero group/other-writable paths. All three services
and loopback web/API readiness checks passed; public `/`, `/privacy`, and
`/contact` returned HTTP 200. A fresh Playwright public navigation rendered
Home with zero console errors or warnings. Unauthenticated `/account` redirects
to sign-in. The fixture is not live learner-browser proof; that gate remains
open until the signed-in learner selects the workspace and starts a visit.

**2026-10-14 learner-session corroboration:** The user reports that transcript
mode works. A read-only transaction against `gptmd_live`, limited to the
isolated `gptmd-learner-test-scsstx` workspace and returning no session IDs or
utterance content, found one active session, three accepted-turn events, four
patient-turn provider-usage rows linked to durable events, and one
`patient_turn_recovered_after_validation_retry` audit. This corroborates that
the learner workspace has processed live turns. The schema does not persist
whether those turns used typed transcript or Realtime transcription, and this
browser remains signed out; do not describe the database check as proof of the
Account selector UI or of a particular interaction mode. No transcript or
patient text was read.

**2026-10-14 OAuth User-Agent regression gate:** The deployment previously
checked loopback web/API readiness but did not guard the live OAuth route
against recurrence of the origin's command-line User-Agent 403. The
`scripts/verify-live-oauth.mjs` preflight now probes both local-origin Nginx
(loopback TLS with the correct hostname/SNI) and public ingress using
`curl/8.5.0`. Each response must be HTTP 302 to `accounts.google.com` and carry
the exact `https://obgyn.eaglesvn.club/auth/v1/callback` redirect URI; OAuth
state is never printed. `npm run deploy:live` runs this check before
FreeFileSync, so a bad origin or public response stops the release before
staging is modified. The standalone `npm run verify:live-oauth` repeats the
curl probes. The additional `npm run verify:live-browser` preflight loads the
public home page in headless Chromium, rejects 403/non-app responses and
browser errors, and checks the browser OAuth redirect against the exact
callback. Deployment runs both read-only preflights before syncing. These verify
route availability and OAuth launch only, not Google callback completion or a
learner session; local Chromium cannot establish the reputation result for
every remote browser client. Recovery: compare direct-origin, public curl, and
browser results, repair the layer returning the failure, then rerun both
standalone checks before deploying.

The gate passed before the 2026-10-14 full mirror sync, and release
`2026-10-14T073930379Z` activated successfully. The post-deploy gate passed
again. All three systemd services are active with zero restarts; the active
release has 9,193 paths with no owner/group mismatch or group/other-writable
path. Public `/`, `/privacy`, and `/contact` returned HTTP 200. This updates the
earlier `2026-10-13T194537478Z` release reference above; that release was active
before this sync.

**2026-10-14 account selector deployment and live profile verification:** The
Account page now omits the workspace selector when exactly one active
membership exists; multiple memberships still require explicit selection. The
full `npm run check` passed before deploying release
`2026-10-14T083134786Z`. `npm run verify:live-oauth` passed for origin and public
ingress afterward. Web/API/worker are active with zero restarts; all 9,193
release paths are owned by `eaglesvn:eaglesvn` with no group/other-writable
paths; `/`, `/privacy`, and `/contact` return HTTP 200. Existing Chrome Profile
1 shows the expected signed-in learner identity, learner role, bounded visit
access, voice unavailable, and no selector. Chrome Default shows the separate
learner identity with the same role/policy and no selector. These are real
Account-page checks, not proof of a new visit or whether a prior turn used
typed transcript or Realtime transcription.

**2026-10-14 onlineadmin admin-and-learner access:** After the user clarified
that onlineadmin needs both admin and learner spaces, a guarded live provisioner
created `gptmd-entitlement-test-onlineadmin` as a separate all-off
`customer_admin` tenant. It first verified the existing onlineadmin learner
membership and bounded text-only policy, then wrote one append-only initial
policy audit. A read-only database query confirms two active rows for the
onlineadmin subject: customer administrator in the control tenant and learner
in `gptmd-learner-test-onlineadmin`; voice, privacy approval, and audio quota
are disabled in both. The real Chrome `Default` Account page shows two
available workspaces and a blank explicit-choice selector. The learner tenant
was preserved. No deployment or migration was required.

**2026-10-14 patient-variant settings deployment:** The first deployment
attempt stopped transactionally because migration 026 revoked privileges from
optional Supabase roles (`anon` and `authenticated`) that are absent in the
standalone `gptmd_live` database. The active release and services remained
unchanged, and migration 026 was not marked applied. The migration now always
revokes from `PUBLIC` and conditionally revokes from optional roles found in
`pg_roles`; a regression test covers the absent-role case. The phase-two
verifier had also stopped at session reads because its disposable database
fixture omitted migrations 025 and 026 after the session projection began
selecting the new presentation snapshot columns. Its fixture now applies both
migrations, and `npm run verify:phase2` passed.

After that repair, `npm run check` passed with 300 unit tests, all configured
cross-browser and mobile suites, API compilation, schema/diagram validation,
and a warning-free production build. `npm run deploy:live` applied
`026_patient_variant_settings.sql` and activated release
`2026-10-14T112030013Z`. Direct post-deployment checks found all three GPTMD
services active, API `/readyz` reporting Redis/PostgreSQL/OpenAI/auth ready,
and the public home, privacy, and contact routes plus OAuth/browser preflights
passing. The current release tree was audited for ownership and write
permissions. A read-only database check found the new patient presentation
snapshot column and RLS-enabled settings table; the settings and audit tables
both contain zero rows. No educator values were seeded or approved, and no
live instructor-account workflow was exercised. The deployment enables the
controls in the live schema; it does not establish educator approval or learner
use of configured settings.

**2026-10-15 organization AI-time enforcement deployment:** After the full
`npm run check` passed, `npm run deploy:live` synchronized the tested web/API
release and applied `029_ai_budget_group_assignments.sql`,
`030_provider_token_reservations.sql`, and
`031_ai_budget_enforcement.sql`. Initial release
`2026-10-15T135257737Z` activated successfully. `gptmd-live-web`, `gptmd-live-api`, and
`gptmd-live-worker` are active as `eaglesvn:eaglesvn`; the release tree has no
group/other-writable paths. API `/readyz` reports Redis, PostgreSQL, OpenAI,
and auth ready. Public `/` returns HTTP 200 and `/auth/v1/authorize?provider=google`
returns HTTP 302 to Google with the configured callback URI.

A read-only query confirmed `gptmd_live` / `gptmd_live_app`, migration 031 as
the latest applied migration, and all three budget migrations recorded. The
reservation ledger and budget-settings table currently contain zero rows.
Onlineadmin's customer-admin membership is in
`gptmd-entitlement-test-onlineadmin`; scsstx retains its original bounded
learner workspace `gptmd-learner-test-scsstx`. The 2026-10-15 budget-test seed
below adds a second scsstx learner membership in the admin-controlled test
workspace without changing the original learner tenant.

**2026-10-15 draft-budget inertness follow-up:** Review before learner testing
found that session creation treated saved draft group catalogs as active
assignments, despite draft settings being documented as inert. The local fix
now resolves and pins group/department assignments only when budget settings
are explicitly active; regression coverage verifies that a saved draft with
groups and departments allows session creation without assignments and stores
null budget snapshots, while active multi-group settings still require an
explicit selection. The full `npm run check` passed with 331 unit tests, 45
cross-browser tests, 44 preflight tests, 10 mobile-viewer tests, and 1 viewer
tool test. Release `2026-10-15T140535206Z` replaced
`2026-10-15T135257737Z`; no new database migration was needed. Post-deploy,
all three services remained active as `eaglesvn:eaglesvn`, the API reported
all dependencies ready, public `/` returned HTTP 200, and OAuth start returned
HTTP 302. The release tree has no group/other-writable files. Budget settings
and reservation tables remain empty, so this fixes inert draft behavior but
does not prove live budget enforcement with scsstx.

**2026-10-15 budget test learner provisioning:** Added the existing scsstx
Auth identity as an active `learner` in `gptmd-entitlement-test-onlineadmin`,
the existing all-off workspace owned by the onlineadmin `customer_admin`. The
guarded `npm run provision:ai-budget-test-learner` verified both unique Auth
identities, the `gptmd_live` / `gptmd_live_app` target, migrations 024, 025,
027, and 029-031, the onlineadmin active admin role, and the original scsstx
bounded text-only learner policy. It refused any target policy other than the
exact all-off baseline and inserted only the learner membership. Read-back
confirms both roles are active, the shared policy remains disabled with finite
text quotas and zero audio allowance, and there are no budget settings, group
or department assignments, or reservations. The seed establishes an
admin-managed test roster only; it does not activate visits, create token
budgets, or prove learner UI/session behavior. Verify in Chrome Profile 1 that
the scsstx Account page shows the second workspace and requires explicit
selection; retain the original standalone learner workspace.

**2026-10-15 session assignment snapshot serialization:** Added a tenant-row
`FOR SHARE` lock at the start of session creation, before entitlement,
budget-setting, group-assignment, and department-assignment reads. Customer
admin settings and assignment transactions take `FOR UPDATE` on that tenant
row first, so a newly created session sees a consistent before-or-after
assignment snapshot instead of racing an admin change. Regression tests assert
the lock order and that a missing tenant rolls back before entitlement lookup
or session insertion. A rollback-only probe against live PostgreSQL held
`FOR SHARE` on one existing tenant and confirmed that an admin-style
`FOR UPDATE NOWAIT` received PostgreSQL lock-not-available; both transactions
were rolled back without changing data. The full `npm run check` passed: 337 unit tests, 45
cross-browser tests, 44 preflight tests, 10 mobile-viewer tests, and one viewer
tool test; API build, schema/diagram checks, typechecks, and warning-free
production build also passed. `npm run deploy:live` activated release
`2026-10-15T142641634Z`; web, API, and worker are active as `eaglesvn:eaglesvn`,
API readiness reports Redis/PostgreSQL/OpenAI/auth ready, and the post-deploy
browser home/OAuth checks passed. Public home returned HTTP 200 and OAuth start
HTTP 302. A read-only query confirmed migrations 029-031 and zero budget
settings, assignments, or token reservations. This proves the code and
deployment path only; no live budget enforcement or learner-funded session was
exercised.

**2026-10-15 text transcript archive deployment:** Read-only preflight confirmed
the target database was `gptmd_live` as `gptmd_live_app`, migration 031 was
latest, the append-only `download_engagement` trigger existed, and both archive
jobs and engagement tables were empty. `npm run deploy:live` applied
`032_session_transcript_archives.sql` and activated release
`2026-10-15T150625442Z`. All three live services are active with zero restarts;
API readiness reports Redis, PostgreSQL, OpenAI, and auth ready. Public `/`
returned HTTP 200 and OAuth start returned HTTP 302 to Google. The release
tree is owned by `eaglesvn:eaglesvn` with no group/other-writable files. A
read-only post-deploy query confirmed migration 032, the artifact table with
RLS enabled, the queue and engagement columns, and the append-only trigger.
Archive-job and download-engagement counts remain zero. This deploy verifies
schema and service readiness only; no live session has yet generated or
downloaded an archive, and b03-b05/b07-b09 remain open pending owned-session
generation, authorization, expiry, engagement, retry, and cleanup evidence.

**2026-10-15 archive worker claim precision fix:** `npm run verify:phase2`
initially exposed that PostgreSQL's microsecond `claimed_at` value was rounded
to milliseconds by the Node `Date` parser, causing the archive worker's exact
claim comparison to report `archive_source_missing`. Claim timestamps are now
truncated to millisecond precision before persistence, matching the value
round-tripped through `pg`. A regression assertion covers the precision rule;
the isolated verifier now exercises real Express archive routes, PostgreSQL,
Redis, worker generation, private owner-scoped download, and denied / authorized
/ completed engagement with exact byte counts. `npm run check` passed with 356
unit tests, 48 cross-browser tests, 44 encounter-preflight tests, 10
mobile-viewer tests, and one viewer-tool test, along with typechecks, API build,
schema/diagram checks, and production build. `npm run deploy:live` activated
release `2026-10-15T152031051Z`; web, API, and worker are active with zero
restarts, API readiness reports Redis/PostgreSQL/OpenAI/auth ready, public `/`
returns HTTP 200, and OAuth start returns HTTP 302. The release tree has no
group/other-writable files. Live archive-job and engagement counts remain zero:
the successful E2E flow used only the disposable verifier database and does
not establish live learner generation, download, expiry, retry, or cleanup.

**2026-10-15 organization-admin reservation visibility:** The customer-admin
AI-time budget endpoint and account control now report settled provider usage
separately from the current configured organization period's in-flight reserved
token ceilings/counts and held-for-reconciliation ceilings/counts. Held values
remain informational and continue consuming active limits; this does not add a
client-admin settlement or release path. Regression coverage verifies tenant
scope, period bounds, summary fields, and rendered controls. `npm run check`
passed with 357 unit tests, 48 cross-browser tests, 44 encounter-preflight
tests, 10 mobile-viewer tests, and one viewer-tool test, along with lint,
typechecks, API build, schema/diagram checks, and warning-free production
build. `npm run deploy:live` activated release `2026-10-15T153442115Z` with no
new migration. All services are active with zero restarts; API readiness
reports Redis/PostgreSQL/OpenAI/auth ready; public `/` returns HTTP 200 and
OAuth start returns HTTP 302. The release tree has no group/other-writable
files. A read-only query against `gptmd_live` / `gptmd_live_app` confirmed zero
reservation ledger rows (zero reserved and held calls/tokens). Therefore the
live endpoint is deployed, but the displayed nonzero controls are verified only
in local browser tests; live budget enforcement remains unexercised.

**2026-10-16 token-bucket release:** After the full `npm run check` passed
(392 unit tests; 48 cross-browser, 44 preflight, 10 mobile-viewer, and one
viewer-tool case), `npm run deploy:live` activated release
`2026-10-16T072730705Z`. The deployment applied migrations 033-037, including
the consumer catalog, provider-usage index, token grant/debit ledger,
lock-safe reservation allocation, and persistent add-on notice. All three
systemd services are active with zero restarts; API readiness reports
Redis/PostgreSQL/OpenAI/auth ready. Post-deploy origin/public OAuth checks and
the real Chromium home/OAuth browser checks passed. The source catalog is in
the release as `api/catalog/obgyn-disorders.reference.json`, owned by
`eaglesvn:eaglesvn` mode 0644; release API directories are mode 0755. A
read-only query confirmed migrations 033-037 and zero token grants,
reservations, consumer offer-catalog entries, budget settings, group
assignments, archive jobs, or download-engagement rows. Checkout remains
disabled, and no live learner session exercised token settlement or add-on
notice. This deployment proves migration application, service readiness, and
public route availability only; trusted grant issuance, renewals, payment
confirmation, checkout, and live learner funding remain open.

**2026-10-16 organization-allocation reconciliation and cleaned educator catalog:**
After `npm run check` passed (60 unit files / 399 tests, 48 desktop browser
cases, 44 encounter-preflight cases, 10 mobile-viewer cases, and one viewer
tool case), `npm run deploy:live` applied migration
`038_organization_group_allocation_adjustments.sql` and activated release
`2026-10-16T081212459Z`. The deploy packages
`obgyn-disorders.reference.diagnostics-tests-cleaned.json` as
`api/catalog/obgyn-disorders.reference.json`; local and release SHA-256 both
equal `83811a34d27c3ae05381c1e2e52ec6f6acbffecb37719d1032e225d355acd32b`.
The catalog contains 130 disorders, eight routine-care services, 260 attributed
disorder sections, and 138 structured diagnostic profiles. Scenario selection
uses the supplied modeled encounter-relevance values as seed-pinned sampling
weights; the source explicitly states these are not measured population
incidence. Origin/public OAuth checks and post-deploy Chromium home/OAuth checks
passed. All three services are active; API `/readyz` reports Redis,
PostgreSQL, OpenAI, and auth ready. The release catalog file is owned by
`eaglesvn:eaglesvn` mode 0644. Read-only post-deploy queries confirmed migration
038 and zero token grants/entries, provider reservations, consumer catalog
entries, group/department assignments, organization budget settings, archive
jobs, and download-engagement rows. No live learner grant or generated scenario
was created; live scenario-generation evidence, budget funding, and checkout
remain open.

**2026-10-16 GPTMD system operations deployment:** After a full local gate passed
(401 unit tests, 48 cross-browser tests, 44 encounter-preflight tests, 10
mobile-viewer tests, and one viewer-tool test),
`npm run deploy:live` activated release `2026-10-16T083125601Z`.
`npm run configure:live-ops` installed the fixed-command root operator, socket
activation, HMAC key, and API supplementary group; its signed overview returned
all three GPTMD services. The operator is constrained to the GPTMD web/API/
worker units and sanitized logs. A separate command,
`npm run configure:live-system-admin`, resolved exactly one active Supabase
Auth identity for `onlineadmin@eaglesvn.online`, added only its verified UUID to
`GPTMD_SYSTEM_ADMIN_SUBJECTS` in the mode-0600 API environment, restarted the
API, and verified readiness without printing credentials or the UUID. Direct
post-configuration probes returned HTTP 200 for public `/` and `/readyz`; the
three application units and both ops units report active. The ops socket is
`root:gptmd-ops` mode 0660; the private API environment remains
`eaglesvn:eaglesvn` mode 0600. The protected admin page and authenticated
restart/log actions have not yet been exercised in a live onlineadmin browser
session. Subsequent aggregate `npm run check` reruns passed lint, typechecks,
session. `npm run check` now passes with 404 unit tests, 54 desktop browser
cases, 44 encounter-preflight cases, 10 mobile-viewer cases, and one viewer
tool case. The desktop cross-browser suite is configured for one worker because
parallel browser jobs exceeded per-test timeouts on the host; no tests were
skipped or weakened. New system-admin E2E coverage in Chromium, Firefox, and
WebKit verifies non-operator denial and the operator status/log/fixed-action
flows with mocked authentication/API responses. This is local UI coverage, not
a live onlineadmin browser-session check. No application data or tenant state
was changed by this operator setup.

**2026-10-16 estimated engagement report deployment:** After the full local
`npm run check` passed (407 unit tests, 54 standard browser tests, 44
encounter-preflight cases, 10 mobile-viewer cases, and one viewer-tool case),
the focused migration/report suite passed 126 tests and the updated preflight
disclosure passed Chromium E2E. `npm run deploy:live` applied
`039_session_engagement_pulses.sql` and activated release
`2026-10-16T100519284Z`. A read-only query confirmed both the migration ledger
entry and `public.session_engagement_pulses` exist. All three application
services are active; loopback `/readyz` and public `/`, `/privacy`, origin and
public OAuth, and real-browser home/OAuth checks returned their expected
success responses. The 9,249-path active release tree has no owner/group
mismatches or group/other-writable files or directories; the release and
educator catalog are owned by `eaglesvn:eaglesvn`, with the catalog mode 0644.
No live learner pulse or report row has yet been verified, and no CEU evidence
is claimed.
