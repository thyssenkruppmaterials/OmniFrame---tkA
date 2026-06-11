// Created and developed by Jai Singh
/**
 * Per-metric chart appearance overrides — v13.
 *
 * v12.x baked the chart aesthetic into <SqcdpChart> directly: monotone
 * curve, hidden Y-axis, horizontal-only grid, dashed accent target line,
 * optional point markers. v13 lets curators layer additional reference
 * lines + tweak the geometry without changing every metric on the board:
 *
 *  - `goal_lines` — N user-defined horizontal reference lines (each with
 *    its own value, label, color, line style, line width). Plays nicely
 *    on top of the existing target line; not a replacement.
 *  - `target_line` — overrides for the built-in target line that has
 *    always rendered when `metric.targetValue != null` (color, style,
 *    width, optional value-bearing label).
 *  - `y_axis` — opt-in tick labels (`show`) plus optional manual `min` /
 *    `max` overrides. `null` on either bound means "auto" (Recharts'
 *    default domain inference).
 *  - `grid` — independent horizontal / vertical toggles (today's chart
 *    renders horizontal only; vertical is opt-in).
 *  - `curve` — `monotone | linear | step` (default monotone). Bar variant
 *    ignores; line / area honour it via Recharts' `type` prop.
 *  - `show_average` — overlays a faint dashed line at the historical mean.
 *  - `highlight_extremes` — bumps the dot radius on the min + max points
 *    (line / area) or paints a 1px outline on the matching bars (bar),
 *    plus renders a "▲ MAX 67.4 / ▼ MIN 12.1" caption row below the
 *    chart so the curator's eye lands on the noteworthy points.
 *
 * Storage: persisted into `sqcdp_metrics.chart_config jsonb` (migration
 * 302). The DB column is NOT NULL DEFAULT '{}'::jsonb so existing rows
 * + `mapRow`'s default fallback both produce the same v12.x render.
 *
 * Pure helpers (`resolveTargetLine`, `resolveGoalLine`, `computeAverage`,
 * `findExtremes`, `STYLE_DASH`) are exercised by `chart-config.test.ts`.
 */

export type LineStyle = 'solid' | 'dashed' | 'dotted'
export type LineWidth = 1 | 2 | 3
export type CurveType = 'monotone' | 'linear' | 'step'

export interface GoalLine {
  /** Stable client-side UUID; preserved across saves so reorder + edits
   * don't clobber row identity. Generated via `crypto.randomUUID()` in
   * the editor (with a Math.random fallback for jsdom — same shape used
   * by `SqcdpSubMetricsEditor`). */
  id: string
  value: number
  label?: string | null
  /** Falls back to `accentColor` when `null` / `undefined`. */
  color_hex?: string | null
  /** Default `'dashed'` so additional goal lines don't fight the data
   * line visually unless the curator opts into solid. */
  style?: LineStyle
  /** Default `1` (matches the existing chrome). */
  width?: LineWidth
}

export interface TargetLineConfig {
  color_hex?: string | null
  style?: LineStyle
  width?: LineWidth
  /** Default `false`; when `true` the chart renders a `Target {value}`
   * label on the right side of the line. */
  show_label?: boolean
}

export interface YAxisConfig {
  /** Default `false` — the period chip on the card carries the time
   * scope; explicit numeric ticks are opt-in. */
  show?: boolean
  /** `null` / `undefined` ⇒ `'auto'` (Recharts default). */
  min?: number | null
  max?: number | null
}

export interface GridConfig {
  /** Default `true` — matches v12.x. */
  show_horizontal?: boolean
  /** Default `false` — vertical grid lines are opt-in. */
  show_vertical?: boolean
  /**
   * v14 — stroke opacity (0–50, integer percent) of the grid lines.
   * Default `6` (matches the v12.x baked-in `strokeOpacity={0.06}`).
   * Clamped to `[0, 50]` at parse time so curator slider values can't
   * make the grid louder than the data line.
   */
  opacity?: number
}

export interface ChartConfig {
  goal_lines?: GoalLine[]
  target_line?: TargetLineConfig
  y_axis?: YAxisConfig
  grid?: GridConfig
  curve?: CurveType
  show_average?: boolean
  highlight_extremes?: boolean
}

/**
 * Defaults applied when a key on `ChartConfig` is missing. The chart
 * renderer + editor both spread these onto the persisted shape so they
 * see fully-populated values everywhere downstream.
 */
export const DEFAULT_CHART_CONFIG: Required<{
  curve: CurveType
  show_average: boolean
  highlight_extremes: boolean
  grid: Required<Omit<GridConfig, 'opacity'>> & { opacity: number }
  y_axis: Required<YAxisConfig>
  target_line: Required<Omit<TargetLineConfig, 'color_hex'>> & {
    color_hex: string | null
  }
}> = {
  curve: 'monotone',
  show_average: false,
  highlight_extremes: false,
  grid: { show_horizontal: true, show_vertical: false, opacity: 6 },
  y_axis: { show: false, min: null, max: null },
  target_line: {
    color_hex: null,
    style: 'dashed',
    width: 1,
    show_label: false,
  },
}

/**
 * Recharts `strokeDasharray` mapping. Solid is `undefined` (omitting the
 * prop renders a continuous stroke). Dashed/dotted patterns picked to
 * read at the small chart heights the SQCDP cards live at (120–180 px).
 */
export const STYLE_DASH: Record<LineStyle, string | undefined> = {
  solid: undefined,
  dashed: '4 4',
  dotted: '2 4',
}

export function resolveTargetLine(
  config: ChartConfig | null | undefined,
  fallbackAccent: string
): { color: string; style: LineStyle; width: LineWidth; showLabel: boolean } {
  const cfg = config?.target_line ?? {}
  return {
    color: cfg.color_hex ?? fallbackAccent,
    style: cfg.style ?? 'dashed',
    width: cfg.width ?? 1,
    showLabel: cfg.show_label ?? false,
  }
}

export function resolveGoalLine(
  goal: GoalLine,
  fallbackAccent: string
): { color: string; style: LineStyle; width: LineWidth } {
  return {
    color: goal.color_hex ?? fallbackAccent,
    style: goal.style ?? 'dashed',
    width: goal.width ?? 1,
  }
}

export function computeAverage(history: { value: number }[]): number | null {
  if (history.length === 0) return null
  const sum = history.reduce((acc, p) => acc + p.value, 0)
  return sum / history.length
}

export function findExtremes(
  history: { value: number; recordedAt: string }[]
): {
  min: { value: number; recordedAt: string } | null
  max: { value: number; recordedAt: string } | null
} {
  if (history.length === 0) return { min: null, max: null }
  let min = history[0]
  let max = history[0]
  for (const p of history) {
    if (p.value < min.value) min = p
    if (p.value > max.value) max = p
  }
  return { min, max }
}

/**
 * Type-narrow + sanitize an arbitrary JSON value into a ChartConfig.
 * Mirrors `parseStyleConfig`'s defensive shape: malformed payloads from
 * the DB shouldn't crash the renderer; unrecognized enum values are
 * dropped silently. Empty / non-object inputs collapse to `{}` (which
 * is functionally equivalent to "use every default").
 */
export function parseChartConfig(raw: unknown): ChartConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const out: ChartConfig = {}

  if (Array.isArray(obj.goal_lines)) {
    const lines: GoalLine[] = []
    for (const entry of obj.goal_lines) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const id = typeof e.id === 'string' && e.id ? e.id : null
      const value =
        typeof e.value === 'number' && Number.isFinite(e.value) ? e.value : null
      if (!id || value === null) continue
      const goal: GoalLine = { id, value }
      if (typeof e.label === 'string') goal.label = e.label
      if (typeof e.color_hex === 'string') goal.color_hex = e.color_hex
      if (e.style === 'solid' || e.style === 'dashed' || e.style === 'dotted') {
        goal.style = e.style
      }
      if (e.width === 1 || e.width === 2 || e.width === 3) goal.width = e.width
      lines.push(goal)
    }
    out.goal_lines = lines
  }

  if (obj.target_line && typeof obj.target_line === 'object') {
    const t = obj.target_line as Record<string, unknown>
    const target: TargetLineConfig = {}
    if (typeof t.color_hex === 'string') target.color_hex = t.color_hex
    if (t.style === 'solid' || t.style === 'dashed' || t.style === 'dotted') {
      target.style = t.style
    }
    if (t.width === 1 || t.width === 2 || t.width === 3) target.width = t.width
    if (typeof t.show_label === 'boolean') target.show_label = t.show_label
    out.target_line = target
  }

  if (obj.y_axis && typeof obj.y_axis === 'object') {
    const y = obj.y_axis as Record<string, unknown>
    const yAxis: YAxisConfig = {}
    if (typeof y.show === 'boolean') yAxis.show = y.show
    if (typeof y.min === 'number' && Number.isFinite(y.min)) yAxis.min = y.min
    else if (y.min === null) yAxis.min = null
    if (typeof y.max === 'number' && Number.isFinite(y.max)) yAxis.max = y.max
    else if (y.max === null) yAxis.max = null
    out.y_axis = yAxis
  }

  if (obj.grid && typeof obj.grid === 'object') {
    const g = obj.grid as Record<string, unknown>
    const grid: GridConfig = {}
    if (typeof g.show_horizontal === 'boolean') {
      grid.show_horizontal = g.show_horizontal
    }
    if (typeof g.show_vertical === 'boolean') {
      grid.show_vertical = g.show_vertical
    }
    if (typeof g.opacity === 'number' && Number.isFinite(g.opacity)) {
      const clamped = Math.round(Math.max(0, Math.min(50, g.opacity)))
      grid.opacity = clamped
    }
    out.grid = grid
  }

  if (
    obj.curve === 'monotone' ||
    obj.curve === 'linear' ||
    obj.curve === 'step'
  ) {
    out.curve = obj.curve
  }
  if (typeof obj.show_average === 'boolean') out.show_average = obj.show_average
  if (typeof obj.highlight_extremes === 'boolean') {
    out.highlight_extremes = obj.highlight_extremes
  }

  return out
}

// Created and developed by Jai Singh
