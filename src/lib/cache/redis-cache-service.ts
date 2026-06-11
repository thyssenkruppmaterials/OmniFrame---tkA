// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'

/**
 * Redis Distributed Cache Service
 * High-performance distributed caching for OmniFrame enterprise RBAC system
 * Designed to handle 100,000+ concurrent users with sub-second response times
 *
 * NOTE: ioredis is a Node.js library and cannot run in the browser.
 * All methods gracefully no-op when Redis is not available (browser environment).
 * The actual Redis connection is only established server-side.
 */

// IMPORTANT: ioredis is a Node.js-only library and MUST NOT be imported
// in browser builds. All Redis functionality is gated behind _isAvailable
// which is only set to true during server-side initialize().
// In browser environments, every method returns safe defaults (null, void, etc.)
//
// The actual Redis connection is ONLY established when initialize() is called
// from a Node.js environment (e.g., SSR, server functions).

const isNodeEnvironment = typeof window === 'undefined'

// Types
interface CacheEntry<T = unknown> {
  data: T
  timestamp: number
  expires_at?: number
  version: number
  access_count: number
  tags: string[]
}

interface CacheStats {
  hits: number
  misses: number
  evictions: number
  totalRequests: number
  averageAccessTime: number
  memoryUsage: number
  entriesCount: number
  hitRate: number
}

interface RedisConfig {
  host: string
  port: number
  password?: string
  database?: string
  maxRetriesPerRequest: number
  retryDelayOnFailover: number
  enableReadyCheck: boolean
  lazyConnect: boolean
  keepAlive: number
  family: number
  reconnectOnError: (err: Error) => boolean | 1 | 2
}

export class DistributedCacheService {
  private static instance: DistributedCacheService
  private redis: {
    get: (...args: unknown[]) => Promise<unknown>
    set: (...args: unknown[]) => Promise<unknown>
    del: (...args: unknown[]) => Promise<unknown>
    sadd: (...args: unknown[]) => Promise<unknown>
    smembers: (key: string) => Promise<string[]>
    expire: (key: string, seconds: number) => Promise<unknown>
    keys: (pattern: string) => Promise<string[]>
    srem: (key: string, member: string) => Promise<unknown>
    ping: () => Promise<string>
    flushdb: () => Promise<unknown>
    quit: () => Promise<unknown>
    mget: (...keys: string[]) => Promise<(string | null)[]>
    memory: (...args: unknown[]) => Promise<unknown>
    dbsize: () => Promise<number>
    pipeline: () => {
      del: (key: string) => unknown
      srem: (key: string, member: string) => unknown
      set: (...args: unknown[]) => unknown
      sadd: (...args: unknown[]) => unknown
      expire: (key: string, seconds: number) => unknown
      exec: () => Promise<[Error | null, unknown][] | null>
    }
    on: (event: string, handler: (...args: unknown[]) => void) => void
  } | null = null
  private readOnlyRedis: {
    get: (key: string) => Promise<string | null>
    mget: (...keys: string[]) => Promise<(string | null)[]>
    on: (event: string, handler: (...args: unknown[]) => void) => void
    quit: () => Promise<unknown>
  } | null = null
  private rateLimiter: { consume: (key: string) => Promise<unknown> } | null =
    null
  private metrics: CacheStats
  private connectionAttempts = 0
  private readonly maxConnectionAttempts = 5
  private readonly DEFAULT_TTL = 300 // 5 minutes
  private readonly CACHE_VERSION = 2
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private _isAvailable = false

  private constructor() {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalRequests: 0,
      averageAccessTime: 0,
      memoryUsage: 0,
      entriesCount: 0,
      hitRate: 0,
    }
  }

  static getInstance(): DistributedCacheService {
    if (!DistributedCacheService.instance) {
      DistributedCacheService.instance = new DistributedCacheService()
    }
    return DistributedCacheService.instance
  }

  /**
   * Initialize Redis connection with enterprise configuration
   */
  /** Returns true if Redis is available (Node.js environment with ioredis loaded) */
  get isAvailable(): boolean {
    return this._isAvailable
  }

  async initialize(): Promise<void> {
    // Skip initialization in browser environments
    if (!isNodeEnvironment) {
      logger.log(
        '📦 Redis cache disabled (browser environment) - using local cache fallback'
      )
      return
    }

    try {
      // Dynamic import of ioredis — only in Node.js, never bundled for browser
      const [ioredisModule, rateLimiterModule] = await Promise.all([
        import('ioredis'),
        import('rate-limiter-flexible'),
      ])
      const RedisClient = ioredisModule.default
      const RateLimiterRedisClass = rateLimiterModule.RateLimiterRedis

      logger.log('🚀 Initializing Redis distributed cache service...')

      const sharedConfig = (
        await import('@/lib/infra/redis-config')
      ).getRedisConfig()
      const config: RedisConfig = {
        ...sharedConfig,
        reconnectOnError: (err: Error) => {
          const targetError = 'READONLY'
          return err.message.includes(targetError) ? 2 : 1
        },
      }

      // Primary Redis connection for reads and writes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.redis = new RedisClient(config) as any

      // Read-only Redis connection for load balancing
      this.readOnlyRedis = new RedisClient({
        ...config,
        readOnly: true,
      })

      // Set up event listeners
      this.setupEventListeners()

      // Initialize rate limiter
      this.rateLimiter = new RateLimiterRedisClass({
        storeClient: this.redis,
        keyPrefix: 'rl:cache',
        points: 1000, // Number of requests
        duration: 1, // Per second
        blockDuration: 10, // Block for 10 seconds
        execEvenly: true,
      })

      // Test connection
      await this.testConnection()

      // Start health monitoring
      this.startHealthMonitoring()

      // Connection established
      this._isAvailable = true
      logger.log('✅ Redis distributed cache service initialized successfully')
    } catch (error) {
      logger.error('❌ Failed to initialize Redis cache service:', error)
      this._isAvailable = false
    }
  }

  /**
   * Guard: returns true if Redis is NOT available (browser or not initialized).
   * All public methods should call this and return early if true.
   */
  private get notAvailable(): boolean {
    return !this._isAvailable || !this.redis
  }

  /**
   * Get cached permissions for a user
   */
  async getPermissions(userId: string): Promise<string[] | null> {
    if (this.notAvailable || !this.redis || !this.rateLimiter) return null
    const startTime = Date.now()
    this.metrics.totalRequests++

    try {
      // Rate limiting check
      try {
        await this.rateLimiter.consume(userId)
      } catch {
        logger.warn(`Rate limit exceeded for user ${userId}`)
        return null
      }

      const key = `perms:${userId}`
      const cachedData = await this.readOnlyRedis?.get(key)

      if (!cachedData) {
        this.metrics.misses++
        return null
      }

      const entry: CacheEntry<string[]> = JSON.parse(cachedData)

      // Check version compatibility
      if (entry.version !== this.CACHE_VERSION) {
        await this.redis.del(key)
        this.metrics.misses++
        return null
      }

      // Check expiration
      if (entry.expires_at && Date.now() > entry.expires_at) {
        await this.redis.del(key)
        this.metrics.misses++
        return null
      }

      // Update access statistics
      entry.access_count++
      const updatedEntry = { ...entry, access_count: entry.access_count }
      await this.redis.set(
        key,
        JSON.stringify(updatedEntry),
        'EX',
        this.DEFAULT_TTL
      )

      this.metrics.hits++
      this.updateMetrics(Date.now() - startTime)

      return entry.data
    } catch (error) {
      logger.error('Redis get error:', error)
      this.metrics.misses++
      return null
    }
  }

  /**
   * Cache user permissions with TTL and tagging
   */
  async setPermissions(
    userId: string,
    permissions: string[],
    ttl = this.DEFAULT_TTL,
    tags: string[] = []
  ): Promise<void> {
    if (this.notAvailable || !this.redis) return
    try {
      const key = `perms:${userId}`
      const entry: CacheEntry<string[]> = {
        data: permissions,
        timestamp: Date.now(),
        expires_at: Date.now() + ttl * 1000,
        version: this.CACHE_VERSION,
        access_count: 0,
        tags: [`user:${userId}`, 'permissions', ...tags],
      }

      // Set main entry
      await this.redis.set(key, JSON.stringify(entry), 'EX', ttl)

      // Add to invalidation sets for bulk operations
      await this.redis.sadd(`perm_users`, userId)

      // Add to tag sets for targeted invalidation
      for (const tag of entry.tags) {
        await this.redis.sadd(`tag:${tag}`, key)
        await this.redis.expire(`tag:${tag}`, ttl * 2) // Keep tags longer than data
      }

      logger.log(
        `✅ Cached permissions for user ${userId}: ${permissions.length} permissions`
      )
    } catch (error) {
      logger.error('Redis set error:', error)
      throw error
    }
  }

  /**
   * Get cached navigation permissions
   */
  async getNavigationPermissions(
    userId: string,
    role?: string
  ): Promise<unknown[] | null> {
    if (this.notAvailable || !this.redis) return null
    const startTime = Date.now()
    this.metrics.totalRequests++

    try {
      const key = `nav:${userId}:${role || 'default'}`
      const cachedData = await this.readOnlyRedis?.get(key)

      if (!cachedData) {
        this.metrics.misses++
        return null
      }

      const entry: CacheEntry<unknown[]> = JSON.parse(cachedData)

      if (
        entry.version !== this.CACHE_VERSION ||
        (entry.expires_at && Date.now() > entry.expires_at)
      ) {
        await this.redis.del(key)
        this.metrics.misses++
        return null
      }

      this.metrics.hits++
      this.updateMetrics(Date.now() - startTime)

      return entry.data
    } catch (error) {
      logger.error('Redis navigation get error:', error)
      this.metrics.misses++
      return null
    }
  }

  /**
   * Cache navigation permissions
   */
  async setNavigationPermissions(
    userId: string,
    role: string,
    permissions: unknown[],
    ttl = this.DEFAULT_TTL * 2
  ): Promise<void> {
    if (this.notAvailable || !this.redis) return
    try {
      const key = `nav:${userId}:${role}`
      const entry: CacheEntry<unknown[]> = {
        data: permissions,
        timestamp: Date.now(),
        expires_at: Date.now() + ttl * 1000,
        version: this.CACHE_VERSION,
        access_count: 0,
        tags: [`user:${userId}`, `role:${role}`, 'navigation'],
      }

      await this.redis.set(key, JSON.stringify(entry), 'EX', ttl)

      // Add to tag sets
      for (const tag of entry.tags) {
        await this.redis.sadd(`tag:${tag}`, key)
        await this.redis.expire(`tag:${tag}`, ttl * 2)
      }

      logger.log(
        `✅ Cached navigation permissions for user ${userId}, role ${role}`
      )
    } catch (error) {
      logger.error('Redis navigation set error:', error)
      throw error
    }
  }

  /**
   * Get cached tab permissions
   */
  async getTabPermissions(
    userId: string,
    pageResource?: string
  ): Promise<unknown[] | null> {
    if (this.notAvailable || !this.redis) return null
    const startTime = Date.now()
    this.metrics.totalRequests++

    try {
      const key = `tabs:${userId}:${pageResource || 'all'}`
      const cachedData = await this.readOnlyRedis?.get(key)

      if (!cachedData) {
        this.metrics.misses++
        return null
      }

      const entry: CacheEntry<unknown[]> = JSON.parse(cachedData)

      if (
        entry.version !== this.CACHE_VERSION ||
        (entry.expires_at && Date.now() > entry.expires_at)
      ) {
        await this.redis.del(key)
        this.metrics.misses++
        return null
      }

      this.metrics.hits++
      this.updateMetrics(Date.now() - startTime)

      return entry.data
    } catch (error) {
      logger.error('Redis tab permissions get error:', error)
      this.metrics.misses++
      return null
    }
  }

  /**
   * Cache tab permissions
   */
  async setTabPermissions(
    userId: string,
    pageResource: string,
    permissions: unknown[],
    ttl = this.DEFAULT_TTL
  ): Promise<void> {
    if (this.notAvailable || !this.redis) return
    try {
      const key = `tabs:${userId}:${pageResource}`
      const entry: CacheEntry<unknown[]> = {
        data: permissions,
        timestamp: Date.now(),
        expires_at: Date.now() + ttl * 1000,
        version: this.CACHE_VERSION,
        access_count: 0,
        tags: [`user:${userId}`, `tabs:${pageResource}`, 'tab_permissions'],
      }

      await this.redis.set(key, JSON.stringify(entry), 'EX', ttl)

      for (const tag of entry.tags) {
        await this.redis.sadd(`tag:${tag}`, key)
        await this.redis.expire(`tag:${tag}`, ttl * 2)
      }

      logger.log(
        `✅ Cached tab permissions for user ${userId}, page ${pageResource}`
      )
    } catch (error) {
      logger.error('Redis tab permissions set error:', error)
      throw error
    }
  }

  /**
   * Invalidate all permissions for a user
   */
  async invalidateUserPermissions(userId: string): Promise<void> {
    if (this.notAvailable || !this.redis) return
    try {
      const patterns = [
        `perms:${userId}`,
        `nav:${userId}:*`,
        `tabs:${userId}:*`,
        `role:${userId}`,
      ]

      const pipeline = this.redis.pipeline()

      for (const pattern of patterns) {
        if (pattern.includes('*')) {
          // For wildcard patterns, we need to find matching keys
          const keys = await this.redis.keys(pattern)
          keys.forEach((key: string) => pipeline.del(key))
        } else {
          pipeline.del(pattern)
        }
      }

      // Remove from user tracking set
      pipeline.srem('perm_users', userId)

      const results = await pipeline.exec()
      const deletedCount =
        results?.reduce(
          (count: number, [err, result]: [Error | null, unknown]) => {
            return err ? count : count + (result as number)
          },
          0
        ) || 0

      logger.log(
        `🧹 Invalidated ${deletedCount} cache entries for user ${userId}`
      )
    } catch (error) {
      logger.error('Redis user invalidation error:', error)
      throw error
    }
  }

  /**
   * Bulk invalidation for role changes
   */
  async invalidateRolePermissions(roleId: string): Promise<void> {
    if (this.notAvailable || !this.redis) return
    try {
      // Get all users with this role
      const userKeys = await this.redis.smembers(`role_users:${roleId}`)

      if (userKeys.length === 0) {
        logger.log(`No users found for role ${roleId} to invalidate`)
        return
      }

      const pipeline = this.redis.pipeline()

      userKeys.forEach((userId: string) => {
        pipeline.del(`perms:${userId}`)
        pipeline.del(`nav:${userId}:*`)
        pipeline.del(`tabs:${userId}:*`)
      })

      const results = await pipeline.exec()
      const deletedCount = results?.length || 0

      logger.log(
        `🧹 Invalidated ${deletedCount} cache entries for role ${roleId}`
      )
    } catch (error) {
      logger.error('Redis role invalidation error:', error)
      throw error
    }
  }

  /**
   * Invalidate by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    if (this.notAvailable || !this.redis) return 0
    try {
      let totalDeleted = 0

      for (const tag of tags) {
        const keys = await this.redis.smembers(`tag:${tag}`)
        if (keys.length > 0) {
          const deleted = (await this.redis.del(...keys)) as number
          totalDeleted += deleted
          // Clean up the tag set
          await this.redis.del(`tag:${tag}`)
        }
      }

      logger.log(`🧹 Invalidated ${totalDeleted} cache entries by tags:`, tags)
      return totalDeleted
    } catch (error) {
      logger.error('Redis tag invalidation error:', error)
      return 0
    }
  }

  /**
   * Batch operations for high performance
   */
  async batchGet<T>(keys: string[]): Promise<(T | null)[]> {
    if (this.notAvailable || !this.redis) return keys.map(() => null)
    try {
      if (keys.length === 0) return []

      const results = await this.readOnlyRedis?.mget(...keys)
      if (!results) return keys.map(() => null)

      return results.map((result: string | null) => {
        if (!result) return null
        try {
          const entry: CacheEntry<T> = JSON.parse(result)
          if (entry.expires_at && Date.now() > entry.expires_at) {
            return null
          }
          return entry.data
        } catch {
          return null
        }
      })
    } catch (error) {
      logger.error('Redis batch get error:', error)
      return new Array(keys.length).fill(null)
    }
  }

  /**
   * Batch set operations
   */
  async batchSet<T>(
    entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>
  ): Promise<void> {
    if (this.notAvailable || !this.redis) return
    try {
      if (entries.length === 0) return

      const pipeline = this.redis.pipeline()

      for (const { key, value, ttl = this.DEFAULT_TTL, tags = [] } of entries) {
        const entry: CacheEntry<T> = {
          data: value,
          timestamp: Date.now(),
          expires_at: Date.now() + ttl * 1000,
          version: this.CACHE_VERSION,
          access_count: 0,
          tags,
        }

        pipeline.set(key, JSON.stringify(entry), 'EX', ttl)

        // Add to tag sets
        for (const tag of tags) {
          pipeline.sadd(`tag:${tag}`, key)
          pipeline.expire(`tag:${tag}`, ttl * 2)
        }
      }

      await pipeline.exec()
      logger.log(`✅ Batch set ${entries.length} cache entries`)
    } catch (error) {
      logger.error('Redis batch set error:', error)
      throw error
    }
  }

  /**
   * Cache warming - preload frequently accessed data
   */
  async warmCache(
    entries: Array<{ key: string; value: unknown; priority: number }>
  ): Promise<void> {
    try {
      // Sort by priority and warm cache
      const sortedEntries = entries
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 1000) // Limit to top 1000 entries

      const batchEntries = sortedEntries.map(({ key, value }) => ({
        key,
        value,
        ttl: this.DEFAULT_TTL * 3, // Longer TTL for warmed data
        tags: ['warmed'],
      }))

      await this.batchSet(batchEntries)
      logger.log(
        `🔥 Warmed cache with ${sortedEntries.length} high-priority entries`
      )
    } catch (error) {
      logger.error('Cache warming error:', error)
    }
  }

  /**
   * Get comprehensive cache statistics
   */
  async getStats(): Promise<CacheStats> {
    if (this.notAvailable || !this.redis) return this.metrics
    try {
      // Get Redis memory info
      const info = await this.redis.memory('STATS')
      const keyCount = await this.redis.dbsize()

      return {
        ...this.metrics,
        memoryUsage: typeof info === 'number' ? info : 0,
        entriesCount: keyCount,
        hitRate:
          this.metrics.totalRequests > 0
            ? this.metrics.hits / this.metrics.totalRequests
            : 0,
      }
    } catch (error) {
      logger.error('Redis stats error:', error)
      return this.metrics
    }
  }

  /**
   * Health check for Redis connectivity
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'warning' | 'critical'
    message: string
    details: Record<string, unknown>
  }> {
    if (this.notAvailable || !this.redis)
      return {
        status: 'warning' as const,
        message: 'Redis not available (browser environment)',
        details: {},
      }
    try {
      const start = Date.now()
      await this.redis.ping()
      const latency = Date.now() - start

      const stats = await this.getStats()

      if (latency > 100) {
        return {
          status: 'warning',
          message: 'High Redis latency',
          details: { latency, ...stats },
        }
      }

      if (stats.hitRate < 0.8) {
        return {
          status: 'warning',
          message: 'Low cache hit rate',
          details: { ...stats },
        }
      }

      return {
        status: 'healthy',
        message: 'Redis cache operating normally',
        details: { latency, ...stats },
      }
    } catch (error) {
      return {
        status: 'critical',
        message: 'Redis connection failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }
    }
  }

  /**
   * Clear entire cache (use with caution)
   */
  async clearAll(): Promise<void> {
    if (this.notAvailable || !this.redis) return
    try {
      await this.redis.flushdb()
      logger.log('🧹 Cleared entire Redis cache')
    } catch (error) {
      logger.error('Redis clear error:', error)
      throw error
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.notAvailable || !this.redis) return
    try {
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval)
      }

      await this.redis.quit()
      await this.readOnlyRedis?.quit()

      // Connection closed
      logger.log('✅ Redis cache service shut down gracefully')
    } catch (error) {
      logger.error('Redis shutdown error:', error)
    }
  }

  private async testConnection(): Promise<void> {
    if (this.notAvailable || !this.redis) return
    try {
      const response = await this.redis.ping()
      if (response !== 'PONG') {
        throw new Error('Redis ping failed')
      }

      // Test write/read operations
      const testKey = `health:${Date.now()}`
      await this.redis.set(testKey, 'test', 'EX', 10)
      const testValue = await this.redis.get(testKey)
      await this.redis.del(testKey)

      if (testValue !== 'test') {
        throw new Error('Redis read/write test failed')
      }

      logger.log('✅ Redis connection test passed')
    } catch (error) {
      throw new Error(
        `Redis connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  private setupEventListeners(): void {
    if (this.notAvailable || !this.redis || !this.readOnlyRedis) return
    this.redis.on('connect', () => {
      logger.log('🔗 Redis primary connection established')
      this.connectionAttempts = 0
    })

    this.redis.on('ready', () => {
      logger.log('✅ Redis primary connection ready')
    })

    this.redis.on('error', (err: unknown) => {
      logger.error(
        '❌ Redis primary connection error:',
        err instanceof Error ? err.message : String(err)
      )
      this.connectionAttempts++

      if (this.connectionAttempts >= this.maxConnectionAttempts) {
        logger.error('💥 Maximum Redis connection attempts reached')
        // Connection closed
      }
    })

    this.redis.on('close', () => {
      logger.warn('⚠️ Redis primary connection closed')
      // Connection closed
    })

    this.redis.on('reconnecting', () => {
      logger.log('🔄 Redis primary connection reconnecting...')
    })

    // Read-only connection events
    this.readOnlyRedis.on('connect', () => {
      logger.log('🔗 Redis read-only connection established')
    })

    this.readOnlyRedis.on('error', (err: unknown) => {
      logger.error(
        '❌ Redis read-only connection error:',
        err instanceof Error ? err.message : String(err)
      )
    })
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.healthCheck()
        if (health.status === 'critical') {
          logger.error('🚨 Redis cache health check failed:', health.message)
        }
      } catch (error) {
        logger.error('Health check error:', error)
      }
    }, 30000) // Check every 30 seconds
  }

  private updateMetrics(responseTime: number): void {
    this.metrics.averageAccessTime =
      (this.metrics.averageAccessTime + responseTime) / 2
  }
}

// Export singleton instance
export const distributedCacheService = DistributedCacheService.getInstance()

// Export types
export type { CacheEntry, CacheStats, RedisConfig }

// Created and developed by Jai Singh
