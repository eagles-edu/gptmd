import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  composeDatabaseUrl,
  composeEnvironment,
  localComposeCorsOrigins,
  localRedisPassword,
  validateComposeLogPolicy,
  validateComposeNetworkTopology
} from '../../scripts/dev-compose-config.mjs'

const redisPassword = 'AbCdEf0123456789_-AbCdEf0123456789'
const postgresSettings = {
  POSTGRES_DB: 'gptmd',
  POSTGRES_USER: 'gptmd_owner',
  POSTGRES_PASSWORD: 'db-pass_123'
}

describe('local Compose environment', () => {
  it('requires bounded Docker log retention for every local service', () => {
    const logging = { driver: 'local', options: { 'max-size': '10m', 'max-file': '3' } }
    const config = {
      services: Object.fromEntries(['postgres', 'redis', 'api', 'worker', 'web']
        .map((name) => [name, { logging }]))
    }
    expect(() => validateComposeLogPolicy(config)).not.toThrow()
    expect(() => validateComposeLogPolicy({
      services: { ...config.services, api: { logging: { ...logging, driver: 'json-file' } } }
    })).toThrow('service api must use the local log driver')
    expect(() => validateComposeLogPolicy({
      services: { ...config.services, web: { logging: { ...logging, options: { 'max-size': '10m', 'max-file': '0' } } } }
    })).toThrow('service web must retain at most three 10 MB log files')
  })

  it('keeps PostgreSQL and Redis off the app egress network and web off the data network', () => {
    const config = {
      networks: { 'gptmd-data': { internal: true }, 'gptmd-egress': {} },
      services: {
        postgres: { networks: ['gptmd-data'] },
        redis: { networks: ['gptmd-data'] },
        api: { networks: ['gptmd-data', 'gptmd-egress'] },
        worker: { networks: ['gptmd-data', 'gptmd-egress'] },
        web: { networks: ['gptmd-egress'] }
      }
    }
    expect(() => validateComposeNetworkTopology(config)).not.toThrow()
    expect(() => validateComposeNetworkTopology({
      ...config,
      networks: { ...config.networks, 'gptmd-data': { internal: false } }
    })).toThrow('internal gptmd-data network')
    expect(() => validateComposeNetworkTopology({
      ...config,
      services: { ...config.services, web: { networks: ['gptmd-data', 'gptmd-egress'] } }
    })).toThrow('service web has an invalid network assignment')
    expect(() => validateComposeNetworkTopology({
      ...config,
      services: { ...config.services, postgres: { networks: ['gptmd-data', 'gptmd-egress'] } }
    })).toThrow('service postgres has an invalid network assignment')
  })

  it('keeps local curation conversations, credentials, and non-runtime assets out of Docker build context', () => {
    const dockerIgnore = readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8')
    expect(dockerIgnore).toContain('.env')
    expect(dockerIgnore).toContain('.curatormd')
    expect(dockerIgnore).toContain('docs')
    expect(dockerIgnore).toContain('tests')
  })

  it('pins the production Node base and runs web/API targets as the unprivileged node user', () => {
    const dockerfile = readFileSync(new URL('../../ops/Dockerfile.production', import.meta.url), 'utf8')
    expect(dockerfile.match(/^FROM \$\{NODE_IMAGE\}/gm)).toHaveLength(5)
    expect(dockerfile).toContain('ARG NODE_IMAGE=node:24-bookworm-slim@sha256:')

    for (const target of ['web', 'api']) {
      const stage = dockerfile.split(` AS ${target}\n`)[1]?.split('\nFROM ')[0]
      expect(stage, `production target ${target} must exist`).toBeDefined()
      expect(stage).toContain('USER node')
    }
    expect(dockerfile).toContain('CMD ["node", ".output/server/index.mjs"]')
    expect(dockerfile).toContain('CMD ["node", "dist/server.js"]')
  })

  it('allows enough Compose stop grace for API request draining and client cleanup', () => {
    const compose = readFileSync(new URL('../../ops/dev.compose.yml', import.meta.url), 'utf8')
    const apiService = compose.split('  api:\n')[1]?.split('\n  worker:')[0]
    expect(apiService).toContain('stop_grace_period: 30s')
  })

  it('extracts only a valid authenticated Redis password without changing it', () => {
    expect(localRedisPassword(`redis://default:${redisPassword}@127.0.0.1:6379/0`)).toBe(redisPassword)
    expect(() => localRedisPassword('redis://default:too-short@127.0.0.1:6379/0'))
      .toThrow('32–128 character base64url password')
    expect(() => localRedisPassword('https://example.test/password-is-not-redis'))
      .toThrow('must use redis:// or rediss://')
  })

  it('routes the PostgreSQL URL to the Compose service only when its identity matches the container', () => {
    const databaseUrl = 'postgresql://gptmd_owner:db-pass_123@127.0.0.1:55432/gptmd?sslmode=disable'
    expect(composeDatabaseUrl(databaseUrl, postgresSettings))
      .toBe('postgresql://gptmd_owner:db-pass_123@postgres:5432/gptmd?sslmode=disable')

    for (const mismatch of [
      ['POSTGRES_USER', 'another-user'],
      ['POSTGRES_PASSWORD', 'wrong-password'],
      ['POSTGRES_DB', 'another-database']
    ] as const) {
      const settings = { ...postgresSettings, [mismatch[0]]: mismatch[1] }
      expect(() => composeDatabaseUrl(databaseUrl, settings))
        .toThrow('must match the PostgreSQL Compose settings')
    }
  })

  it('rejects database credential mismatches without including credentials in the error', () => {
    const databaseUrl = 'postgresql://gptmd_owner:private-password@127.0.0.1:5432/gptmd'
    let errorMessage = ''
    try {
      composeDatabaseUrl(databaseUrl, { ...postgresSettings, POSTGRES_PASSWORD: 'different-password' })
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    expect(errorMessage).toContain('must match the PostgreSQL Compose settings')
    expect(errorMessage).not.toContain('private-password')
    expect(errorMessage).not.toContain('different-password')
  })

  it('adds each local frontend origin once and rejects invalid ports', () => {
    expect(localComposeCorsOrigins('https://gptmd.example, http://localhost:3000', '3000'))
      .toBe('https://gptmd.example,http://localhost:3000,http://127.0.0.1:3000')
    expect(localComposeCorsOrigins(undefined, '4300'))
      .toBe('http://127.0.0.1:4300,http://localhost:4300')
    expect(() => localComposeCorsOrigins('', '70000')).toThrow('port from 1 to 65535')
  })

  it('derives a local stack environment without exposing external service hosts', () => {
    const environment = composeEnvironment({
      ...postgresSettings,
      DATABASE_URL: 'postgresql://gptmd_owner:db-pass_123@127.0.0.1:5432/gptmd',
      REDIS_URL: `redis://default:${redisPassword}@existing-redis:6379/0`,
      API_CORS_ORIGINS: 'https://gptmd.example'
    }, { GPTMD_DEV_WEB_PORT: '3100' })

    expect(environment.GPTMD_LOCAL_REDIS_PASSWORD).toBe(redisPassword)
    expect(environment.GPTMD_LOCAL_DATABASE_URL).toBe('postgresql://gptmd_owner:db-pass_123@postgres:5432/gptmd')
    expect(environment.GPTMD_LOCAL_API_CORS_ORIGINS)
      .toBe('https://gptmd.example,http://127.0.0.1:3100,http://localhost:3100')
    expect(environment.COMPOSE_PROJECT_NAME).toBe('ops')
  })
})
