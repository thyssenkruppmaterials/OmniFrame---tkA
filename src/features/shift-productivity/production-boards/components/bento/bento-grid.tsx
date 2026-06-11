// Created and developed by Jai Singh
/**
 * BentoGrid — responsive 12/6/2/1-column bento layout shell.
 *
 * - In **read mode** (default): plain CSS grid; cards occupy
 *   `grid-column` / `grid-row` spans derived from their persisted
 *   `(gridX, gridY, gridW, gridH)`. Drag affordances are not rendered.
 *
 * - In **edit mode** (`editMode={true}`): each card gets a top-right
 *   grip handle for drag-to-move (via `@dnd-kit/core`) and a
 *   bottom-right corner handle for drag-to-resize (hand-rolled
 *   pointer-events). Layout changes commit on `mouseup` / drag-end.
 *
 * - **TV mode**: forces `editMode=false`, hides handles, switches to
 *   the TV column count + larger gap (per the TV-Viewport-Fit-Grid
 *   pattern). Gallery rotation + banner marquee still run; their
 *   render path doesn't depend on edit mode.
 *
 * Library choice: `@dnd-kit/core` (already in repo via the composer
 * attachment uploader). React-grid-layout was the alternative; we
 * picked dnd-kit + a hand-rolled resize to (a) avoid a new dep,
 * (b) stay React-19-strict-mode safe, (c) keep the carved chunk
 * smaller. See the ADR for the full trade-off discussion.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { IconCornerRightDown, IconGripVertical } from '@tabler/icons-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { autoPlaceCards, clampDragTo } from './bento-layout'
import { CardRenderer } from './card-renderer'
import {
  BENTO_BREAKPOINTS,
  VARIANT_MAX_H,
  VARIANT_MAX_W,
  VARIANT_MIN_H,
  VARIANT_MIN_W,
  type BentoBreakpoint,
  type BoardCard,
  type CardVariant,
} from './card-variant'

export interface BentoGridProps {
  cards: readonly BoardCard[]
  editMode: boolean
  isTv: boolean
  /** Called after every successful drag-to-move or drag-to-resize. */
  onLayoutChange?: (
    postId: string,
    next: { gridX: number; gridY: number; gridW: number; gridH: number }
  ) => void
  onEditPost?: (card: BoardCard) => void
  onAcknowledgePost?: (card: BoardCard) => void
  className?: string
}

export interface BentoGridHandle {
  /** Re-measure the grid cell width — call after the surrounding */
  /** container resizes if you suspect ResizeObserver missed it. */
  refresh: () => void
}

/** Hook that reports the active responsive breakpoint based on width. */
function useResponsiveBreakpoint(): BentoBreakpoint {
  const [bp, setBp] = useState<BentoBreakpoint>(() => {
    if (typeof window === 'undefined') return 'lg'
    const w = window.innerWidth
    if (w >= 1024) return 'lg'
    if (w >= 768) return 'md'
    if (w >= 640) return 'sm'
    return 'base'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (): void => {
      const w = window.innerWidth
      if (w >= 1024) setBp('lg')
      else if (w >= 768) setBp('md')
      else if (w >= 640) setBp('sm')
      else setBp('base')
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return bp
}

interface DragState {
  postId: string
  // Initial geometry at drag start (cell units).
  startX: number
  startY: number
  startW: number
  startH: number
  // Delta from pointer (px), translated to cells in handlers.
  startPointerX: number
  startPointerY: number
}

export const BentoGrid = forwardRef<BentoGridHandle, BentoGridProps>(
  function BentoGrid(
    {
      cards,
      editMode,
      isTv,
      onLayoutChange,
      onEditPost,
      onAcknowledgePost,
      className,
    },
    ref
  ) {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
      useSensor(KeyboardSensor)
    )

    const bp = useResponsiveBreakpoint()
    const cols = isTv ? 12 : BENTO_BREAKPOINTS[bp].cols

    const containerRef = useRef<HTMLDivElement | null>(null)
    const [cellPx, setCellPx] = useState({ w: 80, h: 80, gap: 16 })

    const measure = useCallback((): void => {
      const el = containerRef.current
      if (!el) return
      const styles = getComputedStyle(el)
      const gapPx = parseFloat(styles.gap || '20') || 20
      const widthPx = el.clientWidth
      const cellW = (widthPx - gapPx * (cols - 1)) / cols
      // v2 — slightly taller default cell so cards read more like "tiles"
      // than "rows". Multipliers tuned by eye on 1080p + a 1280px laptop.
      const cellH = isTv
        ? Math.max(96, cellW * 0.78)
        : Math.max(82, cellW * 0.6)
      setCellPx({ w: cellW, h: cellH, gap: gapPx })
    }, [cols, isTv])

    useEffect(() => {
      measure()
    }, [measure])

    useEffect(() => {
      if (typeof window === 'undefined') return
      const handler = (): void => measure()
      window.addEventListener('resize', handler)
      return () => window.removeEventListener('resize', handler)
    }, [measure])

    useImperativeHandle(ref, () => ({ refresh: measure }), [measure])

    const placed = useMemo(() => autoPlaceCards(cards, cols), [cards, cols])

    // ----- Drag-to-resize (hand-rolled pointer events) -----
    const [resizeState, setResizeState] = useState<DragState | null>(null)

    const onResizeStart = useCallback(
      (card: BoardCard, e: React.PointerEvent<HTMLButtonElement>): void => {
        e.preventDefault()
        e.stopPropagation()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        setResizeState({
          postId: card.post.id,
          startX: card.gridX,
          startY: card.gridY,
          startW: card.gridW,
          startH: card.gridH,
          startPointerX: e.clientX,
          startPointerY: e.clientY,
        })
      },
      []
    )

    const onResizeMove = useCallback(
      (e: React.PointerEvent<HTMLButtonElement>): void => {
        if (!resizeState) return
        const card = placed.find((c) => c.post.id === resizeState.postId)
        if (!card) return
        const dxCells = Math.round(
          (e.clientX - resizeState.startPointerX) / (cellPx.w + cellPx.gap)
        )
        const dyCells = Math.round(
          (e.clientY - resizeState.startPointerY) / (cellPx.h + cellPx.gap)
        )
        const variant: CardVariant = card.cardVariant
        const minW = Math.min(VARIANT_MIN_W[variant], cols)
        const maxW = Math.min(VARIANT_MAX_W[variant], cols - resizeState.startX)
        const minH = VARIANT_MIN_H[variant]
        const maxH = VARIANT_MAX_H[variant]
        const nextW = Math.max(
          minW,
          Math.min(maxW, resizeState.startW + dxCells)
        )
        const nextH = Math.max(
          minH,
          Math.min(maxH, resizeState.startH + dyCells)
        )
        // Live-preview via CSS variables on the dragged tile.
        const el = containerRef.current?.querySelector<HTMLElement>(
          `[data-card-tile="${resizeState.postId}"]`
        )
        if (el) {
          el.style.gridColumn = `${resizeState.startX + 1} / span ${nextW}`
          el.style.gridRow = `${resizeState.startY + 1} / span ${nextH}`
          el.dataset.resizing = 'true'
        }
      },
      [cellPx.gap, cellPx.h, cellPx.w, cols, placed, resizeState]
    )

    const onResizeEnd = useCallback(
      (e: React.PointerEvent<HTMLButtonElement>): void => {
        if (!resizeState) return
        try {
          ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
        } catch {
          /* ignore — capture may already have been released */
        }
        const card = placed.find((c) => c.post.id === resizeState.postId)
        if (!card) {
          setResizeState(null)
          return
        }
        const dxCells = Math.round(
          (e.clientX - resizeState.startPointerX) / (cellPx.w + cellPx.gap)
        )
        const dyCells = Math.round(
          (e.clientY - resizeState.startPointerY) / (cellPx.h + cellPx.gap)
        )
        const variant = card.cardVariant
        const minW = Math.min(VARIANT_MIN_W[variant], cols)
        const maxW = Math.min(VARIANT_MAX_W[variant], cols - resizeState.startX)
        const minH = VARIANT_MIN_H[variant]
        const maxH = VARIANT_MAX_H[variant]
        const nextW = Math.max(
          minW,
          Math.min(maxW, resizeState.startW + dxCells)
        )
        const nextH = Math.max(
          minH,
          Math.min(maxH, resizeState.startH + dyCells)
        )
        const el = containerRef.current?.querySelector<HTMLElement>(
          `[data-card-tile="${resizeState.postId}"]`
        )
        if (el) {
          el.dataset.resizing = 'false'
          el.style.gridColumn = ''
          el.style.gridRow = ''
        }
        if (nextW !== resizeState.startW || nextH !== resizeState.startH) {
          onLayoutChange?.(card.post.id, {
            gridX: resizeState.startX,
            gridY: resizeState.startY,
            gridW: nextW,
            gridH: nextH,
          })
        }
        setResizeState(null)
      },
      [
        cellPx.gap,
        cellPx.h,
        cellPx.w,
        cols,
        onLayoutChange,
        placed,
        resizeState,
      ]
    )

    // ----- Drag-to-move (dnd-kit) -----
    const [activeId, setActiveId] = useState<string | null>(null)
    const activeCard = useMemo(
      () =>
        activeId ? (placed.find((c) => c.post.id === activeId) ?? null) : null,
      [activeId, placed]
    )

    const handleDragStart = useCallback(
      ({ active }: { active: { id: string | number } }): void => {
        setActiveId(String(active.id))
      },
      []
    )

    const handleDragEnd = useCallback(
      (e: DragEndEvent): void => {
        const dropPostId = String(e.active.id)
        setActiveId(null)
        const card = placed.find((c) => c.post.id === dropPostId)
        if (!card) return
        // Map delta (px) to grid cells.
        const dxCells = Math.round(e.delta.x / (cellPx.w + cellPx.gap))
        const dyCells = Math.round(e.delta.y / (cellPx.h + cellPx.gap))
        const target = clampDragTo(
          card.cardVariant,
          card.gridX + dxCells,
          card.gridY + dyCells,
          card.gridW,
          card.gridH,
          cols
        )
        if (target.x === card.gridX && target.y === card.gridY) return
        onLayoutChange?.(card.post.id, {
          gridX: target.x,
          gridY: target.y,
          gridW: card.gridW,
          gridH: card.gridH,
        })
      },
      [cellPx.gap, cellPx.h, cellPx.w, cols, onLayoutChange, placed]
    )

    const gridStyle: CSSProperties = {
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gridAutoRows: `${Math.round(cellPx.h)}px`,
      gap: cellPx.gap,
    }

    return (
      <>
        {/* Marquee keyframes — used by `<BannerCard>` when marquee + TV. */}
        <style>{`
@keyframes bento-marquee {
  0%   { transform: translateX(0%); }
  100% { transform: translateX(-50%); }
}
`}</style>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={containerRef}
            className={cn('w-full gap-5 lg:gap-6', className)}
            style={gridStyle}
            data-bento-grid='true'
            data-edit-mode={editMode ? 'true' : 'false'}
            data-tv={isTv ? 'true' : 'false'}
          >
            {placed.map((card, idx) => (
              <BentoTile
                key={card.post.id}
                card={card}
                index={idx}
                editMode={editMode && !isTv}
                isTv={isTv}
                onEditPost={onEditPost}
                onAcknowledgePost={onAcknowledgePost}
                onResizeStart={(e) => onResizeStart(card, e)}
                onResizeMove={onResizeMove}
                onResizeEnd={onResizeEnd}
                resizing={resizeState?.postId === card.post.id}
                dragging={activeId === card.post.id}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <div
                className='ring-primary/60 pointer-events-none rounded-2xl opacity-95 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.45)] ring-2'
                style={{
                  width: Math.round(
                    activeCard.gridW * cellPx.w +
                      (activeCard.gridW - 1) * cellPx.gap
                  ),
                  height: Math.round(
                    activeCard.gridH * cellPx.h +
                      (activeCard.gridH - 1) * cellPx.gap
                  ),
                  transform: 'rotate(1deg) scale(1.02)',
                }}
              >
                <CardRenderer
                  card={activeCard}
                  isTv={isTv}
                  showEditAffordances={false}
                  disableInteractions
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </>
    )
  }
)

interface BentoTileProps {
  card: BoardCard
  index: number
  editMode: boolean
  isTv: boolean
  resizing: boolean
  dragging: boolean
  onEditPost?: (card: BoardCard) => void
  onAcknowledgePost?: (card: BoardCard) => void
  onResizeStart: (e: React.PointerEvent<HTMLButtonElement>) => void
  onResizeMove: (e: React.PointerEvent<HTMLButtonElement>) => void
  onResizeEnd: (e: React.PointerEvent<HTMLButtonElement>) => void
}

/**
 * Per-tile mount-stagger budget. The 60ms × index cascade looks great
 * for ~8 cards; past that the cascade reads as sluggish, so we cap at
 * the 8th card. (See the Aesthetic Brief in
 * [[Decisions/ADR-Production-Boards-Aesthetic-Overhaul]] for why.)
 */
const MOUNT_STAGGER_MS = 60
const MOUNT_STAGGER_CAP = 8

function BentoTile({
  card,
  index,
  editMode,
  isTv,
  resizing,
  dragging,
  onEditPost,
  onAcknowledgePost,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: BentoTileProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: card.post.id,
    disabled: !editMode,
  })

  // Droppable so we get hover styling; the drag itself is computed
  // by delta, not by drop target, so we don't actually require a
  // droppable — but registering keeps dnd-kit's hit-detection happy
  // on multi-card grids in future iterations.
  useDroppable({ id: `slot-${card.post.id}` })

  const staggerDelay = Math.min(index, MOUNT_STAGGER_CAP) * MOUNT_STAGGER_MS
  const style: CSSProperties = {
    gridColumn: `${card.gridX + 1} / span ${card.gridW}`,
    gridRow: `${card.gridY + 1} / span ${card.gridH}`,
    transform: dragging
      ? undefined
      : transform
        ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
        : undefined,
    opacity: dragging ? 0.25 : undefined,
    zIndex: resizing ? 10 : undefined,
    // Per-tile mount-stagger — cards read in as an orchestrated cascade.
    animationDelay: `${staggerDelay}ms`,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative min-h-0 min-w-0',
        editMode &&
          'motion-safe:hover:ring-primary/30 rounded-2xl ring-1 ring-transparent transition-shadow'
      )}
      data-card-tile={card.post.id}
      data-resizing='false'
    >
      <CardRenderer
        card={card}
        isTv={isTv}
        showEditAffordances={editMode}
        onEdit={onEditPost ? () => onEditPost(card) : undefined}
        onAcknowledge={
          onAcknowledgePost ? () => onAcknowledgePost(card) : undefined
        }
      />
      {editMode && (
        <>
          <button
            type='button'
            {...attributes}
            {...listeners}
            aria-label={`Drag ${card.post.title}`}
            className={cn(
              'absolute top-3 right-3 z-20 flex h-8 w-8 cursor-grab items-center justify-center rounded-full',
              'bg-background/70 text-muted-foreground ring-border/50 ring-1 backdrop-blur-md ring-inset',
              'opacity-0 transition-all motion-safe:duration-200',
              'hover:bg-background/95 hover:text-foreground hover:scale-105',
              'group-hover:opacity-100 active:cursor-grabbing'
            )}
          >
            <IconGripVertical className='h-4 w-4' aria-hidden />
          </button>
          <button
            type='button'
            aria-label={`Resize ${card.post.title}`}
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            className={cn(
              'absolute right-1.5 bottom-1.5 z-20 flex h-7 w-7 cursor-se-resize items-center justify-center rounded-md',
              'bg-background/70 text-muted-foreground ring-border/50 ring-1 backdrop-blur-md ring-inset',
              'opacity-0 transition-all motion-safe:duration-200',
              'hover:bg-background/95 hover:text-foreground',
              'group-hover:opacity-100'
            )}
          >
            <IconCornerRightDown
              className='h-3.5 w-3.5 rotate-45'
              aria-hidden
            />
          </button>
        </>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
