// Created and developed by Jai Singh
/**
 * Per-metric "auto-counter" — v16 (2026-05-24).
 *
 * Lets curators turn any SQCDP metric's headline number into an
 * auto-incrementing counter measured from an anchor timestamp. The
 * canonical case is **Safety / TBIR**: "861 Days since last incident"
 * should tick up to 862 automatically when the clock crosses midnight,
 * and snap back to 0 when an incident is recorded.
 *
 * The same shape generalises to any "X since Y" surface — days since
 * last quality escape, hours since last unplanned downtime, weeks since
 * last 5S audit, months since last process update, etc. The mode-enum
 * is the only knob a future caller needs to extend (e.g. a `count_down`
 * variant for a deadline countdown — out of scope for v16).
 *
 * Storage shape (persisted into `sqcdp_metrics.auto_value_config jsonb`
 * via migration 310):
 *
 *   {
 *     "mode": "count_up_days" | "count_up_hours"
 *           | "count_up_weeks" | "count_up_months",
 *     "anchor_at": "2024-01-13T00:00:00Z",
 *     "floor_to_midnight": true
 *   }
 *
 * Empty `{}` = no auto-counter (the renderer keeps reading
 * `metric.currentValue` as before). When `mode` is set without a valid
 * `anchor_at`, `computeAutoValue` returns `null` and the card falls
 * back to its static value — the bag is "soft enabled" so corrupted /
 * partially-saved configs never crash the render.
 *
 * Storage is JSONB and validated client-side (Zod in the editor + the
 * defensive `parseAutoValueConfig` here). We deliberately do NOT add a
 * CHECK constraint on the column so the shape can iterate without an
 * ALTER TABLE — matches the v13 `chart_config` convention in
 * `lib/chart-config.ts`.
 */

export type AutoValueMode =
  | 'count_up_days'
  | 'count_up_hours'
  | 'count_up_weeks'
  | 'count_up_months'

export interface AutoValueConfig {
  /**
   * When set, the card computes its headline value from `anchor_at`
   * rather than reading the static `currentValue`. Absent / unknown
   * values cleanly disable the counter without changing other fields.
   */
  mode?: AutoValueMode
  /**
   * ISO 8601 timestamp of the reset event. For "days since last
   * incident", this is the date/time of the most recent incident. The
   * computed value is `floor((now - anchor) / unitMs)`.
   */
  anchor_at?: string | null
  /**
   * Days-only knob. When `true` (default), counts are calculated
   * against calendar-day boundaries — an incident at 23:55 reads as
   * "1 day" five minutes later, not "0 days". When `false`, the
   * counter uses 24-hour rolling windows. Has no effect on the other
   * three modes.
   */
  floor_to_midnight?: boolean
}

const VALID_MODES: ReadonlySet<AutoValueMode> = new Set<AutoValueMode>([
  'count_up_days',
  'count_up_hours',
  'count_up_weeks',
  'count_up_months',
])

/**
 * Display labels for the editor UI + tooltips. Kept here so other
 * surfaces (sub-metric editor extension, debug logs, etc.) reuse the
 * same wording.
 */
export const AUTO_VALUE_MODE_LABELS: Record<
  AutoValueMode,
  { label: string; unit: string; suffix: string }
> = {
  count_up_days: { label: 'Days', unit: 'day', suffix: ' Days' },
  count_up_hours: { label: 'Hours', unit: 'hour', suffix: ' Hours' },
  count_up_weeks: { label: 'Weeks', unit: 'week', suffix: ' Weeks' },
  count_up_months: { label: 'Months', unit: 'month', suffix: ' Months' },
}

/**
 * Editor convenience — every mode in display order. Drives the
 * <ToggleGroup> in the auto-counter section without forcing the editor
 * to know the enum values.
 */
export const AUTO_VALUE_MODE_OPTIONS: ReadonlyArray<{
  id: AutoValueMode
  label: string
}> = [
  { id: 'count_up_days', label: 'Days' },
  { id: 'count_up_hours', label: 'Hours' },
  { id: 'count_up_weeks', label: 'Weeks' },
  { id: 'count_up_months', label: 'Months' },
]

/**
 * Predicate the renderer + editor lean on. A config is "active" when
 * it has a mode AND a parseable anchor. Anything else collapses back
 * to the static `currentValue` codepath so empty / partial configs
 * never blank a card.
 */
export function isAutoValueActive(
  config: AutoValueConfig | null | undefined
): config is AutoValueConfig & { mode: AutoValueMode; anchor_at: string } {
  if (!config?.mode) return false
  if (!VALID_MODES.has(config.mode)) return false
  if (!config.anchor_at || typeof config.anchor_at !== 'string') return false
  return Number.isFinite(Date.parse(config.anchor_at))
}

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR
const MS_PER_WEEK = 7 * MS_PER_DAY

/**
 * Compute the live counter value from a config + a `now` timestamp.
 * `now` is injected (rather than read inside) so tests stay
 * deterministic and so the renderer can pass a single capture per
 * frame instead of having every cell re-call `Date.now()`.
 *
 * Returns `null` when the config is inactive or malformed — callers
 * should fall back to `currentValue` in that case.
 *
 * Negative deltas (anchor in the future) clamp to 0. This is the
 * right behaviour for a "since" counter: if a curator misconfigures
 * the date, the card reads "0 Days" rather than a negative number.
 */
export function computeAutoValue(
  config: AutoValueConfig | null | undefined,
  now: Date | number = Date.now()
): number | null {
  if (!isAutoValueActive(config)) return null

  const nowMs = typeof now === 'number' ? now : now.getTime()
  const anchorMs = Date.parse(config.anchor_at)

  switch (config.mode) {
    case 'count_up_days': {
      if (config.floor_to_midnight !== false) {
        const nowMid = startOfLocalDay(nowMs)
        const anchorMid = startOfLocalDay(anchorMs)
        return Math.max(0, Math.floor((nowMid - anchorMid) / MS_PER_DAY))
      }
      return Math.max(0, Math.floor((nowMs - anchorMs) / MS_PER_DAY))
    }
    case 'count_up_hours':
      return Math.max(0, Math.floor((nowMs - anchorMs) / MS_PER_HOUR))
    case 'count_up_weeks':
      return Math.max(0, Math.floor((nowMs - anchorMs) / MS_PER_WEEK))
    case 'count_up_months': {
      const a = new Date(anchorMs)
      const n = new Date(nowMs)
      const months =
        (n.getFullYear() - a.getFullYear()) * 12 + (n.getMonth() - a.getMonth())
      // Subtract one if we haven't yet reached the day-of-month of the
      // anchor in the current month — matches the natural "N months
      // since" reading ("3 months ago" only flips on the 13th if the
      // anchor was on the 13th).
      const partial = n.getDate() < a.getDate() ? 1 : 0
      return Math.max(0, months - partial)
    }
  }
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * How often a card with an active counter should re-render, in
 * milliseconds. Picks the coarsest sensible cadence per mode so we
 * don't burn renders on the daily counter ticking 60× per minute.
 *  - hours / days at midnight-floor: 60 s (millisecond-precision isn't
 *    interesting at this scale).
 *  - weeks / months: 5 min (these only change once per week/month;
 *    even 5 min is overkill but cheap insurance against drift).
 */
export function tickIntervalFor(mode: AutoValueMode | undefined): number {
  if (mode === 'count_up_hours') return 60_000
  if (mode === 'count_up_days') return 60_000
  if (mode === 'count_up_weeks') return 5 * 60_000
  if (mode === 'count_up_months') return 5 * 60_000
  return 60_000
}

/**
 * Type-narrow + sanitize an arbitrary JSON value into an
 * `AutoValueConfig`. Mirrors `parseChartConfig` / `parseStyleConfig` —
 * malformed payloads from the DB shouldn't crash the renderer,
 * unrecognized enum values are dropped silently, and the bag collapses
 * to `{}` when the input is non-object.
 */
export function parseAutoValueConfig(raw: unknown): AutoValueConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const out: AutoValueConfig = {}

  if (
    typeof obj.mode === 'string' &&
    VALID_MODES.has(obj.mode as AutoValueMode)
  ) {
    out.mode = obj.mode as AutoValueMode
  }
  if (typeof obj.anchor_at === 'string' && obj.anchor_at) {
    if (Number.isFinite(Date.parse(obj.anchor_at))) {
      out.anchor_at = obj.anchor_at
    }
  }
  if (typeof obj.floor_to_midnight === 'boolean') {
    out.floor_to_midnight = obj.floor_to_midnight
  }

  return out
}

// Created and developed by Jai Singh
