// Created and developed by Jai Singh
/**
 * Session Activity Logger
 *
 * Lightweight service for logging session events to the session_activities table.
 * Designed to be fire-and-forget -- logging failures should never block
 * the main auth flow.
 *
 * @date 2026-02-05
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export type SessionEventType =
  | 'login'
  | 'logout'
  | 'timeout'
  | 'forced_logout'
  | 'refresh'
  | 'extend'
  | 'session_warning'
  | 'update_timeout_config'
  | 'create_timeout_config'
  | 'delete_timeout_config'
  | 'resolve_security_alert'
  | 'export_session_data'

interface LogEventOptions {
  userId: string
  eventType: SessionEventType
  details?: string
  metadata?: Record<string, unknown>
  sessionId?: string
}

class SessionActivityLoggerService {
  /**
   * Log a session activity event. Fire-and-forget -- errors are caught and logged
   * but never thrown to avoid disrupting the auth flow.
   */
  async log(options: LogEventOptions): Promise<void> {
    const { userId, eventType, details, metadata, sessionId } = options

    try {
      // Don't log if userId is missing or is 'system'
      if (!userId || userId === 'system') return

      await supabase.from('session_activities').insert({
        user_id: userId,
        event_type: eventType as string,
        details: details
          ? metadata
            ? `${details} | ${JSON.stringify(metadata)}`
            : details
          : null,
        session_id: sessionId || null,
        ip_address: null,
        user_agent:
          typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
    } catch (error) {
      // Never throw -- logging is best-effort
      logger.warn(
        '[SessionActivityLogger] Failed to log event:',
        eventType,
        error
      )
    }
  }

  /** Convenience: log a login event */
  async logLogin(userId: string) {
    return this.log({ userId, eventType: 'login', details: 'User signed in' })
  }

  /** Convenience: log a logout event */
  async logLogout(userId: string) {
    return this.log({ userId, eventType: 'logout', details: 'User signed out' })
  }

  /** Convenience: log a session timeout event */
  async logTimeout(userId: string) {
    return this.log({
      userId,
      eventType: 'timeout',
      details: 'Session expired due to inactivity',
    })
  }

  /** Convenience: log a session refresh event */
  async logRefresh(userId: string) {
    return this.log({
      userId,
      eventType: 'refresh',
      details: 'Session token refreshed',
    })
  }

  /** Convenience: log a session extension event */
  async logExtend(userId: string) {
    return this.log({
      userId,
      eventType: 'extend',
      details: 'Session extended by user',
    })
  }

  /** Convenience: log a session expiry warning */
  async logWarning(userId: string, timeRemainingSeconds: number) {
    return this.log({
      userId,
      eventType: 'session_warning',
      details: `Session expiry warning shown (${timeRemainingSeconds}s remaining)`,
      metadata: { timeRemainingSeconds },
    })
  }
}

export const sessionActivityLogger = new SessionActivityLoggerService()

// Created and developed by Jai Singh
