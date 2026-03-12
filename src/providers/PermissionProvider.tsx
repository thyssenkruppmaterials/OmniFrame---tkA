import { useEffect, createContext, useContext, ReactNode } from 'react'
import { useNavigationStore } from '@/stores/navigationStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'

interface PermissionProviderProps {
  children: ReactNode
}

// Create context for permission provider
const PermissionContext = createContext<{
  initialized: boolean
}>({
  initialized: false,
})

export function PermissionProvider({ children }: PermissionProviderProps) {
  const { authState } = useUnifiedAuth()
  const { isAuthenticated, profile } = authState
  const {
    loadPermissions,
    clearPermissions,
    currentUserId,
    loadTabPermissions,
    clearTabPermissions,
  } = usePermissionStore()
  const { loadNavigationPermissions, clearNavigationPermissions, currentRole } =
    useNavigationStore()

  // Automatically load permissions when user logs in or profile changes
  useEffect(() => {
    const handleUserChange = async () => {
      // CRITICAL FIX (Jan 6, 2026): Use role_id instead of role for custom role support
      if (isAuthenticated && profile?.id && profile?.role_id) {
        // User is logged in and profile is available
        const needsPermissionLoad = profile.id !== currentUserId
        // Compare role_id for navigation needs, not legacy role enum
        const needsNavigationLoad =
          !currentRole || profile.role_id !== currentRole

        // 🔧 CRITICAL FIX: Clear all caches when user changes to prevent session contamination
        if (needsPermissionLoad) {
          logger.log(
            `🧹 USER CHANGE DETECTED: Clearing all caches for new user ${profile.id} (was ${currentUserId})`
          )
          clearPermissions()
          clearNavigationPermissions()
          clearTabPermissions()
        }

        // Get current permission states to detect if they were cleared
        const permissionState = usePermissionStore.getState()
        const navigationState = useNavigationStore.getState()

        // Check if permissions are empty for authenticated user (indicates clearing during idle)
        const permissionsCleared =
          permissionState.permissions.length === 0 &&
          !permissionState.isLoading &&
          profile.id === currentUserId // Same user, just cleared

        const navigationCleared =
          navigationState.navigationPermissions.length === 0 &&
          !navigationState.isLoading

        if (
          needsPermissionLoad ||
          needsNavigationLoad ||
          permissionsCleared ||
          navigationCleared
        ) {
          logger.log(
            'PermissionProvider: Loading permissions for user:',
            profile.id,
            'role_id:',
            profile.role_id,
            {
              needsPermissionLoad,
              needsNavigationLoad,
              permissionsCleared,
              navigationCleared,
            }
          )

          try {
            // Load resource permissions, navigation permissions, and tab permissions
            const promises = []

            if (needsPermissionLoad || permissionsCleared) {
              promises.push(loadPermissions(profile.id, false)) // Force reload on clearing
            }

            if (needsNavigationLoad || navigationCleared) {
              // CRITICAL FIX: Use role_id (UUID) for navigation permissions
              // This ensures custom roles like "TKA supervisor" get correct navigation
              promises.push(loadNavigationPermissions(profile.role_id, false)) // Use role_id instead of legacy role
            }

            // ✅ CRITICAL FIX: Load tab permissions for user change but NOT bulk all pages
            // Load tab permissions only after user has changed to ensure they have tabs when needed
            if (needsPermissionLoad) {
              logger.log(
                '🔧 Loading tab permissions after user change for seamless tab access'
              )
              promises.push(loadTabPermissions(profile.id, undefined, false)) // Load all tab permissions for new user
            }

            await Promise.all(promises)
          } catch (error) {
            logger.error(
              'PermissionProvider: Failed to load permissions:',
              error
            )
          }
        }
      } else if (!isAuthenticated && (currentUserId || currentRole)) {
        // Only clear permissions if user actually logged out (not temporary auth state)
        // Add a small delay to prevent clearing during temporary auth state inconsistencies
        setTimeout(() => {
          // Check current auth state from UnifiedAuth
          if (!authState.isAuthenticated) {
            logger.log(
              'PermissionProvider: User logged out, clearing permissions'
            )
            clearPermissions()
            clearNavigationPermissions()
            clearTabPermissions()
          }
        }, 500) // 500ms delay to allow auth state to stabilize
      }
    }

    handleUserChange()
  }, [
    isAuthenticated,
    profile?.id,
    profile?.role_id,
    currentUserId,
    currentRole,
    loadPermissions,
    clearPermissions,
    loadNavigationPermissions,
    clearNavigationPermissions,
    loadTabPermissions,
    clearTabPermissions,
    authState.isAuthenticated,
  ])

  // Expose debug information to window object
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const permissionStore = usePermissionStore.getState()
      const navigationStore = useNavigationStore.getState()

      ;(window as unknown as Record<string, unknown>).__PERMISSION_STORE__ = {
        ...permissionStore,
        subscribe: usePermissionStore.subscribe,
        getState: usePermissionStore.getState,
      }
      ;(window as unknown as Record<string, unknown>).__NAVIGATION_STORE__ = {
        ...navigationStore,
        subscribe: useNavigationStore.subscribe,
        getState: useNavigationStore.getState,
      }
    }
  }, [])

  return (
    <PermissionContext.Provider value={{ initialized: true }}>
      {children}
    </PermissionContext.Provider>
  )
}

// Hook to check if permission provider is initialized
export const usePermissionProvider = () => {
  const context = useContext(PermissionContext)
  if (!context) {
    throw new Error(
      'usePermissionProvider must be used within a PermissionProvider'
    )
  }
  return context
}
