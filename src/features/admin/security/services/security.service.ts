import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import type {
  ComplianceReport,
  DataProcessingActivity,
  SecurityAlert,
  SecurityEvent,
  SecurityFilters,
  SecurityMetrics,
  SessionRestriction,
  ThreatIndicator,
} from '../types'

// NOTE: Security tables (security_events, threat_indicators, session_restrictions,
// data_processing_activities, compliance_reports) are not yet created in the database.
// Using `any` to bypass TypeScript checking until these tables are created.
const db = supabase as any

export class SecurityService {
  /**
   * Get security metrics for dashboard
   */
  static async getSecurityMetrics(days: number = 30): Promise<SecurityMetrics> {
    try {
      const { data, error } = await db.rpc('get_security_metrics', {
        p_days: days,
      })

      if (error) {
        logger.warn(
          'Security metrics RPC function not found, returning mock data'
        )
        return {
          total_events: 0,
          critical_events: 0,
          high_events: 0,
          active_threats: 0,
          resolved_events: 0,
        }
      }

      // Cast the RPC result properly
      const metricsData = data as any
      return (
        metricsData || {
          total_events: 0,
          critical_events: 0,
          high_events: 0,
          active_threats: 0,
          resolved_events: 0,
        }
      )
    } catch (error) {
      logger.error('Error fetching security metrics:', error)
      throw error
    }
  }

  /**
   * Get security events with optional filtering
   */
  static async getSecurityEvents(
    filters: SecurityFilters = {},
    limit: number = 50,
    offset: number = 0
  ): Promise<SecurityEvent[]> {
    try {
      let query = db
        .from('security_events')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      // Apply filters
      if (filters.severity?.length) {
        query = query.in('severity', filters.severity)
      }

      if (filters.event_type?.length) {
        query = query.in('event_type', filters.event_type)
      }

      if (filters.status?.length) {
        query = query.in('status', filters.status)
      }

      if (filters.user_id) {
        query = query.eq('user_id', filters.user_id)
      }

      if (filters.date_range) {
        query = query
          .gte('created_at', filters.date_range.start.toISOString())
          .lte('created_at', filters.date_range.end.toISOString())
      }

      const { data, error } = await query

      if (error) {
        logger.warn('Security events table not found, returning empty array')
        return []
      }

      return data || []
    } catch (error) {
      logger.warn(
        'Error fetching security events (table may not exist):',
        error
      )
      return []
    }
  }

  /**
   * Get security alerts with user information
   */
  static async getSecurityAlerts(limit: number = 20): Promise<SecurityAlert[]> {
    try {
      const { data, error } = await db
        .from('security_events')
        .select(
          `
          *,
          user:user_profiles!user_id(
            id,
            email,
            username,
            first_name,
            last_name
          )
        `
        )
        .in('severity', ['high', 'critical'])
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error

      return (data || []).map((event: any) => ({
        ...event,
        user: event.user
          ? {
              id: event.user.id,
              email: event.user.email,
              username: event.user.username,
              full_name:
                `${event.user.first_name} ${event.user.last_name}`.trim(),
            }
          : undefined,
        is_new:
          new Date(event.created_at) >
          new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      }))
    } catch (error) {
      logger.error('Error fetching security alerts:', error)
      throw error
    }
  }

  /**
   * Get active threat indicators
   */
  static async getActiveThreats(): Promise<ThreatIndicator[]> {
    try {
      const { data, error } = await db
        .from('threat_indicators')
        .select('*')
        .eq('is_active', true)
        .order('threat_level', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error

      return data || []
    } catch (error) {
      logger.error('Error fetching active threats:', error)
      throw error
    }
  }

  /**
   * Create a new security event
   */
  static async logSecurityEvent(
    eventType: SecurityEvent['event_type'],
    severity: SecurityEvent['severity'],
    description: string,
    userId?: string,
    ipAddress?: string,
    userAgent?: string,
    location?: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    try {
      const { data, error } = await db.rpc('log_security_event', {
        p_event_type: eventType,
        p_severity: severity,
        p_description: description,
        p_user_id: userId,
        p_ip_address: ipAddress,
        p_user_agent: userAgent,
        p_location: location,
        p_metadata: metadata,
      })

      if (error) throw error

      return data
    } catch (error) {
      logger.error('Error logging security event:', error)
      throw error
    }
  }

  /**
   * Update security event status
   */
  static async updateSecurityEventStatus(
    eventId: string,
    status: SecurityEvent['status'],
    notes?: string
  ): Promise<void> {
    try {
      const updateData: any = { status }
      if (status === 'resolved') {
        updateData.resolved_at = new Date().toISOString()
      }
      if (notes) {
        updateData.metadata = { notes }
      }

      const { error } = await db
        .from('security_events')
        .update(updateData)
        .eq('id', eventId)

      if (error) throw error
    } catch (error) {
      logger.error('Error updating security event status:', error)
      throw error
    }
  }

  /**
   * Create threat indicator
   */
  static async createThreatIndicator(
    indicatorType: string,
    value: string,
    threatLevel: ThreatIndicator['threat_level'],
    description?: string
  ): Promise<ThreatIndicator> {
    try {
      const { data, error } = await db
        .from('threat_indicators')
        .insert({
          indicator_type: indicatorType,
          value,
          threat_level: threatLevel,
          description,
        })
        .select()
        .single()

      if (error) throw error

      return data
    } catch (error) {
      logger.error('Error creating threat indicator:', error)
      throw error
    }
  }

  /**
   * Deactivate threat indicator
   */
  static async deactivateThreatIndicator(indicatorId: string): Promise<void> {
    try {
      const { error } = await db
        .from('threat_indicators')
        .update({ is_active: false })
        .eq('id', indicatorId)

      if (error) throw error
    } catch (error) {
      logger.error('Error deactivating threat indicator:', error)
      throw error
    }
  }

  /**
   * Get session restrictions for a user
   */
  static async getSessionRestrictions(
    userId: string
  ): Promise<SessionRestriction[]> {
    try {
      const { data, error } = await db
        .from('session_restrictions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)

      if (error) throw error

      return data || []
    } catch (error) {
      logger.error('Error fetching session restrictions:', error)
      throw error
    }
  }

  /**
   * Create session restriction
   */
  static async createSessionRestriction(
    userId: string,
    restrictionType: SessionRestriction['restriction_type'],
    restrictionValue: Record<string, unknown>
  ): Promise<SessionRestriction> {
    try {
      const { data, error } = await db
        .from('session_restrictions')
        .insert({
          user_id: userId,
          restriction_type: restrictionType,
          restriction_value: restrictionValue,
        })
        .select()
        .single()

      if (error) throw error

      return data
    } catch (error) {
      logger.error('Error creating session restriction:', error)
      throw error
    }
  }

  /**
   * Get data processing activities for GDPR compliance
   */
  static async getDataProcessingActivities(
    userId?: string,
    limit: number = 100
  ): Promise<DataProcessingActivity[]> {
    try {
      let query = db
        .from('data_processing_activities')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (userId) {
        query = query.eq('user_id', userId)
      }

      const { data, error } = await query

      if (error) throw error

      return data || []
    } catch (error) {
      logger.error('Error fetching data processing activities:', error)
      throw error
    }
  }

  /**
   * Create compliance report
   */
  static async createComplianceReport(
    reportType: ComplianceReport['report_type'],
    reportData: Record<string, unknown>,
    dateRange: { start: Date; end: Date }
  ): Promise<ComplianceReport> {
    try {
      const { data, error } = await db
        .from('compliance_reports')
        .insert({
          report_type: reportType,
          report_data: reportData,
          date_range: `[${dateRange.start.toISOString()}, ${dateRange.end.toISOString()}]`,
          generated_by: (await supabase.auth.getUser()).data.user?.id,
        })
        .select()
        .single()

      if (error) throw error

      return data
    } catch (error) {
      logger.error('Error creating compliance report:', error)
      throw error
    }
  }

  /**
   * Get compliance reports
   */
  static async getComplianceReports(
    reportType?: ComplianceReport['report_type'],
    limit: number = 50
  ): Promise<ComplianceReport[]> {
    try {
      let query = db
        .from('compliance_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (reportType) {
        query = query.eq('report_type', reportType)
      }

      const { data, error } = await query

      if (error) throw error

      return data || []
    } catch (error) {
      logger.error('Error fetching compliance reports:', error)
      throw error
    }
  }

  /**
   * Detect suspicious sessions using RPC function
   */
  static async detectSuspiciousSessions(): Promise<any[]> {
    try {
      const { data, error } = await db.rpc('detect_suspicious_sessions')

      if (error) throw error

      return data || []
    } catch (error) {
      logger.error('Error detecting suspicious sessions:', error)
      throw error
    }
  }

  /**
   * Export security data for compliance
   */
  static async exportSecurityData(
    format: 'csv' | 'json' | 'pdf',
    filters: SecurityFilters = {}
  ): Promise<Blob> {
    try {
      const events = await this.getSecurityEvents(filters, 10000) // Get large dataset for export

      if (format === 'json') {
        return new Blob([JSON.stringify(events, null, 2)], {
          type: 'application/json',
        })
      }

      if (format === 'csv') {
        const headers = [
          'ID',
          'Event Type',
          'Severity',
          'Status',
          'User ID',
          'IP Address',
          'Created At',
          'Resolved At',
        ]
        const csv = [
          headers.join(','),
          ...events.map((event) =>
            [
              event.id,
              event.event_type,
              event.severity,
              event.status,
              event.user_id || '',
              event.ip_address || '',
              event.created_at,
              event.resolved_at || '',
            ].join(',')
          ),
        ].join('\n')

        return new Blob([csv], { type: 'text/csv' })
      }

      // For PDF, we'd need a PDF library - for now return JSON
      return new Blob([JSON.stringify(events, null, 2)], {
        type: 'application/json',
      })
    } catch (error) {
      logger.error('Error exporting security data:', error)
      throw error
    }
  }
}
