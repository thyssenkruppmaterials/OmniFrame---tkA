// Created and developed by Jai Singh
/**
 * OmniBelt — Shared expanded panel (Pill skin host)
 *
 * Rendered when `useOmnibeltStore(s => s.collapseState) === 'panel'`
 * AND the active skin uses the shared panel (currently only Pill —
 * Orb owns a `<RadialFan>`, SkyStrip owns its own bottom-center
 * morph that reuses `<PanelContent>` directly). The panel anchors to
 * whichever corner the Pill currently sits on (P6) so the shared
 * `layoutId` morph reads as "pill grows into panel" without a
 * cross-viewport teleport.
 *
 * Lifecycle:
 *   - On mount, wires a global `keydown` listener that collapses
 *     back to 'pill' on Escape (spec §18).
 *   - Click-outside (anywhere on the document NOT inside the panel
 *     or the Pill) also collapses. We special-case anything tagged
 *     `data-omnibelt-host` (the Pill morphs into / out of the same
 *     `layoutId`, so the user clicking the Pill expects to toggle,
 *     not double-close) and anything inside an OmniBelt-owned
 *     overlay (Radix portaled menus / tooltips).
 *   - Internal tool-shell rendering is delegated to `<PanelContent>`
 *     so the SkyStrip skin can reuse the same inner UI.
 *
 * Accessibility (spec §19):
 *   - `role='dialog'` + `aria-modal='false'` (non-blocking) so
 *     screen-reader users keep contextual awareness of the page.
 *   - The grid-of-tiles a11y contract lives inside `<PanelContent>`.
 *
 * Wraps the body in `<motion.div layoutId='omnibelt-host'>` so the
 * pill → panel transition is a single morph (spec §9). Spring +
 * easing constants live in `lib/motion.ts`.
 */
import { useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion, useWillChange } from 'framer-motion'
import { useOmnibeltPosition } from '../hooks/useOmnibeltPosition'
import { HOUSE_SPRING, COLLAPSE_LAYOUT_ID } from '../lib/motion'
import { isOmnibeltOverlayPointerTarget } from '../lib/overlays'
import { useOmnibeltStore } from '../store/omnibeltStore'
import { PanelContent } from './PanelContent'

/** Panel geometry. The container is `w-md` (≈448 px) and grows
 *  vertically with content; 480 is a good "tall enough for the tile
 *  grid" estimate that `useOmnibeltPosition` uses to compute anchor
 *  offsets without measuring the DOM. */
const PANEL_WIDTH_PX = 448
const PANEL_HEIGHT_PX = 480

export function OmniBeltPanel() {
  const collapseState = useOmnibeltStore((s) => s.collapseState)
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)
  // Managed promotion — `auto` until the morph/fade runs. The panel
  // only mounts while open, so this also drops the promoted layer the
  // moment it closes (see [[fixing-motion-performance]]).
  const willChange = useWillChange()
  const panelOpen = collapseState === 'panel'

  // Anchor the panel to the same route-class corner the pill currently
  // sits on, so the layoutId morph doesn't fly the panel across the
  // viewport. We pass the panel's own dimensions so the anchor math
  // clamps the panel inside the viewport (BR + 28rem panel + 24px gutter).
  const panelPosition = useOmnibeltPosition({
    widgetW: PANEL_WIDTH_PX,
    widgetH: PANEL_HEIGHT_PX,
  })

  const close = useCallback(() => setCollapseState('pill'), [setCollapseState])

  // Esc + click-outside — only wired while the panel is open.
  const panelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!panelOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null
      if (!target) return
      // Portaled Radix menus/tooltips live outside the panel DOM tree.
      if (isOmnibeltOverlayPointerTarget(target)) return
      // Ignore clicks inside the panel itself.
      if (panelRef.current && panelRef.current.contains(target)) return
      // Also ignore clicks on anything tagged as the OmniBelt host
      // (the Pill morphs into / out of the same `layoutId`, so the
      // user clicking the Pill expects to toggle, not double-close).
      const el = (target as Element).closest?.('[data-omnibelt-host]')
      if (el) return
      close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [panelOpen, close])

  return (
    <AnimatePresence>
      {panelOpen && (
        <motion.div
          ref={panelRef}
          data-omnibelt-host
          data-testid='omnibelt-panel'
          layoutId={COLLAPSE_LAYOUT_ID}
          role='dialog'
          aria-modal='false'
          aria-label='OmniBelt — tool launcher'
          // `initial={false}` lets the shared `layoutId` morph from the
          // Pill's last-measured rect into the Panel's rect without
          // fighting an explicit enter transition. Opacity stays on the
          // `animate`/`exit` axes so AnimatePresence can fade us out
          // cleanly when collapseState flips back to 'pill'.
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={
            panelPosition.reducedMotion ? { duration: 0 } : HOUSE_SPRING
          }
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            // GPU-only positioning — drives anchor placement off the
            // same `useOmnibeltPosition` rect as the pill so dragging
            // the pill to TL/TR/etc. and expanding lands the panel in
            // the matching corner (no cross-viewport teleport).
            transform: `translate3d(${panelPosition.x}px, ${panelPosition.y}px, 0)`,
            zIndex: 60,
            willChange,
          }}
          className='glass-strong text-foreground flex w-md max-w-[calc(100vw-3rem)] flex-col gap-3 rounded-2xl p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl'
        >
          <PanelContent onClose={close} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Created and developed by Jai Singh
