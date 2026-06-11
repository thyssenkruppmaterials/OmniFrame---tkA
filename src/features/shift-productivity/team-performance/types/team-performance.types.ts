// Created and developed by Jai Singh
/**
 * Team Performance Types
 * TypeScript interfaces for team performance dashboard data structures
 * Created: December 20, 2025
 * Updated: January 1, 2026 - Added activity timeline and task breakdown types
 * Updated: January 4, 2026 - Made ActivityType dynamic to support custom activity sources
 */
import type { ProductivityStats } from '@/lib/supabase/productivity.service'

// ===== ACTIVITY TIMELINE TYPES =====

/**
 * Standard activity types - these are the base system types.
 * Custom activity types can be added via Settings → Activity Sources
 * The actual activity type is a string to support dynamic types from database.
 */
export type StandardActivityType =
  | 'inbound_scan'
  | 'cart_stow'
  | 'putaway'
  | 'putaway_confirm'
  | 'picking'
  | 'pack'
  | 'ship'
  | 'final_pack'
  | 'putback'
  | 'cycle_count'
  | 'customer_response'
  | 'kit_picking'
  | 'kit_building'
  | 'kit_inspection'
  | 'kit_dock_staging'

/**
 * Special block types used in activity timelines
 */
export type SpecialBlockType = 'idle' | 'break' | 'event'

/**
 * ActivityType combines standard types, special block types, and allows any string
 * for dynamic activity types from the database.
 *
 * The `(string & {})` pattern allows any string while still providing autocomplete
 * for known types, improving type safety without breaking backward compatibility.
 */
export type ActivityType =
  | StandardActivityType
  | SpecialBlockType
  | (string & {})

/**
 * Activity event with full metadata from dynamic configuration
 */
export interface ActivityEvent {
  type: ActivityType
  timestamp: string
  area?: string
  details?: string
  /** Activity label from configuration (e.g., "Scanning", "Picking") */
  activityLabel?: string
  /** Display color from configuration (e.g., "sky-500") */
  displayColor?: string
  /** Category from configuration (e.g., "work", "quality") */
  activityCategory?: string
}

/**
 * Dynamic activity configuration from database
 * Loaded from activity_source_config table
 */
export interface ActivityConfig {
  activity_type: string
  activity_label: string
  activity_description?: string | null
  display_color: string
  display_order: number
  activity_category: string
  gantt_bg_class: string
  gantt_hover_class: string
  gantt_text_class: string
  show_on_timeline: boolean
  show_in_summary: boolean
  include_in_efficiency: boolean
  efficiency_weight?: number
}

export interface ActivityBlock {
  startTime: string
  endTime: string
  type: ActivityType
  taskCount: number
  duration: number // in minutes
  // Event-specific fields (when type is 'event')
  eventId?: string
  eventName?: string
  eventType?: string
  eventColor?: string
  isPaidTime?: boolean
  isProductiveTime?: boolean
  // Dynamic activity metadata (from activity_source_config)
  activityLabel?: string
  displayColor?: string
  activityCategory?: string
  // Issue 3.10: Boundary info for blocks that were clamped/truncated
  wasTruncatedStart?: boolean // Block start was clamped to shift start
  wasTruncatedEnd?: boolean // Block end was clamped to shift end or day boundary
  originalDuration?: number // Original duration before any clamping (in minutes)
}

export interface TaskBreakdownByArea {
  area: string
  areaId?: string
  inbound_scans: number
  cart_stows: number
  put_aways: number
  picking: number
  packed: number
  shipped: number
  final_packed: number
  putbacks: number
  cycle_counts: number
  /** Kit workflow stages — migration 310 */
  kit_picking: number
  kit_building: number
  kit_inspection: number
  kit_dock_staging: number
  total: number
}

/** Scheduled break period for display on timeline */
export interface ScheduledBreak {
  name: string
  startTime: string // Time string like "12:00" or "10:30"
  durationMinutes: number
  isPaid: boolean
}

export interface DailyTimeline {
  dayStart: string // ISO timestamp for day start
  dayEnd: string // ISO timestamp for day end (or current time if today)
  firstActivity?: string // ISO timestamp
  lastActivity?: string // ISO timestamp
  totalWorkMinutes: number
  totalIdleMinutes: number
  /**
   * Total scheduled break minutes - ACCOUNTED time, not idle
   * Calculated from scheduledBreaks array
   */
  totalBreakMinutes: number
  activityBlocks: ActivityBlock[]
  events: ActivityEvent[]
  // Scheduled shift times (from shift_schedules table)
  scheduledShiftStart?: string // Time string like "06:00" or "08:30"
  scheduledShiftEnd?: string // Time string like "14:30" or "17:00"
  // Scheduled breaks (from shift_schedules table)
  scheduledBreaks?: ScheduledBreak[]
}

// ===== ASSOCIATE PERFORMANCE =====

export interface AssociateProductivity extends ProductivityStats {
  user_id: string
  user_name: string
  user_email?: string
  avatar_url?: string
  phone_number?: string
  hire_date?: string
  position_id?: string
  position_title?: string
  position_type?: string
  position_level?: number
  is_supervisory?: boolean
  working_area_id?: string
  working_area_name?: string
  area_code?: string
  department?: string
  status: 'active' | 'break' | 'offline'
  /**
   * Efficiency percentage calculated from Labor Standards
   * See: Settings → Labor Management → Standards tab
   */
  efficiency: number
  total_tasks: number
  shift_start?: string
  shift_end?: string
  shift_pattern?: string
  /** Direct supervisor information */
  supervisor_id?: string
  supervisor_name?: string
  supervisor_avatar?: string
  /** Team lead information */
  team_lead_id?: string
  team_lead_name?: string
  team_lead_avatar?: string
  /** Assignment details */
  assignment_type?: string
  productivity_target?: number
  /** Shift schedule information */
  schedule_name?: string
  scheduled_shift_start?: string // Time string like "06:00"
  scheduled_shift_end?: string // Time string like "14:30"
  /** Scheduled breaks for the shift */
  scheduled_breaks?: ScheduledBreak[]
  /** Task breakdown by area/type - added January 2026 */
  taskBreakdown?: TaskBreakdownByArea[]
  /** Activity timeline for Gantt chart visualization - added January 2026 */
  timeline?: DailyTimeline
}

export interface AssociatePerformanceFilters {
  department?: string
  working_area_id?: string
  status?: 'active' | 'break' | 'offline' | 'all'
  date?: Date
  search?: string
}

// ===== DEPARTMENT PERFORMANCE =====

export interface DepartmentPerformance {
  department: string
  icon?: string
  associates: AssociateProductivity[]
  totalAssociates: number
  activeAssociates: number
  totalTasks: number
  completedTasks: number
  efficiency: number
  targetEfficiency?: number
  color: string
  trend?: {
    value: number
    direction: 'up' | 'down' | 'neutral'
    percentage: number
  }
}

// ===== WORKING AREA =====

export interface WorkingArea {
  id: string
  area_code: string
  area_name: string
  area_type?: string
  description?: string
  capacity?: number
  organization_id: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

// ===== WORKING AREA PERFORMANCE =====

export interface AreaPerformance {
  area_id: string
  area_code: string
  area_name: string
  area_type: string
  associates: AssociateProductivity[]
  totalAssociates: number
  activeAssociates: number
  totalTasks: number
  completedTasks: number
  efficiency: number
  capacity?: number
  utilizationPercent?: number
  color: string
  // Time tracking metrics (aggregated from all associates)
  totalWorkMinutes: number
  totalIdleMinutes: number
  /**
   * Total scheduled break time across all associates
   * Breaks are ACCOUNTED time - not counted as idle
   */
  totalBreakMinutes: number
  /** Time Efficiency: (work time / (work time + idle time)) * 100 - breaks excluded from idle */
  timeEfficiency: number
  /** Production Efficiency: efficiency adjusted by time efficiency */
  productionEfficiency: number
  /**
   * Accounted Time Efficiency: (work time + break time) / total shift time * 100
   * Shows how well time is accounted for (work + scheduled breaks)
   */
  accountedTimeEfficiency: number
  // Task metrics (aggregated from all associates)
  taskMetrics: {
    inbound_scans: number
    cart_stows: number
    put_aways: number
    picking: number
    packed: number
    shipped: number
    final_packed: number
    putbacks: number
    cycle_counts: number
    /** Kit workflow stages — migration 310 */
    kit_picking: number
    kit_building: number
    kit_inspection: number
    kit_dock_staging: number
  }
  /** Aggregate timeline data for area-level Gantt visualization */
  aggregateTimeline?: {
    firstActivity?: string
    lastActivity?: string
    totalEvents: number
  }
}

// ===== TEAM PERFORMANCE SUMMARY =====

export interface TeamPerformanceSummary {
  totalAssociates: number
  activeAssociates: number
  onBreakAssociates: number
  offlineAssociates: number
  totalTasksCompleted: number
  averageEfficiency: number
  topPerformers: AssociateProductivity[]
  needsAttention: AssociateProductivity[]
}

// ===== LABOR STANDARD COMPARISON =====

export interface LaborStandardComparison {
  standard_id: string
  standard_name: string
  task_type: string
  target_value: number
  actual_value: number
  unit_of_measure: string
  efficiency_percentage: number
  status: 'excellent' | 'meets' | 'below' | 'critical'
  excellent_threshold?: number
  minimum_acceptable?: number
}

// ===== PERFORMANCE TREND DATA =====

export interface PerformanceTrendData {
  date: string
  day: string
  completed: number
  pending: number
  efficiency: number
}

export interface WeeklyPerformance {
  data: PerformanceTrendData[]
  totalCompleted: number
  totalPending: number
  averageEfficiency: number
  bestDay: string
  worstDay: string
}

// ===== AGGREGATED TEAM STATS =====

export interface TeamProductivityStats {
  inbound_scans: number
  cart_stows: number
  put_aways: number
  picking: number
  packed: number
  shipped: number
  final_packed: number
  putbacks: number
  cycle_counts: number
  /** Kit workflow stages — migration 310 */
  kit_picking: number
  kit_building: number
  kit_inspection: number
  kit_dock_staging: number
  work_queue_tasks: number
  total_tasks: number
}

export interface TeamPerformanceData {
  date: string
  summary: TeamPerformanceSummary
  stats: TeamProductivityStats
  byDepartment: DepartmentPerformance[]
  byArea: AreaPerformance[]
  associates: AssociateProductivity[]
  laborStandardComparisons: LaborStandardComparison[]
  weeklyTrend?: WeeklyPerformance
}

// ===== FILTER AND QUERY OPTIONS =====

export interface TeamPerformanceFilters {
  date?: Date
  dateRange?: {
    start: Date
    end: Date
  }
  departments?: string[]
  areas?: string[]
  statuses?: ('active' | 'break' | 'offline')[]
  search?: string
  sortBy?: 'name' | 'efficiency' | 'tasks' | 'department' | 'area'
  sortOrder?: 'asc' | 'desc'
}

// ===== KPI CARD TYPES =====

export interface KPIMetric {
  id: string
  label: string
  value: number
  previousValue?: number
  unit?: string
  icon?: string
  trend?: {
    value: number
    direction: 'up' | 'down' | 'neutral'
  }
  color?: 'default' | 'success' | 'warning' | 'danger' | 'info'
}

// ===== EFFICIENCY THRESHOLDS =====

export interface EfficiencyThresholds {
  excellent: number // >= this value is excellent (default: 95)
  good: number // >= this value is good (default: 85)
  acceptable: number // >= this value is acceptable (default: 70)
  // Below acceptable is considered critical
}

export const DEFAULT_EFFICIENCY_THRESHOLDS: EfficiencyThresholds = {
  excellent: 95,
  good: 85,
  acceptable: 70,
}

// ===== STATUS COLORS =====

export interface StatusColors {
  active: string
  break: string
  offline: string
}

export const DEFAULT_STATUS_COLORS: StatusColors = {
  active: 'bg-green-500',
  break: 'bg-yellow-500',
  offline: 'bg-gray-400',
}

// ===== DEPARTMENT COLORS =====

export const DEPARTMENT_COLORS: Record<string, string> = {
  Receiving: 'var(--chart-1)',
  Picking: 'var(--chart-2)',
  Packing: 'var(--chart-3)',
  Shipping: 'var(--chart-4)',
  Quality: 'var(--chart-5)',
  Returns: 'hsl(190, 80%, 50%)',
  Inventory: 'hsl(270, 70%, 60%)',
  default: 'var(--muted-foreground)',
}

// ===== UTILITY FUNCTIONS =====

export function getEfficiencyStatus(
  efficiency: number,
  thresholds: EfficiencyThresholds = DEFAULT_EFFICIENCY_THRESHOLDS
): 'excellent' | 'good' | 'acceptable' | 'critical' {
  if (efficiency >= thresholds.excellent) return 'excellent'
  if (efficiency >= thresholds.good) return 'good'
  if (efficiency >= thresholds.acceptable) return 'acceptable'
  return 'critical'
}

export function getEfficiencyColor(
  efficiency: number,
  thresholds: EfficiencyThresholds = DEFAULT_EFFICIENCY_THRESHOLDS
): string {
  const status = getEfficiencyStatus(efficiency, thresholds)
  switch (status) {
    case 'excellent':
      return 'text-green-600 dark:text-green-400'
    case 'good':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'acceptable':
      return 'text-yellow-600 dark:text-yellow-400'
    case 'critical':
      return 'text-red-600 dark:text-red-400'
  }
}

export function getEfficiencyBadgeVariant(
  efficiency: number,
  thresholds: EfficiencyThresholds = DEFAULT_EFFICIENCY_THRESHOLDS
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const status = getEfficiencyStatus(efficiency, thresholds)
  switch (status) {
    case 'excellent':
      return 'default'
    case 'good':
      return 'default'
    case 'acceptable':
      return 'secondary'
    case 'critical':
      return 'destructive'
  }
}

export function getDepartmentColor(department: string): string {
  return DEPARTMENT_COLORS[department] || DEPARTMENT_COLORS['default']
}

export function calculateTotalTasks(stats: TeamProductivityStats): number {
  return (
    stats.inbound_scans +
    (stats.cart_stows || 0) +
    stats.put_aways +
    stats.picking +
    stats.packed +
    stats.shipped +
    stats.final_packed +
    stats.putbacks +
    stats.cycle_counts +
    (stats.kit_picking || 0) +
    (stats.kit_building || 0) +
    (stats.kit_inspection || 0) +
    (stats.kit_dock_staging || 0) +
    stats.work_queue_tasks
  )
}

// ===== LABOR BOARD TYPES =====

export interface LaborBoardColumn {
  id: string // area_id or 'unassigned'
  type: 'area' | 'unassigned'
  area_name: string
  area_code?: string
  area_type?: string
  capacity?: number
  color: string
  associates: AssociateProductivity[]
  totalAssociates: number
  activeAssociates: number
  efficiency: number
  isOverCapacity: boolean
  requiresCertification?: boolean
  requiredCertifications?: string[]
}

export interface DragPayload {
  associateId: string
  associateName: string
  fromColumnId: string // area_id or 'unassigned'
  fromAreaName: string
}

export interface ReassignmentEvent {
  userId: string
  fromAreaId: string | null
  fromAreaName: string
  toAreaId: string | null
  toAreaName: string
  reason?: string
}

export type ReassignmentError =
  | 'AREA_NOT_FOUND'
  | 'ASSIGNMENT_NOT_FOUND'
  | 'AREA_AT_CAPACITY'
  | 'CONCURRENT_MODIFICATION'
  | 'PERMISSION_DENIED'
  | 'CERTIFICATION_REQUIRED'

export interface ReassignmentResult {
  success: boolean
  error?: ReassignmentError
  assignment_id?: string
  capacity?: number
  current?: number
  noop?: boolean
}

// Created and developed by Jai Singh
