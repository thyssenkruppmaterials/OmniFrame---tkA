// Created and developed by Jai Singh
/**
 * SQCDP Scorecards board — variable primary + secondary KPI cards.
 * Both row counts are driven by the org's
 * `production_board_sqcdp_categories` table (migration 306) so curators
 * can add / remove / reorder / hide categories at runtime via the
 * `<SqcdpCategoryManagerDialog>`.
 *
 * TV mode renders the metric grid at TV density inside a TvFrame.
 *
 * The Problems surface (Add Problem button, problems table, problem
 * editor branch) was retired on 2026-05-17. The
 * `production_board_sqcdp_problems` table + its RLS / triggers /
 * composite FKs are intentionally preserved in the database in case
 * the UI is brought back later; see
 * `memorybank/OmniFrame/Sessions/2026-05-17.md` § "Remove SQCDP Problems UI".
 */
import { useState } from 'react'
import { IconCategory, IconDeviceTv, IconRefresh } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TvFrame } from '../../components/tv-frame'
import { useBoardEditMode } from '../../hooks/use-board-edit-mode'
import { useCanEditBoards } from '../../hooks/use-can-edit-boards'
import type { BoardProps } from '../../lib/boards'
import { SqcdpCard } from './components/sqcdp-card'
import { SqcdpCategoriesProvider } from './components/sqcdp-categories-provider'
import {
  SqcdpEditorDialog,
  type SqcdpEditorMode,
} from './components/sqcdp-editor-dialog'
import { SqcdpGrid } from './components/sqcdp-grid'
import { SqcdpHeroFitProvider } from './components/sqcdp-hero-fit-provider'
import { useSqcdpCategoriesContext } from './hooks/use-sqcdp-categories-context'
import { useSqcdpMetrics, type SqcdpMetricRow } from './hooks/use-sqcdp-metrics'
import {
  visiblePrimaryCategories,
  visibleSecondaryCategories,
  type SqcdpCategoryDef,
  type SqcdpCategoryId,
} from './lib/categories'
import { resolveGridSizing } from './lib/grid-sizing'

export function SqcdpBoard(props: BoardProps) {
  return (
    <SqcdpCategoriesProvider>
      <SqcdpBoardInner {...props} />
    </SqcdpCategoriesProvider>
  )
}

function SqcdpBoardInner({ isTv, onExitTv, onEnterTv }: BoardProps) {
  const {
    metrics,
    isLoading: loadingMetrics,
    isFetching: fetchingMetrics,
    refresh: refreshMetrics,
  } = useSqcdpMetrics()
  const { canEdit } = useCanEditBoards()
  const [editMode] = useBoardEditMode()
  const showEditAffordances = canEdit && editMode
  const { categories, openManager } = useSqcdpCategoriesContext()

  const [editor, setEditor] = useState<{
    open: boolean
    mode: SqcdpEditorMode | null
  }>({ open: false, mode: null })

  const openMetric = (metric: SqcdpMetricRow): void => {
    setEditor({ open: true, mode: { type: 'metric', metric } })
  }
  const createMetric = (category: SqcdpCategoryId): void => {
    setEditor({ open: true, mode: { type: 'metric', category } })
  }

  const refresh = (): void => {
    refreshMetrics()
  }

  if (isTv) {
    return (
      <TvFrame
        title='SQCDP Scorecards'
        subtitle='Safety · Quality · Cost · Delivery · Production · plus secondaries'
        timezone='America/New_York'
        lastUpdatedAt={new Date()}
        onExit={onExitTv}
        kpiStrip={null}
      >
        <SqcdpHeroFitProvider enabled>
          {loadingMetrics && metrics.length === 0 ? (
            <SqcdpGridSkeleton density='tv' categories={categories} />
          ) : (
            <SqcdpGrid metrics={metrics} density='tv' />
          )}
        </SqcdpHeroFitProvider>
      </TvFrame>
    )
  }

  const isFetching = fetchingMetrics

  return (
    <div className='space-y-4 lg:space-y-6'>
      <div className='flex flex-wrap items-center justify-end gap-2'>
        {showEditAffordances && (
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => openManager()}
            className='gap-2'
            data-testid='sqcdp-manage-categories-button'
          >
            <IconCategory className='h-4 w-4' aria-hidden /> Manage categories
          </Button>
        )}
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={refresh}
          disabled={isFetching}
          className='gap-2'
        >
          <IconRefresh
            className={cn('h-4 w-4', isFetching && 'animate-spin')}
          />
          Refresh
        </Button>
        <Button
          type='button'
          size='sm'
          variant='default'
          onClick={onEnterTv}
          className='gap-2'
        >
          <IconDeviceTv className='h-4 w-4' aria-hidden />
          Display on TV
        </Button>
      </div>

      {loadingMetrics && metrics.length === 0 ? (
        <SqcdpGridSkeleton density='normal' categories={categories} />
      ) : (
        <SqcdpGrid
          metrics={metrics}
          density='normal'
          onEdit={openMetric}
          onCreate={createMetric}
        />
      )}

      <SqcdpEditorDialog
        open={editor.open}
        mode={editor.mode}
        onClose={() => setEditor({ open: false, mode: null })}
      />
    </div>
  )
}

interface SqcdpGridSkeletonProps {
  density: 'normal' | 'tv'
  categories: readonly SqcdpCategoryDef[]
}

function SqcdpGridSkeleton({ density, categories }: SqcdpGridSkeletonProps) {
  // Re-uses the empty cards from SqcdpGrid so the skeleton matches the
  // production layout exactly — including the dynamic flex-weight chain
  // from `lib/grid-sizing.ts` (primary tier carries chart strip → ~1.5×
  // weight). Empty cards double as a passable loading shimmer.
  const isTv = density === 'tv'
  const primary = visiblePrimaryCategories(categories)
  const secondary = visibleSecondaryCategories(categories)
  const sizing = resolveGridSizing(primary.length, secondary.length)

  return (
    <div
      className={cn(
        isTv ? 'flex h-full flex-col gap-6' : 'space-y-4 lg:space-y-6'
      )}
    >
      {primary.length > 0 && (
        <div
          className={cn(
            'grid',
            sizing.primaryColsClass,
            isTv ? 'gap-6' : 'gap-4',
            isTv && 'min-h-0 auto-rows-fr',
            isTv && sizing.primaryFlexClass
          )}
        >
          {primary.map((c) => (
            <SqcdpCard
              key={c.id}
              category={c.id}
              metric={null}
              density={density}
              categoryOverride={c}
            />
          ))}
        </div>
      )}
      {secondary.length > 0 && (
        <div
          className={cn(
            'grid',
            sizing.secondaryColsClass,
            isTv ? 'gap-5' : 'gap-3',
            isTv && 'min-h-0 auto-rows-fr',
            isTv && sizing.secondaryFlexClass
          )}
        >
          {secondary.map((c) => (
            <SqcdpCard
              key={c.id}
              category={c.id}
              metric={null}
              density={density}
              categoryOverride={c}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default SqcdpBoard

// Created and developed by Jai Singh
