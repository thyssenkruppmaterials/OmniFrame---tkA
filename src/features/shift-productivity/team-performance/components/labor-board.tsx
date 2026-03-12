/**
 * Labor Board Component
 * Interactive drag-and-drop board for managing associate area assignments
 * Uses @dnd-kit for drag mechanics, anime.js for fluid spring animations
 * FLIP system tracks card positions and animates cross-column movement
 * Created: February 7, 2026
 * Updated: February 8, 2026 - Replaced framer-motion with anime.js 4.3.5
 */
import { useState, useMemo, useEffect } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import {
  Search,
  LayoutGrid,
  Info,
  Loader2,
  ArrowRight,
  MapPin,
  UserX,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  useColumnEntrance,
  useDragOverlaySpring,
  useBannerEntrance,
} from '../hooks/use-anime-effects'
import { useAnimeFlip } from '../hooks/use-anime-flip'
import { useLaborBoard } from '../hooks/use-labor-board'
import type { TeamPerformanceData } from '../types/team-performance.types'
import { LaborBoardCard } from './labor-board-card'
import { LaborBoardColumn } from './labor-board-column'

interface LaborBoardProps {
  data: TeamPerformanceData | undefined
  isLoading: boolean
  isToday: boolean
  organizationId: string
  className?: string
}

export function LaborBoard({
  data,
  isLoading,
  isToday,
  organizationId,
  className,
}: LaborBoardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'break' | 'offline'
  >('all')
  const [reason, setReason] = useState('')

  const {
    columns,
    activeDragId,
    activeAssociate,
    sensors,
    announcements,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    handleMoveToArea,
    confirmOpen,
    pendingReassignment,
    handleConfirmReassign,
    handleCancelReassign,
    readOnly,
    isReassigning,
  } = useLaborBoard({ data, isToday, organizationId })

  // === Anime.js Hooks ===

  // FLIP system for card position tracking and spring animations
  const { containerRef: flipContainerRef, capturePositions } = useAnimeFlip({
    enabled: !isLoading && !!data,
  })

  // Column stagger entrance on first data load
  const columnEntranceRef = useColumnEntrance(!isLoading && !!data)

  // Drag overlay spring effect
  const overlayRef = useDragOverlaySpring(!!activeAssociate)

  // Read-only banner entrance
  const bannerRef = useBannerEntrance(readOnly)

  // Capture card positions before optimistic updates cause re-render
  // This is called by the mutation's onMutate in the hook
  useEffect(() => {
    // Capture positions whenever data changes (before next paint)
    capturePositions()
  }, [data, capturePositions])

  // Filter columns based on search and status
  const filteredColumns = useMemo(() => {
    if (!searchQuery && statusFilter === 'all') return columns

    return columns.map((col) => {
      let filtered = col.associates

      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        filtered = filtered.filter(
          (a) =>
            a.user_name.toLowerCase().includes(query) ||
            a.position_title?.toLowerCase().includes(query) ||
            a.department?.toLowerCase().includes(query)
        )
      }

      if (statusFilter !== 'all') {
        filtered = filtered.filter((a) => a.status === statusFilter)
      }

      return {
        ...col,
        associates: filtered,
        totalAssociates: filtered.length,
        activeAssociates: filtered.filter((a) => a.status === 'active').length,
      }
    })
  }, [columns, searchQuery, statusFilter])

  // Total counts for toolbar
  const totalAssociates = data?.associates.length || 0
  const totalActive =
    data?.associates.filter((a) => a.status === 'active').length || 0

  if (isLoading) {
    return <LaborBoardSkeleton />
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Read-only Banner */}
      {readOnly && (
        <div
          ref={bannerRef}
          className='bg-muted flex items-center gap-2 rounded-lg border p-3 text-sm'
        >
          <Info className='text-muted-foreground h-4 w-4 shrink-0' />
          <span className='text-muted-foreground'>
            Viewing historical layout. Drag-and-drop is disabled for past dates.
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <div className='relative'>
            <Search className='text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2' />
            <Input
              placeholder='Search associates...'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className='h-9 w-[220px] pl-9'
            />
          </div>
          <div className='flex overflow-hidden rounded-lg border'>
            {(['all', 'active', 'break', 'offline'] as const).map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? 'default' : 'ghost'}
                size='sm'
                onClick={() => setStatusFilter(status)}
                className='h-9 rounded-none px-3 text-xs'
              >
                {status === 'all'
                  ? 'All'
                  : status === 'break'
                    ? 'Break'
                    : status.charAt(0).toUpperCase() + status.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <LayoutGrid className='h-4 w-4' />
          <span>
            {totalAssociates} associates
            <span className='mx-1'>&middot;</span>
            {totalActive} active
            <span className='mx-1'>&middot;</span>
            {columns.length - 1} areas
          </span>
        </div>
      </div>

      {/* Board */}
      <DndContext
        sensors={readOnly ? [] : sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToWindowEdges]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{ announcements }}
      >
        {/* FLIP container + Column entrance container (merged) */}
        <div
          ref={(node) => {
            // Merge FLIP ref and column entrance ref
            ;(
              flipContainerRef as React.MutableRefObject<HTMLDivElement | null>
            ).current = node
            ;(
              columnEntranceRef as React.MutableRefObject<HTMLDivElement | null>
            ).current = node
          }}
          className='flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4'
          style={{ minHeight: 'calc(100vh - 380px)' }}
        >
          {filteredColumns.map((column) => (
            <div key={column.id} data-column className='snap-start'>
              <LaborBoardColumn
                column={column}
                activeDragId={activeDragId}
                readOnly={readOnly}
                allColumns={columns}
                onMoveToArea={handleMoveToArea}
              />
            </div>
          ))}

          {filteredColumns.length === 0 && (
            <div className='flex flex-1 items-center justify-center py-20'>
              <div className='text-muted-foreground text-center'>
                <LayoutGrid className='mx-auto mb-4 h-12 w-12 opacity-30' />
                <p>No areas configured yet</p>
                <p className='mt-1 text-sm'>
                  Set up working areas in Settings &rarr; Labor Management to
                  use the Labor Board
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Drag Overlay -- anime.js spring effect via useDragOverlaySpring */}
        <DragOverlay
          dropAnimation={{
            duration: 200,
            easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          }}
        >
          {activeAssociate && (
            <div ref={overlayRef} className='rounded-lg'>
              <LaborBoardCard associate={activeAssociate} isOverlay readOnly />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Reassignment Confirmation Dialog */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCancelReassign()
            setReason('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className='flex items-center gap-2'>
              <ArrowRight className='text-primary h-5 w-5' />
              Reassign Associate
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className='space-y-3'>
                <p>
                  Move{' '}
                  <strong>{pendingReassignment?.associate.user_name}</strong>{' '}
                  from{' '}
                  <Badge variant='secondary' className='mx-1'>
                    {pendingReassignment?.fromColumn.type === 'unassigned' ? (
                      <>
                        <UserX className='mr-1 h-3 w-3' />
                        Unassigned
                      </>
                    ) : (
                      <>
                        <MapPin
                          className='mr-1 h-3 w-3'
                          style={{
                            color: pendingReassignment?.fromColumn.color,
                          }}
                        />
                        {pendingReassignment?.fromColumn.area_name}
                      </>
                    )}
                  </Badge>{' '}
                  to{' '}
                  <Badge variant='secondary' className='mx-1'>
                    {pendingReassignment?.toColumn.type === 'unassigned' ? (
                      <>
                        <UserX className='mr-1 h-3 w-3' />
                        Unassigned
                      </>
                    ) : (
                      <>
                        <MapPin
                          className='mr-1 h-3 w-3'
                          style={{ color: pendingReassignment?.toColumn.color }}
                        />
                        {pendingReassignment?.toColumn.area_name}
                      </>
                    )}
                  </Badge>
                  ?
                </p>

                {/* Capacity warning */}
                {pendingReassignment?.toColumn.isOverCapacity && (
                  <div className='flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-400'>
                    <Info className='h-4 w-4 shrink-0' />
                    <span>
                      Target area is at or over capacity (
                      {pendingReassignment.toColumn.totalAssociates}/
                      {pendingReassignment.toColumn.capacity})
                    </span>
                  </div>
                )}

                {/* Certification warning */}
                {pendingReassignment?.toColumn.requiresCertification && (
                  <div className='flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/10 p-2 text-sm text-blue-700 dark:text-blue-400'>
                    <Info className='h-4 w-4 shrink-0' />
                    <span>
                      Target area requires certifications
                      {pendingReassignment.toColumn.requiredCertifications
                        ?.length
                        ? `: ${pendingReassignment.toColumn.requiredCertifications.join(', ')}`
                        : ''}
                    </span>
                  </div>
                )}

                {/* Optional Reason */}
                <div className='space-y-2'>
                  <Label
                    htmlFor='reassign-reason'
                    className='text-foreground text-sm font-medium'
                  >
                    Reason (optional)
                  </Label>
                  <Textarea
                    id='reassign-reason'
                    placeholder='e.g., Volume surge in Shipping, Cross-training...'
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className='resize-none'
                    rows={2}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleCancelReassign}
              disabled={isReassigning}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleConfirmReassign(reason || undefined)
                setReason('')
              }}
              disabled={isReassigning}
            >
              {isReassigning ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Reassigning...
                </>
              ) : (
                'Confirm Reassignment'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Screen reader announcement region */}
      <div
        role='status'
        aria-live='polite'
        aria-atomic='true'
        className='sr-only'
      >
        {isReassigning && 'Reassigning associate...'}
      </div>
    </div>
  )
}

// Skeleton loader for initial load
function LaborBoardSkeleton() {
  return (
    <div className='space-y-4'>
      {/* Toolbar skeleton */}
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-9 w-[220px]' />
          <Skeleton className='h-9 w-[240px]' />
        </div>
        <Skeleton className='h-5 w-[200px]' />
      </div>

      {/* Columns skeleton */}
      <div className='flex gap-3 overflow-hidden'>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className='w-[300px] min-w-[300px] space-y-3 rounded-xl border p-3'
          >
            <Skeleton className='h-6 w-3/4' />
            <Skeleton className='h-1.5 w-full' />
            <div className='space-y-2'>
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className='h-14 w-full rounded-lg' />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default LaborBoard
