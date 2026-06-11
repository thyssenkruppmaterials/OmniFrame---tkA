// Created and developed by Jai Singh
/**
 * Shift Productivity Settings React Hook
 * Provides state management for shift productivity settings
 * Created: January 28, 2026
 */
import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import shiftProductivitySettingsService, {
  DEFAULT_SETTINGS,
  type ShiftProductivitySettings,
  type GeneralSettingsForm,
  type KPISettingsForm,
  type NotificationSettingsForm,
  type TeamSettingsForm,
  type AdvancedSettingsForm,
} from '@/lib/supabase/shift-productivity-settings.service'
import { logger } from '@/lib/utils/logger'

const QUERY_KEY = 'shift-productivity-settings'
const STALE_TIME = 5 * 60 * 1000 // 5 minutes

export function useShiftProductivitySettings() {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id || ''
  const queryClient = useQueryClient()

  const ensureOrganizationId = () => {
    if (!organizationId) {
      throw new Error('Organization not found. Settings cannot be saved.')
    }
    return organizationId
  }

  const invalidateSettings = () => {
    queryClient.invalidateQueries({ queryKey: [QUERY_KEY, organizationId] })
  }

  const invalidatePerformanceRuntime = () => {
    queryClient.invalidateQueries({
      queryKey: ['team-performance', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['team-performance-weekly', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['timeline-events', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['overtime-requests', organizationId],
    })
  }

  // ===== MAIN SETTINGS QUERY =====
  const {
    data: settings,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [QUERY_KEY, organizationId],
    queryFn: () => shiftProductivitySettingsService.getSettings(organizationId),
    enabled: !!organizationId,
    staleTime: STALE_TIME,
  })

  // ===== GENERAL SETTINGS MUTATION =====
  const updateGeneralMutation = useMutation({
    mutationFn: (data: GeneralSettingsForm) =>
      shiftProductivitySettingsService.updateGeneralSettings(
        ensureOrganizationId(),
        data
      ),
    onSuccess: () => {
      invalidateSettings()
      invalidatePerformanceRuntime()
      toast.success('General settings saved successfully')
    },
    onError: (error: Error) => {
      logger.error('[Settings] Failed to save general settings:', error)
      toast.error(`Failed to save settings: ${error.message}`)
    },
  })

  // ===== KPI SETTINGS MUTATION =====
  const updateKPIMutation = useMutation({
    mutationFn: (data: KPISettingsForm) =>
      shiftProductivitySettingsService.updateKPISettings(
        ensureOrganizationId(),
        data
      ),
    onSuccess: () => {
      invalidateSettings()
      invalidatePerformanceRuntime()
      toast.success('KPI settings saved successfully')
    },
    onError: (error: Error) => {
      logger.error('[Settings] Failed to save KPI settings:', error)
      toast.error(`Failed to save settings: ${error.message}`)
    },
  })

  // ===== NOTIFICATION SETTINGS MUTATION =====
  const updateNotificationMutation = useMutation({
    mutationFn: (data: NotificationSettingsForm) =>
      shiftProductivitySettingsService.updateNotificationSettings(
        ensureOrganizationId(),
        data
      ),
    onSuccess: () => {
      invalidateSettings()
      toast.success('Notification settings saved successfully')
    },
    onError: (error: Error) => {
      logger.error('[Settings] Failed to save notification settings:', error)
      toast.error(`Failed to save settings: ${error.message}`)
    },
  })

  // ===== TEAM SETTINGS MUTATION =====
  const updateTeamMutation = useMutation({
    mutationFn: (data: TeamSettingsForm) =>
      shiftProductivitySettingsService.updateTeamSettings(
        ensureOrganizationId(),
        data
      ),
    onSuccess: () => {
      invalidateSettings()
      invalidatePerformanceRuntime()
      toast.success('Team settings saved successfully')
    },
    onError: (error: Error) => {
      logger.error('[Settings] Failed to save team settings:', error)
      toast.error(`Failed to save settings: ${error.message}`)
    },
  })

  // ===== ADVANCED SETTINGS MUTATION =====
  const updateAdvancedMutation = useMutation({
    mutationFn: (data: AdvancedSettingsForm) =>
      shiftProductivitySettingsService.updateAdvancedSettings(
        ensureOrganizationId(),
        data
      ),
    onSuccess: () => {
      invalidateSettings()
      invalidatePerformanceRuntime()
      toast.success('Advanced settings saved successfully')
    },
    onError: (error: Error) => {
      logger.error('[Settings] Failed to save advanced settings:', error)
      toast.error(`Failed to save settings: ${error.message}`)
    },
  })

  // ===== MEMOIZED FORM VALUES =====
  const generalFormValues = useMemo<GeneralSettingsForm>(
    () => shiftProductivitySettingsService.toGeneralForm(settings ?? null),
    [settings]
  )

  const kpiFormValues = useMemo<KPISettingsForm>(
    () => shiftProductivitySettingsService.toKPIForm(settings ?? null),
    [settings]
  )

  const notificationFormValues = useMemo<NotificationSettingsForm>(
    () => shiftProductivitySettingsService.toNotificationForm(settings ?? null),
    [settings]
  )

  const teamFormValues = useMemo<TeamSettingsForm>(
    () => shiftProductivitySettingsService.toTeamForm(settings ?? null),
    [settings]
  )

  const advancedFormValues = useMemo<AdvancedSettingsForm>(
    () => shiftProductivitySettingsService.toAdvancedForm(settings ?? null),
    [settings]
  )

  const effectiveSettings = useMemo<ShiftProductivitySettings>(
    () => ({
      organization_id: organizationId,
      ...DEFAULT_SETTINGS,
      ...(settings ?? {}),
    }),
    [organizationId, settings]
  )

  // ===== RETURN VALUES =====
  return {
    // Raw settings data
    settings,
    effectiveSettings,
    isLoading,
    error,
    refetch,

    // Memoized form values (converts DB format to form format)
    generalFormValues,
    kpiFormValues,
    notificationFormValues,
    teamFormValues,
    advancedFormValues,

    // Update mutations
    updateGeneralSettings: updateGeneralMutation.mutate,
    updateKPISettings: updateKPIMutation.mutate,
    updateNotificationSettings: updateNotificationMutation.mutate,
    updateTeamSettings: updateTeamMutation.mutate,
    updateAdvancedSettings: updateAdvancedMutation.mutate,

    // Mutation states
    isUpdatingGeneral: updateGeneralMutation.isPending,
    isUpdatingKPI: updateKPIMutation.isPending,
    isUpdatingNotification: updateNotificationMutation.isPending,
    isUpdatingTeam: updateTeamMutation.isPending,
    isUpdatingAdvanced: updateAdvancedMutation.isPending,

    // Combined updating state
    isUpdating:
      updateGeneralMutation.isPending ||
      updateKPIMutation.isPending ||
      updateNotificationMutation.isPending ||
      updateTeamMutation.isPending ||
      updateAdvancedMutation.isPending,

    // Organization ID for reference
    organizationId,
  }
}

// Export types for use in components
export type {
  ShiftProductivitySettings,
  GeneralSettingsForm,
  KPISettingsForm,
  NotificationSettingsForm,
  TeamSettingsForm,
  AdvancedSettingsForm,
}

// Created and developed by Jai Singh
