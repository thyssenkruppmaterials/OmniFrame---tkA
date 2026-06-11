// Created and developed by Jai Singh
/**
 * OmniBelt — Edge nub
 *
 * 6 px sliver hugging the docked edge. Reached when the user's
 * idle-hide timer fires; hover wakes back to the mini-orb.
 *
 * Wraps in `<motion.button layoutId='omnibelt-host'>` so the
 * pill → orb → nub collapse is the same continuous morph (spec §9).
 *
 * P6: nub anchor is chosen by mapping the route's stored corner anchor
 * onto the nearest edge nub (TR/BR → NUB_R, TL/BL → NUB_L, TC → NUB_T,
 * BC → NUB_B; defaults to NUB_R to preserve the historical bottom-right
 * dock). Collision avoidance still runs so a docked toaster pushes the
 * nub out of the way.
 */
import { useMemo } from 'react'
import { motion, useWillChange } from 'framer-motion'
import { useOmnibeltCollisionAvoidance } from '../../hooks/useOmnibeltCollisionAvoidance'
import { useOmnibeltPosition } from '../../hooks/useOmnibeltPosition'
import type { AnchorName } from '../../lib/anchors'
import {
  HOUSE_SPRING,
  LIQUID_SPRING,
  COLLAPSE_LAYOUT_ID,
} from '../../lib/motion'
import { useOmnibeltStore } from '../../store/omnibeltStore'

const NUB_WIDTH = 6
const NUB_HEIGHT = 48

function pickNubFor(anchor: AnchorName): AnchorName {
  switch (anchor) {
    case 'TL':
    case 'ML':
    case 'BL':
    case 'NUB_L':
      return 'NUB_L'
    case 'TC':
    case 'NUB_T':
      return 'NUB_T'
    case 'BC':
    case 'NUB_B':
      return 'NUB_B'
    // TR / MR / BR / FREE / PINNED / NUB_R / unknown → right edge
    default:
      return 'NUB_R'
  }
}

export function PillEdgeNub() {
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)
  // Read the route's stored anchor (before forcing) so we can pick the
  // matching nub edge — we still feed the position hook a forced anchor
  // so `resolveAnchorPosition` snaps flush to the edge.
  const probe = useOmnibeltPosition({
    widgetW: NUB_WIDTH,
    widgetH: NUB_HEIGHT,
  })
  const nubAnchor = useMemo(
    () => pickNubFor(probe.storedPosition.anchor),
    [probe.storedPosition.anchor]
  )

  const position = useOmnibeltPosition({
    widgetW: NUB_WIDTH,
    widgetH: NUB_HEIGHT,
    forceAnchor: nubAnchor,
  })
  const collision = useOmnibeltCollisionAvoidance({ widget: position.rect })
  const rect = collision.adjustedRect
  // Managed promotion — the docked sliver rests on every page, so keep
  // it `auto` until a wake/hover/morph (see [[fixing-motion-performance]]).
  const willChange = useWillChange()

  return (
    <motion.button
      type='button'
      data-omnibelt-host
      data-testid='omnibelt-edge-nub'
      data-nub-anchor={nubAnchor}
      layoutId={COLLAPSE_LAYOUT_ID}
      transition={position.reducedMotion ? { duration: 0 } : HOUSE_SPRING}
      onMouseEnter={() => setCollapseState('orb')}
      onFocus={() => setCollapseState('orb')}
      onClick={() => setCollapseState('pill')}
      aria-label='OmniBelt — hover to expand'
      // Inline `width`/`height` keep the nub at its 6×48 px sliver
      // dimensions; the `hover:w-2` class trick was dead code under
      // inline-style precedence. Instead we use framer's `whileHover`
      // to scale the sliver out on its dominant axis so it visibly
      // "wakes" before transitioning back to the orb on actual hover.
      whileHover={
        position.reducedMotion
          ? undefined
          : nubAnchor === 'NUB_T' || nubAnchor === 'NUB_B'
            ? { scaleY: 1.6, transition: LIQUID_SPRING }
            : { scaleX: 1.6, transition: LIQUID_SPRING }
      }
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
        zIndex: 55,
        width: NUB_WIDTH,
        height: NUB_HEIGHT,
        // Transform origin pins the scale-out to the docked edge so
        // the sliver doesn't visually creep into the viewport.
        transformOrigin:
          nubAnchor === 'NUB_L'
            ? 'left center'
            : nubAnchor === 'NUB_R'
              ? 'right center'
              : nubAnchor === 'NUB_T'
                ? 'center top'
                : 'center bottom',
        willChange,
      }}
      className='glass cursor-pointer rounded-md ring-1 ring-white/15'
    />
  )
}

// Created and developed by Jai Singh
