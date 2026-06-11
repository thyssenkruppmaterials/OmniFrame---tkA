// Created and developed by Jai Singh
/**
 * SAP-agents REST client — Phase 3 of the rust-work-service full-
 * integration plan (2026-05-06).
 *
 * Wraps `rust-work-service`'s `/api/v1/sap-agents/*` endpoints which
 * own the bootstrap-snapshot path for the SAP-agent fleet and the
 * recent-job ledger. The matching server-pushed incremental updates
 * already arrive via `WsEvent::SapAgentChanged` /
 * `WsEvent::SapJobStatusChanged`, so the FE flow is:
 *
 *   1. Mount → call `getFleet(...)` / `getRecentJobs(...)` once for
 *      the bootstrap snapshot.
 *   2. Subscribe to the matching `WsEvent` on `workServiceWs` for
 *      live updates.
 *
 * Mirrors the auth-header shape used by the sibling
 * `notifications.client.ts` / `dispatch.client.ts` clients — JWT in
 * `Authorization: Bearer ...`, optional `X-Organization-ID` for
 * defence-in-depth on routes that derive org from the JWT claim.
 */
import { supabase } from '@/lib/supabase/client'

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

let _organizationId: string | null = null

/** Set the org context broadcast in the optional `X-Organization-ID`
 *  header on every request. Wired from the auth-state listener at
 *  app boot, same as the other work-service clients. */
export function setSapAgentsOrganization(orgId: string | null) {
  _organizationId = orgId
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error('No active session')
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
  }
  if (_organizationId) {
    headers['X-Organization-ID'] = _organizationId
  }
  return headers
}

/**
 * One row of the `/fleet` snapshot. Mirrors the Rust `FleetAgent`
 * struct in `rust-work-service/src/api/routes/sap_agents.rs`.
 *
 * `user_id` / `user_email` are placeholders: today the `sap_agents`
 * table has no `user_id` column so the route always serialises them
 * as `null`. They're in the wire shape so a future schema migration
 * doesn't require a coordinated FE/BE release. See the route
 * doc-comment for the schema-notes block.
 *
 * `capabilities` is `null` on the default snapshot
 * (`includeCapabilities=false`); request `includeCapabilities=true`
 * to receive the decoded JSONB array. `capability_count` is always
 * populated.
 */
export interface FleetAgent {
  id: string
  hostname: string | null
  citrix_session: string | null
  user_id: string | null
  user_email: string | null
  sap_system: string | null
  sap_client: string | null
  sap_user: string | null
  version: string | null
  status: string
  last_seen_at: string
  process_started_at: string | null
  capability_count: number
  capabilities: string[] | null
}

/**
 * One row of the `/jobs/recent` snapshot. Mirrors the Rust
 * `RecentJob` struct.
 *
 * `payload_summary` is a server-computed projection — adding new keys
 * is a one-line schema-free change on the Rust side (the `Value` is
 * an object; today only `to_number` and `warehouse` are extracted).
 * The FE should consult the keys it cares about defensively.
 *
 * `assigned_agent_id` reflects the optional pin set at submit time
 * (NULL when the job wasn't pinned). `assigned_agent_hostname`
 * resolves through `COALESCE(assigned_agent_id, claimed_by)` so
 * unpinned-but-claimed jobs still surface a hostname label.
 */
export interface RecentJob {
  id: string
  endpoint: string
  status: string
  payload_summary: {
    to_number: string | null
    warehouse: string | null
    [key: string]: string | null
  }
  error: string | null
  assigned_agent_id: string | null
  assigned_agent_hostname: string | null
  created_at: string
  claimed_at: string | null
  completed_at: string | null
}

export interface GetFleetOptions {
  /** `online` (default), `offline`, or `all`. */
  status?: 'online' | 'offline' | 'all'
  /** When `true`, the `capabilities` array is decoded server-side and
   *  returned for each row. Default `false` — the count is enough for
   *  most surfaces and the JSONB blob can run hundreds of bytes per
   *  agent at fleet scale. */
  includeCapabilities?: boolean
}

export async function getFleet(
  opts: GetFleetOptions = {}
): Promise<FleetAgent[]> {
  const headers = await getAuthHeaders()
  const url = new URL(`${WORK_SERVICE_URL}/api/v1/sap-agents/fleet`)
  if (opts.status) {
    url.searchParams.set('status', opts.status)
  }
  if (opts.includeCapabilities) {
    url.searchParams.set('include_capabilities', 'true')
  }
  const res = await fetch(url.toString(), { headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'getFleet failed')
  }
  return res.json()
}

export interface GetRecentJobsOptions {
  /** Defaults to 50 server-side; clamped to `1..=200`. */
  limit?: number
  /** Optional list of allowed status values, e.g.
   *  `['running', 'completed']`. When omitted (or empty), all rows are
   *  returned. The client encodes this as a comma-separated query
   *  string the Rust route splits and validates. */
  status?: string[]
}

export async function getRecentJobs(
  opts: GetRecentJobsOptions = {}
): Promise<RecentJob[]> {
  const headers = await getAuthHeaders()
  const url = new URL(`${WORK_SERVICE_URL}/api/v1/sap-agents/jobs/recent`)
  if (opts.limit !== undefined) {
    url.searchParams.set('limit', String(opts.limit))
  }
  if (opts.status && opts.status.length > 0) {
    url.searchParams.set('status', opts.status.join(','))
  }
  const res = await fetch(url.toString(), { headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'getRecentJobs failed')
  }
  return res.json()
}

/**
 * Request body for `POST /api/v1/sap-agents/backfill-pending-confirms`
 * — the on-demand executor for the migration-289 SQL function. Empty
 * body is valid (server falls back to the same defaults the pg_cron job
 * uses). Provide overrides only when an admin wants to widen the window
 * to drain a backlog.
 */
export interface BackfillPendingConfirmsRequest {
  /** Candidate-row lookback window in hours. Server clamps to 1..168
   *  (7 days). Default 24. */
  lookback_hours?: number
  /** Minimum age (seconds) a `failed` job must be before requeue.
   *  Default 60. Set to 0 to drain immediately after a fail. */
  failed_min_age_seconds?: number
  /** Per-job claim-count cap — rows that have churned this many
   *  times are left alone for human triage. Default 8. */
  max_claim_count?: number
}

/** Server-shape of the backfill response. Mirrors the Rust struct. */
export interface BackfillPendingConfirmsResponse {
  rows_failed_requeued: number
  rows_orphan_replayed: number
  oldest_pending_minutes: number
  lookback_hours: number
  organization_id: string
}

/**
 * Force-run the putaway-confirm backfill for the caller's org. Same
 * SQL the pg_cron job runs every 5 minutes — useful when an admin
 * wants to drain a backlog instead of waiting for the next tick.
 *
 * Server-side: gated on the same "authenticated principal with an
 * `organization_id` claim" rule as `/sap-console/*` — not a
 * fine-grained permission today (Phase 10's service-key path will
 * tighten this when it lands). FE callers should still gate the UI
 * affordance on `profile.role in ('admin','superadmin')` so non-
 * admin users don't see a button they can't meaningfully invoke.
 */
export async function backfillPendingConfirms(
  body: BackfillPendingConfirmsRequest = {}
): Promise<BackfillPendingConfirmsResponse> {
  const headers = await getAuthHeaders()
  headers['Content-Type'] = 'application/json'
  const res = await fetch(
    `${WORK_SERVICE_URL}/api/v1/sap-agents/backfill-pending-confirms`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'backfillPendingConfirms failed')
  }
  return res.json()
}

// Created and developed by Jai Singh
