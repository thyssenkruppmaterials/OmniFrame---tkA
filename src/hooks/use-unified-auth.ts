/**
 * Unified Auth Hook
 * Single comprehensive hook replacing all auth-related hooks
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  useAuthState,
  usePermissions,
  useAuthActions,
  useSession,
} from '@/lib/auth/auth-provider'
import type {
  UseUnifiedAuthReturn,
  PermissionCheckContext,
  UserProfile,
} from '@/lib/auth/types'
import { logger } from '@/lib/utils/logger'

interface UseUnifiedAuthOptions {
  enableAutoRefresh?: boolean
  refreshInterval?: number
  enablePermissionCaching?: boolean
}

export function useUnifiedAuth(
  options: UseUnifiedAuthOptions = {}
): UseUnifiedAuthReturn {
  const {
    enableAutoRefresh = true,
    refreshInterval = 5 * 60 * 1000, // 5 minutes
    enablePermissionCaching = true,
  } = options

  // Core auth state
  const authState = useAuthState()
  const permissions = usePermissions()
  const authActions = useAuthActions()
  const session = useSession()

  // Local state for enhanced functionality
  const [isCheckingPermission, setIsCheckingPermission] = useState(false)
  const [lastPermissionCheck, setLastPermissionCheck] = useState<number>(0)
  const [permissionCheckCache, setPermissionCheckCache] = useState<
    Map<string, boolean>
  >(new Map())

  // Auto-refresh session if enabled
  useEffect(() => {
    if (!enableAutoRefresh || !authState.isAuthenticated) return

    const interval = setInterval(async () => {
      if (session.expiryInfo?.needsRefresh) {
        await authActions.refreshSession()
      }
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [
    enableAutoRefresh,
    refreshInterval,
    authState.isAuthenticated,
    session.expiryInfo?.needsRefresh,
    authActions,
  ])

  // Enhanced permission checking with caching
  const checkPermission = useCallback(
    async (
      resource: string,
      action: string,
      context?: PermissionCheckContext
    ): Promise<boolean> => {
      if (!authState.isAuthenticated) return false

      const cacheKey = `${resource}:${action}:${JSON.stringify(context || {})}`
      const now = Date.now()

      // Check local cache first (for fast subsequent checks)
      if (enablePermissionCaching) {
        const cached = permissionCheckCache.get(cacheKey)
        if (cached !== undefined && now - lastPermissionCheck < 30000) {
          // 30 second cache
          return cached
        }
      }

      setIsCheckingPermission(true)
      setLastPermissionCheck(now)

      try {
        // Use the permissions context which has its own caching
        const result = await permissions.hasPermission(resource, action)

        // Update local cache
        if (enablePermissionCaching) {
          setPermissionCheckCache((prev) => new Map(prev.set(cacheKey, result)))
        }

        return result
      } catch (error) {
        logger.error('Permission check error:', error)
        return false
      } finally {
        setIsCheckingPermission(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- permissionCheckCache excluded to prevent cache-update-triggers-recreate loop; cache reads are stale-safe
    [
      authState.isAuthenticated,
      permissions,
      enablePermissionCaching,
      lastPermissionCheck,
    ]
  )

  // Synchronous permission check (faster, cache-only)
  const checkPermissionSync = useCallback(
    (resource: string, action: string): boolean => {
      if (!authState.isAuthenticated) return false

      // Use the sync version from permissions context
      return permissions.hasPermissionSync(resource, action)
    },
    [authState.isAuthenticated, permissions]
  )

  // Batch permission checking
  const checkMultiplePermissions = useCallback(
    async (
      permissionList: Array<{
        resource: string
        action: string
        context?: PermissionCheckContext
      }>
    ): Promise<boolean[]> => {
      if (!authState.isAuthenticated)
        return new Array(permissionList.length).fill(false)

      const results = await Promise.all(
        permissionList.map(({ resource, action, context }) =>
          checkPermission(resource, action, context)
        )
      )

      return results
    },
    [authState.isAuthenticated, checkPermission]
  )

  // Check if user has any of the specified permissions
  const hasAnyPermission = useCallback(
    (perms: Array<{ resource: string; action: string }>): boolean => {
      if (!authState.isAuthenticated) return false
      return permissions.hasAnyPermission(
        perms.map((p) => `${p.resource}:${p.action}`)
      )
    },
    [authState.isAuthenticated, permissions]
  )

  // Check if user has all of the specified permissions
  const hasAllPermissions = useCallback(
    (perms: Array<{ resource: string; action: string }>): boolean => {
      if (!authState.isAuthenticated) return false
      return permissions.hasAllPermissions(
        perms.map((p) => `${p.resource}:${p.action}`)
      )
    },
    [authState.isAuthenticated, permissions]
  )

  // Check role feature
  const hasRoleFeature = useCallback(
    async (featureName: string): Promise<boolean> => {
      if (!authState.isAuthenticated) return false
      return permissions.hasRoleFeature(featureName)
    },
    [authState.isAuthenticated, permissions]
  )

  // Enhanced sign in with error handling
  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await authActions.signIn(email, password)
      // Clear local permission cache on sign in
      setPermissionCheckCache(new Map())
      return result
    },
    [authActions]
  )

  // Enhanced sign up with error handling
  const signUp = useCallback(
    async (
      email: string,
      password: string,
      metadata?: Record<string, unknown>
    ) => {
      const result = await authActions.signUp(email, password, metadata)
      // Clear local permission cache on sign up
      setPermissionCheckCache(new Map())
      return result
    },
    [authActions]
  )

  // Enhanced sign out with cleanup
  const signOut = useCallback(async () => {
    await authActions.signOut()
    // Clear all caches
    setPermissionCheckCache(new Map())
  }, [authActions])

  // Get user display info
  const userDisplayInfo = useMemo(() => {
    if (!authState.user || !authState.profile) {
      return {
        name: 'Guest',
        email: '',
        role: 'guest',
        avatarUrl: null,
        isActive: false,
      }
    }

    const profile = authState.profile
    const role = authState.roles?.[0]

    return {
      name: profile.full_name || profile.first_name || profile.email || 'User',
      email: profile.email,
      role: role?.display_name || profile.role || 'user',
      avatarUrl: profile.avatar_url,
      isActive: profile.status === 'active',
    }
  }, [authState.user, authState.profile, authState.roles])

  // Get authentication status info
  const authStatus = useMemo(() => {
    const sessionExpiry = session.expiryInfo

    return {
      isAuthenticated: authState.isAuthenticated,
      isLoading: authState.isLoading || permissions.isLoading,
      hasError: !!authState.error,
      error: authState.error,
      sessionExpiringSoon: sessionExpiry.isExpiringSoon,
      timeUntilExpiry: sessionExpiry.timeUntilExpiry,
      needsRefresh: sessionExpiry.needsRefresh,
      lastActivity: authState.profile?.last_seen,
      deviceInfo: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
      },
    }
  }, [authState, permissions, session])

  // Get permission statistics
  const permissionStats = useMemo(() => {
    return {
      totalPermissions: permissions.permissions.length,
      cacheStats: permissions.cacheStats,
      isLoading: permissions.isLoading,
      lastRefresh: lastPermissionCheck,
    }
  }, [permissions, lastPermissionCheck])

  // Utility functions
  const refreshAll = useCallback(async () => {
    await Promise.all([
      authActions.refreshSession(),
      permissions.refreshPermissions(),
    ])
    setPermissionCheckCache(new Map())
  }, [authActions, permissions])

  const clearCache = useCallback(() => {
    setPermissionCheckCache(new Map())
  }, [])

  // Return comprehensive auth interface
  return {
    // Core user data
    user: authState.user,
    profile: authState.profile,
    session: authState.session,
    roles: authState.roles,
    permissions: permissions.permissions,

    // Authentication status
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading || permissions.isLoading,
    error: authState.error,

    // Display info
    userDisplayInfo,

    // Status info
    authStatus,

    // Permission functions
    hasPermission: checkPermission,
    hasPermissionSync: checkPermissionSync,
    checkMultiplePermissions,
    hasAnyPermission,
    hasAllPermissions,
    hasRoleFeature,

    // Permission stats
    permissionStats,

    // Auth actions
    signIn,
    signUp,
    signOut,
    resetPassword: authActions.resetPassword,
    updatePassword: authActions.updatePassword,
    refreshSession: authActions.refreshSession,
    updateProfile: useCallback(
      async (userId: string, updates: Partial<UserProfile>) => {
        return authActions.updateProfile(userId, updates)
      },
      [authActions]
    ),
    checkSession: authActions.checkSession,

    // Session management
    sessionInfo: session,

    // Utility functions
    refreshAll,
    clearCache,

    // Advanced features
    isCheckingPermission,
  }
}

// Export types
export type { UseUnifiedAuthOptions }
