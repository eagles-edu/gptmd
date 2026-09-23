# gptmd API service

This is the separate Express service boundary for the project. It is
TypeScript-built and deliberately starts with only operational endpoints:

- `GET /healthz` — process health
- `GET /readyz` — readiness placeholder

The service defaults to `HOST=127.0.0.1` and `PORT=4000`. It refuses a
non-loopback `HOST` so it cannot accidentally become a public listener.

## Local development

From the repository root:

```bash
npm --prefix services/api install
npm run api:build
npm run api:dev
```

Probe it locally:

```bash
curl http://127.0.0.1:4000/healthz
curl http://127.0.0.1:4000/readyz
```

## Local production-style deployment

Build the service and install the reviewed systemd template only after
checking the user, paths, and port:

```bash
npm run api:build
sudo install -o root -g root -m 0644 ops/gptmd-api.service /etc/systemd/system/gptmd-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now gptmd-api.service
systemctl status gptmd-api.service --no-pager
```

The systemd unit keeps Express on loopback. A secure subdomain is a separate
reverse-proxy concern: Nginx terminates ACME-backed TLS for
`api.eaglesvn.club` and proxies to `http://127.0.0.1:4000`. Review
`ops/nginx/api.eaglesvn.club.conf.example`, DNS, certificate paths, and the
existing OLSWS/Nginx port ownership before activating that configuration.

No domain API routes, authentication scheme, Redis writes, public listener, or
deployment automation is defined yet.
