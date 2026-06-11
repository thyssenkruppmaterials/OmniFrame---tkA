// Created and developed by Jai Singh
/**
 * OmniBelt — Compass Orb skin (P7 + 2026-05-24 post-launch fix)
 *
 * Alternate skin variant. Mockup #1 (`assets/omnibelt-mockup-1-
 * compass-orb.png`): a single 68 px circular glass orb rests in
 * the bottom-right corner with a slow pulse. A small teal status
 * dot sits on the upper-LEFT when there are active background
 * jobs (it lived top-right pre-fix but moved to make room for the
 * settings overflow button). Clicking the orb fans out a 130° arc
 * of tool discs above it (`<RadialFan />`) rather than mounting the
 * full grid Panel.
 *
 * Post-launch fix (2026-05-24)
 * ----------------------------
 * Two bugs reported live: "none of the buttons work, and there is
 * no way to change back to another skin." Root causes + fixes
 * documented in `Fix-OmniBelt-Orb-Interactivity-And-Skin-Picker.md`.
 *
 * 1. Shell-tool tiles in the radial fan called `close()` and did
 *    nothing visible — 6 of 9 v1 tools are shell-backed, so the
 *    user perceived "the buttons don't work". Fix: the orb now
 *    wires `onLaunchShell` into the fan and mounts an
 *    `<OrbShellPopover>` above the orb when a shell tile is picked.
 *    Navigation tiles still navigate + close as before.
 * 2. The standard `<OmniBeltPanel>` is suppressed for this skin
 *    (host's `SKINS_USING_SHARED_PANEL` set), and that panel is the
 *    only place `<PanelMenu>` (skin picker) lived. So once a user
 *    picked Orb, there was no UI path back to Pill / SkyStrip. Fix:
 *    the orb now exposes a small `⋮` overflow button at its
 *    top-right corner that opens the same `<PanelMenuContent />`
 *    (extracted from `<PanelMenu>` for reuse). The button is a
 *    sibling of the orb's `<button>` because HTML disallows nested
 *    buttons; `e.stopPropagation()` on the overflow's click handler
 *    keeps the orb's toggle from firing when the user opens the
 *    settings menu.
 *
 * Implementation notes
 * --------------------
 * - Shared `layoutId='omnibelt-host'` is reused on every state
 *   so cross-skin morphs interpolate cleanly when the user
 *   switches between Pill → Orb → Sky Strip.
 * - The Host (`OmniBeltHost.tsx`) does NOT render the standard
 *   `<OmniBeltPanel>` for `skin === 'orb'` — the RadialFan is
 *   this skin's "expanded" surface (spec §7; task §A). The
 *   shell popover above is a sibling surface, not a replacement
 *   for the panel; the host stays clean.
 * - Pulse animation uses `motion-safe:animate-pulse` (Tailwind's
 *   built-in reduced-motion modifier) on the inner ring so users
 *   with `prefers-reduced-motion: reduce` see a still orb without
 *   bespoke wiring.
 * - `collapseState === 'nub'` falls back to the existing
 *   `<PillEdgeNub />` so idle-hide still works without any
 *   nub-specific orb art for v1 — v1.5 ships a dedicated
 *   orb-tuned edge nub if real usage demands it.
 */
import { lazy, Suspense, useCallback, useState } from 'react'
import { IconCompass, IconDots } from '@tabler/icons-react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { HOUSE_SPRING, COLLAPSE_LAYOUT_ID } from '../../lib/motion'
import { OMNIBELT_OVERLAY_Z } from '../../lib/overlays'
import { PanelMenuContent } from '../../panel/PanelMenu'
import { useOmnibeltStore } from '../../store/omnibeltStore'
import type { ToolDef } from '../../tools/registry'
import { PillEdgeNub } from '../pill/PillEdgeNub'

// RadialFan is fan-only UI — lazy import keeps it out of the
// orb's collapsed-state render path until the user actually opens.
const RadialFan = lazy(() =>
  import('./RadialFan').then((m) => ({ default: m.RadialFan }))
)

// Same lazy-load story for the shell popover — mounts only when the
// user explicitly picks a shell tool from the fan, so the popover
// (and the lazy tool shell it eventually renders) stay out of the
// orb skin's first-paint cost.
const OrbShellPopover = lazy(() =>
  import('./OrbShellPopover').then((m) => ({ default: m.OrbShellPopover }))
)

/** Diameter of the compass orb (slightly bigger than the Pill mini-
 *  orb's 44 px so the radial fan has visual mass to extend from). */
const ORB_SIZE = 68

/** Resting bottom + right gutter for the orb (px). Mirrors the Pill
 *  skin's default BR offset so flipping skins doesn't shift the
 *  chrome's resting footprint. */
const ORB_GUTTER = 24

function OrbBody() {
  const collapseState = useOmnibeltStore((s) => s.collapseState)
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)
  const activeJobs = useOmnibeltStore((s) => s.activeJobs)

  const [activeShellTool, setActiveShellTool] = useState<ToolDef | null>(null)

  const hasStatus = activeJobs.length > 0
  const isOpen = collapseState === 'panel'

  const handleToggle = () => {
    setCollapseState(isOpen ? 'pill' : 'panel')
  }

  const handleLaunchShell = useCallback((tool: ToolDef) => {
    setActiveShellTool(tool)
  }, [])

  const handleClosePopover = useCallback(() => {
    setActiveShellTool(null)
  }, [])

  return (
    <>
      {/*
        Positioning wrapper — fixed at the bottom-right gutter at
        ORB_SIZE × ORB_SIZE. The orb button fills it absolutely (so
        the `layoutId` morph keeps the same bounding rect framer
        measured pre-refactor) and the overflow trigger lives as a
        sibling positioned at top-right of the same box. HTML
        disallows nested `<button>`s, so the trigger MUST be a
        sibling, not a child of the orb button.

        `data-testid='omnibelt-orb-anchor'` lets e2e tests target the
        wrapper for layout assertions; the orb button itself keeps
        `omnibelt-orb` for click tests.
      */}
      <div
        data-testid='omnibelt-orb-anchor'
        className='fixed z-[55]'
        style={{
          right: ORB_GUTTER,
          bottom: ORB_GUTTER,
          width: ORB_SIZE,
          height: ORB_SIZE,
        }}
      >
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                type='button'
                data-omnibelt-host
                data-omnibelt-skin='orb'
                data-testid='omnibelt-orb'
                layoutId={COLLAPSE_LAYOUT_ID}
                transition={HOUSE_SPRING}
                onClick={handleToggle}
                aria-label={
                  isOpen ? 'Close OmniBelt' : 'OmniBelt — open radial fan'
                }
                aria-expanded={isOpen}
                className='glass-strong focus-visible:ring-ring/50 absolute inset-0 flex items-center justify-center rounded-full shadow-lg hover:scale-105 focus-visible:ring-2 focus-visible:outline-none'
              >
                {/* Pulse ring — motion-safe modifier disables under
                    prefers-reduced-motion automatically. */}
                <span
                  aria-hidden='true'
                  className='absolute inset-2 rounded-full border border-white/15 bg-gradient-to-br from-teal-400/20 to-indigo-500/20 motion-safe:animate-pulse'
                />
                <IconCompass className='text-primary relative size-7 drop-shadow-sm' />
                {hasStatus && (
                  <span
                    aria-hidden='true'
                    data-testid='omnibelt-orb-status-dot'
                    className='ring-background absolute top-1 left-1 size-2.5 rounded-full bg-teal-400 ring-2 motion-safe:animate-pulse'
                  />
                )}
              </motion.button>
            </TooltipTrigger>
            <TooltipContent side='left'>OmniBelt · ⌘B to open</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/*
          Overflow / settings menu — sibling of the orb button (HTML
          disallows nesting `<button>`s). Positioned at the top-right
          corner of the orb's bounding box; the orb is `rounded-full`,
          so the corner is just outside the visible circle silhouette
          — the dots icon reads as a small chrome handle attached to
          the orb. The status dot lives at top-LEFT to leave this
          corner clear.

          `e.stopPropagation()` on the trigger's onClick keeps the
          orb's toggle handler from firing when the user opens the
          menu (the two clickable surfaces overlap by a few pixels at
          the corner because the orb's hit area is the full bounding
          box rect, not the circle).
        */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label='OmniBelt settings'
              data-testid='omnibelt-orb-overflow'
              onClick={(e) => e.stopPropagation()}
              className='focus-visible:ring-ring/50 absolute top-1 right-1 z-1 inline-flex size-5 items-center justify-center rounded-full bg-black/40 text-white/80 opacity-60 shadow-sm transition-opacity hover:bg-black/60 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none'
            >
              <IconDots className='size-3' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='end'
            side='top'
            className={`w-64 ${OMNIBELT_OVERLAY_Z}`}
            data-testid='omnibelt-orb-menu'
          >
            <PanelMenuContent />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/*
        Shell popover — only mounted when the user picks a shell-
        backed tool from the radial fan. Sibling of the orb so its
        own bounding rect / pointer events stay independent (the
        popover wraps `<PanelContent initialActiveTool>` which boots
        straight into the chosen tool's shell).
      */}
      <AnimatePresence>
        {activeShellTool && (
          <Suspense fallback={null} key={activeShellTool.id}>
            <OrbShellPopover
              tool={activeShellTool}
              orbSize={ORB_SIZE}
              orbBottomGutter={ORB_GUTTER}
              orbRightGutter={ORB_GUTTER}
              onClose={handleClosePopover}
            />
          </Suspense>
        )}
      </AnimatePresence>

      {/*
        Radial fan — orb's primary expanded surface. Mounted alongside
        the orb when `collapseState === 'panel'`. The fan handles
        navigation tools itself (`navigate(...)`) and delegates
        shell-backed tools to `handleLaunchShell` which surfaces the
        popover above.
      */}
      {collapseState === 'panel' && (
        <Suspense fallback={null}>
          <RadialFan orbSize={ORB_SIZE} onLaunchShell={handleLaunchShell} />
        </Suspense>
      )}
    </>
  )
}

export default function OmniBeltOrb() {
  const collapseState = useOmnibeltStore((s) => s.collapseState)

  // Edge-nub idle state reuses the Pill skin's nub component so
  // long-idle auto-hide still works without a bespoke orb nub
  // (v1 deviation — documented in the implementation log).
  if (collapseState === 'nub') return <PillEdgeNub />

  return <OrbBody />
}

// Created and developed by Jai Singh
