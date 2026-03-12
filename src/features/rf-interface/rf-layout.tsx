import { useEffect } from 'react'
import { Outlet, useNavigate } from '@tanstack/react-router'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { rfPWAManager } from '@/lib/pwa/rf-pwa-manager'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

/**
 * Standalone RF Interface Layout
 * Provides authentication check without main application UI components
 */
export function RFLayout() {
  const { authState } = useUnifiedAuth()
  const { user, session } = authState
  const navigate = useNavigate()

  useEffect(() => {
    // Initialize PWA for RF Interface
    rfPWAManager.initializeRFPWA()

    const checkAuthentication = async () => {
      try {
        // Check if we have a valid authentication state
        if (!user || !session) {
          logger.log('No valid authentication found, redirecting to RF sign-in')
          navigate({ to: '/rf-signin' })
          return
        }

        // Additional session validation if needed
        const {
          data: { session: currentSession },
          error,
        } = await supabase.auth.getSession()

        if (error || !currentSession) {
          logger.error('Session validation failed:', error)
          navigate({ to: '/rf-signin' })
          return
        }
      } catch (error) {
        logger.error('Unexpected error during RF authentication check:', error)
        navigate({ to: '/rf-signin' })
      }
    }

    checkAuthentication()

    // Cleanup PWA when component unmounts
    return () => {
      rfPWAManager.cleanup()
    }
  }, [user, session, navigate])

  // Show loading while checking authentication
  if (!user || !session) {
    return (
      <div
        className='bg-background flex min-h-screen items-center justify-center'
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className='text-center'>
          <div className='border-primary mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2'></div>
          <p className='text-muted-foreground'>
            Authenticating RF Intelligence...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='bg-background min-h-screen'>
      <Outlet />
    </div>
  )
}
