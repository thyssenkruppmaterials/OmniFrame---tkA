// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'

/**
 * Unified Authentication Cache
 * Provides centralized caching for all auth-related data with TTL and LRU eviction
 */

interface CacheEntry<T = unknown> {
  data: T
  timestamp: number
  expires_at: number
  access_count: number
  last_accessed: number
  key: string
  tags: string[]
}

interface CacheConfig {
  maxEntries: number
  defaultTTL: number
  enableCompression?: boolean
  enableMetrics?: boolean
}

interface CacheMetrics {
  hits: number
  misses: number
  evictions: number
  totalRequests: number
  averageAccessTime: number
  memoryUsage: number
  entriesCount: number
}

export class AuthCache {
  private static instance: AuthCache
  private cache = new Map<string, CacheEntry>()
  private config: CacheConfig
  private metrics: CacheMetrics
  private cleanupInterval: NodeJS.Timeout | null = null
  private keyToTags = new Map<string, Set<string>>()
  private tagToKeys = new Map<string, Set<string>>()

  private constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxEntries: 2000, // 🔧 PERFORMANCE FIX: Increased for high-permission users (173 permissions)
      defaultTTL: 5 * 60 * 1000, // 5 minutes
      enableCompression: false,
      enableMetrics: true,
      ...config,
    }

    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalRequests: 0,
      averageAccessTime: 0,
      memoryUsage: 0,
      entriesCount: 0,
    }

    // Start cleanup interval
    this.startCleanupInterval()
  }

  static getInstance(config?: Partial<CacheConfig>): AuthCache {
    if (!AuthCache.instance) {
      AuthCache.instance = new AuthCache(config)
    }
    return AuthCache.instance
  }

  /**
   * Get value from cache with TTL check and metrics
   */
  get<T>(key: string): T | null {
    const startTime = Date.now()
    this.metrics.totalRequests++

    const entry = this.cache.get(key)

    if (!entry) {
      this.metrics.misses++
      return null
    }

    // Check if expired
    if (Date.now() > entry.expires_at) {
      this.delete(key)
      this.metrics.misses++
      return null
    }

    // Update access statistics
    entry.access_count++
    entry.last_accessed = Date.now()

    // Update metrics
    this.metrics.hits++
    this.metrics.averageAccessTime =
      (this.metrics.averageAccessTime + (Date.now() - startTime)) / 2

    return entry.data as T
  }

  /**
   * Set value in cache with TTL and tags
   */
  set<T>(
    key: string,
    value: T,
    ttl: number = this.config.defaultTTL,
    tags: string[] = []
  ): void {
    // Check if we need to evict entries
    if (this.cache.size >= this.config.maxEntries) {
      this.evictLRU()
    }

    const entry: CacheEntry<T> = {
      data: value,
      timestamp: Date.now(),
      expires_at: Date.now() + ttl,
      access_count: 0,
      last_accessed: Date.now(),
      key,
      tags,
    }

    this.cache.set(key, entry)
    this.metrics.entriesCount = this.cache.size

    // Update tag mappings
    this.updateTags(key, tags)
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    // Remove from tag mappings
    this.removeTags(key, entry.tags)

    this.cache.delete(key)
    this.metrics.entriesCount = this.cache.size
    return true
  }

  /**
   * Invalidate entries by tags
   */
  invalidateByTags(tags: string[]): number {
    let invalidatedCount = 0

    for (const tag of tags) {
      const keys = this.tagToKeys.get(tag)
      if (keys) {
        for (const key of keys) {
          if (this.delete(key)) {
            invalidatedCount++
          }
        }
      }
    }

    return invalidatedCount
  }

  /**
   * Invalidate all entries for a user
   */
  invalidateUser(userId: string): number {
    const userTags = [
      `user:${userId}`,
      `permissions:${userId}`,
      `roles:${userId}`,
    ]
    return this.invalidateByTags(userTags)
  }

  /**
   * Invalidate all entries for a role
   */
  invalidateRole(roleId: string): number {
    const roleTags = [`role:${roleId}`, `permissions:role:${roleId}`]
    return this.invalidateByTags(roleTags)
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear()
    this.keyToTags.clear()
    this.tagToKeys.clear()
    this.metrics.entriesCount = 0
    this.metrics.evictions = 0
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheMetrics & {
    hitRate: number
    entriesByTag: Record<string, number>
  } {
    const hitRate =
      this.metrics.totalRequests > 0
        ? this.metrics.hits / this.metrics.totalRequests
        : 0

    // Count entries by tag
    const entriesByTag: Record<string, number> = {}
    for (const [tag, keys] of this.tagToKeys.entries()) {
      entriesByTag[tag] = keys.size
    }

    return {
      ...this.metrics,
      hitRate,
      entriesByTag,
    }
  }

  /**
   * Get all cache keys
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    return entry !== undefined && Date.now() <= entry.expires_at
  }

  /**
   * Get cache entry metadata
   */
  getMetadata(key: string): Omit<CacheEntry, 'data'> | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    const { data, ...metadata } = entry
    return metadata
  }

  /**
   * Extend TTL for a key
   */
  extendTTL(key: string, additionalTTL: number): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    entry.expires_at = Math.max(entry.expires_at, Date.now() + additionalTTL)
    return true
  }

  /**
   * Batch operations for performance
   */
  batchSet(
    entries: Array<{
      key: string
      value: unknown
      ttl?: number
      tags?: string[]
    }>
  ): void {
    for (const { key, value, ttl, tags } of entries) {
      this.set(key, value, ttl, tags)
    }
  }

  /**
   * Batch get operations
   */
  batchGet<T>(keys: string[]): (T | null)[] {
    return keys.map((key) => this.get<T>(key))
  }

  /**
   * Preload frequently accessed data
   */
  preload(
    entries: Array<{ key: string; value: unknown; priority: number }>
  ): void {
    // Sort by priority and preload
    entries
      .sort((a, b) => b.priority - a.priority)
      .forEach(({ key, value }) => {
        this.set(key, value, this.config.defaultTTL * 2) // Longer TTL for preloaded data
      })
  }

  /**
   * Health check for cache
   */
  healthCheck(): {
    status: 'healthy' | 'warning' | 'critical'
    message: string
    details: Record<string, unknown>
  } {
    const stats = this.getStats()
    const expiredEntries = Array.from(this.cache.values()).filter(
      (entry) => Date.now() > entry.expires_at
    ).length

    if (stats.hitRate < 0.5) {
      return {
        status: 'warning',
        message: 'Low cache hit rate',
        details: { hitRate: stats.hitRate, totalRequests: stats.totalRequests },
      }
    }

    if (expiredEntries > this.cache.size * 0.1) {
      return {
        status: 'warning',
        message: 'High number of expired entries',
        details: { expiredEntries, totalEntries: this.cache.size },
      }
    }

    if (this.cache.size >= this.config.maxEntries * 0.9) {
      return {
        status: 'warning',
        message: 'Cache near capacity',
        details: {
          currentSize: this.cache.size,
          maxSize: this.config.maxEntries,
        },
      }
    }

    return {
      status: 'healthy',
      message: 'Cache operating normally',
      details: stats as unknown as Record<string, unknown>,
    }
  }

  private evictLRU(): void {
    // Find least recently used entry
    let lruKey: string | null = null
    let lruTime = Date.now()

    for (const [key, entry] of this.cache.entries()) {
      if (entry.last_accessed < lruTime) {
        lruTime = entry.last_accessed
        lruKey = key
      }
    }

    if (lruKey) {
      this.delete(lruKey)
      this.metrics.evictions++
    }
  }

  private updateTags(key: string, tags: string[]): void {
    // Remove existing tag mappings
    const existingTags = this.keyToTags.get(key)
    if (existingTags) {
      for (const tag of existingTags) {
        const keys = this.tagToKeys.get(tag)
        if (keys) {
          keys.delete(key)
          if (keys.size === 0) {
            this.tagToKeys.delete(tag)
          }
        }
      }
    }

    // Add new tag mappings
    this.keyToTags.set(key, new Set(tags))
    for (const tag of tags) {
      if (!this.tagToKeys.has(tag)) {
        this.tagToKeys.set(tag, new Set())
      }
      this.tagToKeys.get(tag)!.add(key)
    }
  }

  private removeTags(key: string, tags: string[]): void {
    this.keyToTags.delete(key)
    for (const tag of tags) {
      const keys = this.tagToKeys.get(tag)
      if (keys) {
        keys.delete(key)
        if (keys.size === 0) {
          this.tagToKeys.delete(tag)
        }
      }
    }
  }

  private startCleanupInterval(): void {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60 * 1000)
  }

  private cleanup(): void {
    const now = Date.now()
    const expiredKeys: string[] = []

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires_at) {
        expiredKeys.push(key)
      }
    }

    for (const key of expiredKeys) {
      this.delete(key)
    }

    if (expiredKeys.length > 0) {
      logger.log(`Cleaned up ${expiredKeys.length} expired cache entries`)
    }
  }

  /**
   * Graceful shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.clear()
    AuthCache.instance = null as unknown as AuthCache
  }
}

// Export singleton instance
export const authCache = AuthCache.getInstance()

// Export types
export type { CacheEntry, CacheConfig, CacheMetrics }

// Created and developed by Jai Singh
