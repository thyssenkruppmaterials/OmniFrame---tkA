// Created and developed by Jai Singh
/**
 * Type definitions for the Production Boards feature module.
 *
 * Production Boards is a TV-display-grade hourly grid that mirrors the
 * Daily Completion Tracker but in hour columns. The shapes here are
 * intentionally narrow so the board does not pull the full
 * AssociateProductivity payload from team-performance.service.
 */
import type { AreaColorKey, FallbackSkillId, SkillId } from './skills'

export type { AreaColorKey, SkillId } from './skills'

/**
 * Re-export of the public skill state union so consumers can import
 * everything skills-related from `./types` for consistency with the
 * rest of the feature surface.
 */
export type { SkillState, AssociateSkills } from './skills'

export type HourCellState =
  | 'no-activity'
  | 'below'
  | 'on'
  | 'above'
  | 'off-shift'

/**
 * Per-task-type counts within a single (user, hour) bucket.
 * Keys are activity event types as returned by the get_team_activity_events
 * RPC (e.g. 'inbound_scans', 'put_aways', 'picking', etc.).
 */
export type HourTypeBreakdown = Record<string, number>

export interface HourBucket {
  hour: number // 0..23 in the org timezone
  total: number
  byType: HourTypeBreakdown
}

export interface AssociateRow {
  userId: string
  fullName: string
  email?: string | null
  avatarUrl?: string | null
  positionTitle?: string | null
  workingAreaId?: string | null
  workingAreaName?: string | null
  workingAreaCode?: string | null
  department?: string | null
  /**
   * Local clock minutes (0..1439) for shift start/end if known. Used to dim
   * off-shift hours. May be null for users without an active shift assignment.
   */
  shiftStartMinutes: number | null
  shiftEndMinutes: number | null
  /**
   * Canonical skill id derived from `positionTitle` (or fallback). Always
   * set — `'warehouse'` is the bottom of the lookup ladder.
   */
  primarySkill: SkillId | FallbackSkillId
  /**
   * Canonical skill ids the associate has demonstrated activity for
   * today (derived from per-bucket event types). Always present — empty
   * Set when no events were observed.
   */
  demonstratedSkills: Set<SkillId>
  /**
   * Intrinsic area colour derived deterministically from
   * `workingAreaCode`. The hook may override this with the active-tab
   * area's colour when a specific area is selected — see the
   * "All-Areas vs single-area" rule in `production-boards/lib/skills.ts`.
   */
  areaColor: AreaColorKey
}

/**
 * Per-task-type per-hour targets derived from
 * shift_productivity_settings.target_*_per_hour.
 *
 * Keys mirror the activity event types returned by
 * get_team_activity_events. We sum the targets relevant to the events
 * actually observed in a given hour to derive the comparison value.
 */
export interface HourTargets {
  inbound_scans: number
  put_aways: number
  picking: number
  cycle_counts: number
  /** Fallback target used for activity types without an explicit setting. */
  default: number
}

export type BoardDensity = 'normal' | 'tv'

/**
 * Discrete colour ramp for the Target Achievement KPI. Mirrors the
 * cell-state ramp used by the hourly grid so the strip and the grid read
 * as one signal at a glance.
 */
export type TargetRamp = 'above' | 'on' | 'below' | 'muted'

/**
 * Output of `computeBoardMetrics` — fed to <BoardMetrics /> and consumed
 * unchanged by both normal and TV densities.
 */
export interface BoardMetrics {
  /** Associates with at least one event in the active scope today. */
  activeAssociates: number
  /** Total associates assigned to the active scope (denominator). */
  totalAssigned: number
  /** Sum of all events across the active scope's associates. */
  totalCompletions: number
  /** completions ÷ hours-elapsed (operating-window day or 13h historically). */
  avgPerHour: number
  /** Hours elapsed used to compute `avgPerHour`. Exposed for subtitles. */
  hoursElapsed: number
  /** (avgPerHour ÷ targetPerHour) × 100, capped at 999. */
  targetAchievementPercent: number
  /** Per-hour target driving `targetAchievementPercent`. */
  targetPerHour: number
  /**
   * True when `isToday` AND the org-local time is before the operating
   * window opens (6 AM). The avg / target cards render `—` and a
   * "Building opens at 6 AM" subtitle in this state.
   */
  isPreOpen: boolean
  /** Ramp bucket mirroring the cell-state colours. */
  ramp: TargetRamp
}

// Created and developed by Jai Singh
