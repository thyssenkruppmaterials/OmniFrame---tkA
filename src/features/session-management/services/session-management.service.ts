// Created and developed by Jai Singh
import { supabase } from '@/lib/supabase/client'
import { DeviceRegistrationService } from '@/lib/supabase/device-registration.service'
import { logger } from '@/lib/utils/logger'
import type {
  SecurityAlert,
  SessionActivity,
  SessionStats,
  SessionTimeoutConfig,
  UserSession,
} from '../types'

export class SessionManagementService {
  /**
   * Get all active user sessions with user details
   */
  static async getActiveSessions(): Promise<UserSession[]> {
    try {
      // First try to query user_sessions table
      const { data: sessions, error } = await supabase
        .from('user_sessions')
        .select(
          `
          *,
          user_profiles!inner(
            email,
            first_name,
            last_name,
            username,
            role_id,
            roles(name)
          )
        `
        )
        .gt('expires_at', new Date().toISOString())
        .order('last_activity', { ascending: false })

      // If user_sessions table doesn't exist or query fails, read from real auth data
      if (error) {
        logger.warn(
          'user_sessions table not available, reading from real auth data:',
          error.message
        )
        return await SessionManagementService.getRealActiveSessions()
      }

      // If table exists but is empty, also use real auth data
      if (!sessions || sessions.length === 0) {
        return await SessionManagementService.getRealActiveSessions()
      }

      // Transform and enrich session data
      return sessions.map((session) => {
        const profile = session.user_profiles
        const userAgent = session.user_agent || ''

        return {
          id: session.id,
          user_id: session.user_id || '',
          token_hash: session.token_hash,
          ip_address: (session.ip_address as string) || '',
          user_agent: session.user_agent || '',
          last_activity: session.last_activity || new Date().toISOString(),
          expires_at: session.expires_at,
          created_at: session.created_at || new Date().toISOString(),
          user_email: profile?.email,
          user_name:
            profile?.first_name && profile?.last_name
              ? `${profile.first_name} ${profile.last_name}`.trim()
              : profile?.username || profile?.email?.split('@')[0],
          user_role:
            (profile?.roles as { name: string } | null)?.name || 'viewer',
          is_current: false, // Will be determined by comparing with current session
          time_remaining: SessionManagementService.calculateTimeRemaining(
            session.expires_at
          ),
          device_type: SessionManagementService.extractDeviceType(userAgent),
          browser: SessionManagementService.extractBrowser(userAgent),
          location: SessionManagementService.extractLocation(
            (session.ip_address as string) || ''
          ),
        }
      })
    } catch (error) {
      logger.error('Error fetching active sessions:', error)
      return await SessionManagementService.getRealActiveSessions()
    }
  }

  /**
   * Get session statistics and metrics
   */
  static async getSessionStats(): Promise<SessionStats> {
    try {
      // Use getRealActiveSessions to get accurate session data from user_profiles.last_seen
      // This matches the Active Sessions tab display logic
      const realSessions =
        await SessionManagementService.getRealActiveSessions()

      // Count all sessions in last 24h to match table display
      // Note: This includes both active and recently expired sessions
      const activeCount = realSessions.length

      // For synthetic sessions from user_profiles.last_seen, we can't calculate accurate durations
      // since created_at is account creation (not login time). Return 0m as placeholder.
      // Once real session data accumulates in session_activities, this can be improved.
      const avgDuration = '0m'

      // Get unique users from all sessions (last 24h)
      const uniqueUsers = new Set(realSessions.map((s) => s.user_id)).size

      // Calculate security alerts count
      const { count: alertCount } = await supabase
        .from('security_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('resolved', false)

      const securityAlertCount = alertCount || 0

      return {
        activeSessions: activeCount,
        avgDuration,
        securityAlerts: securityAlertCount,
        autoLogoutRate: '15%', // TODO: Calculate from actual session_activities data
        totalSessions24h: realSessions.length,
        uniqueUsers24h: uniqueUsers,
        peakConcurrentSessions: activeCount,
        averageSessionsPerUser:
          uniqueUsers > 0
            ? Math.round((activeCount / uniqueUsers) * 100) / 100
            : 0,
      }
    } catch (error) {
      logger.error('Error fetching session stats:', error)
      // Return fallback stats based on real auth data
      return await SessionManagementService.getRealSessionStats()
    }
  }

  /**
   * Terminate a specific session
   */
  // TODO: Needs backend endpoint POST /api/admin/sessions/:sessionId/terminate
  static async terminateSession(_sessionId: string): Promise<void> {
    throw new Error(
      'Session termination requires backend admin API endpoints (not yet implemented)'
    )
  }

  /**
   * Terminate all sessions for a specific user
   */
  // TODO: Needs backend endpoint POST /api/admin/users/:userId/sessions/terminate
  static async terminateUserSessions(_userId: string): Promise<void> {
    throw new Error(
      'Session termination requires backend admin API endpoints (not yet implemented)'
    )
  }

  /**
   * Terminate all active sessions (force logout everyone)
   */
  // TODO: Needs backend endpoint POST /api/admin/sessions/terminate-all
  static async terminateAllSessions(): Promise<void> {
    throw new Error(
      'Session termination requires backend admin API endpoints (not yet implemented)'
    )
  }

  /**
   * Get timeout configurations
   */
  static async getTimeoutConfigs(): Promise<SessionTimeoutConfig[]> {
    try {
      const { data: configs, error } = await supabase
        .from('session_timeout_configs')
        .select('*')
        .order('is_global', { ascending: false })
        .order('role', { ascending: true })

      if (error) {
        logger.warn(
          'session_timeout_configs table not available, returning default configs:',
          error.message
        )
        return SessionManagementService.getDefaultTimeoutConfigs()
      }

      return (configs || []).map((config) => ({
        id: config.id,
        role: config.role,
        session_timeout_minutes: config.session_timeout_minutes,
        auto_logout_timeout_minutes: config.auto_logout_timeout_minutes,
        warning_time_minutes: config.warning_time_minutes,
        is_global: config.is_global,
        remember_me_duration_hours:
          ((config as Record<string, unknown>)
            .remember_me_duration_hours as number) ?? 24,
        enable_fullscreen_expiry_warning:
          ((config as Record<string, unknown>)
            .enable_fullscreen_expiry_warning as boolean) ?? true,
        created_at: config.created_at || undefined,
        updated_at: config.updated_at || undefined,
      }))
    } catch (error) {
      logger.error('Error fetching timeout configs:', error)
      return SessionManagementService.getDefaultTimeoutConfigs()
    }
  }

  /**
   * Update timeout configuration
   */
  static async updateTimeoutConfig(
    config: SessionTimeoutConfig
  ): Promise<void> {
    try {
      if (!config.id) throw new Error('Config ID is required for update')

      const { error } = await supabase
        .from('session_timeout_configs')
        .update({
          role: config.role,
          session_timeout_minutes: config.session_timeout_minutes,
          auto_logout_timeout_minutes: config.auto_logout_timeout_minutes,
          warning_time_minutes: config.warning_time_minutes,
          is_global: config.is_global,
          remember_me_duration_hours: config.remember_me_duration_hours ?? 24,
          enable_fullscreen_expiry_warning:
            config.enable_fullscreen_expiry_warning ?? true,
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', config.id)

      if (error) throw error

      // Log the configuration change
      await SessionManagementService.logSessionActivity(
        'system',
        'update_timeout_config',
        `Updated timeout config for role: ${config.role}`
      )
    } catch (error) {
      logger.error('Error updating timeout config:', error)
      throw error
    }
  }

  /**
   * Create new timeout configuration
   */
  static async createTimeoutConfig(
    config: Omit<SessionTimeoutConfig, 'id'>
  ): Promise<void> {
    try {
      const { error } = await supabase.from('session_timeout_configs').insert({
        role: config.role,
        session_timeout_minutes: config.session_timeout_minutes,
        auto_logout_timeout_minutes: config.auto_logout_timeout_minutes,
        warning_time_minutes: config.warning_time_minutes,
        is_global: config.is_global,
        remember_me_duration_hours: config.remember_me_duration_hours ?? 24,
        enable_fullscreen_expiry_warning:
          config.enable_fullscreen_expiry_warning ?? true,
      } as any)

      if (error) throw error

      // Log the configuration creation
      await SessionManagementService.logSessionActivity(
        'system',
        'create_timeout_config',
        `Created timeout config for role: ${config.role}`
      )
    } catch (error) {
      logger.error('Error creating timeout config:', error)
      throw error
    }
  }

  /**
   * Delete timeout configuration
   */
  static async deleteTimeoutConfig(configId: string): Promise<void> {
    try {
      // First get the config details for logging
      const { data: config } = await supabase
        .from('session_timeout_configs')
        .select('role')
        .eq('id', configId)
        .single()

      const { error } = await supabase
        .from('session_timeout_configs')
        .delete()
        .eq('id', configId)

      if (error) throw error

      // Log the configuration deletion
      await SessionManagementService.logSessionActivity(
        'system',
        'delete_timeout_config',
        `Deleted timeout config for role: ${config?.role || 'unknown'}`
      )
    } catch (error) {
      logger.error('Error deleting timeout config:', error)
      throw error
    }
  }

  /**
   * Get security alerts
   */
  static async getSecurityAlerts(): Promise<SecurityAlert[]> {
    try {
      const { data: alerts, error } = await supabase
        .from('security_alerts')
        .select(
          `
          id,
          user_id,
          alert_type,
          severity,
          description,
          ip_address,
          user_agent,
          timestamp,
          resolved,
          user_profiles!security_alerts_user_id_fkey(
            email,
            first_name,
            last_name,
            username
          )
        `
        )
        .order('timestamp', { ascending: false })
        .limit(50) // Get latest 50 alerts

      if (error) {
        logger.warn(
          'security_alerts table not available, returning empty array:',
          error.message
        )
        return []
      }

      return (alerts || [])
        .filter((alert) => alert.user_id)
        .map((alert) => {
          const profile = alert.user_profiles as {
            email?: string
            first_name?: string
            last_name?: string
            username?: string
          } | null
          return {
            id: alert.id,
            user_id: alert.user_id!,
            alert_type: alert.alert_type as SecurityAlert['alert_type'],
            severity: alert.severity as SecurityAlert['severity'],
            description: alert.description,
            ip_address: alert.ip_address as string,
            user_agent: alert.user_agent || undefined,
            timestamp: alert.timestamp || new Date().toISOString(),
            resolved: alert.resolved || false,
            user_email: profile?.email,
            user_name:
              profile?.first_name && profile?.last_name
                ? `${profile.first_name} ${profile.last_name}`.trim()
                : profile?.username ||
                  profile?.email?.split('@')[0] ||
                  'Unknown User',
          }
        })
    } catch (error) {
      logger.error('Error fetching security alerts:', error)
      return []
    }
  }

  /**
   * Resolve security alert
   */
  static async resolveSecurityAlert(alertId: string): Promise<void> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { error } = await supabase
        .from('security_alerts')
        .update({
          resolved: true,
          resolved_by: user?.id,
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', alertId)
        .eq('resolved', false) // Only resolve unresolved alerts

      if (error) throw error

      // Log the alert resolution
      await SessionManagementService.logSessionActivity(
        user?.id || 'system',
        'resolve_security_alert',
        `Resolved security alert: ${alertId}`
      )
    } catch (error) {
      logger.error('Error resolving security alert:', error)
      throw error
    }
  }

  /**
   * Generate security report
   */
  static async generateSecurityReport(): Promise<void> {
    try {
      logger.log('Generating security report...')
      // TODO: Implement security report generation
    } catch (error) {
      logger.error('Error generating security report:', error)
      throw error
    }
  }

  /**
   * Get session analytics for a time range
   */
  static async getSessionAnalytics(_timeRange: string): Promise<SessionStats> {
    try {
      // TODO: Implement analytics queries based on timeRange
      return SessionManagementService.getSessionStats()
    } catch (error) {
      logger.error('Error getting session analytics:', error)
      throw error
    }
  }

  /**
   * Export session data
   */
  static async exportSessionData(format: 'csv' | 'json'): Promise<void> {
    try {
      const [sessions, activities, alerts] = await Promise.all([
        SessionManagementService.getActiveSessions(),
        SessionManagementService.getSessionHistory(),
        SessionManagementService.getSecurityAlerts(),
      ])

      const data = {
        sessions,
        activities,
        alerts,
        exportedAt: new Date().toISOString(),
        format,
      }

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `session-data-${new Date().toISOString().split('T')[0]}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else if (format === 'csv') {
        // Convert to CSV format
        const csvData = [
          // Sessions CSV
          'Session ID,User Email,User Role,IP Address,Last Activity,Expires At',
          ...sessions.map(
            (s) =>
              `"${s.id}","${s.user_email}","${s.user_role}","${s.ip_address}","${s.last_activity}","${s.expires_at}"`
          ),
          '',
          // Activities CSV
          'Activity ID,User Email,Event Type,Description,IP Address,Timestamp',
          ...activities.map(
            (a) =>
              `"${a.id}","${a.user_email}","${a.event_type}","${a.details}","${a.ip_address}","${a.timestamp}"`
          ),
        ].join('\n')

        const blob = new Blob([csvData], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `session-data-${new Date().toISOString().split('T')[0]}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }

      // Log the export
      await SessionManagementService.logSessionActivity(
        'system',
        'export_session_data',
        `Exported session data in ${format} format`
      )
    } catch (error) {
      logger.error('Error exporting session data:', error)
      throw error
    }
  }

  /**
   * Get session history
   */
  static async getSessionHistory(): Promise<SessionActivity[]> {
    try {
      const { data: activities, error } = await supabase
        .from('session_activities')
        .select(
          `
          id,
          user_id,
          event_type,
          ip_address,
          user_agent,
          timestamp,
          details,
          user_profiles!session_activities_user_id_fkey(
            email,
            first_name,
            last_name,
            username
          )
        `
        )
        .order('timestamp', { ascending: false })
        .limit(100) // Get latest 100 activities

      if (error) {
        logger.warn(
          'session_activities table not available, returning empty array:',
          error.message
        )
        return []
      }

      return (activities || [])
        .filter((activity) => activity.user_id)
        .map((activity) => {
          const profile = activity.user_profiles as {
            email?: string
            first_name?: string
            last_name?: string
            username?: string
          } | null
          return {
            id: activity.id,
            user_id: activity.user_id!,
            event_type: activity.event_type as SessionActivity['event_type'],
            ip_address: activity.ip_address as string,
            user_agent: activity.user_agent || undefined,
            timestamp: activity.timestamp || new Date().toISOString(),
            user_email: profile?.email,
            user_name:
              profile?.first_name && profile?.last_name
                ? `${profile.first_name} ${profile.last_name}`.trim()
                : profile?.username ||
                  profile?.email?.split('@')[0] ||
                  'Unknown User',
            session_duration: undefined, // Session duration not available in current schema
            details: activity.details || undefined,
          }
        })
    } catch (error) {
      logger.error('Error fetching session history:', error)
      return []
    }
  }

  /**
   * Create security alert
   */
  static async createSecurityAlert(
    userId: string,
    alertType: SecurityAlert['alert_type'],
    severity: SecurityAlert['severity'],
    description: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      const { error } = await supabase.from('security_alerts').insert({
        user_id: userId,
        alert_type: alertType,
        severity: severity,
        title: `Security Alert: ${alertType.replace('_', ' ')}`,
        description: description,
        metadata: (metadata || {}) as any,
      } as any)

      if (error) {
        logger.warn('Security alert creation failed:', error.message)
      }
    } catch (error) {
      logger.warn('Error creating security alert:', error)
    }
  }

  /**
   * Log session activity event
   */
  private static async logSessionActivity(
    sessionOrUserId: string,
    eventType: string,
    details?: string
  ): Promise<void> {
    try {
      // Determine if this is a session ID or user ID
      const isSessionId = sessionOrUserId.length > 36 // Session tokens are longer than UUIDs

      let userId = sessionOrUserId
      const sessionId = isSessionId ? sessionOrUserId : ''

      // If it's a session ID, get the user ID
      if (isSessionId) {
        const { data: session } = await supabase
          .from('user_sessions')
          .select('user_id')
          .eq('token_hash', sessionOrUserId)
          .single()

        if (session && session.user_id) {
          userId = session.user_id
        }
      }

      // Log to session_activities table directly until RPC functions are available
      if (userId && userId !== 'system') {
        try {
          await supabase.from('session_activities').insert({
            user_id: userId,
            session_id: sessionId || sessionOrUserId,
            event_type: eventType as
              | 'forced_logout'
              | 'update_timeout_config'
              | 'create_timeout_config'
              | 'delete_timeout_config'
              | 'resolve_security_alert'
              | 'export_session_data'
              | 'login'
              | 'logout'
              | 'timeout',
            details: details,
          })
        } catch (insertError) {
          logger.warn('Session activity logging failed:', insertError)
        }
      }
    } catch (error) {
      logger.warn('Error logging session activity:', error)
      // Don't throw - logging should not break the main functionality
    }
  }

  /**
   * Calculate time remaining for a session
   */
  private static calculateTimeRemaining(expiresAt: string): string {
    const now = new Date().getTime()
    const expires = new Date(expiresAt).getTime()
    const remaining = expires - now

    if (remaining <= 0) return 'Expired'

    const hours = Math.floor(remaining / (1000 * 60 * 60))
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  /**
   * Calculate average session duration
   * @deprecated Not currently in use
   */
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Keeping for future use
  private static _calculateAverageSessionDuration(sessions: any[]): string {
    if (!sessions.length) return '0m'

    // Filter out sessions with invalid timestamps
    const validSessions = sessions.filter((session) => {
      const created = session.created_at || session.started_at
      const lastActivity = session.last_activity
      return (
        created &&
        lastActivity &&
        !isNaN(new Date(created).getTime()) &&
        !isNaN(new Date(lastActivity).getTime())
      )
    })

    if (!validSessions.length) return '0m'

    const totalDuration = validSessions.reduce((acc, session) => {
      const created = new Date(
        session.created_at || session.started_at
      ).getTime()
      const lastActivity = new Date(session.last_activity).getTime()
      const duration = lastActivity - created
      // Only count positive durations
      return acc + (duration > 0 ? duration : 0)
    }, 0)

    const avgMs = totalDuration / validSessions.length
    const avgMinutes = Math.floor(avgMs / (1000 * 60))
    const avgHours = Math.floor(avgMinutes / 60)

    if (avgHours > 0) {
      return `${avgHours}h ${avgMinutes % 60}m`
    }
    return `${avgMinutes}m`
  }

  /**
   * Extract device type from user agent
   */
  private static extractDeviceType(userAgent: string): string {
    if (!userAgent) return 'Unknown'

    if (/Mobile|Android|iPhone|iPad/.test(userAgent)) return 'Mobile'
    if (/Tablet|iPad/.test(userAgent)) return 'Tablet'
    return 'Desktop'
  }

  /**
   * Extract browser from user agent
   */
  private static extractBrowser(userAgent: string): string {
    if (!userAgent) return 'Unknown'

    if (userAgent.includes('Chrome')) return 'Chrome'
    if (userAgent.includes('Firefox')) return 'Firefox'
    if (userAgent.includes('Safari')) return 'Safari'
    if (userAgent.includes('Edge')) return 'Edge'
    return 'Other'
  }

  /**
   * Extract location from IP address (mock implementation)
   */
  private static extractLocation(ipAddress?: string): string {
    if (!ipAddress) return 'Unknown'

    // In a full implementation, this would use a geolocation service
    // For now, return mock data based on IP patterns
    if (ipAddress.startsWith('192.168')) return 'Local Network'
    if (ipAddress.startsWith('10.')) return 'Private Network'
    return 'External'
  }

  /**
   * Get mock active sessions data when database tables are not available
   */
  /**
   * Get real session statistics from auth system when user_sessions table is empty
   */
  private static async getRealSessionStats(): Promise<SessionStats> {
    try {
      // Get real active sessions to calculate stats
      const activeSessions =
        await SessionManagementService.getRealActiveSessions()

      // Get active users count in last 24h
      const { data: recentUsers } = await supabase
        .from('user_profiles')
        .select('last_seen')
        .gte(
          'last_seen',
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        )

      const totalUsers24h = recentUsers?.length || 0
      const uniqueUsers24h = totalUsers24h

      return {
        activeSessions: activeSessions.length,
        avgDuration: '0h 0m', // Will be calculated from actual session durations in future
        securityAlerts: 0,
        autoLogoutRate: '15%',
        totalSessions24h: totalUsers24h,
        uniqueUsers24h: uniqueUsers24h,
        peakConcurrentSessions: activeSessions.length,
        averageSessionsPerUser:
          uniqueUsers24h > 0
            ? Math.round((activeSessions.length / uniqueUsers24h) * 100) / 100
            : 0,
      }
    } catch (error) {
      logger.error('Error calculating real session stats:', error)
      return {
        activeSessions: 0,
        avgDuration: '0h 0m',
        securityAlerts: 0,
        autoLogoutRate: '0%',
        totalSessions24h: 0,
        uniqueUsers24h: 0,
        peakConcurrentSessions: 0,
        averageSessionsPerUser: 0,
      }
    }
  }

  /**
   * Get real active sessions from Supabase auth system when user_sessions table is empty
   */
  private static async getRealActiveSessions(): Promise<UserSession[]> {
    try {
      logger.log(
        '🔍 DEBUG: getRealActiveSessions() called - fetching user profiles...'
      )

      // Get all user profiles with their roles and recent activity
      const { data: userProfiles, error: profilesError } = await supabase.from(
        'user_profiles'
      ).select(`
          id,
          email,
          first_name,
          last_name,
          username,
          roles(name),
          organization_id,
          last_seen,
          created_at
        `)

      logger.log('🔍 DEBUG: User profiles query result:', {
        userProfiles,
        profilesError,
      })

      if (profilesError) {
        logger.warn(
          'Error fetching user profiles for sessions:',
          profilesError.message
        )
        return []
      }

      // Get current auth user to identify the current session
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()
      logger.log(
        '🔍 DEBUG: Current auth user:',
        currentUser?.id,
        currentUser?.email
      )

      // Convert user profiles to session format for recently active users
      const currentTime = new Date()
      logger.log(
        '🔍 DEBUG: Filtering profiles. Total profiles:',
        userProfiles?.length
      )
      logger.log('🔍 DEBUG: Current time:', currentTime.toISOString())

      // Fetch all device registrations for the organization to map user IDs to device names
      let deviceNameMap: Map<string, string> = new Map()
      try {
        // Get organization ID from one of the user profiles (they're all in the same org)
        const orgId = userProfiles?.[0]?.organization_id

        if (orgId) {
          const devices =
            await DeviceRegistrationService.getOrganizationDevices(orgId)
          deviceNameMap = new Map(
            devices.map((d) => [d.user_id!, d.device_name])
          )
          logger.log(
            '📱 DEBUG: Loaded device registrations:',
            deviceNameMap.size,
            'devices'
          )
        } else {
          logger.warn('No organization ID found in user profiles')
        }
      } catch (err) {
        logger.warn('Could not load device registrations:', err)
      }

      const sessions: UserSession[] = (userProfiles || [])
        .filter((profile) => {
          logger.log(
            '🔍 DEBUG: Checking profile:',
            profile.email,
            'last_seen:',
            profile.last_seen
          )

          // Show currently authenticated user regardless of last_seen timestamp
          if (currentUser && currentUser.id === profile.id) {
            logger.log(
              '🔍 DEBUG: ✅ Current user found - including:',
              profile.email
            )
            return true
          }

          // For other users, only show those who have been active recently (within last 24 hours)
          if (!profile.last_seen) {
            logger.log(
              '🔍 DEBUG: ❌ No last_seen timestamp for:',
              profile.email
            )
            return false
          }
          const lastSeenTime = new Date(profile.last_seen)
          const hoursSinceActivity =
            (currentTime.getTime() - lastSeenTime.getTime()) / (1000 * 60 * 60)
          logger.log(
            '🔍 DEBUG: Hours since activity for',
            profile.email,
            ':',
            hoursSinceActivity
          )

          const includeUser = hoursSinceActivity <= 24
          logger.log(
            '🔍 DEBUG:',
            includeUser ? '✅' : '❌',
            'Include user',
            profile.email,
            '- within 24h:',
            includeUser
          )
          return includeUser // Show sessions from last 24 hours
        })
        .map((profile) => {
          const role =
            (profile.roles as { name: string } | null)?.name || 'viewer'
          const isCurrentUser = currentUser?.id === profile.id
          // Use current time for authenticated user, last_seen for others
          const lastActivity = isCurrentUser
            ? new Date().toISOString()
            : profile.last_seen ||
              profile.created_at ||
              new Date().toISOString()
          const lastActivityTime = new Date(lastActivity)

          // Calculate expires_at based on role timeout configurations
          const timeoutMinutes =
            SessionManagementService.getRoleTimeoutMinutes(role)
          const expiresAt = new Date(
            lastActivityTime.getTime() + timeoutMinutes * 60 * 1000
          )

          // Calculate time remaining
          const timeRemaining = SessionManagementService.calculateTimeRemaining(
            expiresAt.toISOString()
          )

          // Generate mock session details that would be captured in a real session
          const userAgent = isCurrentUser
            ? navigator.userAgent
            : 'Mozilla/5.0 (compatible; OmniFrame/1.0)'

          // Get registered device name from our map
          const deviceName = deviceNameMap.get(profile.id) || null

          return {
            id: `auth-session-${profile.id}`,
            user_id: profile.id,
            token_hash: `auth-token-${profile.id}`,
            ip_address: isCurrentUser ? '192.168.1.101' : '192.168.1.100',
            user_agent: userAgent,
            last_activity: lastActivity,
            expires_at: expiresAt.toISOString(),
            created_at: profile.created_at || new Date().toISOString(),
            user_email: profile.email,
            user_name:
              profile.first_name && profile.last_name
                ? `${profile.first_name} ${profile.last_name}`.trim()
                : profile.username ||
                  profile.email?.split('@')[0] ||
                  'Unknown User',
            user_role: role,
            is_current: isCurrentUser,
            time_remaining: timeRemaining,
            device_type: SessionManagementService.extractDeviceType(userAgent),
            device_name: deviceName || undefined, // Add registered device name
            browser: SessionManagementService.extractBrowser(userAgent),
            location: isCurrentUser ? 'Local Network' : 'Private Network',
          }
        })

      logger.log('🔍 DEBUG: Created sessions before sorting:', sessions.length)
      logger.log(
        '🔍 DEBUG: Session details:',
        sessions.map((s) => ({ email: s.user_email, is_current: s.is_current }))
      )

      const sortedSessions = sessions.sort((a, b) => {
        // Sort current user first, then by last activity
        if (a.is_current && !b.is_current) return -1
        if (!a.is_current && b.is_current) return 1
        return (
          new Date(b.last_activity).getTime() -
          new Date(a.last_activity).getTime()
        )
      })

      logger.log('🔍 DEBUG: Final sessions count:', sortedSessions.length)
      logger.log(
        '🔍 DEBUG: Returning sessions:',
        sortedSessions.map((s) => ({
          email: s.user_email,
          role: s.user_role,
          expires: s.time_remaining,
        }))
      )

      return sortedSessions
    } catch (error) {
      logger.error('Error fetching real auth sessions:', error)
      return SessionManagementService.getMockActiveSessions()
    }
  }

  /**
   * Get role timeout minutes for session expiration calculation
   */
  private static getRoleTimeoutMinutes(role: string): number {
    const timeouts: Record<string, number> = {
      superadmin: 480, // 8 hours
      admin: 240, // 4 hours
      manager: 120, // 2 hours
      cashier: 60, // 1 hour
      viewer: 30, // 30 minutes
      tka_associate: 120, // 2 hours
    }
    return timeouts[role] || 240 // Default 4 hours
  }

  private static getMockActiveSessions(): UserSession[] {
    const currentTime = new Date()
    return [
      {
        id: 'mock-session-1',
        user_id: 'mock-user-1',
        token_hash: 'mock-token-hash-1',
        ip_address: '192.168.1.100',
        user_agent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        last_activity: new Date(
          currentTime.getTime() - 5 * 60 * 1000
        ).toISOString(), // 5 minutes ago
        expires_at: new Date(
          currentTime.getTime() + 4 * 60 * 60 * 1000
        ).toISOString(), // 4 hours from now
        created_at: new Date(
          currentTime.getTime() - 2 * 60 * 60 * 1000
        ).toISOString(), // 2 hours ago
        user_email: 'admin@onebox.ai',
        user_name: 'System Admin',
        user_role: 'admin',
        is_current: true,
        time_remaining: '4h 0m',
        device_type: 'Desktop',
        browser: 'Chrome',
        location: 'Local Network',
      },
      {
        id: 'mock-session-2',
        user_id: 'mock-user-2',
        token_hash: 'mock-token-hash-2',
        ip_address: '10.0.0.50',
        user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        last_activity: new Date(
          currentTime.getTime() - 10 * 60 * 1000
        ).toISOString(), // 10 minutes ago
        expires_at: new Date(
          currentTime.getTime() + 2 * 60 * 60 * 1000
        ).toISOString(), // 2 hours from now
        created_at: new Date(
          currentTime.getTime() - 1 * 60 * 60 * 1000
        ).toISOString(), // 1 hour ago
        user_email: 'manager@onebox.ai',
        user_name: 'Operations Manager',
        user_role: 'manager',
        is_current: false,
        time_remaining: '2h 0m',
        device_type: 'Mobile',
        browser: 'Safari',
        location: 'Private Network',
      },
    ]
  }

  /**
   * Get default timeout configurations when database table is not available
   */
  private static getDefaultTimeoutConfigs(): SessionTimeoutConfig[] {
    return [
      {
        id: 'default-superadmin',
        role: 'superadmin',
        session_timeout_minutes: 480, // 8 hours
        auto_logout_timeout_minutes: 30,
        warning_time_minutes: 5,
        is_global: false,
        remember_me_duration_hours: 720, // 30 days
        enable_fullscreen_expiry_warning: true,
      },
      {
        id: 'default-admin',
        role: 'admin',
        session_timeout_minutes: 480, // 8 hours
        auto_logout_timeout_minutes: 20,
        warning_time_minutes: 5,
        is_global: false,
        remember_me_duration_hours: 720, // 30 days
        enable_fullscreen_expiry_warning: true,
      },
      {
        id: 'default-manager',
        role: 'manager',
        session_timeout_minutes: 360, // 6 hours
        auto_logout_timeout_minutes: 15,
        warning_time_minutes: 5,
        is_global: false,
        remember_me_duration_hours: 168, // 7 days
        enable_fullscreen_expiry_warning: true,
      },
      {
        id: 'default-cashier',
        role: 'cashier',
        session_timeout_minutes: 240, // 4 hours
        auto_logout_timeout_minutes: 15,
        warning_time_minutes: 5,
        is_global: false,
        remember_me_duration_hours: 48, // 2 days
        enable_fullscreen_expiry_warning: true,
      },
      {
        id: 'default-viewer',
        role: 'viewer',
        session_timeout_minutes: 180, // 3 hours
        auto_logout_timeout_minutes: 10,
        warning_time_minutes: 5,
        is_global: false,
        remember_me_duration_hours: 24, // 1 day
        enable_fullscreen_expiry_warning: true,
      },
      {
        id: 'default-tka_associate',
        role: 'tka_associate',
        session_timeout_minutes: 240, // 4 hours
        auto_logout_timeout_minutes: 15,
        warning_time_minutes: 5,
        is_global: false,
        remember_me_duration_hours: 48, // 2 days
        enable_fullscreen_expiry_warning: true,
      },
    ]
  }
}

// Created and developed by Jai Singh
