/**
 * Tab Permissions Hook
 * Provides tab-level permission checking with automatic loading and caching
 */
import { useMemo, useEffect } from 'react'
import { useNavigationStore } from '@/stores/navigationStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'

export interface TabDefinition {
  id: string
  label: string
  description?: string
  display_order?: number
}

export interface UseTabPermissionsReturn {
  allowedTabs: TabDefinition[]
  hasTabAccess: (tabId: string) => boolean
  isLoading: boolean
  error: string | null
  loadTabPermissions: (pageResource?: string) => Promise<void>
  refreshTabPermissions: (pageResource?: string) => Promise<void>
}

/**
 * Hook for managing tab-level permissions
 * Automatically loads and caches tab permissions for the current user
 *
 * @param pageResource - The page resource to filter tabs for (e.g., 'inventory_apps')
 * @param autoLoad - Whether to automatically load permissions on mount (default: true)
 */
export const useTabPermissions = (
  pageResource: string,
  autoLoad = true
): UseTabPermissionsReturn => {
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const currentRoleName = useNavigationStore((s) => s.currentRoleName)
  const {
    tabPermissions,
    loadTabPermissions: storeLoadTabPermissions,
    refreshTabPermissions: storeRefreshTabPermissions,
    isTabLoading,
    error,
  } = usePermissionStore()

  const isAdminRole =
    currentRoleName === 'superadmin' || currentRoleName === 'admin'

  // Load tab permissions when user or page resource changes
  useEffect(() => {
    if (autoLoad && profile?.id && pageResource) {
      logger.log(
        `🔧 TAB LOADING TRIGGER: Loading tabs for ${profile.id} pageResource: ${pageResource}`
      )
      storeLoadTabPermissions(profile.id, pageResource, false)
    }
  }, [autoLoad, profile?.id, pageResource, storeLoadTabPermissions])

  // Treat as loading if we should auto-load but have no data for this pageResource yet.
  // This closes the race between mount and the useEffect triggering the store load.
  const effectiveIsLoading = useMemo(() => {
    if (isTabLoading) return true
    if (isAdminRole) return false
    if (autoLoad && profile?.id && pageResource) {
      const hasDataForResource = tabPermissions.some(
        (tp) => tp.page_resource === pageResource
      )
      if (!hasDataForResource) return true
    }
    return false
  }, [
    isTabLoading,
    isAdminRole,
    autoLoad,
    profile?.id,
    pageResource,
    tabPermissions,
  ])

  // Filter allowed tabs for the current page resource
  const allowedTabs = useMemo(() => {
    if (!pageResource) return []

    return tabPermissions
      .filter((tp) => tp.page_resource === pageResource && tp.granted)
      .map((tp) => ({
        id: tp.tab_id,
        label: tp.tab_label,
        description: undefined,
        display_order: 0,
      }))
      .sort((a, b) => {
        if (a.display_order !== b.display_order) {
          return a.display_order - b.display_order
        }
        return a.label.localeCompare(b.label)
      })
  }, [pageResource, tabPermissions])

  const hasTabAccess = useMemo(() => {
    return (tabId: string): boolean => {
      if (!pageResource || !tabId) return false

      // Admin/superadmin bypass: always grant access (mirrors navigation override)
      if (isAdminRole) return true

      // Fail-open during loading
      if (effectiveIsLoading) return true

      const hasTabPermission = tabPermissions.some(
        (tp) =>
          tp.page_resource === pageResource && tp.tab_id === tabId && tp.granted
      )

      return hasTabPermission
    }
  }, [pageResource, tabPermissions, effectiveIsLoading, isAdminRole])

  // Load tab permissions for a specific page resource
  const loadTabPermissions = useMemo(() => {
    return async (targetPageResource?: string): Promise<void> => {
      if (!profile?.id) return
      const resource = targetPageResource || pageResource
      if (!resource) return

      await storeLoadTabPermissions(profile.id, resource, false) // Force refresh
    }
  }, [profile?.id, pageResource, storeLoadTabPermissions])

  // Refresh tab permissions
  const refreshTabPermissions = useMemo(() => {
    return async (targetPageResource?: string): Promise<void> => {
      const resource = targetPageResource || pageResource
      if (!resource) return

      await storeRefreshTabPermissions(resource)
    }
  }, [pageResource, storeRefreshTabPermissions])

  return {
    allowedTabs,
    hasTabAccess,
    isLoading: effectiveIsLoading,
    error,
    loadTabPermissions,
    refreshTabPermissions,
  }
}

/**
 * Hook for checking a single tab permission
 * Useful for conditional rendering of tab content
 *
 * @param pageResource - The page resource (e.g., 'inventory_apps')
 * @param tabId - The tab ID to check (e.g., 'overview')
 */
export const useTabAccess = (pageResource: string, tabId: string): boolean => {
  const { tabPermissions } = usePermissionStore()

  return useMemo(() => {
    if (!pageResource || !tabId) return false

    // ✅ FIXED: Direct access to tabPermissions array for reactivity
    return tabPermissions.some(
      (tp) =>
        tp.page_resource === pageResource && tp.tab_id === tabId && tp.granted
    )
  }, [pageResource, tabId, tabPermissions]) // ✅ FIXED: tabPermissions array dependency
}

/**
 * Hook for getting all allowed tabs across multiple page resources
 * Useful for navigation menus and administration interfaces
 *
 * @param pageResources - Array of page resources to get tabs for
 */
export const useMultiPageTabPermissions = (
  pageResources: string[]
): Record<string, TabDefinition[]> => {
  const { tabPermissions } = usePermissionStore()

  return useMemo(() => {
    const result: Record<string, TabDefinition[]> = {}

    pageResources.forEach((pageResource) => {
      result[pageResource] = tabPermissions
        .filter((tp) => tp.page_resource === pageResource && tp.granted)
        .map((tp) => ({
          id: tp.tab_id,
          label: tp.tab_label,
          description: undefined,
          display_order: 0,
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
    })

    return result
  }, [pageResources, tabPermissions])
}

/**
 * Hook for checking if user has any tab access for a page resource
 * Useful for showing/hiding entire page sections
 *
 * @param pageResource - The page resource to check
 */
export const useHasAnyTabAccess = (pageResource: string): boolean => {
  const { tabPermissions } = usePermissionStore()

  return useMemo(() => {
    if (!pageResource) return false

    return tabPermissions.some(
      (tp) => tp.page_resource === pageResource && tp.granted
    )
  }, [pageResource, tabPermissions])
}

/**
 * Hook for admin interfaces to manage tab permissions
 * Provides additional functionality for role and user management
 */
export const useTabPermissionManagement = () => {
  const { getAllowedTabs, loadTabPermissions, refreshTabPermissions } =
    usePermissionStore()
  const { authState } = useUnifiedAuth()
  const { profile } = authState

  return {
    getAllowedTabs,
    loadTabPermissions: (userId: string, pageResource?: string) => {
      return loadTabPermissions(userId, pageResource, false)
    },
    refreshTabPermissions,
    currentUserId: profile?.id || null,
  }
}
