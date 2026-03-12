import { createFileRoute, redirect } from '@tanstack/react-router'
import { authService } from '@/lib/auth/auth-service'
import { logger } from '@/lib/utils/logger'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    try {
      logger.log(
        'Checking authentication for protected route:',
        location.pathname
      )

      // Use the new unified auth service for session validation
      const isValid = await authService.validateSession()

      if (!isValid) {
        logger.log('Session validation failed, redirecting to sign-in')

        const fullPath =
          (location.pathname || '/') +
          (location.searchStr || '') +
          (location.hash || '')
        throw redirect({
          to: '/sign-in',
          search: {
            redirect: fullPath,
          },
        })
      }

      // Get current auth state for additional validation
      const authState = await authService.getAuthState()

      if (!authState.isAuthenticated || !authState.user) {
        logger.log('User not authenticated, redirecting to sign-in')

        const fullPath =
          (location.pathname || '/') +
          (location.searchStr || '') +
          (location.hash || '')
        throw redirect({
          to: '/sign-in',
          search: {
            redirect: fullPath,
          },
        })
      }

      // Check if user profile is loaded (not critical but good to have)
      if (!authState.profile) {
        try {
          logger.log('Profile not loaded, attempting to fetch...')
          const profile = await authService.getUserProfile(authState.user.id)
          if (!profile) {
            logger.warn(
              'Could not load user profile, but continuing with authentication'
            )
          }
        } catch (profileError) {
          logger.warn('Profile fetch failed during route guard:', profileError)
          // Continue anyway - profile is not critical for route protection
        }
      }

      logger.log(
        'Authentication check passed for:',
        authState.user.email || authState.user.id
      )

      // Return user info that can be used by child routes
      return {
        user: authState.user,
        profile: authState.profile,
        permissions: authState.permissions,
        roles: authState.roles,
      }
    } catch (error) {
      // If it's already a redirect, re-throw it
      if (error && typeof error === 'object' && 'href' in error) {
        throw error
      }

      logger.error('Unexpected error during authentication check:', error)
      const fullPath =
        (location.pathname || '/') +
        (location.searchStr || '') +
        (location.hash || '')
      throw redirect({
        to: '/sign-in',
        search: {
          redirect: fullPath,
        },
      })
    }
  },
  component: AuthenticatedLayout,
})
// Developer and Creator: Jai Singh
