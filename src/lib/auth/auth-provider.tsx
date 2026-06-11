// Created and developed by Jai Singh
/**
 * Unified Auth Provider
 * Single provider that handles authentication, permissions, and session management
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react'
import { logger } from '@/lib/utils/logger'
import { authService } from './auth-service'
import { rbacService } from './rbac-service'
import { sessionManager } from './session-manager'
import type {
  AuthState,
  AuthError,
  AuthProviderProps,
  PermissionContextType,
  AuthEvent,
  PermissionCheckContext,
} from './types'

// Create contexts
const AuthContext = createContext<AuthState | null>(null)
const PermissionContext = createContext<PermissionContextType | null>(null)

export function UnifiedAuthProvider({
  children,
  config,
  enableDevTools = false,
  onAuthChange,
  onError,
}: AuthProviderProps) {
  // Core auth state
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    permissions: [],
    roles: [],
    isLoading: true,
    isAuthenticated: false,
    lastSessionCheck: 0,
    sessionExpiresAt: null,
    error: null,
  })

  // Permission state
  const [permissionState, setPermissionState] = useState({
    permissions: [] as string[],
    isLoading: true,
    error: null as string | null,
    cacheStats: {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalRequests: 0,
      averageAccessTime: 0,
      memoryUsage: 0,
      entriesCount: 0,
      hitRate: 0,
    },
  })

  // Add initialization protection to prevent multiple HMR re-initializations
  const isInitializing = useRef(false)
  const hasInitialized = useRef(false)

  // Initialize services
  useEffect(() => {
    const initialize = async () => {
      // Prevent multiple initializations from HMR or re-mounts
      if (isInitializing.current || hasInitialized.current) {
        logger.log('Auth provider already initialized or initializing')
        return
      }

      isInitializing.current = true

      try {
        // Initialize auth service with config
        if (config) {
          await authService.initialize()
        }

        // Initialize session manager (with singleton protection)
        await sessionManager.initialize()

        hasInitialized.current = true

        // Get initial auth state
        const initialState = await authService.getAuthState()
        setAuthState(initialState)

        // Load permissions if user is authenticated
        if (initialState.isAuthenticated && initialState.user) {
          await loadPermissions(initialState.user.id)
        }

        // Set up event listeners
        const handleAuthEvent = (event: AuthEvent) => {
          logger.log('Auth event received:', event.type)

          switch (event.type) {
            case 'SIGNED_IN':
            case 'SIGNED_OUT':
            case 'TOKEN_REFRESHED':
              // Refresh auth state
              refreshAuthState()
              break

            case 'SESSION_EXPIRED':
            case 'SESSION_WARNING':
              // Handle session issues
              handleSessionEvent(event)
              break
          }
        }

        authService.addEventListener(handleAuthEvent)
        sessionManager.addEventListener(handleAuthEvent)

        // Call onAuthChange callback
        if (onAuthChange) {
          onAuthChange(initialState)
        }

        return () => {
          authService.removeEventListener(handleAuthEvent)
          sessionManager.removeEventListener(handleAuthEvent)
          // Reset initialization state on cleanup
          isInitializing.current = false
        }
      } catch (error) {
        logger.error('Auth provider initialization error:', error)
        isInitializing.current = false
        const authError: AuthError = {
          message:
            error instanceof Error ? error.message : 'Initialization failed',
          timestamp: Date.now(),
        }
        setAuthState((prev) => ({
          ...prev,
          error: authError,
          isLoading: false,
        }))

        if (onError) {
          onError(authError)
        }
      }
    }

    initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- One-time init guarded by isInitializing/hasInitialized refs; adding callback deps would tear down listeners without re-registering them
  }, [config, onAuthChange, onError])

  // Load user permissions
  const loadPermissions = useCallback(async (userId: string) => {
    setPermissionState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      const permissions = await rbacService.getUserPermissions(userId)
      const cacheStats = rbacService.getCacheStats()

      setPermissionState({
        permissions,
        isLoading: false,
        error: null,
        cacheStats: {
          ...cacheStats,
          hitRate: cacheStats.hitRate || 0,
        },
      })
    } catch (error) {
      logger.error('Error loading permissions:', error)
      setPermissionState((prev) => ({
        ...prev,
        isLoading: false,
        error:
          error instanceof Error ? error.message : 'Failed to load permissions',
      }))
    }
  }, [])

  // Refresh auth state
  const refreshAuthState = useCallback(async () => {
    try {
      const newState = await authService.getAuthState()
      setAuthState(newState)

      // Reload permissions if user changed
      if (newState.isAuthenticated && newState.user) {
        await loadPermissions(newState.user.id)
      } else {
        setPermissionState({
          permissions: [],
          isLoading: false,
          error: null,
          cacheStats: permissionState.cacheStats,
        })
      }

      // Call onAuthChange callback
      if (onAuthChange) {
        onAuthChange(newState)
      }
    } catch (error) {
      logger.error('Error refreshing auth state:', error)
      const authError: AuthError = {
        message:
          error instanceof Error
            ? error.message
            : 'Failed to refresh auth state',
        timestamp: Date.now(),
      }
      setAuthState((prev) => ({ ...prev, error: authError }))

      if (onError) {
        onError(authError)
      }
    }
  }, [onAuthChange, onError, loadPermissions, permissionState.cacheStats])

  // Handle session events
  const handleSessionEvent = useCallback((event: AuthEvent) => {
    switch (event.type) {
      case 'SESSION_WARNING':
        logger.warn('Session expiring soon')
        // Could show a toast notification here
        break

      case 'SESSION_EXPIRED':
        logger.error('Session expired')
        setAuthState((prev) => ({
          ...prev,
          isAuthenticated: false,
          error: {
            message: 'Session expired. Please sign in again.',
            timestamp: Date.now(),
          },
        }))
        // Could redirect to sign-in page here
        break
    }
  }, [])

  // Permission checking functions
  const hasPermission = useCallback(
    async (
      resource: string,
      action: string,
      _context?: PermissionCheckContext
    ): Promise<boolean> => {
      return permissionState.permissions.some((perm) => {
        const [permResource, permAction] = perm.split(':')
        return (
          (permResource === resource || permResource === '*') &&
          (permAction === action || permAction === '*')
        )
      })
    },
    [permissionState.permissions]
  )

  const hasAnyPermission = useCallback(
    (permissions: string[]): boolean => {
      return permissions.some((perm) => {
        const [resource, action] = perm.split(':')
        return permissionState.permissions.some((p) => {
          const [pResource, pAction] = p.split(':')
          return (
            (pResource === resource || pResource === '*') &&
            (pAction === action || pAction === '*')
          )
        })
      })
    },
    [permissionState.permissions]
  )

  const hasAllPermissions = useCallback(
    (permissions: string[]): boolean => {
      return permissions.every((perm) => {
        const [resource, action] = perm.split(':')
        return permissionState.permissions.some((p) => {
          const [pResource, pAction] = p.split(':')
          return (
            (pResource === resource || pResource === '*') &&
            (pAction === action || pAction === '*')
          )
        })
      })
    },
    [permissionState.permissions]
  )

  // Permission refresh function
  const refreshPermissions = useCallback(async () => {
    if (authState.user?.id) {
      await loadPermissions(authState.user.id)
    }
  }, [authState.user?.id, loadPermissions])

  // Context values
  const authContextValue = authState

  const permissionContextValue: PermissionContextType = {
    permissions: permissionState.permissions,
    hasPermission,
    hasPermissionSync: (resource: string, action: string) => {
      // Simple synchronous check for basic permissions
      return permissionState.permissions.some((perm) => {
        const [permResource, permAction] = perm.split(':')
        return (
          (permResource === resource || permResource === '*') &&
          (permAction === action || permAction === '*')
        )
      })
    },
    hasAnyPermission,
    hasAllPermissions,
    hasRoleFeature: async (featureName: string) => {
      if (!authState.user?.id) return false
      return rbacService.checkRoleFeature(authState.user.id, featureName)
    },
    refreshPermissions,
    isLoading: permissionState.isLoading,
    error: permissionState.error,
    cacheStats: permissionState.cacheStats,
  }

  // Dev tools
  useEffect(() => {
    if (enableDevTools && typeof window !== 'undefined') {
      // Expose auth state to window for debugging
      const devWindow = window as unknown as Record<string, unknown>
      devWindow.__AUTH_STATE__ = authState
      devWindow.__PERMISSION_STATE__ = permissionState
      devWindow.__AUTH_SERVICE__ = authService
      devWindow.__RBAC_SERVICE__ = rbacService
      devWindow.__SESSION_MANAGER__ = sessionManager

      logger.log('Auth dev tools enabled. Use window.__AUTH_STATE__, etc.')
    }
  }, [enableDevTools, authState, permissionState])

  return (
    <AuthContext.Provider value={authContextValue}>
      <PermissionContext.Provider value={permissionContextValue}>
        {children}
      </PermissionContext.Provider>
    </AuthContext.Provider>
  )
}

// Custom hooks
export function useAuthState(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuthState must be used within UnifiedAuthProvider')
  }
  return context
}

export function usePermissions(): PermissionContextType {
  const context = useContext(PermissionContext)
  if (!context) {
    throw new Error('usePermissions must be used within UnifiedAuthProvider')
  }
  return context
}

export function useAuthActions() {
  return {
    signIn: authService.signIn.bind(authService),
    signUp: authService.signUp.bind(authService),
    signOut: authService.signOut.bind(authService),
    resetPassword: authService.resetPassword.bind(authService),
    updatePassword: authService.updatePassword.bind(authService),
    refreshSession: authService.refreshSession.bind(authService),
    updateProfile: authService.updateProfile.bind(authService),
    checkSession: authService.validateSession.bind(authService),
  }
}

export function useSession() {
  const [sessionState, setSessionState] = useState(
    sessionManager.getSessionState()
  )

  useEffect(() => {
    const updateSessionState = () => {
      setSessionState(sessionManager.getSessionState())
    }

    const handleAuthEvent = (event: AuthEvent) => {
      if (
        ['TOKEN_REFRESHED', 'SESSION_WARNING', 'SESSION_EXPIRED'].includes(
          event.type
        )
      ) {
        updateSessionState()
      }
    }

    // Initial state
    updateSessionState()

    // Listen for changes
    sessionManager.addEventListener(handleAuthEvent)

    // Update every 30 seconds
    const interval = setInterval(updateSessionState, 30000)

    return () => {
      sessionManager.removeEventListener(handleAuthEvent)
      clearInterval(interval)
    }
  }, [])

  return {
    ...sessionState,
    expiryInfo: sessionManager.getExpiryInfo(),
    analytics: sessionManager.getAnalytics(),
    forceCheck: sessionManager.forceCheck.bind(sessionManager),
    enableBackgroundRefresh:
      sessionManager.enableBackgroundRefresh.bind(sessionManager),
    disableBackgroundRefresh:
      sessionManager.disableBackgroundRefresh.bind(sessionManager),
  }
}

// Export contexts for advanced use cases
export { AuthContext, PermissionContext }

// Created and developed by Jai Singh
