// Created and developed by Jai Singh
/**
 * OmniBelt — Pill skin (default visible chrome)
 *
 * Renders one of four sub-components depending on `collapseState`:
 *   - 'orb'   → `<PillMiniOrb />`     (44px circular glass orb)
 *   - 'pill'  → full Pill (drag grip + 6 pinned tools + pin badge + expand)
 *   - 'panel' → returns null (the Panel renders separately and morphs)
 *   - 'nub'   → `<PillEdgeNub />`     (6px edge sliver)
 *
 * Every state shares `layoutId='omnibelt-host'` so framer interpolates
 * size, border-radius and position between them. Wrap the whole tree
 * at the host level with `<LayoutGroup id='omnibelt'>` for the
 * morph to register (already done in `OmniBeltHost`).
 *
 * P6 swaps the hard-coded bottom-right gutter for the 12-anchor system
 * via `useOmnibeltPosition` + `useOmnibeltCollisionAvoidance`. Position
 * is applied through `transform: translate3d()` only (no top/left
 * writes) per spec §15.6 — keeps the morph on the GPU, no layout
 * thrash. PINNED disables drag; the right-click menu exposes the 12
 * anchors as keyboard-accessible options for a11y.
 */
import { useCallback, useState } from 'react'
import {
  IconChevronUp,
  IconGripVertical,
  IconPin,
  IconPinFilled,
  IconSparkles,
} from '@tabler/icons-react'
import { motion, useWillChange, type PanInfo } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useOmnibeltCollisionAvoidance } from '../../hooks/useOmnibeltCollisionAvoidance'
import {
  useOmnibeltPosition,
  DEFAULT_WIDGET_SIZE,
} from '../../hooks/useOmnibeltPosition'
import { USER_CORNER_ANCHORS, type AnchorName } from '../../lib/anchors'
import {
  HOUSE_SPRING,
  LIQUID_SPRING,
  COLLAPSE_LAYOUT_ID,
} from '../../lib/motion'
import { OMNIBELT_OVERLAY_Z } from '../../lib/overlays'
import { useOmnibeltStore } from '../../store/omnibeltStore'
import type { ToolAccent, ToolDef } from '../../tools/registry'
import { useResolvedTools } from '../../tools/use-resolved-tools'
import { HaloRings } from '../../tray/HaloRings'
import { PillEdgeNub } from './PillEdgeNub'
import { PillMiniOrb } from './PillMiniOrb'

/** Number of pixels the halo SVG extends past the pill's outer
 *  bounding box on each side. The outermost ring sits 4 px outside
 *  the pill so the stroke doesn't visually overlap the glass border;
 *  6 px of total inset gives the ring stack room for ~3 concurrent
 *  jobs before the inner ring collides with the pill body. */
const HALO_OUTSET_PX = 12

const ACCENT_BG_BY_ACCENT: Record<ToolAccent, string> = {
  teal: 'from-teal-400/80 to-teal-600/80',
  blue: 'from-blue-400/80 to-blue-600/80',
  violet: 'from-violet-400/80 to-violet-600/80',
  amber: 'from-amber-400/80 to-amber-600/80',
  rose: 'from-rose-400/80 to-rose-600/80',
  lime: 'from-lime-400/80 to-lime-600/80',
  cyan: 'from-cyan-400/80 to-cyan-600/80',
  indigo: 'from-indigo-400/80 to-indigo-600/80',
}

const ANCHOR_LABELS: Record<AnchorName, string> = {
  TL: 'Top left',
  TC: 'Top center',
  TR: 'Top right',
  ML: 'Middle left',
  MR: 'Middle right',
  BL: 'Bottom left',
  BC: 'Bottom center',
  BR: 'Bottom right',
  FREE: 'Free float',
  PINNED: 'Pinned',
  NUB_L: 'Left edge nub',
  NUB_R: 'Right edge nub',
  NUB_T: 'Top edge nub',
  NUB_B: 'Bottom edge nub',
}

function PillToolIcon({ tool }: { tool: ToolDef }) {
  const Icon = tool.icon
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            data-testid={`omnibelt-pill-tool-${tool.id}`}
            onClick={() => setCollapseState('panel')}
            aria-label={tool.label}
            className={cn(
              'focus-visible:ring-ring/50 relative inline-flex size-7 items-center justify-center rounded-lg shadow-sm transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:outline-none',
              'bg-gradient-to-br',
              ACCENT_BG_BY_ACCENT[tool.accent]
            )}
          >
            <Icon className='size-3.5 text-white drop-shadow-sm' />
          </button>
        </TooltipTrigger>
        <TooltipContent side='top' className={OMNIBELT_OVERLAY_Z}>
          {tool.label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Right-click "Move to corner" + pin menu — keyboard-accessible
 *  alternative to drag per spec §19 and pattern §"Accessibility". */
function PillPositionMenu({
  open,
  onOpenChange,
  onPick,
  onTogglePin,
  pinned,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (anchor: AnchorName) => void
  onTogglePin: () => void
  pinned: boolean
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {/* Hidden trigger — the real activation is via right-click on
       *  the pill body; this anchor element gives Radix something to
       *  attach the floating layer to. */}
      <DropdownMenuTrigger asChild>
        <span aria-hidden className='sr-only' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className={`w-44 ${OMNIBELT_OVERLAY_Z}`}
        data-testid='omnibelt-position-menu'
      >
        <DropdownMenuLabel className='text-xs'>
          Move to corner
        </DropdownMenuLabel>
        {USER_CORNER_ANCHORS.map((a) => (
          <DropdownMenuItem
            key={a}
            data-testid={`omnibelt-position-menu-${a}`}
            onSelect={() => onPick(a)}
          >
            {ANCHOR_LABELS[a]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid='omnibelt-position-menu-pin'
          onSelect={onTogglePin}
        >
          {pinned ? 'Unpin' : 'Pin in place'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PillBody() {
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)
  const activeJobs = useOmnibeltStore((s) => s.activeJobs)
  const trayOpen = useOmnibeltStore((s) => s.trayOpen)
  const setTrayOpen = useOmnibeltStore((s) => s.setTrayOpen)
  const { pinned, all } = useResolvedTools()

  // Surgical layer promotion: `useWillChange()` keeps `will-change: auto`
  // while the pill rests (no permanently-promoted compositor layer on
  // every page) and lets framer flip it to `transform` only for the
  // duration of a hover / drag / morph. Replaces the static
  // `willChange: 'transform'` flagged by [[fixing-motion-performance]].
  const willChange = useWillChange()

  // Show up to 6 pinned tools; if the user hasn't pinned anything,
  // fall back to the first 6 from the surviving registry so the
  // Pill is never an empty shell on first paint.
  const display = (pinned.length > 0 ? pinned : all).slice(0, 6)

  const position = useOmnibeltPosition({
    widgetW: DEFAULT_WIDGET_SIZE.widgetW,
    widgetH: DEFAULT_WIDGET_SIZE.widgetH,
  })
  const collision = useOmnibeltCollisionAvoidance({ widget: position.rect })
  const finalRect = collision.adjustedRect
  const isPinned = position.anchor === 'PINNED'

  const [menuOpen, setMenuOpen] = useState(false)
  const handleHaloClick = useCallback(() => {
    setTrayOpen(!trayOpen)
  }, [setTrayOpen, trayOpen])
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setMenuOpen(true)
  }, [])

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      // `info.point` is the pointer's viewport coordinate at release.
      // Translate to widget top-left (center of widget ≈ point minus
      // half-size) so the snap math matches the visual grab handle.
      position.onDragEnd({
        x: info.point.x - finalRect.w / 2,
        y: info.point.y - finalRect.h / 2,
      })
    },
    [position, finalRect.w, finalRect.h]
  )

  return (
    <>
      <motion.div
        data-omnibelt-host
        data-testid='omnibelt-pill'
        layoutId={COLLAPSE_LAYOUT_ID}
        transition={position.reducedMotion ? { duration: 0 } : HOUSE_SPRING}
        initial={false}
        role='toolbar'
        aria-label='OmniBelt — pinned tools'
        onContextMenu={onContextMenu}
        drag={position.isDraggable}
        dragControls={position.dragControls}
        dragListener={false}
        dragMomentum={false}
        // Subtle micro-feedback while dragging — the body lifts and the
        // shadow deepens so the user feels the pickup. Layout-morph is
        // unaffected because `scale` composes with `transform`.
        whileDrag={
          position.reducedMotion
            ? undefined
            : { scale: 1.04, transition: LIQUID_SPRING }
        }
        whileHover={
          position.reducedMotion
            ? undefined
            : { scale: 1.015, transition: LIQUID_SPRING }
        }
        onDragStart={position.onDragStart}
        onDragEnd={handleDragEnd}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          // GPU-only positioning per spec §15.6 — never `top`/`left`
          // writes inside the animation budget.
          transform: `translate3d(${finalRect.x}px, ${finalRect.y}px, 0)`,
          touchAction: position.isDraggable ? 'none' : 'auto',
          zIndex: 55,
          willChange,
        }}
        className='glass-strong relative flex items-center gap-1.5 rounded-full px-2 py-1.5 shadow-lg ring-1 ring-white/10 backdrop-blur-md'
      >
        {/*
         * Mach 3 halo overlay (P5) — renders one concentric arc per
         * active background job around the pill. Sits absolutely
         * with negative inset so the rings hover *outside* the
         * pill's rounded-full silhouette. `pointer-events: stroke`
         * inside the SVG keeps the empty interior click-through so
         * the drag handle / pin / chevron stay reachable; clicks
         * on the painted rings toggle the status tray.
         */}
        {activeJobs.length > 0 && finalRect.w > 0 && finalRect.h > 0 && (
          <div
            data-testid='omnibelt-pill-halo-wrapper'
            aria-hidden={false}
            // The wrapper itself is pointer-transparent — clicks land
            // on either the painted SVG strokes (which set
            // `pointer-events: stroke`) or fall through to the pill
            // body's grip / chevron / pin / tool icons. Without this,
            // the wrapper's negative-inset bounding box steals every
            // pointer event in a 12 px halo around the pill.
            className='pointer-events-none absolute'
            style={{
              top: -HALO_OUTSET_PX,
              left: -HALO_OUTSET_PX,
              right: -HALO_OUTSET_PX,
              bottom: -HALO_OUTSET_PX,
            }}
          >
            <HaloRings
              activeJobs={activeJobs}
              width={finalRect.w + HALO_OUTSET_PX * 2}
              height={finalRect.h + HALO_OUTSET_PX * 2}
              padding={2}
              strokeWidth={2.5}
              ringGap={2}
              reducedMotion={position.reducedMotion}
              onClick={handleHaloClick}
              className='pointer-events-auto absolute inset-0'
            />
          </div>
        )}

        <button
          type='button'
          onPointerDown={(e) => {
            if (!position.isDraggable) return
            position.dragControls.start(e)
          }}
          aria-label='OmniBelt drag handle'
          title={
            isPinned ? 'Position pinned — right-click to unpin' : 'Drag to move'
          }
          className='text-muted-foreground focus-visible:ring-ring/50 inline-flex size-5 cursor-grab items-center justify-center rounded-sm opacity-60 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing'
        >
          <IconGripVertical className='size-3.5' />
        </button>

        {display.length > 0 ? (
          <div className='flex items-center gap-1'>
            {display.map((t) => (
              <PillToolIcon key={t.id} tool={t} />
            ))}
          </div>
        ) : (
          <span className='text-muted-foreground inline-flex items-center gap-1 px-1 text-xs'>
            <IconSparkles className='size-3.5' /> OmniBelt
          </span>
        )}

        <button
          type='button'
          data-testid='omnibelt-pill-pin'
          onClick={() => position.setPinned(!isPinned)}
          aria-label={isPinned ? 'Unpin OmniBelt' : 'Pin OmniBelt in place'}
          aria-pressed={isPinned}
          className='text-muted-foreground hover:bg-accent/30 focus-visible:ring-ring/50 inline-flex size-5 items-center justify-center rounded-sm opacity-60 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none'
        >
          {isPinned ? (
            <IconPinFilled className='size-3.5' />
          ) : (
            <IconPin className='size-3.5' />
          )}
        </button>

        <button
          type='button'
          onClick={() => setCollapseState('panel')}
          aria-label='Expand OmniBelt panel'
          aria-expanded={false}
          className='hover:bg-accent/30 focus-visible:ring-ring/50 inline-flex size-7 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none'
        >
          <IconChevronUp className='text-foreground size-4' />
        </button>
      </motion.div>

      <PillPositionMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onPick={(a) => {
          position.setAnchor(a)
          setMenuOpen(false)
        }}
        onTogglePin={() => {
          position.setPinned(!isPinned)
          setMenuOpen(false)
        }}
        pinned={isPinned}
      />
    </>
  )
}

export default function OmniBeltPill() {
  const collapseState = useOmnibeltStore((s) => s.collapseState)

  if (collapseState === 'panel') {
    // Panel is rendered separately by OmniBeltHost and morphs into
    // place via the shared `layoutId` — nothing for the Pill skin
    // to draw during the expanded state.
    return null
  }

  if (collapseState === 'nub') return <PillEdgeNub />
  if (collapseState === 'orb') return <PillMiniOrb />
  return <PillBody />
}

// Created and developed by Jai Singh
