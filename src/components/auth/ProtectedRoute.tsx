// Created and developed by Jai Singh
import { useEffect, useRef } from 'react'
import { useLocation, useRouter } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { UserRole } from '@/lib/supabase/types'
import { logger } from '@/lib/utils/logger'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: UserRole[]
  requiredPermission?: { resource: string; action: string }
  redirectTo?: string
}

export function ProtectedRoute({
  children,
  requiredRole,
  redirectTo = '/sign-in',
}: ProtectedRouteProps) {
  const location = useLocation()
  const router = useRouter()
  const { authState, isLoading: authLoading } = useUnifiedAuth()
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Extract auth state properties
  const { isAuthenticated, user } = authState
  const isLoading = authLoading || authState.isLoading

  useEffect(() => {
    // Safety timeout for infinite loading states in ProtectedRoute
    // With SingletonAuthManager, loading should be much faster and more reliable
    if (isLoading) {
      loadingTimeoutRef.current = setTimeout(() => {
        logger.warn(
          'ProtectedRoute loading timeout - this should not happen with SingletonAuthManager'
        )
        // Force navigation to prevent infinite loading
        router.navigate({ to: redirectTo })
      }, 5000) // Shorter timeout since SingletonAuthManager is more reliable
    } else {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
        loadingTimeoutRef.current = null
      }
    }

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }
    }
  }, [isLoading, router, redirectTo])

  useEffect(() => {
    // If user is not authenticated and not loading, redirect to sign in
    if (!isLoading && !isAuthenticated) {
      router.navigate({
        to: redirectTo,
        search: {
          redirect: String(location.pathname || '/'),
        },
      })
    }
  }, [
    isAuthenticated,
    isLoading,
    location.pathname,
    location.search,
    redirectTo,
    router,
  ])

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <Loader2 className='h-8 w-8 animate-spin' />
      </div>
    )
  }

  // If not authenticated, don't render anything (navigation will handle redirect)
  if (!isAuthenticated || !user) {
    return null
  }

  // Role-based access control
  // Note: With SingletonAuthManager, role checking is handled at route level
  // This component now focuses on authentication, not authorization
  if (requiredRole) {
    logger.log(
      'ProtectedRoute: Role-based access control moved to route protection layer'
    )
    // Role checking is now handled by route protection in route.tsx beforeLoad
  }

  // If user needs to verify email
  if (user && !user.email_confirmed_at) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='text-center'>
          <h2 className='mb-2 text-xl font-semibold'>
            Email Verification Required
          </h2>
          <p className='text-muted-foreground'>
            Please check your email and click the verification link to continue.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

// Created and developed by Jai Singh
