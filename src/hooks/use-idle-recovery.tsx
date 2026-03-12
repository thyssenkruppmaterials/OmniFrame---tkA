import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
// import { useSupabaseAuth } from '@/stores/supabaseAuthStore'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

interface UseIdleRecoveryOptions {
  idleThreshold?: number // ms before considering user idle
  recoveryDelay?: number // ms to wait before starting recovery
  enableRecovery?: boolean
}

/**
 * Hook to handle graceful recovery when user returns from idle state
 * Prevents performance issues when switching tabs or applications
 */
export function useIdleRecovery(options: UseIdleRecoveryOptions = {}) {
  const {
    idleThreshold = 5 * 60 * 1000, // 5 minutes default
    recoveryDelay = 2000, // 2 seconds default
    enableRecovery = true,
  } = options

  useQueryClient() // Keep hook call to satisfy rules-of-hooks; recovery may need client in future
  // Profile available if needed for user-specific recovery settings
  // const { profile } = useSupabaseAuth()

  // State tracking refs
  const lastActivity = useRef<number>(Date.now())
  const isIdle = useRef<boolean>(false)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const activityThrottle = useRef<NodeJS.Timeout | null>(null)
  const isRecovering = useRef<boolean>(false)

  // Throttled activity tracking
  const updateActivity = useCallback(() => {
    if (activityThrottle.current) return

    activityThrottle.current = setTimeout(() => {
      lastActivity.current = Date.now()
      if (isIdle.current) {
        logger.log('User activity detected - exiting idle state')
        isIdle.current = false
      }
      activityThrottle.current = null
    }, 1000) // 1 second throttle for activity updates
  }, [])

  // Recovery process when user returns from idle
  const performRecovery = useCallback(async () => {
    if (isRecovering.current || !enableRecovery) return

    isRecovering.current = true
    logger.log('Starting idle recovery process')

    try {
      // Step 1: Validate session with timeout
      const sessionValidation = Promise.race([
        supabase.auth.getSession(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Session validation timeout')),
            5000
          )
        ),
      ])

      const {
        data: { session },
        error,
      } = (await sessionValidation) as Awaited<
        ReturnType<typeof supabase.auth.getSession>
      >

      if (error || !session) {
        logger.warn(
          'Session invalid after idle - user needs to re-authenticate'
        )
        // Don't automatically redirect - let the auth guard handle it
        return
      }

      // Step 2: Let permission providers handle their own reloading
      logger.log('Session validation successful after idle recovery')

      // Note: Permission reloading is now handled by PermissionProvider
      // which detects cleared permissions and reloads them automatically
      // No need to manually invalidate Zustand-based permission stores

      logger.log('Idle recovery completed successfully')
    } catch (error) {
      logger.error('Error during idle recovery:', error)
      // Don't break the app - just log the error
    } finally {
      isRecovering.current = false
    }
  }, [enableRecovery])

  // Visibility change handler
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      const timeSinceActivity = Date.now() - lastActivity.current

      if (timeSinceActivity > idleThreshold) {
        logger.log(
          'User returned after',
          Math.round(timeSinceActivity / 1000),
          'seconds - starting recovery'
        )
        isIdle.current = true

        // Clear any existing recovery timeout
        if (recoveryTimeout.current) {
          clearTimeout(recoveryTimeout.current)
        }

        // Start recovery after delay
        recoveryTimeout.current = setTimeout(performRecovery, recoveryDelay)
      } else {
        logger.log('User returned quickly - no recovery needed')
      }

      updateActivity()
    } else {
      logger.log('User went idle - marking activity time')
      lastActivity.current = Date.now()
    }
  }, [idleThreshold, recoveryDelay, performRecovery, updateActivity])

  // Set up event listeners
  useEffect(() => {
    if (!enableRecovery) return

    // Activity tracking events
    const activityEvents = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
    ]

    activityEvents.forEach((event) => {
      document.addEventListener(event, updateActivity, { passive: true })
    })

    // Visibility change tracking
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Cleanup
    return () => {
      activityEvents.forEach((event) => {
        document.removeEventListener(event, updateActivity)
      })
      document.removeEventListener('visibilitychange', handleVisibilityChange)

      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
      if (activityThrottle.current) {
        clearTimeout(activityThrottle.current)
      }
    }
  }, [enableRecovery, updateActivity, handleVisibilityChange])

  // Return idle state and recovery status for debugging
  return {
    isIdle: isIdle.current,
    isRecovering: isRecovering.current,
    lastActivity: lastActivity.current,
    timeSinceActivity: Date.now() - lastActivity.current,
  }
}
