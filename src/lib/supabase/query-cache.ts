/**
 * Query Result Caching Utilities
 * Implements client-side caching for Supabase queries
 *
 * Author: Jai Singh
 * Date: October 29, 2025
 * Version: 1.0.0 - Phase 2 Optimization
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

class QueryCache {
  private cache: Map<string, CacheEntry<unknown>>
  private readonly DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes

  constructor() {
    this.cache = new Map()

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60 * 1000)
  }

  /**
   * Get cached query result
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  /**
   * Set query result in cache
   */
  set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    })
  }

  /**
   * Invalidate specific cache key
   */
  invalidate(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Invalidate all keys matching pattern
   */
  invalidatePattern(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now()

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now()
    let valid = 0
    let expired = 0

    for (const entry of this.cache.values()) {
      if (now - entry.timestamp > entry.ttl) {
        expired++
      } else {
        valid++
      }
    }

    return {
      total: this.cache.size,
      valid,
      expired,
      hitRate: 0, // Would need hit/miss tracking
    }
  }
}

// Global cache instance
const queryCache = new QueryCache()

/**
 * Cached query wrapper
 *
 * @example
 * const data = await cachedQuery(
 *   'inbound-scans-org-123',
 *   () => supabase.from('rr_inbound_scans').select('*').limit(1000),
 *   5 * 60 * 1000 // 5 minute TTL
 * )
 */
export async function cachedQuery<T>(
  cacheKey: string,
  queryFn: () => Promise<{ data: T | null; error: unknown }>,
  ttl?: number
): Promise<{ data: T | null; error: unknown; fromCache: boolean }> {
  // Check cache first
  const cached = queryCache.get<T>(cacheKey)

  if (cached !== null) {
    return {
      data: cached,
      error: null,
      fromCache: true,
    }
  }

  // Execute query
  const result = await queryFn()

  // Cache successful results
  if (result.data && !result.error) {
    queryCache.set(cacheKey, result.data, ttl)
  }

  return {
    ...result,
    fromCache: false,
  }
}

/**
 * Generate cache key for query
 */
export function generateCacheKey(
  table: string,
  params: Record<string, unknown>
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${JSON.stringify(params[key])}`)
    .join('&')

  return `${table}?${sortedParams}`
}

/**
 * Invalidate cache for specific table
 */
export function invalidateTableCache(table: string): void {
  queryCache.invalidatePattern(new RegExp(`^${table}\\?`))
}

/**
 * Invalidate cache for organization
 */
export function invalidateOrgCache(orgId: string): void {
  queryCache.invalidatePattern(new RegExp(`organization_id="${orgId}"`))
}

/**
 * Clear all query cache
 */
export function clearQueryCache(): void {
  queryCache.clear()
}

/**
 * Get cache statistics
 */
export function getQueryCacheStats() {
  return queryCache.getStats()
}

/**
 * Cached Supabase query builder decorator
 *
 * @example
 * class InboundService {
 *   @cachedQueryDecorator('inbound-scans', 5 * 60 * 1000)
 *   async getScans() {
 *     return supabase.from('rr_inbound_scans').select('*')
 *   }
 * }
 */
export function cachedQueryDecorator(keyPrefix: string, ttl?: number) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: unknown[]) {
      const cacheKey = `${keyPrefix}-${JSON.stringify(args)}`

      return cachedQuery(cacheKey, () => originalMethod.apply(this, args), ttl)
    }

    return descriptor
  }
}

// Export cache instance for advanced usage
export { queryCache }
// Developer and Creator: Jai Singh
