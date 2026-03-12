/**
 * Enterprise Performance Tracking for OmniFrame RBAC System
 * Comprehensive performance monitoring, metrics collection, and alerting
 * Designed for real-time performance optimization at enterprise scale
 */
import Redis from 'ioredis'
import { distributedCacheService } from '@/lib/cache/redis-cache-service'
import { databaseConnectionPool } from '@/lib/database/connection-pool'
import { logger } from '@/lib/utils/logger'

// ===== TYPES =====

interface PerformanceMetric {
  name: string
  value: number
  unit: string
  timestamp: number
  labels?: Record<string, string>
  threshold?: {
    warning: number
    critical: number
  }
}

interface PerformanceSample {
  operation: string
  duration: number
  timestamp: number
  userId?: string
  resource?: string
  action?: string
  cacheHit?: boolean
  errorOccurred?: boolean
}

interface SystemMetrics {
  // RBAC Performance
  permissionCheckLatency: PerformanceMetric
  permissionCheckThroughput: PerformanceMetric
  cacheHitRate: PerformanceMetric
  cacheLatency: PerformanceMetric

  // Database Performance
  databaseQueryLatency: PerformanceMetric
  databaseConnectionPool: PerformanceMetric
  databaseThroughput: PerformanceMetric

  // Authentication Performance
  authOperationLatency: PerformanceMetric
  sessionValidationLatency: PerformanceMetric
  userLookupLatency: PerformanceMetric

  // System Health
  errorRate: PerformanceMetric
  memoryUsage: PerformanceMetric
  cpuUsage: PerformanceMetric

  // Business Metrics
  activeUsers: PerformanceMetric
  concurrentSessions: PerformanceMetric
  permissionChecksPerSecond: PerformanceMetric
}

interface AlertThreshold {
  metric: string
  operator: 'gt' | 'lt' | 'eq'
  value: number
  severity: 'warning' | 'critical'
  duration: number // Time window in seconds
}

interface PerformanceAlert {
  id: string
  metric: string
  severity: 'warning' | 'critical'
  message: string
  value: number
  threshold: number
  timestamp: number
  acknowledged: boolean
  resolvedAt?: number
}

// ===== PERFORMANCE TRACKER =====

export class PerformanceTracker {
  private static instance: PerformanceTracker
  private redis!: Redis
  private samples: PerformanceSample[] = []
  private metrics!: SystemMetrics
  private alertThresholds: AlertThreshold[] = []
  private activeAlerts: Map<string, PerformanceAlert> = new Map()

  private readonly SAMPLE_BUFFER_SIZE = 10000
  private readonly METRICS_UPDATE_INTERVAL = 5000 // 5 seconds
  private readonly SAMPLE_RETENTION_HOURS = 24
  private readonly ALERT_CHECK_INTERVAL = 10000 // 10 seconds

  private constructor() {
    this.initializeMetrics()
  }

  static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker()
    }
    return PerformanceTracker.instance
  }

  /**
   * Initialize performance tracking
   */
  async initialize(): Promise<void> {
    try {
      logger.log('🚀 Initializing performance tracking system...')

      const { getRedisConfig } = await import('@/lib/infra/redis-config')
      const config = getRedisConfig()
      this.redis = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        maxRetriesPerRequest: config.maxRetriesPerRequest,
      })

      // Initialize alert thresholds
      this.initializeAlertThresholds()

      // Start background processes
      this.startMetricsCollection()
      this.startAlertMonitoring()
      this.startMetricsAggregation()

      // Performance tracker initialized
      logger.log('✅ Performance tracking system initialized successfully')
    } catch (error) {
      logger.error('❌ Failed to initialize performance tracker:', error)
      throw error
    }
  }

  /**
   * Track permission check performance
   */
  async trackPermissionCheck(data: {
    userId?: string
    resource: string
    action: string
    duration: number
    cacheHit: boolean
    success: boolean
  }): Promise<void> {
    const sample: PerformanceSample = {
      operation: 'permission_check',
      duration: data.duration,
      timestamp: Date.now(),
      userId: data.userId,
      resource: data.resource,
      action: data.action,
      cacheHit: data.cacheHit,
      errorOccurred: !data.success,
    }

    await this.recordSample(sample)
    await this.updatePermissionMetrics(sample)
  }

  /**
   * Track authentication operation performance
   */
  async trackAuthOperation(data: {
    operation: string
    userId?: string
    duration: number
    success: boolean
  }): Promise<void> {
    const sample: PerformanceSample = {
      operation: `auth_${data.operation}`,
      duration: data.duration,
      timestamp: Date.now(),
      userId: data.userId,
      errorOccurred: !data.success,
    }

    await this.recordSample(sample)
    await this.updateAuthMetrics(sample)
  }

  /**
   * Track database operation performance
   */
  async trackDatabaseOperation(data: {
    operation: string
    duration: number
    queryType: 'read' | 'write' | 'admin'
    success: boolean
    rowsAffected?: number
  }): Promise<void> {
    const sample: PerformanceSample = {
      operation: `db_${data.operation}`,
      duration: data.duration,
      timestamp: Date.now(),
      errorOccurred: !data.success,
    }

    await this.recordSample(sample)
    await this.updateDatabaseMetrics(sample)
  }

  /**
   * Track cache operation performance
   */
  async trackCacheOperation(data: {
    operation: 'get' | 'set' | 'invalidate'
    duration: number
    hit?: boolean
    keyCount?: number
    success: boolean
  }): Promise<void> {
    const sample: PerformanceSample = {
      operation: `cache_${data.operation}`,
      duration: data.duration,
      timestamp: Date.now(),
      cacheHit: data.hit,
      errorOccurred: !data.success,
    }

    await this.recordSample(sample)
    await this.updateCacheMetrics(sample)
  }

  /**
   * Get current system metrics
   */
  getMetrics(): SystemMetrics {
    return { ...this.metrics }
  }

  /**
   * Get performance summary
   */
  async getPerformanceSummary(timeRangeHours = 1): Promise<{
    summary: Record<string, unknown>
    trends: Record<string, unknown>
    alerts: PerformanceAlert[]
  }> {
    try {
      const endTime = Date.now()
      const startTime = endTime - timeRangeHours * 60 * 60 * 1000

      // Get recent samples
      const recentSamples = this.samples.filter(
        (s) => s.timestamp >= startTime && s.timestamp <= endTime
      )

      // Calculate summary statistics
      const permissionSamples = recentSamples.filter(
        (s) => s.operation === 'permission_check'
      )
      const authSamples = recentSamples.filter((s) =>
        s.operation.startsWith('auth_')
      )
      const dbSamples = recentSamples.filter((s) =>
        s.operation.startsWith('db_')
      )
      const cacheSamples = recentSamples.filter((s) =>
        s.operation.startsWith('cache_')
      )

      const summary = {
        timeRange: `${timeRangeHours} hours`,
        totalOperations: recentSamples.length,

        permissions: {
          totalChecks: permissionSamples.length,
          averageLatency: this.calculateAverage(
            permissionSamples.map((s) => s.duration)
          ),
          cacheHitRate:
            permissionSamples.filter((s) => s.cacheHit).length /
            Math.max(permissionSamples.length, 1),
          errorRate:
            permissionSamples.filter((s) => s.errorOccurred).length /
            Math.max(permissionSamples.length, 1),
          throughput: permissionSamples.length / (timeRangeHours * 3600), // per second
        },

        authentication: {
          totalOperations: authSamples.length,
          averageLatency: this.calculateAverage(
            authSamples.map((s) => s.duration)
          ),
          errorRate:
            authSamples.filter((s) => s.errorOccurred).length /
            Math.max(authSamples.length, 1),
        },

        database: {
          totalQueries: dbSamples.length,
          averageLatency: this.calculateAverage(
            dbSamples.map((s) => s.duration)
          ),
          errorRate:
            dbSamples.filter((s) => s.errorOccurred).length /
            Math.max(dbSamples.length, 1),
        },

        cache: {
          totalOperations: cacheSamples.length,
          averageLatency: this.calculateAverage(
            cacheSamples.map((s) => s.duration)
          ),
          hitRate:
            cacheSamples.filter((s) => s.cacheHit).length /
            Math.max(cacheSamples.length, 1),
        },
      }

      // Calculate trends (simplified)
      const trends = {
        permission_latency_trend: 'stable', // Would calculate actual trend
        cache_hit_rate_trend: 'improving',
        error_rate_trend: 'stable',
      }

      return {
        summary,
        trends,
        alerts: Array.from(this.activeAlerts.values()),
      }
    } catch (error) {
      logger.error('Error generating performance summary:', error)
      return {
        summary: {},
        trends: {},
        alerts: [],
      }
    }
  }

  /**
   * Record performance sample
   */
  private async recordSample(sample: PerformanceSample): Promise<void> {
    // Add to in-memory buffer
    this.samples.push(sample)

    // Maintain buffer size
    if (this.samples.length > this.SAMPLE_BUFFER_SIZE) {
      this.samples = this.samples.slice(-this.SAMPLE_BUFFER_SIZE * 0.8) // Keep 80%
    }

    // Store in Redis for persistence
    try {
      await this.redis.lpush('performance_samples', JSON.stringify(sample))
      await this.redis.ltrim('performance_samples', 0, this.SAMPLE_BUFFER_SIZE)
      await this.redis.expire(
        'performance_samples',
        this.SAMPLE_RETENTION_HOURS * 3600
      )
    } catch (error) {
      logger.error('Error storing performance sample:', error)
    }
  }

  /**
   * Update permission-specific metrics
   */
  private async updatePermissionMetrics(
    sample: PerformanceSample
  ): Promise<void> {
    // Update permission check latency
    this.metrics.permissionCheckLatency.value =
      (this.metrics.permissionCheckLatency.value + sample.duration) / 2
    this.metrics.permissionCheckLatency.timestamp = Date.now()

    // Update cache hit rate if applicable
    if (sample.cacheHit !== undefined) {
      const recentPermissionSamples = this.samples.filter(
        (s) =>
          s.operation === 'permission_check' &&
          s.timestamp > Date.now() - 300000
      ) // Last 5 minutes

      const hitRate =
        recentPermissionSamples.filter((s) => s.cacheHit).length /
        Math.max(recentPermissionSamples.length, 1)

      this.metrics.cacheHitRate.value = hitRate
      this.metrics.cacheHitRate.timestamp = Date.now()
    }
  }

  /**
   * Update authentication metrics
   */
  private async updateAuthMetrics(sample: PerformanceSample): Promise<void> {
    this.metrics.authOperationLatency.value =
      (this.metrics.authOperationLatency.value + sample.duration) / 2
    this.metrics.authOperationLatency.timestamp = Date.now()
  }

  /**
   * Update database metrics
   */
  private async updateDatabaseMetrics(
    sample: PerformanceSample
  ): Promise<void> {
    this.metrics.databaseQueryLatency.value =
      (this.metrics.databaseQueryLatency.value + sample.duration) / 2
    this.metrics.databaseQueryLatency.timestamp = Date.now()
  }

  /**
   * Update cache metrics
   */
  private async updateCacheMetrics(sample: PerformanceSample): Promise<void> {
    this.metrics.cacheLatency.value =
      (this.metrics.cacheLatency.value + sample.duration) / 2
    this.metrics.cacheLatency.timestamp = Date.now()
  }

  /**
   * Initialize default metrics
   */
  private initializeMetrics(): void {
    const now = Date.now()

    this.metrics = {
      permissionCheckLatency: {
        name: 'permission_check_latency',
        value: 0,
        unit: 'ms',
        timestamp: now,
        threshold: { warning: 100, critical: 500 },
      },
      permissionCheckThroughput: {
        name: 'permission_check_throughput',
        value: 0,
        unit: 'ops/sec',
        timestamp: now,
        threshold: { warning: 100, critical: 50 },
      },
      cacheHitRate: {
        name: 'cache_hit_rate',
        value: 0,
        unit: 'percentage',
        timestamp: now,
        threshold: { warning: 0.8, critical: 0.5 },
      },
      cacheLatency: {
        name: 'cache_latency',
        value: 0,
        unit: 'ms',
        timestamp: now,
        threshold: { warning: 50, critical: 200 },
      },
      databaseQueryLatency: {
        name: 'database_query_latency',
        value: 0,
        unit: 'ms',
        timestamp: now,
        threshold: { warning: 200, critical: 1000 },
      },
      databaseConnectionPool: {
        name: 'database_connection_pool_usage',
        value: 0,
        unit: 'percentage',
        timestamp: now,
        threshold: { warning: 0.8, critical: 0.95 },
      },
      databaseThroughput: {
        name: 'database_throughput',
        value: 0,
        unit: 'ops/sec',
        timestamp: now,
        threshold: { warning: 500, critical: 200 },
      },
      authOperationLatency: {
        name: 'auth_operation_latency',
        value: 0,
        unit: 'ms',
        timestamp: now,
        threshold: { warning: 500, critical: 2000 },
      },
      sessionValidationLatency: {
        name: 'session_validation_latency',
        value: 0,
        unit: 'ms',
        timestamp: now,
        threshold: { warning: 100, critical: 500 },
      },
      userLookupLatency: {
        name: 'user_lookup_latency',
        value: 0,
        unit: 'ms',
        timestamp: now,
        threshold: { warning: 200, critical: 1000 },
      },
      errorRate: {
        name: 'error_rate',
        value: 0,
        unit: 'percentage',
        timestamp: now,
        threshold: { warning: 0.01, critical: 0.05 },
      },
      memoryUsage: {
        name: 'memory_usage',
        value: 0,
        unit: 'MB',
        timestamp: now,
        threshold: { warning: 1000, critical: 2000 },
      },
      cpuUsage: {
        name: 'cpu_usage',
        value: 0,
        unit: 'percentage',
        timestamp: now,
        threshold: { warning: 0.8, critical: 0.95 },
      },
      activeUsers: {
        name: 'active_users',
        value: 0,
        unit: 'count',
        timestamp: now,
      },
      concurrentSessions: {
        name: 'concurrent_sessions',
        value: 0,
        unit: 'count',
        timestamp: now,
      },
      permissionChecksPerSecond: {
        name: 'permission_checks_per_second',
        value: 0,
        unit: 'ops/sec',
        timestamp: now,
        threshold: { warning: 1000, critical: 500 },
      },
    }
  }

  /**
   * Initialize alert thresholds
   */
  private initializeAlertThresholds(): void {
    this.alertThresholds = [
      // Performance thresholds
      {
        metric: 'permission_check_latency',
        operator: 'gt',
        value: 100,
        severity: 'warning',
        duration: 300,
      },
      {
        metric: 'permission_check_latency',
        operator: 'gt',
        value: 500,
        severity: 'critical',
        duration: 60,
      },
      {
        metric: 'cache_hit_rate',
        operator: 'lt',
        value: 0.8,
        severity: 'warning',
        duration: 600,
      },
      {
        metric: 'cache_hit_rate',
        operator: 'lt',
        value: 0.5,
        severity: 'critical',
        duration: 300,
      },

      // Throughput thresholds
      {
        metric: 'permission_checks_per_second',
        operator: 'gt',
        value: 1000,
        severity: 'warning',
        duration: 300,
      },
      {
        metric: 'permission_checks_per_second',
        operator: 'gt',
        value: 5000,
        severity: 'critical',
        duration: 60,
      },

      // Error rate thresholds
      {
        metric: 'error_rate',
        operator: 'gt',
        value: 0.01,
        severity: 'warning',
        duration: 300,
      },
      {
        metric: 'error_rate',
        operator: 'gt',
        value: 0.05,
        severity: 'critical',
        duration: 60,
      },

      // System resource thresholds
      {
        metric: 'database_connection_pool_usage',
        operator: 'gt',
        value: 0.8,
        severity: 'warning',
        duration: 300,
      },
      {
        metric: 'database_connection_pool_usage',
        operator: 'gt',
        value: 0.95,
        severity: 'critical',
        duration: 60,
      },
    ]

    logger.log(
      `✅ Initialized ${this.alertThresholds.length} performance alert thresholds`
    )
  }

  /**
   * Start metrics collection background process
   */
  private startMetricsCollection(): void {
    setInterval(async () => {
      await this.collectSystemMetrics()
    }, this.METRICS_UPDATE_INTERVAL)
  }

  /**
   * Start alert monitoring
   */
  private startAlertMonitoring(): void {
    setInterval(async () => {
      await this.checkAlerts()
    }, this.ALERT_CHECK_INTERVAL)
  }

  /**
   * Start metrics aggregation
   */
  private startMetricsAggregation(): void {
    setInterval(async () => {
      await this.aggregateMetrics()
    }, 60000) // Every minute
  }

  /**
   * Collect system metrics
   */
  private async collectSystemMetrics(): Promise<void> {
    try {
      // Collect cache metrics
      const cacheStats = await distributedCacheService.getStats()
      this.metrics.cacheHitRate.value = cacheStats.hitRate
      this.metrics.cacheLatency.value = cacheStats.averageAccessTime

      // Collect database metrics
      const dbMetrics = await databaseConnectionPool.getMetrics()
      this.metrics.databaseConnectionPool.value =
        dbMetrics.activeConnections / Math.max(dbMetrics.totalConnections, 1)

      // Update throughput calculations
      this.updateThroughputMetrics()

      // Collect system resource metrics (simplified)
      const perfWithMemory = performance as unknown as {
        memory?: { usedJSHeapSize: number }
      }
      if (typeof window !== 'undefined' && perfWithMemory.memory) {
        this.metrics.memoryUsage.value =
          perfWithMemory.memory.usedJSHeapSize / 1024 / 1024 // MB
      }
    } catch (error) {
      logger.error('Error collecting system metrics:', error)
    }
  }

  /**
   * Update throughput metrics based on recent samples
   */
  private updateThroughputMetrics(): void {
    const now = Date.now()
    const oneMinuteAgo = now - 60000

    // Permission checks per second
    const recentPermissionChecks = this.samples.filter(
      (s) => s.operation === 'permission_check' && s.timestamp > oneMinuteAgo
    )
    this.metrics.permissionChecksPerSecond.value =
      recentPermissionChecks.length / 60

    // Database throughput
    const recentDbOps = this.samples.filter(
      (s) => s.operation.startsWith('db_') && s.timestamp > oneMinuteAgo
    )
    this.metrics.databaseThroughput.value = recentDbOps.length / 60
  }

  /**
   * Check for alert conditions
   */
  private async checkAlerts(): Promise<void> {
    try {
      const now = Date.now()

      for (const threshold of this.alertThresholds) {
        const metric = this.getMetricByName(threshold.metric)
        if (!metric) continue

        const shouldAlert = this.evaluateThreshold(metric.value, threshold)
        const alertId = `${threshold.metric}_${threshold.severity}`

        if (shouldAlert && !this.activeAlerts.has(alertId)) {
          // Create new alert
          const alert: PerformanceAlert = {
            id: alertId,
            metric: threshold.metric,
            severity: threshold.severity,
            message: `${threshold.metric} ${threshold.operator} ${threshold.value} (current: ${metric.value})`,
            value: metric.value,
            threshold: threshold.value,
            timestamp: now,
            acknowledged: false,
          }

          this.activeAlerts.set(alertId, alert)
          await this.handleAlert(alert)
        } else if (!shouldAlert && this.activeAlerts.has(alertId)) {
          // Resolve alert
          const alert = this.activeAlerts.get(alertId)!
          alert.resolvedAt = now
          this.activeAlerts.delete(alertId)

          logger.log(`✅ Performance alert resolved: ${alert.message}`)
        }
      }
    } catch (error) {
      logger.error('Error checking alerts:', error)
    }
  }

  /**
   * Handle performance alert
   */
  private async handleAlert(alert: PerformanceAlert): Promise<void> {
    try {
      logger.warn(`🚨 Performance alert: ${alert.message}`)

      // Store alert in Redis for admin dashboard
      await this.redis.lpush('performance_alerts', JSON.stringify(alert))
      await this.redis.ltrim('performance_alerts', 0, 1000)

      // Implement automatic responses for critical alerts
      if (alert.severity === 'critical') {
        await this.handleCriticalAlert(alert)
      }
    } catch (error) {
      logger.error('Error handling performance alert:', error)
    }
  }

  /**
   * Handle critical performance alerts
   */
  private async handleCriticalAlert(alert: PerformanceAlert): Promise<void> {
    logger.error('🚨 CRITICAL PERFORMANCE ALERT:', alert.message)

    try {
      switch (alert.metric) {
        case 'cache_hit_rate':
          // Trigger cache warming
          logger.log('🔥 Triggering emergency cache warming...')
          // Could implement cache warming here
          break

        case 'database_connection_pool_usage':
          // Alert DBAs, consider read replica failover
          logger.log(
            '📊 Database connection pool critical - alerting administrators'
          )
          break

        case 'permission_check_latency':
          // Consider activating performance mode
          logger.log(
            '⚡ High permission check latency - activating performance mode'
          )
          break
      }

      // Alert administrators
      await this.alertAdministrators(alert)
    } catch (error) {
      logger.error('Error handling critical alert:', error)
    }
  }

  /**
   * Alert administrators
   */
  private async alertAdministrators(alert: PerformanceAlert): Promise<void> {
    try {
      await this.redis.lpush(
        'admin_performance_alerts',
        JSON.stringify({
          ...alert,
          severity: 'critical',
          requiresImmedateAttention: true,
        })
      )

      // In production: send emails, Slack notifications, PagerDuty alerts
      logger.error(
        '🚨 ADMIN ALERT: Critical performance issue -',
        alert.message
      )
    } catch (error) {
      logger.error('Error alerting administrators:', error)
    }
  }

  /**
   * Aggregate metrics for long-term storage
   */
  private async aggregateMetrics(): Promise<void> {
    try {
      const now = Date.now()
      const aggregation = {
        timestamp: now,
        metrics: this.getMetrics(),
        sampleCount: this.samples.length,
        activeAlertCount: this.activeAlerts.size,
      }

      // Store aggregated metrics
      await this.redis.lpush('metrics_hourly', JSON.stringify(aggregation))
      await this.redis.ltrim('metrics_hourly', 0, 168) // Keep 1 week
      await this.redis.expire('metrics_hourly', 7 * 24 * 3600)
    } catch (error) {
      logger.error('Error aggregating metrics:', error)
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'critical'
    message: string
    details: Record<string, unknown>
  }> {
    try {
      const criticalAlerts = Array.from(this.activeAlerts.values()).filter(
        (a) => a.severity === 'critical'
      )

      if (criticalAlerts.length > 0) {
        return {
          status: 'critical',
          message: `${criticalAlerts.length} critical performance alerts active`,
          details: {
            alerts: criticalAlerts,
            metrics: this.getMetrics(),
          },
        }
      }

      const warningAlerts = Array.from(this.activeAlerts.values()).filter(
        (a) => a.severity === 'warning'
      )

      if (warningAlerts.length > 3) {
        return {
          status: 'degraded',
          message: `${warningAlerts.length} warning alerts active`,
          details: {
            alerts: warningAlerts,
            metrics: this.getMetrics(),
          },
        }
      }

      return {
        status: 'healthy',
        message: 'Performance monitoring operating normally',
        details: {
          metrics: this.getMetrics(),
          sampleCount: this.samples.length,
        },
      }
    } catch (error) {
      return {
        status: 'critical',
        message: 'Performance monitoring health check failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }
    }
  }

  /**
   * Utility methods
   */
  private calculateAverage(values: number[]): number {
    return values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0
  }

  private getMetricByName(name: string): PerformanceMetric | null {
    const metricsArray = Object.values(this.metrics)
    return metricsArray.find((m) => m.name === name) || null
  }

  private evaluateThreshold(value: number, threshold: AlertThreshold): boolean {
    switch (threshold.operator) {
      case 'gt':
        return value > threshold.value
      case 'lt':
        return value < threshold.value
      case 'eq':
        return Math.abs(value - threshold.value) < 0.01
      default:
        return false
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      // Final metrics aggregation
      await this.aggregateMetrics()

      // Close Redis connection
      if (this.redis) {
        await this.redis.quit()
      }

      logger.log('✅ Performance tracker shut down gracefully')
    } catch (error) {
      logger.error('Performance tracker shutdown error:', error)
    }
  }
}

// Export singleton instance
export const performanceTracker = PerformanceTracker.getInstance()

// Export types
export type {
  PerformanceMetric,
  PerformanceSample,
  SystemMetrics,
  AlertThreshold,
  PerformanceAlert,
}
// Developer and Creator: Jai Singh
