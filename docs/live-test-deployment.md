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
The setup populated all 22 current migrations and records applied migrations
in `gptmd_schema_migrations`.

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
