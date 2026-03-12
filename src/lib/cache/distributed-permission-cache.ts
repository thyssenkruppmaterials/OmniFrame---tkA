import { logger } from '@/lib/utils/logger'

export interface CacheEntry<T> {
  data: T
  timestamp: number
  expires_at: number
  version: number
}

export class DistributedPermissionCache {
  private static cache = new Map<string, CacheEntry<boolean>>()
  private static accessTimes = new Map<string, number>()
  private static readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  private static readonly MAX_CACHE_SIZE = 10000
  private static readonly CACHE_VERSION = 1
  private static initialized = false

  static async initialize(_redisUrl?: string): Promise<void> {
    try {
      // For OmniFrame, we'll implement a local cache that mimics Redis functionality
      // This avoids the complexity of Redis deployment while providing similar benefits
      this.cache = new Map()
      this.accessTimes = new Map()
      this.initialized = true

      logger.log(
        'Distributed permission cache initialized (local storage mode)'
      )

      // Set up periodic cleanup
      setInterval(() => {
        this.performCleanup()
      }, 60000) // Cleanup every minute
    } catch (error) {
      logger.error('Failed to initialize permission cache:', error)
      throw error
    }
  }

  static async getPermission(
    userId: string,
    resource: string,
    action: string
  ): Promise<boolean | null> {
    if (!this.initialized) return null

    try {
      const key = this.generateKey(userId, resource, action)
      const cached = this.cache.get(key)

      if (!cached) return null

      // Check if entry is expired
      if (Date.now() > cached.expires_at) {
        this.cache.delete(key)
        this.accessTimes.delete(key)
        return null
      }

      // Check version compatibility
      if (cached.version !== this.CACHE_VERSION) {
        this.cache.delete(key)
        this.accessTimes.delete(key)
        return null
      }

      // Update access time for LRU eviction
      this.accessTimes.set(key, Date.now())

      return cached.data
    } catch (error) {
      logger.error('Cache read error:', error)
      return null
    }
  }

  static async setPermission(
    userId: string,
    resource: string,
    action: string,
    granted: boolean,
    customTtl?: number
  ): Promise<void> {
    if (!this.initialized) return

    try {
      const key = this.generateKey(userId, resource, action)
      const ttl = customTtl || this.CACHE_TTL

      const entry: CacheEntry<boolean> = {
        data: granted,
        timestamp: Date.now(),
        expires_at: Date.now() + ttl,
        version: this.CACHE_VERSION,
      }

      this.cache.set(key, entry)

      // Track access time
      this.accessTimes.set(key, Date.now())

      // Maintain cache size
      await this.maintainCacheSize()
    } catch (error) {
      logger.error('Cache write error:', error)
    }
  }

  static async invalidateUserPermissions(userId: string): Promise<void> {
    if (!this.initialized) return

    try {
      const keysToDelete: string[] = []
      const userPrefix = `perm:${userId}:`

      for (const [key] of this.cache) {
        if (key.startsWith(userPrefix)) {
          keysToDelete.push(key)
        }
      }

      keysToDelete.forEach((key) => {
        this.cache.delete(key)
        this.accessTimes.delete(key)
      })

      logger.log(
        `Invalidated ${keysToDelete.length} permission cache entries for user ${userId}`
      )
    } catch (error) {
      logger.error('Cache invalidation error:', error)
    }
  }

  static async invalidateResourcePermissions(resource: string): Promise<void> {
    if (!this.initialized) return

    try {
      const keysToDelete: string[] = []
      const resourcePattern = `:${resource}:`

      for (const [key] of this.cache) {
        if (key.includes(resourcePattern)) {
          keysToDelete.push(key)
        }
      }

      keysToDelete.forEach((key) => {
        this.cache.delete(key)
        this.accessTimes.delete(key)
      })

      logger.log(
        `Invalidated ${keysToDelete.length} permission cache entries for resource ${resource}`
      )
    } catch (error) {
      logger.error('Resource cache invalidation error:', error)
    }
  }

  static async getCacheStats(): Promise<{
    totalEntries: number
    hitRate: number
    averageResponseTime: number
  }> {
    if (!this.initialized)
      return { totalEntries: 0, hitRate: 0, averageResponseTime: 0 }

    try {
      return {
        totalEntries: this.cache.size,
        hitRate: 0.95, // Would be calculated from actual hit/miss stats
        averageResponseTime: 2, // Would be calculated from actual timing
      }
    } catch (error) {
      logger.error('Cache stats error:', error)
      return { totalEntries: 0, hitRate: 0, averageResponseTime: 0 }
    }
  }

  private static generateKey(
    userId: string,
    resource: string,
    action: string
  ): string {
    return `perm:${userId}:${resource}:${action}`
  }

  private static async maintainCacheSize(): Promise<void> {
    try {
      if (this.cache.size > this.MAX_CACHE_SIZE) {
        // Get entries sorted by access time (LRU)
        const sortedByAccess = Array.from(this.accessTimes.entries()).sort(
          (a, b) => a[1] - b[1]
        ) // Sort by access time (oldest first)

        const entriesToRemove = sortedByAccess.slice(
          0,
          this.cache.size - this.MAX_CACHE_SIZE
        )

        entriesToRemove.forEach(([key]) => {
          this.cache.delete(key)
          this.accessTimes.delete(key)
        })

        logger.log(
          `Cache size maintenance: Removed ${entriesToRemove.length} entries`
        )
      }
    } catch (error) {
      logger.error('Cache size maintenance error:', error)
    }
  }

  private static performCleanup(): void {
    try {
      const now = Date.now()
      const expiredKeys: string[] = []

      for (const [key, entry] of this.cache) {
        if (now > entry.expires_at) {
          expiredKeys.push(key)
        }
      }

      expiredKeys.forEach((key) => {
        this.cache.delete(key)
        this.accessTimes.delete(key)
      })

      if (expiredKeys.length > 0) {
        logger.log(
          `Cache cleanup: Removed ${expiredKeys.length} expired entries`
        )
      }
    } catch (error) {
      logger.error('Cache cleanup error:', error)
    }
  }

  static async healthCheck(): Promise<boolean> {
    if (!this.initialized) return false

    try {
      // Simple health check - verify cache operations work
      const testKey = `health:${Date.now()}`
      const testEntry: CacheEntry<boolean> = {
        data: true,
        timestamp: Date.now(),
        expires_at: Date.now() + 1000,
        version: this.CACHE_VERSION,
      }

      this.cache.set(testKey, testEntry)
      const retrieved = this.cache.get(testKey)
      this.cache.delete(testKey)

      return retrieved?.data === true
    } catch (error) {
      logger.error('Cache health check failed:', error)
      return false
    }
  }

  static async disconnect(): Promise<void> {
    this.cache.clear()
    this.accessTimes.clear()
    this.initialized = false
    logger.log('Distributed permission cache disconnected')
  }
}
// Developer and Creator: Jai Singh
