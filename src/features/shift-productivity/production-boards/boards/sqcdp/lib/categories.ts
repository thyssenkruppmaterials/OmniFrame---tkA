// Created and developed by Jai Singh
/**
 * SQCDP categories — the runtime-resolved list.
 *
 * Migration 306 (2026-05-17) replaced the hardcoded 9-entry
 * `sqcdp_category` Postgres ENUM with a per-org
 * `production_board_sqcdp_categories` table. This module is now a
 * read-side helper: it provides the builtin seed + lookup helpers that
 * take a categories list as input. The list itself comes from
 * `useSqcdpCategories()` and is threaded through the board via the
 * `<SqcdpCategoriesProvider>` context.
 *
 * `BUILTIN_CATEGORY_SEED` is the source of truth for the 9 canonical
 * SQCDP entries. Migration 306 holds the same values in SQL — keep the
 * two in sync (the unit test in `categories.test.ts` enforces this by
 * shape).
 */
import type { Icon } from '@tabler/icons-react'
import { resolveCategoryIcon } from './category-icons'

/**
 * Slug type alias. Categories are now string-keyed (the FK on
 * `sqcdp_metrics.category` is `TEXT` since migration 306). The 9
 * builtin slugs (`safety`, `quality`, ...) keep their literal types
 * via `BuiltinSqcdpCategoryId` so existing hard-coded references
 * (e.g. seed UI defaults) stay narrowly typed.
 */
export type SqcdpCategoryId = string

export type BuiltinSqcdpCategoryId =
  | 'safety'
  | 'quality'
  | 'cost'
  | 'delivery'
  | 'production'
  | 'maintenance'
  | 'shipping'
  | 'big_idea'
  | 'announcement'

export type SqcdpCategoryTier = 'primary' | 'secondary'

export interface SqcdpCategoryDef {
  id: SqcdpCategoryId
  label: string
  /** Stable hex color used by card colors + the chart accent. */
  defaultColor: string
  /** Resolved Tabler icon component (NOT the raw `icon_name` string). */
  Icon: Icon
  /** The raw icon name from the DB (`SQCDP_CATEGORY_ICONS` key). */
  iconName: string
  tier: SqcdpCategoryTier
  /** Per-org display order within the tier. */
  displayOrder: number
  /** True for the 9 canonical SQCDP entries seeded by migration 306. */
  isBuiltin: boolean
  /** True when the curator has hidden the category from the board. */
  isHidden: boolean
}

/**
 * The 9 canonical SQCDP categories. Migration 306 seeds this exact
 * list into `production_board_sqcdp_categories` for every org, with
 * `is_builtin = TRUE`. The `<SqcdpCategoryManagerDialog>` "Reset to
 * defaults" affordance re-applies these values to any builtin row that
 * has been edited / hidden / reordered.
 *
 * Order matters: primaries display in the grid header row in the
 * order listed; secondaries below in the listed order.
 */
export interface BuiltinCategorySeed {
  id: BuiltinSqcdpCategoryId
  label: string
  defaultColor: string
  iconName: string
  tier: SqcdpCategoryTier
  displayOrder: number
}

export const BUILTIN_CATEGORY_SEED: readonly BuiltinCategorySeed[] = [
  {
    id: 'safety',
    label: 'Safety',
    defaultColor: '#DC2626',
    iconName: 'IconShield',
    tier: 'primary',
    displayOrder: 0,
  },
  {
    id: 'quality',
    label: 'Quality',
    defaultColor: '#16A34A',
    iconName: 'IconCheck',
    tier: 'primary',
    displayOrder: 1,
  },
  {
    id: 'cost',
    label: 'Cost',
    defaultColor: '#EA580C',
    iconName: 'IconCash',
    tier: 'primary',
    displayOrder: 2,
  },
  {
    id: 'delivery',
    label: 'Delivery',
    defaultColor: '#0EA5A9',
    iconName: 'IconTruck',
    tier: 'primary',
    displayOrder: 3,
  },
  {
    id: 'production',
    label: 'Production',
    defaultColor: '#CA8A04',
    iconName: 'IconBuildingFactory2',
    tier: 'primary',
    displayOrder: 4,
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    defaultColor: '#7C3AED',
    iconName: 'IconTool',
    tier: 'secondary',
    displayOrder: 0,
  },
  {
    id: 'shipping',
    label: 'Shipping',
    defaultColor: '#9333EA',
    iconName: 'IconPackageExport',
    tier: 'secondary',
    displayOrder: 1,
  },
  {
    id: 'big_idea',
    label: 'Big Idea',
    defaultColor: '#1E3A8A',
    iconName: 'IconBulb',
    tier: 'secondary',
    displayOrder: 2,
  },
  {
    id: 'announcement',
    label: 'Announcement',
    defaultColor: '#0EA5E9',
    iconName: 'IconSpeakerphone',
    tier: 'secondary',
    displayOrder: 3,
  },
] as const

export const BUILTIN_SQCDP_CATEGORY_IDS: readonly BuiltinSqcdpCategoryId[] =
  BUILTIN_CATEGORY_SEED.map((c) => c.id)

/**
 * Resolves the seed list into runtime `SqcdpCategoryDef`s. Used as the
 * empty-org fallback when the `useSqcdpCategories` query somehow
 * returns zero rows for the caller's org (very rare — the trigger in
 * migration 306 seeds builtins on org creation).
 */
export const BUILTIN_CATEGORIES: readonly SqcdpCategoryDef[] =
  BUILTIN_CATEGORY_SEED.map((c) => ({
    id: c.id,
    label: c.label,
    defaultColor: c.defaultColor,
    Icon: resolveCategoryIcon(c.iconName),
    iconName: c.iconName,
    tier: c.tier,
    displayOrder: c.displayOrder,
    isBuiltin: true,
    isHidden: false,
  }))

/**
 * Pure lookup over a passed-in resolved list. Falls back to the
 * builtin seed if the slug matches a canonical builtin but isn't
 * present in the list (e.g. the row was deleted manually). Returns
 * `null` when nothing matches — callers should handle that case
 * gracefully (typically by skipping the metric or rendering a
 * placeholder card).
 */
export function getCategory(
  id: SqcdpCategoryId,
  categories: readonly SqcdpCategoryDef[]
): SqcdpCategoryDef | null {
  const found = categories.find((c) => c.id === id)
  if (found) return found
  const builtin = BUILTIN_CATEGORIES.find((c) => c.id === id)
  return builtin ?? null
}

/**
 * Strict lookup that throws when the category isn't found. Use only
 * inside contexts where the caller has already validated the slug
 * exists (e.g. immediately after `categories.includes(...)` checks).
 */
export function getCategoryOrThrow(
  id: SqcdpCategoryId,
  categories: readonly SqcdpCategoryDef[]
): SqcdpCategoryDef {
  const cat = getCategory(id, categories)
  if (!cat) throw new Error(`Unknown SQCDP category: ${id}`)
  return cat
}

/**
 * Pure lookup for the default color. Returns the seed default when the
 * slug matches a builtin even if the row has been deleted from the DB,
 * which keeps cards rendering even if the migration's seed has been
 * tampered with.
 */
export function defaultColorFor(
  id: SqcdpCategoryId,
  categories: readonly SqcdpCategoryDef[]
): string {
  const cat = getCategory(id, categories)
  if (cat) return cat.defaultColor
  // Last-resort neutral fallback so the UI never paints `undefined` as
  // a CSS color (which collapses styling rules silently).
  return '#0EA5A9'
}

/**
 * Convert any user-typed string into a slug suitable for the
 * `production_board_sqcdp_categories.slug` CHECK constraint
 * (`^[a-z0-9_]+$`). Falls back to a non-empty placeholder so the
 * CHECK never trips on whitespace-only input.
 */
export function slugifyCategoryLabel(input: string): string {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (cleaned.length === 0) return 'category'
  return cleaned.slice(0, 64)
}

/**
 * Filter helpers used by both `<SqcdpGrid>` and
 * `<SqcdpCategoryManagerDialog>`.
 */
export function visiblePrimaryCategories(
  categories: readonly SqcdpCategoryDef[]
): SqcdpCategoryDef[] {
  return categories
    .filter((c) => c.tier === 'primary' && !c.isHidden)
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

export function visibleSecondaryCategories(
  categories: readonly SqcdpCategoryDef[]
): SqcdpCategoryDef[] {
  return categories
    .filter((c) => c.tier === 'secondary' && !c.isHidden)
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

// Created and developed by Jai Singh
