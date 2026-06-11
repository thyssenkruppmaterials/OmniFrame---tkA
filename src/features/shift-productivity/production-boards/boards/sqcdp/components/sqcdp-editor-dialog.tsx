// Created and developed by Jai Singh
/**
 * SqcdpEditorDialog — modal-dialog editor for SQCDP metrics.
 *
 * The `'problem'` mode was retired on 2026-05-17 alongside the rest of
 * the Problems UI surface; see
 * `memorybank/OmniFrame/Sessions/2026-05-17.md` § "Remove SQCDP Problems UI".
 *
 * v14 (2026-05-17) — "Fine-grained controls" pass. Adds many more knobs
 * per tab, with a cleaner section/grid layout and a more visible tab
 * strip. Schema-level changes live in `lib/style-config.ts` (header
 * sub-config + per-field align / letterSpacing / color) and
 * `lib/chart-config.ts` (`grid.opacity`). See
 * [[Patterns/Editable-Board-Dialogs]] and
 * [[Patterns/Per-Field-Style-Overrides]] for the canonical recipes the
 * editor now follows.
 *
 * Tab summary (post v14):
 *  - **Basics**   — Identity (category/title/subtitle), Value (format,
 *                   current, target, unit, prefix, suffix, decimal places
 *                   via slider, lower-is-better), Period (trend period +
 *                   show-trend switch).
 *  - **Style**    — Card colors (recommended palette presets + custom
 *                   override + accent + contrast warning), Header band
 *                   (height / align / show-icon), Typography (per-field
 *                   family / size / weight + collapsible More controls
 *                   for transform / align / letter-spacing / color).
 *  - **Chart**    — Display (chart type as ToggleGroup with icons),
 *                   Curve & axis (curve ToggleGroup, Y-axis show + min /
 *                   max with auto chip), Grid (horizontal/vertical
 *                   toggles + opacity slider), Reference lines (primary
 *                   target line via ToggleGroup style + width slider +
 *                   color picker + show-label), Goal lines editor,
 *                   Annotations (avg / extremes).
 *  - **Advanced** — Sub-metrics editor, notes, visibility.
 *  - **History**  — Existing `<SqcdpHistoryEditor>`.
 *
 * v12.3 layout (side-by-side preview + tabs) is preserved. Dialog width
 * is `1180px`.
 *
 * Confirm-if-dirty exit + delete confirm + dirty-tab badges are all
 * react-hook-form aware via `formState.{isDirty,dirtyFields}`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { z } from 'zod'
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type UseFormSetValue,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  IconBold,
  IconChartArea,
  IconChartBar,
  IconChartLine,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconItalic,
  IconLayoutColumns,
  IconMinus,
  IconPlus,
  IconStack2,
  IconUnderline,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ColorPickerInput } from '@/components/ui/color-picker-input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useSqcdpCategoriesContext } from '../hooks/use-sqcdp-categories-context'
import {
  type SqcdpChartType,
  type SqcdpMetricRow,
  type SubMetric,
  type CreateSqcdpMetricInput,
  type MetricTrendPeriod,
  useSqcdpMetrics,
} from '../hooks/use-sqcdp-metrics'
import {
  AUTO_VALUE_MODE_LABELS,
  AUTO_VALUE_MODE_OPTIONS,
  computeAutoValue,
  isAutoValueActive,
  type AutoValueConfig,
  type AutoValueMode,
} from '../lib/auto-value'
import {
  defaultColorFor,
  getCategory,
  type SqcdpCategoryId,
} from '../lib/categories'
import {
  DEFAULT_CHART_CONFIG,
  type ChartConfig,
  type CurveType,
  type GoalLine,
  type LineStyle,
  type LineWidth,
} from '../lib/chart-config'
import {
  type FieldStyle,
  type FontFamily,
  type FontSize,
  type FontWeight,
  type HeaderAlign,
  type HeaderHeight,
  type LetterSpacing,
  type TextAlign,
  type TextTransform,
  DEFAULT_HEADER,
  DEFAULT_STYLES,
  FONT_FAMILY_CLASS,
  SIZE_OPTIONS,
  SIZE_POINTS,
  SIZE_PT_MAX,
  SIZE_PT_MIN,
  WEIGHT_CLASS,
  clampPt,
  fieldClasses,
  fieldInlineStyle,
  formatSizePoints,
  type StyleConfig,
} from '../lib/style-config'
import { SqcdpCard } from './sqcdp-card'
import { SqcdpCategoryCombobox } from './sqcdp-category-combobox'
import { SqcdpGoalLinesEditor } from './sqcdp-goal-lines-editor'
import { SqcdpHistoryEditor } from './sqcdp-history-editor'
import { SqcdpSubMetricsEditor } from './sqcdp-sub-metrics-editor'

export type SqcdpEditorMode = {
  type: 'metric'
  metric?: SqcdpMetricRow
  category?: SqcdpCategoryId
}

interface SqcdpEditorDialogProps {
  open: boolean
  mode: SqcdpEditorMode | null
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Picker option tables
// ---------------------------------------------------------------------------

const VALUE_FORMATS = [
  'number',
  'percent',
  'currency',
  'duration',
  'text',
] as const
const TREND_PERIODS: { id: MetricTrendPeriod; label: string }[] = [
  { id: 'rolling_4_weeks', label: 'Rolling 4 Weeks' },
  { id: 'rolling_30_days', label: 'Rolling 30 Days' },
  { id: 'last_6_months', label: 'Last 6 Months' },
  { id: 'ytd', label: 'Year to Date' },
  { id: 'custom', label: 'Custom Range' },
]
const FONT_FAMILY_OPTIONS: { id: FontFamily; label: string }[] = [
  { id: 'sans', label: 'Sans-serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Monospace' },
]
const WEIGHT_OPTIONS: { id: FontWeight; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'medium', label: 'Medium' },
  { id: 'semibold', label: 'Semibold' },
  { id: 'bold', label: 'Bold' },
  { id: 'black', label: 'Black' },
]
const TRANSFORM_OPTIONS: { id: TextTransform; label: string }[] = [
  { id: 'none', label: 'As typed' },
  { id: 'uppercase', label: 'UPPERCASE' },
  { id: 'capitalize', label: 'Capitalize' },
  { id: 'lowercase', label: 'lowercase' },
]
const ALIGN_OPTIONS: { id: TextAlign; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
]
const LETTER_SPACING_OPTIONS: { id: LetterSpacing; label: string }[] = [
  { id: 'tight', label: 'Tight' },
  { id: 'normal', label: 'Normal' },
  { id: 'wide', label: 'Wide' },
]
const HEADER_HEIGHT_OPTIONS: { id: HeaderHeight; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'normal', label: 'Normal' },
  { id: 'tall', label: 'Tall' },
]
const HEADER_ALIGN_OPTIONS: { id: HeaderAlign; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
]
const DECIMAL_OPTIONS = ['auto', '0', '1', '2', '3', '4'] as const
const CURVE_TYPES: { id: CurveType; label: string }[] = [
  { id: 'monotone', label: 'Smooth' },
  { id: 'linear', label: 'Straight' },
  { id: 'step', label: 'Step' },
]
const LINE_STYLE_OPTIONS: { id: LineStyle; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
]
const CHART_TYPE_OPTIONS: {
  id: SqcdpChartType
  label: string
  Icon: typeof IconChartLine
}[] = [
  { id: 'line', label: 'Line', Icon: IconChartLine },
  { id: 'area', label: 'Area', Icon: IconChartArea },
  { id: 'bar', label: 'Bar', Icon: IconChartBar },
]

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const subMetricSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1, 'Title is required').max(60, 'Title too long'),
  value: z.number().nullable(),
  value_format: z.enum(VALUE_FORMATS),
  unit: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  decimal_places: z.number().int().min(0).max(4).nullable().optional(),
})

const fieldStyleSchema = z
  .object({
    font: z.enum(['sans', 'serif', 'mono']).optional(),
    size: z
      .enum([
        'xs',
        'sm',
        'base',
        'lg',
        'xl',
        '2xl',
        '3xl',
        '4xl',
        '5xl',
        '6xl',
        '7xl',
        '8xl',
        '9xl',
      ])
      .optional(),
    weight: z
      .enum(['normal', 'medium', 'semibold', 'bold', 'black'])
      .optional(),
    transform: z
      .enum(['none', 'uppercase', 'capitalize', 'lowercase'])
      .optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    letterSpacing: z.enum(['tight', 'normal', 'wide']).optional(),
    // Hex string accepted as-is — the renderer falls back to the default
    // if it doesn't match `#RRGGBB`. Persisting an invalid value here is
    // a no-op at render time, no need to fail the form.
    color: z.string().optional(),
    // v16 — precise pt size. Bounds match `clampPt` in style-config.ts.
    sizePt: z.number().int().min(4).max(300).optional().nullable(),
    // v16 — line-height multiplier, e.g. 1.0 / 1.5.
    lineHeight: z.number().min(0.5).max(3).optional().nullable(),
    // v16 — italic + underline toggles.
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
  })
  .optional()

const headerConfigSchema = z
  .object({
    height: z.enum(['compact', 'normal', 'tall']).optional(),
    align: z.enum(['left', 'center']).optional(),
    showIcon: z.boolean().optional(),
  })
  .optional()

const styleConfigSchema = z.object({
  title: fieldStyleSchema,
  subtitle: fieldStyleSchema,
  primary: fieldStyleSchema,
  header: headerConfigSchema,
})

const lineStyleEnum = z.enum(['solid', 'dashed', 'dotted'])
const lineWidthEnum = z.union([z.literal(1), z.literal(2), z.literal(3)])

const goalLineSchema = z.object({
  id: z.string().min(1),
  value: z.number(),
  label: z.string().nullable().optional(),
  color_hex: z.string().nullable().optional(),
  style: lineStyleEnum.optional(),
  width: lineWidthEnum.optional(),
})

const chartConfigSchema = z.object({
  goal_lines: z.array(goalLineSchema).optional(),
  target_line: z
    .object({
      color_hex: z.string().nullable().optional(),
      style: lineStyleEnum.optional(),
      width: lineWidthEnum.optional(),
      show_label: z.boolean().optional(),
    })
    .optional(),
  y_axis: z
    .object({
      show: z.boolean().optional(),
      min: z.number().nullable().optional(),
      max: z.number().nullable().optional(),
    })
    .optional(),
  grid: z
    .object({
      show_horizontal: z.boolean().optional(),
      show_vertical: z.boolean().optional(),
      opacity: z.number().min(0).max(50).optional(),
    })
    .optional(),
  curve: z.enum(['monotone', 'linear', 'step']).optional(),
  show_average: z.boolean().optional(),
  highlight_extremes: z.boolean().optional(),
})

const autoValueConfigSchema = z.object({
  mode: z
    .enum([
      'count_up_days',
      'count_up_hours',
      'count_up_weeks',
      'count_up_months',
    ])
    .optional(),
  anchor_at: z.string().nullable().optional(),
  floor_to_midnight: z.boolean().optional(),
})

const metricSchema = z.object({
  // Category is org-scoped now (migration 306) — accept any non-empty
  // slug-shaped string. The combobox restricts UI choices to the org's
  // resolved category list; the DB FK enforces referential integrity.
  category: z
    .string()
    .min(1, 'Category is required')
    .regex(/^[a-z0-9_]+$/, 'Invalid category slug'),
  title: z.string().min(1, 'Title is required').max(80, 'Title too long'),
  subtitle: z.string().optional().nullable(),
  valueFormat: z.enum(VALUE_FORMATS),
  currentValue: z.string().optional().nullable(),
  targetValue: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  trendPeriod: z.enum([
    'rolling_4_weeks',
    'rolling_30_days',
    'last_6_months',
    'ytd',
    'custom',
  ]),
  colorHex: z.string().optional().nullable(),
  accentHex: z.string().optional().nullable(),
  chartType: z.enum(['line', 'area', 'bar']),
  showMarkers: z.boolean(),
  isVisible: z.boolean(),
  notes: z.string().optional().nullable(),
  valuePrefix: z.string().optional().nullable(),
  valueSuffix: z.string().optional().nullable(),
  decimalPlaces: z.enum(DECIMAL_OPTIONS),
  lowerIsBetter: z.boolean(),
  showTrend: z.boolean(),
  styleConfig: styleConfigSchema,
  subMetrics: z.array(subMetricSchema),
  chartConfig: chartConfigSchema,
  autoValueConfig: autoValueConfigSchema,
})

type MetricFormValues = z.infer<typeof metricSchema>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumberOrNull(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v.trim() === '') return null
  const parsed = Number(v)
  return Number.isFinite(parsed) ? parsed : null
}

function decimalEnumToNumber(v: string): number | null {
  if (v === 'auto') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function decimalNumberToEnum(
  v: number | null | undefined
): (typeof DECIMAL_OPTIONS)[number] {
  if (v === null || v === undefined) return 'auto'
  const s = String(v) as (typeof DECIMAL_OPTIONS)[number]
  return DECIMAL_OPTIONS.includes(s) ? s : 'auto'
}

const HEX_COLOR_REGEX = /^#[0-9A-F]{6}$/i

/**
 * WCAG-style relative luminance for a `#RRGGBB` hex color. Used to flag
 * white-on-accent contrast issues on the category header band — when
 * the override color is too bright the band's `text-white` title reads
 * poorly. Returns `null` for malformed input.
 */
function relativeLuminance(hex: string): number | null {
  if (!HEX_COLOR_REGEX.test(hex)) return null
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const channel = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * Approximate WCAG contrast ratio between `#RRGGBB` and pure white. The
 * SQCDP card always paints the header title in white so we measure
 * against that fixed foreground. Values below 3.0 fail AA for large
 * text — surface a soft warning in the editor when the curator picks
 * something pale.
 */
function contrastAgainstWhite(hex: string): number | null {
  const lum = relativeLuminance(hex)
  if (lum === null) return null
  // White luminance = 1.
  return (1 + 0.05) / (lum + 0.05)
}

// ---------------------------------------------------------------------------
// Preview metric synthesis
// ---------------------------------------------------------------------------

/**
 * Build a synthetic `SqcdpMetricRow` from the live form values so the
 * left-pane preview reflects in-flight edits without saving. `livePoints`
 * is reserved for future cross-cache wiring; today we fall back to the
 * baked-in history when present and a small demo series otherwise.
 */
function buildPreviewMetric(
  values: MetricFormValues,
  initial: { metric?: SqcdpMetricRow; category?: SqcdpCategoryId },
  livePoints: { recordedAt: string; value: number }[],
  options: {
    hideSubMetrics?: boolean
    categories: readonly import('../lib/categories').SqcdpCategoryDef[]
  }
): SqcdpMetricRow {
  const category =
    (values.category as SqcdpCategoryId) ?? initial.category ?? 'safety'
  const usableLive = livePoints.length >= 2 ? livePoints : null
  const usableEmbedded =
    !usableLive && initial.metric && initial.metric.history.length >= 2
      ? initial.metric.history
      : null
  const history = usableLive ?? usableEmbedded ?? PREVIEW_DEMO_HISTORY
  return {
    id: initial.metric?.id ?? 'preview',
    organizationId: initial.metric?.organizationId ?? '',
    category,
    displayOrder: initial.metric?.displayOrder ?? 0,
    title: values.title || initial.metric?.title || 'Preview',
    subtitle: values.subtitle || null,
    valueFormat: values.valueFormat,
    currentValue: toNumberOrNull(values.currentValue ?? null),
    targetValue: toNumberOrNull(values.targetValue ?? null),
    unit: values.unit || null,
    trendPeriod: values.trendPeriod,
    colorHex:
      values.colorHex ||
      initial.metric?.colorHex ||
      defaultColorFor(category, options.categories),
    accentHex: values.accentHex || null,
    chartType: values.chartType,
    showMarkers: values.showMarkers,
    isVisible: values.isVisible,
    notes: values.notes || null,
    styleConfig: (values.styleConfig as StyleConfig) ?? {},
    subMetrics: options.hideSubMetrics ? [] : (values.subMetrics ?? []),
    valuePrefix: values.valuePrefix || null,
    valueSuffix: values.valueSuffix || null,
    decimalPlaces: decimalEnumToNumber(values.decimalPlaces),
    lowerIsBetter: values.lowerIsBetter,
    showTrend: values.showTrend,
    chartConfig: (values.chartConfig as ChartConfig) ?? {},
    autoValueConfig: (values.autoValueConfig as AutoValueConfig) ?? {},
    history,
    lastDataAt: history[history.length - 1]?.recordedAt ?? null,
    updatedAt: new Date().toISOString(),
  }
}

const PREVIEW_DEMO_HISTORY: { recordedAt: string; value: number }[] = (() => {
  const now = Date.now()
  const oneWeek = 7 * 24 * 60 * 60 * 1000
  const points = [12, 9, 11, 7, 8, 5, 6, 4]
  return points.map((value, i) => ({
    recordedAt: new Date(now - (points.length - 1 - i) * oneWeek).toISOString(),
    value,
  }))
})()

// ---------------------------------------------------------------------------
// Tab strip with dirty badges
// ---------------------------------------------------------------------------

type MetricTabId = 'basics' | 'style' | 'chart' | 'advanced' | 'history'

interface TabDescriptor {
  id: MetricTabId
  label: string
  description: string
  /** react-hook-form field names that belong to this tab. */
  fields: readonly (keyof MetricFormValues)[]
  disabled?: boolean
}

const METRIC_TAB_DESCRIPTORS: readonly TabDescriptor[] = [
  {
    id: 'basics',
    label: 'Basics',
    description: 'Identity, value, and trend period',
    fields: [
      'category',
      'title',
      'subtitle',
      'valueFormat',
      'currentValue',
      'targetValue',
      'unit',
      'trendPeriod',
      'valuePrefix',
      'valueSuffix',
      'decimalPlaces',
      'lowerIsBetter',
      'showTrend',
      'autoValueConfig',
    ],
  },
  {
    id: 'style',
    label: 'Style',
    description: 'Card colors, header band, typography',
    fields: ['colorHex', 'accentHex', 'styleConfig'],
  },
  {
    id: 'chart',
    label: 'Chart',
    description: 'Geometry, axes, reference lines',
    fields: ['chartType', 'showMarkers', 'chartConfig'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Sub-metrics, notes, visibility',
    fields: ['subMetrics', 'notes', 'isVisible'],
  },
  {
    id: 'history',
    label: 'History',
    description: 'Historical data points',
    fields: [],
  },
] as const

interface MetricTabStripProps {
  active: MetricTabId
  onChange: (next: MetricTabId) => void
  dirtyFields: Partial<Record<keyof MetricFormValues, unknown>>
  historyDisabled: boolean
}

/**
 * Custom tab strip — replaces the default shadcn `<TabsList>` with a
 * roomier secondary-nav row that surfaces a per-tab dirty badge and a
 * one-line description under the active label. Drives the same Radix
 * `<Tabs>` state via the parent `onChange`.
 */
function MetricTabStrip({
  active,
  onChange,
  dirtyFields,
  historyDisabled,
}: MetricTabStripProps): ReactNode {
  return (
    <div className='border-border/40 flex flex-col gap-2 border-b pb-3'>
      <nav
        className='flex flex-wrap items-center gap-1.5'
        aria-label='Metric editor sections'
      >
        {METRIC_TAB_DESCRIPTORS.map((tab) => {
          const dirty = tab.fields.some((f) => dirtyFields[f])
          const isActive = active === tab.id
          const isDisabled = tab.id === 'history' && historyDisabled
          return (
            <button
              key={tab.id}
              type='button'
              role='tab'
              aria-selected={isActive}
              aria-disabled={isDisabled}
              disabled={isDisabled}
              onClick={() => onChange(tab.id)}
              className={cn(
                'group/tab relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                isDisabled
                  ? 'text-muted-foreground/50 cursor-not-allowed'
                  : isActive
                    ? 'bg-background text-foreground border-border/60 border shadow-xs'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <span>{tab.label}</span>
              {dirty && !isDisabled && (
                <span
                  aria-label='Unsaved changes in this tab'
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    isActive ? 'bg-primary' : 'bg-amber-500'
                  )}
                />
              )}
            </button>
          )
        })}
      </nav>
      <p className='text-muted-foreground text-xs'>
        {METRIC_TAB_DESCRIPTORS.find((t) => t.id === active)?.description}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section / layout primitives
// ---------------------------------------------------------------------------

/**
 * Subtle bordered grouping for sets of related controls inside a tab.
 * Carries an optional eyebrow + description + right-side action slot.
 * Background `bg-muted/15` is deliberately lighter than v12 (`/20`) so
 * the nested mini-cards (`bg-background` Switch rows) read as the
 * brighter surface inside the panel.
 */
function Section({
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <section
      className={cn(
        'border-border/50 bg-muted/15 rounded-lg border p-4',
        className
      )}
    >
      <header className='border-border/40 mb-4 flex items-start justify-between gap-4 border-b pb-2'>
        <div className='flex flex-col gap-0.5'>
          {eyebrow ? (
            <span className='text-muted-foreground text-[10px] font-semibold tracking-wide uppercase'>
              {eyebrow}
            </span>
          ) : null}
          <h3 className='text-foreground text-sm font-semibold'>{title}</h3>
          {description ? (
            <p className='text-muted-foreground text-xs'>{description}</p>
          ) : null}
        </div>
        {action ? (
          <div className='flex shrink-0 items-center'>{action}</div>
        ) : null}
      </header>
      <div className='flex flex-col gap-3'>{children}</div>
    </section>
  )
}

/**
 * Standard switch-row mini-card. The repeated `border + bg-background +
 * flex justify-between + rounded` shape across the form was duplicated
 * a dozen times in v13. Promoted to a helper here so future toggles get
 * the same visual weight without copy-paste drift.
 */
function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onCheckedChange: (next: boolean) => void
}): ReactNode {
  return (
    <div className='border-border/40 bg-background flex items-center justify-between gap-3 rounded-md border p-3'>
      <div className='flex flex-col gap-0.5'>
        <Label className='text-sm font-medium'>{label}</Label>
        {description ? (
          <p className='text-muted-foreground text-[11px]'>{description}</p>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

/**
 * Numeric input that pairs with an "Auto" pill — clicking the pill
 * clears the value (null) so the chart falls back to Recharts' auto
 * domain. Used by Y-axis min / max controls.
 */
function NumberWithAutoChip({
  value,
  onChange,
  placeholder = 'auto',
  label,
}: {
  value: number | null | undefined
  onChange: (next: number | null) => void
  placeholder?: string
  label: string
}): ReactNode {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between'>
        <Label className='text-sm font-medium'>{label}</Label>
        <button
          type='button'
          onClick={() => onChange(null)}
          disabled={value === null || value === undefined}
          className={cn(
            'text-[10px] font-medium tracking-wide uppercase transition-colors',
            value === null || value === undefined
              ? 'text-muted-foreground/40 cursor-default'
              : 'text-muted-foreground hover:text-foreground cursor-pointer'
          )}
        >
          {value === null || value === undefined ? 'Auto' : 'Reset to auto'}
        </button>
      </div>
      <Input
        type='number'
        inputMode='decimal'
        placeholder={placeholder}
        value={value == null ? '' : String(value)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value
          if (raw.trim() === '') {
            onChange(null)
            return
          }
          const parsed = Number(raw)
          onChange(Number.isFinite(parsed) ? parsed : null)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Color palette / contrast affordances (Style tab)
// ---------------------------------------------------------------------------

interface PaletteSwatch {
  value: string
  label: string
}

const SQCDP_PALETTE: readonly PaletteSwatch[] = [
  { value: '#DC2626', label: 'Safety red' },
  { value: '#16A34A', label: 'Quality green' },
  { value: '#EA580C', label: 'Cost orange' },
  { value: '#0EA5A9', label: 'Delivery teal' },
  { value: '#CA8A04', label: 'Production amber' },
  { value: '#7C3AED', label: 'Maintenance violet' },
  { value: '#9333EA', label: 'Shipping purple' },
  { value: '#1E3A8A', label: 'Big idea navy' },
  { value: '#0EA5E9', label: 'Announcement sky' },
] as const

/**
 * Compact one-click palette strip. Highlights the active swatch when it
 * matches the curator's current `colorHex`. Each swatch is keyboard-
 * focusable; tooltips live in the `title` attribute (the dialog already
 * hosts a TooltipProvider stack via shadcn primitives elsewhere).
 */
function PaletteStrip({
  value,
  onPick,
  ariaLabel,
}: {
  value: string | null | undefined
  onPick: (next: string) => void
  ariaLabel: string
}): ReactNode {
  const active = (value ?? '').toUpperCase()
  return (
    <div
      role='group'
      aria-label={ariaLabel}
      className='flex flex-wrap items-center gap-1.5'
    >
      {SQCDP_PALETTE.map((swatch) => {
        const isActive = active === swatch.value.toUpperCase()
        return (
          <button
            key={swatch.value}
            type='button'
            title={`${swatch.label} (${swatch.value})`}
            aria-label={swatch.label}
            aria-pressed={isActive}
            onClick={() => onPick(swatch.value)}
            className={cn(
              'relative h-7 w-7 rounded-md border transition-transform',
              isActive
                ? 'ring-primary ring-offset-background scale-110 ring-2 ring-offset-1'
                : 'border-border hover:scale-110'
            )}
            style={{ backgroundColor: swatch.value }}
          >
            {isActive && (
              <IconCircleCheck className='absolute inset-0 m-auto h-4 w-4 text-white drop-shadow' />
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Tiny contrast badge surfaced beneath the color override input. When
 * the picked color contrasts poorly with white text in the header band
 * (WCAG AA large-text threshold is 3.0:1), warn the curator inline.
 */
function ContrastBadge({ hex }: { hex: string | null | undefined }): ReactNode {
  const ratio = hex ? contrastAgainstWhite(hex) : null
  if (!hex || ratio === null) return null
  const passes = ratio >= 3
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-[11px]',
        passes ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          passes ? 'bg-emerald-500' : 'bg-amber-500'
        )}
      />
      <span>
        White header text contrast: {ratio.toFixed(1)}:1{' '}
        {passes ? '· passes AA large text' : '· may be hard to read'}
      </span>
    </p>
  )
}

// ---------------------------------------------------------------------------
// Metric form root
// ---------------------------------------------------------------------------

function MetricForm({
  initial,
  onClose,
  setIsDirty,
}: {
  initial: { metric?: SqcdpMetricRow; category?: SqcdpCategoryId }
  onClose: () => void
  setIsDirty: (dirty: boolean) => void
}) {
  const { createMetric, updateMetric, deleteMetric } = useSqcdpMetrics()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<MetricTabId>('basics')
  const [previewMode, setPreviewMode] = useState<'metric' | 'single'>('metric')
  const isEdit = !!initial.metric

  const form = useForm<MetricFormValues>({
    resolver: zodResolver(metricSchema),
    defaultValues: useMemo<MetricFormValues>(
      () => ({
        category: initial.metric?.category ?? initial.category ?? 'safety',
        title: initial.metric?.title ?? '',
        subtitle: initial.metric?.subtitle ?? '',
        valueFormat: initial.metric?.valueFormat ?? 'number',
        currentValue:
          initial.metric?.currentValue == null
            ? ''
            : String(initial.metric.currentValue),
        targetValue:
          initial.metric?.targetValue == null
            ? ''
            : String(initial.metric.targetValue),
        unit: initial.metric?.unit ?? '',
        trendPeriod: initial.metric?.trendPeriod ?? 'rolling_4_weeks',
        colorHex: initial.metric?.colorHex ?? '',
        accentHex: initial.metric?.accentHex ?? '',
        chartType: initial.metric?.chartType ?? 'area',
        showMarkers: initial.metric?.showMarkers ?? false,
        isVisible: initial.metric?.isVisible ?? true,
        notes: initial.metric?.notes ?? '',
        valuePrefix: initial.metric?.valuePrefix ?? '',
        valueSuffix: initial.metric?.valueSuffix ?? '',
        decimalPlaces: decimalNumberToEnum(initial.metric?.decimalPlaces),
        lowerIsBetter: initial.metric?.lowerIsBetter ?? false,
        showTrend: initial.metric?.showTrend ?? true,
        styleConfig: initial.metric?.styleConfig ?? {},
        subMetrics: initial.metric?.subMetrics ?? [],
        chartConfig: initial.metric?.chartConfig ?? {},
        autoValueConfig: initial.metric?.autoValueConfig ?? {},
      }),
      [initial.metric, initial.category]
    ),
  })

  const isDirty = form.formState.isDirty
  useEffect(() => {
    setIsDirty(isDirty)
  }, [isDirty, setIsDirty])

  const liveValues = useWatch({ control: form.control })
  const dirtyFields = form.formState.dirtyFields as Partial<
    Record<keyof MetricFormValues, unknown>
  >

  const subMetricCount = liveValues.subMetrics?.length ?? 0
  const hasSubMetrics = subMetricCount > 0
  const effectivePreviewMode = hasSubMetrics ? previewMode : 'single'

  const onSubmit = form.handleSubmit(async (values) => {
    const payload: CreateSqcdpMetricInput = {
      category: values.category,
      title: values.title,
      subtitle: values.subtitle || null,
      valueFormat: values.valueFormat,
      currentValue: toNumberOrNull(values.currentValue ?? null),
      targetValue: toNumberOrNull(values.targetValue ?? null),
      unit: values.unit || null,
      trendPeriod: values.trendPeriod,
      colorHex: values.colorHex || null,
      accentHex: values.accentHex || null,
      chartType: values.chartType,
      showMarkers: values.showMarkers,
      isVisible: values.isVisible,
      notes: values.notes || null,
      valuePrefix: values.valuePrefix || null,
      valueSuffix: values.valueSuffix || null,
      decimalPlaces: decimalEnumToNumber(values.decimalPlaces),
      lowerIsBetter: values.lowerIsBetter,
      showTrend: values.showTrend,
      styleConfig: (values.styleConfig as StyleConfig) ?? {},
      subMetrics: values.subMetrics ?? [],
      chartConfig: (values.chartConfig as ChartConfig) ?? {},
      autoValueConfig: (values.autoValueConfig as AutoValueConfig) ?? {},
    }

    if (isEdit && initial.metric) {
      await updateMetric.mutateAsync({
        id: initial.metric.id,
        patch: payload,
      })
    } else {
      await createMetric.mutateAsync(payload)
    }
    setIsDirty(false)
    onClose()
  })

  return (
    <Form {...form}>
      <form
        onSubmit={onSubmit}
        className='flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden'
        data-testid='sqcdp-metric-form'
      >
        <aside
          className='border-border/40 bg-muted/20 shrink-0 border-b px-5 py-5 md:w-[360px] md:overflow-y-auto md:border-r md:border-b-0'
          data-testid='sqcdp-editor-preview-pane'
        >
          <LivePreview
            values={liveValues as MetricFormValues}
            initial={initial}
            previewMode={effectivePreviewMode}
            hasSubMetrics={hasSubMetrics}
            subMetricCount={subMetricCount}
            onPreviewModeChange={setPreviewMode}
          />
        </aside>

        <div className='flex flex-1 flex-col md:min-w-0 md:overflow-hidden'>
          <div className='flex-1 px-6 py-5 md:overflow-y-auto'>
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as MetricTabId)}
            >
              <MetricTabStrip
                active={activeTab}
                onChange={setActiveTab}
                dirtyFields={dirtyFields}
                historyDisabled={!isEdit}
              />

              <TabsContent value='basics' className='mt-5'>
                <BasicsTab control={form.control} setValue={form.setValue} />
              </TabsContent>

              <TabsContent value='style' className='mt-5'>
                <StyleTab control={form.control} setValue={form.setValue} />
              </TabsContent>

              <TabsContent value='chart' className='mt-5'>
                <ChartTab control={form.control} setValue={form.setValue} />
              </TabsContent>

              <TabsContent value='advanced' className='mt-5'>
                <AdvancedTab control={form.control} />
              </TabsContent>

              <TabsContent value='history' className='mt-4'>
                <SqcdpHistoryEditor metric={initial.metric ?? null} />
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className='border-border/40 bg-background sticky bottom-0 z-10 shrink-0 items-center gap-2 border-t px-6 py-3 md:static'>
            {isEdit && (
              <Button
                type='button'
                variant='destructive'
                className='sm:mr-auto'
                onClick={() => setConfirmOpen(true)}
                disabled={deleteMetric.isPending}
              >
                Delete metric
              </Button>
            )}
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <div className='flex items-center gap-3'>
              {isDirty && (
                <span
                  className='text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex'
                  data-testid='sqcdp-editor-dirty-indicator'
                >
                  <span
                    aria-hidden
                    className='inline-block h-1.5 w-1.5 rounded-full bg-amber-500'
                  />
                  Unsaved changes
                </span>
              )}
              <Button
                type='submit'
                disabled={createMetric.isPending || updateMetric.isPending}
              >
                {isEdit ? 'Save changes' : 'Create metric'}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </form>

      <ConfirmDialog
        isOpen={confirmOpen}
        title='Delete metric?'
        message='This permanently removes the metric and all of its history. This cannot be undone.'
        variant='danger'
        confirmText='Delete metric'
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          if (initial.metric) {
            await deleteMetric.mutateAsync(initial.metric.id)
          }
          setConfirmOpen(false)
          setIsDirty(false)
          onClose()
        }}
        isProcessing={deleteMetric.isPending}
      />
    </Form>
  )
}

// ---------------------------------------------------------------------------
// LivePreview (left pane)
// ---------------------------------------------------------------------------

interface LivePreviewProps {
  values: MetricFormValues
  initial: { metric?: SqcdpMetricRow; category?: SqcdpCategoryId }
  previewMode: 'metric' | 'single'
  hasSubMetrics: boolean
  subMetricCount: number
  onPreviewModeChange: (next: 'metric' | 'single') => void
}

function LivePreview({
  values,
  initial,
  previewMode,
  hasSubMetrics,
  subMetricCount,
  onPreviewModeChange,
}: LivePreviewProps): ReactNode {
  const { categories } = useSqcdpCategoriesContext()
  const previewMetric = useMemo(
    () =>
      buildPreviewMetric(values, initial, [], {
        hideSubMetrics: previewMode === 'single',
        categories,
      }),
    [values, initial, previewMode, categories]
  )

  return (
    <div className='flex flex-col gap-3' data-testid='sqcdp-editor-preview'>
      <div className='text-muted-foreground flex items-center justify-between gap-2 text-[10px] font-medium tracking-wide uppercase'>
        <span>Live preview</span>
        <span className='text-right text-[10px] tabular-nums'>
          {hasSubMetrics
            ? `${subMetricCount} sub-metric${subMetricCount === 1 ? '' : 's'}`
            : 'Single value'}
        </span>
      </div>

      {hasSubMetrics && (
        <ToggleGroup
          type='single'
          size='sm'
          value={previewMode}
          onValueChange={(v) => {
            if (v === 'metric' || v === 'single') onPreviewModeChange(v)
          }}
          aria-label='Preview layout'
          className='w-full'
        >
          <ToggleGroupItem
            value='metric'
            className='flex-1 gap-1.5 text-xs'
            aria-label='Stacked sub-metric preview'
          >
            <IconStack2 className='h-3.5 w-3.5' aria-hidden />
            Stacked
          </ToggleGroupItem>
          <ToggleGroupItem
            value='single'
            className='flex-1 gap-1.5 text-xs'
            aria-label='Single value preview'
          >
            <IconLayoutColumns className='h-3.5 w-3.5' aria-hidden />
            Single
          </ToggleGroupItem>
        </ToggleGroup>
      )}

      <div className='pointer-events-none w-full' style={{ minHeight: 280 }}>
        <SqcdpCard
          category={previewMetric.category}
          metric={previewMetric}
          density='normal'
          mountAnimation={false}
        />
      </div>

      <p className='text-muted-foreground text-[10px] leading-relaxed'>
        Hover affordances (edit pencil, tooltips) are suppressed here.
        Production behaviour is unchanged.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Auto-counter (Basics tab section)
// ---------------------------------------------------------------------------

/**
 * Convert a UTC ISO timestamp ⇄ the value the native
 * `<input type="datetime-local">` expects (`YYYY-MM-DDTHH:mm` in the
 * user's local zone). Keeps the round-trip lossless to the minute,
 * which is the resolution the picker exposes. Empty / invalid inputs
 * collapse to empty string (the picker's "no value" state).
 */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(value: string): string | null {
  if (!value) return null
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString()
}

interface AutoCounterSectionProps {
  control: Control<MetricFormValues>
  setValue: UseFormSetValue<MetricFormValues>
  config: AutoValueConfig
  active: boolean
}

/**
 * v16 — auto-counter editor surface (Basics tab, section 3).
 *
 * Curator toggles an auto-incrementing counter measured from an
 * anchor timestamp. Canonical case: Safety / TBIR "Days since last
 * incident". Same shape covers hours-since-downtime, weeks-since-
 * audit, months-since-process-change.
 *
 * UX:
 *  - The "Enable" switch on the section header is the only control
 *    when off, keeping the unused state visually quiet.
 *  - When on, curator picks a unit (Days / Hours / Weeks / Months),
 *    sets an anchor datetime, optionally toggles midnight-floor (Days
 *    mode only), and sees a live preview. A `Reset to now` button
 *    snaps the anchor to the current moment for the "we just had an
 *    incident, restart the counter" workflow.
 *  - The Current Value input in section 2 is disabled while this is
 *    on; the card renders `computeAutoValue(...)` instead.
 */
function AutoCounterSection({
  control,
  setValue,
  config,
  active,
}: AutoCounterSectionProps): ReactNode {
  const enabled = !!config.mode
  const mode = (config.mode ?? 'count_up_days') as AutoValueMode

  const update = useCallback(
    (patch: Partial<AutoValueConfig>): void => {
      const next: AutoValueConfig = { ...config, ...patch }
      // Strip empty bag so persisted shape matches the "off" default
      // when curator disables the feature. Keeps the DB column tidy
      // and avoids a stray `{ mode: undefined }` shape.
      const cleaned: AutoValueConfig = {}
      if (next.mode) cleaned.mode = next.mode
      if (next.anchor_at) cleaned.anchor_at = next.anchor_at
      if (typeof next.floor_to_midnight === 'boolean') {
        cleaned.floor_to_midnight = next.floor_to_midnight
      }
      setValue('autoValueConfig', cleaned, { shouldDirty: true })
    },
    [config, setValue]
  )

  const toggleEnabled = useCallback(
    (on: boolean): void => {
      if (on) {
        update({
          mode: config.mode ?? 'count_up_days',
          anchor_at: config.anchor_at ?? new Date().toISOString(),
          floor_to_midnight: config.floor_to_midnight ?? true,
        })
      } else {
        setValue('autoValueConfig', {}, { shouldDirty: true })
      }
    },
    [config.anchor_at, config.floor_to_midnight, config.mode, setValue, update]
  )

  const resetToNow = useCallback((): void => {
    update({ anchor_at: new Date().toISOString() })
  }, [update])

  const onAnchorChange = useCallback(
    (raw: string): void => {
      const iso = localInputToIso(raw)
      update({ anchor_at: iso })
    },
    [update]
  )

  const onModeChange = useCallback(
    (next: AutoValueMode): void => {
      update({ mode: next })
    },
    [update]
  )

  const previewValue = active ? computeAutoValue(config, Date.now()) : null
  const modeLabel = AUTO_VALUE_MODE_LABELS[mode]

  return (
    <Section
      eyebrow='3 · Auto-counter'
      title='Auto-increment value from an anchor date'
      description='Counts up since an event (last incident / last downtime / last audit). Replaces the Current value with a live count when on.'
      action={
        <Switch
          checked={enabled}
          onCheckedChange={toggleEnabled}
          aria-label='Enable auto-counter'
        />
      }
    >
      {enabled ? (
        <>
          <div className='flex flex-col gap-1.5'>
            <Label className='text-sm font-medium'>Unit</Label>
            <ToggleGroup
              type='single'
              size='sm'
              value={mode}
              onValueChange={(v) => {
                if (v) onModeChange(v as AutoValueMode)
              }}
              aria-label='Auto-counter unit'
              className='w-full'
            >
              {AUTO_VALUE_MODE_OPTIONS.map((opt) => (
                <ToggleGroupItem
                  key={opt.id}
                  value={opt.id}
                  className='flex-1 text-xs'
                >
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className='text-muted-foreground text-[11px]'>
              The headline value renders as a whole number — pair with a suffix
              like
              <code className='bg-muted/40 mx-1 rounded px-1'>
                {modeLabel.suffix}
              </code>
              in section 2 for the &quot;{`123${modeLabel.suffix}`}&quot;
              reading.
            </p>
          </div>

          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            <FormField
              control={control}
              name='autoValueConfig.anchor_at'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Anchor date / time</FormLabel>
                  <FormControl>
                    <Input
                      type='datetime-local'
                      value={isoToLocalInput(
                        (field.value as string | null) ?? null
                      )}
                      onChange={(e) => onAnchorChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription className='text-[11px]'>
                    The reset moment — e.g. the date/time of the last incident.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='flex flex-col gap-1.5'>
              <Label className='text-sm font-medium'>Reset now</Label>
              <Button
                type='button'
                variant='outline'
                onClick={resetToNow}
                className='h-9 justify-start'
              >
                Reset counter to current moment
              </Button>
              <p className='text-muted-foreground text-[11px]'>
                Snaps the anchor to{' '}
                <span className='tabular-nums'>
                  {new Date().toLocaleString()}
                </span>{' '}
                and the headline back to 0.
              </p>
            </div>
          </div>

          {mode === 'count_up_days' && (
            <SwitchRow
              label='Calendar-day floor'
              description='Round to midnight boundaries so an incident at 23:55 reads "1 Day" five minutes later, not "0 Days".'
              checked={config.floor_to_midnight ?? true}
              onCheckedChange={(next) => update({ floor_to_midnight: next })}
            />
          )}

          <div
            className='border-border/40 bg-background flex items-center justify-between gap-3 rounded-md border p-3'
            data-testid='sqcdp-auto-counter-preview'
          >
            <div className='flex flex-col gap-0.5'>
              <Label className='text-sm font-medium'>Computed now</Label>
              <p className='text-muted-foreground text-[11px]'>
                What the card will show given the current config.
              </p>
            </div>
            <span
              className='text-foreground text-2xl font-bold tabular-nums'
              data-testid='sqcdp-auto-counter-preview-value'
            >
              {previewValue == null ? '—' : `${previewValue}`}
              <span className='text-muted-foreground ml-1.5 text-xs font-medium'>
                {previewValue == null ? '' : modeLabel.label.toLowerCase()}
              </span>
            </span>
          </div>
        </>
      ) : (
        <p className='text-muted-foreground text-[12px]'>
          Off — the card uses the static Current value above. Flip the switch to
          count up from an anchor date.
        </p>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Basics tab
// ---------------------------------------------------------------------------

function BasicsTab({
  control,
  setValue,
}: {
  control: Control<MetricFormValues>
  setValue: UseFormSetValue<MetricFormValues>
}): ReactNode {
  // Watched once at the tab level — drives the decimal slider's
  // 0-3 reads and the lower-is-better / show-trend switches without
  // each <FormField> paying for its own subscription.
  const decimalPlaces = useWatch({ control, name: 'decimalPlaces' })
  const lowerIsBetter = useWatch({ control, name: 'lowerIsBetter' })
  const showTrend = useWatch({ control, name: 'showTrend' })
  const autoValueConfig = (useWatch({ control, name: 'autoValueConfig' }) ??
    {}) as AutoValueConfig
  const autoActive = isAutoValueActive(autoValueConfig)

  const onDecimalSlider = useCallback(
    (n: number) => {
      const next =
        n === -1
          ? 'auto'
          : (String(
              Math.max(0, Math.min(4, n))
            ) as (typeof DECIMAL_OPTIONS)[number])
      setValue('decimalPlaces', next, { shouldDirty: true })
    },
    [setValue]
  )

  return (
    <div className='flex flex-col gap-5'>
      <Section
        eyebrow='1 · Identity'
        title='What this metric is called'
        description='Where this metric lives on the board and what curators see at a glance.'
      >
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <FormField
            control={control}
            name='category'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <FormControl>
                  <SqcdpCategoryCombobox
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name='title'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input placeholder='Recordable Incidents' {...field} />
                </FormControl>
                <FormDescription className='text-[11px]'>
                  Renders inside the colored header band.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={control}
          name='subtitle'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subtitle</FormLabel>
              <FormControl>
                <Input
                  placeholder='Days since last LTI'
                  value={field.value ?? ''}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormDescription className='text-[11px]'>
                Small line under the headline value. Optional.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </Section>

      <Section
        eyebrow='2 · Value'
        title='How the headline number is sourced and rendered'
        description='Format, current value, prefix / suffix, and fraction digits.'
      >
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <FormField
            control={control}
            name='valueFormat'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Format</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {VALUE_FORMATS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name='unit'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Unit / currency code</FormLabel>
                <FormControl>
                  <Input
                    placeholder='days, %, USD…'
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <FormField
            control={control}
            name='currentValue'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Current value</FormLabel>
                <FormControl>
                  <Input
                    placeholder='0'
                    inputMode='decimal'
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    disabled={autoActive}
                  />
                </FormControl>
                {autoActive ? (
                  <FormDescription className='text-[11px]'>
                    Auto-counter is on (section 3) — value is computed from the
                    anchor date.
                  </FormDescription>
                ) : null}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name='targetValue'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Target</FormLabel>
                <FormControl>
                  <Input
                    placeholder='0'
                    inputMode='decimal'
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription className='text-[11px]'>
                  Leave blank to hide the target chip + reference line.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <FormField
            control={control}
            name='valuePrefix'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prefix</FormLabel>
                <FormControl>
                  <Input
                    placeholder='$, ~, >'
                    maxLength={4}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription className='text-[11px]'>
                  Prepended to the value (e.g. <code>$</code>).
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name='valueSuffix'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Suffix</FormLabel>
                <FormControl>
                  <Input
                    placeholder=' ppm,  units'
                    maxLength={12}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription className='text-[11px]'>
                  Appended after the value + unit.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className='flex flex-col gap-2'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>Decimal places</Label>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {decimalPlaces === 'auto'
                ? 'Auto (use format default)'
                : `${decimalPlaces} digit${decimalPlaces === '1' ? '' : 's'}`}
            </span>
          </div>
          <Slider
            min={-1}
            max={4}
            step={1}
            value={[decimalPlaces === 'auto' ? -1 : Number(decimalPlaces)]}
            onValueChange={(vs) =>
              onDecimalSlider(typeof vs[0] === 'number' ? vs[0] : -1)
            }
            aria-label='Decimal places'
          />
          <div className='text-muted-foreground flex justify-between text-[10px] tabular-nums'>
            <span>Auto</span>
            <span>0</span>
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
          </div>
        </div>
      </Section>

      <AutoCounterSection
        control={control}
        setValue={setValue}
        config={autoValueConfig}
        active={autoActive}
      />

      <Section
        eyebrow='4 · Period & trend'
        title='How the comparison reads'
        description='Polarity of the trend arrow and what "previous" means.'
      >
        <FormField
          control={control}
          name='trendPeriod'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Trend period</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TREND_PERIODS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription className='text-[11px]'>
                Drives the period chip on the card and the comparison subtext
                under the value.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <SwitchRow
            label='Show trend arrow'
            description='↑ / ↓ / → next to the headline value plus a "vs previous" subtext.'
            checked={showTrend ?? true}
            onCheckedChange={(next) =>
              setValue('showTrend', next, { shouldDirty: true })
            }
          />
          <SwitchRow
            label='Lower is better'
            description='Flip arrow polarity for defects, cost, incidents (↑ = bad).'
            checked={lowerIsBetter ?? false}
            onCheckedChange={(next) =>
              setValue('lowerIsBetter', next, { shouldDirty: true })
            }
          />
        </div>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Style tab
// ---------------------------------------------------------------------------

function StyleTab({
  control,
  setValue,
}: {
  control: Control<MetricFormValues>
  setValue: UseFormSetValue<MetricFormValues>
}): ReactNode {
  const styleConfig = (useWatch({ control, name: 'styleConfig' }) ??
    {}) as StyleConfig
  const colorHex = useWatch({ control, name: 'colorHex' }) ?? ''
  const accentHex = useWatch({ control, name: 'accentHex' }) ?? ''
  const category = useWatch({ control, name: 'category' })
  const { categories } = useSqcdpCategoriesContext()
  const categoryDef = getCategory(category, categories)

  const headerCfg = styleConfig.header ?? {}
  const headerHeight = headerCfg.height ?? DEFAULT_HEADER.height
  const headerAlign = headerCfg.align ?? DEFAULT_HEADER.align
  const showHeaderIcon = headerCfg.showIcon ?? DEFAULT_HEADER.showIcon

  const isAnyOverridden =
    !!styleConfig.title ||
    !!styleConfig.subtitle ||
    !!styleConfig.primary ||
    !!styleConfig.header

  const updateHeader = (patch: Partial<typeof headerCfg>): void => {
    setValue(
      'styleConfig',
      { ...styleConfig, header: { ...headerCfg, ...patch } },
      { shouldDirty: true }
    )
  }

  const resetCategoryColors = (): void => {
    setValue('colorHex', '', { shouldDirty: true })
    setValue('accentHex', '', { shouldDirty: true })
  }

  return (
    <div className='flex flex-col gap-5'>
      <Section
        eyebrow='1 · Card colors'
        title='Override the category palette for this metric'
        description='Pick a recommended SQCDP accent or enter a custom hex.'
        action={
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 px-2 text-xs'
            disabled={!colorHex && !accentHex}
            onClick={resetCategoryColors}
          >
            Reset to category
          </Button>
        }
      >
        <div className='flex flex-col gap-2'>
          <Label className='text-sm font-medium'>Recommended palette</Label>
          <PaletteStrip
            value={colorHex || defaultColorFor(category, categories)}
            onPick={(next) => setValue('colorHex', next, { shouldDirty: true })}
            ariaLabel='SQCDP recommended color palette'
          />
          <p className='text-muted-foreground text-[11px]'>
            Default for {categoryDef?.label ?? category} is{' '}
            <code>{defaultColorFor(category, categories)}</code>.
          </p>
        </div>

        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <FormField
            control={control}
            name='colorHex'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Color override</FormLabel>
                <FormControl>
                  <ColorPickerInput
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    presetColors={SQCDP_PALETTE.map((s) => ({
                      value: s.value,
                      label: s.label,
                    }))}
                  />
                </FormControl>
                <ContrastBadge hex={field.value ?? ''} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name='accentHex'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Accent color</FormLabel>
                <FormControl>
                  <ColorPickerInput
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription className='text-[11px]'>
                  Optional second tone — used by future per-card highlights.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </Section>

      <Section
        eyebrow='2 · Header band'
        title='Category band at the top of the card'
        description='Pick how tall the colored band is and how the title sits inside it.'
      >
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label className='text-sm font-medium'>Height</Label>
            <ToggleGroup
              type='single'
              size='sm'
              value={headerHeight}
              onValueChange={(v) => {
                if (v) updateHeader({ height: v as HeaderHeight })
              }}
              aria-label='Header band height'
              className='w-full'
            >
              {HEADER_HEIGHT_OPTIONS.map((opt) => (
                <ToggleGroupItem
                  key={opt.id}
                  value={opt.id}
                  className='flex-1 text-xs'
                >
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label className='text-sm font-medium'>Alignment</Label>
            <ToggleGroup
              type='single'
              size='sm'
              value={headerAlign}
              onValueChange={(v) => {
                if (v) updateHeader({ align: v as HeaderAlign })
              }}
              aria-label='Header alignment'
              className='w-full'
            >
              {HEADER_ALIGN_OPTIONS.map((opt) => (
                <ToggleGroupItem
                  key={opt.id}
                  value={opt.id}
                  className='flex-1 text-xs'
                >
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
        <SwitchRow
          label='Show category icon'
          description='The shield / check / etc icon next to the band title.'
          checked={showHeaderIcon}
          onCheckedChange={(next) => updateHeader({ showIcon: next })}
        />
      </Section>

      <Section
        eyebrow='3 · Typography'
        title='Fine-tune each text field'
        description='Pt-precise size, family, weight, italic / underline, color, line-height — per field.'
        action={
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 px-2 text-xs'
            disabled={!isAnyOverridden}
            onClick={() => setValue('styleConfig', {}, { shouldDirty: true })}
          >
            Reset all
          </Button>
        }
      >
        <TypographyPresetRow
          styleConfig={styleConfig}
          onApply={(next) =>
            setValue(
              'styleConfig',
              { ...styleConfig, ...next },
              { shouldDirty: true }
            )
          }
        />
        <FieldStyleRow
          control={control}
          fieldName='styleConfig.title'
          label='Title'
          fieldKey='title'
          sampleText='DELIVERY'
        />
        <FieldStyleRow
          control={control}
          fieldName='styleConfig.subtitle'
          label='Subtitle'
          fieldKey='subtitle'
          sampleText='vs 103.2% last week'
        />
        <FieldStyleRow
          control={control}
          fieldName='styleConfig.primary'
          label='Primary value'
          fieldKey='primary'
          sampleText='98%'
        />
        <PrimaryValuePreview styleConfig={styleConfig} />
      </Section>
    </div>
  )
}

/**
 * Quick typography presets — applies a coordinated size for title /
 * subtitle / primary in one click. Each preset stomps the pt fields for
 * those three rows but leaves family, weight, transform, alignment,
 * color, italic, underline, etc. untouched so curators can layer their
 * own choices on top of a baseline. "Standard" clears all pt overrides
 * so the card falls back to the density-token defaults.
 *
 * Preset payloads are kept in plain JS so the curator can read them at
 * a glance — there's no clever pt math, just three numbers that have
 * been tuned to work together at the SQCDP card scale.
 */
const TYPOGRAPHY_PRESETS: readonly {
  id: string
  label: string
  description: string
  title: number | null
  subtitle: number | null
  primary: number | null
}[] = [
  {
    id: 'standard',
    label: 'Standard',
    description:
      'Default density tokens — title 18 · subtitle 11 · primary 54.',
    title: null,
    subtitle: null,
    primary: null,
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Smaller everything — fits more cards on screen.',
    title: 14,
    subtitle: 10,
    primary: 42,
  },
  {
    id: 'display',
    label: 'Display',
    description: 'Oversized primary — punchy on a TV.',
    title: 22,
    subtitle: 13,
    primary: 96,
  },
  {
    id: 'huge',
    label: 'Stadium',
    description: 'Maximum primary — for big rooms or low vision.',
    title: 28,
    subtitle: 16,
    primary: 160,
  },
] as const

function TypographyPresetRow({
  styleConfig,
  onApply,
}: {
  styleConfig: StyleConfig
  onApply: (next: Partial<StyleConfig>) => void
}): ReactNode {
  // Determine which preset (if any) matches the current pt values. Falls
  // back to undefined when the curator has mixed/custom values.
  const titlePt = styleConfig.title?.sizePt ?? null
  const subtitlePt = styleConfig.subtitle?.sizePt ?? null
  const primaryPt = styleConfig.primary?.sizePt ?? null
  const activePreset = TYPOGRAPHY_PRESETS.find(
    (p) =>
      p.title === titlePt &&
      p.subtitle === subtitlePt &&
      p.primary === primaryPt
  )

  const applyPreset = (preset: (typeof TYPOGRAPHY_PRESETS)[number]): void => {
    const merge = (
      current: FieldStyle | undefined,
      pt: number | null
    ): FieldStyle | undefined => {
      const next: FieldStyle = { ...(current ?? {}) }
      if (pt === null) {
        delete next.sizePt
      } else {
        next.sizePt = pt
      }
      return Object.keys(next).length === 0 ? undefined : next
    }
    onApply({
      title: merge(styleConfig.title, preset.title),
      subtitle: merge(styleConfig.subtitle, preset.subtitle),
      primary: merge(styleConfig.primary, preset.primary),
    })
  }

  return (
    <div
      className='border-border/40 bg-background flex flex-col gap-2 rounded-md border p-3'
      data-testid='sqcdp-typography-presets'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Label className='text-sm font-medium'>Quick presets</Label>
        <span className='text-muted-foreground text-[11px]'>
          One click — sizes only. Other style fields are preserved.
        </span>
      </div>
      <div className='flex flex-wrap items-center gap-1.5'>
        {TYPOGRAPHY_PRESETS.map((preset) => {
          const active = activePreset?.id === preset.id
          return (
            <button
              key={preset.id}
              type='button'
              onClick={() => applyPreset(preset)}
              aria-pressed={active}
              title={preset.description}
              className={cn(
                'group flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border/60 hover:border-border hover:bg-muted/60'
              )}
            >
              <span
                className={cn(
                  'text-xs font-semibold',
                  active
                    ? 'text-foreground'
                    : 'text-foreground group-hover:text-foreground'
                )}
              >
                {preset.label}
              </span>
              <span className='text-muted-foreground text-[10px] tabular-nums'>
                {preset.title ?? 18}/{preset.subtitle ?? 11}/
                {preset.primary ?? 54} pt
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface FieldStyleRowProps {
  control: Control<MetricFormValues>
  fieldName:
    | 'styleConfig.title'
    | 'styleConfig.subtitle'
    | 'styleConfig.primary'
  label: string
  fieldKey: 'title' | 'subtitle' | 'primary'
  /** Sample text shown in the inline preview at the bottom of the row. */
  sampleText: string
}

/**
 * Pt-precision size control. The curator can pick a value via:
 *  - Direct numeric input (clamped 4-300 pt at commit time)
 *  - +/- buttons for one-point fine adjustments
 *  - Slider for quick scrubbing over the field's working range
 *  - Preset chips matching the legacy size tiers for the field
 *  - "Auto" pill to clear the pt override and fall back to the enum default
 *
 * The slider range is field-scoped — primary uses 24-200, title 12-48,
 * subtitle 6-24 — so each row's slider gives the curator just the working
 * range they care about without burying the relevant pt in a giant rail.
 */
const PT_RANGE: Record<'title' | 'subtitle' | 'primary', [number, number]> = {
  title: [12, 48],
  subtitle: [6, 24],
  primary: [24, 200],
}

const PT_PRESETS: Record<'title' | 'subtitle' | 'primary', readonly number[]> =
  {
    title: [14, 18, 22, 28, 36],
    subtitle: [9, 11, 13, 16, 20],
    primary: [36, 54, 72, 96, 128, 160],
  }

interface SizePtControlProps {
  fieldKey: 'title' | 'subtitle' | 'primary'
  /** Current pt override from the field style; null/undefined when unset. */
  sizePt: number | null | undefined
  /** Current tier enum (used to compute the "auto" fallback pt for display). */
  sizeEnum: FontSize | undefined
  /** Defaults for this field (resolves the auto fallback when enum is unset). */
  defaultSize: FontSize
  onPtChange: (next: number | null) => void
}

function SizePtControl({
  fieldKey,
  sizePt,
  sizeEnum,
  defaultSize,
  onPtChange,
}: SizePtControlProps): ReactNode {
  const [minRange, maxRange] = PT_RANGE[fieldKey]
  const presets = PT_PRESETS[fieldKey]
  const isAuto = sizePt == null
  const fallbackPt = SIZE_POINTS[sizeEnum ?? defaultSize]
  // What the slider / input visually displays. When auto, anchor on the
  // tier-enum's pt so the slider still reads at a sensible position.
  const effectivePt = isAuto ? fallbackPt : (sizePt as number)
  const sliderValue = Math.max(minRange, Math.min(maxRange, effectivePt))

  const commit = (next: number): void => {
    const clamped = clampPt(next)
    onPtChange(clamped)
  }

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between'>
        <Label className='text-xs font-medium'>Size</Label>
        <button
          type='button'
          onClick={() => onPtChange(null)}
          disabled={isAuto}
          className={cn(
            'text-[10px] font-medium tracking-wide uppercase transition-colors',
            isAuto
              ? 'text-muted-foreground/40 cursor-default'
              : 'text-muted-foreground hover:text-foreground cursor-pointer'
          )}
          aria-label='Reset size to default'
        >
          {isAuto ? `Auto · ${fallbackPt} pt` : 'Reset to auto'}
        </button>
      </div>
      <div className='flex items-stretch gap-1.5'>
        <Button
          type='button'
          variant='outline'
          size='icon'
          className='h-9 w-9 shrink-0'
          onClick={() => commit(effectivePt - 1)}
          aria-label='Decrease size by one point'
        >
          <IconMinus className='h-3.5 w-3.5' aria-hidden />
        </Button>
        <div className='border-input bg-background focus-within:ring-ring relative flex h-9 flex-1 items-center rounded-md border focus-within:ring-1'>
          <Input
            type='number'
            inputMode='numeric'
            min={SIZE_PT_MIN}
            max={SIZE_PT_MAX}
            value={effectivePt}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const raw = e.target.value
              if (raw === '') {
                onPtChange(null)
                return
              }
              const parsed = Number(raw)
              if (!Number.isFinite(parsed)) return
              commit(parsed)
            }}
            className='h-full border-0 bg-transparent pr-9 text-center tabular-nums focus-visible:ring-0 focus-visible:ring-offset-0'
            aria-label='Custom point size'
          />
          <span className='text-muted-foreground pointer-events-none absolute right-2.5 text-xs font-medium'>
            pt
          </span>
        </div>
        <Button
          type='button'
          variant='outline'
          size='icon'
          className='h-9 w-9 shrink-0'
          onClick={() => commit(effectivePt + 1)}
          aria-label='Increase size by one point'
        >
          <IconPlus className='h-3.5 w-3.5' aria-hidden />
        </Button>
      </div>
      <Slider
        min={minRange}
        max={maxRange}
        step={1}
        value={[sliderValue]}
        onValueChange={(vs) => {
          if (typeof vs[0] === 'number') commit(vs[0])
        }}
        aria-label='Size slider'
      />
      <div
        role='group'
        aria-label='Preset point sizes'
        className='flex flex-wrap items-center gap-1'
      >
        {presets.map((pt) => {
          const active = sizePt === pt
          return (
            <button
              key={pt}
              type='button'
              onClick={() => onPtChange(pt)}
              aria-pressed={active}
              className={cn(
                'rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              {pt}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One row per configurable text field. Top line carries Family / Weight
 * with the pt-precision Size control beside them; the in-place style
 * toggles (Bold / Italic / Underline) and Reset live in the header. The
 * secondary dimensions (transform, align, letter-spacing, color,
 * line-height) sit behind a "More" disclosure so the default view stays
 * scannable.
 */
function FieldStyleRow({
  control,
  fieldName,
  label,
  fieldKey,
  sampleText,
}: FieldStyleRowProps): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <Controller
      control={control}
      name={fieldName}
      render={({ field }) => {
        const value = (field.value as FieldStyle | undefined) ?? {}
        const sizeOptions = SIZE_OPTIONS[fieldKey]
        const setKey = (
          key: keyof FieldStyle,
          next: string | number | boolean | null | undefined
        ): void => {
          const merged: FieldStyle = { ...value }
          if (next === undefined || next === null || next === '') {
            delete merged[key]
          } else if (key === 'font') {
            merged.font = next as FontFamily
          } else if (key === 'size') {
            merged.size = next as FontSize
          } else if (key === 'weight') {
            merged.weight = next as FontWeight
          } else if (key === 'transform') {
            merged.transform = next as TextTransform
          } else if (key === 'align') {
            merged.align = next as TextAlign
          } else if (key === 'letterSpacing') {
            merged.letterSpacing = next as LetterSpacing
          } else if (key === 'color') {
            merged.color = next as string
          } else if (key === 'sizePt') {
            merged.sizePt = next as number
          } else if (key === 'lineHeight') {
            merged.lineHeight = next as number
          } else if (key === 'italic') {
            merged.italic = next as boolean
          } else if (key === 'underline') {
            merged.underline = next as boolean
          }
          field.onChange(Object.keys(merged).length === 0 ? undefined : merged)
        }
        const onReset = (): void => field.onChange(undefined)
        const isDirtyRow = Object.keys(value).length > 0
        const defaults = DEFAULT_STYLES[fieldKey]
        const isBold =
          (value.weight ?? defaults.weight) === 'bold' ||
          (value.weight ?? defaults.weight) === 'black'

        // Inline-preview style mirrors what the renderer will paint —
        // including the curator's pt override, italic, underline,
        // line-height, color, and the cn() of font-family / size-class /
        // weight / transform / align / letter-spacing classes.
        const previewClasses = fieldClasses(value, defaults)
        const previewInline = fieldInlineStyle(value, defaults)
        const previewSampleSize: CSSProperties = previewInline.fontSize
          ? {}
          : { fontSize: `${SIZE_POINTS[value.size ?? defaults.size]}pt` }

        return (
          <div className='border-border/40 bg-background flex flex-col gap-3 rounded-md border p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <Label className='text-sm font-medium'>{label}</Label>
              <div className='flex items-center gap-1'>
                <div
                  role='group'
                  aria-label={`${label} style toggles`}
                  className='border-border/60 mr-1 flex overflow-hidden rounded-md border'
                >
                  <button
                    type='button'
                    aria-label='Bold'
                    aria-pressed={isBold}
                    onClick={() => setKey('weight', isBold ? 'normal' : 'bold')}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center text-xs transition-colors',
                      isBold
                        ? 'bg-foreground/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <IconBold className='h-3.5 w-3.5' aria-hidden />
                  </button>
                  <button
                    type='button'
                    aria-label='Italic'
                    aria-pressed={!!value.italic}
                    onClick={() =>
                      setKey('italic', value.italic ? undefined : true)
                    }
                    className={cn(
                      'border-border/60 flex h-7 w-7 items-center justify-center border-l text-xs transition-colors',
                      value.italic
                        ? 'bg-foreground/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <IconItalic className='h-3.5 w-3.5' aria-hidden />
                  </button>
                  <button
                    type='button'
                    aria-label='Underline'
                    aria-pressed={!!value.underline}
                    onClick={() =>
                      setKey('underline', value.underline ? undefined : true)
                    }
                    className={cn(
                      'border-border/60 flex h-7 w-7 items-center justify-center border-l text-xs transition-colors',
                      value.underline
                        ? 'bg-foreground/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <IconUnderline className='h-3.5 w-3.5' aria-hidden />
                  </button>
                </div>
                <button
                  type='button'
                  onClick={() => setOpen((v) => !v)}
                  className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]'
                  aria-expanded={open}
                >
                  {open ? (
                    <IconChevronUp className='h-3 w-3' aria-hidden />
                  ) : (
                    <IconChevronDown className='h-3 w-3' aria-hidden />
                  )}
                  More
                </button>
                {isDirtyRow && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='text-muted-foreground hover:text-foreground h-6 px-1.5 text-[11px]'
                    onClick={onReset}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>

            <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs font-medium'>Family</Label>
                <Select
                  value={value.font ?? defaults.font}
                  onValueChange={(v) => setKey('font', v)}
                >
                  <SelectTrigger className='h-9'>
                    <SelectValue placeholder='Family' />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_FAMILY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        <span className={FONT_FAMILY_CLASS[opt.id]}>
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs font-medium'>Weight</Label>
                <Select
                  value={value.weight ?? defaults.weight}
                  onValueChange={(v) => setKey('weight', v)}
                >
                  <SelectTrigger className='h-9'>
                    <SelectValue placeholder='Weight' />
                  </SelectTrigger>
                  <SelectContent>
                    {WEIGHT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        <span className={WEIGHT_CLASS[opt.id]}>
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SizePtControl
                fieldKey={fieldKey}
                sizePt={value.sizePt ?? null}
                sizeEnum={value.size}
                defaultSize={defaults.size}
                onPtChange={(next) => setKey('sizePt', next)}
              />
            </div>

            {/* Pinned size hint — applies to either the enum OR the pt
                override. When EITHER is set, TV uniform fluid scaling is
                suppressed for this card. Sub-metric values also use the
                `primary` style slot so the same hint applies. */}
            {fieldKey === 'primary' && (
              <p
                className='text-muted-foreground/80 px-1 text-[10px]'
                data-testid='sqcdp-primary-autofit-hint'
              >
                {value.size || value.sizePt
                  ? 'TV mode: pinned size wins — uniform scaling disabled. Use the Reset button to re-enable.'
                  : 'TV mode: uniform fluid size scales every card together with the screen.'}
              </p>
            )}

            {open && (
              <div className='border-border/30 mt-1 flex flex-col gap-3 border-t pt-3'>
                <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                  <div className='flex flex-col gap-1'>
                    <Label className='text-xs font-medium'>Case</Label>
                    <Select
                      value={value.transform ?? defaults.transform}
                      onValueChange={(v) => setKey('transform', v)}
                    >
                      <SelectTrigger className='h-9'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSFORM_OPTIONS.map((opt) => (
                          <SelectItem key={opt.id} value={opt.id}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='flex flex-col gap-1'>
                    <Label className='text-xs font-medium'>
                      Letter spacing
                    </Label>
                    <ToggleGroup
                      type='single'
                      size='sm'
                      value={value.letterSpacing ?? defaults.letterSpacing}
                      onValueChange={(v) => {
                        if (v) setKey('letterSpacing', v)
                      }}
                      className='w-full'
                    >
                      {LETTER_SPACING_OPTIONS.map((opt) => (
                        <ToggleGroupItem
                          key={opt.id}
                          value={opt.id}
                          className='flex-1 text-xs'
                        >
                          {opt.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                </div>
                <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                  <div className='flex flex-col gap-1'>
                    <Label className='text-xs font-medium'>Alignment</Label>
                    <ToggleGroup
                      type='single'
                      size='sm'
                      value={value.align ?? defaults.align}
                      onValueChange={(v) => {
                        if (v) setKey('align', v)
                      }}
                      className='w-full'
                    >
                      {ALIGN_OPTIONS.map((opt) => (
                        <ToggleGroupItem
                          key={opt.id}
                          value={opt.id}
                          className='flex-1 text-xs'
                        >
                          {opt.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                  <div className='flex flex-col gap-1'>
                    <Label className='text-xs font-medium'>Text color</Label>
                    <ColorPickerInput
                      value={value.color ?? ''}
                      onChange={(next) => setKey('color', next || undefined)}
                      placeholder={
                        fieldKey === 'primary' ? '#0EA5A9' : '#1F2937'
                      }
                    />
                  </div>
                </div>
                <LineHeightControl
                  value={value.lineHeight ?? null}
                  onChange={(next) => setKey('lineHeight', next)}
                />
                <SizeTierFallback
                  fieldKey={fieldKey}
                  sizeOptions={sizeOptions}
                  currentEnum={value.size ?? defaults.size}
                  hasPtOverride={value.sizePt != null}
                  onChange={(v) => setKey('size', v)}
                />
              </div>
            )}

            <div className='border-border/30 mt-1 flex items-center justify-between gap-3 border-t pt-2'>
              <span className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'>
                Preview
              </span>
              <span
                className={cn(previewClasses, 'leading-none tabular-nums')}
                style={{ ...previewSampleSize, ...previewInline }}
                data-testid={`sqcdp-editor-row-preview-${fieldKey}`}
              >
                {sampleText}
              </span>
            </div>
          </div>
        )
      }}
    />
  )
}

/**
 * Line-height slider. Range covers the practical band a curator would
 * want — 0.85 (extra-tight headline) through 2.0 (loose body). Default
 * is the density token's leading (1.0 or 1.2 depending on the field),
 * so the "Auto" pill clears the inline override.
 */
function LineHeightControl({
  value,
  onChange,
}: {
  value: number | null
  onChange: (next: number | null) => void
}): ReactNode {
  const isAuto = value == null
  const effective = value ?? 1
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between'>
        <Label className='text-xs font-medium'>Line height</Label>
        <button
          type='button'
          onClick={() => onChange(null)}
          disabled={isAuto}
          className={cn(
            'text-[10px] font-medium tracking-wide uppercase transition-colors',
            isAuto
              ? 'text-muted-foreground/40 cursor-default'
              : 'text-muted-foreground hover:text-foreground cursor-pointer'
          )}
        >
          {isAuto ? 'Auto · 1.00×' : `Reset · ${effective.toFixed(2)}×`}
        </button>
      </div>
      <Slider
        min={0.85}
        max={2}
        step={0.05}
        value={[effective]}
        onValueChange={(vs) => {
          if (typeof vs[0] === 'number') {
            const next = Math.round(vs[0] * 100) / 100
            onChange(next === 1 ? null : next)
          }
        }}
        aria-label='Line height multiplier'
      />
    </div>
  )
}

/**
 * Legacy size-tier select kept inside More for curators who want the
 * familiar Tailwind tier names ("text-3xl" → "23 pt"). Disabled when a
 * precise pt override is active; flipping back to tier-mode just needs
 * the Reset button on the Size control.
 */
function SizeTierFallback({
  fieldKey,
  sizeOptions,
  currentEnum,
  hasPtOverride,
  onChange,
}: {
  fieldKey: 'title' | 'subtitle' | 'primary'
  sizeOptions: readonly FontSize[]
  currentEnum: FontSize
  hasPtOverride: boolean
  onChange: (next: FontSize) => void
}): ReactNode {
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center justify-between gap-2'>
        <Label className='text-xs font-medium'>Size tier (Tailwind)</Label>
        <span className='text-muted-foreground text-[10px]'>
          {hasPtOverride
            ? 'Disabled — clear the pt override to use tiers.'
            : `Fallback when Size is set to Auto · ${fieldKey}`}
        </span>
      </div>
      <Select
        disabled={hasPtOverride}
        value={currentEnum}
        onValueChange={(v) => onChange(v as FontSize)}
      >
        <SelectTrigger className='h-9'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sizeOptions.map((sz) => (
            <SelectItem key={sz} value={sz}>
              {formatSizePoints(sz)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * Reinforcement preview inside the Style tab — renders a sample "123" in
 * the curator's chosen primary-value typography so they see the size /
 * weight / color choice rendering at glance distance.
 */
function PrimaryValuePreview({
  styleConfig,
}: {
  styleConfig: StyleConfig
}): ReactNode {
  const cls = fieldClasses(styleConfig.primary, DEFAULT_STYLES.primary)
  const inline = fieldInlineStyle(styleConfig.primary, DEFAULT_STYLES.primary)
  // When no pt override and no enum override, anchor the preview at the
  // tier default so curators see the actual paint at the right scale.
  const fallback: CSSProperties = inline.fontSize
    ? {}
    : {
        fontSize: `${SIZE_POINTS[styleConfig.primary?.size ?? DEFAULT_STYLES.primary.size]}pt`,
      }
  return (
    <div className='border-border/30 mt-1 flex items-center justify-between gap-3 border-t pt-3'>
      <span className='text-muted-foreground text-[11px] tracking-wide uppercase'>
        Primary value preview
      </span>
      <span
        className={`${cls} leading-none tabular-nums`}
        style={{ ...fallback, ...inline }}
        data-testid='sqcdp-editor-primary-preview'
      >
        123
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart tab
// ---------------------------------------------------------------------------

function ChartTab({
  control,
  setValue,
}: {
  control: Control<MetricFormValues>
  setValue: UseFormSetValue<MetricFormValues>
}): ReactNode {
  const chartConfig = (useWatch({ control, name: 'chartConfig' }) ??
    {}) as ChartConfig
  const chartType = useWatch({ control, name: 'chartType' })
  const showMarkers = useWatch({ control, name: 'showMarkers' })
  const goalLines: GoalLine[] = chartConfig.goal_lines ?? []
  const targetCfg = chartConfig.target_line ?? {}
  const gridCfg = {
    show_horizontal:
      chartConfig.grid?.show_horizontal ??
      DEFAULT_CHART_CONFIG.grid.show_horizontal,
    show_vertical:
      chartConfig.grid?.show_vertical ??
      DEFAULT_CHART_CONFIG.grid.show_vertical,
    opacity: chartConfig.grid?.opacity ?? DEFAULT_CHART_CONFIG.grid.opacity,
  }
  const yAxisCfg = chartConfig.y_axis ?? {}

  const updateChartConfig = (patch: Partial<ChartConfig>): void => {
    setValue('chartConfig', { ...chartConfig, ...patch }, { shouldDirty: true })
  }

  const updateTargetLine = (
    patch: Partial<NonNullable<ChartConfig['target_line']>>
  ): void => {
    updateChartConfig({ target_line: { ...targetCfg, ...patch } })
  }

  const updateGrid = (
    patch: Partial<NonNullable<ChartConfig['grid']>>
  ): void => {
    updateChartConfig({ grid: { ...gridCfg, ...patch } })
  }

  const updateYAxis = (
    patch: Partial<NonNullable<ChartConfig['y_axis']>>
  ): void => {
    updateChartConfig({ y_axis: { ...yAxisCfg, ...patch } })
  }

  const resetChart = (): void => {
    setValue('chartConfig', {}, { shouldDirty: true })
  }

  return (
    <div className='flex flex-col gap-5'>
      <Section
        eyebrow='1 · Display'
        title='Chart geometry'
        description='Pick how the series is drawn below the headline value.'
        action={
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 px-2 text-xs'
            disabled={Object.keys(chartConfig).length === 0}
            onClick={resetChart}
          >
            Reset chart
          </Button>
        }
      >
        <div className='flex flex-col gap-2'>
          <Label className='text-sm font-medium'>Chart type</Label>
          <ToggleGroup
            type='single'
            size='default'
            value={chartType}
            onValueChange={(v) => {
              if (v === 'line' || v === 'area' || v === 'bar') {
                setValue('chartType', v, { shouldDirty: true })
              }
            }}
            className='w-full'
            aria-label='Chart type'
          >
            {CHART_TYPE_OPTIONS.map((opt) => {
              const Icon = opt.Icon
              return (
                <ToggleGroupItem
                  key={opt.id}
                  value={opt.id}
                  className='flex-1 gap-2'
                  aria-label={opt.label}
                >
                  <Icon className='h-4 w-4' aria-hidden />
                  {opt.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </div>
        <SwitchRow
          label='Show data points'
          description={
            chartType === 'bar'
              ? 'Bar charts already mark each bar — this toggle is ignored for bars.'
              : 'Render circles at every recorded data point.'
          }
          checked={showMarkers ?? false}
          onCheckedChange={(next) =>
            setValue('showMarkers', next, { shouldDirty: true })
          }
        />
      </Section>

      <Section
        eyebrow='2 · Curve & axis'
        title='Geometry & scale'
        description='How the line / area interpolates and what the Y-axis shows.'
      >
        <div className='flex flex-col gap-2'>
          <Label className='text-sm font-medium'>Curve type</Label>
          <ToggleGroup
            type='single'
            size='sm'
            value={chartConfig.curve ?? DEFAULT_CHART_CONFIG.curve}
            onValueChange={(v) => {
              if (v) updateChartConfig({ curve: v as CurveType })
            }}
            className='w-full'
          >
            {CURVE_TYPES.map((c) => (
              <ToggleGroupItem
                key={c.id}
                value={c.id}
                className='flex-1 text-xs'
              >
                {c.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className='text-muted-foreground text-[11px]'>
            Bar variant ignores the curve type.
          </p>
        </div>
        <SwitchRow
          label='Show Y-axis labels'
          description='Numeric tick values along the Y-axis. Off by default — the period chip carries the time scope.'
          checked={yAxisCfg.show ?? false}
          onCheckedChange={(next) => updateYAxis({ show: next })}
        />
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <NumberWithAutoChip
            label='Y-axis min'
            value={yAxisCfg.min ?? null}
            onChange={(next) => updateYAxis({ min: next })}
          />
          <NumberWithAutoChip
            label='Y-axis max'
            value={yAxisCfg.max ?? null}
            onChange={(next) => updateYAxis({ max: next })}
          />
        </div>
      </Section>

      <Section
        eyebrow='3 · Grid'
        title='Backdrop reference lines'
        description='Faint grid behind the data — opacity capped at 50%.'
      >
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <SwitchRow
            label='Horizontal lines'
            checked={gridCfg.show_horizontal}
            onCheckedChange={(next) => updateGrid({ show_horizontal: next })}
          />
          <SwitchRow
            label='Vertical lines'
            checked={gridCfg.show_vertical}
            onCheckedChange={(next) => updateGrid({ show_vertical: next })}
          />
        </div>
        <div className='flex flex-col gap-2'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>Grid opacity</Label>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {gridCfg.opacity}%
            </span>
          </div>
          <Slider
            min={0}
            max={50}
            step={1}
            value={[gridCfg.opacity]}
            onValueChange={(vs) =>
              updateGrid({ opacity: typeof vs[0] === 'number' ? vs[0] : 6 })
            }
            aria-label='Grid opacity'
          />
        </div>
      </Section>

      <Section
        eyebrow='4 · Reference lines'
        title='Target + goal overlays'
        description='Layer one or more horizontal lines on top of the chart.'
        action={
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 px-2 text-xs'
            disabled={
              goalLines.length === 0 && Object.keys(targetCfg).length === 0
            }
            onClick={() =>
              updateChartConfig({ goal_lines: [], target_line: {} })
            }
          >
            Reset lines
          </Button>
        }
      >
        <div className='border-border/40 bg-background flex flex-col gap-3 rounded-md border p-3'>
          <div className='flex flex-col gap-0.5'>
            <p className='text-foreground text-xs font-semibold'>
              Primary target line
            </p>
            <p className='text-muted-foreground text-[11px]'>
              Auto-renders at the metric&apos;s target value when set. Override
              its color, style, width, or label here.
            </p>
          </div>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            <div className='flex flex-col gap-1'>
              <Label className='text-xs font-medium'>Color</Label>
              <ColorPickerInput
                value={targetCfg.color_hex ?? ''}
                onChange={(next) =>
                  updateTargetLine({ color_hex: next || null })
                }
              />
            </div>
            <div className='flex flex-col gap-1'>
              <Label className='text-xs font-medium'>Style</Label>
              <ToggleGroup
                type='single'
                size='sm'
                value={
                  targetCfg.style ?? DEFAULT_CHART_CONFIG.target_line.style
                }
                onValueChange={(v) => {
                  if (v) updateTargetLine({ style: v as LineStyle })
                }}
                className='w-full'
              >
                {LINE_STYLE_OPTIONS.map((opt) => (
                  <ToggleGroupItem
                    key={opt.id}
                    value={opt.id}
                    className='flex-1 text-xs'
                  >
                    {opt.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
          <div className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <Label className='text-xs font-medium'>Line width</Label>
              <span className='text-muted-foreground text-xs tabular-nums'>
                {targetCfg.width ?? DEFAULT_CHART_CONFIG.target_line.width}px
              </span>
            </div>
            <Slider
              min={1}
              max={3}
              step={1}
              value={[
                targetCfg.width ?? DEFAULT_CHART_CONFIG.target_line.width,
              ]}
              onValueChange={(vs) => {
                const n = typeof vs[0] === 'number' ? vs[0] : 1
                updateTargetLine({ width: n as LineWidth })
              }}
              aria-label='Target line width'
            />
          </div>
          <SwitchRow
            label='Show target label'
            description='Render a "Target {value}" tag on the right side of the line.'
            checked={targetCfg.show_label ?? false}
            onCheckedChange={(next) => updateTargetLine({ show_label: next })}
          />
        </div>

        <div className='border-border/40 bg-background flex flex-col gap-3 rounded-md border p-3'>
          <div className='flex flex-col gap-0.5'>
            <p className='text-foreground text-xs font-semibold'>
              Additional goal lines
            </p>
            <p className='text-muted-foreground text-[11px]'>
              Drag to reorder. Each line carries its own color, style, and
              width.
            </p>
          </div>
          <SqcdpGoalLinesEditor
            value={goalLines}
            onChange={(next) => updateChartConfig({ goal_lines: next })}
          />
        </div>
      </Section>

      <Section
        eyebrow='5 · Annotations'
        title='Highlight noteworthy points'
        description='Layer summary stats or call out the min and max.'
      >
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <SwitchRow
            label='Show average line'
            description='Faint dashed line at the historical mean.'
            checked={chartConfig.show_average ?? false}
            onCheckedChange={(next) =>
              updateChartConfig({ show_average: next })
            }
          />
          <SwitchRow
            label='Highlight min / max'
            description='Bumps the matching dot or bar plus a caption row.'
            checked={chartConfig.highlight_extremes ?? false}
            onCheckedChange={(next) =>
              updateChartConfig({ highlight_extremes: next })
            }
          />
        </div>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Advanced tab
// ---------------------------------------------------------------------------

function AdvancedTab({
  control,
}: {
  control: Control<MetricFormValues>
}): ReactNode {
  return (
    <div className='flex flex-col gap-5'>
      <Section
        eyebrow='1 · Stacked sub-metrics'
        title='Multiple values inside one card'
        description='Drag to reorder. When at least one sub-metric is present the card swaps from the headline value to the stacked layout.'
      >
        <Controller
          control={control}
          name='subMetrics'
          render={({ field }) => (
            <SqcdpSubMetricsEditor
              value={(field.value as SubMetric[]) ?? []}
              onChange={field.onChange}
            />
          )}
        />
      </Section>

      <Section
        eyebrow='2 · Notes & visibility'
        title='Curator notes and on-board state'
        description='Notes are private to curators; visibility hides the card while you draft.'
      >
        <FormField
          control={control}
          name='notes'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Internal notes</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  placeholder='Context for the next curator — data source, definition, watch-outs…'
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name='isVisible'
          render={({ field }) => (
            <SwitchRow
              label='Visible on board'
              description='Hide while you draft a new metric without removing it.'
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------

export function SqcdpEditorDialog({
  open,
  mode,
  onClose,
}: SqcdpEditorDialogProps) {
  const [renderKey, setRenderKey] = useState(0)
  useEffect(() => {
    setRenderKey((k) => k + 1)
  }, [mode])

  const [isDirty, setIsDirty] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const { categories } = useSqcdpCategoriesContext()

  const attemptClose = (): void => {
    if (isDirty) {
      setConfirmExit(true)
      return
    }
    onClose()
  }

  if (!mode) return null

  const isMetricEdit = !!mode.metric
  const title = mode.metric
    ? `Edit metric · ${mode.metric.title}`
    : 'New metric'
  const description =
    'Configure the headline metric for this SQCDP category — basics, style, chart, and history.'

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && attemptClose()}>
        <DialogContent className='flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1180px]'>
          <DialogHeader className='border-border/40 shrink-0 border-b px-6 py-4'>
            <DialogTitle className='flex items-center gap-2'>
              {isMetricEdit && mode.metric ? (
                <span
                  aria-hidden
                  className='inline-block h-2.5 w-2.5 rounded-full'
                  style={{
                    backgroundColor:
                      mode.metric.colorHex ??
                      defaultColorFor(mode.metric.category, categories),
                  }}
                />
              ) : null}
              <span>{title}</span>
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div
            key={renderKey}
            className='flex min-h-0 flex-1 flex-col overflow-hidden'
          >
            <MetricForm
              initial={{ metric: mode.metric, category: mode.category }}
              onClose={onClose}
              setIsDirty={setIsDirty}
            />
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        isOpen={confirmExit}
        title='Discard unsaved changes?'
        message='Your edits will be lost.'
        variant='warning'
        confirmText='Discard'
        cancelText='Keep editing'
        onCancel={() => setConfirmExit(false)}
        onConfirm={() => {
          setConfirmExit(false)
          setIsDirty(false)
          onClose()
        }}
      />
    </>
  )
}

// Created and developed by Jai Singh
