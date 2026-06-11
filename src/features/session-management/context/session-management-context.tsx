// Created and developed by Jai Singh
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react'
import { logger } from '@/lib/utils/logger'
import { SessionManagementService } from '../services/session-management.service'
import {
  type SessionManagementContextType,
  type UserSession,
  type SessionStats,
  type SessionActivity,
  type SecurityAlert,
  type SessionTimeoutConfig,
} from '../types'

const SessionManagementContext = createContext<
  SessionManagementContextType | undefined
>(undefined)

export function SessionManagementProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // State
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([])
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)
  const [sessionHistory, setSessionHistory] = useState<SessionActivity[]>([])
  const [securityAlerts, setSecurityAlerts] = useState<SecurityAlert[]>([])
  const [timeoutConfigs, setTimeoutConfigs] = useState<SessionTimeoutConfig[]>(
    []
  )
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Initial data load
  useEffect(() => {
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    setIsLoading(true)
    try {
      const [sessions, stats, history, alerts, configs] = await Promise.all([
        SessionManagementService.getActiveSessions(),
        SessionManagementService.getSessionStats(),
        SessionManagementService.getSessionHistory(),
        SessionManagementService.getSecurityAlerts(),
        SessionManagementService.getTimeoutConfigs(),
      ])

      setActiveSessions(sessions)
      setSessionStats(stats)
      setSessionHistory(history)
      setSecurityAlerts(alerts)
      setTimeoutConfigs(configs)
    } catch (error) {
      logger.error('Error loading session management data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Session actions
  const refreshSessions = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const [sessions, stats, history, alerts] = await Promise.all([
        SessionManagementService.getActiveSessions(),
        SessionManagementService.getSessionStats(),
        SessionManagementService.getSessionHistory(),
        SessionManagementService.getSecurityAlerts(),
      ])
      setActiveSessions(sessions)
      setSessionStats(stats)
      setSessionHistory(history)
      setSecurityAlerts(alerts)
    } catch (error) {
      logger.error('Error refreshing sessions:', error)
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  const terminateSession = useCallback(
    async (sessionId: string) => {
      try {
        await SessionManagementService.terminateSession(sessionId)
        await refreshSessions()
      } catch (error) {
        logger.error('Error terminating session:', error)
        throw error
      }
    },
    [refreshSessions]
  )

  const terminateUserSession = useCallback(
    async (userId: string) => {
      try {
        await SessionManagementService.terminateUserSessions(userId)
        await refreshSessions()
      } catch (error) {
        logger.error('Error terminating user sessions:', error)
        throw error
      }
    },
    [refreshSessions]
  )

  const terminateAllSessions = useCallback(async () => {
    try {
      await SessionManagementService.terminateAllSessions()
      await refreshSessions()
    } catch (error) {
      logger.error('Error terminating all sessions:', error)
      throw error
    }
  }, [refreshSessions])

  // Timeout configuration actions
  const updateTimeoutConfig = useCallback(
    async (config: SessionTimeoutConfig) => {
      try {
        await SessionManagementService.updateTimeoutConfig(config)
        const configs = await SessionManagementService.getTimeoutConfigs()
        setTimeoutConfigs(configs)
      } catch (error) {
        logger.error('Error updating timeout config:', error)
        throw error
      }
    },
    []
  )

  const createTimeoutConfig = useCallback(
    async (config: Omit<SessionTimeoutConfig, 'id'>) => {
      try {
        await SessionManagementService.createTimeoutConfig(config)
        const configs = await SessionManagementService.getTimeoutConfigs()
        setTimeoutConfigs(configs)
      } catch (error) {
        logger.error('Error creating timeout config:', error)
        throw error
      }
    },
    []
  )

  const deleteTimeoutConfig = useCallback(async (configId: string) => {
    try {
      await SessionManagementService.deleteTimeoutConfig(configId)
      const configs = await SessionManagementService.getTimeoutConfigs()
      setTimeoutConfigs(configs)
    } catch (error) {
      logger.error('Error deleting timeout config:', error)
      throw error
    }
  }, [])

  // Security actions
  const resolveSecurityAlert = useCallback(async (alertId: string) => {
    try {
      await SessionManagementService.resolveSecurityAlert(alertId)
      const alerts = await SessionManagementService.getSecurityAlerts()
      setSecurityAlerts(alerts)
    } catch (error) {
      logger.error('Error resolving security alert:', error)
      throw error
    }
  }, [])

  const generateSecurityReport = useCallback(async () => {
    try {
      await SessionManagementService.generateSecurityReport()
    } catch (error) {
      logger.error('Error generating security report:', error)
      throw error
    }
  }, [])

  // Analytics actions
  const getSessionAnalytics = useCallback(async (timeRange: string) => {
    try {
      const stats =
        await SessionManagementService.getSessionAnalytics(timeRange)
      setSessionStats(stats)
    } catch (error) {
      logger.error('Error getting session analytics:', error)
      throw error
    }
  }, [])

  const exportSessionData = useCallback(async (format: 'csv' | 'json') => {
    try {
      await SessionManagementService.exportSessionData(format)
    } catch (error) {
      logger.error('Error exporting session data:', error)
      throw error
    }
  }, [])

  const value: SessionManagementContextType = {
    // Data
    activeSessions,
    sessionStats,
    sessionHistory,
    securityAlerts,
    timeoutConfigs,

    // Loading states
    isLoading,
    isRefreshing,

    // Actions
    refreshSessions,
    terminateSession,
    terminateUserSession,
    terminateAllSessions,

    // Timeout configuration
    updateTimeoutConfig,
    createTimeoutConfig,
    deleteTimeoutConfig,

    // Security
    resolveSecurityAlert,
    generateSecurityReport,

    // Analytics
    getSessionAnalytics,
    exportSessionData,
  }

  return (
    <SessionManagementContext.Provider value={value}>
      {children}
    </SessionManagementContext.Provider>
  )
}

export function useSessionManagementContext() {
  const context = useContext(SessionManagementContext)
  if (context === undefined) {
    throw new Error(
      'useSessionManagementContext must be used within a SessionManagementProvider'
    )
  }
  return context
}

// Created and developed by Jai Singh
