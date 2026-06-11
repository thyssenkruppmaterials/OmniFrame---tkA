// Created and developed by Jai Singh
/**
 * OmniBelt — Single tool tile
 *
 * Renders one square tile inside the panel grid. Visuals:
 *   - 44px rounded icon disc with the tool's accent gradient
 *   - Label below
 *   - Optional badge dot in the top-right
 *
 * Behavior:
 *   - `navigationUrl` tools route via TanStack Router.
 *   - `shell` tools fire `onLaunch(tool)` so the parent panel can
 *     render the lazy-loaded surface inline.
 *
 * Hover surfaces a Radix tooltip with the tool description for
 * keyboard + pointer users alike (matches the existing icon-button
 * pattern used throughout the app shell).
 */
import type { MouseEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { motion, useReducedMotion, useWillChange } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SNAP_SPRING, TILE_PRESS_TRANSITION } from '../lib/motion'
import { OMNIBELT_OVERLAY_Z } from '../lib/overlays'
import type { ToolDef, ToolAccent } from '../tools/registry'

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

const BADGE_TONE_BG: Record<'info' | 'warn' | 'error', string> = {
  info: 'bg-sky-500',
  warn: 'bg-amber-500',
  error: 'bg-destructive',
}

type ToolTileProps = {
  tool: ToolDef
  onLaunch: (tool: ToolDef) => void
  /** Closes the panel after navigation tools fire. */
  onAfterNavigate?: () => void
  /** Index within the grid — used by the parent's stagger variants
   *  to set a per-tile entry order. Defaults to 0 for standalone use. */
  index?: number
}

const TILE_VARIANTS = {
  hidden: { opacity: 0, y: 6, scale: 0.94 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: SNAP_SPRING,
  },
}

export function ToolTile({ tool, onLaunch, onAfterNavigate }: ToolTileProps) {
  const navigate = useNavigate()
  const reduced = useReducedMotion() ?? false
  // Each grid tile manages its own promotion: `auto` at rest, flipping
  // to `transform` only during entry-stagger / hover / tap. With a full
  // grid of tiles this avoids promoting many compositor layers at once
  // — the "avoid many promoted layers" rule in [[fixing-motion-performance]].
  const willChange = useWillChange()
  const Icon = tool.icon
  const badge = tool.badge?.() ?? null

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (tool.navigationUrl) {
      navigate({ to: tool.navigationUrl })
      onAfterNavigate?.()
      return
    }
    if (tool.shell) {
      // Stop the launching click from bubbling up to the panel /
      // skin's window-level `pointerdown` outside-click handler.
      // Without this, the same click that opens a portaled tool
      // dialog (Radix renders at document.body, outside the panel
      // tree) is interpreted as "click outside the panel" by the
      // capture-phase listener and immediately dismisses the panel,
      // unmounting the tool shell that just launched. See
      // [[Fix-OmniBelt-AgentChat-Instant-Close]] for the full
      // root-cause write-up.
      e.preventDefault()
      e.stopPropagation()
      onLaunch(tool)
    }
  }

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type='button'
            role='gridcell'
            onClick={handleClick}
            aria-label={tool.label}
            data-tool-id={tool.id}
            variants={reduced ? undefined : TILE_VARIANTS}
            // Slight lift + scale on hover, tactile press-down on
            // click. TILE_PRESS_TRANSITION is stiffer than the prior
            // LIQUID_SPRING so the press reads as a quick haptic tick
            // instead of a soft squish before the launch fires.
            whileHover={reduced ? undefined : { scale: 1.03, y: -2 }}
            whileTap={reduced ? undefined : { scale: 0.97 }}
            transition={TILE_PRESS_TRANSITION}
            className={cn(
              'group focus-visible:ring-ring/50 relative flex flex-col items-center gap-2 rounded-xl p-3 text-center',
              'hover:bg-accent/40 focus-visible:ring-2 focus-visible:outline-none'
            )}
            style={{ willChange }}
          >
            <span
              className={cn(
                'relative inline-flex size-11 items-center justify-center rounded-2xl shadow-sm ring-1 ring-white/15 transition-shadow group-hover:shadow-md',
                'bg-linear-to-br',
                ACCENT_BG_BY_ACCENT[tool.accent]
              )}
            >
              <Icon className='size-5 text-white drop-shadow-sm' />
              {badge && badge.count > 0 && (
                <span
                  className={cn(
                    'absolute -top-1 -right-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white shadow-sm ring-1 ring-white/40',
                    BADGE_TONE_BG[badge.tone]
                  )}
                  aria-label={`${badge.count} ${badge.tone}`}
                >
                  {badge.count > 99 ? '99+' : badge.count}
                </span>
              )}
            </span>
            <span className='text-foreground line-clamp-1 text-xs font-medium'>
              {tool.label}
            </span>
          </motion.button>
        </TooltipTrigger>
        {tool.description && (
          <TooltipContent side='bottom' className={OMNIBELT_OVERLAY_Z}>
            {tool.description}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  )
}

// Created and developed by Jai Singh
