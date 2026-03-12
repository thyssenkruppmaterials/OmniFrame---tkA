/**
 * Deterministic test doubles for volatile subsystems.
 *
 * Provides fake implementations of cache, rate limiter, health checks,
 * performance tracker, audit service, and database connection pool that
 * return predictable results without requiring live infrastructure.
 *
 * Use these in deterministic integration mode (INTEGRATION_MODE=deterministic)
 * to avoid false failures from missing Redis/database.
 */

// ---------------------------------------------------------------------------
// FakeCacheService
// ---------------------------------------------------------------------------

/** In-memory cache that mimics the distributed cache service API. */
export class FakeCacheService {
  private store = new Map<string, { value: unknown; expiresAt?: number }>()
  private _isAvailable = true
  private _hits = 0
  private _misses = 0

  get isAvailable(): boolean {
    return this._isAvailable
  }

  async initialize(): Promise<void> {
    this._isAvailable = true
  }

  async shutdown(): Promise<void> {
    this.store.clear()
    this._isAvailable = false
  }

  async setPermissions(userId: string, permissions: string[], _ttl?: number, _tags?: string[]): Promise<void> {
    this.store.set(`permissions:${userId}`, { value: permissions })
  }

  async getPermissions(userId: string): Promise<string[] | null> {
    const entry = this.store.get(`permissions:${userId}`)
    if (entry) {
      this._hits++
      return entry.value as string[]
    }
    this._misses++
    return null
  }

  async invalidateUserPermissions(userId: string): Promise<void> {
    this.store.delete(`permissions:${userId}`)
  }

  async invalidateRolePermissions(_roleId: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith('permissions:')) {
        this.store.delete(key)
      }
    }
  }

  async batchSet(entries: Array<{ key: string; value: unknown; ttl?: number }>): Promise<void> {
    for (const entry of entries) {
      this.store.set(entry.key, { value: entry.value })
    }
  }

  async batchGet(keys: string[]): Promise<(unknown | null)[]> {
    return keys.map((key) => {
      const entry = this.store.get(key)
      if (entry) {
        this._hits++
        return entry.value
      }
      this._misses++
      return null
    })
  }

  async clearAll(): Promise<void> {
    this.store.clear()
    this._hits = 0
    this._misses = 0
  }

  async getStats() {
    const total = this._hits + this._misses
    return {
      size: this.store.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 1.0,
      missRate: total > 0 ? this._misses / total : 0.0,
    }
  }
}

// ---------------------------------------------------------------------------
// FakeRateLimiterService
// ---------------------------------------------------------------------------

/** Deterministic rate limiter that tracks counts without Redis. */
export class FakeRateLimiterService {
  private counters = new Map<string, number>()
  private limits = new Map<string, number>()
  private whitelist = new Set<string>()

  async initialize(): Promise<void> {
    /* no-op */
  }

  async shutdown(): Promise<void> {
    this.counters.clear()
    this.whitelist.clear()
  }

  setLimit(key: string, limit: number): void {
    this.limits.set(key, limit)
  }

  async checkLimit(keyOrContext: string | Record<string, unknown>): Promise<{
    allowed: boolean
    remaining: number
    retryAfter?: number
  }> {
    const key = typeof keyOrContext === 'string' ? keyOrContext : String(keyOrContext.action ?? 'default')
    const ip = typeof keyOrContext === 'object' ? String(keyOrContext.ip ?? '') : ''

    if (this.whitelist.has(ip) || this.whitelist.has(key)) {
      return { allowed: true, remaining: Infinity }
    }

    const current = this.counters.get(key) ?? 0
    const limit = this.limits.get(key) ?? 100
    const allowed = current < limit
    if (allowed) this.counters.set(key, current + 1)
    return {
      allowed,
      remaining: Math.max(0, limit - current - (allowed ? 1 : 0)),
      ...(!allowed ? { retryAfter: 60 } : {}),
    }
  }

  async clearLimit(_context: Record<string, unknown>): Promise<void> {
    this.counters.clear()
  }

  async clearLimits(): Promise<void> {
    this.counters.clear()
  }

  async addToWhitelist(value: string, _type?: string, _ttl?: number): Promise<void> {
    this.whitelist.add(value)
  }

  async isWhitelisted(value: string): Promise<boolean> {
    return this.whitelist.has(value)
  }
}

// ---------------------------------------------------------------------------
// FakeHealthCheckService
// ---------------------------------------------------------------------------

/** Fake health check that always returns healthy. */
export class FakeHealthCheckService {
  private startTime = Date.now()

  async initialize(): Promise<void> {
    this.startTime = Date.now()
  }

  async shutdown(): Promise<void> {
    /* no-op */
  }

  async runAllChecks() {
    return {
      overall: 'healthy' as const,
      checks: {
        redis: { status: 'healthy', latencyMs: 1 },
        database: { status: 'healthy', latencyMs: 2 },
      },
      summary: { totalChecks: 2 },
    }
  }

  async getHealthCheckEndpoint() {
    return {
      status: 'up' as const,
      timestamp: new Date().toISOString(),
      checks: {
        redis: { status: 'healthy' },
        database: { status: 'healthy' },
      },
      uptime: (Date.now() - this.startTime) / 1000,
    }
  }

  getUptimeStats() {
    return {
      redis: { uptimePercentage: 100, startTime: this.startTime },
      database: { uptimePercentage: 100, startTime: this.startTime },
    }
  }
}

// ---------------------------------------------------------------------------
// FakePerformanceTracker
// ---------------------------------------------------------------------------

/** In-memory performance tracker for deterministic tests. */
export class FakePerformanceTracker {
  private checks: Array<{ duration: number; cacheHit: boolean }> = []

  async initialize(): Promise<void> {
    /* no-op */
  }

  async shutdown(): Promise<void> {
    this.checks = []
  }

  async trackPermissionCheck(data: {
    userId: string
    resource: string
    action: string
    duration: number
    cacheHit: boolean
    success: boolean
  }): Promise<void> {
    this.checks.push({ duration: data.duration, cacheHit: data.cacheHit })
  }

  getMetrics() {
    const avg =
      this.checks.length > 0
        ? this.checks.reduce((s, c) => s + c.duration, 0) / this.checks.length
        : 0
    return {
      permissionCheckLatency: { value: avg },
      totalChecks: this.checks.length,
    }
  }

  async getPerformanceSummary(_hours: number) {
    const totalChecks = this.checks.length
    const avgLatency =
      totalChecks > 0
        ? this.checks.reduce((s, c) => s + c.duration, 0) / totalChecks
        : 0
    const cacheHits = this.checks.filter((c) => c.cacheHit).length
    return {
      summary: {
        permissions: {
          totalChecks,
          averageLatency: avgLatency,
          cacheHitRate: totalChecks > 0 ? cacheHits / totalChecks : 0,
        },
      },
    }
  }
}

// ---------------------------------------------------------------------------
// FakeAuditService
// ---------------------------------------------------------------------------

/** In-memory audit service for deterministic tests. */
export class FakeAuditService {
  private events: unknown[] = []

  async initialize(): Promise<void> {
    /* no-op */
  }

  async shutdown(): Promise<void> {
    this.events = []
  }

  async logPermissionCheck(data: Record<string, unknown>): Promise<void> {
    this.events.push({ type: 'permission_check', ...data })
  }

  async logSecurityEvent(data: Record<string, unknown>): Promise<void> {
    this.events.push({ type: 'security_event', ...data })
  }

  getMetrics() {
    return { totalEvents: this.events.length }
  }
}

// ---------------------------------------------------------------------------
// FakeDatabaseConnectionPool
// ---------------------------------------------------------------------------

/** Fake database connection pool that returns canned results. */
export class FakeDatabaseConnectionPool {
  private requestCount = 0

  async initialize(): Promise<void> {
    /* no-op */
  }

  async shutdown(): Promise<void> {
    /* no-op */
  }

  async executeRead<T>(_query: (client: unknown) => Promise<T>): Promise<{ data: null; error: null }> {
    this.requestCount++
    return { data: null, error: null }
  }

  getMetrics() {
    return {
      totalRequests: this.requestCount,
      successfulRequests: this.requestCount,
      failedRequests: 0,
      averageResponseTime: 5,
    }
  }

  async healthCheck() {
    return { status: 'healthy', message: 'Fake pool', details: {} }
  }
}
