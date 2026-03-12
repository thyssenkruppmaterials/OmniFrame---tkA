/**
 * Route Guard Component
 * Permission-based route protection with automatic redirects
 */
import React from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import type { PermissionCheckContext } from '@/lib/auth/types'
import { useUnifiedAuth } from '@/hooks/use-unified-auth'
import { PermissionGuard } from './PermissionGuard'

interface RouteGuardProps {
  resource: string
  action: string
  context?: PermissionCheckContext
  redirectTo?: string
  showAccessDenied?: boolean
  requireAll?: boolean
  permissions?: string[]
  children: React.ReactNode
}

export function RouteGuard({
  resource,
  action,
  context,
  redirectTo = '/403',
  showAccessDenied = true,
  requireAll = true,
  permissions = [],
  children,
}: RouteGuardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, isLoading } = useUnifiedAuth()

  // Redirect unauthenticated users — called unconditionally (Rules of Hooks).
  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate({
        to: '/sign-in',
        search: { redirect: String(location.pathname || '/') },
      })
    }
  }, [isLoading, isAuthenticated, navigate, location.pathname])

  // Handle loading state
  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <div className='border-primary mx-auto h-8 w-8 animate-spin rounded-full border-b-2'></div>
          <p className='text-muted-foreground mt-2 text-sm'>Loading...</p>
        </div>
      </div>
    )
  }

  // While redirecting, render nothing
  if (!isAuthenticated) {
    return null
  }

  // Handle permission-based access
  return (
    <PermissionGuard
      resource={resource}
      action={action}
      context={context}
      permissions={permissions}
      requireAll={requireAll}
      fallback={
        showAccessDenied ? (
          <AccessDenied
            resource={resource}
            action={action}
            onRetry={() => navigate({ to: redirectTo })}
          />
        ) : null
      }
    >
      {children}
    </PermissionGuard>
  )
}

// Access denied component
function AccessDenied({
  resource,
  action,
  onRetry,
}: {
  resource: string
  action: string
  onRetry: () => void
}) {
  const navigate = useNavigate()

  return (
    <div className='bg-background flex min-h-screen items-center justify-center'>
      <div className='mx-4 w-full max-w-md'>
        <div className='text-center'>
          <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20'>
            <svg
              className='h-6 w-6 text-red-600 dark:text-red-400'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
              />
            </svg>
          </div>

          <h1 className='text-foreground mb-2 text-2xl font-bold'>
            Access Denied
          </h1>

          <p className='text-muted-foreground mb-6'>
            You don't have permission to access this resource.
          </p>

          <div className='bg-muted mb-6 rounded-lg p-4 text-left'>
            <div className='text-sm'>
              <strong>Resource:</strong> {resource}
            </div>
            <div className='text-sm'>
              <strong>Action:</strong> {action}
            </div>
          </div>

          <div className='flex justify-center gap-3'>
            <button
              onClick={() => navigate({ to: '/' })}
              className='bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 transition-colors'
            >
              Go Home
            </button>

            <button
              onClick={onRetry}
              className='bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-md px-4 py-2 transition-colors'
            >
              Try Again
            </button>
          </div>

          <p className='text-muted-foreground mt-4 text-xs'>
            If you believe this is an error, please contact your administrator.
          </p>
        </div>
      </div>
    </div>
  )
}

// Specialized route guards for common patterns
export function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  return (
    <RouteGuard resource='admin' action='access'>
      {children}
    </RouteGuard>
  )
}

export function WriteRouteGuard({
  resource,
  children,
}: {
  resource: string
  children: React.ReactNode
}) {
  return (
    <RouteGuard resource={resource} action='write'>
      {children}
    </RouteGuard>
  )
}

export function ReadRouteGuard({
  resource,
  children,
}: {
  resource: string
  children: React.ReactNode
}) {
  return (
    <RouteGuard resource={resource} action='read'>
      {children}
    </RouteGuard>
  )
}

// Batch permission route guard
export function BatchRouteGuard({
  permissions,
  requireAll = true,
  children,
  redirectTo = '/403',
}: {
  permissions: Array<{ resource: string; action: string }>
  requireAll?: boolean
  children: React.ReactNode
  redirectTo?: string
}) {
  const permissionStrings = permissions.map((p) => `${p.resource}:${p.action}`)

  return (
    <RouteGuard
      resource='' // Not used in batch mode
      action='' // Not used in batch mode
      permissions={permissionStrings}
      requireAll={requireAll}
      redirectTo={redirectTo}
    >
      {children}
    </RouteGuard>
  )
}

// Hook for programmatic route protection
export function useRouteGuard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission, isAuthenticated } = useUnifiedAuth()

  const checkRouteAccess = React.useCallback(
    async (resource: string, action: string, redirectTo = '/403') => {
      if (!isAuthenticated) {
        navigate({
          to: '/sign-in',
          search: { redirect: String(location.pathname || '/') },
        })
        return false
      }

      const hasAccess = await hasPermission(resource, action)

      if (!hasAccess) {
        navigate({ to: redirectTo })
        return false
      }

      return true
    },
    [navigate, location.pathname, isAuthenticated, hasPermission]
  )

  return { checkRouteAccess }
}

// Export all components
export default RouteGuard
