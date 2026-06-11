// Created and developed by Jai Singh
/**
 * SqcdpCategoriesProvider — exposes the org's resolved category list
 * + the manager dialog's open/close handle to all SQCDP descendants
 * (board, grid, card, editor) so they can render dynamic categories
 * without each running their own query.
 *
 * The provider also owns the `<SqcdpCategoryManagerDialog>` mount,
 * so any descendant can call `openManager()` (e.g. the metric editor's
 * inline "Manage…" link) without prop-drilling the dialog state.
 *
 * The hook + context type live in `../hooks/use-sqcdp-categories-context.ts`
 * so this `.tsx` file only exports the React component (keeps Fast
 * Refresh happy via `react-refresh/only-export-components`).
 */
import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useSqcdpCategories } from '../hooks/use-sqcdp-categories'
import {
  SqcdpCategoriesContext,
  type SqcdpCategoriesContextValue,
  type SqcdpCategoryManagerOpenOptions,
} from '../hooks/use-sqcdp-categories-context'
import type { SqcdpCategoryDef } from '../lib/categories'
import { SqcdpCategoryManagerDialog } from './sqcdp-category-manager-dialog'

interface SqcdpCategoriesProviderProps {
  children: ReactNode
}

export function SqcdpCategoriesProvider({
  children,
}: SqcdpCategoriesProviderProps) {
  const hookValue = useSqcdpCategories()
  const [managerState, setManagerState] = useState<{
    open: boolean
    initialMode: 'list' | 'create'
    initialTier: SqcdpCategoryDef['tier']
  }>({ open: false, initialMode: 'list', initialTier: 'primary' })

  const openManager = useCallback(
    (options?: SqcdpCategoryManagerOpenOptions) => {
      setManagerState({
        open: true,
        initialMode: options?.initialMode ?? 'list',
        initialTier: options?.initialTier ?? 'primary',
      })
    },
    []
  )
  const closeManager = useCallback((): void => {
    setManagerState((s) => ({ ...s, open: false }))
  }, [])

  const value = useMemo<SqcdpCategoriesContextValue>(
    () => ({
      categories: hookValue.categories,
      visibleCategories: hookValue.visibleCategories,
      isLoading: hookValue.isLoading,
      isFetching: hookValue.isFetching,
      refresh: hookValue.refresh,
      openManager,
      closeManager,
      isManagerOpen: managerState.open,
    }),
    [hookValue, openManager, closeManager, managerState.open]
  )

  return (
    <SqcdpCategoriesContext.Provider value={value}>
      {children}
      <SqcdpCategoryManagerDialog
        open={managerState.open}
        onClose={closeManager}
        initialMode={managerState.initialMode}
        initialTier={managerState.initialTier}
      />
    </SqcdpCategoriesContext.Provider>
  )
}

// Created and developed by Jai Singh
