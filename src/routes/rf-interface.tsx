// Created and developed by Jai Singh
import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { authService } from '@/lib/auth/auth-service'
import { logger } from '@/lib/utils/logger'
import { RFLayout } from '@/features/rf-interface/rf-layout'

export const Route = createFileRoute('/rf-interface')({
  beforeLoad: async () => {
    try {
      const isValid = await authService.validateSession()
      if (!isValid) {
        logger.log('[RF Route] No valid session, redirecting to RF sign-in')
        throw redirect({ to: '/rf-signin' })
      }
    } catch (error) {
      if (isRedirect(error)) {
        throw error
      }
      logger.error(
        '[RF Route] Auth check failed, redirecting to RF sign-in:',
        error
      )
      throw redirect({ to: '/rf-signin' })
    }
  },
  component: RFLayout,
})

// Created and developed by Jai Singh
