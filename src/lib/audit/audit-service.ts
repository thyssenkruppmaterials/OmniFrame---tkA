// Created and developed by Jai Singh
/**
 * Enterprise Audit Service for OmniFrame RBAC System
 * Comprehensive audit logging, anomaly detection, and security monitoring
 * Designed for enterprise compliance and high-volume audit requirements
 */
import Redis from 'ioredis'
import { databaseConnectionPool } from '@/lib/database/connection-pool'
import { logger } from '@/lib/utils/logger'

// ===== TYPES =====

interface AuditEvent {
  id: string
  timestamp: string
  event_type: string
  user_id?: string
  session_id?: string
  resource?: string
  action?: string
  resource_id?: string
  granted: boolean
  source: string
  duration: number
  ip_address?: string
  user_agent?: string
  context?: Record<string, unknown>
  risk_score?: number
  severity: 'info' | 'warning' | 'error' | 'critical'
}

interface AuditContext {
  userId?: string
  sessionId?: string
  ip?: string
  userAgent?: string
  resource?: string
  action?: string
  resourceId?: string
  additionalContext?: Record<string, unknown>
}

interface AnomalyDetection {
  type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  confidence: number
  details: string
  evidence: Record<string, unknown>
  timestamp: number
}

interface SecurityAlert {
  id: string
  alert_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  user_id?: string
  description: string
  details: Record<string, unknown>
  risk_score: number
  created_at: string
  resolved_at?: string
  resolution_notes?: string
}

interface AuditMetrics {
  totalEvents: number
  eventsPerSecond: number
  anomaliesDetected: number
  criticalAlertsActive: number
  averageProcessingTime: number
  queueSize: number
  storageUsage: number
  lastFlush: number
}

// ===== AUDIT SERVICE =====

export class AuditService {
  private static instance: AuditService
  private redis!: Redis
  private auditQueue: AuditEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private processingIntervals: NodeJS.Timeout[] = []
  private anomalyDetectors: Map<
    string,
    (events: AuditEvent[]) => AnomalyDetection[]
  > = new Map()
  private metrics: AuditMetrics
  private readonly FLUSH_INTERVAL = 1000 // 1 second
  private readonly BATCH_SIZE = 1000
  private readonly MAX_QUEUE_SIZE = 10000
  private readonly ANOMALY_WINDOW = 5 * 60 * 1000 // 5 minutes

  private constructor() {
    this.metrics = {
      totalEvents: 0,
      eventsPerSecond: 0,
      anomaliesDetected: 0,
      criticalAlertsActive: 0,
      averageProcessingTime: 0,
      queueSize: 0,
      storageUsage: 0,
      lastFlush: 0,
    }
  }

  static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService()
    }
    return AuditService.instance
  }

  /**
   * Initialize audit service
   */
  async initialize(): Promise<void> {
    try {
      logger.log('🚀 Initializing enterprise audit service...')

      const { getRedisConfig } = await import('@/lib/infra/redis-config')
      const config = getRedisConfig()
      this.redis = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        maxRetriesPerRequest: config.maxRetriesPerRequest,
      })

      // Initialize anomaly detection algorithms
      this.initializeAnomalyDetectors()

      // Start audit processing
      this.startAuditProcessing()

      // Start anomaly detection background process
      this.startAnomalyDetection()

      // Service initialized successfully
      logger.log('✅ Enterprise audit service initialized successfully')
    } catch (error) {
      logger.error('❌ Failed to initialize audit service:', error)
      throw error
    }
  }

  /**
   * Log permission check event
   */
  async logPermissionCheck(data: {
    userId?: string
    resource: string
    action: string
    granted: boolean
    source: string
    duration: number
    context?: AuditContext
  }): Promise<void> {
    const auditEntry: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      event_type: 'PERMISSION_CHECK',
      user_id: data.userId,
      session_id: data.context?.sessionId,
      resource: data.resource,
      action: data.action,
      granted: data.granted,
      source: data.source,
      duration: data.duration,
      ip_address: data.context?.ip,
      user_agent: data.context?.userAgent,
      context: data.context?.additionalContext,
      risk_score: this.calculateRiskScore(data),
      severity: data.granted ? 'info' : 'warning',
    }

    await this.queueAuditEvent(auditEntry)
  }

  /**
   * Log authentication event
   */
  async logAuthEvent(data: {
    userId?: string
    eventType:
      | 'login'
      | 'logout'
      | 'signup'
      | 'password_reset'
      | 'session_expired'
    success: boolean
    context?: AuditContext
    details?: Record<string, unknown>
  }): Promise<void> {
    const auditEntry: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      event_type: `AUTH_${data.eventType.toUpperCase()}`,
      user_id: data.userId,
      session_id: data.context?.sessionId,
      resource: 'auth',
      action: data.eventType,
      granted: data.success,
      source: 'auth_service',
      duration: 0,
      ip_address: data.context?.ip,
      user_agent: data.context?.userAgent,
      context: data.details,
      risk_score: data.success ? 0 : 25,
      severity: data.success ? 'info' : 'warning',
    }

    await this.queueAuditEvent(auditEntry)
  }

  /**
   * Log security event
   */
  async logSecurityEvent(data: {
    eventType: string
    severity: 'info' | 'warning' | 'error' | 'critical'
    description: string
    context?: AuditContext
    details?: Record<string, unknown>
    riskScore?: number
  }): Promise<void> {
    const auditEntry: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      event_type: `SECURITY_${data.eventType.toUpperCase()}`,
      user_id: data.context?.userId,
      session_id: data.context?.sessionId,
      resource: 'security',
      action: data.eventType,
      granted: false, // Security events are typically violations
      source: 'security_service',
      duration: 0,
      ip_address: data.context?.ip,
      user_agent: data.context?.userAgent,
      context: { description: data.description, ...data.details },
      risk_score: data.riskScore || this.calculateSecurityRiskScore(data),
      severity: data.severity,
    }

    await this.queueAuditEvent(auditEntry)

    // Immediately create security alert for high-severity events
    if (data.severity === 'critical' || data.severity === 'error') {
      await this.createSecurityAlert(auditEntry)
    }
  }

  /**
   * Queue audit event for batch processing
   */
  private async queueAuditEvent(event: AuditEvent): Promise<void> {
    this.auditQueue.push(event)
    this.metrics.totalEvents++
    this.metrics.queueSize = this.auditQueue.length

    // Prevent memory overflow
    if (this.auditQueue.length > this.MAX_QUEUE_SIZE) {
      logger.warn('⚠️ Audit queue overflow, forcing immediate flush')
      await this.flush()
    }

    this.scheduleFlush()
  }

  /**
   * Schedule batch flush
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flush()
      this.flushTimer = null
    }, this.FLUSH_INTERVAL)
  }

  /**
   * Flush audit events to storage
   */
  private async flush(): Promise<void> {
    if (this.auditQueue.length === 0) return

    const startTime = Date.now()
    const batch = this.auditQueue.splice(0, this.BATCH_SIZE)

    try {
      // Store in database
      await this.storeBatchInDatabase(batch)

      // Store in Redis for real-time analysis
      await this.storeBatchInRedis(batch)

      this.metrics.lastFlush = Date.now()
      this.metrics.queueSize = this.auditQueue.length
      this.metrics.averageProcessingTime =
        (this.metrics.averageProcessingTime + (Date.now() - startTime)) / 2

      logger.log(
        `✅ Flushed ${batch.length} audit events (${Date.now() - startTime}ms)`
      )
    } catch (error) {
      logger.error('❌ Failed to flush audit events:', error)
      // Re-queue events for retry
      this.auditQueue.unshift(...batch)
    }
  }

  /**
   * Store batch in database
   */
  private async storeBatchInDatabase(batch: AuditEvent[]): Promise<void> {
    try {
      const { error } = await databaseConnectionPool.executeWrite(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (client: any) =>
          await client.from('rbac_audit_logs').insert(
            batch.map((event) => ({
              actor_id: event.user_id,
              action: event.event_type,
              target_type: event.resource || 'unknown',
              target_id: event.resource_id,
              new_value: {
                ...event.context,
                granted: event.granted,
                source: event.source,
                duration: event.duration,
                ip_address: event.ip_address,
                user_agent: event.user_agent,
                risk_score: event.risk_score,
              },
              severity: event.severity,
              session_id: event.session_id,
              created_at: event.timestamp,
            }))
          )
      )

      if (error) throw error
    } catch (error) {
      logger.error('Database audit storage error:', error)
      throw error
    }
  }

  /**
   * Store batch in Redis for real-time analysis
   */
  private async storeBatchInRedis(batch: AuditEvent[]): Promise<void> {
    try {
      const pipeline = this.redis.pipeline()

      batch.forEach((event) => {
        // Store in time-series lists for different analysis
        pipeline.lpush('audit:all', JSON.stringify(event))
        pipeline.lpush(
          `audit:user:${event.user_id || 'anonymous'}`,
          JSON.stringify(event)
        )
        pipeline.lpush(
          `audit:resource:${event.resource}`,
          JSON.stringify(event)
        )

        // Keep only recent events in Redis (last 24 hours)
        pipeline.ltrim('audit:all', 0, 100000)
        pipeline.ltrim(`audit:user:${event.user_id || 'anonymous'}`, 0, 10000)
        pipeline.ltrim(`audit:resource:${event.resource}`, 0, 10000)

        // Set expiration for automatic cleanup
        pipeline.expire(`audit:user:${event.user_id || 'anonymous'}`, 86400) // 24 hours
        pipeline.expire(`audit:resource:${event.resource}`, 86400)
      })

      await pipeline.exec()
    } catch (error) {
      logger.error('Redis audit storage error:', error)
      // Don't throw - database storage is primary
    }
  }

  /**
   * Initialize anomaly detection algorithms
   */
  private initializeAnomalyDetectors(): void {
    // Permission scanning detector
    this.anomalyDetectors.set('permission_scanning', (events: AuditEvent[]) => {
      const permissionEvents = events.filter(
        (e) => e.event_type === 'PERMISSION_CHECK'
      )
      const uniqueResources = new Set(permissionEvents.map((e) => e.resource))

      if (uniqueResources.size > 50) {
        return [
          {
            type: 'PERMISSION_SCANNING',
            severity: 'high',
            confidence: Math.min(uniqueResources.size / 100, 1),
            details: `User checked ${uniqueResources.size} different resources in ${this.ANOMALY_WINDOW / 1000} seconds`,
            evidence: {
              unique_resources: uniqueResources.size,
              total_checks: permissionEvents.length,
              time_window: this.ANOMALY_WINDOW / 1000,
            },
            timestamp: Date.now(),
          },
        ]
      }
      return []
    })

    // Repeated denials detector
    this.anomalyDetectors.set('repeated_denials', (events: AuditEvent[]) => {
      const denials = events.filter((e) => !e.granted)

      if (denials.length > 20) {
        return [
          {
            type: 'REPEATED_DENIALS',
            severity: 'medium',
            confidence: Math.min(denials.length / 50, 1),
            details: `User had ${denials.length} permission denials in ${this.ANOMALY_WINDOW / 1000} seconds`,
            evidence: {
              denial_count: denials.length,
              denied_resources: [...new Set(denials.map((e) => e.resource))],
              time_window: this.ANOMALY_WINDOW / 1000,
            },
            timestamp: Date.now(),
          },
        ]
      }
      return []
    })

    // Privilege escalation detector
    this.anomalyDetectors.set(
      'privilege_escalation',
      (events: AuditEvent[]) => {
        const adminEvents = events.filter(
          (e) =>
            e.resource?.includes('admin') ||
            e.action?.includes('admin') ||
            (e.risk_score && e.risk_score > 80)
        )

        if (adminEvents.length > 5) {
          return [
            {
              type: 'PRIVILEGE_ESCALATION_ATTEMPT',
              severity: 'critical',
              confidence: Math.min(adminEvents.length / 10, 1),
              details: `User attempted ${adminEvents.length} high-privilege operations`,
              evidence: {
                admin_attempts: adminEvents.length,
                attempted_resources: [
                  ...new Set(adminEvents.map((e) => e.resource)),
                ],
                granted_count: adminEvents.filter((e) => e.granted).length,
              },
              timestamp: Date.now(),
            },
          ]
        }
        return []
      }
    )

    // Brute force detector
    this.anomalyDetectors.set('brute_force', (events: AuditEvent[]) => {
      const authFailures = events.filter(
        (e) => e.event_type.startsWith('AUTH_') && !e.granted
      )

      if (authFailures.length > 10) {
        return [
          {
            type: 'BRUTE_FORCE_ATTACK',
            severity: 'high',
            confidence: Math.min(authFailures.length / 20, 1),
            details: `${authFailures.length} failed authentication attempts detected`,
            evidence: {
              failed_attempts: authFailures.length,
              time_window: this.ANOMALY_WINDOW / 1000,
              ip_addresses: [
                ...new Set(authFailures.map((e) => e.ip_address)),
              ].filter(Boolean),
            },
            timestamp: Date.now(),
          },
        ]
      }
      return []
    })

    // Session hijacking detector
    this.anomalyDetectors.set('session_hijacking', (events: AuditEvent[]) => {
      const sessionEvents = events.filter((e) => e.session_id)
      const ipSessions = new Map<string, Set<string>>()

      sessionEvents.forEach((e) => {
        if (e.ip_address && e.session_id) {
          if (!ipSessions.has(e.session_id)) {
            ipSessions.set(e.session_id, new Set())
          }
          ipSessions.get(e.session_id)!.add(e.ip_address)
        }
      })

      // Detect sessions with multiple IPs
      const suspiciousSessions = Array.from(ipSessions.entries()).filter(
        ([_, ips]) => ips.size > 1
      )

      if (suspiciousSessions.length > 0) {
        return [
          {
            type: 'SESSION_HIJACKING_DETECTED',
            severity: 'critical',
            confidence: 0.8,
            details: `${suspiciousSessions.length} sessions detected from multiple IP addresses`,
            evidence: {
              suspicious_sessions: suspiciousSessions.length,
              session_details: Object.fromEntries(
                suspiciousSessions.map(([sessionId, ips]) => [
                  sessionId,
                  Array.from(ips),
                ])
              ),
            },
            timestamp: Date.now(),
          },
        ]
      }
      return []
    })

    logger.log(
      `✅ Initialized ${this.anomalyDetectors.size} anomaly detection algorithms`
    )
  }

  /**
   * Start audit processing background task
   */
  private startAuditProcessing(): void {
    this.processingIntervals.push(
      setInterval(() => {
        const criticalEvents = this.auditQueue.filter(
          (e) => e.severity === 'critical'
        )
        if (criticalEvents.length > 0) {
          this.flush()
        }
      }, 100),

      setInterval(() => {
        if (this.auditQueue.length > 0) {
          this.flush()
        }
      }, this.FLUSH_INTERVAL),

      setInterval(() => {
        this.updateMetrics()
      }, 10000)
    )
  }

  /**
   * Start anomaly detection background process
   */
  private startAnomalyDetection(): void {
    this.processingIntervals.push(
      setInterval(async () => {
        await this.detectAnomalies()
      }, 30000)
    )
  }

  /**
   * Detect anomalies in recent audit events
   */
  private async detectAnomalies(): Promise<void> {
    try {
      // Get recent events for each user
      const recentUserEvents = await this.getRecentEventsByUser()

      for (const [userId, events] of recentUserEvents.entries()) {
        const allAnomalies: AnomalyDetection[] = []

        // Run all detectors
        for (const [
          detectorName,
          detector,
        ] of this.anomalyDetectors.entries()) {
          try {
            const anomalies = detector(events)
            allAnomalies.push(...anomalies)
          } catch (error) {
            logger.error(`Anomaly detector ${detectorName} failed:`, error)
          }
        }

        // Process detected anomalies
        for (const anomaly of allAnomalies) {
          await this.handleAnomaly(userId, anomaly)
        }
      }
    } catch (error) {
      logger.error('Anomaly detection error:', error)
    }
  }

  /**
   * Get recent events grouped by user
   */
  private async getRecentEventsByUser(): Promise<Map<string, AuditEvent[]>> {
    const userEvents = new Map<string, AuditEvent[]>()
    const cutoffTime = Date.now() - this.ANOMALY_WINDOW

    try {
      // Get recent events from Redis
      const recentEvents = await this.redis.lrange('audit:all', 0, 10000)

      for (const eventStr of recentEvents) {
        try {
          const event: AuditEvent = JSON.parse(eventStr)
          const eventTime = new Date(event.timestamp).getTime()

          if (eventTime < cutoffTime) break // Events are ordered by time

          const userId = event.user_id || 'anonymous'
          if (!userEvents.has(userId)) {
            userEvents.set(userId, [])
          }
          userEvents.get(userId)!.push(event)
        } catch (parseError) {
          logger.warn('Failed to parse audit event:', parseError)
        }
      }
    } catch (error) {
      logger.error('Error getting recent events:', error)
    }

    return userEvents
  }

  /**
   * Handle detected anomaly
   */
  private async handleAnomaly(
    userId: string,
    anomaly: AnomalyDetection
  ): Promise<void> {
    try {
      this.metrics.anomaliesDetected++

      logger.warn('🚨 Anomaly detected:', {
        userId,
        type: anomaly.type,
        severity: anomaly.severity,
        confidence: anomaly.confidence,
      })

      // Create security alert
      const alert: SecurityAlert = {
        id: crypto.randomUUID(),
        alert_type: anomaly.type,
        severity: anomaly.severity,
        user_id: userId === 'anonymous' ? undefined : userId,
        description: anomaly.details,
        details: anomaly.evidence,
        risk_score: anomaly.confidence * 100,
        created_at: new Date().toISOString(),
      }

      await this.createSecurityAlert(alert)

      // Implement automatic responses for critical anomalies
      if (anomaly.severity === 'critical') {
        await this.handleCriticalAnomaly(userId, anomaly)
      }
    } catch (error) {
      logger.error('Error handling anomaly:', error)
    }
  }

  /**
   * Create security alert
   */
  private async createSecurityAlert(
    alert: SecurityAlert | AuditEvent
  ): Promise<void> {
    try {
      const alertData =
        'alert_type' in alert
          ? {
              ...alert,
              title: `Security Alert: ${(alert as SecurityAlert).alert_type}`,
            }
          : {
              id: alert.id,
              alert_type: alert.event_type,
              severity: alert.severity,
              user_id: alert.user_id,
              title: `Security Alert: ${alert.event_type}`,
              description: `${alert.event_type}: ${alert.resource}:${alert.action}`,
              details: alert.context || {},
              risk_score: alert.risk_score || 0,
              created_at: alert.timestamp,
            }

      // Store in database
      const { error } = await databaseConnectionPool.executeWrite(
        async (client) => await client.from('security_alerts').insert(alertData)
      )

      if (error) throw error

      // Store in Redis for real-time monitoring
      await this.redis.lpush(
        'security_alerts:active',
        JSON.stringify(alertData)
      )
      await this.redis.ltrim('security_alerts:active', 0, 1000)

      if (alertData.severity === 'critical') {
        this.metrics.criticalAlertsActive++
      }

      logger.log(`🚨 Security alert created: ${alertData.alert_type}`)
    } catch (error) {
      logger.error('Error creating security alert:', error)
    }
  }

  /**
   * Handle critical anomalies with automatic responses
   */
  private async handleCriticalAnomaly(
    userId: string,
    anomaly: AnomalyDetection
  ): Promise<void> {
    try {
      logger.error('🚨 CRITICAL ANOMALY - Implementing automatic response:', {
        userId,
        type: anomaly.type,
        confidence: anomaly.confidence,
      })

      // Implement automatic responses based on anomaly type
      switch (anomaly.type) {
        case 'PRIVILEGE_ESCALATION_ATTEMPT':
          // Temporarily restrict user permissions
          await this.temporaryUserRestriction(
            userId,
            'privilege_escalation',
            3600
          ) // 1 hour
          break

        case 'SESSION_HIJACKING_DETECTED':
          // Force session logout
          await this.forceUserLogout(userId, 'session_hijacking')
          break

        case 'BRUTE_FORCE_ATTACK':
          // Block IP temporarily
          await this.temporaryIpBlock(
            (anomaly.evidence.ip_addresses || []) as string[],
            7200
          ) // 2 hours
          break
      }

      // Alert administrators immediately
      await this.alertAdministrators('critical_anomaly', {
        userId,
        anomaly,
        autoResponseTaken: true,
      })
    } catch (error) {
      logger.error('Error handling critical anomaly:', error)
    }
  }

  /**
   * Temporarily restrict user
   */
  private async temporaryUserRestriction(
    userId: string,
    reason: string,
    durationSeconds: number
  ): Promise<void> {
    try {
      await this.redis.setex(
        `restricted:${userId}`,
        durationSeconds,
        JSON.stringify({
          reason,
          restricted_at: Date.now(),
          expires_at: Date.now() + durationSeconds * 1000,
        })
      )

      logger.warn(
        `⚠️ User ${userId} temporarily restricted for ${durationSeconds}s due to ${reason}`
      )
    } catch (error) {
      logger.error('Error applying user restriction:', error)
    }
  }

  /**
   * Force user logout
   */
  private async forceUserLogout(userId: string, reason: string): Promise<void> {
    try {
      // Invalidate user sessions and permissions
      await this.redis.del(`session:${userId}`)
      await this.redis.setex(`force_logout:${userId}`, 3600, reason)

      logger.warn(`⚠️ Forced logout for user ${userId} due to ${reason}`)
    } catch (error) {
      logger.error('Error forcing user logout:', error)
    }
  }

  /**
   * Temporary IP block
   */
  private async temporaryIpBlock(
    ips: string[],
    durationSeconds: number
  ): Promise<void> {
    try {
      const pipeline = this.redis.pipeline()

      ips.forEach((ip) => {
        pipeline.setex(`blocked_ip:${ip}`, durationSeconds, 'security_block')
      })

      await pipeline.exec()
      logger.warn(`⚠️ Blocked ${ips.length} IPs for ${durationSeconds}s`)
    } catch (error) {
      logger.error('Error blocking IPs:', error)
    }
  }

  /**
   * Alert administrators
   */
  private async alertAdministrators(
    alertType: string,
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      // Store alert for admin dashboard
      await this.redis.lpush(
        'admin_alerts',
        JSON.stringify({
          type: alertType,
          details,
          timestamp: Date.now(),
          severity: 'critical',
        })
      )

      // In production, this would send emails/Slack notifications
      logger.error('🚨 ADMIN ALERT:', alertType, details)
    } catch (error) {
      logger.error('Error alerting administrators:', error)
    }
  }

  /**
   * Calculate risk score for permission check
   */
  private calculateRiskScore(data: {
    granted: boolean
    resource?: string
    action?: string
  }): number {
    let score = 0

    // Base score for denial
    if (!data.granted) score += 10

    // Resource-based scoring
    if (data.resource?.includes('admin')) score += 30
    if (data.resource?.includes('user')) score += 20
    if (data.resource?.includes('role')) score += 25

    // Action-based scoring
    if (data.action?.includes('delete')) score += 40
    if (data.action?.includes('create')) score += 20
    if (data.action?.includes('update')) score += 15

    return Math.min(score, 100)
  }

  /**
   * Calculate security risk score
   */
  private calculateSecurityRiskScore(data: {
    severity: string
    eventType: string
  }): number {
    let score = 0

    // Severity-based scoring
    switch (data.severity) {
      case 'critical':
        score += 90
        break
      case 'error':
        score += 70
        break
      case 'warning':
        score += 40
        break
      default:
        score += 10
    }

    // Event type scoring
    if (data.eventType.includes('ddos')) score += 100
    if (data.eventType.includes('brute_force')) score += 80
    if (data.eventType.includes('privilege')) score += 85

    return Math.min(score, 100)
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    this.metrics.queueSize = this.auditQueue.length
    this.metrics.lastFlush = Date.now()

    // Calculate events per second
    const now = Date.now()
    const timeDiff = (now - this.metrics.lastFlush) / 1000
    if (timeDiff > 0) {
      this.metrics.eventsPerSecond = this.metrics.totalEvents / timeDiff
    }
  }

  /**
   * Get audit metrics
   */
  getMetrics(): AuditMetrics {
    return { ...this.metrics }
  }

  /**
   * Search audit events
   */
  async searchEvents(criteria: {
    userId?: string
    resource?: string
    action?: string
    severity?: string
    startTime?: Date
    endTime?: Date
    limit?: number
  }): Promise<AuditEvent[]> {
    try {
      const { data, error } = await databaseConnectionPool.executeRead(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (client: any) => {
          let query = client.from('rbac_audit_logs').select('*')

          if (criteria.userId) {
            query = query.eq('actor_id', criteria.userId)
          }
          if (criteria.resource) {
            query = query.eq('resource_type', criteria.resource)
          }
          if (criteria.severity) {
            query = query.eq('severity', criteria.severity)
          }
          if (criteria.startTime) {
            query = query.gte('created_at', criteria.startTime.toISOString())
          }
          if (criteria.endTime) {
            query = query.lte('created_at', criteria.endTime.toISOString())
          }

          query = query.order('created_at', { ascending: false })

          return await query.limit(criteria.limit || 1000)
        }
      )

      if (error) throw error
      return (Array.isArray(data) ? data : []) || []
    } catch (error) {
      logger.error('Error searching audit events:', error)
      return []
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
      const start = Date.now()
      await this.redis.ping()
      const latency = Date.now() - start

      const metrics = this.getMetrics()

      if (metrics.queueSize > this.MAX_QUEUE_SIZE * 0.8) {
        return {
          status: 'degraded',
          message: 'Audit queue near capacity',
          details: {
            queueSize: metrics.queueSize,
            maxSize: this.MAX_QUEUE_SIZE,
          },
        }
      }

      if (latency > 100) {
        return {
          status: 'degraded',
          message: 'High audit system latency',
          details: { latency, metrics },
        }
      }

      return {
        status: 'healthy',
        message: 'Audit service operating normally',
        details: { latency, metrics },
      }
    } catch (error) {
      return {
        status: 'critical',
        message: 'Audit service health check failed',
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
      if (this.flushTimer) {
        clearTimeout(this.flushTimer)
        this.flushTimer = null
      }

      for (const interval of this.processingIntervals) {
        clearInterval(interval)
      }
      this.processingIntervals = []

      await this.flush()

      if (this.redis) {
        await this.redis.quit()
      }

      logger.log('✅ Audit service shut down gracefully')
    } catch (error) {
      logger.error('Audit service shutdown error:', error)
    }
  }
}

// Export singleton instance
export const auditService = AuditService.getInstance()

// Export types
export type {
  AuditEvent,
  AuditContext,
  AnomalyDetection,
  SecurityAlert,
  AuditMetrics,
}

// Created and developed by Jai Singh
