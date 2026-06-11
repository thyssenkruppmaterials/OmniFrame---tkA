// Created and developed by Jai Singh
/**
 * `<WorkQueueManagementTab>` — page-level component for the new
 * "Work Queue Management" tab in Inventory Management. Owns:
 *
 *   - The toolbar: search, status filter, live chip, refresh.
 *   - The `<MotionConfig reducedMotion="user">` wrapper so every
 *     descendant springs/transitions honour the OS preference by
 *     default.
 *   - The `<TooltipProvider>` (lifts above the lane chrome and
 *     drag overlay so tooltips on dragged cards still work).
 *   - `useActiveWorkers` to source the live operator list, which
 *     it filters before handing to `<DispatcherGrid>`.
 *
 * The dispatcher canvas itself lives in `<DispatcherGrid>`; this
 * file is the framing + toolbar + reduced-motion gate.
 *
 * Inserted into `inventory-management.tsx` as the new tab between
 * "Inventory Counts" and "Operation Control". RBAC and tab
 * visibility are wired through `<TabMenu>` like the other tabs —
 * see the migration `293_seed_work_queue_management_tab.sql` for
 * the seed of `tab_definitions` + `role_tab_permissions`.
 */
import { useMemo, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { Filter, RefreshCw, Search as SearchIcon, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkerStatus, WorkerStatusType } from '@/lib/work-service/types'
import { useActiveWorkers } from '@/hooks/use-active-workers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DispatcherGrid } from './dispatcher-grid'

type StatusFilter = 'all' | 'busy' | 'online' | 'idle' | 'break'

/**
 * Sort priority for the dispatcher columns. Mirrors
 * `live-operator-status.tsx` so the supervisor sees the SAME
 * ordering when they flip between the "Active Operators" panel
 * and this dispatcher view: busy → online → idle → break.
 */
const STATUS_PRIORITY: Record<WorkerStatusType, number> = {
  busy: 0,
  online: 1,
  idle: 2,
  break: 3,
  offline: 4,
}

export default function WorkQueueManagementTab() {
  const {
    workers,
    isLoading,
    refreshWorkers,
    isWsConnected,
    onlineCount,
    busyCount,
    idleCount,
    breakCount,
  } = useActiveWorkers()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Sort the active operators canonically (busy first), then strip
  // the offline ones — the dispatcher only shows operators who
  // could actually take work. The grid handles its own ghost-lane
  // mounting for operators who just went offline (they re-appear
  // as faded lanes with a 6s TTL, see `useGhostLaneWorkers`).
  const filteredWorkers = useMemo<WorkerStatus[]>(() => {
    const sorted = [...workers].sort(
      (a, b) =>
        (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99)
    )
    return sorted
      .filter((w) => w.status !== 'offline')
      .filter((w) => {
        if (statusFilter === 'all') return true
        return w.status === statusFilter
      })
      .filter((w) => {
        if (!search) return true
        const q = search.toLowerCase()
        const name = (w.full_name ?? '').toLowerCase()
        const email = (w.email ?? '').toLowerCase()
        const zone = (w.current_zone ?? '').toLowerCase()
        return name.includes(q) || email.includes(q) || zone.includes(q)
      })
  }, [workers, statusFilter, search])

  const activeCount = onlineCount + busyCount + idleCount + breakCount

  return (
    <TooltipProvider delayDuration={250}>
      <MotionConfig reducedMotion='user'>
        <div className='flex flex-col gap-4'>
          {/* Toolbar */}
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div className='flex min-w-0 flex-1 items-center gap-2'>
              <div className='relative max-w-md flex-1'>
                <SearchIcon className='text-muted-foreground/60 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder='Search operators by name, email or zone…'
                  className='h-8 pl-8 text-xs'
                  aria-label='Search operators'
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger
                  size='sm'
                  className='h-8 min-w-[140px] text-xs'
                  aria-label='Filter by operator status'
                >
                  <Filter className='text-muted-foreground/60 h-3.5 w-3.5' />
                  <SelectValue placeholder='Status' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All statuses</SelectItem>
                  <SelectItem value='busy'>Busy</SelectItem>
                  <SelectItem value='online'>Online</SelectItem>
                  <SelectItem value='idle'>Idle</SelectItem>
                  <SelectItem value='break'>Break</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='flex shrink-0 items-center gap-2'>
              <p className='text-muted-foreground text-[11px] tabular-nums'>
                <span className='text-foreground font-semibold'>
                  {filteredWorkers.length}
                </span>{' '}
                of <span className='font-semibold'>{activeCount}</span> shown
              </p>
              <LiveChip isWsConnected={isWsConnected} />
              <Button
                variant='ghost'
                size='sm'
                onClick={refreshWorkers}
                disabled={isLoading}
                className='h-8 w-8 rounded-md p-0'
                aria-label='Refresh dispatcher'
                title='Refresh'
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')}
                />
              </Button>
            </div>
          </div>

          {/* Dispatcher canvas */}
          <DispatcherGrid
            workers={filteredWorkers}
            isWorkersLoading={isLoading}
          />

          {/* Footer help text */}
          <p className='text-muted-foreground/70 text-[10px] italic'>
            Drag a task to its position within a lane to reorder. Drag across
            lanes to reassign — the change pushes to the operator immediately
            and is reversible from the toast for{' '}
            <span className='font-mono'>8s</span>. Reorders are saved per
            operator on this device; the operator's RF queue still claims tasks
            in canonical priority order until a server-side reorder endpoint
            ships.
          </p>
        </div>
      </MotionConfig>
    </TooltipProvider>
  )
}

interface LiveChipProps {
  isWsConnected: boolean
}

function LiveChip({ isWsConnected }: LiveChipProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-wide uppercase',
        isWsConnected
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
      )}
      role='status'
      aria-live='polite'
      aria-label={
        isWsConnected ? 'Realtime connected' : 'Realtime reconnecting'
      }
    >
      {isWsConnected ? (
        <>
          <span className='relative flex h-1.5 w-1.5'>
            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
            <span className='relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500' />
          </span>
          Live
        </>
      ) : (
        <>
          <WifiOff className='h-2.5 w-2.5' />
          Reconnecting…
        </>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
