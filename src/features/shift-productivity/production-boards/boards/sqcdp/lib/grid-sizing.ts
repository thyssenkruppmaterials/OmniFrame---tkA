// Created and developed by Jai Singh
/**
 * Pure helpers for the dynamic SQCDP grid layout.
 *
 * Tailwind v4's JIT can't see template-literal class strings (e.g.
 * `flex-${n}`), so the static maps below enumerate every value the
 * runtime might pick. See [[Patterns/Per-Field-Style-Overrides]] for
 * the canonical rationale.
 *
 * Lives in its own module (instead of next to the grid component) so
 * it can be unit-tested without mounting React, and so the
 * `react-refresh/only-export-components` lint rule stays happy on
 * `<SqcdpGrid>`.
 */

/**
 * Static maps. Adding a new column count or flex weight requires
 * appending here so the JIT picks up the class literal.
 */
export const GRID_COLS_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
}

export const FLEX_WEIGHT_CLASS: Record<number, string> = {
  1: 'flex-1',
  2: 'flex-2',
  3: 'flex-3',
  4: 'flex-4',
  5: 'flex-5',
  6: 'flex-6',
  7: 'flex-7',
  8: 'flex-8',
}

export const SQCDP_GRID_MAX_COLS = 6
export const SQCDP_GRID_MAX_FLEX = 8

function clampCols(count: number): number {
  return Math.max(1, Math.min(count, SQCDP_GRID_MAX_COLS))
}

function clampFlex(weight: number): number {
  return Math.max(1, Math.min(Math.round(weight), SQCDP_GRID_MAX_FLEX))
}

/**
 * Derives a tier's flex weight from its category count. Primaries get
 * a 1.5× multiplier so they consume more vertical budget at the same
 * card count (they carry the chart strip; secondaries don't). Result
 * is clamped to `[1, 8]`.
 */
function tierFlexWeight(count: number, tier: 'primary' | 'secondary'): number {
  if (count === 0) return 0
  return clampFlex(tier === 'primary' ? Math.ceil(count * 1.5) : count)
}

export function resolveGridSizing(
  primaryCount: number,
  secondaryCount: number
): {
  primaryColsClass: string
  primaryFlexClass: string
  secondaryColsClass: string
  secondaryFlexClass: string
} {
  return {
    primaryColsClass: GRID_COLS_CLASS[clampCols(primaryCount)],
    primaryFlexClass:
      tierFlexWeight(primaryCount, 'primary') === 0
        ? ''
        : FLEX_WEIGHT_CLASS[tierFlexWeight(primaryCount, 'primary')],
    secondaryColsClass: GRID_COLS_CLASS[clampCols(secondaryCount)],
    secondaryFlexClass:
      tierFlexWeight(secondaryCount, 'secondary') === 0
        ? ''
        : FLEX_WEIGHT_CLASS[tierFlexWeight(secondaryCount, 'secondary')],
  }
}

// Created and developed by Jai Singh
