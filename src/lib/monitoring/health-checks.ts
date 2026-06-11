// Created and developed by Jai Singh
/**
 * Enterprise Health Check System for OmniFrame RBAC
 * Comprehensive health monitoring for all system components
 * Designed for enterprise-grade uptime and reliability monitoring
 */
import { useState, useEffect } from 'react'
import { auditService } from '@/lib/audit/audit-service'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { distributedCacheService } from '@/lib/cache/redis-cache-service'
import type { PostgrestResponse } from '@/lib/database/connection-pool'
import { databaseConnectionPool } from '@/lib/database/connection-pool'
import { rateLimiterService } from '@/lib/security/rate-limiter'
import { logger } from '@/lib/utils/logger'
import { performanceTracker } from './performance-tracker'

// ===== TYPES =====

interface HealthCheck {
  name: string
  status: 'healthy' | 'degraded' | 'critical'
  message: string
  responseTime: number
  details?: Record<string, unknown>
  lastChecked: number
  uptime?: number
  dependencies?: string[]
}

interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'critical'
  message: string
  timestamp: number
  checks: Record<string, HealthCheck>
  summary: {
    healthyCount: number
    degradedCount: number
    criticalCount: number
    totalChecks: number
    averageResponseTime: number
  }
  uptime: number
}

interface HealthCheckConfig {
  name: string
  checkFunction: () => Promise<HealthCheck>
  interval: number
  timeout: number
  retries: number
  critical: boolean
}

interface UptimeData {
  component: string
  startTime: number
  lastDowntime?: number
  downtimeTotal: number
  uptimePercentage: number
}

// ===== HEALTH CHECK SERVICE =====

export class HealthCheckService {
  private static instance: HealthCheckService
  private checks: Map<string, HealthCheckConfig> = new Map()
  private lastResults: Map<string, HealthCheck> = new Map()
  private checkIntervals: Map<string, NodeJS.Timeout> = new Map()
  private uptimeTracking: Map<string, UptimeData> = new Map()
  private systemStartTime = Date.now()

  private constructor() {
    // Initialize uptime tracking for key components
    const components = [
      'redis_cache',
      'database_pool',
      'auth_system',
      'permission_system',
      'rate_limiter',
      'audit_service',
      'performance_tracker',
    ]

    components.forEach((component) => {
      this.uptimeTracking.set(component, {
        component,
        startTime: Date.now(),
        downtimeTotal: 0,
        uptimePercentage: 100,
      })
    })
  }

  static getInstance(): HealthCheckService {
    if (!HealthCheckService.instance) {
      HealthCheckService.instance = new HealthCheckService()
    }
    return HealthCheckService.instance
  }

  /**
   * Initialize health check system
   */
  async initialize(): Promise<void> {
    try {
      logger.log('🚀 Initializing enterprise health check system...')

      // Register all health checks
      this.registerHealthChecks()

      // Start all health check intervals
      this.startAllHealthChecks()

      // Initial health check run
      await this.runAllChecks()

      // Health check service initialized
      logger.log('✅ Enterprise health check system initialized successfully')
    } catch (error) {
      logger.error('❌ Failed to initialize health check system:', error)
      throw error
    }
  }

  /**
   * Register all system health checks
   */
  private registerHealthChecks(): void {
    // Redis cache health check
    this.registerCheck({
      name: 'redis_cache',
      checkFunction: async () => {
        const start = Date.now()
        try {
          const health = await distributedCacheService.healthCheck()
          return {
            name: 'redis_cache',
            status:
              health.status === 'warning'
                ? 'degraded'
                : (health.status as 'healthy' | 'degraded' | 'critical'),
            message: health.message,
            responseTime: Date.now() - start,
            details: health.details,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('redis_cache'),
          }
        } catch (error) {
          return {
            name: 'redis_cache',
            status: 'critical',
            message:
              error instanceof Error
                ? error.message
                : 'Redis health check failed',
            responseTime: Date.now() - start,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('redis_cache'),
          }
        }
      },
      interval: 30000, // 30 seconds
      timeout: 5000, // 5 seconds
      retries: 2,
      critical: true,
    })

    // Database connection pool health check
    this.registerCheck({
      name: 'database_pool',
      checkFunction: async () => {
        const start = Date.now()
        try {
          const health = await databaseConnectionPool.healthCheck()
          return {
            name: 'database_pool',
            status: health.status,
            message: health.message,
            responseTime: Date.now() - start,
            details: health.details,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('database_pool'),
            dependencies: ['supabase'],
          }
        } catch (error) {
          return {
            name: 'database_pool',
            status: 'critical',
            message:
              error instanceof Error
                ? error.message
                : 'Database health check failed',
            responseTime: Date.now() - start,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('database_pool'),
          }
        }
      },
      interval: 15000, // 15 seconds
      timeout: 10000, // 10 seconds
      retries: 3,
      critical: true,
    })

    // Authentication system health check
    this.registerCheck({
      name: 'auth_system',
      checkFunction: async () => {
        const start = Date.now()
        try {
          // Test auth system by checking session
          const { data, error } = await singletonAuthManager
            .getSupabaseClient()
            .auth.getSession()

          return {
            name: 'auth_system',
            status: error ? 'degraded' : 'healthy',
            message: error
              ? 'Auth system issues detected'
              : 'Authentication system operational',
            responseTime: Date.now() - start,
            details: { hasSession: !!data.session, error: error?.message },
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('auth_system'),
          }
        } catch (error) {
          return {
            name: 'auth_system',
            status: 'critical',
            message:
              error instanceof Error
                ? error.message
                : 'Auth system check failed',
            responseTime: Date.now() - start,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('auth_system'),
          }
        }
      },
      interval: 60000, // 1 minute
      timeout: 5000,
      retries: 2,
      critical: true,
    })

    // Permission system health check
    this.registerCheck({
      name: 'permission_system',
      checkFunction: async () => {
        const start = Date.now()
        try {
          // Test permission system by checking a basic permission
          const testUserId = '00000000-0000-0000-0000-000000000000' // Test UUID
          const { data, error } = await databaseConnectionPool.executeRead(
            async (client) =>
              (
                client as unknown as {
                  rpc: (
                    fn: string,
                    params: Record<string, unknown>
                  ) => Promise<PostgrestResponse<unknown>>
                }
              ).rpc('check_user_permission_fast', {
                p_user_id: testUserId,
                p_resource: 'test',
                p_action: 'read',
              })
          )

          return {
            name: 'permission_system',
            status: error ? 'degraded' : 'healthy',
            message: error
              ? 'Permission system issues detected'
              : 'Permission system operational',
            responseTime: Date.now() - start,
            details: { testResult: data, error: error?.message },
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('permission_system'),
            dependencies: ['database_pool', 'redis_cache'],
          }
        } catch (error) {
          return {
            name: 'permission_system',
            status: 'critical',
            message:
              error instanceof Error
                ? error.message
                : 'Permission system check failed',
            responseTime: Date.now() - start,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('permission_system'),
          }
        }
      },
      interval: 45000, // 45 seconds
      timeout: 8000,
      retries: 2,
      critical: true,
    })

    // Rate limiter health check
    this.registerCheck({
      name: 'rate_limiter',
      checkFunction: async () => {
        const start = Date.now()
        try {
          const health = await rateLimiterService.healthCheck()
          return {
            name: 'rate_limiter',
            status: health.status,
            message: health.message,
            responseTime: Date.now() - start,
            details: health.details,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('rate_limiter'),
          }
        } catch (error) {
          return {
            name: 'rate_limiter',
            status: 'critical',
            message:
              error instanceof Error
                ? error.message
                : 'Rate limiter check failed',
            responseTime: Date.now() - start,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('rate_limiter'),
          }
        }
      },
      interval: 60000, // 1 minute
      timeout: 5000,
      retries: 2,
      critical: false,
    })

    // Audit service health check
    this.registerCheck({
      name: 'audit_service',
      checkFunction: async () => {
        const start = Date.now()
        try {
          const health = await auditService.healthCheck()
          return {
            name: 'audit_service',
            status: health.status,
            message: health.message,
            responseTime: Date.now() - start,
            details: health.details,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('audit_service'),
          }
        } catch (error) {
          return {
            name: 'audit_service',
            status: 'degraded',
            message:
              error instanceof Error
                ? error.message
                : 'Audit service check failed',
            responseTime: Date.now() - start,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('audit_service'),
          }
        }
      },
      interval: 120000, // 2 minutes
      timeout: 5000,
      retries: 1,
      critical: false,
    })

    // Performance tracker health check
    this.registerCheck({
      name: 'performance_tracker',
      checkFunction: async () => {
        const start = Date.now()
        try {
          const health = await performanceTracker.healthCheck()
          return {
            name: 'performance_tracker',
            status: health.status,
            message: health.message,
            responseTime: Date.now() - start,
            details: health.details,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('performance_tracker'),
          }
        } catch (error) {
          return {
            name: 'performance_tracker',
            status: 'degraded',
            message:
              error instanceof Error
                ? error.message
                : 'Performance tracker check failed',
            responseTime: Date.now() - start,
            lastChecked: Date.now(),
            uptime: this.getUptimePercentage('performance_tracker'),
          }
        }
      },
      interval: 180000, // 3 minutes
      timeout: 5000,
      retries: 1,
      critical: false,
    })

    logger.log(`✅ Registered ${this.checks.size} health check configurations`)
  }

  /**
   * Register a health check
   */
  private registerCheck(config: HealthCheckConfig): void {
    this.checks.set(config.name, config)
  }

  /**
   * Start all health checks
   */
  private startAllHealthChecks(): void {
    for (const [name, config] of this.checks.entries()) {
      this.startHealthCheck(name, config)
    }
  }

  /**
   * Start individual health check interval
   */
  private startHealthCheck(name: string, config: HealthCheckConfig): void {
    const interval = setInterval(async () => {
      await this.runHealthCheck(name, config)
    }, config.interval)

    this.checkIntervals.set(name, interval)
  }

  /**
   * Run individual health check with retry logic
   */
  private async runHealthCheck(
    name: string,
    config: HealthCheckConfig
  ): Promise<HealthCheck> {
    let lastError: unknown = null

    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        const result = (await Promise.race([
          config.checkFunction(),
          this.createTimeoutPromise(
            config.timeout,
            `${name} health check timeout`
          ),
        ])) as HealthCheck

        // Update uptime tracking
        this.updateUptime(name, result.status)

        // Store result
        this.lastResults.set(name, result)

        // Log status changes
        const previousResult = this.lastResults.get(name)
        if (previousResult && previousResult.status !== result.status) {
          logger.log(
            `🔄 Health status change: ${name} ${previousResult.status} → ${result.status}`
          )
        }

        return result
      } catch (error) {
        lastError = error
        logger.warn(
          `Health check ${name} attempt ${attempt + 1} failed:`,
          error
        )

        if (attempt < config.retries) {
          await this.delay(1000 * Math.pow(2, attempt)) // Exponential backoff
        }
      }
    }

    // All attempts failed
    const failedResult: HealthCheck = {
      name,
      status: 'critical',
      message:
        lastError instanceof Error
          ? lastError.message
          : 'Health check failed after retries',
      responseTime: config.timeout,
      lastChecked: Date.now(),
      uptime: this.getUptimePercentage(name),
    }

    this.updateUptime(name, 'critical')
    this.lastResults.set(name, failedResult)

    return failedResult
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<SystemHealth> {
    const start = Date.now()
    const checkResults: Record<string, HealthCheck> = {}

    try {
      // Run all checks in parallel
      const checkPromises = Array.from(this.checks.entries()).map(
        async ([name, config]) => {
          const result = await this.runHealthCheck(name, config)
          checkResults[name] = result
          return result
        }
      )

      await Promise.allSettled(checkPromises)

      // Calculate overall status
      const results = Object.values(checkResults)
      const healthyCount = results.filter((r) => r.status === 'healthy').length
      const degradedCount = results.filter(
        (r) => r.status === 'degraded'
      ).length
      const criticalCount = results.filter(
        (r) => r.status === 'critical'
      ).length

      // Determine overall status based on critical components
      let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy'

      // If any critical component is down, system is critical
      const criticalComponents = Array.from(this.checks.values())
        .filter((c) => c.critical)
        .map((c) => c.name)

      const criticalComponentsDown = results.filter(
        (r) => criticalComponents.includes(r.name) && r.status === 'critical'
      )

      if (criticalComponentsDown.length > 0) {
        overallStatus = 'critical'
      } else if (criticalCount > 0 || degradedCount > results.length * 0.3) {
        overallStatus = 'degraded'
      }

      const systemHealth: SystemHealth = {
        overall: overallStatus,
        message: this.getStatusMessage(
          overallStatus,
          healthyCount,
          degradedCount,
          criticalCount
        ),
        timestamp: Date.now(),
        checks: checkResults,
        summary: {
          healthyCount,
          degradedCount,
          criticalCount,
          totalChecks: results.length,
          averageResponseTime:
            results.reduce((acc, r) => acc + r.responseTime, 0) /
            results.length,
        },
        uptime: this.getSystemUptime(),
      }

      // Log overall status
      if (overallStatus !== 'healthy') {
        logger.warn(`⚠️ System health ${overallStatus}:`, systemHealth.message)
      }

      return systemHealth
    } catch (error) {
      logger.error('Error running health checks:', error)

      return {
        overall: 'critical',
        message: 'Health check system failure',
        timestamp: Date.now(),
        checks: checkResults,
        summary: {
          healthyCount: 0,
          degradedCount: 0,
          criticalCount: 1,
          totalChecks: 1,
          averageResponseTime: Date.now() - start,
        },
        uptime: this.getSystemUptime(),
      }
    }
  }

  /**
   * Get health status for specific component
   */
  getComponentHealth(componentName: string): HealthCheck | null {
    return this.lastResults.get(componentName) || null
  }

  /**
   * Get all component health status
   */
  getAllComponentHealth(): Record<string, HealthCheck> {
    const results: Record<string, HealthCheck> = {}
    for (const [name, result] of this.lastResults.entries()) {
      results[name] = result
    }
    return results
  }

  /**
   * Get uptime statistics
   */
  getUptimeStats(): Record<string, UptimeData> {
    const stats: Record<string, UptimeData> = {}
    for (const [component, data] of this.uptimeTracking.entries()) {
      stats[component] = { ...data }
    }
    return stats
  }

  /**
   * Get system-wide health dashboard data
   */
  async getHealthDashboard(): Promise<{
    systemHealth: SystemHealth
    uptimeStats: Record<string, UptimeData>
    performanceMetrics: Record<string, unknown>
    recentAlerts: unknown[]
  }> {
    try {
      const [systemHealth, performanceMetrics] = await Promise.all([
        this.runAllChecks(),
        performanceTracker.getPerformanceSummary(1),
      ])

      return {
        systemHealth,
        uptimeStats: this.getUptimeStats(),
        performanceMetrics: performanceMetrics.summary,
        recentAlerts: performanceMetrics.alerts.slice(0, 10),
      }
    } catch (error) {
      logger.error('Error generating health dashboard:', error)
      throw error
    }
  }

  /**
   * Health check endpoint for external monitoring
   */
  async getHealthCheckEndpoint(): Promise<{
    status: 'up' | 'down' | 'degraded'
    timestamp: string
    version: string
    uptime: number
    checks: Record<string, unknown>
  }> {
    try {
      const health = await this.runAllChecks()

      return {
        status:
          health.overall === 'healthy'
            ? 'up'
            : health.overall === 'degraded'
              ? 'degraded'
              : 'down',
        timestamp: new Date().toISOString(),
        version: '1.0.0', // Could get from package.json
        uptime: health.uptime,
        checks: Object.fromEntries(
          Object.entries(health.checks).map(([name, check]) => [
            name,
            {
              status: check.status,
              responseTime: check.responseTime,
              message: check.message,
            },
          ])
        ),
      }
    } catch (error) {
      return {
        status: 'down',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        uptime: 0,
        checks: {
          error: {
            status: 'critical',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      }
    }
  }

  /**
   * Update uptime tracking
   */
  private updateUptime(component: string, status: string): void {
    const uptimeData = this.uptimeTracking.get(component)
    if (!uptimeData) return

    const now = Date.now()
    const totalRunTime = now - uptimeData.startTime

    if (status === 'critical') {
      // Component is down
      if (!uptimeData.lastDowntime) {
        uptimeData.lastDowntime = now
      }
    } else {
      // Component is up
      if (uptimeData.lastDowntime) {
        // Was down, now up - add downtime
        const downDuration = now - uptimeData.lastDowntime
        uptimeData.downtimeTotal += downDuration
        uptimeData.lastDowntime = undefined
      }
    }

    // Calculate uptime percentage
    const totalUptime = totalRunTime - uptimeData.downtimeTotal
    uptimeData.uptimePercentage = (totalUptime / totalRunTime) * 100

    this.uptimeTracking.set(component, uptimeData)
  }

  /**
   * Get uptime percentage for component
   */
  private getUptimePercentage(component: string): number {
    const data = this.uptimeTracking.get(component)
    return data?.uptimePercentage || 100
  }

  /**
   * Get system uptime since start
   */
  private getSystemUptime(): number {
    return Date.now() - this.systemStartTime
  }

  /**
   * Get status message
   */
  private getStatusMessage(
    status: string,
    healthy: number,
    degraded: number,
    critical: number
  ): string {
    if (status === 'healthy') {
      return `All systems operational (${healthy}/${healthy + degraded + critical} healthy)`
    } else if (status === 'degraded') {
      return `System degraded: ${degraded} warnings, ${critical} critical issues`
    } else {
      return `System critical: ${critical} critical issues require immediate attention`
    }
  }

  /**
   * Create timeout promise
   */
  private createTimeoutPromise<T>(
    timeoutMs: number,
    message: string
  ): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    })
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      // Stop all health check intervals
      for (const interval of this.checkIntervals.values()) {
        clearInterval(interval)
      }

      // Redis connections are handled by respective services

      logger.log('✅ Health check service shut down gracefully')
    } catch (error) {
      logger.error('Health check service shutdown error:', error)
    }
  }
}

// ===== HEALTH CHECK MIDDLEWARE =====

/**
 * Middleware to expose health check endpoint
 */
interface MiddlewareRequest {
  path: string
}

interface MiddlewareResponse {
  status: (code: number) => MiddlewareResponse
  json: (body: unknown) => void
}

type MiddlewareNext = () => void

export const createHealthCheckMiddleware = (
  healthService: HealthCheckService
) => {
  return async (
    req: MiddlewareRequest,
    res: MiddlewareResponse,
    next: MiddlewareNext
  ) => {
    if (req.path === '/health' || req.path === '/health/') {
      try {
        const health = await healthService.getHealthCheckEndpoint()
        const statusCode =
          health.status === 'up'
            ? 200
            : health.status === 'degraded'
              ? 503
              : 503

        res.status(statusCode).json(health)
      } catch (error) {
        res.status(503).json({
          status: 'down',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    } else {
      next()
    }
  }
}

// ===== HEALTH CHECK REACT HOOK =====

/**
 * React hook for component-level health monitoring
 */
export const useHealthCheck = (componentName?: string) => {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const checkHealth = async () => {
      try {
        setIsLoading(true)
        const healthData = await healthCheckService.runAllChecks()

        if (mounted) {
          setHealth(healthData)
        }
      } catch (error) {
        logger.error('Health check error:', error)
        if (mounted) {
          setHealth(null)
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    // Initial check
    checkHealth()

    // Periodic checks
    const interval = setInterval(checkHealth, 30000) // Every 30 seconds

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [componentName])

  return {
    health,
    isLoading,
    specificComponent: componentName ? health?.checks[componentName] : null,
  }
}

// Export singleton instance
export const healthCheckService = HealthCheckService.getInstance()

// Export types
export type { HealthCheck, SystemHealth, HealthCheckConfig, UptimeData }

// Created and developed by Jai Singh
