// Created and developed by Jai Singh
/**
 * Enterprise Rate Limiter for OmniFrame RBAC System
 * High-performance rate limiting and DDoS protection for 100,000+ users
 * Integrates with Redis for distributed rate limiting across multiple instances
 */
import Redis from 'ioredis'
import { RateLimiterRedis } from 'rate-limiter-flexible'
import { logger } from '@/lib/utils/logger'

// ===== TYPES =====

interface RateLimitConfig {
  points: number // Number of requests
  duration: number // Time window in seconds
  blockDuration: number // Block duration in seconds
  execEvenly?: boolean // Spread requests evenly across duration
}

interface RateLimitResult {
  allowed: boolean
  totalRequests: number
  remainingPoints: number
  totalHits: number
  retryAfter?: number
}

interface RateLimitRule {
  name: string
  config: RateLimitConfig
  keyGenerator: (context: RateLimitContext) => string
  condition?: (context: RateLimitContext) => boolean
}

interface RateLimitContext {
  userId?: string
  ip: string
  userAgent?: string
  resource?: string
  action?: string
  role?: string
  riskLevel?: string
  sessionId?: string
}

interface SecurityMetrics {
  totalRequests: number
  blockedRequests: number
  suspiciousActivity: number
  ddosAttempts: number
  rateLimitHits: number
  lastUpdate: number
}

interface RateLimiterRejection {
  totalHits?: number
  msBeforeNext?: number
  remainingPoints?: number
  consumedPoints?: number
}

interface SecurityEventDetails {
  severity?: string
  totalRequests?: number
  blockDuration?: number
  rule?: string
  requestCount?: number
  threshold?: number
  [key: string]: unknown
}

interface RateLimitStatus {
  totalRequests: number
  remainingPoints: number
  totalHits: number
  isBlocked: boolean
}

interface MiddlewareRequest {
  user?: { id?: string; role?: string }
  ip?: string
  connection?: { remoteAddress?: string }
  headers: Record<string, string | string[] | undefined>
  route?: { path?: string }
  method: string
  sessionID?: string
}

interface MiddlewareResponse {
  status: (code: number) => MiddlewareResponse
  json: (body: unknown) => void
  set: (headers: Record<string, string>) => void
}

type MiddlewareNext = () => void

// ===== RATE LIMITER SERVICE =====

export class RateLimiterService {
  private static instance: RateLimiterService
  private redis!: Redis
  private limiters: Map<string, RateLimiterRedis> = new Map()
  private rules: RateLimitRule[] = []
  private metrics: SecurityMetrics
  private isInitialized = false

  private constructor() {
    this.metrics = {
      totalRequests: 0,
      blockedRequests: 0,
      suspiciousActivity: 0,
      ddosAttempts: 0,
      rateLimitHits: 0,
      lastUpdate: Date.now(),
    }
  }

  static getInstance(): RateLimiterService {
    if (!RateLimiterService.instance) {
      RateLimiterService.instance = new RateLimiterService()
    }
    return RateLimiterService.instance
  }

  /**
   * Initialize rate limiter with Redis connection
   */
  async initialize(): Promise<void> {
    try {
      logger.log('🚀 Initializing enterprise rate limiter...')

      const { getRedisConfig } = await import('@/lib/infra/redis-config')
      const config = getRedisConfig()
      this.redis = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        maxRetriesPerRequest: config.maxRetriesPerRequest,
      })

      // Initialize rate limiting rules
      await this.initializeRules()

      this.isInitialized = true
      logger.log('✅ Enterprise rate limiter initialized successfully')
    } catch (error) {
      logger.error('❌ Failed to initialize rate limiter:', error)
      throw error
    }
  }

  /**
   * Initialize comprehensive rate limiting rules
   */
  private async initializeRules(): Promise<void> {
    // Standard user rate limit: 100 requests per minute
    this.addRule({
      name: 'standard_user',
      config: {
        points: 100,
        duration: 60,
        blockDuration: 60,
        execEvenly: true,
      },
      keyGenerator: (ctx) => `user:${ctx.userId || ctx.ip}`,
      condition: (ctx) => !!ctx.userId,
    })

    // Anonymous/IP rate limit: 20 requests per minute
    this.addRule({
      name: 'anonymous_ip',
      config: {
        points: 20,
        duration: 60,
        blockDuration: 300, // 5 minutes block for anonymous
      },
      keyGenerator: (ctx) => `ip:${ctx.ip}`,
      condition: (ctx) => !ctx.userId,
    })

    // Permission check rate limit: 1000 requests per minute per user
    this.addRule({
      name: 'permission_check',
      config: {
        points: 1000,
        duration: 60,
        blockDuration: 30,
        execEvenly: true,
      },
      keyGenerator: (ctx) => `perm:${ctx.userId || ctx.ip}`,
      condition: (ctx) => !!(ctx.resource && ctx.action),
    })

    // Admin operations: 10 requests per minute
    this.addRule({
      name: 'admin_operations',
      config: {
        points: 10,
        duration: 60,
        blockDuration: 300,
      },
      keyGenerator: (ctx) => `admin:${ctx.userId}`,
      condition: (ctx) => ctx.role === 'superadmin' || ctx.role === 'admin',
    })

    // High-risk operations: 5 requests per minute
    this.addRule({
      name: 'high_risk_operations',
      config: {
        points: 5,
        duration: 60,
        blockDuration: 600, // 10 minutes
      },
      keyGenerator: (ctx) => `risk:${ctx.userId}`,
      condition: (ctx) =>
        ctx.riskLevel === 'high' || ctx.riskLevel === 'critical',
    })

    // Authentication attempts: 5 attempts per 5 minutes
    this.addRule({
      name: 'auth_attempts',
      config: {
        points: 5,
        duration: 300,
        blockDuration: 900, // 15 minutes
      },
      keyGenerator: (ctx) => `auth:${ctx.ip}`,
      condition: (ctx) => ctx.action === 'login' || ctx.action === 'signup',
    })

    // Password reset attempts: 3 attempts per hour
    this.addRule({
      name: 'password_reset',
      config: {
        points: 3,
        duration: 3600,
        blockDuration: 3600,
      },
      keyGenerator: (ctx) => `pwd_reset:${ctx.ip}`,
      condition: (ctx) => ctx.action === 'reset_password',
    })

    // DDoS protection: 1000 requests per minute per IP
    this.addRule({
      name: 'ddos_protection',
      config: {
        points: 1000,
        duration: 60,
        blockDuration: 1800, // 30 minutes
      },
      keyGenerator: (ctx) => `ddos:${ctx.ip}`,
    })

    // Suspicious activity: 50 failed attempts per hour
    this.addRule({
      name: 'suspicious_activity',
      config: {
        points: 50,
        duration: 3600,
        blockDuration: 7200, // 2 hours
      },
      keyGenerator: (ctx) => `suspicious:${ctx.userId || ctx.ip}`,
      condition: (ctx) =>
        ctx.action === 'failed_permission' || ctx.action === 'failed_auth',
    })

    logger.log(`✅ Initialized ${this.rules.length} rate limiting rules`)
  }

  /**
   * Add a rate limiting rule
   */
  private addRule(rule: RateLimitRule): void {
    this.rules.push(rule)

    const limiter = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: `rl:${rule.name}`,
      points: rule.config.points,
      duration: rule.config.duration,
      blockDuration: rule.config.blockDuration,
      execEvenly: rule.config.execEvenly || false,

      // Advanced options for enterprise use
      // enableLogging not supported in current version
    })

    this.limiters.set(rule.name, limiter)
  }

  /**
   * Check rate limit for a given context
   */
  async checkLimit(context: RateLimitContext): Promise<RateLimitResult> {
    if (!this.isInitialized) {
      logger.warn('Rate limiter not initialized, allowing request')
      return {
        allowed: true,
        totalRequests: 0,
        remainingPoints: 999,
        totalHits: 0,
      }
    }

    this.metrics.totalRequests++

    try {
      // Check all applicable rules
      const applicableRules = this.rules.filter(
        (rule) => !rule.condition || rule.condition(context)
      )

      logger.log(
        `Checking ${applicableRules.length} rate limit rules for context:`,
        {
          userId: context.userId,
          ip: context.ip,
          resource: context.resource,
          action: context.action,
        }
      )

      for (const rule of applicableRules) {
        const limiter = this.limiters.get(rule.name)
        if (!limiter) continue

        const key = rule.keyGenerator(context)

        try {
          const result = await limiter.consume(key)

          // Log rate limit hit for monitoring
          if (result.remainingPoints === 0) {
            logger.warn(`Rate limit hit for rule ${rule.name}, key: ${key}`)
            this.metrics.rateLimitHits++
          }
        } catch (rejRes: unknown) {
          // Rate limit exceeded
          const rejection = rejRes as RateLimiterRejection
          logger.warn(`Rate limit exceeded for rule ${rule.name}:`, {
            key,
            totalRequests: rejection.totalHits || 0,
            retryAfter:
              Math.round((rejection.totalHits || 0) / 1000) ||
              rule.config.blockDuration,
          })

          this.metrics.blockedRequests++

          // Check for DDoS patterns
          if (rule.name === 'ddos_protection') {
            this.metrics.ddosAttempts++
            await this.handleDDoSDetection(context, rejection)
          }

          // Check for suspicious activity
          if ((rejection.totalHits || 0) > rule.config.points * 2) {
            this.metrics.suspiciousActivity++
            await this.handleSuspiciousActivity(context, rule.name, rejection)
          }

          return {
            allowed: false,
            totalRequests: rejection.totalHits || 0,
            remainingPoints: 0,
            totalHits: rejection.totalHits || rule.config.blockDuration * 1000,
            retryAfter:
              Math.round((rejection.totalHits || 0) / 1000) ||
              rule.config.blockDuration,
          }
        }
      }

      // All rules passed
      return {
        allowed: true,
        totalRequests: 1,
        remainingPoints: 999, // Simplified - would show actual remaining from most restrictive rule
        totalHits: 0,
      }
    } catch (error) {
      logger.error('Rate limiter error:', error)
      // Fail open for availability
      return {
        allowed: true,
        totalRequests: 0,
        remainingPoints: 999,
        totalHits: 0,
      }
    }
  }

  /**
   * Handle DDoS detection and response
   */
  private async handleDDoSDetection(
    context: RateLimitContext,
    rejection: RateLimiterRejection
  ): Promise<void> {
    try {
      logger.error('🚨 DDoS attack detected:', {
        ip: context.ip,
        userAgent: context.userAgent,
        totalRequests: rejection.totalHits,
        timeWindow: 'last 60 seconds',
      })

      // Implement additional DDoS countermeasures
      await this.implementDDoSCountermeasures(context)

      // Log to security audit system
      await this.logSecurityEvent('ddos_detected', context, {
        severity: 'critical',
        totalRequests: rejection.totalHits,
        blockDuration: rejection.totalHits,
      })
    } catch (error) {
      logger.error('Error handling DDoS detection:', error)
    }
  }

  /**
   * Implement DDoS countermeasures
   */
  private async implementDDoSCountermeasures(
    context: RateLimitContext
  ): Promise<void> {
    try {
      // Add IP to temporary blacklist
      await this.redis.setex(`blacklist:${context.ip}`, 3600, 'ddos_protection')

      // Block entire IP range if pattern detected (simplified)
      const ipPrefix = context.ip.split('.').slice(0, 3).join('.')
      const blacklistedCount = await this.redis.keys(`blacklist:${ipPrefix}.*`)

      if (blacklistedCount.length > 10) {
        logger.warn(`🚨 Blacklisting IP range: ${ipPrefix}.*`)
        await this.redis.setex(
          `blacklist:range:${ipPrefix}`,
          7200,
          'ddos_range_block'
        )
      }

      // Alert administrators (simplified)
      logger.error(
        '🚨 ADMIN ALERT: DDoS countermeasures activated for IP:',
        context.ip
      )
    } catch (error) {
      logger.error('Error implementing DDoS countermeasures:', error)
    }
  }

  /**
   * Handle suspicious activity detection
   */
  private async handleSuspiciousActivity(
    context: RateLimitContext,
    ruleName: string,
    rejection: RateLimiterRejection
  ): Promise<void> {
    try {
      logger.warn('⚠️ Suspicious activity detected:', {
        rule: ruleName,
        userId: context.userId,
        ip: context.ip,
        requests: rejection.totalHits,
      })

      // Log suspicious activity for analysis
      await this.logSecurityEvent('suspicious_activity', context, {
        severity: 'warning',
        rule: ruleName,
        requestCount: rejection.totalHits,
        threshold: this.rules.find((r) => r.name === ruleName)?.config.points,
      })

      // If user-based, flag the account for review
      if (context.userId) {
        await this.redis.setex(
          `flagged_account:${context.userId}`,
          86400, // 24 hours
          JSON.stringify({
            reason: 'rate_limit_violation',
            rule: ruleName,
            timestamp: Date.now(),
            details: { requests: rejection.totalHits },
          })
        )
      }
    } catch (error) {
      logger.error('Error handling suspicious activity:', error)
    }
  }

  /**
   * Log security events for audit and analysis
   */
  private async logSecurityEvent(
    eventType: string,
    context: RateLimitContext,
    details: SecurityEventDetails
  ): Promise<void> {
    try {
      const event = {
        type: eventType,
        timestamp: Date.now(),
        context: {
          userId: context.userId,
          ip: context.ip,
          userAgent: context.userAgent,
          resource: context.resource,
          action: context.action,
          sessionId: context.sessionId,
        },
        details,
        severity: details.severity || 'info',
      }

      // Store in Redis for real-time analysis
      await this.redis.lpush('security_events', JSON.stringify(event))
      await this.redis.ltrim('security_events', 0, 10000) // Keep last 10k events

      // In production, this would also send to SIEM system
      logger.log(`Security event logged: ${eventType}`, event)
    } catch (error) {
      logger.error('Error logging security event:', error)
    }
  }

  /**
   * Check if IP/user is blacklisted
   */
  async isBlacklisted(ip: string, userId?: string): Promise<boolean> {
    try {
      // Check IP blacklist
      if (await this.redis.exists(`blacklist:${ip}`)) {
        return true
      }

      // Check IP range blacklist
      const ipPrefix = ip.split('.').slice(0, 3).join('.')
      if (await this.redis.exists(`blacklist:range:${ipPrefix}`)) {
        return true
      }

      // Check user blacklist
      if (userId && (await this.redis.exists(`blacklist:user:${userId}`))) {
        return true
      }

      return false
    } catch (error) {
      logger.error('Error checking blacklist:', error)
      return false // Fail open
    }
  }

  /**
   * Whitelist trusted IPs/users
   */
  async addToWhitelist(
    identifier: string,
    type: 'ip' | 'user',
    duration = 3600
  ): Promise<void> {
    try {
      await this.redis.setex(
        `whitelist:${type}:${identifier}`,
        duration,
        'trusted'
      )
      logger.log(`Added to whitelist: ${type}:${identifier}`)
    } catch (error) {
      logger.error('Error adding to whitelist:', error)
    }
  }

  /**
   * Check if IP/user is whitelisted
   */
  async isWhitelisted(ip: string, userId?: string): Promise<boolean> {
    try {
      // Check IP whitelist
      if (await this.redis.exists(`whitelist:ip:${ip}`)) {
        return true
      }

      // Check user whitelist
      if (userId && (await this.redis.exists(`whitelist:user:${userId}`))) {
        return true
      }

      return false
    } catch (error) {
      logger.error('Error checking whitelist:', error)
      return false
    }
  }

  /**
   * Get security metrics
   */
  getMetrics(): SecurityMetrics & { rulesCount: number } {
    return {
      ...this.metrics,
      rulesCount: this.rules.length,
    }
  }

  /**
   * Get rate limit status for a key
   */
  async getLimitStatus(
    context: RateLimitContext
  ): Promise<Record<string, RateLimitStatus>> {
    try {
      const results: Record<string, RateLimitStatus> = {}

      for (const rule of this.rules) {
        if (rule.condition && !rule.condition(context)) continue

        const limiter = this.limiters.get(rule.name)
        if (!limiter) continue

        const key = rule.keyGenerator(context)
        const res = await limiter.get(key)
        const resRecord = res as unknown as RateLimiterRejection | null

        results[rule.name] = {
          totalRequests: resRecord?.totalHits || 0,
          remainingPoints: res?.remainingPoints || rule.config.points,
          totalHits: resRecord?.totalHits || 0,
          isBlocked: (resRecord?.totalHits || 0) >= rule.config.points,
        }
      }

      return results
    } catch (error) {
      logger.error('Error getting limit status:', error)
      return {}
    }
  }

  /**
   * Clear rate limit for a key (admin function)
   */
  async clearLimit(
    context: RateLimitContext,
    ruleName?: string
  ): Promise<void> {
    try {
      const rulesToClear = ruleName
        ? this.rules.filter((r) => r.name === ruleName)
        : this.rules

      for (const rule of rulesToClear) {
        const limiter = this.limiters.get(rule.name)
        if (!limiter) continue

        const key = rule.keyGenerator(context)
        await limiter.delete(key)

        logger.log(`Cleared rate limit for rule ${rule.name}, key: ${key}`)
      }
    } catch (error) {
      logger.error('Error clearing rate limit:', error)
    }
  }

  /**
   * Health check for rate limiter
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'critical'
    message: string
    details: Record<string, unknown>
  }> {
    try {
      // Test Redis connectivity
      const start = Date.now()
      await this.redis.ping()
      const latency = Date.now() - start

      if (latency > 100) {
        return {
          status: 'degraded',
          message: 'High Redis latency affecting rate limiter',
          details: { latency, rulesCount: this.rules.length },
        }
      }

      return {
        status: 'healthy',
        message: 'Rate limiter operating normally',
        details: {
          latency,
          rulesCount: this.rules.length,
          metrics: this.getMetrics(),
        },
      }
    } catch (error) {
      return {
        status: 'critical',
        message: 'Rate limiter health check failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      if (this.redis) {
        await this.redis.quit()
      }
      this.limiters.clear()
      logger.log('✅ Rate limiter shut down gracefully')
    } catch (error) {
      logger.error('Rate limiter shutdown error:', error)
    }
  }
}

// ===== MIDDLEWARE INTEGRATION =====

/**
 * Express/FastAPI compatible rate limiting middleware
 */
export const createRateLimitMiddleware = (rateLimiter: RateLimiterService) => {
  return async (
    req: MiddlewareRequest,
    res: MiddlewareResponse,
    next: MiddlewareNext
  ) => {
    try {
      const context: RateLimitContext = {
        userId: req.user?.id,
        ip: req.ip || req.connection?.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] as string | undefined,
        resource: req.route?.path,
        action: req.method.toLowerCase(),
        role: req.user?.role,
        sessionId: req.sessionID,
      }

      // Check whitelist first
      if (await rateLimiter.isWhitelisted(context.ip, context.userId)) {
        return next()
      }

      // Check blacklist
      if (await rateLimiter.isBlacklisted(context.ip, context.userId)) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'IP or user is blacklisted',
          code: 'BLACKLISTED',
        })
      }

      // Check rate limits
      const result = await rateLimiter.checkLimit(context)

      if (!result.allowed) {
        return res.status(429).json({
          error: 'Too many requests',
          message: 'Rate limit exceeded',
          retryAfter: result.retryAfter,
          code: 'RATE_LIMITED',
        })
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': '100', // Simplified
        'X-RateLimit-Remaining': result.remainingPoints.toString(),
        'X-RateLimit-Reset': new Date(
          Date.now() + result.totalHits
        ).toISOString(),
      })

      next()
    } catch (error) {
      logger.error('Rate limiting middleware error:', error)
      // Fail open for availability
      next()
    }
  }
}

// Export singleton instance
export const rateLimiterService = RateLimiterService.getInstance()

// Export types
export type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitContext,
  RateLimitRule,
  SecurityMetrics,
}

// Created and developed by Jai Singh
