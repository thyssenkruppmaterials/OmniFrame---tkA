// Created and developed by Jai Singh
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Accent palette used by KPI/stat tiles. Each accent maps to a foreground
 * color token + a soft background tint so the value reads as colour-coded
 * without saturating the entire tile. Add new keys here rather than passing
 * raw Tailwind classes through `accentClassName`.
 */
export type StatTileAccent =
  | 'default'
  | 'sky'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'orange'

const ACCENT_VALUE_CLASS: Record<StatTileAccent, string> = {
  default: 'text-foreground',
  sky: 'text-sky-600 dark:text-sky-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  rose: 'text-rose-600 dark:text-rose-400',
  violet: 'text-violet-600 dark:text-violet-400',
  orange: 'text-orange-600 dark:text-orange-400',
}

const ACCENT_SURFACE_CLASS: Record<StatTileAccent, string> = {
  default: 'bg-card',
  sky: 'bg-sky-500/5 dark:bg-sky-500/10',
  emerald: 'bg-emerald-500/5 dark:bg-emerald-500/10',
  amber: 'bg-amber-500/5 dark:bg-amber-500/10',
  rose: 'bg-rose-500/5 dark:bg-rose-500/10',
  violet: 'bg-violet-500/5 dark:bg-violet-500/10',
  orange: 'bg-orange-500/5 dark:bg-orange-500/10',
}

/**
 * Locale-aware integer formatter. Returns the input untouched if it can't be
 * coerced to a finite number — e.g. an already-formatted "—" or "N/A".
 */
function formatStatValue(
  value: React.ReactNode,
  format: StatTileProps['format']
): React.ReactNode {
  if (format === 'raw' || value == null || value === '') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value
    if (format === 'count') return value.toLocaleString()
    if (format === 'percent') return `${value}%`
    return value.toLocaleString()
  }
  if (typeof value === 'string' && format === 'count') {
    const asNumber = Number(value)
    if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
      return asNumber.toLocaleString()
    }
  }
  return value
}

export interface StatTileProps extends Omit<
  React.ComponentProps<'div'>,
  'title'
> {
  /** Short uppercase label shown above the value. */
  label: React.ReactNode
  /**
   * Primary value. Integer numbers are run through `toLocaleString()` when
   * `format === 'count'`. Use `format='raw'` if the value is a JSX node or
   * already-formatted string that should not be touched.
   */
  value: React.ReactNode
  /** Optional small descriptor under the value (units, delta, etc.). */
  hint?: React.ReactNode
  /** Optional leading icon (e.g. Lucide). Rendered next to the label. */
  icon?: React.ReactNode
  /** Color accent applied to the value text and the tile surface tint. */
  accent?: StatTileAccent
  /**
   * `count` (default) runs `.toLocaleString()` on numeric values.
   * `percent` appends `%`.
   * `raw` renders the value as-is (use for JSX, currency strings, etc.).
   */
  format?: 'count' | 'percent' | 'raw'
  /**
   * Override for the tooltip / accessibility fallback shown when the value
   * is truncated. Defaults to `String(value)`.
   */
  valueTitle?: string
  /** Class names appended to the outer tile. */
  className?: string
  /** Optional class on the value element (for size overrides). */
  valueClassName?: string
}

/**
 * Container-query aware KPI tile. Pair with `<KpiGrid>` for the standard
 * dashboard-pill layout.
 *
 * Three things this primitive guarantees that hand-rolled tiles forget:
 * 1. `min-w-0` on every flex/grid ancestor so a wide value can actually
 *    shrink into a smaller column instead of pushing horizontal scroll.
 * 2. `truncate` + `title=` on the value, so an overflowing number is
 *    clipped with `…` AND the full string is still reachable on hover /
 *    via assistive tech.
 * 3. Typography steps down via `@container/stat-tile` queries, so the
 *    value gets smaller when the *tile* is narrow, not just when the
 *    viewport is narrow (matters inside split panes / sidebars).
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  accent = 'default',
  format = 'count',
  valueTitle,
  className,
  valueClassName,
  ...props
}: StatTileProps) {
  const displayValue = formatStatValue(value, format)
  const titleFallback =
    valueTitle ??
    (value == null
      ? undefined
      : typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : undefined)

  return (
    <div
      data-slot='stat-tile'
      data-accent={accent}
      className={cn(
        'group @container/stat-tile relative isolate flex min-w-0 flex-col gap-1 rounded-lg border p-3 transition-colors',
        '@sm/stat-tile:gap-1.5 @sm/stat-tile:p-4',
        '@lg/stat-tile:p-5',
        ACCENT_SURFACE_CLASS[accent],
        className
      )}
      {...props}
    >
      <div className='flex min-w-0 items-center gap-1.5'>
        {icon ? (
          <span
            aria-hidden
            className={cn(
              'inline-flex shrink-0 items-center justify-center',
              '[&_svg]:size-3.5 @sm/stat-tile:[&_svg]:size-4',
              ACCENT_VALUE_CLASS[accent]
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className='text-muted-foreground min-w-0 truncate text-[10px] font-medium tracking-wide uppercase @sm/stat-tile:text-xs'>
          {label}
        </span>
      </div>
      <div
        data-slot='stat-tile-value'
        title={titleFallback}
        className={cn(
          'min-w-0 truncate text-lg font-semibold tracking-tight tabular-nums',
          '@sm/stat-tile:text-xl @md/stat-tile:text-2xl @xl/stat-tile:text-3xl',
          ACCENT_VALUE_CLASS[accent],
          valueClassName
        )}
      >
        {displayValue}
      </div>
      {hint ? (
        <div className='text-muted-foreground min-w-0 truncate text-[10px] @sm/stat-tile:text-xs'>
          {hint}
        </div>
      ) : null}
    </div>
  )
}

StatTile.displayName = 'StatTile'

// Created and developed by Jai Singh
