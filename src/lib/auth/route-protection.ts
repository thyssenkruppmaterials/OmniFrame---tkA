/**
 * Centralized Route Protection Utility
 * Provides consistent navigation permission checking for all protected routes
 *
 * SECURITY: This utility enforces navigation permissions at the route level
 * to prevent direct URL access bypass of navigation restrictions.
 */
import { redirect } from '@tanstack/react-router'
import { authService } from '@/lib/auth/auth-service'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { logger } from '@/lib/utils/logger'

export interface RouteProtectionOptions {
  /**
   * The URL path to check navigation permissions for
   * @example '/apps/outbound'
   */
  routePath: string

  /**
   * Optional resource permission to check (action:resource format)
   * @example 'outbound_apps:view'
   */
  resourcePermission?: {
    action: string
    resource: string
  }

  /**
   * Where to redirect on access denial
   * @default '/'
   */
  redirectTo?: string

  /**
   * Custom error page for 403 scenarios
   * @default '/403'
   */
  forbiddenRedirect?: string

  /**
   * Enable debug logging for troubleshooting
   * @default false
   */
  enableDebug?: boolean
}

/**
 * Creates a beforeLoad function with comprehensive route protection
 *
 * This function provides:
 * 1. Authentication validation
 * 2. Navigation permission checking
 * 3. Optional resource permission checking
 * 4. Consistent security logging
 * 5. Proper error handling and redirects
 *
 * @param options - Route protection configuration
 * @returns TanStack Router beforeLoad function
 */
export function createProtectedRouteBeforeLoad(
  options: RouteProtectionOptions
) {
  const {
    routePath,
    resourcePermission,
    redirectTo = '/',
    forbiddenRedirect = '/403',
    enableDebug = false,
  } = options

  return async ({
    location,
  }: {
    location: { pathname: string; href: string }
  }) => {
    const logPrefix = enableDebug ? '🛡️  ROUTE PROTECTION:' : ''

    try {
      if (enableDebug) {
        logger.log(
          `${logPrefix} Checking access for route: ${location.pathname}`
        )
        logger.log(`${logPrefix} Target path: ${routePath}`)
      }

      // Step 1: Validate authentication
      const authState = await authService.getAuthState()

      if (!authState.isAuthenticated || !authState.user) {
        if (enableDebug) {
          logger.log(
            `${logPrefix} ❌ Authentication failed - redirecting to sign-in`
          )
        }

        throw redirect({
          to: '/sign-in',
          search: { redirect: String(location.pathname || '/') },
        })
      }

      if (!authState.profile?.role_id) {
        if (enableDebug) {
          logger.log(
            `${logPrefix} ❌ No user role_id found - redirecting to sign-in`
          )
        }

        throw redirect({
          to: '/sign-in',
          search: { redirect: String(location.pathname || '/') },
        })
      }

      if (enableDebug) {
        logger.log(
          `${logPrefix} ✅ User authenticated: ${authState.user.email}`
        )
        logger.log(
          `${logPrefix} ✅ User role_id: ${authState.profile.role_id}, role_name: ${(authState.profile as unknown as { roles?: { name: string } })?.roles?.name}`
        )
      }

      // Step 2: Get role ID for permission checking
      // CRITICAL FIX (Jan 6, 2026): Use role_id directly from profile instead of looking up by role name
      // This fixes custom roles (like TKA supervisor) getting 403 errors because profile.role is legacy enum
      let roleId = authState.profile?.role_id
      let roleName =
        (authState.profile as unknown as { roles?: { name: string } })?.roles
          ?.name || 'unknown'

      // If role_id is available, use it directly; otherwise fallback to lookup by name
      if (roleId) {
        // Optionally get role name for logging (only in debug mode)
        if (enableDebug) {
          const { data: roleData } = (await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('roles')
                .select('id, name')
                .eq('id', roleId)
                .single()
          )) as { data: { id?: string; name?: string } | null; error: unknown }

          roleName = roleData?.name || roleName
        }
      } else {
        // Fallback: Look up role by name (for backwards compatibility)
        const { data: roleData, error: roleError } =
          (await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('roles')
                .select('id, name')
                .eq('id', authState.profile?.role_id || '')
                .single()
          )) as { data: { id?: string; name?: string } | null; error: unknown }

        if (roleError || !roleData || !roleData.id) {
          if (enableDebug) {
            logger.error(`${logPrefix} ❌ Role lookup failed:`, roleError)
          }

          throw redirect({ to: forbiddenRedirect })
        }

        roleId = roleData.id // Type is now guaranteed to be string after the check above
        roleName = roleData.name || roleName
      }

      if (!roleId) {
        if (enableDebug) {
          logger.error(`${logPrefix} ❌ No role ID found for user`)
        }
        throw redirect({ to: forbiddenRedirect })
      }

      if (enableDebug) {
        logger.log(`${logPrefix} ✅ Role ID: ${roleId}, Role Name: ${roleName}`)
      }

      // Step 3: Check navigation permissions for the specific route
      const { data: navPermission, error: navError } =
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
              .eq('role_navigation_permissions.role_id', roleId)
              .eq('url', routePath)
              .single()
        )

      if (enableDebug) {
        logger.log(`${logPrefix} Navigation permission query:`, {
          navPermission,
          navError,
        })
      }

      const hasNavigationAccess =
        (
          navPermission as unknown as {
            role_navigation_permissions?: { visible: boolean }[]
          }
        )?.role_navigation_permissions?.[0]?.visible === true

      if (navError || !navPermission || !hasNavigationAccess) {
        if (enableDebug) {
          logger.log(
            `${logPrefix} ❌ Navigation permission denied for ${routePath}`
          )
          logger.log(`${logPrefix} Redirecting to: ${redirectTo}`)
        }

        throw redirect({ to: forbiddenRedirect })
      }

      if (enableDebug) {
        logger.log(
          `${logPrefix} ✅ Navigation permission granted for ${routePath}`
        )
      }

      // Step 4: Optional resource permission checking
      // SECURITY: Admin routes enforce resource permissions strictly (fail-closed).
      // Non-admin routes treat resource permissions as supplementary to navigation permissions
      // to prevent legitimate users from getting 403 errors after hard refresh.
      if (resourcePermission) {
        if (enableDebug) {
          logger.log(
            `${logPrefix} Checking resource permission: ${resourcePermission.resource}:${resourcePermission.action}`
          )
        }

        const isAdminRoute = routePath?.startsWith('/admin')

        try {
          const permissionResult = await authService.checkPermission(
            authState.user.id,
            resourcePermission.resource,
            resourcePermission.action
          )

          if (!permissionResult.granted) {
            // For admin routes, enforce strictly - block access (fail-closed)
            if (isAdminRoute) {
              if (enableDebug) {
                logger.log(
                  `${logPrefix} ❌ Resource permission denied for admin route - blocking access`
                )
              }
              throw redirect({ to: forbiddenRedirect || '/403' })
            }

            // For non-admin routes, allow navigation-based access (existing lenient behavior)
            if (enableDebug) {
              logger.log(
                `${logPrefix} ⚠️ Resource permission denied but navigation allowed for non-admin route: ${resourcePermission.resource}:${resourcePermission.action}`
              )
            }
          } else {
            if (enableDebug) {
              logger.log(
                `${logPrefix} ✅ Resource permission granted: ${resourcePermission.resource}:${resourcePermission.action}`
              )
            }
          }
        } catch (resourceError) {
          // Re-throw redirect errors (from the admin block above)
          if (
            resourceError &&
            typeof resourceError === 'object' &&
            'routerId' in resourceError
          ) {
            throw resourceError
          }

          // For admin routes, errors in permission checking should also block access (fail-closed)
          if (isAdminRoute) {
            if (enableDebug) {
              logger.warn(
                `${logPrefix} ❌ Resource permission check failed for admin route - blocking access:`,
                resourceError
              )
            }
            throw redirect({ to: forbiddenRedirect || '/403' })
          }

          // For non-admin routes, continue gracefully on error
          if (enableDebug) {
            logger.warn(
              `${logPrefix} ⚠️ Resource permission check failed, continuing with navigation permission:`,
              resourceError
            )
          }
        }
      }

      if (enableDebug) {
        logger.log(
          `${logPrefix} ✅ All security checks passed for ${routePath}`
        )
      }

      // Return any context data that child routes might need
      return {
        user: authState.user,
        profile: authState.profile,
        hasAccess: true,
      }
    } catch (error) {
      // Handle redirect errors (let them through)
      if (error && typeof error === 'object' && 'routerId' in error) {
        throw error
      }

      // Handle unexpected errors
      if (enableDebug) {
        logger.error(
          `${logPrefix} ❌ Unexpected error during route protection:`,
          error
        )
      }

      throw redirect({ to: forbiddenRedirect })
    }
  }
}

/**
 * Common route protection configurations for OmniFrame applications
 */
export const ROUTE_PROTECTION_CONFIGS = {
  // Warehouse Applications
  INVENTORY: {
    routePath: '/apps/inventory',
    resourcePermission: { action: 'view', resource: 'inventory_apps' },
  },

  INBOUND: {
    routePath: '/apps/inbound',
    resourcePermission: { action: 'view', resource: 'inbound_apps' },
  },

  OUTBOUND: {
    routePath: '/apps/outbound',
    resourcePermission: { action: 'view', resource: 'outbound_apps' },
  },

  KITTING: {
    routePath: '/apps/kitting',
    resourcePermission: { action: 'view', resource: 'kitting_apps' },
  },

  UNIT_PACK: {
    routePath: '/apps/unit-pack',
    resourcePermission: { action: 'view', resource: 'unit_pack_apps' },
  },

  GRS: {
    routePath: '/apps/grs',
    resourcePermission: { action: 'view', resource: 'grs_apps' },
  },

  QUALITY: {
    routePath: '/apps/quality',
    resourcePermission: { action: 'view', resource: 'quality_apps' },
  },

  DATA_MANAGER: {
    routePath: '/apps/data-manager',
    resourcePermission: { action: 'view', resource: 'data_manager' },
  },

  TKA_DATA_MANAGER: {
    routePath: '/apps/tka-data-manager',
    resourcePermission: { action: 'view', resource: 'data_manager' },
  },

  // Productivity Applications
  MY_PRODUCTIVITY: {
    routePath: '/apps/my-productivity',
    resourcePermission: { action: 'view', resource: 'my_productivity' },
  },

  SHIFT_PRODUCTIVITY: {
    routePath: '/apps/shift-productivity',
    resourcePermission: { action: 'view', resource: 'shift_productivity' },
  },

  STANDARD_WORK: {
    routePath: '/apps/standard-work',
    resourcePermission: { action: 'view', resource: 'standard_work' },
  },

  // Integration Applications
  CUSTOMER_PORTAL: {
    routePath: '/apps/customer-portal',
    resourcePermission: { action: 'view', resource: 'customer_portal' },
  },

  SMARTSHEET_INTEGRATIONS: {
    routePath: '/apps/smartsheet-integrations',
    resourcePermission: { action: 'view', resource: 'smartsheet_integrations' },
  },

  // Administration
  USER_MANAGEMENT: {
    routePath: '/admin/user-management',
    resourcePermission: { action: 'manage', resource: 'users' },
  },

  ROLE_MANAGEMENT: {
    routePath: '/admin/roles',
    resourcePermission: { action: 'manage', resource: 'roles' },
  },

  SESSION_MANAGEMENT: {
    routePath: '/admin/session-management',
    resourcePermission: { action: 'manage', resource: 'sessions' },
  },

  PERMISSIONS: {
    routePath: '/admin/permissions',
    resourcePermission: { action: 'manage', resource: 'permissions' },
  },
} as const

/**
 * Creates a standard protected route with predefined configuration
 *
 * @param configKey - Key from ROUTE_PROTECTION_CONFIGS
 * @param customOptions - Optional overrides for the configuration
 * @returns Configured beforeLoad function
 */
export function createStandardProtectedRoute<
  T extends keyof typeof ROUTE_PROTECTION_CONFIGS,
>(configKey: T, customOptions: Partial<RouteProtectionOptions> = {}) {
  const baseConfig = ROUTE_PROTECTION_CONFIGS[configKey]
  const finalConfig = { ...baseConfig, ...customOptions }

  return createProtectedRouteBeforeLoad(finalConfig)
}

// Export types
export type RouteProtectionConfig = keyof typeof ROUTE_PROTECTION_CONFIGS
// Developer and Creator: Jai Singh
