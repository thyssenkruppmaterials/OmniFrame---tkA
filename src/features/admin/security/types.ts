export interface SecurityEvent {
  id: string
  event_type:
    | 'login_anomaly'
    | 'permission_escalation'
    | 'data_access'
    | 'failed_login'
    | 'suspicious_activity'
  severity: 'low' | 'medium' | 'high' | 'critical'
  user_id?: string
  ip_address?: string
  user_agent?: string
  location?: Record<string, unknown>
  metadata?: Record<string, unknown>
  status: 'active' | 'investigating' | 'resolved' | 'false_positive'
  created_at: string
  resolved_at?: string
}

export interface ThreatIndicator {
  id: string
  indicator_type: string
  value: string
  threat_level: 'low' | 'medium' | 'high'
  description?: string
  is_active: boolean
  created_at: string
}

export interface SecurityMetrics {
  total_events: number
  critical_events: number
  high_events: number
  active_threats: number
  resolved_events: number
}

export interface ComplianceReport {
  id: string
  report_type: 'gdpr' | 'sox' | 'hipaa' | 'custom'
  report_data: Record<string, unknown>
  generated_by: string
  date_range: {
    start: string
    end: string
  }
  status: 'generated' | 'reviewed' | 'approved' | 'archived'
  created_at: string
}

export interface DataProcessingActivity {
  id: string
  activity_type: string
  user_id?: string
  data_subject?: string
  purpose: string
  legal_basis?: string
  data_categories?: Record<string, unknown>
  retention_period?: string
  created_at: string
}

export interface SessionRestriction {
  id: string
  user_id: string
  restriction_type:
    | 'ip_whitelist'
    | 'geo_restriction'
    | 'device_limit'
    | 'time_restriction'
  restriction_value: Record<string, unknown>
  is_active: boolean
  created_at: string
}

export interface SecurityAlert extends SecurityEvent {
  user?: {
    id: string
    email: string
    username?: string
    full_name: string
  }
  is_new?: boolean
  risk_score?: number
}

export interface SecurityDashboardData {
  metrics: SecurityMetrics
  recentAlerts: SecurityAlert[]
  activeThreats: ThreatIndicator[]
  securityTimeline: SecurityEvent[]
}

export interface SecurityFilters {
  severity?: ('low' | 'medium' | 'high' | 'critical')[]
  event_type?: SecurityEvent['event_type'][]
  status?: SecurityEvent['status'][]
  date_range?: {
    start: Date
    end: Date
  }
  user_id?: string
}

export interface ThreatDetectionRule {
  id: string
  name: string
  description: string
  conditions: Record<string, unknown>
  actions: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
}
