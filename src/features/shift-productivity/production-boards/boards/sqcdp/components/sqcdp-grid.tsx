// Created and developed by Jai Singh
import { useMemo } from 'react'
import { MotionConfig, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useSqcdpCategoriesContext } from '../hooks/use-sqcdp-categories-context'
import type { SqcdpMetricRow } from '../hooks/use-sqcdp-metrics'
import {
  visiblePrimaryCategories,
  visibleSecondaryCategories,
  type SqcdpCategoryDef,
  type SqcdpCategoryId,
} from '../lib/categories'
import { resolveGridSizing } from '../lib/grid-sizing'
import { SqcdpCard, type SqcdpCardDensity } from './sqcdp-card'

interface SqcdpGridProps {
  metrics: SqcdpMetricRow[]
  density?: SqcdpCardDensity
  onEdit?: (metric: SqcdpMetricRow) => void
  onCreate?: (category: SqcdpCategoryId) => void
  /**
   * Optional override for tests / Storybook. Default: read from the
   * `<SqcdpCategoriesProvider>` context.
   */
  categoriesOverride?: readonly SqcdpCategoryDef[]
}

const EASE = [0.22, 1, 0.36, 1] as const

const containerVariants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.08, delayChildren: 0.15 },
  },
}

const cardVariants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE },
  },
}

/**
 * SQCDP scorecard grid. Iterates over the org's visible categories
 * (provided by `<SqcdpCategoriesProvider>`) so empty placeholder cards
 * render alongside populated ones. The 5+3 hardcoded split was retired
 * in 2026-05-17 — both row counts and the flex-weight split are now
 * dynamic in `count` and clamped via the static class maps in
 * `lib/grid-sizing.ts`.
 */
export function SqcdpGrid({
  metrics,
  density = 'normal',
  onEdit,
  onCreate,
  categoriesOverride,
}: SqcdpGridProps) {
  const ctx = useSqcdpCategoriesContext()
  const categories = categoriesOverride ?? ctx.categories

  const primary = useMemo(
    () => visiblePrimaryCategories(categories),
    [categories]
  )
  const secondary = useMemo(
    () => visibleSecondaryCategories(categories),
    [categories]
  )

  const byCategory = useMemo(() => {
    const map = new Map<SqcdpCategoryId, SqcdpMetricRow>()
    const sorted = [...metrics].sort((a, b) => a.displayOrder - b.displayOrder)
    for (const m of sorted) {
      if (!map.has(m.category)) map.set(m.category, m)
    }
    return map
  }, [metrics])

  const isTv = density === 'tv'
  const primaryGap = isTv ? 'gap-6' : 'gap-4'
  const secondaryGap = isTv ? 'gap-5' : 'gap-3'

  const sizing = resolveGridSizing(primary.length, secondary.length)

  return (
    <MotionConfig reducedMotion='user'>
      <div
        className={cn(
          isTv ? 'flex h-full flex-col gap-6' : 'space-y-4 lg:space-y-6'
        )}
      >
        {primary.length > 0 && (
          <motion.div
            variants={containerVariants}
            initial='initial'
            animate='animate'
            className={cn(
              'grid',
              sizing.primaryColsClass,
              primaryGap,
              isTv && 'min-h-0 auto-rows-fr',
              isTv && sizing.primaryFlexClass
            )}
            data-component='sqcdp-primary-row'
            data-tier-count={primary.length}
          >
            {primary.map((cat, idx) => (
              <motion.div
                key={cat.id}
                variants={cardVariants}
                className='h-full'
              >
                <SqcdpCard
                  category={cat.id}
                  metric={byCategory.get(cat.id) ?? null}
                  density={density}
                  index={idx}
                  mountAnimation={false}
                  onEdit={onEdit}
                  onCreate={onCreate}
                  categoryOverride={cat}
                />
              </motion.div>
            ))}
          </motion.div>
        )}

        {secondary.length > 0 && (
          <div
            className={cn(
              'grid',
              sizing.secondaryColsClass,
              secondaryGap,
              isTv && 'min-h-0 auto-rows-fr',
              isTv && sizing.secondaryFlexClass
            )}
            data-component='sqcdp-secondary-row'
            data-tier-count={secondary.length}
          >
            {secondary.map((cat) => (
              <SqcdpCard
                key={cat.id}
                category={cat.id}
                metric={byCategory.get(cat.id) ?? null}
                density={density}
                onEdit={onEdit}
                onCreate={onCreate}
                categoryOverride={cat}
              />
            ))}
          </div>
        )}
      </div>
    </MotionConfig>
  )
}

// Created and developed by Jai Singh
