import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { assertGoogleOAuthRedirect, verifyLiveOAuthAuthorize } from '../../scripts/verify-live-oauth.mjs'
import { assertLiveBrowserOAuthRedirect, assertLiveHomeResponse } from '../../scripts/verify-live-browser.mjs'

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
    expect(dockerfile).toContain('COPY --chown=node:node educator-input/obgyn-disorders.reference.diagnostics-tests-cleaned.json ./catalog/obgyn-disorders.reference.json')
    expect(sync).toContain('<Item>\\catalog\\</Item>')
    expect(sync).toContain('<Item>\\dist\\</Item>')
    expect(sync).toContain('<Item>\\migrations\\</Item>')
    expect(sync).toContain('<Item>\\package.json</Item>')
    expect(sync).toContain('<Item>\\package-lock.json</Item>')
    expect(sync).not.toContain('<Item>*</Item>')
    expect(sync).toContain('<Item>\\src\\</Item>')
    expect(sync).toContain('<Item>\\node_modules\\</Item>')

    const deployment = await readFile('scripts/deploy-live.mjs', 'utf8')
    expect(deployment).toContain('educator-input/obgyn-disorders.reference.diagnostics-tests-cleaned.json')
    expect(deployment).toContain("catalog/obgyn-disorders.reference.json")
  })

  it('checks origin and public OAuth before syncing a live release', async () => {
    const deployment = await readFile('scripts/deploy-live.mjs', 'utf8')

    expect(deployment.indexOf('await verifyLiveOAuthAuthorize()')).toBeGreaterThanOrEqual(0)
    expect(deployment.indexOf('await verifyLiveOAuthAuthorize()'))
      .toBeLessThan(deployment.indexOf('for (const job of batchJobs)'))
    expect(deployment.indexOf('await verifyLiveBrowserRoutes()'))
      .toBeLessThan(deployment.indexOf('for (const job of batchJobs)'))
  })
})

describe('live OAuth preflight', () => {
  it('accepts only a Google redirect with the exact registered callback', () => {
    assertGoogleOAuthRedirect(
      '302',
      'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fobgyn.eaglesvn.club%2Fauth%2Fv1%2Fcallback&state=must-not-be-logged'
    )
  })

  it('rejects the former User-Agent 403 and wrong callback without exposing OAuth state', () => {
    expect(() => assertGoogleOAuthRedirect('403', 'https://obgyn.eaglesvn.club/forbidden?state=secret'))
      .toThrow('expected HTTP 302 to Google')
    expect(() => assertGoogleOAuthRedirect(
      '302',
      'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fobgyn.eaglesvn.club%2Fauth%2Fv1%2Fcallback2&state=secret'
    )).toThrow('redirect_uri=https://obgyn.eaglesvn.club/auth/v1/callback')
  })

  it('probes local origin and public ingress with the affected curl User-Agent', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const execute = async (command: string, args: string[]) => {
      calls.push({ command, args })
      return {
        stdout: '302\nhttps://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fobgyn.eaglesvn.club%2Fauth%2Fv1%2Fcallback&state=secret'
      }
    }

    await verifyLiveOAuthAuthorize(execute)

    expect(calls).toHaveLength(2)
    expect(calls[0]?.args).toContain('obgyn.eaglesvn.club:443:127.0.0.1')
    for (const call of calls) {
      expect(call.command).toBe('curl')
      expect(call.args).toContain('curl/8.5.0')
      expect(call.args.at(-1)).toBe('https://obgyn.eaglesvn.club/auth/v1/authorize?provider=google')
    }
  })

  it('rejects browser 403s, blocked pages, console errors, and incorrect OAuth callbacks', () => {
    expect(() => assertLiveHomeResponse(403, '403 | Forbidden', false, [])).toThrow('expected the GPTpatient home page')
    expect(() => assertLiveHomeResponse(200, 'Home | GPTpatient', true, ['console'])).toThrow('console or page errors')
    expect(() => assertLiveBrowserOAuthRedirect(
      302,
      'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fobgyn.eaglesvn.club%2Fauth%2Fv1%2Fcallback2'
    )).toThrow('redirect_uri=https://obgyn.eaglesvn.club/auth/v1/callback')
    expect(() => assertLiveBrowserOAuthRedirect(403, 'https://obgyn.eaglesvn.club/forbidden'))
      .toThrow('expected HTTP 302 to Google')
    expect(() => assertLiveHomeResponse(200, 'Home | GPTpatient', true, [])).not.toThrow()
    expect(() => assertLiveBrowserOAuthRedirect(
      302,
      'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fobgyn.eaglesvn.club%2Fauth%2Fv1%2Fcallback'
    )).not.toThrow()
  })
})
