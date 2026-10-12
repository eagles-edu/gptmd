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
keeps the previous release if the new processes do not pass readiness.

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

On 2026-10-12, the public home page was visibly rendered in the live Chrome
Incognito window and the host returned HTTP 200. The accompanying console report does not
show a page-load failure: inline-script and jsDelivr Material Design Icons
CSS/font messages name a separate `Content-Security-Policy-Report-Only` policy,
so those violations were logged but not enforced. The enforced policy did block
OneShield's injected `/_rum/beacon.js` and `/_osh-cs/widget.js` scripts because
`strict-dynamic` does not accept their host source alone. This did not prevent
GPTMD's home page from rendering. A rendered public home page does not verify
Google OAuth completion or an authenticated learner session.
