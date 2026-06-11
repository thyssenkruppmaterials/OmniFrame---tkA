// Created and developed by Jai Singh
/**
 * OmniBelt — Orb skin shell popover
 *
 * Renders a single tool's panel-shell UI in a glass card anchored
 * above the Compass Orb. Mounted by `<OmniBeltOrb>` when the user
 * picks a shell-backed tool from the radial fan.
 *
 * Why this exists (post-launch fix, 2026-05-24)
 * --------------------------------------------
 * The Orb skin deliberately suppresses the standard `<OmniBeltPanel>`
 * (see `OmniBeltHost.SKINS_USING_SHARED_PANEL`) and instead expands
 * via `<RadialFan>`. The fan launches navigation-backed tools fine
 * (TanStack `navigate(...)`), but for shell-backed tools (6 of the 9
 * v1 tools) the v1 fan just called `close()` and did nothing visible
 * — the user perceived "buttons don't work". This popover lets shell
 * tools actually open without dragging the standard Panel back into
 * the Orb skin's render tree (which would otherwise double up the
 * fan + the grid panel).
 *
 * Anchoring
 * ---------
 * Fixed at the bottom-right gutter, just above the 68 px orb with
 * a 16 px gap. Width capped to `min(420px, calc(100vw - 32px))` so
 * narrow viewports collapse gracefully. Height clamps to 70 vh with
 * `overflow-y: auto`. The popover does NOT share `layoutId` with the
 * orb — it's a distinct surface that pops above the orb, not a
 * morph of it. (The orb stays mounted underneath so the user can
 * click it to dismiss the popover via the click-outside handler.)
 *
 * Lifecycle
 * ---------
 * - Esc + click-outside collapse via `onClose`, mirroring the
 *   `<OmniBeltPanel>` / `<RadialFan>` dismissal contract. We skip
 *   clicks on `[data-omnibelt-host]` (the orb itself) and on any
 *   OmniBelt-owned portaled overlay (Radix menus / tooltips) so the
 *   user can interact with the orb's overflow menu without losing
 *   the popover.
 * - `<PanelContent initialActiveTool={tool}>` boots straight into
 *   the chosen shell. The user can still navigate back to the full
 *   grid via the panel's "All tools" button — same behaviour as
 *   launching from the standard Panel.
 */
import { useCallback, useEffect, useRef } from 'react'
import { motion, useWillChange } from 'framer-motion'
import { TOOL_LAUNCH_SPRING } from '../../lib/motion'
import { isOmnibeltOverlayPointerTarget } from '../../lib/overlays'
import { PanelContent } from '../../panel/PanelContent'
import type { ToolDef } from '../../tools/registry'

type OrbShellPopoverProps = {
  /** Tool to render. Must have a `shell` defined — caller filters
   *  navigation-only tools to the radial fan's navigate-path. */
  tool: ToolDef
  /** Diameter of the orb (px). Drives the bottom-gutter math so the
   *  popover always sits exactly `GAP_PX` above the orb regardless
   *  of the orb's configured size. */
  orbSize: number
  /** Bottom gutter of the orb itself (px from viewport bottom). */
  orbBottomGutter: number
  /** Right gutter of the orb (px from viewport right). The popover
   *  uses the same gutter so its right edge aligns with the orb's. */
  orbRightGutter: number
  /** Invoked on Esc, outside-click, or the user closing the panel. */
  onClose: () => void
}

/** Vertical space between the top of the orb and the bottom of the
 *  popover. 16 px reads as "associated but distinct" — same idiom as
 *  the PillPositionMenu's offset from the pill. */
const GAP_PX = 16

/** Popover width cap. Sized to fit the panel grid (4 cols × 88 px
 *  tile + gaps) without overflowing on phones. */
const POPOVER_WIDTH_PX = 420

/** Maximum popover height (vh). Matches the SkyStrip expanded panel
 *  so cross-skin shell launches don't feel inconsistent. */
const POPOVER_MAX_HEIGHT_VH = 70

export function OrbShellPopover({
  tool,
  orbSize,
  orbBottomGutter,
  orbRightGutter,
  onClose,
}: OrbShellPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  // Managed promotion — `auto` until the bloom runs; the popover only
  // mounts while a shell tool is open (see [[fixing-motion-performance]]).
  const willChange = useWillChange()

  const close = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null
      if (!target) return
      // Portaled Radix menus/tooltips live outside the popover DOM
      // tree (the orb's overflow menu, for example) — let those clicks
      // through without dismissing.
      if (isOmnibeltOverlayPointerTarget(target)) return
      if (popoverRef.current && popoverRef.current.contains(target)) return
      // The orb's button and any other host-tagged surface should not
      // double-dismiss either (the user clicking the orb expects toggle
      // semantics, handled by the orb's own onClick).
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
  }, [close])

  return (
    <motion.div
      ref={popoverRef}
      data-testid='omnibelt-orb-shell-popover'
      data-tool-id={tool.id}
      role='dialog'
      aria-modal='false'
      aria-label={tool.label}
      // Cinematic mount — same TOOL_LAUNCH_SPRING the dialog tools use
      // so the bloom feels consistent across surfaces (the orb's
      // popover and the chat dialog are sibling launch surfaces; they
      // should share motion language).
      initial={{ opacity: 0, scale: 0.94, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 8 }}
      transition={TOOL_LAUNCH_SPRING}
      style={{
        position: 'fixed',
        right: orbRightGutter,
        bottom: orbBottomGutter + orbSize + GAP_PX,
        width: `min(${POPOVER_WIDTH_PX}px, calc(100vw - 32px))`,
        maxHeight: `${POPOVER_MAX_HEIGHT_VH}vh`,
        zIndex: 60,
        willChange,
      }}
      className='glass-strong text-foreground flex flex-col gap-3 overflow-y-auto rounded-2xl p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl'
    >
      <PanelContent onClose={close} initialActiveTool={tool} />
    </motion.div>
  )
}

// Created and developed by Jai Singh
