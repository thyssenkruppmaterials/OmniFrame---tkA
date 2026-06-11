// Created and developed by Jai Singh
/**
 * Hourly Completion Tracker board entry-point.
 *
 * Encapsulates the per-area tab strip, KPI strip, and per-area body that the
 * v1–v5 production-boards page used to ship as a single page. The new
 * top-level page (production-boards-page.tsx) delegates here when
 * `boardSlug === 'hourly'`.
 *
 * The board owns its own:
 *   - `?area=` URL state (independent of the global `?board=` state)
 *   - per-area auto-rotation in TV mode
 *   - empty / loading states
 *   - TV mode rendering (TvFrame chrome)
 *
 * The global page outside this board provides the `<BoardEditToggle>` and
 * the board-tabs; this board does not.
 */
import { useEffect, useMemo } from 'react'
import {
  IconDeviceTv,
  IconRefresh,
  IconRestore,
  IconUserOff,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TvFrame } from '../../components/tv-frame'
import { readSearchParam } from '../../lib/url-search-state'
import { AreaTransitionFrame } from './components/area-transition-frame'
import { BoardLegend } from './components/board-legend'
import { BoardMetrics } from './components/board-metrics'
import { HourlyCompletionBoard } from './components/hourly-completion-board'
import {
  ALL_AREAS_VALUE,
  useAreaSearchParam,
} from './hooks/use-area-search-param'
import { useHourlyProductivity } from './hooks/use-hourly-productivity'
import { BOARD_HOURS } from './lib/hour-bucket'
import type { AssociateRow } from './lib/types'

const ROTATION_INTERVAL_MS = 30_000

interface AreaTabOption {
  /** URL value — `all` for the aggregate tab, or the area_code. */
  value: string
  /** UUID of the working area; null for the aggregate tab. */
  id: string | null
  area_code: string
  area_name: string
  associateCount: number
}

interface HourlyBoardProps {
  /** True when ?tv=1 is on. The board renders its own TvFrame. */
  isTv: boolean
  onExitTv: () => void
  onEnterTv: () => void
}

function countAssociatesByArea(
  associates: AssociateRow[]
): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of associates) {
    if (!a.workingAreaId) continue
    out.set(a.workingAreaId, (out.get(a.workingAreaId) ?? 0) + 1)
  }
  return out
}

function HourlyBoardSkeleton({
  density = 'normal',
}: {
  density?: 'normal' | 'tv'
}) {
  const isTv = density === 'tv'
  return (
    <Card className='border-border/50 bg-card/50 backdrop-blur-sm'>
      <CardContent className='space-y-2 p-6'>
        <div className='flex items-center justify-between'>
          <Skeleton className='h-5 w-48' />
          <Skeleton className='h-3 w-32' />
        </div>
        <div className='space-y-1.5'>
          {Array.from({ length: 10 }).map((_, row) => (
            <div
              key={row}
              className='border-border/40 flex items-center gap-2 border-b pb-1.5'
            >
              <div className='flex w-[200px] items-center gap-2'>
                <Skeleton
                  className={cn(isTv ? 'h-12 w-12' : 'h-8 w-8', 'rounded-full')}
                />
                <div className='flex-1 space-y-1'>
                  <Skeleton className='h-3 w-24' />
                  <Skeleton className='h-2 w-32' />
                </div>
              </div>
              {Array.from({ length: BOARD_HOURS.length }).map((__, col) => (
                <Skeleton
                  key={col}
                  className={cn(isTv ? 'h-10 w-20' : 'h-8 w-14', 'rounded-sm')}
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyAreaState({
  areaName,
  density = 'normal',
}: {
  areaName: string
  density?: 'normal' | 'tv'
}) {
  const isTv = density === 'tv'
  return (
    <Card className='border-border/50 bg-card/50 backdrop-blur-sm'>
      <CardContent
        className={cn(
          'flex flex-col items-center justify-center gap-3 text-center',
          isTv ? 'py-24' : 'py-16'
        )}
      >
        <div
          className={cn(
            'bg-muted/40 flex items-center justify-center rounded-2xl',
            isTv ? 'h-20 w-20' : 'h-14 w-14'
          )}
        >
          <IconUserOff
            className={cn(
              'text-muted-foreground',
              isTv ? 'h-10 w-10' : 'h-7 w-7'
            )}
            aria-hidden
          />
        </div>
        <h3
          className={cn(
            'font-semibold tracking-tight',
            isTv ? 'text-2xl' : 'text-base'
          )}
        >
          No associates assigned to {areaName}
        </h3>
        <p
          className={cn(
            'text-muted-foreground max-w-md',
            isTv ? 'text-base' : 'text-sm'
          )}
        >
          Assign associates to this area in Labor Management to populate the
          hourly tracker.
        </p>
      </CardContent>
    </Card>
  )
}

export function HourlyBoard({ isTv, onExitTv, onEnterTv }: HourlyBoardProps) {
  const board = useHourlyProductivity()
  const [activeAreaValue, setActiveAreaValue] = useAreaSearchParam()

  const associateCounts = useMemo(
    () => countAssociatesByArea(board.allAssociates),
    [board.allAssociates]
  )

  const areaTabs = useMemo<AreaTabOption[]>(() => {
    const active = board.workingAreas.filter((w) => w.is_active)
    const tabs: AreaTabOption[] = [
      {
        value: ALL_AREAS_VALUE,
        id: null,
        area_code: 'ALL',
        area_name: 'All Areas',
        associateCount: board.allAssociates.length,
      },
    ]
    for (const w of active) {
      tabs.push({
        value: w.area_code || w.id,
        id: w.id,
        area_code: w.area_code,
        area_name: w.area_name,
        associateCount: associateCounts.get(w.id) ?? 0,
      })
    }
    return tabs
  }, [board.workingAreas, board.allAssociates.length, associateCounts])

  const activeTab = useMemo<AreaTabOption>(() => {
    const found = areaTabs.find((t) => t.value === activeAreaValue)
    return found ?? areaTabs[0]
  }, [areaTabs, activeAreaValue])

  const targetWorkingAreaIds = useMemo<string[]>(
    () => (activeTab.id ? [activeTab.id] : []),
    [activeTab.id]
  )

  const updateFiltersRef = board.updateFilters
  const filtersWorkingAreaIds = board.filters.workingAreaIds
  useEffect(() => {
    const next = targetWorkingAreaIds
    const prev = filtersWorkingAreaIds
    const same =
      next.length === prev.length && next.every((id, i) => prev[i] === id)
    if (!same) {
      updateFiltersRef({ workingAreaIds: next })
    }
  }, [targetWorkingAreaIds, filtersWorkingAreaIds, updateFiltersRef])

  // Auto-rotation in TV mode when on All Areas (gated on the *initial* URL
  // param so a deep-linked area pins rotation off).
  const initialRotationParam = useMemo(
    () => readSearchParam('area') ?? ALL_AREAS_VALUE,
    []
  )
  const rotationActive =
    isTv && initialRotationParam === ALL_AREAS_VALUE && areaTabs.length > 1
  useEffect(() => {
    if (!rotationActive) return
    const id = window.setInterval(() => {
      setActiveAreaValue(
        (() => {
          const current = readSearchParam('area') ?? ALL_AREAS_VALUE
          const idx = areaTabs.findIndex((t) => t.value === current)
          const nextIdx = idx < 0 ? 0 : (idx + 1) % areaTabs.length
          return areaTabs[nextIdx].value
        })()
      )
    }, ROTATION_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [rotationActive, areaTabs, setActiveAreaValue])

  const metricsNode = (density: 'normal' | 'tv') => (
    <BoardMetrics
      associates={board.associates}
      hourBuckets={board.hourBuckets}
      hourTargets={board.hourTargets}
      isToday={board.isToday}
      timezone={board.timezone}
      density={density}
      isLoading={board.isLoading && board.associates.length === 0}
    />
  )

  const boardNode = (density: 'normal' | 'tv', bare = false) => {
    if (board.isLoading && board.associates.length === 0) {
      return <HourlyBoardSkeleton density={density} />
    }
    if (activeTab.id && !board.isLoading && board.associates.length === 0) {
      return <EmptyAreaState areaName={activeTab.area_name} density={density} />
    }
    return (
      <HourlyCompletionBoard
        associates={board.associates}
        currentHour={board.currentHour}
        isToday={board.isToday}
        isLoading={board.isLoading}
        isFetching={board.isFetching}
        lastUpdatedAt={board.lastUpdatedAt}
        timezone={board.timezone}
        selectedDate={board.selectedDate}
        getCellState={board.getCellState}
        getCellBucket={board.getCellBucket}
        density={density}
        bare={bare}
      />
    )
  }

  if (isTv) {
    const subtitle =
      activeTab.value === ALL_AREAS_VALUE
        ? 'Production Boards · All Areas'
        : `Production Boards · ${activeTab.area_code}`
    return (
      <TvFrame
        title='Hourly Completion Tracker'
        subtitle={subtitle}
        areaName={activeTab.area_name}
        areaCode={
          activeTab.value === ALL_AREAS_VALUE ? undefined : activeTab.area_code
        }
        timezone={board.timezone}
        lastUpdatedAt={board.lastUpdatedAt}
        rotationActive={rotationActive}
        rotationLabel={`Rotating areas every ${ROTATION_INTERVAL_MS / 1000}s`}
        footerLegend={<BoardLegend density='tv' />}
        onExit={onExitTv}
      >
        <AreaTransitionFrame
          activeAreaValue={activeTab.value}
          isTv
          isRotating={rotationActive}
          areaCode={activeTab.area_code}
          areaName={activeTab.area_name}
          associateCount={activeTab.associateCount}
        >
          <div className='space-y-8'>
            {metricsNode('tv')}
            {boardNode('tv', true)}
          </div>
        </AreaTransitionFrame>
      </TvFrame>
    )
  }

  return (
    <div className='space-y-4 lg:space-y-6'>
      <div className='flex flex-wrap items-center justify-end gap-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={board.goToToday}
          disabled={board.isToday}
          className='gap-2'
        >
          <IconRestore className='h-4 w-4' />
          Today
        </Button>
        <Button
          variant='outline'
          size='sm'
          onClick={board.refresh}
          className='gap-2'
          disabled={board.isFetching}
        >
          <IconRefresh
            className={cn('h-4 w-4', board.isFetching && 'animate-spin')}
          />
          Refresh
        </Button>
        <Button
          variant='default'
          size='sm'
          onClick={onEnterTv}
          className='gap-2'
        >
          <IconDeviceTv className='h-4 w-4' />
          Display on TV
        </Button>
      </div>

      <Tabs
        value={activeTab.value}
        onValueChange={setActiveAreaValue}
        className='space-y-4 lg:space-y-6'
      >
        <TabsList className='bg-muted/40 flex h-auto w-full flex-wrap justify-start gap-1 rounded-lg p-1'>
          {areaTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className='data-[state=active]:bg-background h-auto gap-2 px-3 py-1.5 text-sm font-medium'
            >
              <span>{tab.area_name}</span>
              <span className='inline-flex items-center justify-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 tabular-nums dark:text-emerald-400'>
                {tab.associateCount}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {areaTabs.map((tab) => (
          <TabsContent
            key={tab.value}
            value={tab.value}
            className='space-y-4 lg:space-y-6'
          >
            {tab.value === activeTab.value && (
              <>
                {tab.id && tab.associateCount === 0 ? (
                  <EmptyAreaState areaName={tab.area_name} />
                ) : (
                  <>
                    {metricsNode('normal')}
                    {boardNode('normal')}
                  </>
                )}
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

export default HourlyBoard

// Created and developed by Jai Singh
