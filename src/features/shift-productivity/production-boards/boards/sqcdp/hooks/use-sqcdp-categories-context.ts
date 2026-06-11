// Created and developed by Jai Singh
/**
 * Hook + context-value type for `<SqcdpCategoriesProvider>`. Lives in a
 * separate file from the provider component so React Fast Refresh stays
 * happy (the `react-refresh/only-export-components` rule complains when
 * a `.tsx` provider file also exports a hook).
 */
import { createContext, useContext } from 'react'
import { BUILTIN_CATEGORIES, type SqcdpCategoryDef } from '../lib/categories'
import type { SqcdpCategoryRow } from './use-sqcdp-categories'

export interface SqcdpCategoryManagerOpenOptions {
  /**
   * When set, opens the manager directly into the create form
   * pre-populated with this tier. Use `'create'` to bypass the list view
   * entirely.
   */
  initialMode?: 'list' | 'create'
  initialTier?: SqcdpCategoryDef['tier']
}

export interface SqcdpCategoriesContextValue {
  categories: SqcdpCategoryRow[]
  visibleCategories: SqcdpCategoryRow[]
  isLoading: boolean
  isFetching: boolean
  refresh: () => void
  openManager: (options?: SqcdpCategoryManagerOpenOptions) => void
  closeManager: () => void
  isManagerOpen: boolean
}

export const SqcdpCategoriesContext =
  createContext<SqcdpCategoriesContextValue | null>(null)

/**
 * Reads the resolved category list. When called outside the provider
 * (e.g. a unit test that mounts a single component) returns the
 * builtin seed so the consumer never crashes — same fallback behaviour
 * as `useSqcdpCategories`'s empty-org branch.
 */
export function useSqcdpCategoriesContext(): SqcdpCategoriesContextValue {
  const ctx = useContext(SqcdpCategoriesContext)
  if (ctx) return ctx
  const fallback = BUILTIN_CATEGORIES.map((c) => ({
    ...c,
    rowId: `builtin-fallback-${c.id}`,
    organizationId: '',
  }))
  return {
    categories: fallback,
    visibleCategories: fallback,
    isLoading: false,
    isFetching: false,
    refresh: () => undefined,
    openManager: () => undefined,
    closeManager: () => undefined,
    isManagerOpen: false,
  }
}

// Created and developed by Jai Singh
