// Created and developed by Jai Singh
import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  Database,
  Gauge,
  Network,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type SettingsFeatureStatus = 'live' | 'partial' | 'setup' | 'pending'

export type SettingsSectionGroupId =
  | 'foundations'
  | 'performance'
  | 'people'
  | 'system'

export interface SettingsSectionGroupConfig {
  id: SettingsSectionGroupId
  label: string
  description: string
}

export const settingsSectionGroups: SettingsSectionGroupConfig[] = [
  {
    id: 'foundations',
    label: 'Foundations',
    description: 'Health, tracking, and the operating model.',
  },
  {
    id: 'performance',
    label: 'Performance',
    description: 'Targets, standards, and source data.',
  },
  {
    id: 'people',
    label: 'People',
    description: 'Schedules, visibility, and assignments.',
  },
  {
    id: 'system',
    label: 'System',
    description: 'Automation, retention, and diagnostics.',
  },
]

export interface SettingsSectionConfig {
  id: string
  title: string
  shortTitle: string
  description: string
  icon: LucideIcon
  accent: string
  group: SettingsSectionGroupId
}

export interface SettingsFeatureWiring {
  feature: string
  category: string
  storage: string
  readPath: string
  behavior: string
  invalidates: string
  status: SettingsFeatureStatus
}

export const settingsSections: SettingsSectionConfig[] = [
  {
    id: 'overview',
    title: 'Settings Overview',
    shortTitle: 'Overview',
    description:
      'Review configuration health, setup progress, and feature wiring.',
    icon: Gauge,
    accent: 'bg-primary/10 text-primary',
    group: 'foundations',
  },
  {
    id: 'tracking',
    title: 'Tracking & Operations',
    shortTitle: 'Tracking',
    description:
      'Configure shift boundaries, tracking controls, and timezone behavior.',
    icon: Activity,
    accent: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    group: 'foundations',
  },
  {
    id: 'operating-model',
    title: 'Operating Model',
    shortTitle: 'Operating Model',
    description:
      'Manage positions, working areas, assignments, options, and org hierarchy.',
    icon: Network,
    accent: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    group: 'foundations',
  },
  {
    id: 'performance-standards',
    title: 'Performance Standards',
    shortTitle: 'Standards',
    description: 'Set KPI thresholds and align them with labor standards.',
    icon: BarChart3,
    accent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    group: 'performance',
  },
  {
    id: 'data-sources',
    title: 'Data Sources',
    shortTitle: 'Data Sources',
    description:
      'Control the database sources that feed activity timelines and summaries.',
    icon: Database,
    accent: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    group: 'performance',
  },
  {
    id: 'team-schedules',
    title: 'Team & Schedules',
    shortTitle: 'Team',
    description:
      'Configure team visibility, schedules, and unassigned-user workflows.',
    icon: Users,
    accent: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    group: 'people',
  },
  {
    id: 'automation',
    title: 'Automation & Alerts',
    shortTitle: 'Automation',
    description: 'Manage notification preferences and automation readiness.',
    icon: Bell,
    accent: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    group: 'system',
  },
  {
    id: 'advanced',
    title: 'Advanced Controls',
    shortTitle: 'Advanced',
    description:
      'Tune retention, export defaults, calculation mode, and diagnostics.',
    icon: Settings,
    accent: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
    group: 'system',
  },
]

export const settingsFeatureMatrix: SettingsFeatureWiring[] = [
  {
    feature: 'Productivity tracking',
    category: 'General',
    storage: 'shift_productivity_settings.tracking_enabled',
    readPath: 'useShiftProductivitySettings, useTeamPerformance',
    behavior:
      'Surfaces disabled-state guidance on performance views and overview health.',
    invalidates: 'shift-productivity-settings, team-performance',
    status: 'partial',
  },
  {
    feature: 'Default shift duration',
    category: 'General',
    storage: 'shift_productivity_settings.shift_duration',
    readPath: 'useShiftProductivitySettings',
    behavior:
      'Stored as the default operating assumption; explicit schedules still win.',
    invalidates: 'shift-productivity-settings',
    status: 'setup',
  },
  {
    feature: 'Break tracking',
    category: 'General',
    storage: 'shift_productivity_settings.break_tracking',
    readPath:
      'useShiftProductivitySettings, TeamPerformanceService schedule logic',
    behavior:
      'Documents whether scheduled breaks are expected to affect idle calculations.',
    invalidates: 'shift-productivity-settings, team-performance',
    status: 'partial',
  },
  {
    feature: 'Automatic clock-out',
    category: 'General',
    storage: 'shift_productivity_settings.auto_clock_out',
    readPath: 'useShiftProductivitySettings',
    behavior:
      'Requires a background job or time-clock worker before it can act automatically.',
    invalidates: 'shift-productivity-settings',
    status: 'pending',
  },
  {
    feature: 'Organization timezone',
    category: 'General',
    storage: 'shift_productivity_settings.timezone',
    readPath: 'useTeamPerformance, TeamPerformanceService',
    behavior:
      'Feeds date boundaries, weekly trend, Gantt idle blocks, and cache keys.',
    invalidates:
      'shift-productivity-settings, team-performance, timeline-events, overtime-requests',
    status: 'live',
  },
  {
    feature: 'KPI targets',
    category: 'Standards',
    storage: 'shift_productivity_settings target_* columns',
    readPath: 'useShiftProductivitySettings, settings UI, dashboard messaging',
    behavior:
      'Controls visible KPI setup and target context; labor standards remain per-role truth.',
    invalidates: 'shift-productivity-settings, team-performance',
    status: 'partial',
  },
  {
    feature: 'Labor standards',
    category: 'Standards',
    storage: 'labor_standards',
    readPath: 'useLaborManagement, useTeamPerformance, TeamPerformanceService',
    behavior: 'Drives efficiency calculations and standards management.',
    invalidates: 'labor-standards, team-performance',
    status: 'live',
  },
  {
    feature: 'Notifications and summaries',
    category: 'Automation',
    storage: 'shift_productivity_settings notification columns',
    readPath: 'useShiftProductivitySettings',
    behavior: 'Preferences are stored; delivery requires worker/job wiring.',
    invalidates: 'shift-productivity-settings',
    status: 'pending',
  },
  {
    feature: 'Team tracking and visibility',
    category: 'Team',
    storage: 'shift_productivity_settings team columns',
    readPath: 'useShiftProductivitySettings, settings overview',
    behavior: 'Controls team feature messaging and visibility guardrails.',
    invalidates: 'shift-productivity-settings, team-performance',
    status: 'partial',
  },
  {
    feature: 'Shift schedules',
    category: 'Team',
    storage: 'shift_schedules, shift_assignments.shift_schedule_id',
    readPath:
      'ShiftScheduleManagement, UnassignedUsersManagement, TeamPerformanceService',
    behavior: 'Feeds assignment setup and scheduled shift/break boundaries.',
    invalidates: 'shift-assignments, team-performance',
    status: 'live',
  },
  {
    feature: 'Operating model',
    category: 'Labor',
    storage:
      'shift_positions, working_areas, shift_assignments, organizational_hierarchy',
    readPath: 'useLaborManagement, TeamPerformanceService',
    behavior:
      'Drives departments, areas, assignments, org chart, and labor board context.',
    invalidates:
      'working-areas, shift-positions, shift-assignments, team-performance',
    status: 'live',
  },
  {
    feature: 'Activity sources',
    category: 'Data',
    storage: 'activity_source_config, activity_display_config',
    readPath:
      'useActivitySourceConfig, useActivityConfig, TeamPerformanceService RPCs',
    behavior:
      'Updates runtime timeline/Gantt config and invalidates performance views.',
    invalidates: 'activity-config, team-performance',
    status: 'live',
  },
  {
    feature: 'Default export format',
    category: 'Advanced',
    storage: 'shift_productivity_settings.export_format',
    readPath: 'useTeamPerformance, labor management exports',
    behavior:
      'Changes CSV/JSON/Excel-compatible downloads where exports are in this feature.',
    invalidates: 'shift-productivity-settings',
    status: 'live',
  },
  {
    feature: 'Calculation method',
    category: 'Advanced',
    storage: 'shift_productivity_settings.calculation_method',
    readPath: 'useShiftProductivitySettings, useTeamPerformance cache key',
    behavior:
      'Stored and cache-aware; deeper weighted/rolling score formulas need RPC/service expansion.',
    invalidates: 'shift-productivity-settings, team-performance',
    status: 'partial',
  },
  {
    feature: 'Retention and archive',
    category: 'Advanced',
    storage: 'shift_productivity_settings retention columns',
    readPath: 'useShiftProductivitySettings',
    behavior:
      'Preferences are stored; destructive archive behavior requires scheduled worker design.',
    invalidates: 'shift-productivity-settings',
    status: 'pending',
  },
  {
    feature: 'Debug mode and advanced analytics',
    category: 'Advanced',
    storage: 'shift_productivity_settings debug/analytics columns',
    readPath: 'useShiftProductivitySettings',
    behavior:
      'Debug is client-visible; advanced analytics needs analytics pipeline wiring.',
    invalidates: 'shift-productivity-settings',
    status: 'partial',
  },
]

export const statusCopy: Record<
  SettingsFeatureStatus,
  { label: string; description: string }
> = {
  live: {
    label: 'Live',
    description: 'Connected to app behavior.',
  },
  partial: {
    label: 'Partial',
    description: 'Stored and partially wired; reviewed in this redesign.',
  },
  setup: {
    label: 'Setup',
    description: 'Configuration used as setup context.',
  },
  pending: {
    label: 'Pending automation',
    description: 'Stored safely, but needs worker/backend automation.',
  },
}

export const automationBacklog = settingsFeatureMatrix.filter(
  (feature) => feature.status === 'pending'
)

export const settingsHealthSections = [
  {
    id: 'connected',
    title: 'Connected controls',
    description: 'Settings with a direct runtime read path.',
    icon: ShieldCheck,
    status: 'live' as const,
  },
  {
    id: 'setup',
    title: 'Setup controls',
    description: 'Configuration used to guide setup and defaults.',
    icon: CalendarClock,
    status: 'setup' as const,
  },
  {
    id: 'pending',
    title: 'Needs automation',
    description:
      'Stored preferences that need background jobs or deeper services.',
    icon: Bell,
    status: 'pending' as const,
  },
]

// Created and developed by Jai Singh
