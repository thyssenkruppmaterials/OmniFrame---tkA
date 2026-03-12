/**
 * Unified Auth Provider - REDESIGNED
 *
 * Streamlined authentication provider that uses SingletonAuthManager
 * to eliminate all multiple GoTrueClient issues while preserving functionality.
 *
 * KEY IMPROVEMENTS:
 * ✅ Uses SingletonAuthManager (eliminates multiple clients)
 * ✅ HMR-resistant initialization (development-friendly)
 * ✅ Simplified provider hierarchy (no nested auth providers)
 * ✅ Comprehensive error recovery (network failures + timeouts)
 * ✅ All existing functionality preserved (zero breaking changes)
 *
 * @author Jai Singh
 * @date 2025-01-21
 * @version 2.0.0 - Comprehensive Authentication Redesign
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from 'react'
import { PermissionProvider } from '@/providers/PermissionProvider'
import {
  authBroadcast,
  type AuthBroadcastMessage,
} from '@/lib/auth/broadcast-channel'
import {
  singletonAuthManager,
  type AuthState,
} from '@/lib/auth/singleton-auth-manager'
import { logger } from '@/lib/utils/logger'
import type { User } from './types'

// Extend Window interface for dev tools
declare global {
  interface Window {
    __AUTH_STATE__?: () => AuthState
    __AUTH_HEALTH__?: () => Promise<{
      status: 'healthy' | 'degraded' | 'critical'
      message: string
      details: Record<string, unknown>
    }>
  }
}

// Auth Context
interface AuthContextType {
  authState: AuthState
  isLoading: boolean
  error: Error | null
  signIn: (
    email: string,
    password: string
  ) => Promise<{ user: User | null; error: Error | null }>
  signOut: () => Promise<void>
  checkPermission: (permission: string) => Promise<boolean>
}

const AuthContext = createContext<AuthContextType | null>(null)

/**
 * Props for UnifiedAuthProvider
 */
interface UnifiedAuthProviderProps {
  children: ReactNode
  enableDevTools?: boolean
  onAuthChange?: (state: AuthState) => void
  onError?: (error: Error) => void
}

/**
 * Unified Auth Provider - Uses SingletonAuthManager for all auth operations
 */
export function UnifiedAuthProvider({
  children,
  enableDevTools = false,
  onAuthChange,
  onError,
}: UnifiedAuthProviderProps) {
  // State management
  const [authState, setAuthState] = useState<AuthState>(
    singletonAuthManager.getAuthState()
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Initialization protection
  const isInitialized = useRef(false)
  const isInitializing = useRef(false)

  // Initialize auth system
  useEffect(() => {
    if (isInitialized.current || isInitializing.current) {
      if (enableDevTools) {
        logger.log('🔒 UnifiedAuthProvider already initialized or initializing')
      }
      return
    }

    isInitializing.current = true

    // Setup auth state listener
    const handleAuthStateChange = (newState: AuthState) => {
      setAuthState(newState)
      setError(newState.error)

      if (onAuthChange) {
        onAuthChange(newState)
      }

      if (enableDevTools) {
        logger.log('🔐 Auth state updated:', {
          isAuthenticated: newState.isAuthenticated,
          userEmail: newState.user?.email,
        })
      }
    }

    const initializeAuth = async () => {
      try {
        setIsLoading(true)

        // Get initial auth state from singleton
        const initialState = singletonAuthManager.getAuthState()
        setAuthState(initialState)

        singletonAuthManager.addStateListener(handleAuthStateChange)

        // Initial auth change notification
        if (onAuthChange) {
          onAuthChange(initialState)
        }

        if (enableDevTools) {
          logger.log(
            '✅ UnifiedAuthProvider initialized with SingletonAuthManager'
          )
          // Enable auth dev tools
          window.__AUTH_STATE__ = () => singletonAuthManager.getAuthState()
          window.__AUTH_HEALTH__ = () => singletonAuthManager.getHealthStatus()
          logger.log(
            'Auth dev tools enabled. Use window.__AUTH_STATE__(), window.__AUTH_HEALTH__()'
          )
        }

        isInitialized.current = true
      } catch (error) {
        const authError =
          error instanceof Error
            ? error
            : new Error('Auth initialization failed')
        setError(authError)

        if (onError) {
          onError(authError)
        }

        if (enableDevTools) {
          logger.error(
            '❌ UnifiedAuthProvider initialization error:',
            authError
          )
        }
      } finally {
        setIsLoading(false)
        isInitializing.current = false
      }
    }

    initializeAuth()

    // Listen for cross-tab auth broadcasts
    const removeBroadcastListener = authBroadcast.addListener(
      (message: AuthBroadcastMessage) => {
        switch (message.type) {
          case 'SIGNED_OUT':
          case 'SESSION_EXPIRED':
            // Another tab signed out or session expired - sign out locally and redirect
            singletonAuthManager.signOut().then(() => {
              window.location.href = '/sign-in'
            })
            break
          case 'PERMISSIONS_UPDATED':
            // Another tab updated permissions - refresh local permissions
            if (singletonAuthManager.getCurrentUser()?.id) {
              singletonAuthManager.loadUserPermissions(
                singletonAuthManager.getCurrentUser()!.id
              )
            }
            break
        }
      }
    )

    // Return cleanup function for useEffect
    return () => {
      singletonAuthManager.removeStateListener(handleAuthStateChange)
      removeBroadcastListener()
      isInitialized.current = false
    }
  }, [enableDevTools, onAuthChange, onError])

  // Auth methods using singleton manager
  const signIn = async (email: string, password: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await singletonAuthManager.signIn(email, password)
      return result
    } catch (error) {
      const authError =
        error instanceof Error ? error : new Error('Sign in failed')
      setError(authError)

      if (onError) {
        onError(authError)
      }

      return { user: null, error: authError }
    } finally {
      setIsLoading(false)
    }
  }

  const signOut = async () => {
    setIsLoading(true)
    setError(null)

    try {
      await singletonAuthManager.signOut()
    } catch (error) {
      const authError =
        error instanceof Error ? error : new Error('Sign out failed')
      setError(authError)

      if (onError) {
        onError(authError)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const checkPermission = async (permission: string) => {
    try {
      return await singletonAuthManager.checkPermission(permission)
    } catch (error) {
      if (enableDevTools) {
        logger.error('❌ Permission check error:', error)
      }
      return false
    }
  }

  // Context value
  const contextValue: AuthContextType = {
    authState,
    isLoading,
    error,
    signIn,
    signOut,
    checkPermission,
  }

  return (
    <AuthContext.Provider value={contextValue}>
      <PermissionProvider>{children}</PermissionProvider>
    </AuthContext.Provider>
  )
}

/**
 * Hook to access auth context
 */
export function useUnifiedAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useUnifiedAuth must be used within UnifiedAuthProvider')
  }
  return context
}

/**
 * Legacy hook for backward compatibility
 */
export function useAuthState(): AuthState {
  const { authState } = useUnifiedAuth()
  return authState
}

/**
 * Export singleton manager for direct access when needed
 */
export { singletonAuthManager }
// Developer and Creator: Jai Singh
