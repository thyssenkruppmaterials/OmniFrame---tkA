import { redirect } from '@tanstack/react-router'
import { rbacService } from '@/lib/auth/rbac-service'
import type { PermissionCheckContext } from '@/lib/auth/types'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export interface RBACMiddlewareOptions {
  requiredPermissions?: Array<{
    resource: string
    action: string
  }>
  requireAll?: boolean
  roleFeatures?: string[]
  customCheck?: (userId: string) => Promise<boolean>
  redirectTo?: string
  context?: Partial<PermissionCheckContext>
}

export interface RBACCheckResult {
  allowed: boolean
  reason?: string
  missingPermissions?: string[]
  redirectPath?: string
}

/**
 * RBAC middleware for TanStack Router
 * Used in route definitions to protect routes based on permissions
 */
export class RBACMiddleware {
  private static instance: RBACMiddleware
  private sessionCache = new Map<string, { userId: string; expires: number }>()

  static getInstance(): RBACMiddleware {
    if (!RBACMiddleware.instance) {
      RBACMiddleware.instance = new RBACMiddleware()
    }
    return RBACMiddleware.instance
  }

  /**
   * Main middleware function for route protection
   */
  async checkRouteAccess(
    options: RBACMiddlewareOptions = {}
  ): Promise<RBACCheckResult> {
    const {
      requiredPermissions = [],
      requireAll = true,
      roleFeatures = [],
      customCheck,
      redirectTo = '/sign-in',
      context = {},
    } = options

    try {
      // Get current session
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError || !session) {
        return {
          allowed: false,
          reason: 'No valid session',
          redirectPath: redirectTo,
        }
      }

      const userId = session.user.id

      // Add session context
      const enhancedContext: PermissionCheckContext = {
        ...context,
        session_id: session.access_token,
        ip_address: context.ip_address,
        user_agent: context.user_agent || navigator.userAgent,
        request_path: String(window.location.pathname || '/'),
      }

      // Check required permissions
      if (requiredPermissions.length > 0) {
        const permissionResults = await Promise.all(
          requiredPermissions.map(async (perm) => {
            const result = await rbacService.checkPermission(
              userId,
              perm.resource,
              perm.action,
              enhancedContext
            )
            return {
              permission: `${perm.resource}:${perm.action}`,
              granted: result.granted,
              requires2fa: result.requires_2fa,
              riskLevel: result.risk_level,
            }
          })
        )

        const grantedPermissions = permissionResults.filter((p) => p.granted)
        const deniedPermissions = permissionResults.filter((p) => !p.granted)

        // Check if user meets the requirement (all or any)
        const hasAccess = requireAll
          ? grantedPermissions.length === requiredPermissions.length
          : grantedPermissions.length > 0

        if (!hasAccess) {
          return {
            allowed: false,
            reason: requireAll
              ? 'Missing required permissions'
              : 'No matching permissions found',
            missingPermissions: deniedPermissions.map((p) => p.permission),
            redirectPath: '/403',
          }
        }

        // Check for 2FA requirements
        const requires2FA = permissionResults.some(
          (p) => p.granted && p.requires2fa
        )
        if (requires2FA && !session.user.user_metadata?.mfa_verified) {
          return {
            allowed: false,
            reason: 'Two-factor authentication required',
            redirectPath: '/auth/mfa',
          }
        }
      }

      // Check role features
      if (roleFeatures.length > 0) {
        const featureChecks = await Promise.all(
          roleFeatures.map((feature) =>
            rbacService.checkRoleFeature(userId, feature)
          )
        )

        const hasAllFeatures = featureChecks.every((result) => result)
        if (!hasAllFeatures) {
          return {
            allowed: false,
            reason: 'Missing required role features',
            redirectPath: '/403',
          }
        }
      }

      // Custom check
      if (customCheck) {
        const customResult = await customCheck(userId)
        if (!customResult) {
          return {
            allowed: false,
            reason: 'Custom check failed',
            redirectPath: '/403',
          }
        }
      }

      return { allowed: true }
    } catch (error) {
      logger.error('RBAC middleware error:', error)
      return {
        allowed: false,
        reason: 'Internal error during permission check',
        redirectPath: '/500',
      }
    }
  }

  /**
   * Higher-order function to create route guards
   */
  createRouteGuard(options: RBACMiddlewareOptions) {
    return async () => {
      const result = await this.checkRouteAccess(options)

      if (!result.allowed && result.redirectPath) {
        throw redirect({
          to: result.redirectPath,
          search: {
            reason: result.reason,
            returnTo: String(window.location.pathname || '/'),
          },
        })
      }

      return result
    }
  }

  /**
   * Utility function for API route protection
   */
  async protectAPIRoute(
    request: Request,
    options: RBACMiddlewareOptions = {}
  ): Promise<Response | null> {
    try {
      // Extract session from Authorization header
      const authHeader = request.headers.get('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Missing or invalid authorization header' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const token = authHeader.split(' ')[1]

      // Verify session with Supabase
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token)

      if (error || !user) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Enhanced context for API requests
      const context: PermissionCheckContext = {
        ...options.context,
        ip_address:
          request.headers.get('X-Forwarded-For') ||
          request.headers.get('X-Real-IP') ||
          'unknown',
        user_agent: request.headers.get('User-Agent') || 'API Client',
        request_path: new URL(request.url).pathname,
        session_id: token,
      }

      // Check permissions
      const result = await this.checkRouteAccess({
        ...options,
        context,
      })

      if (!result.allowed) {
        return new Response(
          JSON.stringify({
            error: 'Access denied',
            reason: result.reason,
            missing_permissions: result.missingPermissions,
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return null // Allow the request to continue
    } catch (error) {
      logger.error('API route protection error:', error)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  /**
   * Utility for checking permissions in components
   */
  async checkComponentAccess(
    userId: string,
    permissions: Array<{ resource: string; action: string }>,
    context?: PermissionCheckContext
  ): Promise<{
    hasAccess: boolean
    grantedPermissions: string[]
    deniedPermissions: string[]
  }> {
    if (!userId) {
      return {
        hasAccess: false,
        grantedPermissions: [],
        deniedPermissions: permissions.map((p) => `${p.resource}:${p.action}`),
      }
    }

    try {
      const results = await Promise.all(
        permissions.map(async (perm) => {
          const result = await rbacService.checkPermission(
            userId,
            perm.resource,
            perm.action,
            context
          )
          return {
            permission: `${perm.resource}:${perm.action}`,
            granted: result.granted,
          }
        })
      )

      const granted = results.filter((r) => r.granted).map((r) => r.permission)
      const denied = results.filter((r) => !r.granted).map((r) => r.permission)

      return {
        hasAccess: granted.length > 0,
        grantedPermissions: granted,
        deniedPermissions: denied,
      }
    } catch (error) {
      logger.error('Error checking component access:', error)
      return {
        hasAccess: false,
        grantedPermissions: [],
        deniedPermissions: permissions.map((p) => `${p.resource}:${p.action}`),
      }
    }
  }

  /**
   * Batch permission check for multiple users
   */
  async batchCheckPermissions(
    userIds: string[],
    permission: { resource: string; action: string },
    context?: PermissionCheckContext
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>()

    try {
      const checks = await Promise.allSettled(
        userIds.map(async (userId) => {
          const result = await rbacService.checkPermission(
            userId,
            permission.resource,
            permission.action,
            context
          )
          return { userId, granted: result.granted }
        })
      )

      checks.forEach((check, index) => {
        if (check.status === 'fulfilled') {
          results.set(check.value.userId, check.value.granted)
        } else {
          results.set(userIds[index], false)
        }
      })
    } catch (error) {
      logger.error('Error in batch permission check:', error)
      userIds.forEach((userId) => results.set(userId, false))
    }

    return results
  }

  /**
   * Clear middleware caches
   */
  clearCache() {
    this.sessionCache.clear()
    rbacService.clearAllCache()
  }
}

// Export singleton instance
export const rbacMiddleware = RBACMiddleware.getInstance()

// Utility functions for route definitions
export const requirePermissions = (
  permissions: Array<{ resource: string; action: string }>
) => rbacMiddleware.createRouteGuard({ requiredPermissions: permissions })

export const requireRoleFeatures = (features: string[]) =>
  rbacMiddleware.createRouteGuard({ roleFeatures: features })

export const requireAnyPermission = (
  permissions: Array<{ resource: string; action: string }>
) =>
  rbacMiddleware.createRouteGuard({
    requiredPermissions: permissions,
    requireAll: false,
  })

export const requireAdminAccess = () =>
  rbacMiddleware.createRouteGuard({
    requiredPermissions: [{ resource: 'admin', action: 'access' }],
    roleFeatures: ['user_management'],
  })

export const requireSuperAdminAccess = () =>
  rbacMiddleware.createRouteGuard({
    requiredPermissions: [{ resource: 'system', action: '*' }],
    roleFeatures: ['system_access'],
  })

// Hook for using middleware in components
export function useRBACMiddleware() {
  return {
    checkAccess: rbacMiddleware.checkComponentAccess.bind(rbacMiddleware),
    batchCheck: rbacMiddleware.batchCheckPermissions.bind(rbacMiddleware),
    clearCache: rbacMiddleware.clearCache.bind(rbacMiddleware),
  }
}
