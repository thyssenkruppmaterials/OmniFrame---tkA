import { useNavigationStore, useNavigation } from '@/stores/navigationStore'

interface NavigationPermission {
  navigationItemId: string
  name: string
  title: string
  url: string | null
  visible: boolean
}

interface UseOptimizedNavigationPermissionsReturn {
  navigationPermissions: NavigationPermission[]
  isLoading: boolean
  error: string | null
  hasNavigationAccess: (itemName: string) => boolean
  hasNavigationAccessByUrl: (url: string) => boolean
  refreshPermissions: () => Promise<void>
}

/**
 * Optimized Navigation Permissions hook that uses global Zustand store for state management.
 * This ensures all components share the same navigation permission state and prevents
 * multiple instances from interfering with each other.
 *
 * @deprecated Consider using useNavigation directly from the store for new code
 */
export function useOptimizedNavigationPermissions(): UseOptimizedNavigationPermissionsReturn {
  // Use the global navigation store
  const navigation = useNavigation()

  // Expose to window for debugging
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__NAVIGATION_STATE__ = {
      ...navigation,
      store: useNavigationStore.getState(),
      subscribe: useNavigationStore.subscribe,
    }
  }

  // Debug logging removed to prevent infinite render loops
  // Uncomment only for debugging specific navigation permission issues:
  // logger.log('=== NAVIGATION PERMISSIONS DEBUG ===')
  // logger.log('Navigation permissions loaded:', navigation.navigationPermissions?.length || 0)
  // logger.log('Navigation permissions:', navigation.navigationPermissions)
  // logger.log('Loading:', navigation.isLoading)
  // logger.log('Error:', navigation.error)

  return {
    navigationPermissions: navigation.navigationPermissions,
    isLoading: navigation.isLoading,
    error: navigation.error,
    hasNavigationAccess: navigation.hasNavigationAccess,
    hasNavigationAccessByUrl: navigation.hasNavigationAccessByUrl,
    refreshPermissions: navigation.refreshNavigationPermissions,
  }
}

// Export the store hooks for direct use (recommended for new code)
export {
  useNavigation,
  useNavigationPermissions,
  useNavigationAccess,
  useNavigationActions,
} from '@/stores/navigationStore'
