import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('live deployment artifact whitelist', () => {
  it('requires release ownership by the service account and removes shared write access', async () => {
    const deployment = await readFile('scripts/deploy-live.mjs', 'utf8')

    expect(deployment).toContain('async function secureReleaseTree(path)')
    expect(deployment).toContain('info.uid !== process.getuid() || info.gid !== process.getgid()')
    expect(deployment).toContain('info.mode & 0o777 & ~0o022')
    expect(deployment).toContain('await secureReleaseTree(stageRoot)')
  })

  it('canonicalizes the www live-test alias before auth and API origin checks', async () => {
    const locations = await readFile('ops/nginx/gptmd-live-locations.conf', 'utf8')

    expect(locations).toContain('if ($host = www.obgyn.eaglesvn.club) {')
    expect(locations).toContain('return 301 https://obgyn.eaglesvn.club$request_uri;')
  })

  it('makes Nginx the single public emitter for security headers while preserving dynamic CSP', async () => {
    const locations = await readFile('ops/nginx/gptmd-live-locations.conf', 'utf8')
    const policyMap = await readFile('ops/nginx/gptmd-permissions-policy-map.conf', 'utf8')

    for (const header of [
      'Content-Security-Policy',
      'Content-Security-Policy-Report-Only',
      'Permissions-Policy',
      'Referrer-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options'
    ]) {
      expect(locations).toContain(`proxy_hide_header ${header};`)
    }

    expect(locations).toContain('add_header Content-Security-Policy $upstream_http_content_security_policy always;')
    expect(locations).toContain('add_header Content-Security-Policy-Report-Only $gptmd_csp_report_only always;')
    expect(policyMap).toContain('map $upstream_http_content_security_policy $gptmd_csp_report_only {')
    expect(policyMap).toContain('upgrade-insecure-requests')
  })

  it('isolates live service logs with persistent size and age bounds', async () => {
    const files = await Promise.all([
      'web', 'api', 'worker'
    ].map((role) => readFile(`ops/systemd/gptmd-live-${role}.service`, 'utf8')))
    const journal = await readFile('ops/systemd/journald@gptmd-live.conf', 'utf8')

    for (const unit of files) expect(unit).toContain('LogNamespace=gptmd-live')
    expect(journal).toContain('Storage=persistent')
    expect(journal).toContain('SystemMaxUse=200M')
    expect(journal).toContain('SystemKeepFree=5G')
    expect(journal).toContain('MaxRetentionSec=30day')
    expect(journal).toContain('ForwardToSyslog=no')
  })

  it('forwards only the trusted Nginx-resolved client IP to live auth and API upstreams', async () => {
    const locations = await readFile('ops/nginx/gptmd-live-locations.conf', 'utf8')

    expect(locations.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g)).toHaveLength(2)
    expect(locations).not.toContain('$proxy_add_x_forwarded_for')
  })

  it('ships the API patient profile catalog in the production image and live sync', async () => {
    const dockerfile = await readFile('ops/Dockerfile.production', 'utf8')
    const sync = await readFile('ops/freefilesync/gptmd-live-api.ffs_batch', 'utf8')

    expect(dockerfile).toContain('COPY --from=api-build --chown=node:node /workspace/services/api/catalog ./catalog')
    expect(sync).toContain('<Item>\\catalog\\</Item>')
    expect(sync).toContain('<Item>\\dist\\</Item>')
    expect(sync).toContain('<Item>\\migrations\\</Item>')
    expect(sync).toContain('<Item>\\package.json</Item>')
    expect(sync).toContain('<Item>\\package-lock.json</Item>')
    expect(sync).not.toContain('<Item>*</Item>')
    expect(sync).toContain('<Item>\\src\\</Item>')
    expect(sync).toContain('<Item>\\node_modules\\</Item>')
  })
})
