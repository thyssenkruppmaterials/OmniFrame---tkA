// Created and developed by Jai Singh
import * as React from 'react'
import { cn } from '@/lib/utils'

export type KpiGridDensity = 'compact' | 'comfortable'

export interface KpiGridProps extends React.ComponentProps<'div'> {
  /**
   * Number of columns the grid uses.
   *
   * - `2` and `3` are **unconditional** — the grid stays at that column
   *   count regardless of container width. This matches the pre-container-
   *   query design and is safe because `<StatTile>` already handles narrow-
   *   cell overflow via `min-w-0` + `truncate` + `tabular-nums` + a `title`
   *   tooltip on the raw value.
   * - `4`, `5`, and `6` step DOWN on truly narrow containers (Tailwind v4
   *   container queries on the parent `@container/kpi-grid`) so that a
   *   4/5/6-tile strip doesn't crush each tile to an unreadable width when
   *   the surrounding card is squeezed.
   *
   * Defaults to `3` — the standard "Total / Pending / Completed" pill
   * strip. Use `4` for outbound/delivery status cards and `2` for the
   * accuracy-style two-up.
   */
  columns?: 2 | 3 | 4 | 5 | 6
  /** `comfortable` (default) = `gap-3`, `compact` = `gap-2`. */
  density?: KpiGridDensity
}

const COLUMN_CLASS: Record<NonNullable<KpiGridProps['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 @md/kpi-grid:grid-cols-4',
  5: 'grid-cols-2 @sm/kpi-grid:grid-cols-3 @lg/kpi-grid:grid-cols-5',
  6: 'grid-cols-2 @sm/kpi-grid:grid-cols-3 @lg/kpi-grid:grid-cols-6',
}

const DENSITY_CLASS: Record<KpiGridDensity, string> = {
  compact: 'gap-2',
  comfortable: 'gap-3',
}

/**
 * Container-query grid for KPI/stat tiles.
 *
 * Drop `<StatTile>` instances inside. The grid collapses to fewer columns
 * when the *container* (e.g. its parent `<Card>`) is narrow — not when the
 * viewport is narrow — so it behaves correctly when embedded in a side
 * panel or split layout.
 */
export function KpiGrid({
  columns = 3,
  density = 'comfortable',
  className,
  ...props
}: KpiGridProps) {
  return (
    <div
      data-slot='kpi-grid'
      data-columns={columns}
      className={cn(
        '@container/kpi-grid grid min-w-0',
        COLUMN_CLASS[columns],
        DENSITY_CLASS[density],
        className
      )}
      {...props}
    />
  )
}

KpiGrid.displayName = 'KpiGrid'

// Created and developed by Jai Singh
