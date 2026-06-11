// Created and developed by Jai Singh
/**
 * Labor Board Column Component
 * Droppable area column for the interactive labor board
 * Uses @dnd-kit for drop zone mechanics, anime.js for pulse effects
 * FLIP animations handled at board level -- cards are plain elements here
 * Created: February 7, 2026
 * Updated: February 8, 2026 - Replaced framer-motion with anime.js
 */
import { memo, useRef, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { animate } from 'animejs'
import { MapPin, Users, AlertTriangle, Inbox, UserX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { LaborBoardColumn as LaborBoardColumnType } from '../types/team-performance.types'
import { getEfficiencyColor } from '../types/team-performance.types'
import { LaborBoardCard } from './labor-board-card'

interface LaborBoardColumnProps {
  column: LaborBoardColumnType
  activeDragId: string | null
  readOnly?: boolean
  allColumns?: LaborBoardColumnType[]
  onMoveToArea?: (associateId: string, targetAreaId: string | null) => void
}

function LaborBoardColumnInner({
  column,
  activeDragId,
  readOnly = false,
  allColumns = [],
  onMoveToArea,
}: LaborBoardColumnProps) {
  const columnRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const emptyRef = useRef<HTMLDivElement>(null)

  const { isOver, setNodeRef } = useDroppable({
    id: column.id,
    data: {
      type: 'column',
      columnId: column.id,
      areaName: column.area_name,
      capacity: column.capacity,
      currentCount: column.totalAssociates,
    },
  })

  const isUnassigned = column.type === 'unassigned'
  const capacityPercent = column.capacity
    ? Math.min(
        100,
        Math.round((column.totalAssociates / column.capacity) * 100)
      )
    : null
  const efficiencyColor = getEfficiencyColor(column.efficiency)

  // Determine capacity status for visual indicators
  const capacityStatus = column.capacity
    ? column.totalAssociates >= column.capacity
      ? 'full'
      : column.totalAssociates >= column.capacity * 0.85
        ? 'warning'
        : 'normal'
    : 'normal'

  // Anime.js pulse effect on drag-over
  useEffect(() => {
    if (!columnRef.current || !activeDragId) return

    if (isOver) {
      animate(columnRef.current, {
        boxShadow: [
          '0 0 0 0px rgba(59, 130, 246, 0)',
          '0 0 0 3px rgba(59, 130, 246, 0.2)',
        ],
        ease: 'outSine',
        duration: 250,
      })
    } else {
      animate(columnRef.current, {
        boxShadow: '0 0 0 0px rgba(59, 130, 246, 0)',
        ease: 'inSine',
        duration: 200,
      })
    }
  }, [isOver, activeDragId])

  // Anime.js fade-in for empty state
  useEffect(() => {
    if (!emptyRef.current || column.associates.length > 0) return
    animate(emptyRef.current, {
      opacity: [0, 1],
      scale: [0.96, 1],
      ease: 'outExpo',
      duration: 300,
    })
  }, [column.associates.length])

  // Merge refs: dnd-kit setNodeRef + our columnRef
  const mergedRef = (node: HTMLDivElement | null) => {
    setNodeRef(node)
    ;(columnRef as React.MutableRefObject<HTMLDivElement | null>).current = node
  }

  return (
    <div
      ref={mergedRef}
      className={cn(
        'bg-card/50 flex flex-col rounded-xl border transition-colors duration-200',
        'w-[300px] min-w-[300px] shrink-0',
        // Drop target visual feedback (CSS for border, anime.js for glow)
        isOver && activeDragId && 'border-primary/50 bg-primary/2',
        isOver &&
          activeDragId &&
          column.isOverCapacity &&
          'border-amber-500/50',
        // Unassigned column distinct style
        isUnassigned && 'border-muted-foreground/30 bg-muted/20 border-dashed',
        // Over capacity
        column.isOverCapacity && !isOver && 'border-amber-500/30'
      )}
      style={{ contain: 'layout style' }}
      aria-label={`${column.area_name} area, ${column.totalAssociates} associates${column.capacity ? ` of ${column.capacity} capacity` : ''}`}
    >
      {/* Column Header */}
      <div
        className={cn(
          'shrink-0 border-b p-3',
          !isUnassigned && 'border-t-[3px]'
        )}
        style={!isUnassigned ? { borderTopColor: column.color } : undefined}
      >
        <div className='mb-1.5 flex items-center justify-between'>
          <div className='flex min-w-0 items-center gap-2'>
            {isUnassigned ? (
              <UserX className='text-muted-foreground h-4 w-4 shrink-0' />
            ) : (
              <MapPin
                className='h-4 w-4 shrink-0'
                style={{ color: column.color }}
              />
            )}
            <h3 className='truncate text-sm font-semibold'>
              {column.area_name}
            </h3>
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            {column.isOverCapacity && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger>
                    <AlertTriangle className='h-3.5 w-3.5 text-amber-500' />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className='text-xs'>
                      Over capacity ({column.totalAssociates}/{column.capacity})
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Badge variant='secondary' className='h-5 px-1.5 py-0 text-[11px]'>
              <Users className='mr-1 h-3 w-3' />
              {column.totalAssociates}
              {column.capacity ? `/${column.capacity}` : ''}
            </Badge>
          </div>
        </div>

        {/* Area code + efficiency row */}
        {!isUnassigned && (
          <div className='flex items-center justify-between text-[11px]'>
            {column.area_code && (
              <span className='text-muted-foreground'>{column.area_code}</span>
            )}
            {column.totalAssociates > 0 && (
              <span className={cn('font-medium tabular-nums', efficiencyColor)}>
                {column.efficiency}% avg eff.
              </span>
            )}
          </div>
        )}

        {/* Capacity Progress Bar */}
        {capacityPercent !== null && (
          <div className='mt-2'>
            <Progress
              value={capacityPercent}
              className={cn(
                'h-1.5',
                capacityStatus === 'full' && '[&>div]:bg-red-500',
                capacityStatus === 'warning' && '[&>div]:bg-amber-500',
                capacityStatus === 'normal' && '[&>div]:bg-primary'
              )}
            />
          </div>
        )}
      </div>

      {/* Cards Container */}
      <div
        ref={scrollRef}
        role='listbox'
        aria-orientation='vertical'
        aria-label={`${column.area_name} associates`}
        className={cn(
          'flex-1 space-y-1.5 overflow-y-auto p-2',
          'max-h-[calc(100vh-320px)] min-h-[120px]',
          'scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent'
        )}
      >
        {column.associates.length > 0 ? (
          column.associates.map((associate) => (
            <LaborBoardCard
              key={associate.user_id}
              associate={associate}
              isDragging={activeDragId === associate.user_id}
              readOnly={readOnly}
              availableAreas={allColumns}
              onMoveToArea={onMoveToArea}
            />
          ))
        ) : (
          <div
            ref={emptyRef}
            className={cn(
              'flex flex-col items-center justify-center py-8 text-center',
              'rounded-lg border-2 border-dashed',
              isOver && activeDragId
                ? 'border-primary/40 bg-primary/3'
                : 'border-muted-foreground/15'
            )}
          >
            <Inbox className='text-muted-foreground/30 mb-2 h-8 w-8' />
            <p className='text-muted-foreground/60 text-xs'>
              {isUnassigned
                ? 'No unassigned associates'
                : 'Drop associates here'}
            </p>
            {column.capacity != null && (
              <p className='text-muted-foreground/40 mt-0.5 text-[10px]'>
                Capacity: {column.capacity}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Column Footer - Stats */}
      {!isUnassigned && column.totalAssociates > 0 && (
        <div className='shrink-0 border-t p-2'>
          <div className='text-muted-foreground flex items-center justify-between text-[10px]'>
            <span>{column.activeAssociates} active</span>
            <span className='tabular-nums'>
              {column.associates.reduce((sum, a) => sum + a.total_tasks, 0)}{' '}
              tasks
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export const LaborBoardColumn = memo(LaborBoardColumnInner, (prev, next) => {
  return (
    prev.column.id === next.column.id &&
    prev.column.totalAssociates === next.column.totalAssociates &&
    prev.column.efficiency === next.column.efficiency &&
    prev.column.isOverCapacity === next.column.isOverCapacity &&
    prev.activeDragId === next.activeDragId &&
    prev.readOnly === next.readOnly &&
    prev.column.associates === next.column.associates
  )
})

LaborBoardColumn.displayName = 'LaborBoardColumn'

export default LaborBoardColumn

// Created and developed by Jai Singh
