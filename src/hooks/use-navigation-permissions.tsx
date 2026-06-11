// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'

interface NavigationPermission {
  navigationItemId: string
  name: string
  title: string
  url: string | null
  visible: boolean
}

interface UseNavigationPermissionsReturn {
  navigationPermissions: NavigationPermission[]
  isLoading: boolean
  error: string | null
  hasNavigationAccess: (itemName: string) => boolean
  hasNavigationAccessByUrl: (url: string) => boolean
  refreshPermissions: () => Promise<void>
}

export function useNavigationPermissions(): UseNavigationPermissionsReturn {
  const [navigationPermissions, setNavigationPermissions] = useState<
    NavigationPermission[]
  >([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { authState } = useUnifiedAuth()
  const { profile } = authState

  const loadNavigationPermissions = async () => {
    // CRITICAL FIX (Jan 6, 2026): Use role_id directly instead of looking up by role name
    // This fixes custom roles like "TKA supervisor" not getting correct navigation permissions
    if (!profile?.role_id) {
      setNavigationPermissions([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      logger.log('=== NAVIGATION PERMISSION LOADING (FIXED) ===')
      logger.log(
        'Loading navigation permissions using role_id:',
        profile.role_id
      )

      // Get navigation items with role permissions using role_id directly
      // No need to look up role by name - use the role_id from the user profile
      const { data, error: fetchError } =
        await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('navigation_items')
              .select(
                `
          id,
          name,
          title,
          url,
          role_navigation_permissions!inner (
            visible,
            role_id
          )
        `
              )
              .eq('role_navigation_permissions.role_id', profile.role_id)
        )

      if (fetchError) {
        logger.error('Error fetching navigation items:', fetchError)
        throw fetchError
      }

      logger.log('Raw navigation data:', data)

      const permissions: NavigationPermission[] =
        data?.map((item) => ({
          navigationItemId: item.id,
          name: item.name,
          title: item.title,
          url: item.url,
          visible: item.role_navigation_permissions?.[0]?.visible ?? true,
        })) || []

      logger.log('Processed navigation permissions:', permissions.length)
      setNavigationPermissions(permissions)
    } catch (err) {
      logger.error('Error loading navigation permissions:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load navigation permissions'
      )

      // Fallback: allow basic navigation items
      setNavigationPermissions([
        {
          navigationItemId: 'dashboard',
          name: 'dashboard',
          title: 'Dashboard',
          url: '/',
          visible: true,
        },
        {
          navigationItemId: 'settings',
          name: 'settings',
          title: 'Settings',
          url: '/settings',
          visible: true,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadNavigationPermissions()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadNavigationPermissions is defined below; triggers on role change
  }, [profile?.role_id])

  const hasNavigationAccess = (itemName: string): boolean => {
    // Check saved permissions for all roles (including superadmin and admin)
    const permission = navigationPermissions.find((p) => p.name === itemName)
    return permission?.visible ?? true // Default to visible if no explicit permission found
  }

  const hasNavigationAccessByUrl = (url: string): boolean => {
    // Check saved permissions for all roles (including superadmin and admin)
    const permission = navigationPermissions.find((p) => p.url === url)
    return permission?.visible ?? true // Default to visible if no explicit permission found
  }

  const refreshPermissions = async () => {
    await loadNavigationPermissions()
  }

  return {
    navigationPermissions,
    isLoading,
    error,
    hasNavigationAccess,
    hasNavigationAccessByUrl,
    refreshPermissions,
  }
}

// Created and developed by Jai Singh
