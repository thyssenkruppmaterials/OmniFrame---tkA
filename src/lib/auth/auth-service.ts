// Created and developed by Jai Singh
/**
 * Unified Authentication Service
 * Single source of truth for all authentication and authorization operations
 */
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { authCache } from '@/lib/cache/auth-cache'
import type {
  SupabaseResult,
  SupabaseSingleResult,
  PermissionJoinRow,
  UserProfileRow,
} from '@/lib/supabase/rpc-types'
import { logger } from '@/lib/utils/logger'
import type {
  User,
  Session,
  UserProfile,
  AuthState,
  AuthEvent,
  AuthEventHandler,
  PermissionCheckResult,
  PermissionCheckContext,
  RoleWithHierarchy,
  AuthConfig,
} from './types'

export class AuthService {
  private static instance: AuthService
  private config: AuthConfig
  private eventListeners: Set<AuthEventHandler> = new Set()
  private sessionCheckInterval: NodeJS.Timeout | null = null
  private isInitialized = false

  // Default configuration
  private defaultConfig: AuthConfig = {
    supabase: {
      url: import.meta.env.VITE_SUPABASE_URL || '',
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      // SECURITY: serviceRoleKey intentionally omitted — admin operations
      // are handled exclusively via backend API endpoints (/api/admin/*)
    },
    cache: {
      maxEntries: 1000,
      defaultTTL: 5 * 60 * 1000, // 5 minutes
      enableCompression: false,
      enableMetrics: true,
    },
    session: {
      checkInterval: 10 * 60 * 1000, // 10 minutes
      warningTime: 5 * 60 * 1000, // 5 minutes before expiry
      maxConcurrentChecks: 3,
    },
    security: {
      enableAudit: true,
      enableMetrics: true,
      enableDeviceFingerprinting: false,
      maxFailedAttempts: 5,
      lockoutDuration: 15 * 60 * 1000, // 15 minutes
    },
    features: {
      enable2FA: true,
      enableSSO: false,
      enableDeviceManagement: false,
      enableSessionManagement: true,
    },
  }

  private constructor(config?: Partial<AuthConfig>) {
    this.config = { ...this.defaultConfig, ...config }
  }

  static getInstance(config?: Partial<AuthConfig>): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService(config)
    }
    return AuthService.instance
  }

  /**
   * Initialize the auth service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return

    logger.log('Initializing unified auth service...')

    // Validate configuration
    if (!this.config.supabase.url || !this.config.supabase.anonKey) {
      throw new Error('Missing Supabase configuration')
    }

    // Set up auth state change listener via singleton manager
    singletonAuthManager.addAuthStateChangeCallback(
      this.handleAuthStateChange.bind(this)
    )

    // Start session monitoring
    this.startSessionMonitoring()

    // Set up cache cleanup
    this.setupCacheCleanup()

    this.isInitialized = true
    logger.log('Auth service initialized successfully')
  }

  /**
   * Get current authentication state
   */
  async getAuthState(): Promise<AuthState> {
    try {
      const {
        data: { session },
        error,
      } = await singletonAuthManager.getSupabaseClient().auth.getSession()

      if (error) {
        logger.error('Error getting session:', error)
        return this.createEmptyAuthState()
      }

      if (!session) {
        return this.createEmptyAuthState()
      }

      // Get user profile and permissions
      const [profile, permissions, roles] = await Promise.all([
        this.getUserProfile(session.user.id),
        this.getUserPermissions(session.user.id),
        this.getUserRoles(session.user.id),
      ])

      return {
        user: session.user,
        session,
        profile,
        permissions,
        roles,
        isLoading: false,
        isAuthenticated: true,
        lastSessionCheck: Date.now(),
        sessionExpiresAt: session.expires_at
          ? Date.now() + session.expires_in * 1000
          : null,
        error: null,
      }
    } catch (error) {
      logger.error('Error getting auth state:', error)
      return this.createErrorAuthState(error as Error)
    }
  }

  /**
   * Sign in with email and password
   */
  async signIn(email: string, password: string): Promise<AuthState> {
    try {
      this.emitEvent({ type: 'SIGNED_IN', timestamp: Date.now() })

      const { data, error } = await singletonAuthManager
        .getSupabaseClient()
        .auth.signInWithPassword({
          email,
          password,
        })

      if (error) throw error

      // Invalidate cache for this user
      authCache.invalidateUser(data.user.id)

      // Get fresh auth state
      const authState = await this.getAuthState()

      this.emitEvent({
        type: 'SIGNED_IN',
        user: data.user || null,
        session: data.session || null,
        timestamp: Date.now(),
      })

      return authState
    } catch (error) {
      logger.error('Sign in error:', error)
      throw error
    }
  }

  /**
   * Sign up with email and password
   */
  async signUp(
    email: string,
    password: string,
    metadata: Record<string, unknown> = {}
  ): Promise<AuthState> {
    try {
      const { getAppUrl } = await import('@/lib/utils/app-url')
      const { data, error } = await singletonAuthManager
        .getSupabaseClient()
        .auth.signUp({
          email,
          password,
          options: {
            data: metadata,
            emailRedirectTo: `${getAppUrl()}/auth/callback`,
          },
        })

      if (error) throw error

      this.emitEvent({
        type: 'USER_UPDATED',
        user: data.user || null,
        session: data.session || null,
        timestamp: Date.now(),
      })

      return await this.getAuthState()
    } catch (error) {
      logger.error('Sign up error:', error)
      throw error
    }
  }

  /**
   * Sign out current user
   */
  async signOut(): Promise<void> {
    try {
      const {
        data: { user },
      } = await singletonAuthManager.getSupabaseClient().auth.getUser()

      if (user) {
        // Invalidate all user cache
        authCache.invalidateUser(user.id)

        // Clear local storage
        localStorage.removeItem('supabase-auth-token')
        localStorage.removeItem('onebox-auth-token')
      }

      // Sign out from Supabase
      const { error } = await singletonAuthManager
        .getSupabaseClient()
        .auth.signOut()
      if (error) throw error

      this.emitEvent({ type: 'SIGNED_OUT', timestamp: Date.now() })
    } catch (error) {
      logger.error('Sign out error:', error)
      throw error
    }
  }

  /**
   * Reset password
   */
  async resetPassword(email: string): Promise<void> {
    const { getAppUrl } = await import('@/lib/utils/app-url')
    const { error } = await singletonAuthManager
      .getSupabaseClient()
      .auth.resetPasswordForEmail(email, {
        redirectTo: `${getAppUrl()}/auth/reset-password`,
      })
    if (error) throw error
  }

  /**
   * Update password
   */
  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await singletonAuthManager
      .getSupabaseClient()
      .auth.updateUser({
        password: newPassword,
      })
    if (error) throw error
  }

  /**
   * Refresh session
   */
  async refreshSession(): Promise<Session | null> {
    try {
      const { data, error } = await singletonAuthManager
        .getSupabaseClient()
        .auth.refreshSession()
      if (error) throw error

      this.emitEvent({
        type: 'TOKEN_REFRESHED',
        session: data.session,
        timestamp: Date.now(),
      })

      return data.session
    } catch (error) {
      logger.error('Session refresh error:', error)
      return null
    }
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const cacheKey = `profile:${userId}`

    // Check cache first
    const cached = authCache.get<UserProfile>(cacheKey)
    if (cached) return cached

    try {
      const { data, error } = (await singletonAuthManager.executeRead(
        async (client) =>
          await client
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single()
      )) as SupabaseResult<UserProfileRow>

      if (error) {
        logger.warn('Profile fetch error:', error)
        return null
      }

      // Cache the result
      authCache.set(cacheKey, data, this.config.cache.defaultTTL, [
        `user:${userId}`,
        'profile',
      ])
      return {
        ...(data || {}),
        preferences: data?.preferences
          ? typeof data.preferences === 'object'
            ? data.preferences
            : {}
          : null,
      } as UserProfile
    } catch (error) {
      logger.error('Error fetching user profile:', error)
      return null
    }
  }

  /**
   * Get user permissions
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    const cacheKey = `permissions:${userId}`

    // Check cache first
    const cached = authCache.get<string[]>(cacheKey)
    if (cached) return cached

    try {
      // Get permissions from role-based access using role_id
      const { data: userProfile, error: profileError } =
        (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_profiles')
              .select('role_id')
              .eq('id', userId)
              .single()
        )) as SupabaseSingleResult<{ role_id?: string }>

      if (profileError) throw profileError

      // Get role permissions if user has a role_id
      let permissions: string[] = []
      if (userProfile?.role_id) {
        const { data: rolePerms, error: roleError } =
          await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('role_permissions')
                .select(
                  `
              permission:permissions(resource, action)
            `
                )
                .eq('role_id', userProfile?.role_id || '')
          )

        if (!roleError && rolePerms) {
          permissions = (rolePerms as PermissionJoinRow[])
            .map((rp) => rp.permission)
            .filter(
              (p): p is NonNullable<PermissionJoinRow['permission']> => !!p
            )
            .map((p) => `${p.resource}:${p.action}`)
        }
      }

      // Get direct user permissions
      const { data: userPerms, error: userError } =
        await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_permissions')
              .select(
                `
            permission:permissions(resource, action)
          `
              )
              .eq('user_id', userId)
              .eq('granted', true)
        )

      if (!userError && userPerms) {
        const directPerms = (userPerms as PermissionJoinRow[])
          .map((up) => up.permission)
          .filter((p): p is NonNullable<PermissionJoinRow['permission']> => !!p)
          .map((p) => `${p.resource}:${p.action}`)
        permissions = [...permissions, ...directPerms]
      }

      // Cache the result
      authCache.set(cacheKey, permissions, this.config.cache.defaultTTL, [
        `user:${userId}`,
        'permissions',
      ])
      return permissions
    } catch (error) {
      logger.error('Error fetching user permissions:', error)
      return []
    }
  }

  /**
   * Get user roles with hierarchy
   */
  async getUserRoles(userId: string): Promise<RoleWithHierarchy[]> {
    // Simplified implementation for working build
    try {
      const { data: userProfile } = (await singletonAuthManager.executeRead(
        async (client) =>
          await client
            .from('user_profiles')
            .select('role_id, roles(id, name, display_name)')
            .eq('id', userId)
            .single()
      )) as SupabaseSingleResult<{
        role_id?: string
        roles?: { id: string; name: string; display_name: string }
      }>

      if (!userProfile?.role_id) {
        return []
      }

      const roleInfo = userProfile.roles
      return [
        {
          id: roleInfo?.id || userProfile.role_id,
          name: roleInfo?.name || 'unknown',
          display_name: roleInfo?.display_name || roleInfo?.name || 'Unknown',
          description: null,
          parent_role_id: null,
          priority: 0,
          max_users: null,
          is_system: false,
          is_active: true,
          features: null,
          metadata: null,
          created_at: null,
          updated_at: null,
          level: 0,
          path: [roleInfo?.id || userProfile.role_id],
          name_path: [roleInfo?.name || 'unknown'],
          depth: 1,
          permissions_count: 0,
        },
      ]
    } catch (error) {
      logger.error('Error fetching user roles:', error)
      return []
    }
  }

  /**
   * Check user permission
   */
  async checkPermission(
    userId: string,
    resource: string,
    action: string,
    context: PermissionCheckContext = {}
  ): Promise<PermissionCheckResult> {
    const startTime = Date.now()
    const cacheKey = `perm:${userId}:${resource}:${action}`

    // Check cache first
    const cached = authCache.get<PermissionCheckResult>(cacheKey)
    if (cached && Date.now() < (cached.expires_at || 0)) {
      return { ...cached, source: 'cached' }
    }

    try {
      // Check role-based permissions using role_id
      const { data: userProfile, error: profileError } =
        (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_profiles')
              .select('role_id')
              .eq('id', userId)
              .single()
        )) as SupabaseSingleResult<{ role_id?: string }>

      if (profileError) throw profileError

      let granted = false
      if (userProfile?.role_id) {
        // Check role permissions using role_id
        const { data: rolePerms, error: roleError } =
          await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('role_permissions')
                .select(
                  `
              permission:permissions(resource, action)
            `
                )
                .eq('role_id', userProfile?.role_id || '')
          )

        if (!roleError && rolePerms) {
          const matchingPerm = (rolePerms as PermissionJoinRow[]).find((rp) => {
            const perm = rp.permission
            return (
              perm &&
              (perm.resource === resource || perm.resource === '*') &&
              (perm.action === action || perm.action === '*')
            )
          })
          granted = !!matchingPerm
        }
      }

      // If not found in role permissions, check direct user permissions
      if (!granted) {
        const { data: userPerms, error: userError } =
          await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('user_permissions')
                .select(
                  `
              permission:permissions(resource, action)
            `
                )
                .eq('user_id', userId)
                .eq('granted', true)
          )

        if (!userError && userPerms) {
          const matchingPerm = (userPerms as PermissionJoinRow[]).find((up) => {
            const perm = up.permission
            return (
              perm &&
              (perm.resource === resource || perm.resource === '*') &&
              (perm.action === action || perm.action === '*')
            )
          })
          granted = !!matchingPerm
        }
      }

      const result: PermissionCheckResult = {
        granted,
        source: 'direct',
        role_sources: [],
        check_time_ms: Date.now() - startTime,
      }

      // Cache the result for 2 minutes
      const cacheExpiry = Date.now() + 2 * 60 * 1000
      authCache.set(
        cacheKey,
        { ...result, expires_at: cacheExpiry },
        2 * 60 * 1000,
        [`user:${userId}`, `permission:${resource}:${action}`]
      )

      // Log permission check for audit
      if (this.config.security.enableAudit) {
        this.logPermissionCheck(
          userId,
          resource,
          action,
          result.granted,
          context
        )
      }

      return result
    } catch (error) {
      logger.error('Error checking permission:', error)
      return {
        granted: false,
        source: 'direct',
        role_sources: [],
        check_time_ms: Date.now() - startTime,
      }
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(
    userId: string,
    updates: Partial<UserProfile>
  ): Promise<UserProfile> {
    const { data, error } = (await singletonAuthManager.executeWrite(
      async (client) =>
        await client
          .from('user_profiles')
          .update(updates as Record<string, unknown>)
          .eq('id', userId)
          .select()
          .single()
    )) as SupabaseResult<UserProfileRow>

    if (error) throw error

    // Invalidate cache
    authCache.invalidateUser(userId)

    this.emitEvent({
      type: 'USER_UPDATED',
      data: { updates },
      timestamp: Date.now(),
    })

    return {
      ...(data || {}),
      preferences: data?.preferences
        ? typeof data.preferences === 'object'
          ? data.preferences
          : {}
        : null,
    } as UserProfile
  }

  /**
   * Validate session and refresh if needed
   */
  async validateSession(): Promise<boolean> {
    try {
      const {
        data: { session },
        error,
      } = await singletonAuthManager.getSupabaseClient().auth.getSession()

      if (error || !session) {
        return false
      }

      // Check if session is close to expiry
      const now = Date.now()
      const expiresAt = session.expires_at
        ? Date.now() + session.expires_in * 1000
        : Date.now() + 60 * 60 * 1000
      const timeUntilExpiry = expiresAt - now

      if (timeUntilExpiry < this.config.session.warningTime) {
        logger.warn('Session expiring soon, attempting refresh...')
        this.emitEvent({ type: 'SESSION_WARNING', timestamp: now })

        const newSession = await this.refreshSession()
        return !!newSession
      }

      return true
    } catch (error) {
      logger.error('Session validation error:', error)
      return false
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User | null> {
    const {
      data: { user },
    } = await singletonAuthManager.getSupabaseClient().auth.getUser()
    return user
  }

  /**
   * Get current session
   */
  async getCurrentSession(): Promise<Session | null> {
    const {
      data: { session },
    } = await singletonAuthManager.getSupabaseClient().auth.getSession()
    return session
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
   * Get cache statistics
   */
  getCacheStats() {
    return authCache.getStats()
  }

  /**
   * Clear user cache
   */
  clearUserCache(userId: string): void {
    authCache.invalidateUser(userId)
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    authCache.clear()
  }

  /**
   * Destroy service (for cleanup)
   */
  destroy(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval)
      this.sessionCheckInterval = null
    }

    this.eventListeners.clear()
    this.clearAllCache()

    AuthService.instance = null as unknown as AuthService
    this.isInitialized = false
  }

  // Private methods

  private createEmptyAuthState(): AuthState {
    return {
      user: null,
      session: null,
      profile: null,
      permissions: [],
      roles: [],
      isLoading: false,
      isAuthenticated: false,
      lastSessionCheck: Date.now(),
      sessionExpiresAt: null,
      error: null,
    }
  }

  private createErrorAuthState(error: Error): AuthState {
    return {
      ...this.createEmptyAuthState(),
      error: {
        message: error.message,
        timestamp: Date.now(),
      },
    }
  }

  private handleAuthStateChange(event: string, session: Session | null): void {
    logger.log('Auth state change:', event, session?.user?.email)

    switch (event) {
      case 'SIGNED_IN':
        this.emitEvent({
          type: 'SIGNED_IN',
          session,
          user: session?.user,
          timestamp: Date.now(),
        })
        break

      case 'SIGNED_OUT':
        this.emitEvent({ type: 'SIGNED_OUT', timestamp: Date.now() })
        break

      case 'TOKEN_REFRESHED':
        this.emitEvent({
          type: 'TOKEN_REFRESHED',
          session,
          timestamp: Date.now(),
        })
        break
    }
  }

  private emitEvent(event: AuthEvent): void {
    for (const handler of this.eventListeners) {
      try {
        handler(event)
      } catch (error) {
        logger.error('Error in auth event handler:', error)
      }
    }
  }

  private startSessionMonitoring(): void {
    this.sessionCheckInterval = setInterval(async () => {
      const isValid = await this.validateSession()
      if (!isValid) {
        this.emitEvent({ type: 'SESSION_EXPIRED', timestamp: Date.now() })
      }
    }, this.config.session.checkInterval)
  }

  private setupCacheCleanup(): void {
    // Cache cleanup is handled by the cache itself
    // This is just a placeholder for any additional cleanup
  }

  private async logPermissionCheck(
    userId: string,
    resource: string,
    action: string,
    granted: boolean,
    _context: PermissionCheckContext
  ): Promise<void> {
    try {
      // Log permission check (simplified for now)
      logger.log(
        `Permission ${granted ? 'granted' : 'denied'}: ${resource}:${action} for user ${userId}`
      )
    } catch (error) {
      // Don't fail the permission check if logging fails
      logger.warn('Permission logging failed:', error)
    }
  }
}

// Export singleton instance
export const authService = AuthService.getInstance()

// Export types
export type { AuthConfig }

// Created and developed by Jai Singh
