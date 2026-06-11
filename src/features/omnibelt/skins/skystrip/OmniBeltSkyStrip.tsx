// Created and developed by Jai Singh
/**
 * OmniBelt — Sky Strip skin (v1.1, 2026-05-24)
 *
 * Flagship resting chrome. A slim ~220×40 px near-black pill rests
 * at the BOTTOM-CENTER of the viewport (iOS Dynamic-Island style).
 * Collapsed, it shows a single status dot (pulse when jobs are
 * running) and a compact `<StripStatusSurface />` summarising the
 * most-recent background job. Tapped, it BLOOMS upward into the
 * full grid panel — same `motion.div`, same `layoutId`, single
 * continuous morph (no detached panel appearing in a corner).
 *
 * v1 (P7) anchored the strip top-center and delegated the expanded
 * surface to the shared `<OmniBeltPanel>` (rendered by the host at a
 * P6-resolved anchor). That made the morph read as a teleport — the
 * strip disappeared at the top while the panel appeared bottom-right.
 *
 * v1.1 (this file) flips both:
 *   - Strip lives at bottom-center, positioned via a flex-centering
 *     fixed shell (NOT via inline `translateX(-50%)`).
 *   - The skin OWNS its expanded form. When `collapseState ===
 *     'panel'`, the SkyStrip renders a 760-px-wide glass panel inside
 *     the same shell with the SAME `layoutId`, so framer interpolates
 *     width / height / border-radius in one fluid spring. The standard
 *     `<OmniBeltPanel>` is suppressed for this skin (see
 *     `OmniBeltHost.SKINS_USING_SHARED_PANEL`).
 *
 * v1.2 (2026-05-24 PM): centering moved off the morphing element.
 *   v1.1 used `left: 50%; translateX(-50%)` on both motion.divs to
 *   center them. But framer-motion's `layoutId` morph uses transforms
 *   internally to FLIP-animate between the two rects — and the inline
 *   `translateX(-50%)` percentage references the CURRENT (growing)
 *   width, so as the element grew from 220 → 760 px the centering
 *   drifted to the right and settled off-center. Fix: a `position:
 *   fixed; bottom: 24; left: 0; right: 0` flex shell does the
 *   centering, and the morphing motion.divs are pure box-model
 *   (width / height / border-radius only). Framer can now interpolate
 *   the bounding rect cleanly without fighting any inline transform.
 *
 * Motion spec:
 *   - Morph uses `ISLAND_SPRING` (stiffer than the house spring —
 *     stiffness 600, damping 38) so the bloom reads as a tactile
 *     single movement instead of a soft expansion.
 *   - Border radius animates 9999px (pill) → 24px (panel) for free
 *     via `layoutId`.
 *   - Inside the morph, `<AnimatePresence mode='wait'>` cross-fades
 *     strip content (status dot + halo) → panel content (search +
 *     tabs + tiles). Fade duration ~150 ms with `HOUSE_EASE`.
 *   - `whileTap={{ scale: 0.98 }}` on the collapsed strip for
 *     haptic-feel feedback before the morph fires.
 *   - Reduced-motion is honoured via `<MotionConfig reducedMotion>`
 *     at the host; framer short-circuits the spring to a duration-0
 *     transition automatically.
 *
 * Escape + click-outside handlers live in this file (mirrors the
 * pattern from `<OmniBeltPanel>` for the Pill skin) so the SkyStrip
 * fully owns its expanded lifecycle. Skipping clicks on
 * `[data-omnibelt-host]` lets the user click the morphed panel body
 * or the strip itself to toggle without double-firing.
 *
 * The shared `<PanelContent>` provides the inner UI (header, search,
 * tabs, tool grid, menu) — extracted from `<OmniBeltPanel>` so both
 * the Pill panel and the SkyStrip panel render the same body without
 * duplicating logic.
 *
 * `collapseState === 'nub'` falls back to `<PillEdgeNub />` for the
 * same reasons as the orb skin (v1 keeps a single nub implementation).
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, useWillChange } from 'framer-motion'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { COLLAPSE_LAYOUT_ID, HOUSE_EASE, ISLAND_SPRING } from '../../lib/motion'
import { isOmnibeltOverlayPointerTarget } from '../../lib/overlays'
import { PanelContent } from '../../panel/PanelContent'
import { useOmnibeltStore } from '../../store/omnibeltStore'
import { PillEdgeNub } from '../pill/PillEdgeNub'
import { StripStatusSurface } from './StripStatusSurface'

/** Collapsed-strip geometry. ~220×40 px keeps the strip visible
 *  without crowding the bottom-right Sonner toaster (which defaults
 *  to the corner; we sit centered so they never collide). */
const STRIP_WIDTH = 220
const STRIP_HEIGHT = 40

/** Expanded-panel geometry. Capped to viewport-minus-32 so the panel
 *  never overflows on narrow widths. Height grows with content but
 *  clamps to 70vh to keep the bottom of the page visible on phones. */
const PANEL_WIDTH = 760
const PANEL_MAX_HEIGHT_VH = 70
const PANEL_MIN_HEIGHT_PX = 380

/** Distance from the viewport bottom to the strip's resting bottom
 *  edge. 24 px matches the Pill skin's default gutter so flipping
 *  skins from the panel menu doesn't shift the chrome's footprint. */
const BOTTOM_GUTTER_PX = 24

/** Shared cross-fade for inner content. Subtle on purpose — the
 *  morph is the headline animation; the content swap is supporting
 *  cast. Mirrors the SNAP_SPRING timing for visual cohesion. */
const CONTENT_FADE = {
  duration: 0.15,
  ease: HOUSE_EASE,
}

// -- Collapsed strip ---------------------------------------------------------

type StripProps = {
  hasJobs: boolean
  onClick: () => void
}

function CollapsedStrip({ hasJobs, onClick }: StripProps) {
  // Surgical promotion — `auto` while the strip rests at the bottom of
  // every page; framer flips it to `transform` only during the tap /
  // morph. Avoids a permanently-promoted layer on the always-resident
  // resting chrome (see [[fixing-motion-performance]]).
  const willChange = useWillChange()
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type='button'
            data-omnibelt-host
            data-omnibelt-skin='skystrip'
            data-testid='omnibelt-skystrip'
            layoutId={COLLAPSE_LAYOUT_ID}
            layout
            transition={ISLAND_SPRING}
            onClick={onClick}
            aria-label='OmniBelt — open tool launcher'
            aria-expanded={false}
            whileTap={{ scale: 0.97 }}
            // Pure box-model — centering is delegated to the parent
            // `<SkyStripAnchor>` flex shell. Inline `translateX(-50%)`
            // here fights framer's FLIP transform during the morph
            // and drifts the element off-center as the width grows.
            style={{
              width: STRIP_WIDTH,
              height: STRIP_HEIGHT,
              borderRadius: 9999,
              pointerEvents: 'auto',
              willChange,
            }}
            className='focus-visible:ring-ring/50 flex items-center justify-center gap-2 bg-neutral-900/90 px-3 text-xs text-neutral-200 shadow-2xl ring-1 ring-white/10 backdrop-blur-md hover:bg-neutral-900/95 focus-visible:ring-2 focus-visible:outline-none dark:bg-neutral-950/90'
          >
            <motion.span
              key='strip-content'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={CONTENT_FADE}
              className='flex items-center justify-center gap-2'
            >
              <span
                aria-hidden='true'
                data-testid='omnibelt-skystrip-dot'
                className={
                  hasJobs
                    ? 'inline-block size-2 rounded-full bg-teal-400 motion-safe:animate-pulse'
                    : 'inline-block size-2 rounded-full bg-neutral-500'
                }
              />
              <StripStatusSurface />
            </motion.span>
          </motion.button>
        </TooltipTrigger>
        <TooltipContent side='top'>OmniBelt · ⌘B to open</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// -- Expanded panel (the bloomed strip) --------------------------------------

type ExpandedProps = {
  onClose: () => void
}

function ExpandedPanel({ onClose }: ExpandedProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Managed promotion for the bloomed panel — `auto` until the morph
  // runs, then `transform` for its duration. Mirrors the strip so the
  // shared `layoutId` morph promotes both ends consistently.
  const willChange = useWillChange()

  // Esc + click-outside — mirrors `<OmniBeltPanel>` so the skin owns
  // its own dismissal lifecycle (the host doesn't need to know which
  // skin's surface is open). We skip clicks on anything tagged
  // `data-omnibelt-host` because the strip / panel share that tag
  // via the layoutId — clicking either should not double-fire close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (isOmnibeltOverlayPointerTarget(target)) return
      if (panelRef.current && panelRef.current.contains(target)) return
      const el = (target as Element).closest?.('[data-omnibelt-host]')
      if (el) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  return (
    <motion.div
      ref={panelRef}
      data-omnibelt-host
      data-omnibelt-skin='skystrip'
      data-testid='omnibelt-skystrip-panel'
      layoutId={COLLAPSE_LAYOUT_ID}
      layout
      role='dialog'
      aria-modal='false'
      aria-label='OmniBelt — tool launcher'
      // `initial={false}` lets the shared layoutId morph from the
      // strip's last-measured rect into the panel's rect without a
      // competing enter transition.
      initial={false}
      transition={ISLAND_SPRING}
      // Pure box-model — the parent `<SkyStripAnchor>` flex shell
      // keeps this centered as it grows from strip → panel. No inline
      // `translateX(-50%)` here (see v1.2 docstring above).
      style={{
        width: `min(${PANEL_WIDTH}px, calc(100vw - 32px))`,
        maxHeight: `max(${PANEL_MAX_HEIGHT_VH}vh, ${PANEL_MIN_HEIGHT_PX}px)`,
        borderRadius: 24,
        pointerEvents: 'auto',
        willChange,
      }}
      className='glass-strong text-foreground flex flex-col gap-3 overflow-y-auto p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl'
    >
      <motion.div
        key='panel-content'
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={CONTENT_FADE}
        className='flex flex-col gap-3'
      >
        <PanelContent onClose={onClose} />
      </motion.div>
    </motion.div>
  )
}

// -- Skin entry point --------------------------------------------------------

/**
 * Positioning shell for the SkyStrip morph.
 *
 * A `position: fixed` full-width row at the bottom of the viewport
 * with flex centering. The morphing motion.div (strip OR panel) sits
 * inside and stays horizontally centered automatically as its width
 * changes from 220 → 760 px (and back).
 *
 * Centering is delegated here so the morphing element itself is pure
 * box-model — framer-motion's layoutId FLIP transform can interpolate
 * the bounding rect cleanly without fighting an inline
 * `translateX(-50%)` whose percentage references the changing width.
 *
 * `pointer-events: none` lets clicks pass through the empty area to
 * the page underneath (so this shell doesn't block the bottom strip
 * of the viewport). The morphing child re-enables pointer events on
 * itself.
 */
function SkyStripAnchor({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid='omnibelt-skystrip-anchor'
      style={{
        position: 'fixed',
        bottom: BOTTOM_GUTTER_PX,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-end',
        pointerEvents: 'none',
        zIndex: 60,
      }}
    >
      {children}
    </div>
  )
}

function StripBody() {
  const collapseState = useOmnibeltStore((s) => s.collapseState)
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)
  const activeJobs = useOmnibeltStore((s) => s.activeJobs)

  const isOpen = collapseState === 'panel'
  const hasJobs = activeJobs.length > 0

  const handleOpen = useCallback(
    () => setCollapseState('panel'),
    [setCollapseState]
  )
  const handleClose = useCallback(
    () => setCollapseState('pill'),
    [setCollapseState]
  )

  // `mode='wait'` ensures exactly one of (strip, panel) is mounted
  // during the morph — the other is unmounted first so the layoutId
  // pair is unambiguous. This is the canonical Dynamic-Island pattern:
  // a single `motion.div` exists at any time, framer interpolates its
  // bounding rect between the two forms. The anchor shell keeps the
  // morphing child centered as its width changes.
  return (
    <SkyStripAnchor>
      <AnimatePresence mode='wait' initial={false}>
        {isOpen ? (
          <ExpandedPanel key='panel' onClose={handleClose} />
        ) : (
          <CollapsedStrip key='strip' hasJobs={hasJobs} onClick={handleOpen} />
        )}
      </AnimatePresence>
    </SkyStripAnchor>
  )
}

export default function OmniBeltSkyStrip() {
  const collapseState = useOmnibeltStore((s) => s.collapseState)

  // Idle-hide falls back to the shared edge nub for v1 — same
  // rationale as the Compass Orb skin.
  if (collapseState === 'nub') return <PillEdgeNub />

  return <StripBody />
}

// Created and developed by Jai Singh
