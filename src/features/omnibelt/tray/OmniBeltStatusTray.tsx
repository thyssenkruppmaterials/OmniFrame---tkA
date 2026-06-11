// Created and developed by Jai Singh
/**
 * OmniBelt — OmniBeltStatusTray (P5)
 *
 * The Mach 3 status surface. Lists every active background job
 * with a colour-coded type chip, label, progress bar, percent and
 * (when permitted) a cancel button.
 *
 * ## Behaviour matrix (spec §10.2)
 *
 * Driven by the persisted `mach3Behavior` setting on the store:
 *
 *   - `halo_only`               — Tray never auto-expands; halo is
 *                                  the only feedback. Click-to-toggle
 *                                  on the halo still works.
 *   - `halo_plus_autoexpand`    — DEFAULT. New job started by current
 *                                  user → auto-expand the tray for 4s
 *                                  → auto-collapse back to halo-only.
 *                                  Re-opening (click / new own-job)
 *                                  resets the timer.
 *   - `halo_plus_morph`         — v1.5. Maps to `halo_plus_autoexpand`
 *                                  in v1 because the morph requires
 *                                  the Pill ↔ Tray layout swap which
 *                                  is held back to the next phase.
 *   - `halo_plus_tray_pinned`   — Tray stays open as long as any job
 *                                  is active. Click-to-toggle still
 *                                  works but the pin re-opens it on
 *                                  the next own-job event.
 *
 * ## Anchoring
 *
 * The tray renders as a `position: fixed` glass panel placed near
 * the OmniBelt host (Pill / Orb / Skystrip). For v1 we anchor by
 * the *current viewport edge*: jobs in the top half of the screen
 * → render below the host; bottom half → render above. This avoids
 * pulling the host's bounding rect into the tray and keeps the
 * surfaces independently re-renderable. v1.5 wires a per-route
 * BoundingClientRect-based anchor via the existing
 * `useOmnibeltPosition` plumbing.
 *
 * ## Accessibility
 *
 * The wrapper carries `role="status" aria-live="polite"` so a job
 * appearing while the user is focused elsewhere announces with the
 * canonical "Job N — running" line. We do *not* repeat the
 * progress percentage on every update — that would pollute the
 * screen reader queue. The `<JobRow>`s themselves keep their
 * progressbar role for explicit follow-up via the rotor.
 */
import { useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useOmnibeltJobs } from '../hooks/useOmnibeltJobs'
import { HOUSE_SPRING } from '../lib/motion'
import {
  useOmnibeltStore,
  getOmnibeltStore,
  type ActiveJob,
} from '../store/omnibeltStore'
import { JobRow } from './JobRow'

/** How long the tray stays open after a new own-job appears, when
 *  `mach3Behavior === 'halo_plus_autoexpand'`. Spec §10.2. */
export const AUTOEXPAND_HOLD_MS = 4000

export function OmniBeltStatusTray() {
  const activeJobs = useOmnibeltStore((s) => s.activeJobs)
  const trayOpen = useOmnibeltStore((s) => s.trayOpen)
  const mach3Behavior = useOmnibeltStore((s) => s.mach3Behavior)
  const setTrayOpen = useOmnibeltStore((s) => s.setTrayOpen)
  const positionByRoute = useOmnibeltStore((s) => s.positionByRoute)
  const { cancelJob } = useOmnibeltJobs()

  // Track which own-job IDs we've already greeted so a re-render
  // (e.g. progress tick) doesn't re-fire the auto-expand. The
  // ref-based set survives store updates without forcing the
  // effect to depend on `activeJobs` identity.
  const greetedOwnJobIds = useRef<Set<string>>(new Set())
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Pin behaviour — keep tray open while any job is active.
  useEffect(() => {
    if (mach3Behavior !== 'halo_plus_tray_pinned') return
    if (activeJobs.length > 0 && !trayOpen) {
      setTrayOpen(true)
    } else if (activeJobs.length === 0 && trayOpen) {
      setTrayOpen(false)
    }
  }, [mach3Behavior, activeJobs.length, trayOpen, setTrayOpen])

  // Auto-expand-on-new-own-job behaviour.
  useEffect(() => {
    // halo_plus_morph maps to autoexpand in v1 (see §10.2 above).
    const autoExpandActive =
      mach3Behavior === 'halo_plus_autoexpand' ||
      mach3Behavior === 'halo_plus_morph'
    if (!autoExpandActive) return

    // Detect new own-jobs that appeared since the last render.
    const newOwnJobs = activeJobs.filter(
      (j) => j.startedByCurrentUser && !greetedOwnJobIds.current.has(j.id)
    )

    // Drop greeted entries that have since been evicted from
    // `activeJobs` so the set doesn't grow unbounded across a
    // long-running session.
    const liveIds = new Set(activeJobs.map((j) => j.id))
    for (const greetedId of greetedOwnJobIds.current) {
      if (!liveIds.has(greetedId)) {
        greetedOwnJobIds.current.delete(greetedId)
      }
    }

    if (newOwnJobs.length === 0) return

    for (const job of newOwnJobs) {
      greetedOwnJobIds.current.add(job.id)
    }

    setTrayOpen(true)

    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null
      // Only auto-collapse when the user hasn't flipped to the
      // pinned-tray behaviour during the 4 s hold. Read the
      // current value from the store directly — the closure-
      // captured `mach3Behavior` may be stale across re-renders.
      const currentBehavior =
        getOmnibeltStore()?.getState().mach3Behavior ?? mach3Behavior
      if (currentBehavior === 'halo_plus_tray_pinned') return
      setTrayOpen(false)
    }, AUTOEXPAND_HOLD_MS)

    return () => {
      // Don't clear the collapse timer here — we want it to fire
      // even if the consumer re-renders. Cleanup on unmount is
      // handled in a sibling effect below.
    }
  }, [activeJobs, mach3Behavior, setTrayOpen])

  // Final unmount cleanup.
  useEffect(() => {
    return () => {
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current)
        collapseTimer.current = null
      }
    }
  }, [])

  const handleCancel = useCallback(
    async (id: string) => {
      try {
        await cancelJob(id)
      } catch (err) {
        // Cancel is a no-op in v1 — surface the warning silently.
        // The hook already logs once via `logger.warn`. Keep this
        // try/catch so a future cancel-endpoint rollout doesn't
        // need a tray patch to handle rejections gracefully.
        void err
      }
    },
    [cancelJob]
  )

  // Render the dismiss button click handler for the panel header.
  const onDismiss = useCallback(() => {
    setTrayOpen(false)
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
  }, [setTrayOpen])

  // The tray is functionally meaningful only when there are jobs
  // AND the surface is opened. AnimatePresence handles the exit
  // animation when either flips to false.
  const visible = trayOpen && activeJobs.length > 0

  // Determine the side from the currently active route's anchor.
  // No route → default to bottom half.
  const side = inferSide(positionByRoute)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          data-testid='omnibelt-status-tray'
          data-tray-side={side}
          role='status'
          aria-live='polite'
          aria-label='OmniBelt active jobs'
          initial={{ opacity: 0, y: side === 'top' ? -8 : 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: side === 'top' ? -8 : 8, scale: 0.96 }}
          transition={HOUSE_SPRING}
          style={{
            position: 'fixed',
            // Pin the tray to a corner that matches the side, so it
            // never overlaps the Pill/Orb itself. The exact rect
            // tracking against the host is v1.5 work.
            right: 16,
            ...(side === 'top'
              ? { top: 64 + 8 } // below typical app header
              : { bottom: 64 + 8 }), // above the typical Pill BR anchor
            zIndex: 60,
            width: 320,
          }}
          className='glass-strong rounded-xl px-2 py-2 shadow-lg'
        >
          <div className='flex items-center justify-between px-1.5 pb-1'>
            <span className='text-foreground text-xs font-semibold'>
              Active jobs
              <span className='text-muted-foreground ml-1.5 tabular-nums'>
                ({activeJobs.length})
              </span>
            </span>
            <button
              type='button'
              data-testid='omnibelt-status-tray-dismiss'
              onClick={onDismiss}
              aria-label='Dismiss active jobs tray'
              className='text-muted-foreground hover:text-foreground hover:bg-accent/40 focus-visible:ring-ring/50 inline-flex size-5 items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:outline-none'
            >
              <span aria-hidden className='text-base leading-none'>
                ×
              </span>
            </button>
          </div>
          <div className='flex flex-col gap-0.5'>
            {activeJobs.map((job) => (
              <JobRow key={job.id} job={job} onCancel={handleCancel} />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Cheap heuristic — pick "top" or "bottom" based on whichever
 *  anchor is currently active in `positionByRoute`. If no anchor
 *  is stored yet (fresh user, no drag), default to "bottom" since
 *  the Pill renders BR by default. Pure for testability. */
function inferSide(
  positionByRoute: Record<string, { anchor: string } | undefined> | undefined
): 'top' | 'bottom' {
  if (!positionByRoute) return 'bottom'
  for (const v of Object.values(positionByRoute)) {
    if (!v) continue
    const a = v.anchor
    if (a === 'TL' || a === 'TC' || a === 'TR' || a === 'NUB_T') return 'top'
  }
  return 'bottom'
}

export default OmniBeltStatusTray

/** Test-only export so unit tests can drive the side heuristic
 *  without manufacturing the full Zustand state. */
/* eslint-disable-next-line react-refresh/only-export-components -- test-only export colocated with component */
export const __test__ = { inferSide }

/** Test-only — clears the in-memory greeted-set so consecutive
 *  test runs in the same JS context don't bleed state. The
 *  greeted ref is component-local; tests should normally rely on
 *  unmount + remount. This export is here for exceptional cases. */
/* eslint-disable-next-line react-refresh/only-export-components -- test-only export colocated with component */
export function __resetTrayMemoryForTests(_job?: ActiveJob[]): void {
  // Intentional no-op — kept as an explicit hook for future
  // module-level memory if/when the greeted-set moves out of
  // the component's ref.
}

// Created and developed by Jai Singh
