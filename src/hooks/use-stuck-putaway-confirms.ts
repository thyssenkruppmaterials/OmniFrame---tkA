// Created and developed by Jai Singh
/**
 * Putaway-confirm "stuck" detector + force-backfill mutation.
 *
 * Pairs with migration 289 (`backfill_pending_putaway_confirms`) and
 * the rust-work-service v0.1.35 route
 * `POST /api/v1/sap-agents/backfill-pending-confirms`.
 *
 * What it does:
 *   - Reads the already-loaded putaway-operations slice (no extra DB
 *     fetch — the parent component already has this data via
 *     `usePutawayOperations`) and derives a "stuck" view: rows where
 *     `to_status='Completed' AND confirmed_source IS NULL AND
 *      is_mca_workflow IS NOT TRUE AND created_at > now() - 24h`.
 *   - Returns `count`, `oldestAgeMinutes`, and a `severity` flag the
 *     UI can use to colour the indicator (warn at >5 stuck OR oldest
 *     >30min, error at >15 stuck OR oldest >60min — same thresholds
 *     `Implement-Putaway-Confirm-Backfill-Loop.md` documents).
 *   - Exposes a `forceBackfill()` mutation that POSTs to the rust-
 *     work-service route. The mutation invalidates the parent's
 *     putaway query so the next poll/refetch shows the drained state.
 *
 * Why a separate hook (vs. inlining in the search component):
 *   - The search component is already 3,100+ lines; threading the
 *     stuck-pending derivation + the mutation through there would
 *     add another 80 lines for cross-cutting concerns.
 *   - The same indicator can be reused on the inbound dashboard or
 *     anywhere else the team wants a "TOs piling up" surface.
 *
 * Why the 24h window:
 *   - Rows older than 24h are intentionally out of scope for the
 *     auto-recovery loop (see migration 289 rationale). The org has
 *     ~1,200 pre-Phase 9 historical pending rows that shouldn't
 *     light up the indicator.
 */
import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import {
  backfillPendingConfirms,
  type BackfillPendingConfirmsRequest,
  type BackfillPendingConfirmsResponse,
} from '@/lib/work-service/sap-agents-client'

/** Same shape `usePutawayOperations` returns — duck-typed so the
 *  hook isn't coupled to the (huge) `PutawayOperationsWithUser`
 *  Supabase type, which would otherwise drag a transitive dependency
 *  on `database.types.ts` into every consumer. */
export interface StuckPutawayCandidateRow {
  to_status: string | null
  confirmed_source: string | null
  is_mca_workflow: boolean | null
  created_at: string | null
}

export type StuckPutawaySeverity = 'ok' | 'warn' | 'error'

/**
 * Thresholds for the indicator. Warn = a single SAP hiccup that
 * spans 1-2 cron ticks (5-10 min); Error = something is off and a
 * human should look. Tunable here without touching the SQL.
 */
export const STUCK_THRESHOLDS = {
  WARN_COUNT: 5,
  WARN_OLDEST_MIN: 30,
  ERROR_COUNT: 15,
  ERROR_OLDEST_MIN: 60,
} as const

export interface UseStuckPutawayConfirmsArgs {
  /** Already-loaded putaway operations (from `usePutawayOperations`).
   *  Pass `undefined` while the parent is still loading — the hook
   *  returns `count: 0, severity: 'ok'` until data arrives. */
  data: ReadonlyArray<StuckPutawayCandidateRow> | undefined
  /** When `true`, the FE renders the affordance and accepts clicks.
   *  Caller is expected to gate this on the user's role (admin /
   *  superadmin). The server has its own gate — this is purely a
   *  UI affordance switch. */
  isAdmin: boolean
  /** Lookback window in hours. Default 24 — matches the SQL function
   *  and the "ancient pending rows are out of scope" doc. */
  lookbackHours?: number
  /** TanStack Query keys to invalidate after a successful force-
   *  backfill so the UI re-reads the drained state. Defaults to
   *  the canonical `usePutawayOperations` keys. */
  invalidateKeys?: ReadonlyArray<ReadonlyArray<string>>
}

export interface UseStuckPutawayConfirmsReturn {
  /** Number of stuck pending confirms in the lookback window. */
  count: number
  /** Age (minutes) of the oldest stuck row. 0 when `count === 0`. */
  oldestAgeMinutes: number
  /** Display severity — drives badge colour + alert visibility. */
  severity: StuckPutawaySeverity
  /** Convenience for the badge: `severity !== 'ok'`. */
  isStuck: boolean
  /** Mutation for the admin "Force backfill now" button. */
  forceBackfill: (
    overrides?: BackfillPendingConfirmsRequest
  ) => Promise<BackfillPendingConfirmsResponse>
  /** TanStack mutation flag — drives the button spinner. */
  isForcing: boolean
  /** Whether the affordance should be shown at all. */
  canForce: boolean
}

const DEFAULT_INVALIDATE_KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ['putaway-operations'],
  ['putaway-statistics'],
]

export function useStuckPutawayConfirms({
  data,
  isAdmin,
  lookbackHours = 24,
  invalidateKeys = DEFAULT_INVALIDATE_KEYS,
}: UseStuckPutawayConfirmsArgs): UseStuckPutawayConfirmsReturn {
  const queryClient = useQueryClient()

  const { count, oldestAgeMinutes } = useMemo(() => {
    if (!data || data.length === 0) {
      return { count: 0, oldestAgeMinutes: 0 }
    }
    const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000
    let stuckCount = 0
    let oldestCreatedAt = Number.POSITIVE_INFINITY
    for (const row of data) {
      if (row.to_status !== 'Completed') continue
      if (row.confirmed_source != null) continue
      if (row.is_mca_workflow === true) continue
      if (!row.created_at) continue
      const createdMs = Date.parse(row.created_at)
      if (Number.isNaN(createdMs)) continue
      if (createdMs < cutoffMs) continue
      stuckCount += 1
      if (createdMs < oldestCreatedAt) {
        oldestCreatedAt = createdMs
      }
    }
    const oldestAgeMin =
      stuckCount === 0 || !Number.isFinite(oldestCreatedAt)
        ? 0
        : Math.floor((Date.now() - oldestCreatedAt) / 60_000)
    return { count: stuckCount, oldestAgeMinutes: oldestAgeMin }
  }, [data, lookbackHours])

  const severity: StuckPutawaySeverity = useMemo(() => {
    if (count === 0) return 'ok'
    if (
      count >= STUCK_THRESHOLDS.ERROR_COUNT ||
      oldestAgeMinutes >= STUCK_THRESHOLDS.ERROR_OLDEST_MIN
    ) {
      return 'error'
    }
    if (
      count >= STUCK_THRESHOLDS.WARN_COUNT ||
      oldestAgeMinutes >= STUCK_THRESHOLDS.WARN_OLDEST_MIN
    ) {
      return 'warn'
    }
    return 'ok'
  }, [count, oldestAgeMinutes])

  const mutation = useMutation({
    mutationFn: (overrides?: BackfillPendingConfirmsRequest) =>
      backfillPendingConfirms(overrides ?? {}),
    onSuccess: (resp) => {
      logger.log('[stuck-putaway-confirms] force backfill succeeded', resp)
      const requeued = resp.rows_failed_requeued
      const replayed = resp.rows_orphan_replayed
      if (requeued === 0 && replayed === 0) {
        toast.info(
          'Backfill ran — no stuck rows matched (lookback ' +
            `${resp.lookback_hours}h). Either the agent already drained ` +
            'them or the failed jobs are inside the per-row cooldown.'
        )
      } else {
        toast.success(
          `Backfill ran — ${requeued} failed jobs requeued, ${replayed} ` +
            `NOTIFY replays. Oldest pending: ${resp.oldest_pending_minutes}m.`
        )
      }
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: [...key] })
      }
    },
    onError: (err) => {
      logger.error('[stuck-putaway-confirms] force backfill failed', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Force backfill failed: ${message}`)
    },
  })

  return {
    count,
    oldestAgeMinutes,
    severity,
    isStuck: severity !== 'ok',
    forceBackfill: (overrides) => mutation.mutateAsync(overrides),
    isForcing: mutation.isPending,
    canForce: isAdmin,
  }
}

// Created and developed by Jai Singh
