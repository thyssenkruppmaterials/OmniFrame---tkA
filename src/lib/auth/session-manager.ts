// Created and developed by Jai Singh
/**
 * Smart Session Manager
 * Predictive session management with intelligent refresh and monitoring
 */
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { logger } from '@/lib/utils/logger'
// import { authCache } from '@/lib/cache/auth-cache' // Not needed for now
// import { authService } from './auth-service' // Not needed for now
import type { Session, AuthEvent, AuthEventHandler } from './types'

interface SessionConfig {
  checkInterval: number
  warningTime: number
  refreshThreshold: number
  maxRefreshAttempts: number
  enableBackgroundRefresh: boolean
  enableDeviceTracking: boolean
}

interface SessionState {
  isValid: boolean
  expiresAt: number | null
  lastCheck: number
  refreshAttempts: number
  isRefreshing: boolean
  backgroundRefreshEnabled: boolean
}

export class SessionManager {
  private static instance: SessionManager
  private config: SessionConfig
  private state: SessionState
  private checkInterval: NodeJS.Timeout | null = null
  private refreshTimeout: NodeJS.Timeout | null = null
  private eventListeners: Set<AuthEventHandler> = new Set()
  private visibilityCheckInterval: NodeJS.Timeout | null = null

  private defaultConfig: SessionConfig = {
    checkInterval: 10 * 60 * 1000, // 10 minutes
    warningTime: 5 * 60 * 1000, // 5 minutes before expiry
    refreshThreshold: 10 * 60 * 1000, // 10 minutes before expiry
    maxRefreshAttempts: 3,
    enableBackgroundRefresh: true,
    enableDeviceTracking: false,
  }

  private constructor(config?: Partial<SessionConfig>) {
    this.config = { ...this.defaultConfig, ...config }
    this.state = {
      isValid: false,
      expiresAt: null,
      lastCheck: 0,
      refreshAttempts: 0,
      isRefreshing: false,
      backgroundRefreshEnabled: this.config.enableBackgroundRefresh,
    }
  }

  static getInstance(config?: Partial<SessionConfig>): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager(config)
    }
    return SessionManager.instance
  }

  /**
   * Initialize session monitoring
   */
  async initialize(): Promise<void> {
    logger.log('Initializing smart session manager...')

    // REDESIGNED: Use SingletonAuthManager instead of creating new supabase listener
    // This eliminates the additional GoTrueClient instance

    // Set up auth state change listener via singleton
    singletonAuthManager.addAuthStateChangeCallback(
      this.handleAuthStateChange.bind(this)
    )

    // Start session monitoring (using singleton client)
    this.startSessionMonitoring()

    // Set up visibility change handler for intelligent checking
    this.setupVisibilityHandler()

    // Perform initial session validation (using singleton client)
    await this.validateSession()

    logger.log('Session manager initialized')
  }

  /**
   * Get current session state
   */
  getSessionState(): SessionState {
    return { ...this.state }
  }

  /**
   * Validate current session
   */
  async validateSession(): Promise<boolean> {
    try {
      const {
        data: { session },
        error,
      } = await singletonAuthManager.getSupabaseClient().auth.getSession()

      if (error) {
        logger.error('Session validation error:', error)
        this.updateState({ isValid: false, expiresAt: null })
        return false
      }

      if (!session) {
        this.updateState({ isValid: false, expiresAt: null })
        return false
      }

      const now = Date.now()
      const expiresAt = session.expires_at ? session.expires_at * 1000 : null // Convert to milliseconds
      const isValid = expiresAt ? now < expiresAt : false

      this.updateState({
        isValid,
        expiresAt,
        lastCheck: now,
      })

      // Schedule refresh if needed
      if (isValid && expiresAt) {
        this.scheduleRefreshIfNeeded(expiresAt)
      }

      return isValid
    } catch (error) {
      logger.error('Session validation failed:', error)
      this.updateState({ isValid: false, expiresAt: null })
      return false
    }
  }

  /**
   * Force refresh session
   */
  async refreshSession(): Promise<Session | null> {
    if (this.state.isRefreshing) {
      logger.log('Session refresh already in progress')
      return null
    }

    this.updateState({
      isRefreshing: true,
      refreshAttempts: this.state.refreshAttempts + 1,
    })

    try {
      logger.log('Attempting session refresh...')

      const { data, error } = await singletonAuthManager
        .getSupabaseClient()
        .auth.refreshSession()

      if (error) {
        logger.error('Session refresh error:', error)
        this.handleRefreshFailure()
        return null
      }

      if (data.session) {
        logger.log('Session refreshed successfully')

        // Update state
        const expiresAt = data.session.expires_at
          ? data.session.expires_at * 1000
          : Date.now() + 60 * 60 * 1000 // Default to 1 hour
        this.updateState({
          isValid: true,
          expiresAt,
          refreshAttempts: 0,
          isRefreshing: false,
        })

        // Schedule next refresh
        if (expiresAt) {
          if (expiresAt) {
            this.scheduleRefreshIfNeeded(expiresAt)
          }
        }

        // Emit event
        this.emitEvent({
          type: 'TOKEN_REFRESHED',
          session: data.session,
          timestamp: Date.now(),
        })

        return data.session
      }

      return null
    } catch (error) {
      logger.error('Session refresh failed:', error)
      this.handleRefreshFailure()
      return null
    } finally {
      this.updateState({ isRefreshing: false })
    }
  }

  /**
   * Predictive refresh based on usage patterns
   */
  async predictiveRefresh(): Promise<void> {
    if (!this.state.expiresAt) return

    const now = Date.now()
    const timeUntilExpiry = this.state.expiresAt - now

    // Refresh if we're within the threshold
    if (timeUntilExpiry <= this.config.refreshThreshold) {
      logger.log('Predictive refresh triggered')
      await this.refreshSession()
    }
  }

  /**
   * Enable background refresh
   */
  enableBackgroundRefresh(): void {
    this.state.backgroundRefreshEnabled = true
    logger.log('Background refresh enabled')
  }

  /**
   * Disable background refresh
   */
  disableBackgroundRefresh(): void {
    this.state.backgroundRefreshEnabled = false
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
      this.refreshTimeout = null
    }
    logger.log('Background refresh disabled')
  }

  /**
   * Get session expiry information
   */
  getExpiryInfo(): {
    expiresAt: number | null
    timeUntilExpiry: number | null
    isExpiringSoon: boolean
    needsRefresh: boolean
  } {
    if (!this.state.expiresAt) {
      return {
        expiresAt: null,
        timeUntilExpiry: null,
        isExpiringSoon: false,
        needsRefresh: false,
      }
    }

    const now = Date.now()
    const timeUntilExpiry = this.state.expiresAt - now

    return {
      expiresAt: this.state.expiresAt,
      timeUntilExpiry,
      isExpiringSoon: timeUntilExpiry <= this.config.warningTime,
      needsRefresh: timeUntilExpiry <= this.config.refreshThreshold,
    }
  }

  /**
   * Add event listener
   */
  addEventListener(handler: AuthEventHandler): void {
    this.eventListeners.add(handler)
  }

  /**
   * Remove event listener
   */
  removeEventListener(handler: AuthEventHandler): void {
    this.eventListeners.delete(handler)
  }

  /**
   * Get session analytics
   */
  getAnalytics(): {
    totalRefreshes: number
    lastRefreshAttempt: number | null
    averageRefreshInterval: number | null
    healthScore: number
    recommendations: string[]
  } {
    const recommendations: string[] = []
    let healthScore = 100

    if (this.state.refreshAttempts >= this.config.maxRefreshAttempts) {
      healthScore -= 30
      recommendations.push(
        'High refresh failure rate - check network connectivity'
      )
    }

    if (!this.state.isValid) {
      healthScore -= 50
      recommendations.push(
        'Session is invalid - user may need to re-authenticate'
      )
    }

    const expiryInfo = this.getExpiryInfo()
    if (expiryInfo.isExpiringSoon) {
      healthScore -= 20
      recommendations.push('Session expiring soon - prepare for refresh')
    }

    return {
      totalRefreshes: this.state.refreshAttempts,
      lastRefreshAttempt: this.state.lastCheck,
      averageRefreshInterval: this.config.checkInterval,
      healthScore,
      recommendations,
    }
  }

  /**
   * Force session check
   */
  async forceCheck(): Promise<void> {
    await this.validateSession()
  }

  /**
   * Destroy session manager
   */
  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }

    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
      this.refreshTimeout = null
    }

    if (this.visibilityCheckInterval) {
      clearInterval(this.visibilityCheckInterval)
      this.visibilityCheckInterval = null
    }

    this.eventListeners.clear()
    SessionManager.instance = null as unknown as SessionManager
  }

  // Private methods

  private updateState(updates: Partial<SessionState>): void {
    this.state = { ...this.state, ...updates }
  }

  private handleAuthStateChange(event: string, session: Session | null): void {
    logger.log('Session manager: Auth state change:', event)

    switch (event) {
      case 'SIGNED_IN':
        if (session) {
          const expiresAt = session.expires_at
            ? typeof session.expires_at === 'number'
              ? session.expires_at * 1000
              : Date.parse(session.expires_at as string) * 1000
            : Date.now() + 60 * 60 * 1000
          this.updateState({
            isValid: true,
            expiresAt,
            refreshAttempts: 0,
          })
          if (expiresAt) {
            this.scheduleRefreshIfNeeded(expiresAt)
          }
        }
        break

      case 'SIGNED_OUT':
        this.updateState({
          isValid: false,
          expiresAt: null,
          refreshAttempts: 0,
        })
        if (this.refreshTimeout) {
          clearTimeout(this.refreshTimeout)
          this.refreshTimeout = null
        }
        break

      case 'TOKEN_REFRESHED':
        if (session) {
          const expiresAt = session.expires_at
            ? typeof session.expires_at === 'number'
              ? session.expires_at * 1000
              : Date.parse(session.expires_at as string) * 1000
            : Date.now() + 60 * 60 * 1000
          this.updateState({
            isValid: true,
            expiresAt,
            refreshAttempts: 0,
          })
          if (expiresAt) {
            this.scheduleRefreshIfNeeded(expiresAt)
          }
        }
        break
    }
  }

  private scheduleRefreshIfNeeded(expiresAt: number): void {
    if (!this.state.backgroundRefreshEnabled) return

    const now = Date.now()
    const timeUntilExpiry = expiresAt - now
    const refreshTime = Math.max(
      0,
      timeUntilExpiry - this.config.refreshThreshold
    )

    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
    }

    this.refreshTimeout = setTimeout(async () => {
      logger.log('Scheduled refresh executing...')
      await this.refreshSession()
    }, refreshTime)
  }

  private handleRefreshFailure(): void {
    this.updateState({ isRefreshing: false })

    if (this.state.refreshAttempts >= this.config.maxRefreshAttempts) {
      logger.error('Max refresh attempts reached, session may be expired')
      this.emitEvent({ type: 'SESSION_EXPIRED', timestamp: Date.now() })
    } else {
      // Schedule retry with exponential backoff
      const retryDelay = Math.min(
        30000,
        5000 * Math.pow(2, this.state.refreshAttempts)
      )
      logger.log(`Scheduling refresh retry in ${retryDelay}ms`)

      setTimeout(async () => {
        await this.refreshSession()
      }, retryDelay)
    }
  }

  private startSessionMonitoring(): void {
    this.checkInterval = setInterval(async () => {
      // Only perform deep validation if we haven't checked recently
      const now = Date.now()
      if (now - this.state.lastCheck > this.config.checkInterval) {
        await this.validateSession()
      } else {
        // Quick predictive refresh check
        await this.predictiveRefresh()
      }
    }, this.config.checkInterval)
  }

  private setupVisibilityHandler(): void {
    // Intelligent visibility change handling
    let lastVisibilityCheck = 0

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now()
        const timeSinceLastCheck = now - lastVisibilityCheck

        // Only check if it's been more than 2 minutes since last check
        if (timeSinceLastCheck > 120000) {
          logger.log('Page became visible - validating session')
          lastVisibilityCheck = now
          await this.validateSession()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Also listen for focus events
    window.addEventListener('focus', () => {
      const now = Date.now()
      if (now - lastVisibilityCheck > 120000) {
        lastVisibilityCheck = now
        this.predictiveRefresh()
      }
    })
  }

  private emitEvent(event: AuthEvent): void {
    for (const handler of this.eventListeners) {
      try {
        handler(event)
      } catch (error) {
        logger.error('Error in session event handler:', error)
      }
    }
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance()

// Export types
export type { SessionConfig, SessionState }

// Created and developed by Jai Singh
