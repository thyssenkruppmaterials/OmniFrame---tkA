// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'

export interface RedisConnectionConfig {
  host: string
  port: number
  password?: string
  database?: string
  maxRetriesPerRequest: number
  retryDelayOnFailover: number
  enableReadyCheck: boolean
  lazyConnect: boolean
  keepAlive: number
  family: 4 | 6
}

function parseRedisUrl(url: string): Partial<RedisConnectionConfig> {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 6379,
      password: parsed.password || undefined,
      database: parsed.pathname?.slice(1) || undefined,
    }
  } catch {
    logger.warn('Invalid REDIS_URL format, falling back to discrete env vars')
    return {}
  }
}

const isTestEnv =
  typeof process !== 'undefined' &&
  (process.env.NODE_ENV === 'test' || process.env.TESTING === 'true')

/**
 * Resolves Redis connection config with explicit precedence:
 *  1. REDIS_URL (full connection string)
 *  2. REDIS_HOST + REDIS_PORT + REDIS_PASSWORD (discrete env vars)
 *  3. localhost:6379 fallback (local dev only)
 */
export function getRedisConfig(): RedisConnectionConfig {
  const env =
    typeof process !== 'undefined'
      ? process.env
      : ({} as Record<string, string | undefined>)

  const urlConfig = env.REDIS_URL ? parseRedisUrl(env.REDIS_URL) : {}

  const host = urlConfig.host || env.REDIS_HOST || 'localhost'
  const port = urlConfig.port || parseInt(env.REDIS_PORT || '6379', 10)
  const password = urlConfig.password || env.REDIS_PASSWORD || undefined
  const database = urlConfig.database || env.REDIS_DATABASE || undefined

  if (!env.REDIS_URL && !env.REDIS_HOST) {
    logger.warn(
      'Redis config: No REDIS_URL or REDIS_HOST set — using localhost:6379 (local dev fallback)'
    )
  }

  return {
    host,
    port,
    password,
    database,
    maxRetriesPerRequest: isTestEnv ? 1 : 3,
    retryDelayOnFailover: isTestEnv ? 50 : 100,
    enableReadyCheck: true,
    lazyConnect: true,
    keepAlive: 30000,
    family: 4,
  }
}

// Created and developed by Jai Singh
