// Created and developed by Jai Singh
/**
 * Pure helpers for the Hourly Completion Tracker.
 *
 * These functions are framework-free so they can be unit-tested without
 * jsdom or Supabase. The board hook composes them on top of the data
 * returned by TeamPerformanceService.getActivityEventsForDate.
 */
import { mapEventTypeToSkill, type SkillId } from './skills'
import type {
  AssociateRow,
  BoardMetrics,
  HourBucket,
  HourCellState,
  HourTargets,
  HourTypeBreakdown,
  TargetRamp,
} from './types'

/** Number of hour columns rendered (one per hour of day in org tz). */
export const HOURS_IN_DAY = 24

/**
 * Operating window for the production-boards floor in the org timezone.
 *
 * The building opens at 6:00 AM and closes at 7:00 PM. We model the window
 * as a half-open interval `[BOARD_OPENING_HOUR, BOARD_CLOSING_HOUR)` so the
 * 6 PM hour (events 18:00–18:59:59 local) is the last bucket that ends at
 * 19:00. The Hourly Completion Tracker renders one column per hour in the
 * window — 13 columns total.
 *
 * If a board is ever opened in a different building / different operating
 * hours, override these constants here. They are deliberately a single
 * source of truth for the feature module.
 */
export const BOARD_OPENING_HOUR = 6
export const BOARD_CLOSING_HOUR = 19
export const BOARD_HOURS: readonly number[] = Array.from(
  { length: BOARD_CLOSING_HOUR - BOARD_OPENING_HOUR },
  (_, i) => BOARD_OPENING_HOUR + i
)

/** True when the supplied 0..23 hour-of-day falls inside the board window. */
export function isWithinBoardHours(hour: number): boolean {
  return hour >= BOARD_OPENING_HOUR && hour < BOARD_CLOSING_HOUR
}

/**
 * Map an event_type string from the activity events RPC to the per-hour
 * target field on shift_productivity_settings. Activity types that do not
 * have a dedicated setting fall back to `default`.
 */
export function targetKeyForEventType(eventType: string): keyof HourTargets {
  const t = eventType.toLowerCase()
  if (t.startsWith('inbound')) return 'inbound_scans'
  if (t.startsWith('putaway') || t === 'put_aways') return 'put_aways'
  // `kit_picking` borrows the picking target; `kit_building` /
  // `kit_inspection` / `kit_dock_staging` fall back to `default` until
  // operators configure dedicated per-hour targets.
  if (t === 'kit_picking') return 'picking'
  if (t.startsWith('pick') || t === 'picking') return 'picking'
  if (t.startsWith('cycle')) return 'cycle_counts'
  return 'default'
}

/**
 * Get the local hour-of-day (0..23) for an ISO timestamp in the supplied
 * IANA timezone. Uses Intl.DateTimeFormat — no date-fns-tz dependency.
 */
export function getLocalHour(isoTimestamp: string, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  })
  const parts = formatter.formatToParts(new Date(isoTimestamp))
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0'
  // 'h12: false' can return '24' for midnight in some Node builds — coerce.
  const h = Number(hourStr)
  if (!Number.isFinite(h)) return 0
  return h === 24 ? 0 : h
}

/**
 * Get the current local hour (0..23) in the supplied timezone.
 */
export function getCurrentHour(
  timezone: string,
  now: Date = new Date()
): number {
  return getLocalHour(now.toISOString(), timezone)
}

/**
 * Current local hour clamped to the operating window — returns the hour
 * (6..18) when the building is open, or `null` when it is closed (before
 * 6 AM or after 7 PM org-local). Drives the today/current-hour highlight
 * on the grid header and the "Building closed" footnote.
 */
export function getCurrentBoardHour(
  timezone: string,
  now: Date = new Date()
): number | null {
  const h = getCurrentHour(timezone, now)
  return isWithinBoardHours(h) ? h : null
}

/**
 * Bucket a flat array of activity events (or a Map<userId, events[]>) into
 * a per-user, per-hour grid keyed by event_type. Returns
 *   Map<userId, Map<hour, { eventType: count }>>
 *
 * The events Map is the shape returned by
 * TeamPerformanceService.getActivityEventsForDate.
 */
export function bucketEventsByHour(
  events:
    | Map<string, Array<{ type: string; timestamp: string }>>
    | Array<{ userId: string; type: string; timestamp: string }>,
  timezone: string
): Map<string, Map<number, HourTypeBreakdown>> {
  const out = new Map<string, Map<number, HourTypeBreakdown>>()

  const pushOne = (userId: string, type: string, timestamp: string): void => {
    const hour = getLocalHour(timestamp, timezone)
    // Drop off-hours events on the floor — they would otherwise pollute
    // `userTotal` / KPI strip totals on a board that only ever renders
    // operating-hours columns.
    if (!isWithinBoardHours(hour)) return
    let perUser = out.get(userId)
    if (!perUser) {
      perUser = new Map<number, HourTypeBreakdown>()
      out.set(userId, perUser)
    }
    let bucket = perUser.get(hour)
    if (!bucket) {
      bucket = {}
      perUser.set(hour, bucket)
    }
    bucket[type] = (bucket[type] ?? 0) + 1
  }

  if (Array.isArray(events)) {
    for (const ev of events) pushOne(ev.userId, ev.type, ev.timestamp)
  } else {
    for (const [userId, list] of events.entries()) {
      for (const ev of list) pushOne(userId, ev.type, ev.timestamp)
    }
  }

  return out
}

/**
 * Build a HourBucket summary for a single (user, hour) cell from a raw
 * { eventType: count } breakdown.
 */
export function summariseBucket(
  hour: number,
  byType: HourTypeBreakdown
): HourBucket {
  let total = 0
  for (const k in byType) total += byType[k] ?? 0
  return { hour, total, byType }
}

/**
 * Walk the bucketed events for a single user and collect every canonical
 * skill id with at least one event today. Used by `useHourlyProductivity`
 * to build the per-row `demonstratedSkills` for the AssociateIdCard.
 *
 * O(hours × event-types-per-hour). Both dimensions are tiny (≤ 24 hours
 * and ≤ ~10 event types) so this is effectively O(1) per associate.
 */
export function collectDemonstratedSkills(
  perUserBuckets: Map<number, HourBucket> | undefined
): Set<SkillId> {
  const out = new Set<SkillId>()
  if (!perUserBuckets) return out
  for (const bucket of perUserBuckets.values()) {
    for (const eventType in bucket.byType) {
      const count = bucket.byType[eventType] ?? 0
      if (count <= 0) continue
      const skill = mapEventTypeToSkill(eventType)
      if (skill) out.add(skill)
    }
  }
  return out
}

/**
 * Pick the cell visual state for a per-hour bucket.
 *
 * - If `hasShift` is false → 'off-shift' (rendered very subtly).
 * - If count is 0 → 'no-activity'.
 * - Otherwise compare count to the per-hour target for the event mix:
 *     <= 50% of target → 'below'
 *     50–100% of target → 'on'
 *     > 100% of target → 'above'
 *
 * The caller decides the effective target (we keep this function pure).
 */
export function getHourCellState({
  count,
  target,
  hasShift,
}: {
  count: number
  target: number
  hasShift: boolean
}): HourCellState {
  if (!hasShift) return 'off-shift'
  if (count <= 0) return 'no-activity'
  if (target <= 0) {
    // Without a meaningful target we can't classify above/on/below — treat
    // any positive activity as 'on'.
    return 'on'
  }
  const ratio = count / target
  if (ratio < 0.5) return 'below'
  if (ratio <= 1) return 'on'
  return 'above'
}

/**
 * Compute the effective hourly target for a given (user, hour) bucket by
 * summing the per-task-type targets from settings weighted by the share of
 * each task type observed in the hour. Buckets with zero activity fall
 * back to the `default` target.
 */
export function effectiveTargetForBucket(
  byType: HourTypeBreakdown,
  targets: HourTargets
): number {
  const types = Object.keys(byType)
  if (types.length === 0) return targets.default
  // If only one type, return its specific target — this matches an
  // operator's intuition ("how many picks did I do this hour vs the picks
  // target").
  if (types.length === 1) {
    const t = targetKeyForEventType(types[0])
    return targets[t] || targets.default || 0
  }
  // Mixed bucket — weight each task target by its share. This lets the
  // colour ramp respect mixed work without unfairly punishing variety.
  let total = 0
  let weighted = 0
  for (const type of types) {
    const c = byType[type] ?? 0
    if (c <= 0) continue
    total += c
    const tk = targetKeyForEventType(type)
    weighted += c * (targets[tk] || targets.default || 0)
  }
  if (total === 0) return targets.default
  return Math.max(1, Math.round(weighted / total))
}

/**
 * Format an hour-of-day (0..23) like "7a", "12p", "1p", "11p". Used in the
 * hour column headers of the board.
 */
export function formatHour(h: number): string {
  const hour = ((h % 24) + 24) % 24
  if (hour === 0) return '12a'
  if (hour === 12) return '12p'
  if (hour < 12) return `${hour}a`
  return `${hour - 12}p`
}

/**
 * Produce a stable list of every hour [0..23] for the column header.
 */
export function getAllHours(): number[] {
  return Array.from({ length: HOURS_IN_DAY }, (_, i) => i)
}

/**
 * Parse a "HH:MM" or "HH:MM:SS" shift schedule clock string into local
 * minutes since midnight. Returns null on invalid input.
 */
export function parseClockTime(
  value: string | null | undefined
): number | null {
  if (!value) return null
  const m = /^([0-2]?\d):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h > 23) return null
  return h * 60 + mm
}

/**
 * Decide whether a given hour-of-day falls inside a shift window expressed
 * in local minutes since midnight. Handles overnight shifts (end < start)
 * by wrapping past midnight.
 */
export function isHourWithinShift(
  hour: number,
  shiftStartMinutes: number | null,
  shiftEndMinutes: number | null
): boolean {
  // No shift assignment — treat every hour as on-shift so the board still
  // shows activity for unassigned associates.
  if (shiftStartMinutes == null || shiftEndMinutes == null) return true
  const cellStart = hour * 60
  const cellEnd = cellStart + 60
  if (shiftEndMinutes >= shiftStartMinutes) {
    // Same-day shift — overlap iff [cellStart, cellEnd) ∩ [start, end) ≠ ∅
    return cellStart < shiftEndMinutes && cellEnd > shiftStartMinutes
  }
  // Overnight shift — split into [start, 24:00) ∪ [00:00, end).
  return (
    (cellStart < 24 * 60 && cellEnd > shiftStartMinutes) ||
    (cellStart < shiftEndMinutes && cellEnd > 0)
  )
}

/**
 * Hours-elapsed *inside the operating window* in the org timezone.
 *
 * Semantics:
 * - Historical days (`!isToday`) → `BOARD_HOURS.length` (the full 13-hour
 *   operating window). The KPI strip then shows realised metrics across
 *   the full day.
 * - Today before 6:00 AM → `0`. Callers should treat this as "pre-open"
 *   and render `—` for avg/target instead of dividing by zero.
 * - Today during the window → `(now − 6:00 AM in tz) / 60`, clamped to
 *   `[5/60, BOARD_HOURS.length]`. The 5-minute floor preserves the
 *   existing protection against avg/hour exploding right after open.
 * - Today after 7:00 PM → `BOARD_HOURS.length` (clamped). Avg uses the
 *   full operating day.
 */
export function computeHoursElapsed({
  isToday,
  timezone,
  now = new Date(),
}: {
  isToday: boolean
  timezone: string
  now?: Date
}): number {
  if (!isToday) return BOARD_HOURS.length
  // Format as 24-hour clock to read hours + minutes in the org tz.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (type: 'hour' | 'minute' | 'second'): number => {
    const part = parts.find((p) => p.type === type)
    const n = part ? Number(part.value) : 0
    return Number.isFinite(n) ? n : 0
  }
  const h = get('hour')
  const m = get('minute')
  const s = get('second')
  const minutesSinceMidnight = (h % 24) * 60 + m + s / 60
  const minutesSinceOpen = minutesSinceMidnight - BOARD_OPENING_HOUR * 60
  // Strictly before open → 0 (callers treat as "pre-open"). At exactly
  // 6:00:00 AM we fall through to the clamp so the avg/hour denominator
  // never hits literal 0 once the day has technically begun.
  if (minutesSinceOpen < 0) return 0
  const hoursOpen = minutesSinceOpen / 60
  // Floor at 5 min so a freshly-opened building doesn't push avg/hour
  // into infinity; clamp at the close so post-7pm always reports a
  // full operating day.
  return Math.min(BOARD_HOURS.length, Math.max(5 / 60, hoursOpen))
}

/**
 * Bucket a target-achievement percentage to the same colour ramp the
 * grid uses (>= 100% above, 50–100 on, 25–50 below, < 25 muted).
 */
export function rampForTargetAchievement(percent: number): TargetRamp {
  if (percent >= 100) return 'above'
  if (percent >= 50) return 'on'
  if (percent >= 25) return 'below'
  return 'muted'
}

/**
 * Pure: compute the four KPI cards' raw values for a given scope.
 *
 * Inputs are all already-filtered to the active tab (so when a specific
 * working area is selected, `associates` and `hourBuckets` are already
 * scoped to that area's roster).
 *
 * The default per-hour target is `hourTargets.default` — operators can
 * tighten this by configuring `target_*_per_hour` on
 * `shift_productivity_settings`. We do NOT weight by mix here because the
 * KPI strip is a coarse "are we hitting our average" signal, not the
 * fine-grained per-cell ramp.
 */
export function computeBoardMetrics({
  associates,
  hourBuckets,
  hourTargets,
  isToday,
  timezone,
  now,
}: {
  associates: AssociateRow[]
  hourBuckets: Map<string, Map<number, HourBucket>>
  hourTargets: HourTargets
  isToday: boolean
  timezone: string
  now?: Date
}): BoardMetrics {
  const totalAssigned = associates.length
  let totalCompletions = 0
  let activeAssociates = 0
  for (const a of associates) {
    const perUser = hourBuckets.get(a.userId)
    if (!perUser || perUser.size === 0) continue
    let userTotal = 0
    for (const b of perUser.values()) userTotal += b.total
    if (userTotal > 0) {
      activeAssociates += 1
      totalCompletions += userTotal
    }
  }
  const hoursElapsed = computeHoursElapsed({ isToday, timezone, now })
  const isPreOpen = isToday && hoursElapsed === 0
  const avgPerHour =
    hoursElapsed > 0 ? Math.round(totalCompletions / hoursElapsed) : 0
  const targetPerHour = Math.max(0, hourTargets.default || 0)
  const rawAchievement =
    !isPreOpen && targetPerHour > 0 ? (avgPerHour / targetPerHour) * 100 : 0
  const targetAchievementPercent = Math.min(
    999,
    Math.max(0, Math.round(rawAchievement))
  )
  return {
    activeAssociates,
    totalAssigned,
    totalCompletions,
    avgPerHour,
    hoursElapsed,
    targetAchievementPercent,
    targetPerHour,
    isPreOpen,
    ramp: isPreOpen
      ? 'muted'
      : rampForTargetAchievement(targetAchievementPercent),
  }
}

// Created and developed by Jai Singh
