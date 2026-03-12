import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/utils/logger'
import { SecurityService } from '../services/security.service'
import type {
  SecurityEvent,
  SecurityFilters,
  SecurityMetrics,
  SessionRestriction,
  ThreatIndicator,
} from '../types'

const QUERY_KEYS = {
  SECURITY_METRICS: 'security-metrics',
  SECURITY_EVENTS: 'security-events',
  SECURITY_ALERTS: 'security-alerts',
  ACTIVE_THREATS: 'active-threats',
  SESSION_RESTRICTIONS: 'session-restrictions',
  DATA_PROCESSING_ACTIVITIES: 'data-processing-activities',
  SUSPICIOUS_SESSIONS: 'suspicious-sessions',
} as const

/**
 * Hook for security monitoring dashboard data
 */
export function useSecurityMonitoring(days: number = 30) {
  const {
    data: metrics,
    isLoading: metricsLoading,
    error: metricsError,
  } = useQuery({
    queryKey: [QUERY_KEYS.SECURITY_METRICS, days],
    queryFn: () => SecurityService.getSecurityMetrics(days),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  })

  const {
    data: alerts,
    isLoading: alertsLoading,
    error: alertsError,
  } = useQuery({
    queryKey: [QUERY_KEYS.SECURITY_ALERTS],
    queryFn: () => SecurityService.getSecurityAlerts(),
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 2 * 60 * 1000, // Refresh every 2 minutes
  })

  const {
    data: threats,
    isLoading: threatsLoading,
    error: threatsError,
  } = useQuery({
    queryKey: [QUERY_KEYS.ACTIVE_THREATS],
    queryFn: () => SecurityService.getActiveThreats(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  })

  return {
    metrics:
      metrics ||
      ({
        total_events: 0,
        critical_events: 0,
        high_events: 0,
        active_threats: 0,
        resolved_events: 0,
      } as SecurityMetrics),
    alerts: alerts || [],
    threats: threats || [],
    isLoading: metricsLoading || alertsLoading || threatsLoading,
    error: metricsError || alertsError || threatsError,
  }
}

/**
 * Hook for security events with filtering
 */
export function useSecurityEvents(
  filters: SecurityFilters = {},
  limit: number = 50,
  offset: number = 0
) {
  return useQuery({
    queryKey: [QUERY_KEYS.SECURITY_EVENTS, filters, limit, offset],
    queryFn: () => SecurityService.getSecurityEvents(filters, limit, offset),
    staleTime: 2 * 60 * 1000, // 2 minutes
    placeholderData: (previousData) => previousData,
  })
}

/**
 * Hook for managing security event status
 */
export function useSecurityEventActions() {
  const queryClient = useQueryClient()

  const updateEventStatus = useMutation({
    mutationFn: ({
      eventId,
      status,
      notes,
    }: {
      eventId: string
      status: SecurityEvent['status']
      notes?: string
    }) => SecurityService.updateSecurityEventStatus(eventId, status, notes),
    onSuccess: () => {
      // Invalidate and refetch security data
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SECURITY_EVENTS] })
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SECURITY_ALERTS] })
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SECURITY_METRICS] })
    },
  })

  const logSecurityEvent = useMutation({
    mutationFn: ({
      eventType,
      severity,
      description,
      userId,
      ipAddress,
      userAgent,
      location,
      metadata,
    }: {
      eventType: SecurityEvent['event_type']
      severity: SecurityEvent['severity']
      description: string
      userId?: string
      ipAddress?: string
      userAgent?: string
      location?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }) =>
      SecurityService.logSecurityEvent(
        eventType,
        severity,
        description,
        userId,
        ipAddress,
        userAgent,
        location,
        metadata
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SECURITY_EVENTS] })
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SECURITY_ALERTS] })
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SECURITY_METRICS] })
    },
  })

  return {
    updateEventStatus,
    logSecurityEvent,
  }
}

/**
 * Hook for threat detection
 */
export function useThreatDetection() {
  const queryClient = useQueryClient()

  const {
    data: suspiciousSessions,
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.SUSPICIOUS_SESSIONS],
    queryFn: () => SecurityService.detectSuspiciousSessions(),
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchInterval: 10 * 60 * 1000, // Refresh every 10 minutes
  })

  const createThreatIndicator = useMutation({
    mutationFn: ({
      indicatorType,
      value,
      threatLevel,
      description,
    }: {
      indicatorType: string
      value: string
      threatLevel: ThreatIndicator['threat_level']
      description?: string
    }) =>
      SecurityService.createThreatIndicator(
        indicatorType,
        value,
        threatLevel,
        description
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.ACTIVE_THREATS] })
    },
  })

  const deactivateThreatIndicator = useMutation({
    mutationFn: (indicatorId: string) =>
      SecurityService.deactivateThreatIndicator(indicatorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.ACTIVE_THREATS] })
    },
  })

  return {
    suspiciousSessions: suspiciousSessions || [],
    isLoading,
    error,
    createThreatIndicator,
    deactivateThreatIndicator,
  }
}

/**
 * Hook for session restrictions management
 */
export function useSessionRestrictions(userId?: string) {
  const queryClient = useQueryClient()

  const {
    data: restrictions,
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.SESSION_RESTRICTIONS, userId],
    queryFn: () =>
      userId
        ? SecurityService.getSessionRestrictions(userId)
        : Promise.resolve([]),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const createRestriction = useMutation({
    mutationFn: ({
      userId,
      restrictionType,
      restrictionValue,
    }: {
      userId: string
      restrictionType: SessionRestriction['restriction_type']
      restrictionValue: Record<string, unknown>
    }) =>
      SecurityService.createSessionRestriction(
        userId,
        restrictionType,
        restrictionValue
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.SESSION_RESTRICTIONS],
      })
    },
  })

  return {
    restrictions: restrictions || [],
    isLoading,
    error,
    createRestriction,
  }
}

/**
 * Hook for GDPR compliance data
 */
export function useGDPRCompliance(userId?: string) {
  return useQuery({
    queryKey: [QUERY_KEYS.DATA_PROCESSING_ACTIVITIES, userId],
    queryFn: () => SecurityService.getDataProcessingActivities(userId),
    enabled: !!userId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Hook for security data export
 */
export function useSecurityExport() {
  const exportData = useMutation({
    mutationFn: ({
      format,
      filters,
    }: {
      format: 'csv' | 'json' | 'pdf'
      filters?: SecurityFilters
    }) => SecurityService.exportSecurityData(format, filters),
  })

  const downloadExport = async (
    format: 'csv' | 'json' | 'pdf',
    filters?: SecurityFilters,
    filename?: string
  ) => {
    try {
      const blob = await exportData.mutateAsync({ format, filters })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download =
        filename ||
        `security-export-${new Date().toISOString().split('T')[0]}.${format}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Export failed:', error)
      throw error
    }
  }

  return {
    exportData,
    downloadExport,
    isExporting: exportData.isPending,
  }
}
