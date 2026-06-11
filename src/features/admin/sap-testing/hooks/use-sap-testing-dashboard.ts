// Created and developed by Jai Singh
/**
 * Phase 8 (2026-05-06) — `useSapTestingDashboard`
 *
 * Single React Query hook that fetches the consolidated
 * `/api/v1/sap-testing/dashboard` snapshot the SAP Testing tabs used
 * to fan out across:
 *
 *   - `useAgentDetection().fleet`              (online agents + capabilities)
 *   - `useJobQueue.watchedJobs` (subset)       (in-flight jobs)
 *   - direct `sap_audit_log` selects           (recent audits)
 *   - direct `sap_agent_schedules` selects     (scheduled jobs)
 *   - derived `agent_id → capabilities` map    (fleet routing)
 *
 * The five sections are computed server-side by the Rust route via
 * `tokio::try_join!` over four parallel SQL queries (capabilities is
 * derived from the fleet result — no extra round-trip). The FE
 * consumes them as one cache entry under
 * `['sap-testing', 'dashboard']`.
 *
 * Cache strategy:
 *   - `staleTime: 30s` — WebSocket pushes invalidate the query on
 *                         every relevant `WsEvent`, so the cache is
 *                         normally MUCH fresher than 30s.
 *   - `refetchInterval: 5min` — safety-net poll for the case where
 *                                the WS is disconnected. Mirrors the
 *                                pattern in `useJobQueue` (5-min poll
 *                                gated on `connectionState !==
 *                                'connected'`).
 *   - `refetchOnWindowFocus: true` — when the user tabs back, give
 *                                     them a fresh snapshot before
 *                                     they read it.
 *
 * WS invalidation:
 *   The hook subscribes to FOUR `WsEvent` variants on the singleton
 *   `workServiceWs`:
 *     - `SapAgentChanged`        — refresh `online_agents` +
 *                                   `fleet_capabilities`.
 *     - `SapJobStatusChanged`    — refresh `in_flight_jobs` (the
 *                                   running/queued sliding window).
 *     - `RfPutawayChanged`       — refresh `in_flight_jobs` +
 *                                   `recent_audits` (a putaway-driven
 *                                   trigger fires a sap_agent_jobs
 *                                   row + can write a pre-flight
 *                                   audit row via Phase 5).
 *     - `Notification`           — refresh `recent_audits` (Phase 5
 *                                   server-side audit row writes
 *                                   surface here when the listener
 *                                   patches their terminal status).
 *
 *   Each invalidation fires a `queryClient.invalidateQueries` on
 *   `['sap-testing', 'dashboard']` — TanStack Query then refetches.
 *
 * Phase 11 cleanup target: the per-section fallback hooks listed
 * above are deleted once this hook has soaked. Single grep target:
 * `// TODO(rust-work-service Phase 11)` in the consumers.
 */
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getCurrentOrgId } from '@/lib/auth/unified-auth-provider'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import {
  getSapTestingDashboard,
  type SapTestingDashboard,
} from '@/lib/work-service/sap-testing-client'
import { workServiceWs } from '@/lib/work-service/websocket'

/** Cache key for the consolidated dashboard query. Exported so that
 *  imperative callers (e.g. a Phase 9 trigger evaluator that just
 *  enqueued a job) can invalidate / prefetch the same key. */
export const SAP_TESTING_DASHBOARD_KEY = ['sap-testing', 'dashboard'] as const

/** WS variants that should invalidate the dashboard cache. Centralised
 *  so a future variant addition (Phase 6's `SapAgentConsoleLine` once
 *  it lands) is a one-line append. */
const INVALIDATING_WS_TYPES: ReadonlyArray<WsEvent['type']> = [
  'SapAgentChanged',
  'SapJobStatusChanged',
  'RfPutawayChanged',
  // 'SapAgentConsoleLine',  // Phase 6 — uncomment once the variant
  //                            ships in `WsEventType` (currently in
  //                            progress on a parallel branch).
  'Notification',
]

export interface UseSapTestingDashboardOptions {
  /** Number of audit rows to fetch. Defaults to 50. Set to `0` to
   *  skip the audit query entirely (e.g. when the audit panel is
   *  collapsed and the consumer doesn't need the rows). */
  includeAudit?: number
  /** When `false`, skip the schedules query. Default `true`. */
  includeSchedules?: boolean
  /** Disables the query entirely — useful for tests / Storybook /
   *  surfaces that don't render the dashboard. */
  enabled?: boolean
}

export function useSapTestingDashboard(opts?: UseSapTestingDashboardOptions) {
  const includeAudit = opts?.includeAudit ?? 50
  const includeSchedules = opts?.includeSchedules ?? true
  const enabled = opts?.enabled ?? true

  const queryClient = useQueryClient()

  const query = useQuery<SapTestingDashboard, Error>({
    queryKey: [...SAP_TESTING_DASHBOARD_KEY, includeAudit, includeSchedules],
    queryFn: () => getSapTestingDashboard({ includeAudit, includeSchedules }),
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    enabled,
  })

  // ─── WS-driven invalidation ───────────────────────────────────
  // Subscribe ONCE per consumer instance to the singleton's event
  // stream and invalidate the dashboard cache whenever an event of
  // one of `INVALIDATING_WS_TYPES` fires for the user's org.
  //
  // Belt-and-braces org filter: the Rust send loop already scopes
  // events by org, but a defence-in-depth check here means a future
  // protocol bug or a misconfigured dev server cannot leak cross-org
  // invalidations into our cache.
  useEffect(() => {
    if (!enabled) return
    const orgId = getCurrentOrgId()
    if (!orgId) return

    const handler: WsEventHandler = (event: WsEvent) => {
      if (!INVALIDATING_WS_TYPES.includes(event.type as WsEvent['type'])) {
        return
      }
      if (event.organization_id && event.organization_id !== orgId) return
      // Invalidate ALL variants of the dashboard key (different
      // include_audit / include_schedules combinations share the same
      // root key prefix and are all stale on any of these events).
      queryClient.invalidateQueries({ queryKey: SAP_TESTING_DASHBOARD_KEY })
    }

    try {
      workServiceWs.connect(orgId, handler)
    } catch {
      // WS setup failure is non-fatal — the 5-min safety-net poll
      // keeps the cache fresh, just less snappy on push events.
    }

    return () => {
      try {
        workServiceWs.removeHandler(handler)
      } catch {
        /* ignore */
      }
    }
  }, [enabled, queryClient])

  return query
}

// Created and developed by Jai Singh
