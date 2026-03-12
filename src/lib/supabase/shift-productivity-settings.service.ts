/**
 * Shift Productivity Settings Service
 * Service for managing shift productivity settings per organization
 * Created: January 28, 2026
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// ===== TYPESCRIPT INTERFACES =====

export interface ShiftProductivitySettings {
  id?: string
  organization_id: string

  // General Settings
  tracking_enabled: boolean
  shift_duration: string
  break_tracking: boolean
  auto_clock_out: boolean
  timezone: string

  // KPI Thresholds
  enable_kpi_tracking: boolean
  target_scans_per_hour: number
  target_putaways_per_hour: number
  target_picks_per_hour: number
  target_cycle_counts_per_hour: number
  quality_threshold: number
  accuracy_threshold: number

  // Notification Settings
  enable_notifications: boolean
  shift_start_reminder: boolean
  shift_end_reminder: boolean
  low_productivity_alert: boolean
  target_missed_alert: boolean
  team_milestone_notification: boolean
  daily_summary: boolean

  // Team Settings
  enable_team_tracking: boolean
  team_size: number
  shift_rotation: string
  competitive_mode: boolean
  team_goals_visible: boolean
  individual_metrics_visible: boolean
  cross_training_tracking: boolean

  // Advanced Settings
  data_retention_days: number
  auto_archive: boolean
  export_format: string
  calculation_method: string
  enable_debug_mode: boolean
  enable_advanced_analytics: boolean

  created_at?: string
  updated_at?: string
}

// Form value interfaces (camelCase for React forms)
// Using literal types to match Zod enum schemas in form components
export interface GeneralSettingsForm {
  trackingEnabled: boolean
  shiftDuration: '8' | '10' | '12'
  breakTracking: boolean
  autoClockOut: boolean
  timezone: string
}

export interface KPISettingsForm {
  enableKPITracking: boolean
  targetScansPerHour: number
  targetPutawaysPerHour: number
  targetPicksPerHour: number
  targetCycleCountsPerHour: number
  qualityThreshold: number
  accuracyThreshold: number
}

export interface NotificationSettingsForm {
  enableNotifications: boolean
  shiftStartReminder: boolean
  shiftEndReminder: boolean
  lowProductivityAlert: boolean
  targetMissedAlert: boolean
  teamMilestoneNotification: boolean
  dailySummary: boolean
}

export interface TeamSettingsForm {
  enableTeamTracking: boolean
  teamSize: number
  shiftRotation: 'fixed' | 'rotating' | 'flexible'
  competitiveMode: boolean
  teamGoalsVisible: boolean
  individualMetricsVisible: boolean
  crossTrainingTracking: boolean
}

export interface AdvancedSettingsForm {
  dataRetentionDays: number
  autoArchive: boolean
  exportFormat: 'csv' | 'excel' | 'json'
  calculationMethod: 'simple' | 'weighted' | 'rolling'
  enableDebugMode: boolean
  enableAdvancedAnalytics: boolean
}

// Default values matching form schemas
export const DEFAULT_SETTINGS: Omit<
  ShiftProductivitySettings,
  'id' | 'organization_id' | 'created_at' | 'updated_at'
> = {
  // General
  tracking_enabled: true,
  shift_duration: '8',
  break_tracking: true,
  auto_clock_out: false,
  timezone: 'America/New_York',

  // KPI
  enable_kpi_tracking: true,
  target_scans_per_hour: 30,
  target_putaways_per_hour: 15,
  target_picks_per_hour: 20,
  target_cycle_counts_per_hour: 5,
  quality_threshold: 95,
  accuracy_threshold: 98,

  // Notifications
  enable_notifications: true,
  shift_start_reminder: true,
  shift_end_reminder: true,
  low_productivity_alert: true,
  target_missed_alert: true,
  team_milestone_notification: true,
  daily_summary: false,

  // Team
  enable_team_tracking: true,
  team_size: 10,
  shift_rotation: 'fixed',
  competitive_mode: false,
  team_goals_visible: true,
  individual_metrics_visible: true,
  cross_training_tracking: false,

  // Advanced
  data_retention_days: 90,
  auto_archive: true,
  export_format: 'csv',
  calculation_method: 'simple',
  enable_debug_mode: false,
  enable_advanced_analytics: false,
}

// ===== SERVICE CLASS =====

export class ShiftProductivitySettingsService {
  private static instance: ShiftProductivitySettingsService

  private constructor() {}

  static getInstance(): ShiftProductivitySettingsService {
    if (!ShiftProductivitySettingsService.instance) {
      ShiftProductivitySettingsService.instance =
        new ShiftProductivitySettingsService()
    }
    return ShiftProductivitySettingsService.instance
  }

  /**
   * Get settings for an organization
   */
  async getSettings(
    organizationId: string
  ): Promise<ShiftProductivitySettings | null> {
    const { data, error } = await (supabase as any)
      .from('shift_productivity_settings')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (error) {
      logger.error(
        '[ShiftProductivitySettings] Error fetching settings:',
        error
      )
      throw error
    }

    return data as ShiftProductivitySettings | null
  }

  /**
   * Upsert settings (insert or update)
   */
  async upsertSettings(
    settings: Partial<ShiftProductivitySettings> & { organization_id: string }
  ): Promise<ShiftProductivitySettings> {
    const { data, error } = await (supabase as any)
      .from('shift_productivity_settings')
      .upsert(settings, { onConflict: 'organization_id' })
      .select()
      .single()

    if (error) {
      logger.error('[ShiftProductivitySettings] Error saving settings:', error)
      throw error
    }

    return data as ShiftProductivitySettings
  }

  /**
   * Update general settings section
   */
  async updateGeneralSettings(
    organizationId: string,
    form: GeneralSettingsForm
  ): Promise<ShiftProductivitySettings> {
    return this.upsertSettings({
      organization_id: organizationId,
      tracking_enabled: form.trackingEnabled,
      shift_duration: form.shiftDuration,
      break_tracking: form.breakTracking,
      auto_clock_out: form.autoClockOut,
      timezone: form.timezone,
    })
  }

  /**
   * Update KPI settings section
   */
  async updateKPISettings(
    organizationId: string,
    form: KPISettingsForm
  ): Promise<ShiftProductivitySettings> {
    return this.upsertSettings({
      organization_id: organizationId,
      enable_kpi_tracking: form.enableKPITracking,
      target_scans_per_hour: form.targetScansPerHour,
      target_putaways_per_hour: form.targetPutawaysPerHour,
      target_picks_per_hour: form.targetPicksPerHour,
      target_cycle_counts_per_hour: form.targetCycleCountsPerHour,
      quality_threshold: form.qualityThreshold,
      accuracy_threshold: form.accuracyThreshold,
    })
  }

  /**
   * Update notification settings section
   */
  async updateNotificationSettings(
    organizationId: string,
    form: NotificationSettingsForm
  ): Promise<ShiftProductivitySettings> {
    return this.upsertSettings({
      organization_id: organizationId,
      enable_notifications: form.enableNotifications,
      shift_start_reminder: form.shiftStartReminder,
      shift_end_reminder: form.shiftEndReminder,
      low_productivity_alert: form.lowProductivityAlert,
      target_missed_alert: form.targetMissedAlert,
      team_milestone_notification: form.teamMilestoneNotification,
      daily_summary: form.dailySummary,
    })
  }

  /**
   * Update team settings section
   */
  async updateTeamSettings(
    organizationId: string,
    form: TeamSettingsForm
  ): Promise<ShiftProductivitySettings> {
    return this.upsertSettings({
      organization_id: organizationId,
      enable_team_tracking: form.enableTeamTracking,
      team_size: form.teamSize,
      shift_rotation: form.shiftRotation,
      competitive_mode: form.competitiveMode,
      team_goals_visible: form.teamGoalsVisible,
      individual_metrics_visible: form.individualMetricsVisible,
      cross_training_tracking: form.crossTrainingTracking,
    })
  }

  /**
   * Update advanced settings section
   */
  async updateAdvancedSettings(
    organizationId: string,
    form: AdvancedSettingsForm
  ): Promise<ShiftProductivitySettings> {
    return this.upsertSettings({
      organization_id: organizationId,
      data_retention_days: form.dataRetentionDays,
      auto_archive: form.autoArchive,
      export_format: form.exportFormat,
      calculation_method: form.calculationMethod,
      enable_debug_mode: form.enableDebugMode,
      enable_advanced_analytics: form.enableAdvancedAnalytics,
    })
  }

  // ===== HELPER METHODS FOR FORM CONVERSION =====

  /**
   * Convert database settings to General form values
   */
  toGeneralForm(
    settings: ShiftProductivitySettings | null
  ): GeneralSettingsForm {
    return {
      trackingEnabled:
        settings?.tracking_enabled ?? DEFAULT_SETTINGS.tracking_enabled,
      shiftDuration: (settings?.shift_duration ??
        DEFAULT_SETTINGS.shift_duration) as GeneralSettingsForm['shiftDuration'],
      breakTracking:
        settings?.break_tracking ?? DEFAULT_SETTINGS.break_tracking,
      autoClockOut: settings?.auto_clock_out ?? DEFAULT_SETTINGS.auto_clock_out,
      timezone: settings?.timezone ?? DEFAULT_SETTINGS.timezone,
    }
  }

  /**
   * Convert database settings to KPI form values
   */
  toKPIForm(settings: ShiftProductivitySettings | null): KPISettingsForm {
    return {
      enableKPITracking:
        settings?.enable_kpi_tracking ?? DEFAULT_SETTINGS.enable_kpi_tracking,
      targetScansPerHour:
        settings?.target_scans_per_hour ??
        DEFAULT_SETTINGS.target_scans_per_hour,
      targetPutawaysPerHour:
        settings?.target_putaways_per_hour ??
        DEFAULT_SETTINGS.target_putaways_per_hour,
      targetPicksPerHour:
        settings?.target_picks_per_hour ??
        DEFAULT_SETTINGS.target_picks_per_hour,
      targetCycleCountsPerHour:
        settings?.target_cycle_counts_per_hour ??
        DEFAULT_SETTINGS.target_cycle_counts_per_hour,
      qualityThreshold:
        settings?.quality_threshold ?? DEFAULT_SETTINGS.quality_threshold,
      accuracyThreshold:
        settings?.accuracy_threshold ?? DEFAULT_SETTINGS.accuracy_threshold,
    }
  }

  /**
   * Convert database settings to Notification form values
   */
  toNotificationForm(
    settings: ShiftProductivitySettings | null
  ): NotificationSettingsForm {
    return {
      enableNotifications:
        settings?.enable_notifications ?? DEFAULT_SETTINGS.enable_notifications,
      shiftStartReminder:
        settings?.shift_start_reminder ?? DEFAULT_SETTINGS.shift_start_reminder,
      shiftEndReminder:
        settings?.shift_end_reminder ?? DEFAULT_SETTINGS.shift_end_reminder,
      lowProductivityAlert:
        settings?.low_productivity_alert ??
        DEFAULT_SETTINGS.low_productivity_alert,
      targetMissedAlert:
        settings?.target_missed_alert ?? DEFAULT_SETTINGS.target_missed_alert,
      teamMilestoneNotification:
        settings?.team_milestone_notification ??
        DEFAULT_SETTINGS.team_milestone_notification,
      dailySummary: settings?.daily_summary ?? DEFAULT_SETTINGS.daily_summary,
    }
  }

  /**
   * Convert database settings to Team form values
   */
  toTeamForm(settings: ShiftProductivitySettings | null): TeamSettingsForm {
    return {
      enableTeamTracking:
        settings?.enable_team_tracking ?? DEFAULT_SETTINGS.enable_team_tracking,
      teamSize: settings?.team_size ?? DEFAULT_SETTINGS.team_size,
      shiftRotation: (settings?.shift_rotation ??
        DEFAULT_SETTINGS.shift_rotation) as TeamSettingsForm['shiftRotation'],
      competitiveMode:
        settings?.competitive_mode ?? DEFAULT_SETTINGS.competitive_mode,
      teamGoalsVisible:
        settings?.team_goals_visible ?? DEFAULT_SETTINGS.team_goals_visible,
      individualMetricsVisible:
        settings?.individual_metrics_visible ??
        DEFAULT_SETTINGS.individual_metrics_visible,
      crossTrainingTracking:
        settings?.cross_training_tracking ??
        DEFAULT_SETTINGS.cross_training_tracking,
    }
  }

  /**
   * Convert database settings to Advanced form values
   */
  toAdvancedForm(
    settings: ShiftProductivitySettings | null
  ): AdvancedSettingsForm {
    return {
      dataRetentionDays:
        settings?.data_retention_days ?? DEFAULT_SETTINGS.data_retention_days,
      autoArchive: settings?.auto_archive ?? DEFAULT_SETTINGS.auto_archive,
      exportFormat: (settings?.export_format ??
        DEFAULT_SETTINGS.export_format) as AdvancedSettingsForm['exportFormat'],
      calculationMethod: (settings?.calculation_method ??
        DEFAULT_SETTINGS.calculation_method) as AdvancedSettingsForm['calculationMethod'],
      enableDebugMode:
        settings?.enable_debug_mode ?? DEFAULT_SETTINGS.enable_debug_mode,
      enableAdvancedAnalytics:
        settings?.enable_advanced_analytics ??
        DEFAULT_SETTINGS.enable_advanced_analytics,
    }
  }
}

export default ShiftProductivitySettingsService.getInstance()
// Developer and Creator: Jai Singh
