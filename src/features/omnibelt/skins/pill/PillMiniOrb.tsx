// Created and developed by Jai Singh
/**
 * OmniBelt — Pill mini-orb
 *
 * 44px circular glass orb, the smallest interactive collapse target.
 * Clicking expands to the full Pill. Wraps in `<motion.button
 * layoutId='omnibelt-host'>` so framer interpolates between Orb /
 * Pill / Panel as one continuous morph (spec §9).
 *
 * Renders only when `collapseState === 'orb'` — sibling Pill /
 * Panel / Nub components handle their own states. Sharing the
 * `layoutId` is what makes the transitions feel like one object,
 * not a crossfade between distinct widgets.
 *
 * P6: position resolves through the 12-anchor system via
 * `useOmnibeltPosition`. The orb shares the route-class anchor with
 * the full Pill so collapsing pill → orb stays in place.
 */
import { IconSparkles } from '@tabler/icons-react'
import { motion, useWillChange } from 'framer-motion'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useOmnibeltCollisionAvoidance } from '../../hooks/useOmnibeltCollisionAvoidance'
import { useOmnibeltPosition } from '../../hooks/useOmnibeltPosition'
import {
  HOUSE_SPRING,
  LIQUID_SPRING,
  COLLAPSE_LAYOUT_ID,
} from '../../lib/motion'
import { OMNIBELT_OVERLAY_Z } from '../../lib/overlays'
import { useOmnibeltStore } from '../../store/omnibeltStore'

const ORB_SIZE = 44

type PillMiniOrbProps = {
  className?: string
}

export function PillMiniOrb({ className }: PillMiniOrbProps) {
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)
  const position = useOmnibeltPosition({
    widgetW: ORB_SIZE,
    widgetH: ORB_SIZE,
  })
  const collision = useOmnibeltCollisionAvoidance({ widget: position.rect })
  const rect = collision.adjustedRect
  // Managed promotion — `auto` while the orb rests; framer flips it to
  // `transform` for the hover/tap/morph only (see [[fixing-motion-performance]]).
  const willChange = useWillChange()

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type='button'
            data-omnibelt-host
            data-testid='omnibelt-mini-orb'
            layoutId={COLLAPSE_LAYOUT_ID}
            transition={position.reducedMotion ? { duration: 0 } : HOUSE_SPRING}
            onClick={() => setCollapseState('pill')}
            aria-label='OmniBelt — open tool launcher'
            aria-expanded={false}
            whileHover={
              position.reducedMotion
                ? undefined
                : { scale: 1.08, transition: LIQUID_SPRING }
            }
            whileTap={position.reducedMotion ? undefined : { scale: 0.94 }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
              zIndex: 55,
              willChange,
            }}
            className={
              'glass-strong focus-visible:ring-ring/50 flex size-11 items-center justify-center rounded-full shadow-lg ring-1 ring-white/15 focus-visible:ring-2 focus-visible:outline-none ' +
              (className ?? '')
            }
          >
            <IconSparkles className='text-primary size-5' />
          </motion.button>
        </TooltipTrigger>
        <TooltipContent side='left' className={OMNIBELT_OVERLAY_Z}>
          OmniBelt · ⌘B to open
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Created and developed by Jai Singh
