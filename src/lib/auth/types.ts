/**
 * Unified Authentication and Authorization Types
 * Comprehensive type definitions for the new unified auth system
 */
// Use native Supabase types for compatibility
import type {
  User as SupabaseUser,
  Session as SupabaseSession,
} from '@supabase/supabase-js'

// Simplified types that work with current database schema
export type User = SupabaseUser

export type Session = SupabaseSession

export interface AuthUser {
  id: string
  email?: string
  role: string[]
  profile?: UserProfile
  permissions?: string[]
  sessionId?: string
}

export interface AuthFactor {
  id: string
  status: 'verified' | 'unverified'
  factor_type: string
  friendly_name?: string
  created_at: string
  updated_at: string
}

export interface Identity {
  id: string
  user_id: string
  identity_data: Record<string, unknown>
  provider: string
  created_at: string
  updated_at: string
  last_sign_in_at?: string
}

// User Profile Types
export interface UserProfile {
  id: string
  email: string
  email_verified: boolean | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  username: string | null
  phone_number: string | null
  avatar_url: string | null
  role: string | null
  role_id: string
  status: UserStatus | null
  two_factor_enabled: boolean | null
  last_seen: string | null
  organization_id: string | null
  preferences: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  outbound_column_order: Record<string, unknown> | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

// Enums and Status Types
export type UserStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'pending'
  | 'invited'
export type UserRole =
  | 'superadmin'
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'viewer'
  | 'tka_associate'

// Permission and RBAC Types
export interface Permission {
  id: string
  name?: string
  resource: string
  action: string
  description?: string | null
  is_active?: boolean
  is_critical?: boolean
  requires_2fa?: boolean
  risk_level?: 'low' | 'medium' | 'high' | 'critical'
  scope?: 'application' | 'system' | 'organization' | 'user'
  created_at?: string | null
  updated_at?: string | null
}

export interface Role {
  id: string
  name: string
  display_name: string
  description?: string | null
  created_by?: string | null
  is_system?: boolean | null
  is_active?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

export interface RoleWithHierarchy extends Role {
  level?: number
  path?: string[]
  name_path?: string[]
  depth?: number
  permissions_count?: number
  priority?: number
  max_users?: number | null
  features?: Record<string, boolean> | null
  metadata?: Record<string, unknown> | null
  parent_role_id?: string | null
}

export interface UserPermission {
  id: string
  user_id: string
  permission_id: string
  granted: boolean
  expires_at?: string
  granted_by?: string
  reason?: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface RolePermission {
  id: string
  role_id: string
  permission_id: string
  created_at: string
}

export interface PermissionCheckContext {
  resource_id?: string
  organization_id?: string
  ip_address?: string
  user_agent?: string
  session_id?: string
  request_path?: string
  check_reason?: string
  metadata?: Record<string, unknown>
}

export interface PermissionCheckResult {
  granted: boolean
  source: 'direct' | 'inherited' | 'cached' | 'wildcard'
  role_sources: string[]
  check_time_ms: number
  requires_2fa?: boolean
  risk_level?: string
  audit_id?: string
  cached_at?: number
  expires_at?: number
}

export interface PermissionWithCategory extends Permission {
  // Explicitly declare name (inherited but needed for clarity)
  name: string
  category_name: string | null
  category_display_name: string | null
  category_icon: string | null
  required_dependencies_count: number
  optional_dependencies_count: number
  conflicts_count: number
  tags: string[]
}

// Cache Types
export interface CacheEntry<T = unknown> {
  data: T
  timestamp: number
  expires_at: number
  access_count: number
  last_accessed: number
  key: string
  tags: string[]
}

export interface CacheConfig {
  maxEntries: number
  defaultTTL: number
  enableCompression?: boolean
  enableMetrics?: boolean
}

export interface CacheMetrics {
  hits: number
  misses: number
  evictions: number
  totalRequests: number
  averageAccessTime: number
  memoryUsage: number
  entriesCount: number
}

// Service Types
export interface AuthServiceConfig {
  cacheEnabled: boolean
  cacheTTL: number
  enableMetrics: boolean
  enableAudit: boolean
  sessionCheckInterval: number
  sessionWarningTime: number
  maxConcurrentRequests: number
}

export interface AuthState {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  permissions: string[]
  roles: RoleWithHierarchy[]
  isLoading: boolean
  isAuthenticated: boolean
  lastSessionCheck: number
  sessionExpiresAt: number | null | undefined
  error: AuthError | null
}

export interface AuthError {
  message: string
  code?: string
  details?: Record<string, unknown>
  timestamp: number
}

// Provider Types
export interface AuthProviderProps {
  children: React.ReactNode
  config?: Partial<AuthServiceConfig>
  enableDevTools?: boolean
  onAuthChange?: (state: AuthState) => void
  onError?: (error: AuthError) => void
}

export interface PermissionProviderProps {
  children: React.ReactNode
  enableCaching?: boolean
  cacheSize?: number
  debugMode?: boolean
  onPermissionChange?: (permissions: string[]) => void
}

export interface PermissionContextType {
  permissions: string[]
  hasPermission: (
    resource: string,
    action: string,
    context?: PermissionCheckContext
  ) => Promise<boolean>
  hasPermissionSync: (resource: string, action: string) => boolean
  hasAnyPermission: (permissions: string[]) => boolean
  hasAllPermissions: (permissions: string[]) => boolean
  hasRoleFeature: (featureName: string) => Promise<boolean>
  refreshPermissions: () => Promise<void>
  isLoading: boolean
  error: string | null
  cacheStats: CacheMetrics & { hitRate: number }
}

// Hook Types
export interface UseAuthReturn {
  user: AuthUser | null
  profile: UserProfile | null
  session: Session | null
  permissions: string[]
  roles: RoleWithHierarchy[]
  isAuthenticated: boolean
  isLoading: boolean
  error: AuthError | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    metadata?: Record<string, unknown>
  ) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
  refreshSession: () => Promise<void>
  checkSession: () => Promise<void>
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>
}

export interface UseUnifiedAuthReturn {
  // Core user data
  user: User | null
  profile: UserProfile | null
  session: Session | null
  roles: RoleWithHierarchy[]
  permissions: string[]

  // Authentication status
  isAuthenticated: boolean
  isLoading: boolean
  error: AuthError | null

  // Display info
  userDisplayInfo: {
    name: string
    email?: string
    role: string
    avatarUrl: string | null
    isActive: boolean
  }

  // Status info
  authStatus: {
    isAuthenticated: boolean
    isLoading: boolean
    hasError: boolean
    error: AuthError | null
    sessionExpiringSoon: boolean
    timeUntilExpiry: number | null
    needsRefresh: boolean
    lastActivity: string | null | undefined
    deviceInfo: {
      userAgent: string
      platform: string
      language: string
    }
  }

  // Permission stats
  permissionStats: {
    totalPermissions: number
    cacheStats: CacheMetrics & { hitRate: number }
    isLoading: boolean
    lastRefresh: number
  }

  // Permission functions
  hasPermission: (
    resource: string,
    action: string,
    context?: PermissionCheckContext
  ) => Promise<boolean>
  hasPermissionSync: (resource: string, action: string) => boolean
  checkMultiplePermissions: (
    permissionList: Array<{
      resource: string
      action: string
      context?: PermissionCheckContext
    }>
  ) => Promise<boolean[]>
  hasAnyPermission: (
    perms: Array<{ resource: string; action: string }>
  ) => boolean
  hasAllPermissions: (
    perms: Array<{ resource: string; action: string }>
  ) => boolean
  hasRoleFeature: (featureName: string) => Promise<boolean>

  // Auth actions
  signIn: (email: string, password: string) => Promise<unknown>
  signUp: (
    email: string,
    password: string,
    metadata?: Record<string, unknown>
  ) => Promise<unknown>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
  refreshSession: () => Promise<unknown>
  updateProfile: (
    userId: string,
    updates: Partial<UserProfile>
  ) => Promise<UserProfile>
  checkSession: () => Promise<unknown>

  // Session management
  sessionInfo: {
    expiryInfo: {
      expiresAt: number | null
      timeUntilExpiry: number | null
      isExpiringSoon: boolean
      needsRefresh: boolean
    }
    analytics: {
      totalRefreshes: number
      lastRefreshAttempt: number | null
      averageRefreshInterval: number | null
      healthScore: number
      recommendations: string[]
    }
  }

  // Utility functions
  refreshAll: () => Promise<void>
  clearCache: () => void

  // Advanced features
  isCheckingPermission: boolean
}

export interface UsePermissionReturn {
  hasPermission: boolean
  isLoading: boolean
  isChecking: boolean
  error: string | null
  checkTime: number
}

export interface UsePermissionsReturn {
  permissions: string[]
  hasPermission: (resource: string, action: string) => boolean
  hasAnyPermission: (permissions: string[]) => boolean
  hasAllPermissions: (permissions: string[]) => boolean
  hasRoleFeature: (featureName: string) => Promise<boolean>
  refreshPermissions: () => Promise<void>
  isLoading: boolean
  error: string | null
  cacheStats: CacheMetrics & { hitRate: number }
}

// Audit and Security Types
export interface AuditLog {
  id: string
  user_id: string
  action: string
  resource_type: string
  resource_id?: string
  details: Record<string, unknown>
  ip_address?: string
  user_agent?: string
  session_id?: string
  created_at: string
}

export interface SecurityEvent {
  id: string
  type:
    | 'suspicious_login'
    | 'permission_denied'
    | 'session_anomaly'
    | 'unusual_activity'
  severity: 'low' | 'medium' | 'high' | 'critical'
  user_id: string
  details: Record<string, unknown>
  ip_address: string
  user_agent: string
  resolved: boolean
  created_at: string
  resolved_at?: string
}

export interface SessionInfo {
  id: string
  user_id: string
  created_at: string
  last_activity: string
  expires_at: string
  ip_address: string
  user_agent: string
  is_current: boolean
  device_fingerprint?: string
}

// API Response Types
export interface AuthApiResponse<T = unknown> {
  data: T
  error: null
  success: true
}

export interface AuthApiError {
  data: null
  error: {
    message: string
    code: string
    details?: Record<string, unknown>
  }
  success: false
}

export type ApiResponse<T = unknown> = AuthApiResponse<T> | AuthApiError

// Configuration Types
export interface AuthConfig {
  supabase: {
    url: string
    anonKey: string
    /** @deprecated Service role key must not be used in the frontend. Admin operations are handled via backend API. */
    serviceRoleKey?: string
  }
  cache: CacheConfig
  session: {
    checkInterval: number
    warningTime: number
    maxConcurrentChecks: number
  }
  security: {
    enableAudit: boolean
    enableMetrics: boolean
    enableDeviceFingerprinting: boolean
    maxFailedAttempts: number
    lockoutDuration: number
  }
  features: {
    enable2FA: boolean
    enableSSO: boolean
    enableDeviceManagement: boolean
    enableSessionManagement: boolean
  }
}

// Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<
  T,
  Exclude<keyof T, Keys>
> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>
  }[Keys]

// Event Types
export type AuthEventType =
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'PASSWORD_RECOVERY'
  | 'USER_UPDATED'
  | 'SESSION_EXPIRED'
  | 'SESSION_WARNING'
  | 'PERMISSION_CHANGED'

export interface AuthEvent {
  type: AuthEventType
  user?: User | null
  session?: Session | null
  data?: Record<string, unknown>
  timestamp: number
}

export type AuthEventHandler = (event: AuthEvent) => void

// React Component Props Types
export interface PermissionGuardProps {
  resource: string
  action: string
  fallback?: React.ReactNode
  showError?: boolean
  requireAll?: boolean
  permissions?: string[]
  context?: PermissionCheckContext
  children: React.ReactNode
}

export interface RoleGuardProps {
  roles: string[]
  fallback?: React.ReactNode
  requireAll?: boolean
  children: React.ReactNode
}

export interface AuthGuardProps {
  fallback?: React.ReactNode
  redirectTo?: string
  children: React.ReactNode
}

// Re-export commonly used types for convenience (namespace removed in favor of direct imports)
