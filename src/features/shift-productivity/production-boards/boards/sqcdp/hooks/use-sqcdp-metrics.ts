// Created and developed by Jai Singh
/**
 * SQCDP Metrics — TanStack Query hook with optimistic CRUD against
 * `sqcdp_metrics` + `sqcdp_metric_history`.
 *
 * Polling cadence: 60 s, gated on `document.visibilityState === 'visible'`
 * (matches the canonical hourly-board pattern in
 * `boards/hourly/hooks/use-hourly-productivity.ts`).
 *
 * Historical-point handling: every call to `updateMetric` that actually
 * changes `current_value` writes a row into `sqcdp_metric_history` so the
 * sparkline stays accurate. The history insert is best-effort — a failure
 * does NOT roll back the parent metric update (these are independent rows
 * from the user's perspective).
 *
 * Auth + org scoping: RLS policies in migration 295 enforce org match and
 * `production_boards:edit` for mutations, so we don't gate at the hook
 * layer. The frontend hides the editor controls behind `useCanEditBoards`.
 *
 * NOTE on column naming: the spec drafted `position` for grid order; the
 * applied migration uses `display_order` (consistent with other tables).
 * We expose `displayOrder` on the row interface and translate.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { parseAutoValueConfig, type AutoValueConfig } from '../lib/auto-value'
import {
  BUILTIN_CATEGORIES,
  defaultColorFor,
  type SqcdpCategoryDef,
  type SqcdpCategoryId,
} from '../lib/categories'
import { parseChartConfig, type ChartConfig } from '../lib/chart-config'
import type { ValueFormat } from '../lib/format'
import { parseStyleConfig, type StyleConfig } from '../lib/style-config'

export type MetricTrendPeriod =
  | 'rolling_4_weeks'
  | 'rolling_30_days'
  | 'last_6_months'
  | 'ytd'
  | 'custom'

export type SqcdpChartType = 'line' | 'area' | 'bar'

/**
 * v12 stacked sub-metric. When `metric.subMetrics.length >= 1` the card
 * abandons the single big-number layout and renders each sub-metric as a
 * labeled value pair (matching the thyssenkrupp scorecard pattern: e.g.
 * Maintenance with "Open Work Orders: 8" stacked above "Machine Down: 6").
 *
 * `id` is a stable client-side UUID assigned at create time so reorder /
 * inline edits don't lose row identity across saves.
 */
export interface SubMetric {
  id: string
  title: string
  value: number | null
  value_format: ValueFormat
  unit?: string | null
  subtitle?: string | null
  decimal_places?: number | null
}

export type SubMetrics = SubMetric[]

const VALID_VALUE_FORMATS: readonly ValueFormat[] = [
  'number',
  'percent',
  'currency',
  'duration',
  'text',
] as const

function parseSubMetrics(raw: unknown): SubMetric[] {
  if (!Array.isArray(raw)) return []
  const out: SubMetric[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const id = typeof obj.id === 'string' && obj.id ? obj.id : null
    const title = typeof obj.title === 'string' ? obj.title : null
    if (!id || title === null) continue
    const value =
      typeof obj.value === 'number' && Number.isFinite(obj.value)
        ? obj.value
        : obj.value === null
          ? null
          : null
    const fmt =
      typeof obj.value_format === 'string' &&
      (VALID_VALUE_FORMATS as readonly string[]).includes(obj.value_format)
        ? (obj.value_format as ValueFormat)
        : 'number'
    out.push({
      id,
      title,
      value,
      value_format: fmt,
      unit: typeof obj.unit === 'string' ? obj.unit : null,
      subtitle: typeof obj.subtitle === 'string' ? obj.subtitle : null,
      decimal_places:
        typeof obj.decimal_places === 'number' &&
        Number.isInteger(obj.decimal_places) &&
        obj.decimal_places >= 0 &&
        obj.decimal_places <= 4
          ? obj.decimal_places
          : null,
    })
  }
  return out
}

/**
 * Window the per-card history is sliced to before it reaches `<SqcdpChart>`.
 * Spec: "last 6 months" — 180 days approximates that calendar-agnostic and
 * is cheap to compute client-side. We slice on the client (rather than
 * constraining the SELECT) so the existing Supabase generated typings keep
 * working without a hand-rolled RPC; the row volumes are tiny (≤ 1 sample
 * per metric per update event).
 */
export const SQCDP_HISTORY_WINDOW_DAYS = 180

export interface SqcdpMetricRow {
  id: string
  organizationId: string
  category: SqcdpCategoryId
  displayOrder: number
  title: string
  subtitle: string | null
  valueFormat: ValueFormat
  currentValue: number | null
  targetValue: number | null
  unit: string | null
  trendPeriod: MetricTrendPeriod
  colorHex: string | null
  accentHex: string | null
  chartType: SqcdpChartType
  /**
   * When true, the historical chart renders dot markers at each data point.
   * Conceptually n/a for `chart_type = 'bar'` (the bars themselves are the
   * markers); the chart silently skips marker rendering on bars. Migration
   * 297 added the column with `DEFAULT false`.
   */
  showMarkers: boolean
  isVisible: boolean
  notes: string | null
  /** v12 — per-input typography overrides (font / size / weight / transform). */
  styleConfig: StyleConfig
  /** v12 — when non-empty, the card renders the stacked sub-metric layout. */
  subMetrics: SubMetric[]
  /** v12 — small prefix prepended to the formatted primary value (e.g. `$`, `~`). */
  valuePrefix: string | null
  /** v12 — small suffix appended after the formatted primary value (e.g. ` ppm`). */
  valueSuffix: string | null
  /** v12 — explicit override of fraction digits for number / percent. 0–4 or null. */
  decimalPlaces: number | null
  /** v12 — polarity flag. When true, ↑ paints red and ↓ paints green. */
  lowerIsBetter: boolean
  /**
   * v12.1 — per-metric toggle for the auto-computed trend arrow + the
   * "vs {previous}" comparison subtext. When false, both are suppressed
   * even if 2+ history points exist. Default true preserves v12 render.
   */
  showTrend: boolean
  /**
   * v13 — per-metric chart appearance overrides (goal lines, target-line
   * styling, manual Y-axis bounds, grid toggles, curve type, average +
   * extremes annotations). Default `{}` preserves v12.x defaults.
   */
  chartConfig: ChartConfig
  /**
   * v16 — auto-counter config. When `{ mode, anchor_at }` is set the
   * card renderer computes the headline value live from the anchor
   * timestamp (days/hours/weeks/months since) and ignores
   * `currentValue`. Default `{}` preserves the v15.x static-value
   * codepath. See `lib/auto-value.ts` for the compute / parse helpers.
   */
  autoValueConfig: AutoValueConfig
  history: { recordedAt: string; value: number }[]
  /** Derived from `MAX(history.recorded_at)` — there's no DB column for this. */
  lastDataAt: string | null
  updatedAt: string
}

export interface CreateSqcdpMetricInput {
  category: SqcdpCategoryId
  title: string
  subtitle?: string | null
  valueFormat?: ValueFormat
  currentValue?: number | null
  targetValue?: number | null
  unit?: string | null
  trendPeriod?: MetricTrendPeriod
  colorHex?: string | null
  accentHex?: string | null
  chartType?: SqcdpChartType
  showMarkers?: boolean
  notes?: string | null
  isVisible?: boolean
  /** Optional explicit position — defaults to MAX(displayOrder) + 1 per category. */
  displayOrder?: number
  styleConfig?: StyleConfig
  subMetrics?: SubMetric[]
  valuePrefix?: string | null
  valueSuffix?: string | null
  decimalPlaces?: number | null
  lowerIsBetter?: boolean
  showTrend?: boolean
  chartConfig?: ChartConfig
  autoValueConfig?: AutoValueConfig
}

export interface UpdateSqcdpMetricInput {
  id: string
  patch: Partial<Omit<CreateSqcdpMetricInput, 'category'>> & {
    category?: SqcdpCategoryId
  }
}

interface RawHistoryRow {
  recorded_at: string
  value: number
}

interface RawMetricRow {
  id: string
  organization_id: string
  category: SqcdpCategoryId
  title: string
  subtitle: string | null
  value_format: ValueFormat | null
  current_value: number | null
  target_value: number | null
  unit: string | null
  trend_period: MetricTrendPeriod | null
  color_hex: string | null
  accent_hex: string | null
  chart_type: SqcdpChartType | null
  show_markers: boolean | null
  is_visible: boolean | null
  display_order: number | null
  notes: string | null
  /** v12 columns — see migration 300. */
  style_config: unknown
  sub_metrics: unknown
  value_prefix: string | null
  value_suffix: string | null
  decimal_places: number | null
  lower_is_better: boolean | null
  show_trend: boolean | null
  /** v13 — chart_config jsonb (migration 302). */
  chart_config: unknown
  /** v16 — auto_value_config jsonb (migration 310). */
  auto_value_config: unknown
  updated_at: string
  history: RawHistoryRow[] | null
}

function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible'
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const handler = (): void => {
      setVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return visible
}

function mapRow(raw: RawMetricRow): SqcdpMetricRow {
  // Sort ASC so the chart x-axis reads left → right chronologically, then
  // slice to the last 6 months so cards don't drag a year of legacy points
  // into the rendered chart. Window cutoff is calculated against `now()`,
  // not `MAX(recorded_at)` — a stale-but-recent metric should still show
  // its full slice; an old metric with no recent updates collapses to its
  // tail (degraded but not broken).
  const cutoff = Date.now() - SQCDP_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const history = (raw.history ?? [])
    .map((h) => ({ recordedAt: h.recorded_at, value: Number(h.value) }))
    .filter((h) => {
      const t = Date.parse(h.recordedAt)
      return Number.isFinite(t) ? t >= cutoff : true
    })
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1))
  const lastDataAt = history.length
    ? history[history.length - 1].recordedAt
    : null
  return {
    id: raw.id,
    organizationId: raw.organization_id,
    category: raw.category,
    displayOrder: raw.display_order ?? 0,
    title: raw.title,
    subtitle: raw.subtitle,
    valueFormat: raw.value_format ?? 'number',
    currentValue: raw.current_value === null ? null : Number(raw.current_value),
    targetValue: raw.target_value === null ? null : Number(raw.target_value),
    unit: raw.unit,
    trendPeriod: raw.trend_period ?? 'rolling_4_weeks',
    colorHex: raw.color_hex,
    accentHex: raw.accent_hex,
    chartType: raw.chart_type ?? 'area',
    showMarkers: raw.show_markers ?? false,
    isVisible: raw.is_visible ?? true,
    notes: raw.notes,
    styleConfig: parseStyleConfig(raw.style_config),
    subMetrics: parseSubMetrics(raw.sub_metrics),
    valuePrefix: raw.value_prefix,
    valueSuffix: raw.value_suffix,
    decimalPlaces:
      raw.decimal_places != null && Number.isFinite(raw.decimal_places)
        ? raw.decimal_places
        : null,
    lowerIsBetter: raw.lower_is_better ?? false,
    showTrend: raw.show_trend ?? true,
    chartConfig: parseChartConfig(raw.chart_config),
    autoValueConfig: parseAutoValueConfig(raw.auto_value_config),
    history,
    lastDataAt,
    updatedAt: raw.updated_at,
  }
}

function metricsKey(orgId: string): readonly unknown[] {
  return ['sqcdp-metrics', orgId] as const
}

interface UseSqcdpMetricsResult {
  metrics: SqcdpMetricRow[]
  isLoading: boolean
  isFetching: boolean
  refresh: () => void
  createMetric: UseMutationResult<SqcdpMetricRow, Error, CreateSqcdpMetricInput>
  updateMetric: UseMutationResult<SqcdpMetricRow, Error, UpdateSqcdpMetricInput>
  deleteMetric: UseMutationResult<void, Error, string>
}

export function useSqcdpMetrics(): UseSqcdpMetricsResult {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''
  const queryClient = useQueryClient()
  const visible = useDocumentVisibility()

  const query = useQuery<SqcdpMetricRow[]>({
    queryKey: metricsKey(organizationId),
    enabled: !!organizationId,
    staleTime: 30_000,
    refetchInterval: visible ? 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          from: (table: string) => {
            select: (cols: string) => {
              eq: (
                col: string,
                val: string
              ) => {
                order: (
                  col: string,
                  opts: { ascending: boolean }
                ) => Promise<{
                  data: RawMetricRow[] | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      )
        .from('sqcdp_metrics')
        .select(
          `
          id,
          organization_id,
          category,
          title,
          subtitle,
          value_format,
          current_value,
          target_value,
          unit,
          trend_period,
          color_hex,
          accent_hex,
          chart_type,
          show_markers,
          is_visible,
          display_order,
          notes,
          style_config,
          sub_metrics,
          value_prefix,
          value_suffix,
          decimal_places,
          lower_is_better,
          show_trend,
          chart_config,
          auto_value_config,
          updated_at,
          history:sqcdp_metric_history (
            recorded_at,
            value
          )
        `
        )
        .eq('organization_id', organizationId)
        .order('display_order', { ascending: true })
      if (error) {
        logger.error('[useSqcdpMetrics] query failed', error)
        throw new Error(error.message)
      }
      return (data ?? []).map(mapRow)
    },
  })

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: metricsKey(organizationId) })
  }, [queryClient, organizationId])

  const createMetric = useMutation<
    SqcdpMetricRow,
    Error,
    CreateSqcdpMetricInput
  >({
    mutationFn: async (input) => {
      const list = query.data ?? []
      const sameCat = list.filter((m) => m.category === input.category)
      const nextDisplayOrder =
        input.displayOrder ??
        (sameCat.length
          ? Math.max(...sameCat.map((m) => m.displayOrder)) + 1
          : 0)
      // Pull the org's resolved category list out of the TanStack Query
      // cache (populated by `useSqcdpCategories`). Falls back to the
      // builtin seed when the cache hasn't loaded yet so the colorHex
      // default still resolves for the 9 canonical entries.
      const cachedCategories = queryClient.getQueryData<SqcdpCategoryDef[]>([
        'sqcdp-categories',
        organizationId,
      ])
      const categoriesForLookup =
        cachedCategories && cachedCategories.length > 0
          ? cachedCategories
          : BUILTIN_CATEGORIES
      const colorHex =
        input.colorHex ?? defaultColorFor(input.category, categoriesForLookup)

      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            insert: (rows: Record<string, unknown>[]) => {
              select: (cols: string) => {
                maybeSingle: () => Promise<{
                  data: RawMetricRow | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      )
        .from('sqcdp_metrics')
        .insert([
          {
            organization_id: organizationId,
            category: input.category,
            title: input.title,
            subtitle: input.subtitle ?? null,
            value_format: input.valueFormat ?? 'number',
            current_value: input.currentValue ?? null,
            target_value: input.targetValue ?? null,
            unit: input.unit ?? null,
            trend_period: input.trendPeriod ?? 'rolling_4_weeks',
            color_hex: colorHex,
            accent_hex: input.accentHex ?? null,
            chart_type: input.chartType ?? 'area',
            show_markers: input.showMarkers ?? false,
            is_visible: input.isVisible ?? true,
            display_order: nextDisplayOrder,
            notes: input.notes ?? null,
            style_config: input.styleConfig ?? {},
            sub_metrics: input.subMetrics ?? [],
            value_prefix: input.valuePrefix ?? null,
            value_suffix: input.valueSuffix ?? null,
            decimal_places: input.decimalPlaces ?? null,
            lower_is_better: input.lowerIsBetter ?? false,
            show_trend: input.showTrend ?? true,
            chart_config: input.chartConfig ?? {},
            auto_value_config: input.autoValueConfig ?? {},
          },
        ])
        .select(
          `
          id, organization_id, category, title, subtitle, value_format,
          current_value, target_value, unit, trend_period, color_hex, accent_hex,
          chart_type, show_markers, is_visible, display_order, notes,
          style_config, sub_metrics, value_prefix, value_suffix,
          decimal_places, lower_is_better, show_trend, chart_config,
          auto_value_config, updated_at
        `
        )
        // See note on the update mutation below: prefer `.maybeSingle()`
        // so an RLS-filtered insert (zero RETURNING rows) surfaces as a
        // friendly error rather than PostgREST's raw "Cannot coerce…".
        .maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      if (!data) {
        throw new Error(
          "Insert didn't return a row. Your role might be missing the production_boards:edit permission for this org — contact an administrator."
        )
      }
      const row: SqcdpMetricRow = mapRow({ ...data, history: [] })

      if (input.currentValue != null) {
        await (
          supabase as unknown as {
            from: (t: string) => {
              insert: (rows: Record<string, unknown>[]) => Promise<{
                error: { message: string } | null
              }>
            }
          }
        )
          .from('sqcdp_metric_history')
          .insert([
            {
              metric_id: row.id,
              organization_id: organizationId,
              value: input.currentValue,
            },
          ])
          .then((res) => {
            if (res.error) {
              logger.warn('[useSqcdpMetrics] history seed failed', res.error)
            }
          })
      }
      return row
    },
    onSuccess: () => {
      refresh()
      toast.success('Metric created')
    },
    onError: (err) => {
      toast.error(`Failed to create metric: ${err.message}`)
    },
  })

  const updateMetric = useMutation<
    SqcdpMetricRow,
    Error,
    UpdateSqcdpMetricInput,
    { previous: SqcdpMetricRow[] | undefined }
  >({
    mutationFn: async ({ id, patch }) => {
      const previous = (query.data ?? []).find((m) => m.id === id)

      const update: Record<string, unknown> = {}
      if (patch.title !== undefined) update.title = patch.title
      if (patch.subtitle !== undefined) update.subtitle = patch.subtitle
      if (patch.valueFormat !== undefined)
        update.value_format = patch.valueFormat
      if (patch.currentValue !== undefined)
        update.current_value = patch.currentValue
      if (patch.targetValue !== undefined)
        update.target_value = patch.targetValue
      if (patch.unit !== undefined) update.unit = patch.unit
      if (patch.trendPeriod !== undefined)
        update.trend_period = patch.trendPeriod
      if (patch.colorHex !== undefined) update.color_hex = patch.colorHex
      if (patch.accentHex !== undefined) update.accent_hex = patch.accentHex
      if (patch.chartType !== undefined) update.chart_type = patch.chartType
      if (patch.showMarkers !== undefined)
        update.show_markers = patch.showMarkers
      if (patch.notes !== undefined) update.notes = patch.notes
      if (patch.isVisible !== undefined) update.is_visible = patch.isVisible
      if (patch.displayOrder !== undefined)
        update.display_order = patch.displayOrder
      if (patch.category !== undefined) update.category = patch.category
      if (patch.styleConfig !== undefined)
        update.style_config = patch.styleConfig ?? {}
      if (patch.subMetrics !== undefined)
        update.sub_metrics = patch.subMetrics ?? []
      if (patch.valuePrefix !== undefined)
        update.value_prefix = patch.valuePrefix
      if (patch.valueSuffix !== undefined)
        update.value_suffix = patch.valueSuffix
      if (patch.decimalPlaces !== undefined)
        update.decimal_places = patch.decimalPlaces
      if (patch.lowerIsBetter !== undefined)
        update.lower_is_better = patch.lowerIsBetter
      if (patch.showTrend !== undefined) update.show_trend = patch.showTrend
      if (patch.chartConfig !== undefined)
        update.chart_config = patch.chartConfig ?? {}
      if (patch.autoValueConfig !== undefined)
        update.auto_value_config = patch.autoValueConfig ?? {}

      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            update: (vals: Record<string, unknown>) => {
              eq: (
                c: string,
                v: string
              ) => {
                select: (cols: string) => {
                  maybeSingle: () => Promise<{
                    data: RawMetricRow | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('sqcdp_metrics')
        .update(update)
        .eq('id', id)
        .select(
          `
          id, organization_id, category, title, subtitle, value_format,
          current_value, target_value, unit, trend_period, color_hex, accent_hex,
          chart_type, show_markers, is_visible, display_order, notes,
          style_config, sub_metrics, value_prefix, value_suffix,
          decimal_places, lower_is_better, show_trend, chart_config,
          auto_value_config, updated_at
        `
        )
        // `.maybeSingle()` (not `.single()`) so an RLS-filtered UPDATE
        // returning zero rows doesn't surface as PostgREST's raw
        // "Cannot coerce the result to a single JSON object" string. The
        // canonical fix for that is migration 308 (has_permission via
        // role_id), but we still want a friendly toast if a future
        // permission misalignment slips through.
        .maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      if (!data) {
        throw new Error(
          "Update didn't return a row. Your role might be missing the production_boards:edit permission for this org — contact an administrator."
        )
      }

      const row: SqcdpMetricRow = mapRow({
        ...data,
        history:
          previous?.history.map((h) => ({
            recorded_at: h.recordedAt,
            value: h.value,
          })) ?? [],
      })

      if (
        patch.currentValue !== undefined &&
        patch.currentValue !== null &&
        previous?.currentValue !== patch.currentValue
      ) {
        await (
          supabase as unknown as {
            from: (t: string) => {
              insert: (rows: Record<string, unknown>[]) => Promise<{
                error: { message: string } | null
              }>
            }
          }
        )
          .from('sqcdp_metric_history')
          .insert([
            {
              metric_id: id,
              organization_id: organizationId,
              value: patch.currentValue,
            },
          ])
          .then((res) => {
            if (res.error) {
              logger.warn('[useSqcdpMetrics] history append failed', res.error)
            }
          })
      }

      return row
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: metricsKey(organizationId) })
      const previous = queryClient.getQueryData<SqcdpMetricRow[]>(
        metricsKey(organizationId)
      )
      if (previous) {
        queryClient.setQueryData<SqcdpMetricRow[]>(
          metricsKey(organizationId),
          previous.map((m) =>
            m.id === id
              ? {
                  ...m,
                  title: patch.title ?? m.title,
                  subtitle:
                    patch.subtitle === undefined ? m.subtitle : patch.subtitle,
                  valueFormat: patch.valueFormat ?? m.valueFormat,
                  currentValue:
                    patch.currentValue === undefined
                      ? m.currentValue
                      : patch.currentValue,
                  targetValue:
                    patch.targetValue === undefined
                      ? m.targetValue
                      : patch.targetValue,
                  unit: patch.unit === undefined ? m.unit : patch.unit,
                  trendPeriod: patch.trendPeriod ?? m.trendPeriod,
                  colorHex:
                    patch.colorHex === undefined ? m.colorHex : patch.colorHex,
                  accentHex:
                    patch.accentHex === undefined
                      ? m.accentHex
                      : patch.accentHex,
                  chartType:
                    patch.chartType === undefined
                      ? m.chartType
                      : patch.chartType,
                  showMarkers:
                    patch.showMarkers === undefined
                      ? m.showMarkers
                      : patch.showMarkers,
                  notes: patch.notes === undefined ? m.notes : patch.notes,
                  isVisible: patch.isVisible ?? m.isVisible,
                  category: patch.category ?? m.category,
                  displayOrder: patch.displayOrder ?? m.displayOrder,
                  styleConfig:
                    patch.styleConfig === undefined
                      ? m.styleConfig
                      : (patch.styleConfig ?? {}),
                  subMetrics:
                    patch.subMetrics === undefined
                      ? m.subMetrics
                      : (patch.subMetrics ?? []),
                  valuePrefix:
                    patch.valuePrefix === undefined
                      ? m.valuePrefix
                      : patch.valuePrefix,
                  valueSuffix:
                    patch.valueSuffix === undefined
                      ? m.valueSuffix
                      : patch.valueSuffix,
                  decimalPlaces:
                    patch.decimalPlaces === undefined
                      ? m.decimalPlaces
                      : patch.decimalPlaces,
                  lowerIsBetter:
                    patch.lowerIsBetter === undefined
                      ? m.lowerIsBetter
                      : patch.lowerIsBetter,
                  showTrend:
                    patch.showTrend === undefined
                      ? m.showTrend
                      : patch.showTrend,
                  chartConfig:
                    patch.chartConfig === undefined
                      ? m.chartConfig
                      : (patch.chartConfig ?? {}),
                  autoValueConfig:
                    patch.autoValueConfig === undefined
                      ? m.autoValueConfig
                      : (patch.autoValueConfig ?? {}),
                }
              : m
          )
        )
      }
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(metricsKey(organizationId), context.previous)
      }
      toast.error(`Failed to update metric: ${err.message}`)
    },
    onSuccess: () => {
      toast.success('Metric updated')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: metricsKey(organizationId),
      })
    },
  })

  const deleteMetric = useMutation<
    void,
    Error,
    string,
    { previous: SqcdpMetricRow[] | undefined }
  >({
    mutationFn: async (id) => {
      const { error } = await (
        supabase as unknown as {
          from: (t: string) => {
            delete: () => {
              eq: (
                c: string,
                v: string
              ) => Promise<{
                error: { message: string } | null
              }>
            }
          }
        }
      )
        .from('sqcdp_metrics')
        .delete()
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: metricsKey(organizationId) })
      const previous = queryClient.getQueryData<SqcdpMetricRow[]>(
        metricsKey(organizationId)
      )
      if (previous) {
        queryClient.setQueryData<SqcdpMetricRow[]>(
          metricsKey(organizationId),
          previous.filter((m) => m.id !== id)
        )
      }
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(metricsKey(organizationId), context.previous)
      }
      toast.error(`Failed to delete metric: ${err.message}`)
    },
    onSuccess: () => {
      toast.success('Metric deleted')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: metricsKey(organizationId),
      })
    },
  })

  return {
    metrics: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refresh,
    createMetric,
    updateMetric,
    deleteMetric,
  }
}

// Created and developed by Jai Singh
