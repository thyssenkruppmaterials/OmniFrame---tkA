// Created and developed by Jai Singh
/**
 * OmniBelt — useOmnibeltJobs (P5)
 *
 * Subscribes to the existing `workServiceWs` singleton and aggregates
 * background-job lifecycle events into the Zustand store's
 * `activeJobs: ActiveJob[]` runtime field. Drives the Mach 3 halo
 * rings and the `<OmniBeltStatusTray>` surface.
 *
 * No new Supabase realtime channels — banned by
 * `.cursor/rules/realtime-policy.mdc`. Mirrors the
 * `useOmnibeltConfigInvalidator` subscribe / `removeHandler` shape so
 * the WS lifecycle stays consistent across OmniBelt consumers.
 *
 * ## Source variants (today)
 *
 * The Rust `WsEvent` enum doesn't have a single canonical
 * `JobProgress` variant — instead it emits per-source variants that
 * each carry a status + opaque id. We aggregate three of them into
 * the unified `ActiveJob` shape:
 *
 *   - `SapJobStatusChanged`    → `type: 'sap_import' | 'sap_export' | 'agent_job'`
 *   - `ImportRunStatusChanged` → `type: 'sap_import'` (runs are SAP outbound→imports)
 *   - `TriggerFired`           → `type: 'agent_job'` (an agent job was queued)
 *
 * Other sources (`scheduled`, `report`, generic background work)
 * don't have a wire variant yet and are reserved for v1.5. Their
 * tokens still ship in CSS so the halo lights up the moment a
 * future variant arrives.
 *
 * ## Progress derivation
 *
 * None of the existing variants carry a numeric `progress: 0..1`
 * field. We derive progress from the textual `status`:
 *
 *   - "queued" / "pending"           → 0.05
 *   - "running" / "in_progress" /
 *     "started" + step != null       → 0.5  (or 0.25 + 0.25 * step_hint)
 *   - "succeeded" / "completed" /
 *     "ok" / "done"                  → 1.0  (then evicted after 800ms)
 *   - "failed" / "error" / "cancelled" → drop immediately
 *
 * The 800ms terminal-state hold lets the halo "complete" visibly
 * before the ring vanishes, matching the spec §10's perceptual
 * goal that finished work feels acknowledged rather than vanished.
 *
 * ## 1% diff threshold (spec §15.6)
 *
 * Inbound `JobProgress` events that change a single job's progress
 * by less than 1% are dropped *before* committing to the store, so
 * a chatty backend can't trigger a re-render storm on the halo.
 * Add / remove always re-renders.
 *
 * ## startedByCurrentUser
 *
 * The Rust variants carry `user_id` for `SapJobStatusChanged` /
 * `TriggerFired` (the operator who kicked off the job).
 * `ImportRunStatusChanged` does not — runs are org-scoped, not
 * user-scoped — so we conservatively mark them as
 * `startedByCurrentUser = false`. The Tray's halo_plus_autoexpand
 * behavior is gated on this flag, matching spec §10.2 (auto-expand
 * is reserved for jobs the *user* started).
 */
import { useEffect } from 'react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import { workServiceWs } from '@/lib/work-service'
import type { WsEvent } from '@/lib/work-service'
import {
  useOmnibeltStore,
  getOmnibeltStore,
  type ActiveJob,
  type ActiveJobType,
} from '../store/omnibeltStore'

// ---- Aggregation tunables -------------------------------------------------

/** Spec §15.6 — only re-render the halo when a job's progress moves
 *  by at least this fraction. Add / remove always re-render. */
export const PROGRESS_DIFF_THRESHOLD = 0.01

/** How long to keep a job visible after it transitions to a
 *  terminal success state (so the halo briefly hits 100% before
 *  the ring disappears). Failure / cancel removes immediately. */
export const TERMINAL_HOLD_MS = 800

// ---- Status → progress mapping --------------------------------------------

const QUEUED_STATUSES = new Set([
  'queued',
  'pending',
  'scheduled',
  'waiting',
  'created',
])

const RUNNING_STATUSES = new Set([
  'running',
  'in_progress',
  'started',
  'processing',
  'streaming',
])

const SUCCESS_STATUSES = new Set([
  'succeeded',
  'completed',
  'ok',
  'done',
  'finished',
])

const FAILURE_STATUSES = new Set([
  'failed',
  'error',
  'errored',
  'cancelled',
  'canceled',
  'aborted',
  'timeout',
  'timed_out',
])

type Lifecycle = 'queued' | 'running' | 'success' | 'failure' | 'unknown'

function lifecycleOf(status: string | null | undefined): Lifecycle {
  if (!status) return 'unknown'
  const s = status.toLowerCase()
  if (QUEUED_STATUSES.has(s)) return 'queued'
  if (RUNNING_STATUSES.has(s)) return 'running'
  if (SUCCESS_STATUSES.has(s)) return 'success'
  if (FAILURE_STATUSES.has(s)) return 'failure'
  return 'unknown'
}

function progressFromLifecycle(life: Lifecycle): number {
  switch (life) {
    case 'queued':
      return 0.05
    case 'running':
      return 0.5
    case 'success':
      return 1.0
    case 'failure':
    case 'unknown':
      return 0
  }
}

// ---- Variant → ActiveJob normalizer ---------------------------------------

type NormalizedEvent =
  | { kind: 'upsert'; job: ActiveJob }
  | { kind: 'remove'; id: string; afterMs?: number }

function inferSapJobType(step: string | null | undefined): ActiveJobType {
  // Agent jobs that touch SAP cover both inbound (import) and outbound
  // (export). The Rust variant doesn't tag the direction, so we
  // pattern-match on the step label which the agent fills in. Default
  // to `'agent_job'` (the most generic colour) when unknown — better
  // than mis-categorising as a SAP import.
  if (!step) return 'agent_job'
  const s = step.toLowerCase()
  if (s.includes('import') || s.includes('inbound') || s.includes('lx03')) {
    return 'sap_import'
  }
  if (s.includes('export') || s.includes('outbound') || s.includes('confirm')) {
    return 'sap_export'
  }
  return 'agent_job'
}

function labelForSapJob(
  jobId: string,
  step: string | null | undefined
): string {
  if (step && step.trim()) return step
  // Fall back to a short suffix of the UUID so multiple concurrent
  // jobs are distinguishable in the tray.
  const tail = jobId.slice(-6)
  return `Agent job ${tail}`
}

function normalizeEvent(
  event: WsEvent,
  currentUserId: string | null
): NormalizedEvent | null {
  switch (event.type) {
    case 'SapJobStatusChanged': {
      if (!event.job_id) return null
      const life = lifecycleOf(event.status)
      const type = inferSapJobType(event.step ?? null)

      if (life === 'failure') {
        return { kind: 'remove', id: event.job_id }
      }

      const progress = progressFromLifecycle(life)
      const job: ActiveJob = {
        id: event.job_id,
        type,
        label: labelForSapJob(event.job_id, event.step ?? null),
        progress,
        startedAt: Date.now(),
        startedByCurrentUser: Boolean(
          currentUserId && event.user_id && event.user_id === currentUserId
        ),
        // SAP agent jobs aren't user-cancellable from the OmniBelt
        // surface in v1 — the agent-jobs admin page handles cancels.
        cancelable: false,
      }

      if (life === 'success') {
        return { kind: 'remove', id: event.job_id, afterMs: TERMINAL_HOLD_MS }
      }
      return { kind: 'upsert', job }
    }
    case 'ImportRunStatusChanged': {
      if (!event.run_id) return null
      const life = lifecycleOf(event.status)

      if (life === 'failure') {
        return { kind: 'remove', id: event.run_id }
      }

      const progress = progressFromLifecycle(life)
      const tail = event.run_id.slice(-6)
      const baseLabel = `Import run ${tail}`
      const label =
        event.rows_imported && event.rows_imported > 0
          ? `${baseLabel} — ${event.rows_imported.toLocaleString()} rows`
          : baseLabel

      const job: ActiveJob = {
        id: event.run_id,
        type: 'sap_import',
        label,
        progress,
        startedAt: Date.now(),
        // Runs are org-scoped (no user attribution on the wire), so
        // we err on the safe side — never auto-expand the tray for
        // them. The halo still lights up.
        startedByCurrentUser: false,
        cancelable: false,
      }

      if (life === 'success') {
        return { kind: 'remove', id: event.run_id, afterMs: TERMINAL_HOLD_MS }
      }
      return { kind: 'upsert', job }
    }
    case 'TriggerFired': {
      // A trigger fire creates a `sap_agent_jobs` row. The job's
      // own status updates arrive via `SapJobStatusChanged` with the
      // same `job_id`, so we use this variant only for the *initial*
      // queued-state insertion. If the job is already in the store
      // (a SapJobStatusChanged event raced in first), the upsert is
      // a no-op for progress.
      if (!event.job_id) return null
      const job: ActiveJob = {
        id: event.job_id,
        type: 'agent_job',
        label: event.target_endpoint
          ? `Agent job → ${event.target_endpoint}`
          : `Agent job ${event.job_id.slice(-6)}`,
        progress: 0.05,
        startedAt: Date.now(),
        startedByCurrentUser: Boolean(
          currentUserId && event.user_id && event.user_id === currentUserId
        ),
        cancelable: false,
      }
      return { kind: 'upsert', job }
    }
    default:
      return null
  }
}

// ---- Hook -----------------------------------------------------------------

export type UseOmnibeltJobsResult = {
  /** Live snapshot of the Zustand `activeJobs` slice. Re-renders only
   *  when the slice changes (1% diff filter applied upstream). */
  activeJobs: ActiveJob[]
  /** Best-effort cancel. Returns a rejected Promise in v1 — the
   *  Mach 3 cancel UX needs a backend cancel endpoint that doesn't
   *  exist for SAP agent jobs / import runs yet. Documented as
   *  v1.5 work in the implementation log. */
  cancelJob: (id: string) => Promise<void>
}

/**
 * Mount this hook from `OmniBeltHost` (P5+). It owns the
 * subscription lifecycle; consumers read `activeJobs` directly via
 * `useOmnibeltStore(s => s.activeJobs)`.
 */
export function useOmnibeltJobs(): UseOmnibeltJobsResult {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? null
  const userId = authState.user?.id ?? null
  const activeJobs = useOmnibeltStore((s) => s.activeJobs)

  useEffect(() => {
    if (!organizationId) return

    // Pending terminal-state evictions, keyed by job id. Allows us
    // to cancel the eviction if a "started → succeeded → started"
    // burst arrives within the hold window.
    const pendingEvictions = new Map<string, ReturnType<typeof setTimeout>>()

    const handler = (event: WsEvent) => {
      const normalized = normalizeEvent(event, userId)
      if (!normalized) return

      // Read latest store snapshot directly — `activeJobs` from the
      // outer closure goes stale between renders, and the WS event
      // stream can fire faster than React commits.
      const store = getOmnibeltStore()
      if (!store) return
      const current = store.getState().activeJobs

      if (normalized.kind === 'remove') {
        const existingIdx = current.findIndex((j) => j.id === normalized.id)
        if (existingIdx === -1) return

        if (normalized.afterMs && normalized.afterMs > 0) {
          // Bump the existing entry to 1.0 so the halo paints the
          // completion frame, then schedule the actual eviction.
          const next = current.slice()
          next[existingIdx] = { ...next[existingIdx]!, progress: 1 }
          store.getState().setActiveJobs(next)

          if (pendingEvictions.has(normalized.id)) {
            clearTimeout(pendingEvictions.get(normalized.id)!)
          }
          const timer = setTimeout(() => {
            pendingEvictions.delete(normalized.id)
            const after = getOmnibeltStore()?.getState().activeJobs ?? []
            const filtered = after.filter((j) => j.id !== normalized.id)
            if (filtered.length !== after.length) {
              getOmnibeltStore()?.getState().setActiveJobs(filtered)
            }
          }, normalized.afterMs)
          pendingEvictions.set(normalized.id, timer)
          return
        }

        store
          .getState()
          .setActiveJobs(current.filter((j) => j.id !== normalized.id))
        if (pendingEvictions.has(normalized.id)) {
          clearTimeout(pendingEvictions.get(normalized.id)!)
          pendingEvictions.delete(normalized.id)
        }
        return
      }

      // Upsert path — apply 1% diff threshold for pure progress
      // updates. Add / type-change / label-change always commit.
      const incoming = normalized.job
      const existingIdx = current.findIndex((j) => j.id === incoming.id)
      if (existingIdx === -1) {
        // New job — clear any stale eviction timer just in case.
        if (pendingEvictions.has(incoming.id)) {
          clearTimeout(pendingEvictions.get(incoming.id)!)
          pendingEvictions.delete(incoming.id)
        }
        store.getState().setActiveJobs([...current, incoming])
        return
      }

      const existing = current[existingIdx]!
      const progressDelta = Math.abs(incoming.progress - existing.progress)
      const otherFieldsChanged =
        existing.type !== incoming.type ||
        existing.label !== incoming.label ||
        existing.cancelable !== incoming.cancelable ||
        existing.startedByCurrentUser !== incoming.startedByCurrentUser
      if (progressDelta < PROGRESS_DIFF_THRESHOLD && !otherFieldsChanged) {
        return
      }
      const next = current.slice()
      // Preserve `startedAt` from the original event so duration
      // stays meaningful across the upsert.
      next[existingIdx] = { ...incoming, startedAt: existing.startedAt }
      store.getState().setActiveJobs(next)
    }

    workServiceWs.connect(organizationId, handler)

    return () => {
      workServiceWs.removeHandler(handler)
      // Clear any in-flight eviction timers so an unmount-during-
      // hold doesn't leak.
      for (const timer of pendingEvictions.values()) {
        clearTimeout(timer)
      }
      pendingEvictions.clear()
    }
  }, [organizationId, userId])

  const cancelJob = async (_id: string): Promise<void> => {
    logger.warn(
      '[useOmnibeltJobs] cancelJob is a no-op in v1 — no backend cancel endpoint wired'
    )
    return Promise.reject(
      new Error(
        'Cancel not yet supported — see Implement-OmniBelt-MVP P5 §deviations'
      )
    )
  }

  return { activeJobs, cancelJob }
}

/** Test-only hook — exports the pure normalizer so the diff
 *  threshold / lifecycle mapping can be unit-tested without
 *  rendering the hook. */
export const __test__ = {
  normalizeEvent,
  lifecycleOf,
  progressFromLifecycle,
  inferSapJobType,
}

export { setActiveJobsForTests }

/** Test-only mutator that bypasses the hook so component tests can
 *  drive the store directly. */
function setActiveJobsForTests(jobs: ActiveJob[]) {
  const store = getOmnibeltStore()
  if (!store) return
  store.getState().setActiveJobs(jobs)
}

// Created and developed by Jai Singh
