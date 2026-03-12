import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { SessionManagementService } from '../services/session-management.service'

export function useSessionManagement() {
  const queryClient = useQueryClient()

  // Real-time subscriptions for live updates
  useEffect(() => {
    const setupRealTimeSubscriptions = () => {
      // Subscribe to session changes
      const sessionChannel = supabase
        .channel('session-management-sessions')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_sessions',
          },
          () => {
            // Invalidate and refetch session data when changes occur
            queryClient.invalidateQueries({
              queryKey: ['session-management', 'active-sessions'],
            })
            queryClient.invalidateQueries({
              queryKey: ['session-management', 'stats'],
            })
          }
        )
        .subscribe()

      // Subscribe to enhanced session changes
      const enhancedSessionChannel = supabase
        .channel('session-management-enhanced-sessions')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'enhanced_user_sessions',
          },
          () => {
            queryClient.invalidateQueries({ queryKey: ['session-management'] })
          }
        )
        .subscribe()

      // Subscribe to security alerts
      const securityAlertsChannel = supabase
        .channel('session-management-security-alerts')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'security_alerts',
          },
          () => {
            queryClient.invalidateQueries({
              queryKey: ['session-management', 'security-alerts'],
            })
            queryClient.invalidateQueries({
              queryKey: ['session-management', 'stats'],
            })
          }
        )
        .subscribe()

      // Subscribe to session activities
      const activitiesChannel = supabase
        .channel('session-management-activities')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'session_activities',
          },
          () => {
            queryClient.invalidateQueries({
              queryKey: ['session-management', 'history'],
            })
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(sessionChannel)
        supabase.removeChannel(enhancedSessionChannel)
        supabase.removeChannel(securityAlertsChannel)
        supabase.removeChannel(activitiesChannel)
      }
    }

    return setupRealTimeSubscriptions()
  }, [queryClient])

  // Active sessions query
  const {
    data: activeSessions = [],
    isLoading: isLoadingSessions,
    error: sessionsError,
  } = useQuery({
    queryKey: ['session-management', 'active-sessions'],
    queryFn: () => SessionManagementService.getActiveSessions(),
    refetchInterval: 30000, // Refresh every 30 seconds (backup for real-time)
  })

  // Session stats query - Fixed context issue by wrapping in arrow function
  const {
    data: sessionStats,
    isLoading: isLoadingStats,
    error: statsError,
  } = useQuery({
    queryKey: ['session-management', 'stats'],
    queryFn: () => SessionManagementService.getSessionStats(),
    refetchInterval: 60000, // Refresh every minute
  })

  // Terminate session mutation
  const terminateSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      SessionManagementService.terminateSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-management'] })
    },
  })

  // Terminate user sessions mutation
  const terminateUserSessionsMutation = useMutation({
    mutationFn: (userId: string) =>
      SessionManagementService.terminateUserSessions(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-management'] })
    },
  })

  // Terminate all sessions mutation
  const terminateAllSessionsMutation = useMutation({
    mutationFn: () => SessionManagementService.terminateAllSessions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-management'] })
    },
  })

  // Security alerts query
  const {
    data: securityAlerts = [],
    isLoading: isLoadingAlerts,
    error: alertsError,
  } = useQuery({
    queryKey: ['session-management', 'security-alerts'],
    queryFn: () => SessionManagementService.getSecurityAlerts(),
    refetchInterval: 60000, // Refresh every minute (backup for real-time)
  })

  // Session history query
  const {
    data: sessionHistory = [],
    isLoading: isLoadingHistory,
    error: historyError,
  } = useQuery({
    queryKey: ['session-management', 'history'],
    queryFn: () => SessionManagementService.getSessionHistory(),
    refetchInterval: 120000, // Refresh every 2 minutes
  })

  // Timeout configurations query
  const {
    data: timeoutConfigs = [],
    isLoading: isLoadingConfigs,
    error: configsError,
  } = useQuery({
    queryKey: ['session-management', 'timeout-configs'],
    queryFn: () => SessionManagementService.getTimeoutConfigs(),
    refetchInterval: 300000, // Refresh every 5 minutes
  })

  const isLoading =
    isLoadingSessions ||
    isLoadingStats ||
    isLoadingAlerts ||
    isLoadingHistory ||
    isLoadingConfigs
  const error =
    sessionsError || statsError || alertsError || historyError || configsError

  return {
    // Data
    activeSessions,
    sessionStats,
    securityAlerts,
    sessionHistory,
    timeoutConfigs,

    // Loading states
    isLoading,
    isLoadingSessions,
    isLoadingStats,
    isLoadingAlerts,
    isLoadingHistory,
    isLoadingConfigs,
    error,

    // Actions
    terminateSession: terminateSessionMutation.mutate,
    terminateUserSessions: terminateUserSessionsMutation.mutate,
    terminateAllSessions: terminateAllSessionsMutation.mutate,

    // Mutation states
    isTerminating: terminateSessionMutation.isPending,
    isTerminatingUser: terminateUserSessionsMutation.isPending,
    isTerminatingAll: terminateAllSessionsMutation.isPending,

    // Refresh function
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: ['session-management'] })
    },
  }
}
