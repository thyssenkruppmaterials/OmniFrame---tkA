// Created and developed by Jai Singh
/**
 * OmniBelt — PanelContent
 *
 * Presentational inner UI of the expanded OmniBelt Panel: header,
 * tool-shell switcher, search box, tab strip, and tool grid.
 * Intentionally has zero positioning chrome — the parent decides
 * where to render this and how big it is. Two consumers today:
 *
 *   - `<OmniBeltPanel>` — the Pill-skin floating panel anchored
 *     wherever the per-route widget rect lands (P6 anchor system).
 *   - `<OmniBeltSkyStrip>` — when the SkyStrip-skin morphs open, it
 *     renders the expanded form *itself* (so the strip → panel
 *     animation is a single `layoutId` morph anchored at
 *     bottom-center) and reuses this body for the inner UI.
 *
 * Why "skin owns both states" beats "shared singleton panel":
 *   - A single `motion.div layoutId='omnibelt-host'` morphs from the
 *     collapsed form to the expanded form atomically. Two separately
 *     positioned `motion.div`s with the same `layoutId` would still
 *     animate, but they can't share interior chrome (drop shadow,
 *     border radius, backdrop) without each owning a duplicate
 *     render path.
 *   - The collapsed strip is anchored at bottom-center but the
 *     standard `<OmniBeltPanel>` resolves its position from the P6
 *     anchor system. Routing both through a singleton panel would
 *     require a "positionOverride" prop that drags two coordinate
 *     systems through the same component.
 *   - See [[Skin-Owned-Morph-States]] for the full pattern write-up.
 *
 * Lifecycle:
 *   - Esc + click-outside close handlers live in the parent
 *     (`<OmniBeltPanel>` / `<OmniBeltSkyStrip>`) because their
 *     pointer-outside boundary depends on the parent's bounding box.
 *   - Internal lazy-shell launches mount inline via `Suspense`;
 *     closing returns to the tile grid (panel-local state stays
 *     here so we don't churn the parent on every shell open).
 *
 * Accessibility (spec §19):
 *   - Heading + close button are part of this component so screen
 *     readers always announce the panel structure regardless of
 *     which skin is the host.
 *   - Tool grid is `role='grid'`; each tile is `role='gridcell'`
 *     (see `ToolTile.tsx`).
 */
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { IconArrowLeft, IconX } from '@tabler/icons-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { CONTENT_STAGGER, SNAP_SPRING, TOOL_LAUNCH_SPRING } from '../lib/motion'
import type { ToolDef } from '../tools/registry'
import { useResolvedTools } from '../tools/use-resolved-tools'
import { PanelMenu } from './PanelMenu'
import { PanelSearch } from './PanelSearch'
import { PanelTabs, type PanelTabId } from './PanelTabs'
import { ToolTile } from './ToolTile'

/** Wrapper memoizes the lazy import per tool id so re-renders don't
 *  re-issue the dynamic import. */
const shellCache = new Map<string, ReturnType<typeof lazy>>()
function getShellComponent(tool: ToolDef) {
  if (!tool.shell) return null
  const cached = shellCache.get(tool.id)
  if (cached) return cached
  const lazyComp = lazy(tool.shell)
  shellCache.set(tool.id, lazyComp)
  return lazyComp
}

export type PanelContentProps = {
  /** Invoked when the user dismisses the panel (Esc, ×, or after
   *  successful tool navigation). */
  onClose: () => void
  /**
   * Optional tool to preselect for the in-panel shell on first
   * mount. When set, the panel boots straight into that tool's
   * shell instead of the search + grid. Used by the Compass Orb
   * skin's shell popover: the radial fan picks the tool, then the
   * popover renders this body anchored above the orb so the user
   * never sees a redundant grid for a tool they just chose.
   * (The user can still navigate back to the grid via the
   * "All tools" button — same behaviour as launching from the
   * panel grid itself.)
   */
  initialActiveTool?: ToolDef | null
}

export function PanelContent({
  onClose,
  initialActiveTool = null,
}: PanelContentProps) {
  const [tab, setTab] = useState<PanelTabId>('all')
  const [query, setQuery] = useState('')
  const [activeTool, setActiveTool] = useState<ToolDef | null>(
    initialActiveTool
  )
  const reduced = useReducedMotion() ?? false

  const { pinned, all, filtered_count } = useResolvedTools()

  const queryNormalized = query.trim().toLowerCase()

  const matchesQuery = useCallback(
    (t: ToolDef) =>
      queryNormalized === '' ||
      t.label.toLowerCase().includes(queryNormalized) ||
      (t.description?.toLowerCase().includes(queryNormalized) ?? false) ||
      t.id.toLowerCase().includes(queryNormalized),
    [queryNormalized]
  )

  const visiblePinned = useMemo(
    () => pinned.filter((t) => t.searchable && matchesQuery(t)),
    [pinned, matchesQuery]
  )
  const visibleAll = useMemo(
    () => all.filter((t) => t.searchable && matchesQuery(t)),
    [all, matchesQuery]
  )

  const launch = (tool: ToolDef) => setActiveTool(tool)
  const closeShell = () => setActiveTool(null)

  const renderGrid = (tools: ToolDef[]) => {
    if (tools.length === 0) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SNAP_SPRING}
          className='text-muted-foreground flex flex-col items-center justify-center gap-1 px-6 py-12 text-center'
        >
          <p className='text-sm font-medium'>No matching tools</p>
          {filtered_count > 0 && (
            <p className='text-xs'>
              {filtered_count} hidden by org / role policy or permissions.
            </p>
          )}
        </motion.div>
      )
    }
    return (
      <motion.div
        role='grid'
        aria-label='OmniBelt tools'
        className='grid grid-cols-4 gap-1 p-1'
        // Orchestrate a fast stagger so the grid feels alive on open
        // without dragging the strip→panel morph. Each tile owns the
        // visible animation via its own variants.
        initial='hidden'
        animate='show'
        variants={{
          hidden: {},
          show: {
            transition: {
              staggerChildren: 0.025,
              delayChildren: 0.04,
            },
          },
        }}
      >
        {tools.map((t, idx) => (
          <ToolTile
            key={t.id}
            tool={t}
            index={idx}
            onLaunch={launch}
            onAfterNavigate={onClose}
          />
        ))}
      </motion.div>
    )
  }

  const ShellComp = activeTool ? getShellComponent(activeTool) : null

  // Cinematic swap between the tile grid and an active tool shell.
  // `AnimatePresence mode='wait'` ensures only one body is mounted at
  // a time so the spring-based scale + slide isn't fighting a stale
  // sibling. Children below get the same `CONTENT_STAGGER` cascade so
  // the header / search / tabs / grid (or the shell's own header /
  // body) reveal in a smooth sequence after the container settles.
  // See [[OmniBelt-Floating-Launcher]] §"Tool launch motion".
  const swapKey = activeTool ? `shell:${activeTool.id}` : 'grid'
  const swapInitial = reduced
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.96, y: 4 }
  const swapAnimate = reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }
  const swapExit = reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }

  // Suppress the panel-level search and grid while a tool tab is
  // 'recent' / 'running' — these tabs render their own content
  // through PanelTabs and don't reuse the tool grid.
  return (
    <AnimatePresence mode='wait' initial={false}>
      <motion.div
        key={swapKey}
        initial={swapInitial}
        animate={swapAnimate}
        exit={swapExit}
        transition={TOOL_LAUNCH_SPRING}
        className='flex flex-col gap-3'
        // Stagger reveals the inner chrome (header / search / tabs /
        // grid OR the shell's own children) once the container has
        // settled. Children opt-in via `variants={{ hidden, show }}`
        // — those that don't simply animate their own enter as
        // before.
        variants={{
          hidden: {},
          show: { transition: CONTENT_STAGGER },
        }}
      >
        {activeTool && ShellComp ? (
          <>
            <div className='flex items-center justify-between'>
              <Button
                variant='ghost'
                size='sm'
                onClick={closeShell}
                className='-ml-2 gap-1.5'
              >
                <IconArrowLeft className='size-4' /> All tools
              </Button>
              <Button
                variant='ghost'
                size='icon'
                aria-label='Close OmniBelt panel'
                onClick={onClose}
                className='size-7'
              >
                <IconX className='size-4' />
              </Button>
            </div>
            <Suspense
              fallback={
                <p className='text-muted-foreground py-8 text-center text-xs'>
                  Loading {activeTool.label}…
                </p>
              }
            >
              <ShellComp onClose={closeShell} />
            </Suspense>
          </>
        ) : (
          <>
            <header className='flex items-center justify-between gap-2'>
              <h2 className='text-sm font-semibold'>OmniBelt</h2>
              <div className='flex items-center gap-1'>
                <PanelMenu />
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label='Close OmniBelt panel'
                  onClick={onClose}
                  className='size-7'
                >
                  <IconX className='size-4' />
                </Button>
              </div>
            </header>
            <PanelSearch value={query} onValueChange={setQuery} />
            <PanelTabs
              value={tab}
              onValueChange={setTab}
              pinnedContent={renderGrid(visiblePinned)}
              allContent={renderGrid(visibleAll)}
            />
          </>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

// Created and developed by Jai Singh
