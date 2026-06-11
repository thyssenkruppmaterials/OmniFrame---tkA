// Created and developed by Jai Singh
export interface UserSession {
  id: string
  user_id: string
  token_hash: string
  ip_address?: string
  user_agent?: string
  last_activity: string
  expires_at: string
  created_at: string
  // Derived fields
  user_email?: string
  user_name?: string
  user_role?: string
  is_current?: boolean
  time_remaining?: string
  device_type?: string
  device_name?: string // User-assigned device name (e.g., "Warehouse Scanner 3")
  browser?: string
  location?: string
}

export interface SessionStats {
  activeSessions: number
  avgDuration: string
  securityAlerts: number
  autoLogoutRate: string
  totalSessions24h: number
  uniqueUsers24h: number
  peakConcurrentSessions: number
  averageSessionsPerUser: number
}

export interface SessionTimeoutConfig {
  id?: string
  role: string
  session_timeout_minutes: number
  auto_logout_timeout_minutes: number
  warning_time_minutes: number
  is_global: boolean
  remember_me_duration_hours?: number
  enable_fullscreen_expiry_warning?: boolean
  created_at?: string
  updated_at?: string
}

export interface SessionActivity {
  id: string
  user_id: string
  event_type: 'login' | 'logout' | 'timeout' | 'forced_logout' | 'refresh'
  ip_address?: string
  user_agent?: string
  timestamp: string
  user_email?: string
  user_name?: string
  session_duration?: string
  details?: string
}

export interface SecurityAlert {
  id: string
  user_id: string
  alert_type:
    | 'multiple_logins'
    | 'unusual_location'
    | 'brute_force'
    | 'session_hijacking'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  ip_address?: string
  user_agent?: string
  timestamp: string
  resolved: boolean
  user_email?: string
  user_name?: string
}

export interface SessionManagementContextType {
  // Session data
  activeSessions: UserSession[]
  sessionStats: SessionStats | null
  sessionHistory: SessionActivity[]
  securityAlerts: SecurityAlert[]
  timeoutConfigs: SessionTimeoutConfig[]

  // Loading states
  isLoading: boolean
  isRefreshing: boolean

  // Actions
  refreshSessions: () => Promise<void>
  terminateSession: (sessionId: string) => Promise<void>
  terminateUserSession: (userId: string) => Promise<void>
  terminateAllSessions: () => Promise<void>

  // Timeout configuration
  updateTimeoutConfig: (config: SessionTimeoutConfig) => Promise<void>
  createTimeoutConfig: (
    config: Omit<SessionTimeoutConfig, 'id'>
  ) => Promise<void>
  deleteTimeoutConfig: (configId: string) => Promise<void>

  // Security
  resolveSecurityAlert: (alertId: string) => Promise<void>
  generateSecurityReport: () => Promise<void>

  // Analytics
  getSessionAnalytics: (timeRange: string) => Promise<void>
  exportSessionData: (format: 'csv' | 'json') => Promise<void>
}

export type SessionDialogType =
  | 'none'
  | 'timeout-config'
  | 'force-logout-confirm'
  | 'security-alert-details'
  | 'session-details'
  | 'bulk-terminate'

// Created and developed by Jai Singh
