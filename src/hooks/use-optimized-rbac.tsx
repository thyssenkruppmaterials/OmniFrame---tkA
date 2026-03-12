import { usePermissionStore, useRBAC } from '@/stores/permissionStore'
import type { UserPermission } from '@/lib/auth/types'

interface UseOptimizedRBACReturn {
  permissions: string[]
  userPermissions: UserPermission[]
  hasPermission: (action: string, resource: string) => boolean
  checkPermission: (action: string, resource: string) => Promise<boolean>
  isLoading: boolean
  error: string | null
  refreshPermissions: () => Promise<void>
}

/**
 * Optimized RBAC hook that uses global Zustand store for state management.
 * This ensures all components share the same permission state and prevents
 * multiple instances from interfering with each other.
 *
 * @deprecated Consider using useRBAC directly from the store for new code
 */
export function useOptimizedRBAC(): UseOptimizedRBACReturn {
  // Use the global permission store
  const rbac = useRBAC()

  // Expose to window for debugging
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__RBAC_STATE__ = {
      ...rbac,
      store: usePermissionStore.getState(),
      subscribe: usePermissionStore.subscribe,
    }
  }

  // Debug logging removed to prevent infinite render loops
  // Uncomment only for debugging specific permission issues:
  // logger.log('=== USE OPTIMIZED RBAC DEBUG ===')
  // logger.log('Permissions loaded:', rbac.permissions?.length || 0)
  // logger.log('Permissions:', rbac.permissions)
  // logger.log('Loading:', rbac.isLoading)
  // logger.log('Error:', rbac.error)

  return rbac
}

// Export the store hooks for direct use (recommended for new code)
export {
  useRBAC,
  usePermissions,
  useHasPermission,
  useCheckPermission,
  usePermissionActions,
} from '@/stores/permissionStore'
