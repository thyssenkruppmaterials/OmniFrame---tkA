// Created and developed by Jai Singh
/**
 * Team Performance Service
 * Aggregates productivity data across all team members by department and area
 * Integrates with labor standards for efficiency calculations
 * Created: December 20, 2025
 *
 * PERFORMANCE OPTIMIZED: January 3, 2026
 * - Replaced N+1 queries with aggregated RPC functions
 * - Reduced ~850 queries per day view to 3-5 queries
 * - Added batch processing for associate data
 */
import { logger } from '@/lib/utils/logger'
import type {
  ActivityBlock,
  ActivityEvent,
  ActivityType,
  AreaPerformance,
  AssociateProductivity,
  DailyTimeline,
  DepartmentPerformance,
  LaborStandardComparison,
  PerformanceTrendData,
  TaskBreakdownByArea,
  TeamPerformanceData,
  TeamPerformanceFilters,
  TeamPerformanceSummary,
  TeamProductivityStats,
  WeeklyPerformance,
} from '@/features/shift-productivity/team-performance/types/team-performance.types'
import {
  DEPARTMENT_COLORS,
  calculateTotalTasks,
  getDepartmentColor,
} from '@/features/shift-productivity/team-performance/types/team-performance.types'
import { supabase } from './client'
import type { LaborStandard, WorkingArea } from './labor-management.service'

// ===== TIMEZONE CONFIGURATION =====

/**
 * Default timezone for date calculations and formatting.
 * This should be passed from organization settings for proper multi-timezone support.
 * Organizations in Pacific, Central, Mountain, or international timezones should pass
 * their configured timezone to service methods.
 *
 * @example
 * // Pass timezone from shift productivity settings
 * const { timezone } = useShiftProductivitySettings()
 * const data = await teamPerformanceService.getTeamProductivity(orgId, date, filters, timezone)
 */
const DEFAULT_TIMEZONE = 'America/New_York'

// ===== RPC RESPONSE TYPES =====

interface ProductivityCountsRow {
  user_id: string
  inbound_scans: number
  cart_stows: number
  put_aways: number
  picking: number
  packed: number
  shipped: number
  final_packed: number
  putbacks: number
  cycle_counts: number
  customer_responses: number
  // Kit workflow stages — migration 310
  kit_picking: number
  kit_building: number
  kit_inspection: number
  kit_dock_staging: number
  total_tasks: number
}

interface ActivityEventRow {
  user_id: string
  event_type: string
  event_timestamp: string
  area: string
  // New fields from dynamic activity configuration (migration 091)
  activity_label?: string
  display_color?: string
  activity_category?: string
}

export interface ShiftAssignmentDetailRow {
  assignment_id: string
  user_id: string
  user_full_name: string | null
  user_email: string | null
  user_avatar_url: string | null
  user_status: string | null
  user_phone_number: string | null
  user_created_at: string | null
  position_id: string | null
  position_title: string | null
  position_type: string | null
  position_level: number | null
  is_supervisory: boolean | null
  department: string | null
  working_area_id: string | null
  area_name: string | null
  area_code: string | null
  area_type: string | null
  shift_schedule_id: string | null
  schedule_name: string | null
  shift_start_time: string | null
  shift_end_time: string | null
  break_start_time: string | null
  break_duration_minutes: number | null
  breaks: any[] | null
  supervisor_id: string | null
  supervisor_name: string | null
  supervisor_avatar: string | null
  team_lead_id: string | null
  team_lead_name: string | null
  team_lead_avatar: string | null
  assignment_type: string | null
  shift_pattern: string | null
  productivity_target: number | null
  inline_shift_schedule: any | null
}

interface WeeklySummaryRow {
  day_date: string
  day_name: string
  total_tasks: number
  total_associates: number
  active_associates: number
  inbound_scans: number
  put_aways: number
  picking: number
  packed: number
  shipped: number
  final_packed: number
  putbacks: number
  cycle_counts: number
}

/**
 * Get date string in specified timezone (YYYY-MM-DD format)
 * @param date - Date object to format
 * @param timezone - IANA timezone identifier (e.g., 'America/New_York', 'America/Los_Angeles')
 */
function getDateStringInTimezone(
  date: Date,
  timezone: string = DEFAULT_TIMEZONE
): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

// Legacy alias - exported for backward compatibility
export const getESTDateString = (date: Date) =>
  getDateStringInTimezone(date, DEFAULT_TIMEZONE)

/**
 * Get abbreviated day name in specified timezone
 * @param date - Date object
 * @param timezone - IANA timezone identifier
 */
function getDayName(date: Date, timezone: string = DEFAULT_TIMEZONE): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: timezone,
  })
}

/**
 * Get the UTC offset in hours for a specific date in a given timezone
 * Uses Intl.DateTimeFormat to accurately detect DST transitions
 *
 * @param dateString - Date in YYYY-MM-DD format
 * @param timezone - IANA timezone identifier
 * @returns Offset in hours (positive = behind UTC, e.g., 5 for EST, 8 for PST)
 *
 * Updated: January 5, 2026 - Fixed inaccurate month-based DST heuristic
 * Updated: January 28, 2026 - Made timezone configurable for multi-timezone support
 */
function getTimezoneOffsetHours(
  dateString: string,
  timezone: string = DEFAULT_TIMEZONE
): number {
  // Create a date at noon on the target date to avoid edge cases at midnight
  const targetDate = new Date(`${dateString}T12:00:00Z`)

  // Get the timezone offset by comparing UTC vs local time in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })

  // Format the UTC noon time in the target timezone
  const localTimeStr = formatter.format(targetDate)
  const [localHour] = localTimeStr.split(':').map(Number)

  // UTC noon (12:00) minus local hour gives the offset
  // If local is 7:00 when UTC is 12:00, offset is 5 (behind UTC)
  // If local is 8:00 when UTC is 12:00, offset is 4 (DST, behind UTC)
  // Handle wrap-around for timezones ahead of UTC
  let offset = 12 - localHour
  if (offset < -12) offset += 24
  if (offset > 12) offset -= 24

  return offset
}

/**
 * Accurately determine if a specific date is in DST for a timezone
 * Uses Intl.DateTimeFormat to get the actual timezone abbreviation for the given date
 * This handles all edge cases including historical dates and DST transition days
 *
 * Updated: January 5, 2026 - Fixed inaccurate month-based DST heuristic
 * Updated: January 28, 2026 - Made timezone configurable
 */
export function isDateInDST(
  dateString: string,
  timezone: string = DEFAULT_TIMEZONE
): boolean {
  // Create a date at noon on the target date to avoid edge cases at midnight
  const targetDate = new Date(`${dateString}T12:00:00`)

  // Use Intl.DateTimeFormat to get the actual timezone abbreviation for this date
  // This is the most reliable way to detect DST for a specific date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  })
  const parts = formatter.formatToParts(targetDate)
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || ''

  // DST abbreviations typically contain 'D' (EDT, PDT, CDT, MDT)
  // Standard time abbreviations contain 'S' (EST, PST, CST, MST)
  return tzName.includes('D') || tzName.includes('DT')
}

/**
 * Get the offset in hours for a specific date in a timezone
 * @deprecated Use getTimezoneOffsetHours instead for accurate multi-timezone support
 * @param dateString - Date in YYYY-MM-DD format
 * @param timezone - IANA timezone identifier
 * @returns Offset in hours (e.g., 4 for EDT, 5 for EST, 7 for PDT, 8 for PST)
 */
export function getESTOffsetHours(
  dateString: string,
  timezone: string = DEFAULT_TIMEZONE
): number {
  return getTimezoneOffsetHours(dateString, timezone)
}

/**
 * Convert date boundaries in a timezone to UTC for database queries
 * Properly handles timezone offset using accurate DST detection
 *
 * Updated: January 5, 2026 - Uses accurate DST detection instead of month-based heuristic
 * Updated: January 28, 2026 - Made timezone configurable for multi-timezone support
 *
 * @param dateString - Date in YYYY-MM-DD format
 * @param timezone - IANA timezone identifier (e.g., 'America/New_York', 'America/Los_Angeles')
 */
function getUTCBoundariesForDate(
  dateString: string,
  timezone: string = DEFAULT_TIMEZONE
): { startUTC: string; endUTC: string } {
  // Get the offset in hours for this specific date (accounts for DST)
  const offsetHours = getTimezoneOffsetHours(dateString, timezone)

  // Format offset for ISO string (handle both positive and negative offsets)
  const offsetSign = offsetHours >= 0 ? '-' : '+'
  const absOffset = Math.abs(offsetHours)
  const offsetStr = `${offsetSign}${absOffset.toString().padStart(2, '0')}:00`

  // Start of day in timezone converted to UTC
  const startUTC = new Date(
    `${dateString}T00:00:00.000${offsetStr}`
  ).toISOString()

  // End of day in timezone converted to UTC
  const endUTC = new Date(
    `${dateString}T23:59:59.999${offsetStr}`
  ).toISOString()

  return { startUTC, endUTC }
}

// Legacy alias - exported for backward compatibility
export const getUTCBoundariesForESTDate = (dateString: string) =>
  getUTCBoundariesForDate(dateString, DEFAULT_TIMEZONE)

/**
 * Team Performance Service Class
 * Handles team-wide productivity aggregation and analysis
 */
class TeamPerformanceService {
  private static instance: TeamPerformanceService

  private constructor() {}

  static getInstance(): TeamPerformanceService {
    if (!TeamPerformanceService.instance) {
      TeamPerformanceService.instance = new TeamPerformanceService()
    }
    return TeamPerformanceService.instance
  }

  // ===== OPTIMIZED RPC-BASED METHODS =====

  /**
   * Get all productivity counts for the entire team in a single query
   * PERFORMANCE: Replaces N × 8 individual count queries with 1 query
   * Note: Uses 'any' cast because RPC functions are defined in migration but not in generated types
   */
  private async getTeamProductivityCounts(
    organizationId: string,
    startDate: string,
    endDate: string
  ): Promise<Map<string, ProductivityCountsRow>> {
    const { data, error } = await (supabase as any).rpc(
      'get_team_productivity_counts',
      {
        p_organization_id: organizationId,
        p_start_date: startDate,
        p_end_date: endDate,
      }
    )

    if (error) {
      logger.error(
        '[TeamPerformance] Error fetching team productivity counts:',
        error
      )
      // Return empty map on error - fallback to legacy method if needed
      return new Map()
    }

    // Convert array to Map keyed by user_id for O(1) lookup
    const countsMap = new Map<string, ProductivityCountsRow>()
    const rows = (data || []) as ProductivityCountsRow[]
    for (const row of rows) {
      countsMap.set(row.user_id, row)
    }

    logger.log(
      `[TeamPerformance] Fetched productivity counts for ${countsMap.size} associates in 1 query`
    )
    return countsMap
  }

  /**
   * Get all activity events for the entire team in a single query
   * PERFORMANCE: Replaces N × 9 individual data queries with 1 query
   * Note: Uses 'any' cast because RPC functions are defined in migration but not in generated types
   * Updated: January 4, 2026 - Now uses dynamic activity configuration from activity_source_config
   * New activity types added via Settings → Activity Sources will automatically appear
   */
  private async getTeamActivityEvents(
    organizationId: string,
    startDate: string,
    endDate: string
  ): Promise<Map<string, ActivityEvent[]>> {
    // IMPORTANT: this Supabase project has PostgREST configured with
    // `db-max-rows = 1000`, a HARD server-side cap that the `Range` header
    // cannot exceed (verified via live `curl` on this project's
    // /rest/v1/rpc/...: both `Range: 0-49999` and no Range returned the
    // same 1000-row body with `Content-Range: 0-999/1651`).
    //
    // PostgREST also handles Range differently for RPC calls by method:
    //   POST /rpc/...  → returns rows 0..(PAGE_SIZE-1), Range OFFSET IGNORED
    //                    (probe: Range: 1000-1999 still returned 0-999)
    //   GET  /rpc/...  → honours Range as offset+limit
    //                    (probe: Range: 1000-1999 returned 1000-1650/1651)
    //
    // The events RPC fans out across ~10 activity tables and a busy day
    // for our largest tenant routinely emits >1000 rows. Without paging,
    // the server silently truncates the tail (sorted by user_id) and the
    // affected associates lose every Gantt block while still showing the
    // correct row total — which comes from `get_team_productivity_counts`,
    // a separate RPC that returns 1 row per user and stays well under
    // the cap.
    //
    // Fix: switch to `{ get: true }` so PostgREST routes to GET /rpc/...
    // (where Range paginates), and page through the response. First page
    // uses `count: 'exact'` to learn the total row count from the
    // Content-Range header; if the total exceeds one page, fan out the
    // remaining pages in parallel.
    const PAGE_SIZE = 1000
    const SAFETY_CAP_ROWS = 50000

    const firstPage = await (supabase as any)
      .rpc(
        'get_team_activity_events',
        {
          p_organization_id: organizationId,
          p_start_date: startDate,
          p_end_date: endDate,
        },
        { get: true, count: 'exact' }
      )
      .range(0, PAGE_SIZE - 1)

    if (firstPage.error) {
      logger.error(
        '[TeamPerformance] Error fetching team activity events:',
        firstPage.error
      )
      return new Map()
    }

    const firstRows = (firstPage.data || []) as ActivityEventRow[]
    const totalRows: number | null = firstPage.count ?? null
    const rows: ActivityEventRow[] = [...firstRows]

    // Issue additional pages if there are more rows than one page can return.
    // `count` may be null (e.g. if the server omits the exact count); fall back
    // to "keep paging while the last page was full" in that case.
    const needsMorePages =
      (totalRows !== null && totalRows > firstRows.length) ||
      (totalRows === null && firstRows.length === PAGE_SIZE)

    if (needsMorePages) {
      const effectiveTotal = Math.min(
        totalRows ?? SAFETY_CAP_ROWS,
        SAFETY_CAP_ROWS
      )
      const pageRanges: Array<[number, number]> = []
      for (let from = PAGE_SIZE; from < effectiveTotal; from += PAGE_SIZE) {
        pageRanges.push([
          from,
          Math.min(from + PAGE_SIZE - 1, effectiveTotal - 1),
        ])
      }

      const pages = await Promise.all(
        pageRanges.map(([from, to]) =>
          (supabase as any)
            .rpc(
              'get_team_activity_events',
              {
                p_organization_id: organizationId,
                p_start_date: startDate,
                p_end_date: endDate,
              },
              { get: true }
            )
            .range(from, to)
        )
      )

      for (const page of pages) {
        if (page.error) {
          logger.error(
            '[TeamPerformance] Error fetching activity events page:',
            page.error
          )
          // Continue with the rows we already have rather than blanking the UI.
          continue
        }
        const pageRows = (page.data || []) as ActivityEventRow[]
        rows.push(...pageRows)
      }

      if (totalRows !== null && totalRows > SAFETY_CAP_ROWS) {
        logger.warn(
          `[TeamPerformance] Activity events for window exceeded safety cap (${totalRows} > ${SAFETY_CAP_ROWS}); truncating remaining rows.`
        )
      }
    }

    // Group events by user_id for O(1) lookup
    const eventsMap = new Map<string, ActivityEvent[]>()
    for (const row of rows) {
      if (!eventsMap.has(row.user_id)) {
        eventsMap.set(row.user_id, [])
      }
      // Include new fields from dynamic configuration
      eventsMap.get(row.user_id)!.push({
        type: row.event_type as ActivityType,
        timestamp: row.event_timestamp,
        area: row.area,
        activityLabel: row.activity_label,
        displayColor: row.display_color,
        activityCategory: row.activity_category,
      })
    }

    // Sort each user's events by timestamp
    for (const events of eventsMap.values()) {
      events.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
    }

    logger.log(
      `[TeamPerformance] Fetched ${rows.length} activity events for ${eventsMap.size} associates across ${1 + (totalRows !== null ? Math.ceil(totalRows / PAGE_SIZE) - 1 : firstRows.length === PAGE_SIZE ? 1 : 0)} request(s) (total reported by server: ${totalRows ?? 'unknown'})`
    )
    return eventsMap
  }

  /**
   * Get all shift assignments with full details in a single query
   * PERFORMANCE: Replaces complex nested select with optimized RPC
   * Note: Uses 'any' cast because RPC functions are defined in migration but not in generated types
   */
  private async getShiftAssignmentsWithDetails(
    organizationId: string
  ): Promise<ShiftAssignmentDetailRow[]> {
    const { data, error } = await (supabase as any).rpc(
      'get_shift_assignments_with_details',
      {
        p_organization_id: organizationId,
      }
    )

    if (error) {
      logger.error('[TeamPerformance] Error fetching shift assignments:', error)
      return []
    }

    const rows = (data || []) as ShiftAssignmentDetailRow[]
    logger.log(
      `[TeamPerformance] Fetched ${rows.length} shift assignments in 1 query`
    )
    return rows
  }

  /**
   * Get weekly productivity summary in a single optimized query
   * PERFORMANCE: Replaces 7 × full getTeamProductivity calls with 1 query
   * Note: Uses 'any' cast because RPC functions are defined in migration but not in generated types
   * Updated: January 28, 2026 - Made timezone configurable for multi-timezone support
   *
   * @param organizationId - Organization UUID
   * @param endDate - End date for the weekly summary (defaults to today)
   * @param timezone - IANA timezone identifier (defaults to 'America/New_York')
   */
  async getWeeklyTrendOptimized(
    organizationId: string,
    endDate: Date = new Date(),
    timezone: string = DEFAULT_TIMEZONE
  ): Promise<WeeklyPerformance> {
    const dateString = getDateStringInTimezone(endDate, timezone)

    const { data, error } = await (supabase as any).rpc(
      'get_weekly_productivity_summary',
      {
        p_organization_id: organizationId,
        p_end_date: dateString,
      }
    )

    if (error) {
      logger.error('[TeamPerformance] Error fetching weekly summary:', error)
      // Fallback to legacy method
      return this.getWeeklyTrendLegacy(organizationId, endDate, timezone)
    }

    const rows = (data || []) as WeeklySummaryRow[]
    const trendData: PerformanceTrendData[] = rows.map((row) => ({
      date: row.day_date,
      day: row.day_name,
      completed: Number(row.total_tasks),
      pending: 0,
      efficiency: row.active_associates > 0 ? 100 : 0, // Simplified - full efficiency requires labor standards
    }))

    const totalCompleted = trendData.reduce((sum, d) => sum + d.completed, 0)
    const totalEfficiency = trendData.reduce((sum, d) => sum + d.efficiency, 0)

    // Find best and worst days
    let bestDay = { day: '', value: 0 }
    let worstDay = { day: '', value: Infinity }
    for (const d of trendData) {
      if (d.completed > bestDay.value)
        bestDay = { day: d.day, value: d.completed }
      if (d.completed < worstDay.value && d.completed > 0)
        worstDay = { day: d.day, value: d.completed }
    }

    logger.log(
      `[TeamPerformance] Fetched weekly trend in 1 query (7 days, ${totalCompleted} total tasks)`
    )

    return {
      data: trendData,
      totalCompleted,
      totalPending: 0,
      averageEfficiency:
        trendData.length > 0
          ? Math.round(totalEfficiency / trendData.length)
          : 0,
      bestDay: bestDay.day,
      worstDay: worstDay.value === Infinity ? '' : worstDay.day,
    }
  }

  // ===== NOTE: Legacy individual user query methods have been removed =====
  // The batch RPC methods above (getTeamProductivityCounts, getTeamActivityEvents)
  // replace the old N+1 query pattern for significantly improved performance.
  // Removed methods: getUserProductivityForDate, getUserActivityEvents
  // These were replaced with get_team_productivity_counts and get_team_activity_events RPCs

  /**
   * Build activity blocks from events for Gantt visualization
   * Groups events into work blocks with idle periods between
   * Updated: January 4, 2026 - Now preserves dynamic configuration metadata (label, color, category)
   */
  private buildActivityBlocks(events: ActivityEvent[]): ActivityBlock[] {
    if (events.length === 0) return []

    const blocks: ActivityBlock[] = []
    const IDLE_THRESHOLD_MINUTES = 15 // Gap larger than this = idle/break

    let currentBlockStart = events[0].timestamp
    let currentBlockType: ActivityType = events[0].type
    let currentBlockTasks = 1
    // Preserve dynamic config from first event of the block
    let currentBlockLabel = events[0].activityLabel
    let currentBlockColor = events[0].displayColor
    let currentBlockCategory = events[0].activityCategory

    for (let i = 1; i < events.length; i++) {
      const prevEvent = events[i - 1]
      const currentEvent = events[i]

      const prevTime = new Date(prevEvent.timestamp).getTime()
      const currentTime = new Date(currentEvent.timestamp).getTime()
      const gapMinutes = (currentTime - prevTime) / (1000 * 60)

      // If same type and gap is small, continue the block
      if (
        currentEvent.type === currentBlockType &&
        gapMinutes <= IDLE_THRESHOLD_MINUTES
      ) {
        currentBlockTasks++
      } else {
        // Close current work block
        const blockEndTime = prevEvent.timestamp
        const blockStartMs = new Date(currentBlockStart).getTime()
        const blockEndMs = new Date(blockEndTime).getTime()
        const duration = Math.round((blockEndMs - blockStartMs) / (1000 * 60))

        blocks.push({
          startTime: currentBlockStart,
          endTime: blockEndTime,
          type: currentBlockType,
          taskCount: currentBlockTasks,
          duration: Math.max(duration, 1), // At least 1 minute
          // Include dynamic config metadata
          activityLabel: currentBlockLabel,
          displayColor: currentBlockColor,
          activityCategory: currentBlockCategory,
        })

        // Add idle block if gap is significant
        if (gapMinutes > IDLE_THRESHOLD_MINUTES) {
          blocks.push({
            startTime: blockEndTime,
            endTime: currentEvent.timestamp,
            type: 'idle',
            taskCount: 0,
            duration: Math.round(gapMinutes),
          })
        }

        // Start new block with current event's config
        currentBlockStart = currentEvent.timestamp
        currentBlockType = currentEvent.type
        currentBlockTasks = 1
        currentBlockLabel = currentEvent.activityLabel
        currentBlockColor = currentEvent.displayColor
        currentBlockCategory = currentEvent.activityCategory
      }
    }

    // Close final block
    const lastEvent = events[events.length - 1]
    const blockStartMs = new Date(currentBlockStart).getTime()
    const blockEndMs = new Date(lastEvent.timestamp).getTime()
    const duration = Math.round((blockEndMs - blockStartMs) / (1000 * 60))

    blocks.push({
      startTime: currentBlockStart,
      endTime: lastEvent.timestamp,
      type: currentBlockType,
      taskCount: currentBlockTasks,
      duration: Math.max(duration, 1),
      // Include dynamic config metadata
      activityLabel: currentBlockLabel,
      displayColor: currentBlockColor,
      activityCategory: currentBlockCategory,
    })

    return blocks
  }

  /**
   * Split idle blocks around scheduled breaks to properly separate break time from idle time
   * This ensures breaks are displayed as their own blocks and not counted as idle
   * Updated: January 1, 2026 - Created to fix break/idle overlap issue in Gantt chart
   * Updated: January 28, 2026 - Made timezone configurable for multi-timezone support
   *
   * @param blocks - Activity blocks to process
   * @param dateString - Date in YYYY-MM-DD format
   * @param scheduledBreaks - Array of scheduled breaks
   * @param timezone - IANA timezone identifier for time calculations
   */
  private splitIdleBlocksAroundBreaks(
    blocks: ActivityBlock[],
    dateString: string,
    scheduledBreaks: {
      name: string
      startTime: string
      durationMinutes: number
      isPaid: boolean
    }[],
    timezone: string = DEFAULT_TIMEZONE
  ): ActivityBlock[] {
    if (!scheduledBreaks || scheduledBreaks.length === 0) {
      return blocks
    }

    // Helper to convert time string "HH:MM" to minutes since midnight
    const timeToMinutes = (timeStr: string): number => {
      const [hours, minutes] = timeStr.split(':').map(Number)
      return hours * 60 + (minutes || 0)
    }

    // Helper to get minutes since midnight from ISO timestamp in the configured timezone
    // Note: Activity blocks are built from pre-filtered events on the target date
    const timestampToTzMinutes = (timestamp: string): number => {
      const date = new Date(timestamp)
      const tzTimeStr = date.toLocaleString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })
      const [hours, minutes] = tzTimeStr.split(':').map(Number)
      return hours * 60 + minutes
    }

    // Helper to convert minutes since midnight to ISO timestamp for the given date
    const minutesToTimestamp = (mins: number): string => {
      // Clamp minutes to valid day range (0-1439) to prevent overflow into next day
      const clampedMins = Math.max(0, Math.min(1439, mins))

      // Use accurate offset detection for this specific date and timezone
      const offsetHours = getTimezoneOffsetHours(dateString, timezone)
      const offsetSign = offsetHours >= 0 ? '-' : '+'
      const absOffset = Math.abs(offsetHours)

      const hours = Math.floor(clampedMins / 60)
      const minutes = clampedMins % 60
      const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00.000`
      return new Date(
        `${dateString}T${timeStr}${offsetSign}${absOffset.toString().padStart(2, '0')}:00`
      ).toISOString()
    }

    const resultBlocks: ActivityBlock[] = []

    for (const block of blocks) {
      // Only process idle blocks
      if (block.type !== 'idle') {
        resultBlocks.push(block)
        continue
      }

      const blockStartMin = timestampToTzMinutes(block.startTime)
      const blockEndMin = timestampToTzMinutes(block.endTime)

      // Find all breaks that overlap with this idle block
      // Updated: January 5, 2026 - Handle overnight breaks (e.g., break at 23:30 + 60min = 00:30 next day)
      const overlappingBreaks: {
        startMin: number
        endMin: number
        name: string
      }[] = []

      for (const brk of scheduledBreaks) {
        const breakStartMin = timeToMinutes(brk.startTime)
        const breakEndMin = breakStartMin + brk.durationMinutes

        // Handle overnight breaks: if break extends past midnight
        if (breakEndMin > 1440) {
          // Break spans midnight - check both portions
          // Portion before midnight (breakStartMin to 1440)
          const overlapStart1 = Math.max(blockStartMin, breakStartMin)
          const overlapEnd1 = Math.min(blockEndMin, 1440)
          if (overlapEnd1 > overlapStart1) {
            overlappingBreaks.push({
              startMin: overlapStart1,
              endMin: overlapEnd1,
              name: brk.name,
            })
          }

          // Portion after midnight (0 to breakEndMin - 1440)
          const afterMidnightEnd = breakEndMin - 1440
          const overlapStart2 = Math.max(blockStartMin, 0)
          const overlapEnd2 = Math.min(blockEndMin, afterMidnightEnd)
          if (overlapEnd2 > overlapStart2) {
            overlappingBreaks.push({
              startMin: overlapStart2,
              endMin: overlapEnd2,
              name: brk.name,
            })
          }
        } else {
          // Normal break (same day)
          const overlapStart = Math.max(blockStartMin, breakStartMin)
          const overlapEnd = Math.min(blockEndMin, breakEndMin)

          if (overlapEnd > overlapStart) {
            overlappingBreaks.push({
              startMin: overlapStart,
              endMin: overlapEnd,
              name: brk.name,
            })
          }
        }
      }

      // If no overlapping breaks, keep the idle block as-is
      if (overlappingBreaks.length === 0) {
        resultBlocks.push(block)
        continue
      }

      // Sort overlapping breaks by start time
      overlappingBreaks.sort((a, b) => a.startMin - b.startMin)

      // Split the idle block around the breaks
      let currentPos = blockStartMin

      for (const brk of overlappingBreaks) {
        // Add idle block for time before this break
        if (brk.startMin > currentPos) {
          const idleDuration = brk.startMin - currentPos
          if (idleDuration > 0) {
            resultBlocks.push({
              startTime: minutesToTimestamp(currentPos),
              endTime: minutesToTimestamp(brk.startMin),
              type: 'idle',
              taskCount: 0,
              duration: idleDuration,
            })
          }
        }

        // Add break block
        const breakDuration = brk.endMin - brk.startMin
        if (breakDuration > 0) {
          resultBlocks.push({
            startTime: minutesToTimestamp(brk.startMin),
            endTime: minutesToTimestamp(brk.endMin),
            type: 'break',
            taskCount: 0,
            duration: breakDuration,
          })
        }

        currentPos = brk.endMin
      }

      // Add any remaining idle time after the last break
      if (currentPos < blockEndMin) {
        const remainingDuration = blockEndMin - currentPos
        if (remainingDuration > 0) {
          resultBlocks.push({
            startTime: minutesToTimestamp(currentPos),
            endTime: minutesToTimestamp(blockEndMin),
            type: 'idle',
            taskCount: 0,
            duration: remainingDuration,
          })
        }
      }
    }

    // Sort blocks by start time to maintain proper order
    resultBlocks.sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    )

    return resultBlocks
  }

  /**
   * Build complete daily timeline from activity events
   * Updated: January 1, 2026 - Full day view from 12 AM to 12 PM (midnight to midnight)
   * Updated: January 1, 2026 - Added scheduled shift times and breaks for visual markers
   * Updated: January 1, 2026 - Breaks now properly split from idle blocks (not just overlaid)
   * Updated: January 1, 2026 - Added totalBreakMinutes for accounted time tracking
   * Updated: January 1, 2026 - Fixed break/idle overlap: breaks are now separate blocks in timeline
   * Updated: January 28, 2026 - Made timezone configurable for multi-timezone support
   *
   * @param events - Activity events for the user
   * @param dateString - Date in YYYY-MM-DD format
   * @param scheduledShiftStart - Shift start time (HH:MM)
   * @param scheduledShiftEnd - Shift end time (HH:MM)
   * @param scheduledBreaks - Array of scheduled breaks
   * @param timezone - IANA timezone identifier for date/time calculations
   */
  private buildDailyTimeline(
    events: ActivityEvent[],
    dateString: string,
    scheduledShiftStart?: string,
    scheduledShiftEnd?: string,
    scheduledBreaks?: {
      name: string
      startTime: string
      durationMinutes: number
      isPaid: boolean
    }[],
    timezone: string = DEFAULT_TIMEZONE
  ): DailyTimeline {
    // Full day view from 12 AM (midnight) to 11:59 PM for complete visibility
    const dayStart = `${dateString}T00:00:00.000Z`
    const now = new Date()
    const isToday = dateString === getDateStringInTimezone(now, timezone)
    const dayEnd = isToday ? now.toISOString() : `${dateString}T23:59:59.999Z`

    // CRITICAL FIX: Filter out events that are not on the target date in the configured timezone
    // This prevents cross-day calculation errors that cause massive idle time inflation
    const filteredEvents = events.filter((event) => {
      const date = new Date(event.timestamp)
      const tzDateStr = date
        .toLocaleString('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/') // Returns MM/DD/YYYY
      const tzDate = `${tzDateStr[2]}-${tzDateStr[0]}-${tzDateStr[1]}` // Convert to YYYY-MM-DD

      if (tzDate !== dateString) {
        logger.debug(
          `Filtering out cross-day event ${event.timestamp} (${timezone} date: ${tzDate}) - target date ${dateString}`
        )
        return false
      }
      return true
    })

    // Note: totalBreakMinutes will be calculated from actual break blocks after splitting
    // This ensures we don't double-count time if work happened during scheduled break

    if (filteredEvents.length === 0) {
      // When no events, use scheduled break time as the total break minutes
      const totalBreakMinutes = scheduledBreaks
        ? scheduledBreaks.reduce((sum, brk) => sum + brk.durationMinutes, 0)
        : 0
      return {
        dayStart,
        dayEnd,
        totalWorkMinutes: 0,
        totalIdleMinutes: 0,
        totalBreakMinutes,
        activityBlocks: [],
        events: filteredEvents,
        scheduledShiftStart,
        scheduledShiftEnd,
        scheduledBreaks,
      }
    }

    // Build initial activity blocks (work and idle) using only filtered events
    let activityBlocks = this.buildActivityBlocks(filteredEvents)

    // Helper to convert time string "HH:MM" to minutes since midnight
    const timeToMinutes = (timeStr: string): number => {
      const [hours, minutes] = timeStr.split(':').map(Number)
      return hours * 60 + (minutes || 0)
    }

    // Helper to get minutes since midnight from ISO timestamp in the configured timezone
    // Note: Events are pre-filtered to only include those on the target date
    const timestampToTzMinutes = (timestamp: string): number => {
      const date = new Date(timestamp)
      const tzTimeStr = date.toLocaleString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })
      const [hours, minutes] = tzTimeStr.split(':').map(Number)
      return hours * 60 + minutes
    }

    // Helper to convert minutes since midnight to ISO timestamp for the given date
    const minutesToTimestamp = (mins: number): string => {
      // Clamp minutes to valid day range (0-1439) to prevent overflow into next day
      const clampedMins = Math.max(0, Math.min(1439, mins))

      // Use accurate offset detection for this specific date and timezone
      const offsetHours = getTimezoneOffsetHours(dateString, timezone)
      const offsetSign = offsetHours >= 0 ? '-' : '+'
      const absOffset = Math.abs(offsetHours)

      const hours = Math.floor(clampedMins / 60)
      const minutes = clampedMins % 60
      const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00.000`
      return new Date(
        `${dateString}T${timeStr}${offsetSign}${absOffset.toString().padStart(2, '0')}:00`
      ).toISOString()
    }

    const firstActivity = filteredEvents[0]?.timestamp
    const lastActivity = filteredEvents[filteredEvents.length - 1]?.timestamp

    // Add idle block from shift start to first activity (if there's a gap)
    if (scheduledShiftStart && firstActivity) {
      const shiftStartMinutes = timeToMinutes(scheduledShiftStart)
      const firstActivityMinutes = timestampToTzMinutes(firstActivity)

      if (firstActivityMinutes > shiftStartMinutes) {
        const preShiftIdleDuration = firstActivityMinutes - shiftStartMinutes
        if (preShiftIdleDuration > 0) {
          activityBlocks.unshift({
            startTime: minutesToTimestamp(shiftStartMinutes),
            endTime: firstActivity,
            type: 'idle',
            taskCount: 0,
            duration: preShiftIdleDuration,
          })
        }
      }
    }

    // Add idle block from last activity to shift end (if there's a gap)
    if (scheduledShiftEnd && lastActivity) {
      const shiftEndMinutes = timeToMinutes(scheduledShiftEnd)
      const lastActivityMinutes = timestampToTzMinutes(lastActivity)

      if (shiftEndMinutes > lastActivityMinutes) {
        const postShiftIdleDuration = shiftEndMinutes - lastActivityMinutes
        if (postShiftIdleDuration > 0) {
          activityBlocks.push({
            startTime: lastActivity,
            endTime: minutesToTimestamp(shiftEndMinutes),
            type: 'idle',
            taskCount: 0,
            duration: postShiftIdleDuration,
          })
        }
      }
    }

    // IMPORTANT: Clamp all blocks to shift boundaries to ensure totals match exactly
    // This handles cases where employees clock in early or work late
    // Updated: January 5, 2026 - Added overnight shift support (e.g., 22:00 - 06:00)
    if (scheduledShiftStart && scheduledShiftEnd) {
      const shiftStartMin = timeToMinutes(scheduledShiftStart)
      let shiftEndMin = timeToMinutes(scheduledShiftEnd)

      // Handle overnight shifts: if end time is before start time, add 24 hours to end
      const isOvernightShift = shiftEndMin <= shiftStartMin
      if (isOvernightShift) {
        shiftEndMin += 1440 // Add 24 hours (1440 minutes)
      }

      const shiftDurationMinutes = shiftEndMin - shiftStartMin

      activityBlocks = activityBlocks
        .map((block) => {
          let blockStartMin = timestampToTzMinutes(block.startTime)
          let blockEndMin = timestampToTzMinutes(block.endTime)

          // For overnight shifts, adjust block times that fall after midnight
          // to be relative to the shift start (add 24 hours if before shift start and after midnight)
          if (isOvernightShift) {
            // If block start is before shift start and in the early morning (likely next day)
            if (blockStartMin < shiftStartMin && blockStartMin < 720) {
              // 720 = noon, blocks in AM of overnight shift are next day
              blockStartMin += 1440
            }
            if (blockEndMin < shiftStartMin && blockEndMin < 720) {
              blockEndMin += 1440
            }
            // Handle case where block end wrapped to next day but start didn't
            if (blockEndMin < blockStartMin) {
              blockEndMin += 1440
            }
          }

          // Clamp to shift boundaries
          const clampedStartMin = Math.max(blockStartMin, shiftStartMin)
          const clampedEndMin = Math.min(blockEndMin, shiftEndMin)

          // Issue 3.10: Track if block was truncated at start or end
          const wasTruncatedStart = clampedStartMin > blockStartMin
          const wasTruncatedEnd = clampedEndMin < blockEndMin
          const originalDuration = blockEndMin - blockStartMin

          const isWorkBlock = block.type !== 'idle' && block.type !== 'break'
          const hasActivity = block.taskCount > 0

          // Skip blocks that are entirely outside shift boundaries.
          // EXCEPTION: keep work blocks with actual activity at their original
          // bounds — operators sometimes log work before/after their declared
          // shift (e.g. test admin sessions, off-shift kit work, overtime that
          // wasn't yet captured in shift_assignments). Dropping them here was
          // the root cause of the Activity Timeline rendering as a single
          // grey idle block when 100% of the user's events fell outside the
          // shift window (see Debug/Fix-Activity-Timeline-Missing-Kit-Events).
          // Use > instead of >= to allow same-minute blocks through.
          if (clampedStartMin > clampedEndMin) {
            if (isWorkBlock && hasActivity) {
              const offShiftDuration = Math.max(blockEndMin - blockStartMin, 1)
              return {
                ...block,
                duration: offShiftDuration,
                wasTruncatedStart: false,
                wasTruncatedEnd: false,
                originalDuration,
              }
            }
            return null
          }

          // Recalculate duration based on clamped boundaries
          // IMPORTANT: For work blocks with actual tasks, ensure minimum 1 minute duration
          // This handles cases where all events happen within the same minute
          const rawDuration = clampedEndMin - clampedStartMin
          const clampedDuration =
            isWorkBlock && hasActivity ? Math.max(rawDuration, 1) : rawDuration

          // Skip idle blocks with 0 duration (but keep work blocks with minimum 1 minute)
          if (clampedDuration === 0) {
            return null
          }

          // Convert back to actual minutes for timestamp generation (mod 1440 for overnight)
          const actualStartMin = clampedStartMin % 1440
          const actualEndMin = clampedEndMin % 1440

          return {
            ...block,
            startTime: minutesToTimestamp(actualStartMin),
            endTime: minutesToTimestamp(
              actualEndMin === 0 && clampedEndMin >= 1440 ? 1439 : actualEndMin
            ),
            duration: clampedDuration,
            // Issue 3.10: Include truncation info for UI to optionally display
            ...(wasTruncatedStart || wasTruncatedEnd
              ? {
                  wasTruncatedStart,
                  wasTruncatedEnd,
                  originalDuration,
                }
              : {}),
          }
        })
        .filter((block): block is ActivityBlock => block !== null)

      // Verify total matches shift duration - if not, adjust idle time.
      // NOTE: We only ever ADD idle to fill a gap. We never subtract from idle
      // when current total exceeds shift duration — that case happens when
      // off-shift work blocks were kept (see exception above) and clipping
      // idle would mis-attribute that real work as missing time.
      const currentTotal = activityBlocks.reduce(
        (sum, b) => sum + b.duration,
        0
      )
      const difference = shiftDurationMinutes - currentTotal

      if (difference > 0) {
        // Find the last idle block and adjust its duration
        const lastIdleIdx = activityBlocks
          .map((b, i) => (b.type === 'idle' ? i : -1))
          .filter((i) => i >= 0)
          .pop()
        if (lastIdleIdx !== undefined && lastIdleIdx >= 0) {
          activityBlocks[lastIdleIdx].duration += difference
          // Also update end time to match
          const blockStartMin = timestampToTzMinutes(
            activityBlocks[lastIdleIdx].startTime
          )
          const newEndMin =
            (blockStartMin + activityBlocks[lastIdleIdx].duration) % 1440
          activityBlocks[lastIdleIdx].endTime = minutesToTimestamp(newEndMin)
        } else if (difference > 0) {
          // No idle block found, add one at the end
          const lastBlock = activityBlocks[activityBlocks.length - 1]
          if (lastBlock) {
            const actualShiftEndMin = shiftEndMin % 1440
            activityBlocks.push({
              startTime: lastBlock.endTime,
              endTime: minutesToTimestamp(
                actualShiftEndMin === 0 ? 1439 : actualShiftEndMin
              ),
              type: 'idle',
              taskCount: 0,
              duration: difference,
            })
          }
        }
      }
    }

    // Split idle blocks around scheduled breaks to properly separate break time
    // This ensures breaks appear as their own blocks and don't overlap with idle visually
    if (scheduledBreaks && scheduledBreaks.length > 0) {
      activityBlocks = this.splitIdleBlocksAroundBreaks(
        activityBlocks,
        dateString,
        scheduledBreaks,
        timezone
      )
    }

    // Calculate totals from the properly split blocks
    // IMPORTANT: We calculate totalBreakMinutes from actual break blocks, not scheduled breaks
    // This prevents double-counting when work happens during scheduled break time
    let totalWorkMinutes = 0
    let totalIdleMinutes = 0
    let totalBreakMinutes = 0

    for (const block of activityBlocks) {
      if (block.type === 'idle') {
        totalIdleMinutes += block.duration
      } else if (block.type === 'break') {
        // Count actual break blocks (time when no work happened during scheduled break)
        totalBreakMinutes += block.duration
      } else {
        // Count all work types (not idle, not break)
        totalWorkMinutes += block.duration
      }
    }

    return {
      dayStart,
      dayEnd,
      firstActivity,
      lastActivity,
      totalWorkMinutes,
      totalIdleMinutes,
      totalBreakMinutes,
      activityBlocks,
      events: filteredEvents,
      scheduledShiftStart,
      scheduledShiftEnd,
      scheduledBreaks,
    }
  }

  /**
   * Calculate task breakdown by area/type from activity events
   */
  private calculateTaskBreakdown(
    events: ActivityEvent[]
  ): TaskBreakdownByArea[] {
    const areaMap = new Map<string, TaskBreakdownByArea>()

    for (const event of events) {
      const area = event.area || 'Other'

      if (!areaMap.has(area)) {
        areaMap.set(area, {
          area,
          inbound_scans: 0,
          cart_stows: 0,
          put_aways: 0,
          picking: 0,
          packed: 0,
          shipped: 0,
          final_packed: 0,
          putbacks: 0,
          cycle_counts: 0,
          kit_picking: 0,
          kit_building: 0,
          kit_inspection: 0,
          kit_dock_staging: 0,
          total: 0,
        })
      }

      const breakdown = areaMap.get(area)!

      switch (event.type) {
        case 'inbound_scan':
          breakdown.inbound_scans++
          break
        case 'cart_stow':
          breakdown.cart_stows++
          break
        case 'putaway':
          breakdown.put_aways++
          break
        case 'picking':
          breakdown.picking++
          break
        case 'pack':
          breakdown.packed++
          break
        case 'ship':
          breakdown.shipped++
          break
        case 'final_pack':
          breakdown.final_packed++
          break
        case 'putback':
          breakdown.putbacks++
          break
        case 'cycle_count':
          breakdown.cycle_counts++
          break
        // Kit workflow stages — migration 310
        case 'kit_picking':
          breakdown.kit_picking++
          break
        case 'kit_building':
          breakdown.kit_building++
          break
        case 'kit_inspection':
          breakdown.kit_inspection++
          break
        case 'kit_dock_staging':
          breakdown.kit_dock_staging++
          break
      }

      breakdown.total++
    }

    // Convert to array and sort by total (highest first)
    return Array.from(areaMap.values()).sort((a, b) => b.total - a.total)
  }

  /**
   * Get all associates with their shift assignments and productivity
   * OPTIMIZED: January 3, 2026 - Uses batch RPC queries instead of N+1 queries
   *
   * @param organizationId - Organization UUID
   * @param targetDate - Target date for productivity data (defaults to today)
   * @param filters - Optional filters for departments, areas, search, etc.
   * @param timezone - IANA timezone identifier (defaults to 'America/New_York')
   *                   Should be passed from organization's shift productivity settings
   *
   * @example
   * // With timezone from settings
   * const data = await getTeamProductivity(orgId, date, filters, 'America/Los_Angeles')
   */
  async getTeamProductivity(
    organizationId: string,
    targetDate: Date = new Date(),
    filters?: TeamPerformanceFilters,
    timezone: string = DEFAULT_TIMEZONE
  ): Promise<TeamPerformanceData> {
    const startTime = performance.now()
    const dateString = getDateStringInTimezone(targetDate, timezone)
    const { startUTC, endUTC } = getUTCBoundariesForDate(dateString, timezone)

    logger.log(
      `[TeamPerformance] Starting optimized getTeamProductivity for ${dateString}`
    )

    // PARALLEL FETCH: Get all data in 4 parallel queries instead of N × 17 queries
    const [assignments, laborStandards, productivityCounts, activityEvents] =
      await Promise.all([
        // 1. Get all shift assignments with full details via RPC
        this.getShiftAssignmentsWithDetails(organizationId),

        // 2. Get labor standards (single query)
        (async () => {
          const { data, error } = await (supabase as any)
            .from('labor_standards')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('is_active', true)
          if (error) logger.error('Error fetching labor standards:', error)
          return data || []
        })(),

        // 3. Get all productivity counts via RPC (replaces N × 8 queries)
        this.getTeamProductivityCounts(organizationId, startUTC, endUTC),

        // 4. Get all activity events via RPC (replaces N × 9 queries)
        this.getTeamActivityEvents(organizationId, startUTC, endUTC),
      ])

    const fetchTime = performance.now() - startTime
    logger.log(
      `[TeamPerformance] Parallel data fetch completed in ${fetchTime.toFixed(0)}ms`
    )

    // Process each assignment using the batched data (no additional DB calls)
    const associates: AssociateProductivity[] = []

    for (const assignment of assignments) {
      const userId = assignment.user_id

      // Get productivity counts from batch result (O(1) lookup)
      const counts = productivityCounts.get(userId)
      const productivity = {
        inbound_scans: counts?.inbound_scans ?? 0,
        put_aways: counts?.put_aways ?? 0,
        picking: counts?.picking ?? 0,
        packed: counts?.packed ?? 0,
        shipped: counts?.shipped ?? 0,
        final_packed: counts?.final_packed ?? 0,
        putbacks: counts?.putbacks ?? 0,
        cycle_counts: counts?.cycle_counts ?? 0,
        // Kit workflow stages — migration 310
        kit_picking: counts?.kit_picking ?? 0,
        kit_building: counts?.kit_building ?? 0,
        kit_inspection: counts?.kit_inspection ?? 0,
        kit_dock_staging: counts?.kit_dock_staging ?? 0,
      }

      // Get activity events from batch result (O(1) lookup)
      const userEvents = activityEvents.get(userId) || []

      // Get shift schedule times
      const scheduledShiftStart =
        assignment.shift_start_time ||
        assignment.inline_shift_schedule?.start_time
      const scheduledShiftEnd =
        assignment.shift_end_time || assignment.inline_shift_schedule?.end_time

      // Get scheduled breaks from shift schedule
      let scheduledBreaks: {
        name: string
        startTime: string
        durationMinutes: number
        isPaid: boolean
      }[] = []

      if (
        assignment.breaks &&
        Array.isArray(assignment.breaks) &&
        assignment.breaks.length > 0
      ) {
        // Use the detailed breaks array
        scheduledBreaks = assignment.breaks.map((b: any) => ({
          name: b.break_name || 'Break',
          startTime: b.start_time,
          durationMinutes: b.duration_minutes,
          isPaid: b.is_paid ?? false,
        }))
      } else if (
        assignment.break_start_time &&
        assignment.break_duration_minutes
      ) {
        // Use the single break time fields
        scheduledBreaks = [
          {
            name: 'Lunch Break',
            startTime: assignment.break_start_time,
            durationMinutes: assignment.break_duration_minutes,
            isPaid: false,
          },
        ]
      }

      // Build timeline and task breakdown from events (in-memory processing)
      const timeline = this.buildDailyTimeline(
        userEvents,
        dateString,
        scheduledShiftStart,
        scheduledShiftEnd,
        scheduledBreaks,
        timezone
      )
      const taskBreakdown = this.calculateTaskBreakdown(userEvents)

      // Calculate total tasks
      const totalTasks =
        productivity.inbound_scans +
        productivity.put_aways +
        productivity.picking +
        productivity.packed +
        productivity.shipped +
        productivity.final_packed +
        productivity.putbacks +
        productivity.cycle_counts +
        productivity.kit_picking +
        productivity.kit_building +
        productivity.kit_inspection +
        productivity.kit_dock_staging

      // Calculate efficiency against labor standards
      const efficiency = this.calculateAssociateEfficiency(
        productivity,
        laborStandards
      )

      // Determine status
      const status: 'active' | 'break' | 'offline' =
        assignment.user_status === 'active' && totalTasks > 0
          ? 'active'
          : assignment.user_status === 'active'
            ? 'break'
            : 'offline'

      associates.push({
        user_id: userId,
        user_name: assignment.user_full_name || 'Unknown',
        user_email: assignment.user_email ?? undefined,
        avatar_url: assignment.user_avatar_url ?? undefined,
        phone_number: assignment.user_phone_number ?? undefined,
        hire_date: assignment.user_created_at ?? undefined,
        position_id: assignment.position_id ?? undefined,
        position_title: assignment.position_title ?? undefined,
        position_type: assignment.position_type ?? undefined,
        position_level: assignment.position_level ?? undefined,
        is_supervisory: assignment.is_supervisory ?? undefined,
        working_area_id: assignment.working_area_id ?? undefined,
        working_area_name: assignment.area_name ?? undefined,
        area_code: assignment.area_code ?? undefined,
        department: assignment.department || 'Unassigned',
        status,
        efficiency,
        total_tasks: totalTasks,
        shift_start: assignment.inline_shift_schedule?.start_time,
        shift_end: assignment.inline_shift_schedule?.end_time,
        shift_pattern: assignment.shift_pattern ?? undefined,
        supervisor_id: assignment.supervisor_id ?? undefined,
        supervisor_name: assignment.supervisor_name ?? undefined,
        supervisor_avatar: assignment.supervisor_avatar ?? undefined,
        team_lead_id: assignment.team_lead_id ?? undefined,
        team_lead_name: assignment.team_lead_name ?? undefined,
        team_lead_avatar: assignment.team_lead_avatar ?? undefined,
        assignment_type: assignment.assignment_type ?? undefined,
        productivity_target: assignment.productivity_target
          ? Number(assignment.productivity_target)
          : undefined,
        // Shift schedule information
        schedule_name: assignment.schedule_name ?? undefined,
        scheduled_shift_start: scheduledShiftStart,
        scheduled_shift_end: scheduledShiftEnd,
        scheduled_breaks: scheduledBreaks,
        ...productivity,
        work_queue_tasks: 0,
        taskBreakdown,
        timeline,
      })
    }

    const processTime = performance.now() - startTime
    logger.log(
      `[TeamPerformance] Processed ${associates.length} associates in ${processTime.toFixed(0)}ms`
    )

    // Apply filters
    let filteredAssociates = associates

    if (filters?.departments && filters.departments.length > 0) {
      filteredAssociates = filteredAssociates.filter((a) =>
        filters.departments!.includes(a.department || '')
      )
    }

    if (filters?.areas && filters.areas.length > 0) {
      filteredAssociates = filteredAssociates.filter((a) =>
        filters.areas!.includes(a.working_area_id || '')
      )
    }

    if (filters?.statuses && filters.statuses.length > 0) {
      filteredAssociates = filteredAssociates.filter((a) =>
        filters.statuses!.includes(a.status)
      )
    }

    if (filters?.search) {
      const searchLower = filters.search.toLowerCase()
      filteredAssociates = filteredAssociates.filter(
        (a) =>
          a.user_name.toLowerCase().includes(searchLower) ||
          a.user_email?.toLowerCase().includes(searchLower) ||
          a.position_title?.toLowerCase().includes(searchLower)
      )
    }

    // Sort
    if (filters?.sortBy) {
      filteredAssociates.sort((a, b) => {
        let comparison = 0
        switch (filters.sortBy) {
          case 'name':
            comparison = a.user_name.localeCompare(b.user_name)
            break
          case 'efficiency':
            comparison = b.efficiency - a.efficiency
            break
          case 'tasks':
            comparison = b.total_tasks - a.total_tasks
            break
          case 'department':
            comparison = (a.department || '').localeCompare(b.department || '')
            break
          case 'area':
            comparison = (a.working_area_name || '').localeCompare(
              b.working_area_name || ''
            )
            break
        }
        return filters.sortOrder === 'desc' ? -comparison : comparison
      })
    }

    // Aggregate by department
    const byDepartment = this.aggregateByDepartment(filteredAssociates)

    // Aggregate by area
    const byArea = await this.aggregateByArea(
      filteredAssociates,
      organizationId
    )

    // Calculate summary
    const summary = this.calculateSummary(filteredAssociates)

    // Calculate team stats
    const stats = this.calculateTeamStats(filteredAssociates)

    // Calculate labor standard comparisons
    const laborStandardComparisons = this.calculateLaborStandardComparisons(
      stats,
      laborStandards || []
    )

    return {
      date: dateString,
      summary,
      stats,
      byDepartment,
      byArea,
      associates: filteredAssociates,
      laborStandardComparisons,
    }
  }

  /**
   * Calculate efficiency for an associate based on labor standards
   *
   * Labor Standards (from Settings → Labor Management → Standards tab) are the primary calculation method.
   * Each standard defines a target_value (units per hour) for a specific task_type.
   * Efficiency is calculated as a weighted average across all task types the associate performed.
   *
   * **IMPORTANT: 150% Cap**
   * Individual task efficiencies are capped at 150% to prevent statistical outliers from skewing
   * team metrics. This ensures that exceptionally high performers don't disproportionately
   * inflate team averages and keeps the metric meaningful for team comparisons.
   *
   * Example: If an associate completes 200% of their expected tasks for a given type,
   * that task type's efficiency contribution is still capped at 150%.
   *
   * @param productivity - Object containing counts for each task type
   * @param laborStandards - Array of active labor standards to compare against
   * @returns Weighted average efficiency percentage (0-150, or 100 if no standards configured)
   *
   * @example
   * // Returns efficiency between 0-150%
   * const efficiency = calculateAssociateEfficiency(
   *   { inbound_scans: 100, put_aways: 50, ... },
   *   laborStandards
   * )
   *
   * Updated: December 30, 2025 - Made Labor Standards the sole efficiency calculation method
   * Updated: January 4, 2026 - Added dynamic activity type matching (supports both legacy and activity source types)
   * Updated: January 28, 2026 - Added comprehensive JSDoc explaining 150% cap behavior
   */
  private calculateAssociateEfficiency(
    productivity: {
      inbound_scans: number
      put_aways: number
      picking: number
      packed: number
      shipped: number
      final_packed: number
      putbacks: number
      cycle_counts: number
      kit_picking?: number
      kit_building?: number
      kit_inspection?: number
      kit_dock_staging?: number
    },
    laborStandards: LaborStandard[]
  ): number {
    // Calculate total tasks to check if any work was done
    const totalTasks =
      productivity.inbound_scans +
      productivity.put_aways +
      productivity.picking +
      productivity.packed +
      productivity.shipped +
      productivity.final_packed +
      productivity.putbacks +
      productivity.cycle_counts +
      (productivity.kit_picking ?? 0) +
      (productivity.kit_building ?? 0) +
      (productivity.kit_inspection ?? 0) +
      (productivity.kit_dock_staging ?? 0)

    // If no work done, return 0%
    if (totalTasks === 0) {
      return 0
    }

    // Calculate efficiency based on task-type labor standards
    // Each task maps to multiple possible task_type values for flexible matching
    // This supports both:
    // - Legacy short names (e.g., 'scan', 'pick', 'count')
    // - Activity source types (e.g., 'inbound_scan', 'picking', 'cycle_count')
    // - Custom activity types linked to standards (e.g., 'kit_picking',
    //   'kit_building', 'kit_inspection', 'kit_dock_staging' — migration 310)
    const taskTypes: { aliases: string[]; actual: number }[] = [
      {
        aliases: ['scan', 'inbound_scan', 'scanning'],
        actual: productivity.inbound_scans,
      },
      {
        aliases: ['putaway', 'put_away', 'putaway_confirm'],
        actual: productivity.put_aways,
      },
      {
        aliases: ['pick', 'picking'],
        actual: productivity.picking,
      },
      {
        aliases: ['pack', 'packing', 'final_pack'],
        actual: productivity.packed + productivity.final_packed,
      },
      { aliases: ['ship', 'shipping'], actual: productivity.shipped },
      {
        aliases: ['count', 'cycle_count', 'counting'],
        actual: productivity.cycle_counts,
      },
      { aliases: ['putback', 'put_back'], actual: productivity.putbacks },
      // Kit workflow stages — migration 310. Each has its own labor
      // standard slot so operators see a clean per-stage efficiency in
      // the team-performance comparisons.
      {
        aliases: ['kit_pick', 'kit_picking'],
        actual: productivity.kit_picking ?? 0,
      },
      {
        aliases: ['kit_build', 'kit_building'],
        actual: productivity.kit_building ?? 0,
      },
      {
        aliases: ['kit_inspect', 'kit_inspection'],
        actual: productivity.kit_inspection ?? 0,
      },
      {
        aliases: ['kit_dock_staging', 'kit_dock_stage', 'kit_stage_dock'],
        actual: productivity.kit_dock_staging ?? 0,
      },
    ]

    let totalWeight = 0
    let weightedEfficiency = 0

    for (const task of taskTypes) {
      // Find matching active productivity standard for this task type
      // Checks against all aliases for flexible matching
      const standard = laborStandards.find(
        (s) =>
          s.task_type &&
          task.aliases.includes(s.task_type.toLowerCase()) &&
          s.standard_type === 'productivity' &&
          s.is_active
      )

      if (standard && task.actual > 0 && standard.target_value > 0) {
        // Calculate efficiency for this task type
        // Labor standard target_value is per hour, multiply by 8 for daily expected
        const expectedTotal = standard.target_value * 8
        // Cap individual task efficiency at 150% to prevent outliers from skewing team metrics
        // See JSDoc above for detailed explanation of why this cap exists
        const taskEfficiency = Math.min(
          150,
          (task.actual / expectedTotal) * 100
        )

        // Weight by actual count (tasks with more volume have more impact)
        totalWeight += task.actual
        weightedEfficiency += taskEfficiency * task.actual
      }
    }

    // If no matching labor standards found for any tasks performed
    if (totalWeight === 0) {
      // Return 100% as baseline when no standards are configured
      // This indicates work was done but cannot be measured against standards
      return 100
    }

    return Math.round(weightedEfficiency / totalWeight)
  }

  /**
   * Aggregate associates by department
   */
  private aggregateByDepartment(
    associates: AssociateProductivity[]
  ): DepartmentPerformance[] {
    const departmentMap = new Map<string, AssociateProductivity[]>()

    for (const associate of associates) {
      const dept = associate.department || 'Unassigned'
      if (!departmentMap.has(dept)) {
        departmentMap.set(dept, [])
      }
      departmentMap.get(dept)!.push(associate)
    }

    const departments: DepartmentPerformance[] = []

    for (const [department, deptAssociates] of departmentMap.entries()) {
      const totalTasks = deptAssociates.reduce(
        (sum, a) => sum + a.total_tasks,
        0
      )
      const activeCount = deptAssociates.filter(
        (a) => a.status === 'active'
      ).length
      const avgEfficiency =
        deptAssociates.length > 0
          ? Math.round(
              deptAssociates.reduce((sum, a) => sum + a.efficiency, 0) /
                deptAssociates.length
            )
          : 0

      departments.push({
        department,
        associates: deptAssociates,
        totalAssociates: deptAssociates.length,
        activeAssociates: activeCount,
        totalTasks,
        completedTasks: totalTasks, // Assuming all tasks are completed
        efficiency: avgEfficiency,
        color: getDepartmentColor(department),
      })
    }

    // Sort by total tasks (busiest first)
    return departments.sort((a, b) => b.totalTasks - a.totalTasks)
  }

  /**
   * Aggregate associates by working area
   * Updated: January 1, 2026 - Added break time tracking and accounted time efficiency
   */
  private async aggregateByArea(
    associates: AssociateProductivity[],
    organizationId: string
  ): Promise<AreaPerformance[]> {
    // Get all working areas
    const { data: allAreas, error } = await (supabase as any)
      .from('working_areas')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)

    if (error) {
      logger.error('Error fetching working areas:', error)
      return []
    }

    const areaMap = new Map<string, AssociateProductivity[]>()

    for (const associate of associates) {
      const areaId = associate.working_area_id || 'unassigned'
      if (!areaMap.has(areaId)) {
        areaMap.set(areaId, [])
      }
      areaMap.get(areaId)!.push(associate)
    }

    const areas: AreaPerformance[] = []

    for (const area of (allAreas || []) as WorkingArea[]) {
      const areaAssociates = areaMap.get(area.id) || []
      const totalTasks = areaAssociates.reduce(
        (sum, a) => sum + a.total_tasks,
        0
      )
      const activeCount = areaAssociates.filter(
        (a) => a.status === 'active'
      ).length

      // Calculate WEIGHTED efficiency by tasks (more accurate than simple average)
      // This gives more weight to associates who completed more tasks
      // Formula: sum(individual_efficiency * individual_tasks) / total_tasks
      const weightedEfficiencySum = areaAssociates.reduce(
        (sum, a) => sum + a.efficiency * a.total_tasks,
        0
      )
      const weightedEfficiency =
        totalTasks > 0 ? Math.round(weightedEfficiencySum / totalTasks) : 0

      const utilizationPercent = area.capacity
        ? Math.round((areaAssociates.length / area.capacity) * 100)
        : undefined

      // Calculate AGGREGATED time metrics from associates' timelines (roll-up of actual minutes)
      const totalWorkMinutes = areaAssociates.reduce(
        (sum, a) => sum + (a.timeline?.totalWorkMinutes || 0),
        0
      )
      const totalIdleMinutes = areaAssociates.reduce(
        (sum, a) => sum + (a.timeline?.totalIdleMinutes || 0),
        0
      )

      // Calculate TOTAL BREAK MINUTES - breaks are ACCOUNTED time, not idle
      // This aggregates scheduled break time from all associates in the area
      const totalBreakMinutes = areaAssociates.reduce(
        (sum, a) => sum + (a.timeline?.totalBreakMinutes || 0),
        0
      )

      // Time Efficiency: (total work time / total tracked time) * 100
      // Note: Idle time already excludes break overlap (breaks are not counted as idle)
      const totalTrackedTime = totalWorkMinutes + totalIdleMinutes
      const timeEfficiency =
        totalTrackedTime > 0
          ? Math.round((totalWorkMinutes / totalTrackedTime) * 100)
          : 0

      // Production Efficiency: weighted task efficiency × time efficiency
      // This gives the true output efficiency of the area
      // Example: 80% task efficiency × 75% time efficiency = 60% production efficiency
      const productionEfficiency = Math.round(
        (weightedEfficiency * timeEfficiency) / 100
      )

      // Accounted Time Efficiency: (work + break) / (work + break + idle) * 100
      // This shows how well time is accounted for (scheduled activities vs unplanned idle)
      const totalAccountedTime = totalWorkMinutes + totalBreakMinutes
      const totalAllTime = totalAccountedTime + totalIdleMinutes
      const accountedTimeEfficiency =
        totalAllTime > 0
          ? Math.round((totalAccountedTime / totalAllTime) * 100)
          : 0

      // Aggregate task metrics from all associates in this area
      const taskMetrics = {
        inbound_scans: areaAssociates.reduce(
          (sum, a) => sum + (a.inbound_scans || 0),
          0
        ),
        cart_stows: areaAssociates.reduce(
          (sum, a) => sum + ((a as any).cart_stows || 0),
          0
        ),
        put_aways: areaAssociates.reduce(
          (sum, a) => sum + (a.put_aways || 0),
          0
        ),
        picking: areaAssociates.reduce((sum, a) => sum + (a.picking || 0), 0),
        packed: areaAssociates.reduce((sum, a) => sum + (a.packed || 0), 0),
        shipped: areaAssociates.reduce((sum, a) => sum + (a.shipped || 0), 0),
        final_packed: areaAssociates.reduce(
          (sum, a) => sum + (a.final_packed || 0),
          0
        ),
        putbacks: areaAssociates.reduce((sum, a) => sum + (a.putbacks || 0), 0),
        cycle_counts: areaAssociates.reduce(
          (sum, a) => sum + (a.cycle_counts || 0),
          0
        ),
        // Kit workflow stages — migration 310
        kit_picking: areaAssociates.reduce(
          (sum, a) => sum + (a.kit_picking || 0),
          0
        ),
        kit_building: areaAssociates.reduce(
          (sum, a) => sum + (a.kit_building || 0),
          0
        ),
        kit_inspection: areaAssociates.reduce(
          (sum, a) => sum + (a.kit_inspection || 0),
          0
        ),
        kit_dock_staging: areaAssociates.reduce(
          (sum, a) => sum + (a.kit_dock_staging || 0),
          0
        ),
      }

      // Build aggregate timeline info for area-level visualization
      const allEvents = areaAssociates.flatMap((a) => a.timeline?.events || [])
      const sortedEvents = allEvents.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      const aggregateTimeline =
        sortedEvents.length > 0
          ? {
              firstActivity: sortedEvents[0]?.timestamp,
              lastActivity: sortedEvents[sortedEvents.length - 1]?.timestamp,
              totalEvents: sortedEvents.length,
            }
          : undefined

      areas.push({
        area_id: area.id,
        area_code: area.area_code,
        area_name: area.area_name,
        area_type: area.area_type,
        associates: areaAssociates,
        totalAssociates: areaAssociates.length,
        activeAssociates: activeCount,
        totalTasks,
        completedTasks: totalTasks,
        efficiency: weightedEfficiency, // Now weighted by tasks, not simple average
        capacity: area.capacity,
        utilizationPercent,
        color:
          DEPARTMENT_COLORS[area.area_type] || DEPARTMENT_COLORS['default'],
        totalWorkMinutes,
        totalIdleMinutes,
        totalBreakMinutes,
        timeEfficiency,
        productionEfficiency,
        accountedTimeEfficiency,
        taskMetrics,
        aggregateTimeline,
      })
    }

    // Sort by total tasks (busiest first)
    return areas.sort((a, b) => b.totalTasks - a.totalTasks)
  }

  /**
   * Calculate team summary statistics
   */
  private calculateSummary(
    associates: AssociateProductivity[]
  ): TeamPerformanceSummary {
    const activeAssociates = associates.filter(
      (a) => a.status === 'active'
    ).length
    const onBreakAssociates = associates.filter(
      (a) => a.status === 'break'
    ).length
    const offlineAssociates = associates.filter(
      (a) => a.status === 'offline'
    ).length
    const totalTasksCompleted = associates.reduce(
      (sum, a) => sum + a.total_tasks,
      0
    )
    const averageEfficiency =
      associates.length > 0
        ? Math.round(
            associates.reduce((sum, a) => sum + a.efficiency, 0) /
              associates.length
          )
        : 0

    // Top performers (top 5 by tasks completed)
    const topPerformers = [...associates]
      .sort((a, b) => b.total_tasks - a.total_tasks)
      .slice(0, 5)

    // Needs attention (efficiency below 70% with at least 1 task)
    const needsAttention = associates
      .filter((a) => a.efficiency < 70 && a.total_tasks > 0)
      .sort((a, b) => a.efficiency - b.efficiency)
      .slice(0, 5)

    return {
      totalAssociates: associates.length,
      activeAssociates,
      onBreakAssociates,
      offlineAssociates,
      totalTasksCompleted,
      averageEfficiency,
      topPerformers,
      needsAttention,
    }
  }

  /**
   * Calculate aggregated team stats
   */
  private calculateTeamStats(
    associates: AssociateProductivity[]
  ): TeamProductivityStats {
    const stats: TeamProductivityStats = {
      inbound_scans: 0,
      cart_stows: 0,
      put_aways: 0,
      picking: 0,
      packed: 0,
      shipped: 0,
      final_packed: 0,
      putbacks: 0,
      cycle_counts: 0,
      kit_picking: 0,
      kit_building: 0,
      kit_inspection: 0,
      kit_dock_staging: 0,
      work_queue_tasks: 0,
      total_tasks: 0,
    }

    for (const associate of associates) {
      stats.inbound_scans += associate.inbound_scans
      stats.put_aways += associate.put_aways
      stats.picking += associate.picking
      stats.packed += associate.packed
      stats.shipped += associate.shipped
      stats.final_packed += associate.final_packed
      stats.putbacks += associate.putbacks
      stats.cycle_counts += associate.cycle_counts
      stats.kit_picking += associate.kit_picking ?? 0
      stats.kit_building += associate.kit_building ?? 0
      stats.kit_inspection += associate.kit_inspection ?? 0
      stats.kit_dock_staging += associate.kit_dock_staging ?? 0
      stats.work_queue_tasks += associate.work_queue_tasks
    }

    stats.total_tasks = calculateTotalTasks(stats)

    return stats
  }

  /**
   * Calculate labor standard comparisons
   * Updated: January 4, 2026 - Added dynamic activity type matching
   */
  private calculateLaborStandardComparisons(
    stats: TeamProductivityStats,
    laborStandards: LaborStandard[]
  ): LaborStandardComparison[] {
    const comparisons: LaborStandardComparison[] = []

    // Task mapping with aliases for flexible matching.
    // Supports both legacy short names AND activity source types.
    // Kit workflow stages are first-class entries (migration 310) so each
    // shows up as a distinct comparison row when operators configure a
    // matching labor_standards target.
    const taskMapping: { aliases: string[]; actual: number }[] = [
      {
        aliases: ['scan', 'inbound_scan', 'scanning'],
        actual: stats.inbound_scans,
      },
      {
        aliases: ['putaway', 'put_away', 'putaway_confirm'],
        actual: stats.put_aways,
      },
      { aliases: ['pick', 'picking'], actual: stats.picking },
      {
        aliases: ['pack', 'packing', 'final_pack'],
        actual: stats.packed + stats.final_packed,
      },
      { aliases: ['ship', 'shipping'], actual: stats.shipped },
      {
        aliases: ['count', 'cycle_count', 'counting'],
        actual: stats.cycle_counts,
      },
      { aliases: ['putback', 'put_back'], actual: stats.putbacks || 0 },
      {
        aliases: ['kit_pick', 'kit_picking'],
        actual: stats.kit_picking || 0,
      },
      {
        aliases: ['kit_build', 'kit_building'],
        actual: stats.kit_building || 0,
      },
      {
        aliases: ['kit_inspect', 'kit_inspection'],
        actual: stats.kit_inspection || 0,
      },
      {
        aliases: ['kit_dock_staging', 'kit_dock_stage', 'kit_stage_dock'],
        actual: stats.kit_dock_staging || 0,
      },
    ]

    for (const standard of laborStandards) {
      if (!standard.task_type || standard.standard_type !== 'productivity')
        continue

      // Find matching task using alias-based lookup
      const taskMatch = taskMapping.find((t) =>
        t.aliases.includes(standard.task_type?.toLowerCase() || '')
      )

      if (!taskMatch) continue

      const expectedTotal = standard.target_value * 8 // Assuming 8-hour shift
      const efficiency =
        expectedTotal > 0
          ? Math.round((taskMatch.actual / expectedTotal) * 100)
          : 0

      let status: 'excellent' | 'meets' | 'below' | 'critical'
      if (
        standard.excellent_threshold &&
        efficiency >= standard.excellent_threshold
      ) {
        status = 'excellent'
      } else if (efficiency >= 100) {
        status = 'meets'
      } else if (
        standard.minimum_acceptable &&
        efficiency >= standard.minimum_acceptable
      ) {
        status = 'below'
      } else {
        status = efficiency >= 70 ? 'below' : 'critical'
      }

      comparisons.push({
        standard_id: standard.id,
        standard_name: standard.standard_name,
        task_type: standard.task_type,
        target_value: standard.target_value,
        actual_value: taskMatch.actual,
        unit_of_measure: standard.unit_of_measure,
        efficiency_percentage: efficiency,
        status,
        excellent_threshold: standard.excellent_threshold,
        minimum_acceptable: standard.minimum_acceptable,
      })
    }

    return comparisons
  }

  /**
   * Get aggregated team productivity data for a date range
   * Aggregates all productivity metrics across multiple days for each associate
   * Created: January 1, 2026 - Support for multi-day date range reporting
   * Updated: January 28, 2026 - Made timezone configurable for multi-timezone support
   *
   * @param organizationId - Organization UUID
   * @param startDate - Start date for the range
   * @param endDate - End date for the range
   * @param filters - Optional filters for departments, areas, search, etc.
   * @param timezone - IANA timezone identifier (defaults to 'America/New_York')
   *                   Should be passed from organization's shift productivity settings
   */
  async getTeamProductivityForDateRange(
    organizationId: string,
    startDate: Date,
    endDate: Date,
    filters?: TeamPerformanceFilters,
    timezone: string = DEFAULT_TIMEZONE
  ): Promise<TeamPerformanceData> {
    try {
      const startDateString = getDateStringInTimezone(startDate, timezone)
      const endDateString = getDateStringInTimezone(endDate, timezone)

      logger.log(
        `[TeamPerformance] Fetching date range: ${startDateString} to ${endDateString}`
      )

      // Calculate number of days in range
      const daysDiff =
        Math.ceil(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        ) + 1

      logger.log(`[TeamPerformance] Fetching data for ${daysDiff} days`)

      // Collect data for all days in the range - with error handling for each day
      const dailyDataPromises: Promise<TeamPerformanceData>[] = []
      for (let i = 0; i < daysDiff; i++) {
        const currentDate = new Date(startDate)
        currentDate.setDate(startDate.getDate() + i)
        const dateStr = getDateStringInTimezone(currentDate, timezone)
        logger.log(`[TeamPerformance] Queuing fetch for ${dateStr}`)
        dailyDataPromises.push(
          this.getTeamProductivity(
            organizationId,
            currentDate,
            filters,
            timezone
          ).catch((error) => {
            logger.error(
              `[TeamPerformance] Error fetching data for ${dateStr}:`,
              error
            )
            // Return empty data for failed day rather than failing entire range
            return {
              date: dateStr,
              summary: {
                totalAssociates: 0,
                activeAssociates: 0,
                onBreakAssociates: 0,
                offlineAssociates: 0,
                totalTasksCompleted: 0,
                averageEfficiency: 0,
                topPerformers: [],
                needsAttention: [],
              },
              stats: {
                inbound_scans: 0,
                cart_stows: 0,
                put_aways: 0,
                picking: 0,
                packed: 0,
                shipped: 0,
                final_packed: 0,
                putbacks: 0,
                cycle_counts: 0,
                kit_picking: 0,
                kit_building: 0,
                kit_inspection: 0,
                kit_dock_staging: 0,
                work_queue_tasks: 0,
                total_tasks: 0,
              },
              byDepartment: [],
              byArea: [],
              associates: [],
              laborStandardComparisons: [],
            }
          })
        )
      }

      const allDailyData = await Promise.all(dailyDataPromises)
      logger.log(
        `[TeamPerformance] Successfully fetched ${allDailyData.length} days of data`
      )

      // Aggregate associates across all days
      const associateMap = new Map<string, AssociateProductivity>()

      logger.log(
        `[TeamPerformance] Starting aggregation across ${allDailyData.length} days`
      )

      for (const dayData of allDailyData) {
        if (!dayData || !dayData.associates) {
          logger.warn('[TeamPerformance] Skipping day with no associate data')
          continue
        }

        for (const associate of dayData.associates) {
          if (!associate || !associate.user_id) {
            logger.warn('[TeamPerformance] Skipping associate with no user_id')
            continue
          }

          if (!associateMap.has(associate.user_id)) {
            // First occurrence - clone the associate data
            associateMap.set(associate.user_id, {
              ...associate,
              // Reset timeline data for aggregated view (timeline is day-specific)
              timeline: undefined,
              taskBreakdown: [],
            })
          } else {
            // Aggregate productivity metrics
            const existing = associateMap.get(associate.user_id)!
            existing.inbound_scans += associate.inbound_scans || 0
            existing.put_aways += associate.put_aways || 0
            existing.picking += associate.picking || 0
            existing.packed += associate.packed || 0
            existing.shipped += associate.shipped || 0
            existing.final_packed += associate.final_packed || 0
            existing.putbacks += associate.putbacks || 0
            existing.cycle_counts += associate.cycle_counts || 0
            existing.kit_picking =
              (existing.kit_picking || 0) + (associate.kit_picking || 0)
            existing.kit_building =
              (existing.kit_building || 0) + (associate.kit_building || 0)
            existing.kit_inspection =
              (existing.kit_inspection || 0) + (associate.kit_inspection || 0)
            existing.kit_dock_staging =
              (existing.kit_dock_staging || 0) +
              (associate.kit_dock_staging || 0)
            existing.total_tasks += associate.total_tasks || 0

            // Merge task breakdowns
            if (associate.taskBreakdown && associate.taskBreakdown.length > 0) {
              existing.taskBreakdown = this.mergeTaskBreakdowns(
                existing.taskBreakdown || [],
                associate.taskBreakdown
              )
            }
          }
        }
      }

      logger.log(
        `[TeamPerformance] Aggregated data for ${associateMap.size} associates`
      )

      // Recalculate efficiency for aggregated data using labor standards
      logger.log('[TeamPerformance] Fetching labor standards')
      const { data: laborStandards, error: standardsError } = await (
        supabase as any
      )
        .from('labor_standards')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)

      if (standardsError) {
        logger.error(
          '[TeamPerformance] Error fetching labor standards:',
          standardsError
        )
      }

      // Update efficiency and status for each aggregated associate
      const aggregatedAssociates: AssociateProductivity[] = []
      logger.log(
        '[TeamPerformance] Recalculating efficiency for aggregated associates'
      )

      for (const associate of associateMap.values()) {
        // Recalculate efficiency based on aggregated totals
        associate.efficiency = this.calculateAssociateEfficiency(
          {
            inbound_scans: associate.inbound_scans || 0,
            put_aways: associate.put_aways || 0,
            picking: associate.picking || 0,
            packed: associate.packed || 0,
            shipped: associate.shipped || 0,
            final_packed: associate.final_packed || 0,
            putbacks: associate.putbacks || 0,
            cycle_counts: associate.cycle_counts || 0,
            kit_picking: associate.kit_picking || 0,
            kit_building: associate.kit_building || 0,
            kit_inspection: associate.kit_inspection || 0,
            kit_dock_staging: associate.kit_dock_staging || 0,
          },
          laborStandards || []
        )

        // Status reflects most recent day
        aggregatedAssociates.push(associate)
      }

      // Sort by total tasks descending
      aggregatedAssociates.sort((a, b) => b.total_tasks - a.total_tasks)

      logger.log('[TeamPerformance] Calculating aggregate summary stats')

      // Aggregate summary stats
      const summary = this.calculateSummary(aggregatedAssociates)
      const stats = this.calculateTeamStats(aggregatedAssociates)
      const byDepartment = this.aggregateByDepartment(aggregatedAssociates)
      const byArea = await this.aggregateByArea(
        aggregatedAssociates,
        organizationId
      )
      const laborStandardComparisons = this.calculateLaborStandardComparisons(
        stats,
        laborStandards || []
      )

      logger.log('[TeamPerformance] Date range aggregation complete')

      return {
        date: `${startDateString} to ${endDateString}`,
        summary,
        stats,
        byDepartment,
        byArea,
        associates: aggregatedAssociates,
        laborStandardComparisons,
      }
    } catch (error) {
      logger.error(
        '[TeamPerformance] Error in getTeamProductivityForDateRange:',
        error
      )
      throw error
    }
  }

  /**
   * Merge task breakdowns from multiple days
   * Helper for date range aggregation
   */
  private mergeTaskBreakdowns(
    existing: TaskBreakdownByArea[],
    incoming: TaskBreakdownByArea[]
  ): TaskBreakdownByArea[] {
    const areaMap = new Map<string, TaskBreakdownByArea>()

    // Add existing breakdowns
    for (const breakdown of existing) {
      areaMap.set(breakdown.area, { ...breakdown })
    }

    // Merge incoming breakdowns
    for (const breakdown of incoming) {
      if (!areaMap.has(breakdown.area)) {
        areaMap.set(breakdown.area, { ...breakdown })
      } else {
        const existing = areaMap.get(breakdown.area)!
        existing.inbound_scans += breakdown.inbound_scans
        existing.cart_stows += breakdown.cart_stows
        existing.put_aways += breakdown.put_aways
        existing.picking += breakdown.picking
        existing.packed += breakdown.packed
        existing.shipped += breakdown.shipped
        existing.final_packed += breakdown.final_packed
        existing.putbacks += breakdown.putbacks
        existing.cycle_counts += breakdown.cycle_counts
        existing.kit_picking += breakdown.kit_picking
        existing.kit_building += breakdown.kit_building
        existing.kit_inspection += breakdown.kit_inspection
        existing.kit_dock_staging += breakdown.kit_dock_staging
        existing.total += breakdown.total
      }
    }

    return Array.from(areaMap.values()).sort((a, b) => b.total - a.total)
  }

  /**
   * Get weekly performance trend
   */
  /**
   * Get weekly trend data for the team
   * OPTIMIZED: January 3, 2026 - Uses RPC function instead of 7 × full getTeamProductivity calls
   * Updated: January 28, 2026 - Made timezone configurable for multi-timezone support
   * @deprecated Use getWeeklyTrendOptimized for better performance
   *
   * @param organizationId - Organization UUID
   * @param endDate - End date for the weekly trend (defaults to today)
   * @param timezone - IANA timezone identifier (defaults to 'America/New_York')
   */
  async getWeeklyTrend(
    organizationId: string,
    endDate: Date = new Date(),
    timezone: string = DEFAULT_TIMEZONE
  ): Promise<WeeklyPerformance> {
    // Use the optimized RPC-based method
    return this.getWeeklyTrendOptimized(organizationId, endDate, timezone)
  }

  /**
   * Legacy weekly trend implementation (kept for fallback if RPC fails)
   * Updated: January 28, 2026 - Made timezone configurable for multi-timezone support
   *
   * @param organizationId - Organization UUID
   * @param endDate - End date for the weekly trend (defaults to today)
   * @param timezone - IANA timezone identifier (defaults to 'America/New_York')
   */
  async getWeeklyTrendLegacy(
    organizationId: string,
    endDate: Date = new Date(),
    timezone: string = DEFAULT_TIMEZONE
  ): Promise<WeeklyPerformance> {
    const data: PerformanceTrendData[] = []
    let totalCompleted = 0
    let totalPending = 0
    let totalEfficiency = 0
    let bestDay = { day: '', value: 0 }
    let worstDay = { day: '', value: Infinity }

    // Get data for last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(endDate)
      date.setDate(date.getDate() - i)
      const dateString = getDateStringInTimezone(date, timezone)
      const dayName = getDayName(date, timezone)

      try {
        const dayData = await this.getTeamProductivity(
          organizationId,
          date,
          undefined,
          timezone
        )
        const completed = dayData.stats.total_tasks
        const pending = 0 // We don't track pending in current structure
        const efficiency = dayData.summary.averageEfficiency

        data.push({
          date: dateString,
          day: dayName,
          completed,
          pending,
          efficiency,
        })

        totalCompleted += completed
        totalPending += pending
        totalEfficiency += efficiency

        if (completed > bestDay.value) {
          bestDay = { day: dayName, value: completed }
        }
        if (completed < worstDay.value) {
          worstDay = { day: dayName, value: completed }
        }
      } catch (error) {
        logger.error(`Error getting data for ${dateString}:`, error)
        data.push({
          date: dateString,
          day: dayName,
          completed: 0,
          pending: 0,
          efficiency: 0,
        })
      }
    }

    return {
      data,
      totalCompleted,
      totalPending,
      averageEfficiency:
        data.length > 0 ? Math.round(totalEfficiency / data.length) : 0,
      bestDay: bestDay.day,
      worstDay: worstDay.day,
    }
  }

  /**
   * Public wrapper around the activity events RPC.
   * Returns a Map keyed by user_id of timestamped activity events for the
   * given local date in the supplied timezone. Used by Production Boards
   * (hourly grid) to bucket events client-side without re-running the
   * heavy aggregation pipeline used by getTeamProductivity.
   */
  async getActivityEventsForDate(
    organizationId: string,
    dateString: string,
    timezone: string = DEFAULT_TIMEZONE
  ): Promise<Map<string, ActivityEvent[]>> {
    const { startUTC, endUTC } = getUTCBoundariesForDate(dateString, timezone)
    return this.getTeamActivityEvents(organizationId, startUTC, endUTC)
  }

  /**
   * Public wrapper around the shift assignments RPC.
   * Production Boards needs raw shift start/end times to dim off-shift
   * hour cells without dragging in the full team productivity payload.
   */
  async getShiftAssignmentsRaw(
    organizationId: string
  ): Promise<ShiftAssignmentDetailRow[]> {
    return this.getShiftAssignmentsWithDetails(organizationId)
  }

  /**
   * Get active associates count (currently working)
   */
  async getActiveAssociatesCount(organizationId: string): Promise<number> {
    const { count, error } = await (supabase as any)
      .from('shift_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .eq('is_primary_position', true)

    if (error) {
      logger.error('Error counting active associates:', error)
      return 0
    }

    return count || 0
  }

  /**
   * Get distinct departments from shift positions
   */
  async getDepartments(organizationId: string): Promise<string[]> {
    const { data, error } = await (supabase as any)
      .from('shift_positions')
      .select('department')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .not('department', 'is', null)

    if (error) {
      logger.error('Error fetching departments:', error)
      return []
    }

    const departments = new Set<string>()
    for (const row of (data || []) as any[]) {
      if (row.department) {
        departments.add(row.department)
      }
    }

    return Array.from(departments).sort()
  }

  /**
   * Export team performance data to CSV format
   */
  exportToCsv(data: TeamPerformanceData): string {
    const headers = [
      'Name',
      'Email',
      'Department',
      'Position',
      'Working Area',
      'Status',
      'Efficiency',
      'Inbound Scans',
      'Put Aways',
      'Picking',
      'Packed',
      'Shipped',
      'Final Packed',
      'Putbacks',
      'Cycle Counts',
      'Kit Picking',
      'Kit Building',
      'Kit Inspection',
      'Kit Dock Staging',
      'Total Tasks',
    ]

    const rows = data.associates.map((a) => [
      a.user_name,
      a.user_email || '',
      a.department || '',
      a.position_title || '',
      a.working_area_name || '',
      a.status,
      `${a.efficiency}%`,
      a.inbound_scans,
      a.put_aways,
      a.picking,
      a.packed,
      a.shipped,
      a.final_packed,
      a.putbacks,
      a.cycle_counts,
      a.kit_picking ?? 0,
      a.kit_building ?? 0,
      a.kit_inspection ?? 0,
      a.kit_dock_staging ?? 0,
      a.total_tasks,
    ])

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n')

    return csvContent
  }
}

export default TeamPerformanceService.getInstance()
export { TeamPerformanceService }

// Created and developed by Jai Singh
