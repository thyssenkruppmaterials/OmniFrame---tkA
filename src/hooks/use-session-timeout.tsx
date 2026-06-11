// Created and developed by Jai Singh
import { useEffect, useRef, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { redirectToSignIn } from '@/lib/auth/redirect-utils'
import { sessionActivityLogger } from '@/lib/auth/session-activity-logger'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { SessionManagementService } from '@/features/session-management/services/session-management.service'

interface UseSessionTimeoutOptions {
  enableWarnings?: boolean
  onWarning?: (timeRemaining: number) => void
  onTimeout?: () => void
  onLogout?: () => void
}

interface SessionTimeoutConfig {
  sessionTimeoutMinutes: number
  autoLogoutTimeoutMinutes: number
  warningTimeMinutes: number
  rememberMeDurationHours: number
  enableFullscreenExpiryWarning: boolean
}

/**
 * Hook to handle automatic session timeout and warnings
 * Implements role-based timeout configurations
 */
export function useSessionTimeout(options: UseSessionTimeoutOptions = {}) {
  const { enableWarnings = true, onWarning, onTimeout, onLogout } = options

  // State
  const [config, setConfig] = useState<SessionTimeoutConfig | null>(null)
  const [isActive, setIsActive] = useState(true)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [showWarning, setShowWarning] = useState(false)

  // Refs for timers
  const sessionTimer = useRef<NodeJS.Timeout | null>(null)
  const inactivityTimer = useRef<NodeJS.Timeout | null>(null)
  const warningTimer = useRef<NodeJS.Timeout | null>(null)
  const lastActivity = useRef<number>(Date.now())
  const warningShown = useRef<boolean>(false)

  // Load user timeout configuration
  const loadTimeoutConfig = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      // Get user's timeout configs
      const configs = await SessionManagementService.getTimeoutConfigs()

      // Get user profile to determine role via role_id -> roles table
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role_id, roles(name)')
        .eq('id', user.id)
        .single()

      const userRole =
        (profile?.roles as { name: string } | null)?.name || 'viewer'

      // Find role-specific config or use default
      const roleConfig = configs.find(
        (c) => c.role === userRole && !c.is_global
      )
      const globalConfig = configs.find((c) => c.is_global)
      const activeConfig = roleConfig || globalConfig

      if (activeConfig) {
        setConfig({
          sessionTimeoutMinutes: activeConfig.session_timeout_minutes,
          autoLogoutTimeoutMinutes: activeConfig.auto_logout_timeout_minutes,
          warningTimeMinutes: activeConfig.warning_time_minutes,
          rememberMeDurationHours:
            activeConfig.remember_me_duration_hours ?? 24,
          enableFullscreenExpiryWarning:
            activeConfig.enable_fullscreen_expiry_warning ?? true,
        })
      } else {
        // Default fallback
        setConfig({
          sessionTimeoutMinutes: 240, // 4 hours
          autoLogoutTimeoutMinutes: 15, // 15 minutes
          warningTimeMinutes: 5, // 5 minutes
          rememberMeDurationHours: 24, // 1 day
          enableFullscreenExpiryWarning: true,
        })
      }
    } catch (error) {
      logger.error('Error loading timeout config:', error)
      // Use default config on error
      setConfig({
        sessionTimeoutMinutes: 240,
        autoLogoutTimeoutMinutes: 15,
        warningTimeMinutes: 5,
        rememberMeDurationHours: 24,
        enableFullscreenExpiryWarning: true,
      })
    }
  }, [])

  // Handle user activity
  const handleActivity = useCallback(() => {
    lastActivity.current = Date.now()
    setIsActive(true)
    setShowWarning(false)
    warningShown.current = false

    // Reset inactivity timer
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current)
    }

    if (config) {
      // Start new inactivity timer
      inactivityTimer.current = setTimeout(
        () => {
          setIsActive(false)

          // Show warning before timeout
          if (enableWarnings && !warningShown.current) {
            const warningTimeMs = config.warningTimeMinutes * 60 * 1000

            warningTimer.current = setTimeout(
              () => {
                warningShown.current = true
                setShowWarning(true)
                setTimeRemaining(config.warningTimeMinutes * 60)

                // Log session warning event (fire-and-forget)
                supabase.auth.getUser().then(({ data: { user } }) => {
                  if (user) {
                    sessionActivityLogger.logWarning(
                      user.id,
                      config.warningTimeMinutes * 60
                    )
                  }
                })

                if (onWarning) {
                  onWarning(config.warningTimeMinutes * 60)
                }

                // The fullscreen SessionExpiryModal is driven by showWarning + timeRemaining
                // state exposed from this hook — no toast needed here.

                // Auto logout after warning period
                setTimeout(() => {
                  handleTimeout()
                }, warningTimeMs)
              },
              (config.autoLogoutTimeoutMinutes - config.warningTimeMinutes) *
                60 *
                1000
            )
          } else {
            // Direct timeout without warning
            setTimeout(
              () => {
                handleTimeout()
              },
              config.warningTimeMinutes * 60 * 1000
            )
          }
        },
        config.autoLogoutTimeoutMinutes * 60 * 1000
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleTimeout is defined below; including it creates a circular dependency
  }, [config, enableWarnings, onWarning])

  // Handle session timeout
  const handleTimeout = useCallback(async () => {
    try {
      logger.log('Session timeout - logging out user')

      // Log timeout event before sign-out (fire-and-forget)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        sessionActivityLogger.logTimeout(user.id)
      }

      setShowWarning(false)
      setIsActive(false)

      if (onTimeout) {
        onTimeout()
      }

      // Sign out user
      await supabase.auth.signOut()

      if (onLogout) {
        onLogout()
      }

      toast.error('Session expired due to inactivity', {
        duration: 5000,
      })

      // Redirect to sign-in page, preserving the current URL for redirect-back
      redirectToSignIn()
    } catch (error) {
      logger.error('Error during timeout logout:', error)
    }
  }, [onTimeout, onLogout])

  // Start session timeout timer
  const startSessionTimer = useCallback(() => {
    if (!config) return

    if (sessionTimer.current) {
      clearTimeout(sessionTimer.current)
    }

    // Set absolute session timeout
    sessionTimer.current = setTimeout(
      () => {
        logger.log('Absolute session timeout reached')
        handleTimeout()
      },
      config.sessionTimeoutMinutes * 60 * 1000
    )
  }, [config, handleTimeout])

  // Update time remaining for warnings
  useEffect(() => {
    if (!showWarning || !config) return

    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.floor(
          (lastActivity.current +
            config.autoLogoutTimeoutMinutes * 60 * 1000 -
            Date.now()) /
            1000
        )
      )
      setTimeRemaining(remaining)

      if (remaining <= 0) {
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [showWarning, config])

  // Initialize timeout system
  useEffect(() => {
    loadTimeoutConfig()
  }, [loadTimeoutConfig])

  // Start timers when config is loaded
  useEffect(() => {
    if (config) {
      startSessionTimer()
      handleActivity() // Initialize activity tracking
    }

    return () => {
      if (sessionTimer.current) clearTimeout(sessionTimer.current)
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      if (warningTimer.current) clearTimeout(warningTimer.current)
    }
  }, [config, startSessionTimer, handleActivity])

  // Set up activity listeners
  useEffect(() => {
    const activityEvents = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
    ]

    const throttledActivity = (() => {
      let throttleTimer: NodeJS.Timeout | null = null
      return () => {
        if (throttleTimer) return
        throttleTimer = setTimeout(() => {
          handleActivity()
          throttleTimer = null
        }, 1000) // Throttle to once per second
      }
    })()

    // Add event listeners
    activityEvents.forEach((event) => {
      document.addEventListener(event, throttledActivity, { passive: true })
    })

    // Handle visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleActivity()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Cleanup
    return () => {
      activityEvents.forEach((event) => {
        document.removeEventListener(event, throttledActivity)
      })
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [handleActivity])

  // Extend session (manual)
  const extendSession = useCallback(() => {
    handleActivity()
    toast.success('Session extended', { duration: 2000 })
  }, [handleActivity])

  // Refresh configuration
  const refreshConfig = useCallback(() => {
    loadTimeoutConfig()
  }, [loadTimeoutConfig])

  // Explicit logout action (used by the session expiry modal)
  const handleLogout = useCallback(async () => {
    try {
      await singletonAuthManager.signOut()
      toast.error('Session expired due to inactivity', { duration: 5000 })
      redirectToSignIn()
    } catch (error) {
      logger.error('Error during manual logout:', error)
      // Fallback: force redirect even if signOut fails
      redirectToSignIn()
    }
  }, [])

  return {
    // State
    isActive,
    config,
    timeRemaining,
    showWarning,

    // Actions
    extendSession,
    handleLogout,
    refreshConfig,

    // Manual activity trigger
    triggerActivity: handleActivity,

    // Config values for display
    sessionTimeoutMinutes: config?.sessionTimeoutMinutes,
    autoLogoutTimeoutMinutes: config?.autoLogoutTimeoutMinutes,
    warningTimeMinutes: config?.warningTimeMinutes,
    rememberMeDurationHours: config?.rememberMeDurationHours,
    enableFullscreenExpiryWarning: config?.enableFullscreenExpiryWarning,
  }
}

// Created and developed by Jai Singh
