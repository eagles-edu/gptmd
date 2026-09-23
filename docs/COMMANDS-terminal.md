# Terminal commands and operating boundaries

Run commands from `/home/eaglesvn/dockerz/gptmd` unless a command says
otherwise. These commands are intentionally split by responsibility: agents
may inspect local state and run tests, while deployment and infrastructure
changes remain reviewed operations.

## Frontend quality gates

The root project uses Nuxt, Vue, Vuetify, TypeScript, ESLint, Vitest, Stylelint,
HTML validation, and Playwright:

```bash
npm install
npm run lint
npm run lint:styles
npm run validate:html
npm test
npm run build
npm run test:e2e
```

Playwright browsers are a separate machine setup and should be installed only
when browser acceptance testing is ready:

```bash
npx playwright install chromium
```

## Separate Express service

The Express API is isolated from Nuxt under `services/api/`:

```bash
cd services/api
npm install
npm run build
npm run dev
```

The initial service exposes only loopback health endpoints:

```bash
curl http://127.0.0.1:4000/healthz
curl http://127.0.0.1:4000/readyz
```

### Local secure-subdomain deployment

The intended deployment is:

```text
client --HTTPS--> Nginx api.eaglesvn.club --HTTP loopback--> 127.0.0.1:4000 Express
```

Express is never bound to a public interface. Nginx terminates TLS for the
real DNS name and proxies only to the loopback service. The reviewed template
is `ops/nginx/api.eaglesvn.club.conf.example`; it is not active configuration.

After DNS and an ACME certificate are verified by an administrator:

```bash
cd services/api
npm run build
sudo install -o root -g root -m 0644 ../../ops/gptmd-api.service /etc/systemd/system/gptmd-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now gptmd-api.service
systemctl status gptmd-api.service --no-pager
curl -fsS http://127.0.0.1:4000/healthz
```

Only then should the reviewed Nginx template be adapted, installed, checked
with `nginx -t`, and reloaded by an administrator. Verify DNS, port 443, the
certificate chain, and the HTTPS health endpoint before calling the subdomain
deployed. Do not add domain routes, public Express listeners, credentials, or
deployment wiring until the API contract is defined.

## Python tooling

For Python utilities and services, use an isolated virtual environment and
reviewed dependency files:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install ruff pytest pyright
ruff check .
pytest
pyright
```

Use `mypy` instead of or alongside `pyright` only when the service's typing
policy requires it. Never commit `.venv`, credentials, or generated reports.

## Redis Stack: read-only inspection

Keep Redis Stack in its existing local Compose project. Inspect without
mutating data:

```bash
docker compose ps
docker compose logs --tail=100 redis-stack
docker exec redis-stack redis-cli ping
docker exec redis-stack redis-cli info server
docker exec redis-stack redis-cli module list
```

Do not run `FLUSHDB`, `FLUSHALL`, write commands, or expose Redis beyond its
loopback bindings from an agent workflow. Do not print `.env` values.

## Kubernetes and host web stack: read-only first

Use current official documentation through the OpenAI Docs MCP for OpenAI
topics and approved documentation/web lookup for other products. Keep agent
operations read-only unless a human explicitly reviews the change:

```bash
kubectl get namespaces
kubectl get pods --all-namespaces
kubectl describe pod <pod> -n <namespace>
kubectl logs <pod> -n <namespace> --tail=100
helm list --all-namespaces

nginx -t
sudo systemctl status nginx --no-pager
sudo systemctl status lshttpd --no-pager
ss -ltnp
sudo journalctl -u nginx -n 100 --no-pager
sudo journalctl -u lshttpd -n 100 --no-pager
```

Do not let MCP tools apply Kubernetes manifests, reload Nginx/OLSWS, alter
firewall rules, issue certificates, deploy Gunicorn, or change CI/CD secrets.
Use configuration review, syntax checks, listener checks, and CI gates first.

## Hermes, Codex, and MCP status

```bash
codex mcp list
hermes mcp list
hermes -p gptmd-coding mcp list
hermes -p gptmd-coding status
curl -fsS http://127.0.0.1:9119/
```

Each new repository receives its own Hermes profile and CuratorMD boundary:

```bash
python3 plugins/gptmd-memory/scripts/enable_repo.py \
  --project-root /absolute/path/to/new-repo \
  --profile newrepo-coding \
  --time 06:15
```

The onboarding script registers CuratorMD and the read-only OpenAI Developer
Docs MCP, creates the observer and staggered curation job, and never commits,
pushes, deploys, migrates, or deletes data.

## Attended Git and Copilot workflow

```bash
git status --short
git diff --check
git diff
git log -5 --oneline
```

Copilot and Git remain attended development tools. Review diffs before any
commit, push, deployment, migration, or infrastructure change.
