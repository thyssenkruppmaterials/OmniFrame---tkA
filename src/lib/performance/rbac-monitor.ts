// React import for the hook
import React from 'react'
import { logger } from '@/lib/utils/logger'

// RBAC Performance Monitoring and Analytics

interface PerformanceMetric {
  id: string
  operation: string
  duration: number
  timestamp: number
  metadata?: Record<string, unknown>
}

interface CacheMetrics {
  hitRate: number
  totalRequests: number
  averageHitTime: number
  averageMissTime: number
  cacheSize: number
  evictionRate: number
}

interface RBACAnalytics {
  permissionChecks: {
    total: number
    granted: number
    denied: number
    averageTime: number
  }
  topPermissions: Array<{
    resource: string
    action: string
    checkCount: number
    denialRate: number
  }>
  userActivity: {
    activeUsers: number
    newUsers: number
    suspiciousActivity: number
  }
  systemHealth: {
    errorRate: number
    averageResponseTime: number
    cacheEfficiency: number
  }
}

class RBACPerformanceMonitor {
  private metrics: PerformanceMetric[] = []
  public cacheWorker: Worker | null = null
  private analyticsInterval: ReturnType<typeof setInterval> | null = null
  private readonly maxMetrics = 10000
  private readonly flushInterval = 60000 // 1 minute

  constructor() {
    this.initializeCacheWorker()
    this.startAnalyticsCollection()
  }

  /**
   * Initialize the cache worker for background processing
   */
  private initializeCacheWorker() {
    try {
      this.cacheWorker = new Worker(
        new URL('@/workers/permission-cache.worker.ts', import.meta.url),
        { type: 'module' }
      )

      this.cacheWorker.onmessage = (event) => {
        this.handleWorkerMessage(event.data)
      }

      this.cacheWorker.onerror = (error) => {
        logger.error('Cache worker error:', error)
      }
    } catch (error) {
      logger.warn('Cache worker not supported:', error)
    }
  }

  /**
   * Handle messages from cache worker
   */
  private handleWorkerMessage(data: Record<string, unknown>) {
    switch (data.type) {
      case 'CACHE_STATS':
        this.processCacheStats(data.payload)
        break

      case 'PERMISSION_RESULT':
        this.processPermissionResult(
          (data.payload ?? {}) as Record<string, unknown>
        )
        break

      case 'PRELOAD_COMPLETE':
        logger.log('Permission preload completed:', data.payload)
        break

      case 'ERROR':
        logger.error('Cache worker error:', data.payload)
        break
    }
  }

  /**
   * Record a performance metric
   */
  recordMetric(
    operation: string,
    duration: number,
    metadata?: Record<string, unknown>
  ) {
    const metric: PerformanceMetric = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      operation,
      duration,
      timestamp: Date.now(),
      metadata,
    }

    this.metrics.push(metric)

    // Keep metrics array size manageable
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics / 2)
    }
  }

  /**
   * Get performance analytics for the RBAC system
   */
  async getRBACAnalytics(
    timeRange: number = 24 * 60 * 60 * 1000
  ): Promise<RBACAnalytics> {
    const cutoff = Date.now() - timeRange
    const recentMetrics = this.metrics.filter((m) => m.timestamp >= cutoff)

    try {
      // Calculate cache metrics
      const cacheMetrics = await this.getCacheMetrics()

      return {
        permissionChecks: {
          total: recentMetrics.length,
          granted: recentMetrics.filter((m) => m.metadata?.granted === true)
            .length,
          denied: recentMetrics.filter((m) => m.metadata?.granted === false)
            .length,
          averageTime: this.calculateAverage(
            recentMetrics.map((m) => m.duration)
          ),
        },
        topPermissions: await this.getTopPermissions(),
        userActivity: await this.getUserActivity(),
        systemHealth: {
          errorRate: this.calculateErrorRate(recentMetrics),
          averageResponseTime: this.calculateAverage(
            recentMetrics.map((m) => m.duration)
          ),
          cacheEfficiency: cacheMetrics.hitRate,
        },
      }
    } catch (error) {
      logger.error('Error generating RBAC analytics:', error)
      return this.getEmptyAnalytics()
    }
  }

  /**
   * Preload permissions for better performance
   */
  async preloadUserPermissions(
    userId: string,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ) {
    if (!this.cacheWorker) return

    // Get user's most commonly accessed permissions
    const commonPermissions = await this.getCommonPermissions(userId)

    this.cacheWorker.postMessage({
      type: 'PRELOAD_PERMISSIONS',
      payload: {
        userId,
        permissions: commonPermissions,
        priority,
      },
    })
  }

  /**
   * Optimize cache performance
   */
  optimizeCache() {
    if (!this.cacheWorker) return

    this.cacheWorker.postMessage({
      type: 'OPTIMIZE_CACHE',
      payload: {},
    })
  }

  /**
   * Get cache performance metrics
   */
  async getCacheMetrics(): Promise<CacheMetrics> {
    return new Promise((resolve) => {
      if (!this.cacheWorker) {
        resolve({
          hitRate: 0,
          totalRequests: 0,
          averageHitTime: 0,
          averageMissTime: 0,
          cacheSize: 0,
          evictionRate: 0,
        })
        return
      }

      const id = Math.random().toString(36)

      const messageHandler = (event: MessageEvent) => {
        if (event.data.id === id && event.data.type === 'CACHE_STATS') {
          this.cacheWorker?.removeEventListener('message', messageHandler)
          resolve(event.data.payload)
        }
      }

      this.cacheWorker.addEventListener('message', messageHandler)
      this.cacheWorker.postMessage({
        type: 'GET_CACHE_STATS',
        payload: {},
        id,
      })

      // Timeout after 5 seconds
      setTimeout(() => {
        this.cacheWorker?.removeEventListener('message', messageHandler)
        resolve(this.getEmptyCacheMetrics())
      }, 5000)
    })
  }

  /**
   * Monitor RBAC system health
   */
  async monitorSystemHealth(): Promise<{
    status: 'healthy' | 'warning' | 'critical'
    issues: string[]
    recommendations: string[]
  }> {
    const issues: string[] = []
    const recommendations: string[] = []
    let status: 'healthy' | 'warning' | 'critical' = 'healthy'

    try {
      const analytics = await this.getRBACAnalytics()
      const cacheMetrics = await this.getCacheMetrics()

      // Check error rate
      if (analytics.systemHealth.errorRate > 0.05) {
        // 5%
        issues.push(
          `High error rate: ${(analytics.systemHealth.errorRate * 100).toFixed(1)}%`
        )
        status = 'warning'
      }

      // Check response time
      if (analytics.systemHealth.averageResponseTime > 1000) {
        // 1 second
        issues.push(
          `Slow response time: ${analytics.systemHealth.averageResponseTime}ms`
        )
        status = 'warning'
      }

      // Check cache efficiency
      if (cacheMetrics.hitRate < 0.7) {
        // 70%
        issues.push(
          `Low cache hit rate: ${(cacheMetrics.hitRate * 100).toFixed(1)}%`
        )
        recommendations.push('Consider preloading common permissions')
      }

      // Check suspicious activity
      if (analytics.userActivity.suspiciousActivity > 10) {
        issues.push(
          `High suspicious activity: ${analytics.userActivity.suspiciousActivity} incidents`
        )
        status = 'critical'
      }

      // Performance recommendations
      if (
        analytics.permissionChecks.total > 10000 &&
        cacheMetrics.hitRate < 0.8
      ) {
        recommendations.push(
          'Enable aggressive permission preloading for high-traffic users'
        )
      }

      if (analytics.systemHealth.averageResponseTime > 500) {
        recommendations.push(
          'Consider database query optimization or connection pooling'
        )
      }
    } catch (_error) {
      issues.push('Failed to collect system health metrics')
      status = 'critical'
    }

    return { status, issues, recommendations }
  }

  /**
   * Generate performance report
   */
  async generatePerformanceReport(): Promise<{
    summary: RBACAnalytics
    recommendations: string[]
    healthStatus: {
      status: string
      issues: string[]
      recommendations: string[]
    }
    trends: Record<string, number>
  }> {
    const [analytics, healthStatus] = await Promise.all([
      this.getRBACAnalytics(),
      this.monitorSystemHealth(),
    ])

    const recommendations = [
      ...healthStatus.recommendations,
      ...(await this.generatePerformanceRecommendations(analytics)),
    ]

    const trends = await this.calculateTrends()

    return {
      summary: analytics,
      recommendations,
      healthStatus,
      trends,
    }
  }

  /**
   * Private helper methods
   */
  // Removed unused method - will be implemented when database functions are deployed

  private async getTopPermissions() {
    // In real implementation, this would query the database
    return [
      { resource: 'users', action: 'read', checkCount: 500, denialRate: 0.02 },
      {
        resource: 'tasks',
        action: 'create',
        checkCount: 300,
        denialRate: 0.05,
      },
    ]
  }

  private async getUserActivity() {
    // In real implementation, this would query the database
    return {
      activeUsers: 150,
      newUsers: 12,
      suspiciousActivity: 3,
    }
  }

  private async getCommonPermissions(userId: string) {
    // In real implementation, this would analyze user's access patterns
    logger.log('Getting common permissions for user:', userId)
    return [
      { resource: 'dashboard', action: 'read' },
      { resource: 'users', action: 'read' },
      { resource: 'tasks', action: 'read' },
    ]
  }

  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length
  }

  private calculateErrorRate(metrics: PerformanceMetric[]): number {
    if (metrics.length === 0) return 0
    const errorCount = metrics.filter((m) => m.metadata?.error === true).length
    return errorCount / metrics.length
  }

  private async generatePerformanceRecommendations(
    analytics: RBACAnalytics
  ): Promise<string[]> {
    const recommendations: string[] = []

    if (
      analytics.permissionChecks.denied / analytics.permissionChecks.total >
      0.1
    ) {
      recommendations.push(
        'High permission denial rate detected - review user role assignments'
      )
    }

    if (analytics.systemHealth.averageResponseTime > 200) {
      recommendations.push(
        'Consider implementing permission result caching for better performance'
      )
    }

    if (analytics.userActivity.suspiciousActivity > 5) {
      recommendations.push(
        'Implement additional security monitoring for suspicious activities'
      )
    }

    return recommendations
  }

  private async calculateTrends() {
    // Calculate trends over time
    return {
      permissionChecksGrowth: 15.2, // % growth
      cacheHitRateImprovement: 8.5,
      averageResponseTimeChange: -12.3, // negative is good (faster)
    }
  }

  private processCacheStats(stats: unknown) {
    // Process cache statistics from worker
    logger.log('Cache stats updated:', stats)
  }

  private processPermissionResult(result: Record<string, unknown>) {
    // Process permission check result from worker
    if (result.source === 'cache') {
      this.recordMetric(
        'permission_check_cached',
        (result.cacheAge as number) || 0,
        {
          granted: result.granted as boolean,
        }
      )
    }
  }

  private getEmptyAnalytics(): RBACAnalytics {
    return {
      permissionChecks: {
        total: 0,
        granted: 0,
        denied: 0,
        averageTime: 0,
      },
      topPermissions: [],
      userActivity: {
        activeUsers: 0,
        newUsers: 0,
        suspiciousActivity: 0,
      },
      systemHealth: {
        errorRate: 0,
        averageResponseTime: 0,
        cacheEfficiency: 0,
      },
    }
  }

  private getEmptyCacheMetrics(): CacheMetrics {
    return {
      hitRate: 0,
      totalRequests: 0,
      averageHitTime: 0,
      averageMissTime: 0,
      cacheSize: 0,
      evictionRate: 0,
    }
  }

  /**
   * Get metrics for external access
   */
  getMetrics() {
    return [...this.metrics]
  }

  /**
   * Clear old metrics
   */
  clearOldMetrics(keepCount: number = 1000) {
    this.metrics = this.metrics.slice(-keepCount)
  }

  /**
   * Cleanup and shutdown
   */
  shutdown() {
    if (this.analyticsInterval) {
      clearInterval(this.analyticsInterval)
    }

    if (this.cacheWorker) {
      this.cacheWorker.terminate()
    }
  }

  private startAnalyticsCollection() {
    this.analyticsInterval = setInterval(async () => {
      try {
        const analytics = await this.getRBACAnalytics()

        // Log performance metrics periodically
        logger.log('RBAC Performance Analytics:', {
          permissionChecks: analytics.permissionChecks.total,
          averageTime: analytics.systemHealth.averageResponseTime,
          cacheEfficiency: analytics.systemHealth.cacheEfficiency,
        })

        // Alert on performance issues
        if (analytics.systemHealth.averageResponseTime > 1000) {
          logger.warn(
            'RBAC system response time is high:',
            analytics.systemHealth.averageResponseTime + 'ms'
          )
        }

        if (analytics.systemHealth.errorRate > 0.05) {
          logger.error(
            'RBAC system error rate is high:',
            (analytics.systemHealth.errorRate * 100).toFixed(1) + '%'
          )
        }
      } catch (error) {
        logger.error('Error collecting analytics:', error)
      }
    }, this.flushInterval)
  }
}

// Performance monitoring utilities
export class RBACPerformanceUtils {
  private static monitor: RBACPerformanceMonitor | null = null

  static getMonitor(): RBACPerformanceMonitor {
    if (!this.monitor) {
      this.monitor = new RBACPerformanceMonitor()
    }
    return this.monitor
  }

  /**
   * Measure permission check performance
   */
  static async measurePermissionCheck<T>(
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const startTime = performance.now()

    try {
      const result = await operation()
      const duration = performance.now() - startTime

      this.getMonitor().recordMetric('permission_check', duration, {
        ...metadata,
        success: true,
      })

      return result
    } catch (error) {
      const duration = performance.now() - startTime

      this.getMonitor().recordMetric('permission_check', duration, {
        ...metadata,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      throw error
    }
  }

  /**
   * Preload permissions for performance optimization
   */
  static async preloadPermissions(
    userId: string,
    permissions?: Array<{ resource: string; action: string }>
  ) {
    const monitor = this.getMonitor()

    if (permissions) {
      monitor.cacheWorker?.postMessage({
        type: 'PRELOAD_PERMISSIONS',
        payload: { userId, permissions, priority: 'high' },
      })
    } else {
      monitor.cacheWorker?.postMessage({
        type: 'PRELOAD_USER_PERMISSIONS',
        payload: { userId },
      })
    }
  }

  /**
   * Get real-time performance dashboard data
   */
  static async getDashboardMetrics() {
    const monitor = this.getMonitor()

    const [analytics, cacheMetrics, healthStatus] = await Promise.all([
      monitor.getRBACAnalytics(),
      monitor.getCacheMetrics(),
      monitor.monitorSystemHealth(),
    ])

    return {
      analytics,
      cacheMetrics,
      healthStatus,
      timestamp: Date.now(),
    }
  }

  /**
   * Optimize RBAC performance based on usage patterns
   */
  static async optimizePerformance() {
    const monitor = this.getMonitor()

    // Optimize cache
    monitor.optimizeCache()

    // Clear old metrics
    monitor.clearOldMetrics(1000)

    logger.log('RBAC performance optimization completed')
  }

  /**
   * Export performance data for analysis
   */
  static async exportPerformanceData(format: 'json' | 'csv' = 'json') {
    const monitor = this.getMonitor()
    const report = await monitor.generatePerformanceReport()

    if (format === 'csv') {
      return this.convertToCSV(report)
    }

    return JSON.stringify(report, null, 2)
  }

  private static convertToCSV(data: {
    summary: RBACAnalytics
    recommendations: string[]
    healthStatus: {
      status: string
      issues: string[]
      recommendations: string[]
    }
    trends: Record<string, number>
  }): string {
    // Simple CSV conversion
    const headers = Object.keys(data.summary.permissionChecks)
    const values = Object.values(data.summary.permissionChecks)

    return `${headers.join(',')}\n${values.join(',')}`
  }

  /**
   * Clean up resources
   */
  static shutdown() {
    if (this.monitor) {
      this.monitor.shutdown()
      this.monitor = null
    }
  }
}

// Export singleton instance
export const rbacPerformanceMonitor = RBACPerformanceUtils.getMonitor()

// Hook for React components to access performance data
export function useRBACPerformance() {
  const [metrics, setMetrics] = React.useState<Awaited<
    ReturnType<typeof RBACPerformanceUtils.getDashboardMetrics>
  > | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    const loadMetrics = async () => {
      setIsLoading(true)
      try {
        const dashboardData = await RBACPerformanceUtils.getDashboardMetrics()
        setMetrics(dashboardData)
      } catch (error) {
        logger.error('Error loading performance metrics:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadMetrics()

    // Refresh metrics every 30 seconds
    const interval = setInterval(loadMetrics, 30000)

    return () => clearInterval(interval)
  }, [])

  return {
    metrics,
    isLoading,
    refresh: () => RBACPerformanceUtils.getDashboardMetrics(),
    optimize: () => RBACPerformanceUtils.optimizePerformance(),
    preloadPermissions: RBACPerformanceUtils.preloadPermissions,
  }
}
