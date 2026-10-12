const LOCAL_PORT_PATTERN = /^\d{1,5}$/
const LOCAL_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/

export function localRedisPassword(redisUrl) {
  let parsed
  try {
    parsed = new URL(redisUrl)
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL for the local Compose stack.')
  }

  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss:// for the local Compose stack.')
  }

  let password
  try {
    password = decodeURIComponent(parsed.password)
  } catch {
    throw new Error('REDIS_URL must contain a valid URL-encoded password for the local Compose stack.')
  }

  if (!LOCAL_SECRET_PATTERN.test(password)) {
    throw new Error('REDIS_URL must contain a 32–128 character base64url password for the authenticated local Compose Redis.')
  }

  return password
}

export function composeDatabaseUrl(databaseUrl, postgresSettings = {}) {
  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL for the local Compose stack.')
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.username || !parsed.password || !parsed.pathname.slice(1)) {
    throw new Error('DATABASE_URL must include PostgreSQL credentials and a database name for the local Compose stack.')
  }

  let databaseUser
  let databasePassword
  let databaseName
  try {
    databaseUser = decodeURIComponent(parsed.username)
    databasePassword = decodeURIComponent(parsed.password)
    databaseName = decodeURIComponent(parsed.pathname.slice(1))
  } catch {
    throw new Error('DATABASE_URL must contain valid URL-encoded PostgreSQL credentials and database name.')
  }

  const expected = {
    databaseUser: postgresSettings.POSTGRES_USER,
    databasePassword: postgresSettings.POSTGRES_PASSWORD,
    databaseName: postgresSettings.POSTGRES_DB
  }
  if (Object.values(expected).some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD must be configured for the local Compose stack.')
  }
  if (databaseUser !== expected.databaseUser || databasePassword !== expected.databasePassword || databaseName !== expected.databaseName) {
    throw new Error('DATABASE_URL credentials and database name must match the PostgreSQL Compose settings.')
  }

  parsed.hostname = 'postgres'
  parsed.port = '5432'
  return parsed.toString()
}

export function localComposeCorsOrigins(configuredOrigins, webPort) {
  const normalizedPort = String(webPort)
  if (!LOCAL_PORT_PATTERN.test(normalizedPort) || Number(normalizedPort) < 1 || Number(normalizedPort) > 65535) {
    throw new Error('GPTMD_DEV_WEB_PORT must be a port from 1 to 65535.')
  }

  const origins = (configuredOrigins ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  origins.push(`http://127.0.0.1:${normalizedPort}`, `http://localhost:${normalizedPort}`)
  return [...new Set(origins)].join(',')
}

export function composeEnvironment(localEnv, processEnv = process.env) {
  const webPort = processEnv.GPTMD_DEV_WEB_PORT || '3000'
  return {
    GPTMD_LOCAL_REDIS_PASSWORD: localRedisPassword(localEnv.REDIS_URL ?? ''),
    GPTMD_LOCAL_DATABASE_URL: composeDatabaseUrl(localEnv.DATABASE_URL ?? '', localEnv),
    GPTMD_LOCAL_API_CORS_ORIGINS: localComposeCorsOrigins(localEnv.API_CORS_ORIGINS, webPort),
    COMPOSE_PROJECT_NAME: processEnv.COMPOSE_PROJECT_NAME || 'ops'
  }
}

export function validateComposeNetworkTopology(config) {
  const services = config?.services
  const networks = config?.networks
  if (!services || !networks) throw new Error('Local Compose config must define services and isolated networks.')
  if (networks['gptmd-data']?.internal !== true) {
    throw new Error('Local PostgreSQL and Redis must use the internal gptmd-data network.')
  }

  const serviceNetworks = (serviceName) => {
    const assigned = services[serviceName]?.networks
    if (Array.isArray(assigned)) return assigned
    if (assigned && typeof assigned === 'object') return Object.keys(assigned)
    return []
  }
  const expected = {
    postgres: ['gptmd-data'],
    redis: ['gptmd-data'],
    api: ['gptmd-data', 'gptmd-egress'],
    worker: ['gptmd-data', 'gptmd-egress'],
    web: ['gptmd-egress']
  }

  for (const [serviceName, expectedNetworks] of Object.entries(expected)) {
    const actualNetworks = serviceNetworks(serviceName).sort()
    if (JSON.stringify(actualNetworks) !== JSON.stringify([...expectedNetworks].sort())) {
      throw new Error(`Local Compose service ${serviceName} has an invalid network assignment.`)
    }
  }
  if (!networks['gptmd-egress']) throw new Error('Local Compose config must define the gptmd-egress network.')
}

export function validateComposeLogPolicy(config) {
  const services = config?.services
  if (!services) throw new Error('Local Compose config must define services with a bounded log policy.')

  for (const serviceName of ['postgres', 'redis', 'api', 'worker', 'web']) {
    const logging = services[serviceName]?.logging
    if (logging?.driver !== 'local') {
      throw new Error(`Local Compose service ${serviceName} must use the local log driver.`)
    }
    if (logging.options?.['max-size'] !== '10m' || logging.options?.['max-file'] !== '3') {
      throw new Error(`Local Compose service ${serviceName} must retain at most three 10 MB log files.`)
    }
  }
}
