// Created and developed by Jai Singh
/**
 * Optimized Permission Guard Component
 * High-performance permission-based rendering with memoization and caching
 *
 * FIXED (Feb 2026): Switched from unmounted auth-provider's usePermissions
 * to the active Zustand permissionStore, fixing "usePermissions must be used
 * within UnifiedAuthProvider" crash.
 */
import React, { useState, useEffect, useMemo, memo } from 'react'
import { ShieldOff, Loader2 } from 'lucide-react'
import { usePermissionStore } from '@/stores/permissionStore'
import type { PermissionCheckContext } from '@/lib/auth/types'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface PermissionGuardProps {
  resource: string
  action: string
  context?: PermissionCheckContext
  fallback?: React.ReactNode
  showError?: boolean
  requireAll?: boolean
  permissions?: string[]
  children: React.ReactNode
  loadingComponent?: React.ReactNode
  errorComponent?: React.ReactNode
}

interface PermissionGuardState {
  hasAccess: boolean | null
  isChecking: boolean
  error: string | null
  checkTime: number
}

// Memoized permission check hook
function usePermissionCheck(
  resource: string,
  action: string,
  context?: PermissionCheckContext
) {
  // Use the Zustand permission store (the active permission system)
  // Note: store.hasPermission takes (action, resource) - reversed from old API
  const storeHasPermission = usePermissionStore((state) => state.hasPermission)
  const isStoreLoading = usePermissionStore((state) => state.isLoading)
  const permissions = usePermissionStore((state) => state.permissions)

  const [state, setState] = useState<PermissionGuardState>({
    hasAccess: null,
    isChecking: true,
    error: null,
    checkTime: 0,
  })

  // Memoize the permission check to prevent unnecessary re-checks
  const permissionKey = useMemo(
    () => `${resource}:${action}:${JSON.stringify(context || {})}`,
    [resource, action, context]
  )

  useEffect(() => {
    let isMounted = true

    const checkPermission = async () => {
      const startTime = Date.now()

      // Wait for store to finish loading before checking
      if (isStoreLoading) {
        if (isMounted) {
          setState((prev) => ({ ...prev, isChecking: true, error: null }))
        }
        return
      }

      try {
        setState((prev) => ({ ...prev, isChecking: true, error: null }))

        // Store uses (action, resource) argument order
        const result = storeHasPermission(action, resource)
        const checkTime = Date.now() - startTime

        if (isMounted) {
          setState({
            hasAccess: result,
            isChecking: false,
            error: null,
            checkTime,
          })
        }
      } catch (error) {
        if (isMounted) {
          setState({
            hasAccess: false,
            isChecking: false,
            error:
              error instanceof Error
                ? error.message
                : 'Permission check failed',
            checkTime: Date.now() - startTime,
          })
        }
      }
    }

    checkPermission()

    return () => {
      isMounted = false
    }
  }, [
    permissionKey,
    storeHasPermission,
    isStoreLoading,
    permissions,
    resource,
    action,
    context,
  ])

  return state
}

// Main permission guard component
export const PermissionGuard = memo<PermissionGuardProps>(
  ({
    resource,
    action,
    context,
    fallback,
    showError = false,
    requireAll = true,
    permissions = [],
    children,
    loadingComponent,
    errorComponent,
  }) => {
    // Use the Zustand permission store (action, resource) argument order
    const storeHasPermission = usePermissionStore(
      (state) => state.hasPermission
    )
    const isStoreLoading = usePermissionStore((state) => state.isLoading)
    const storePermissions = usePermissionStore((state) => state.permissions)

    const [batchCheckState, setBatchCheckState] =
      useState<PermissionGuardState>({
        hasAccess: null,
        isChecking: true,
        error: null,
        checkTime: 0,
      })

    // Single permission check
    const singleCheck = usePermissionCheck(resource, action, context)

    // Batch permission check for multiple permissions
    useEffect(() => {
      if (permissions.length === 0) return
      if (isStoreLoading) return

      let isMounted = true

      const checkBatchPermissions = async () => {
        const startTime = Date.now()

        try {
          setBatchCheckState((prev) => ({
            ...prev,
            isChecking: true,
            error: null,
          }))

          // Store uses (action, resource) argument order
          const results = permissions.map((perm) => {
            const [res, act] = perm.split(':')
            return storeHasPermission(act, res)
          })

          const hasAccess = requireAll
            ? results.every(Boolean)
            : results.some(Boolean)
          const checkTime = Date.now() - startTime

          if (isMounted) {
            setBatchCheckState({
              hasAccess,
              isChecking: false,
              error: null,
              checkTime,
            })
          }
        } catch (error) {
          if (isMounted) {
            setBatchCheckState({
              hasAccess: false,
              isChecking: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Batch permission check failed',
              checkTime: Date.now() - startTime,
            })
          }
        }
      }

      checkBatchPermissions()

      return () => {
        isMounted = false
      }
    }, [
      permissions,
      requireAll,
      storeHasPermission,
      isStoreLoading,
      storePermissions,
      context,
    ])

    // Determine which check to use
    const activeCheck = permissions.length > 0 ? batchCheckState : singleCheck

    // Render logic
    if (activeCheck.isChecking) {
      return loadingComponent ? (
        <>{loadingComponent}</>
      ) : (
        <div className='flex items-center justify-center p-4'>
          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          <span className='text-muted-foreground text-sm'>
            Checking permissions...
          </span>
        </div>
      )
    }

    if (activeCheck.error && showError) {
      return errorComponent ? (
        <>{errorComponent}</>
      ) : (
        <Alert variant='destructive'>
          <ShieldOff className='h-4 w-4' />
          <AlertDescription>
            Permission check failed: {activeCheck.error}
          </AlertDescription>
        </Alert>
      )
    }

    if (!activeCheck.hasAccess) {
      return fallback ? (
        <>{fallback}</>
      ) : showError ? (
        <Alert>
          <ShieldOff className='h-4 w-4' />
          <AlertDescription>
            You don't have permission to access this resource.
          </AlertDescription>
        </Alert>
      ) : null
    }

    return <>{children}</>
  }
)

PermissionGuard.displayName = 'PermissionGuard'

// Specialized permission guards for common use cases
export const ReadPermissionGuard = memo<{
  resource: string
  children: React.ReactNode
  fallback?: React.ReactNode
}>(({ resource, children, fallback }) => (
  <PermissionGuard resource={resource} action='read' fallback={fallback}>
    {children}
  </PermissionGuard>
))

ReadPermissionGuard.displayName = 'ReadPermissionGuard'

export const WritePermissionGuard = memo<{
  resource: string
  children: React.ReactNode
  fallback?: React.ReactNode
}>(({ resource, children, fallback }) => (
  <PermissionGuard resource={resource} action='write' fallback={fallback}>
    {children}
  </PermissionGuard>
))

WritePermissionGuard.displayName = 'WritePermissionGuard'

export const AdminPermissionGuard = memo<{
  children: React.ReactNode
  fallback?: React.ReactNode
}>(({ children, fallback }) => (
  <PermissionGuard resource='admin' action='access' fallback={fallback}>
    {children}
  </PermissionGuard>
))

AdminPermissionGuard.displayName = 'AdminPermissionGuard'

// Batch permission guard for complex scenarios
export const BatchPermissionGuard = memo<{
  permissions: Array<{
    resource: string
    action: string
    context?: PermissionCheckContext
  }>
  requireAll?: boolean
  children: React.ReactNode
  fallback?: React.ReactNode
  showError?: boolean
}>(({ permissions, requireAll = true, children, fallback, showError }) => {
  const permissionStrings = useMemo(
    () => permissions.map((p) => `${p.resource}:${p.action}`),
    [permissions]
  )

  return (
    <PermissionGuard
      resource='' // Not used in batch mode
      action='' // Not used in batch mode
      permissions={permissionStrings}
      requireAll={requireAll}
      fallback={fallback}
      showError={showError}
    >
      {children}
    </PermissionGuard>
  )
})

BatchPermissionGuard.displayName = 'BatchPermissionGuard'

// Conditional rendering hook for programmatic use
export function usePermissionGuard(
  resource: string,
  action: string,
  context?: PermissionCheckContext
) {
  const check = usePermissionCheck(resource, action, context)

  return {
    hasAccess: check.hasAccess,
    isChecking: check.isChecking,
    error: check.error,
    checkTime: check.checkTime,
    render: (children: React.ReactNode, fallback?: React.ReactNode) => {
      if (check.isChecking) {
        return (
          <div className='flex items-center justify-center p-4'>
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            <span className='text-muted-foreground text-sm'>
              Checking permissions...
            </span>
          </div>
        )
      }

      if (check.error) {
        return fallback || null
      }

      return check.hasAccess ? children : fallback || null
    },
  }
}

// Performance monitoring hook
export function usePermissionStats() {
  const isLoading = usePermissionStore((state) => state.isLoading)
  const permissions = usePermissionStore((state) => state.permissions)

  return useMemo(
    () => ({
      cacheStats: {
        hits: 0,
        misses: 0,
        evictions: 0,
        totalRequests: 0,
        averageAccessTime: 0,
        memoryUsage: 0,
        entriesCount: permissions.length,
        hitRate: 0,
      },
      isLoading,
      performance: {
        hitRate: 0,
        averageCheckTime: 0,
        totalRequests: 0,
        cacheEfficiency: 0,
      },
    }),
    [isLoading, permissions.length]
  )
}

// Export all components
export default PermissionGuard

// Created and developed by Jai Singh
