// Created and developed by Jai Singh
// Permission Cache Web Worker for Background Processing
// Handles permission caching, preloading, and background refresh operations

interface CacheEntry<T> {
  data: T
  timestamp: number
  expires_at: number
  access_count: number
  last_accessed: number
}

interface WorkerMessage {
  type: string
  payload: any
  id?: string
}

interface WorkerResponse {
  type: string
  payload: any
  id?: string
  error?: string
}

class PermissionCacheWorker {
  private cache = new Map<string, CacheEntry<any>>()
  private config = {
    maxSize: 5000,
    defaultTTL: 5 * 60 * 1000, // 5 minutes
    cleanupInterval: 60 * 1000, // 1 minute
    preloadBatchSize: 50,
  }
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    preloadOperations: 0,
    totalOperations: 0,
  }

  constructor() {
    this.startCleanupTimer()
  }

  // Handle messages from main thread
  handleMessage(event: MessageEvent<WorkerMessage>) {
    const { type, payload, id } = event.data

    try {
      switch (type) {
        case 'PRELOAD_PERMISSIONS':
          this.preloadPermissions(payload)
          break

        case 'INVALIDATE_CACHE':
          this.invalidateCache(payload)
          break

        case 'CHECK_PERMISSION': {
          const result = this.checkPermission(payload)
          this.sendResponse({ type: 'PERMISSION_RESULT', payload: result, id })
          break
        }

        case 'GET_CACHE_STATS':
          this.sendResponse({
            type: 'CACHE_STATS',
            payload: this.getStats(),
            id,
          })
          break

        case 'CLEAR_CACHE':
          this.clearCache(payload)
          break

        case 'OPTIMIZE_CACHE':
          this.optimizeCache()
          break

        case 'PRELOAD_USER_PERMISSIONS':
          this.preloadUserPermissions(payload)
          break

        default:
          this.sendResponse({
            type: 'ERROR',
            payload: `Unknown message type: ${type}`,
            id,
          })
      }
    } catch (error) {
      this.sendResponse({
        type: 'ERROR',
        payload: error instanceof Error ? error.message : 'Unknown error',
        id,
      })
    }
  }

  // Preload permissions for faster access
  private async preloadPermissions(payload: {
    userId: string
    permissions: Array<{ resource: string; action: string }>
    priority?: 'high' | 'normal' | 'low'
  }) {
    const { userId, permissions, priority = 'normal' } = payload
    const ttl =
      priority === 'high' ? this.config.defaultTTL * 2 : this.config.defaultTTL

    try {
      // Process permissions in batches
      const batches = this.chunkArray(permissions, this.config.preloadBatchSize)

      for (const batch of batches) {
        await Promise.all(
          batch.map(async (perm) => {
            const key = `${userId}:${perm.resource}:${perm.action}`

            // Only preload if not already cached or expired
            const existing = this.cache.get(key)
            if (!existing || Date.now() > existing.expires_at) {
              // In a real implementation, this would fetch from API
              const granted = await this.fetchPermissionFromAPI(
                userId,
                perm.resource,
                perm.action
              )

              this.setCache(key, granted, ttl)
            }
          })
        )

        // Small delay between batches to avoid overwhelming the system
        if (batches.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }

      this.stats.preloadOperations++
      this.sendResponse({
        type: 'PRELOAD_COMPLETE',
        payload: { userId, count: permissions.length },
      })
    } catch (error) {
      this.sendResponse({
        type: 'PRELOAD_ERROR',
        payload: {
          userId,
          error: error instanceof Error ? error.message : 'Preload failed',
        },
      })
    }
  }

  // Preload all permissions for a specific user
  private async preloadUserPermissions(payload: { userId: string }) {
    const { userId } = payload

    try {
      // In a real implementation, this would fetch user's effective permissions
      const userPermissions = await this.fetchUserEffectivePermissions(userId)

      const cacheEntries = userPermissions.map((perm) => ({
        key: `${userId}:${perm.resource}:${perm.action}`,
        value: true,
        ttl: this.config.defaultTTL,
      }))

      // Batch cache operations
      cacheEntries.forEach((entry) => {
        this.setCache(entry.key, entry.value, entry.ttl)
      })

      this.sendResponse({
        type: 'USER_PRELOAD_COMPLETE',
        payload: { userId, permissionCount: cacheEntries.length },
      })
    } catch (error) {
      this.sendResponse({
        type: 'USER_PRELOAD_ERROR',
        payload: {
          userId,
          error: error instanceof Error ? error.message : 'User preload failed',
        },
      })
    }
  }

  // Check permission from cache
  private checkPermission(payload: {
    userId: string
    resource: string
    action: string
  }): { granted: boolean; source: 'cache' | 'miss'; cacheAge?: number } {
    const { userId, resource, action } = payload
    const key = `${userId}:${resource}:${action}`

    this.stats.totalOperations++

    const entry = this.cache.get(key)

    if (entry && Date.now() <= entry.expires_at) {
      // Cache hit
      entry.access_count++
      entry.last_accessed = Date.now()
      this.stats.hits++

      return {
        granted: entry.data,
        source: 'cache',
        cacheAge: Date.now() - entry.timestamp,
      }
    }

    // Cache miss
    this.stats.misses++
    return {
      granted: false,
      source: 'miss',
    }
  }

  // Invalidate cache entries
  private invalidateCache(payload: {
    userId?: string
    pattern?: string
    keys?: string[]
    reason?: string
  }) {
    const { userId, pattern, keys, reason = 'Manual invalidation' } = payload
    let invalidatedCount = 0

    if (keys) {
      // Invalidate specific keys
      keys.forEach((key) => {
        if (this.cache.delete(key)) {
          invalidatedCount++
        }
      })
    } else if (userId) {
      // Invalidate all entries for a user
      for (const [key] of this.cache) {
        if (key.startsWith(`${userId}:`)) {
          this.cache.delete(key)
          invalidatedCount++
        }
      }
    } else if (pattern) {
      // Invalidate entries matching pattern
      const regex = new RegExp(pattern)
      for (const [key] of this.cache) {
        if (regex.test(key)) {
          this.cache.delete(key)
          invalidatedCount++
        }
      }
    } else {
      // Clear all cache
      invalidatedCount = this.cache.size
      this.cache.clear()
    }

    this.sendResponse({
      type: 'CACHE_INVALIDATED',
      payload: {
        invalidatedCount,
        reason,
        cacheSize: this.cache.size,
      },
    })
  }

  // Clear specific cache entries
  private clearCache(payload: { type?: 'all' | 'expired' | 'lru' }) {
    const { type = 'all' } = payload
    let clearedCount = 0

    switch (type) {
      case 'expired': {
        // Remove only expired entries
        const now = Date.now()
        for (const [key, entry] of this.cache) {
          if (now > entry.expires_at) {
            this.cache.delete(key)
            clearedCount++
          }
        }
        break
      }

      case 'lru':
        // Remove least recently used entries if cache is too large
        if (this.cache.size > this.config.maxSize) {
          const entries = Array.from(this.cache.entries())
          entries.sort((a, b) => a[1].last_accessed - b[1].last_accessed)

          const toRemove = entries.slice(
            0,
            Math.floor(this.config.maxSize * 0.2)
          ) // Remove 20%
          toRemove.forEach(([key]) => {
            this.cache.delete(key)
            clearedCount++
          })
        }
        break

      case 'all':
      default:
        clearedCount = this.cache.size
        this.cache.clear()
        break
    }

    this.stats.evictions += clearedCount

    this.sendResponse({
      type: 'CACHE_CLEARED',
      payload: { clearedCount, newSize: this.cache.size },
    })
  }

  // Optimize cache performance
  private optimizeCache() {
    const now = Date.now()
    let optimized = 0

    // Remove expired entries
    for (const [key, entry] of this.cache) {
      if (now > entry.expires_at) {
        this.cache.delete(key)
        optimized++
      }
    }

    // Apply LRU eviction if cache is still too large
    if (this.cache.size > this.config.maxSize) {
      const entries = Array.from(this.cache.entries())
      entries.sort((a, b) => a[1].last_accessed - b[1].last_accessed)

      const excessCount = this.cache.size - this.config.maxSize
      entries.slice(0, excessCount).forEach(([key]) => {
        this.cache.delete(key)
        optimized++
      })
    }

    this.sendResponse({
      type: 'CACHE_OPTIMIZED',
      payload: {
        optimizedCount: optimized,
        cacheSize: this.cache.size,
        hitRate: this.getHitRate(),
      },
    })
  }

  // Set cache entry
  private setCache(
    key: string,
    value: any,
    ttl: number = this.config.defaultTTL
  ) {
    // Check if cache is at capacity
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      // Remove LRU entry
      let oldestKey = ''
      let oldestTime = Date.now()

      for (const [cacheKey, entry] of this.cache) {
        if (entry.last_accessed < oldestTime) {
          oldestTime = entry.last_accessed
          oldestKey = cacheKey
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey)
        this.stats.evictions++
      }
    }

    const now = Date.now()
    this.cache.set(key, {
      data: value,
      timestamp: now,
      expires_at: now + ttl,
      access_count: 1,
      last_accessed: now,
    })
  }

  // Get cache statistics
  private getStats() {
    const totalRequests = this.stats.hits + this.stats.misses

    return {
      cacheSize: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate: this.getHitRate(),
      totalRequests,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      preloadOperations: this.stats.preloadOperations,
      totalOperations: this.stats.totalOperations,
      memoryUsage: this.estimateMemoryUsage(),
    }
  }

  private getHitRate(): number {
    const total = this.stats.hits + this.stats.misses
    return total > 0 ? this.stats.hits / total : 0
  }

  private estimateMemoryUsage(): number {
    // Rough estimation of memory usage in bytes
    let size = 0
    for (const [key, value] of this.cache) {
      size += key.length * 2 // UTF-16 string
      size += JSON.stringify(value).length * 2
    }
    return size
  }

  // Start periodic cleanup
  private startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.clearCache({ type: 'expired' })
    }, this.config.cleanupInterval)
  }

  // Utility functions
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  private sendResponse(response: WorkerResponse) {
    self.postMessage(response)
  }

  // Mock API functions (in real implementation, these would use fetch or similar)
  private async fetchPermissionFromAPI(
    _userId: string,
    _resource: string,
    _action: string
  ): Promise<boolean> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 + 10))

    // Mock permission result
    return Math.random() > 0.3 // 70% chance of having permission
  }

  private async fetchUserEffectivePermissions(
    _userId: string
  ): Promise<Array<{ resource: string; action: string }>> {
    // Simulate API delay
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * 100 + 50)
    )

    // Mock user permissions
    return [
      { resource: 'users', action: 'read' },
      { resource: 'users', action: 'create' },
      { resource: 'tasks', action: 'read' },
      { resource: 'dashboard', action: 'read' },
    ]
  }
}

// Initialize worker
const worker = new PermissionCacheWorker()

// Handle messages from main thread
self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  worker.handleMessage(event)
})

// Handle worker termination
self.addEventListener('beforeunload', () => {
  if (worker['cleanupTimer']) {
    clearInterval(worker['cleanupTimer'])
  }
})

// Export types for main thread usage
export type { WorkerMessage, WorkerResponse, CacheEntry }

// Created and developed by Jai Singh
