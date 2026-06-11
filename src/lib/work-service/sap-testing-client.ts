// Created and developed by Jai Singh
/**
 * SAP Testing dashboard REST client — Phase 8 of the rust-work-service
 * full-integration plan (2026-05-06).
 *
 * Wraps `rust-work-service`'s `/api/v1/sap-testing/dashboard` endpoint
 * which returns one document with all five sections the SAP Testing
 * surface used to fan out across 4–5 separate React Query hooks:
 *
 *   - `online_agents`       — fleet snapshot (FleetAgent shape from
 *                             Phase 3's `sap-agents-client.ts`).
 *   - `in_flight_jobs`      — `sap_agent_jobs` rows with status ∈
 *                             {running, claimed, queued} (RecentJob
 *                             shape from Phase 3).
 *   - `recent_audits`       — last N `sap_audit_log` rows (default
 *                             50, max 500).
 *   - `scheduled_jobs`      — enabled `sap_agent_schedules` rows.
 *   - `fleet_capabilities`  — `agent_id → capabilities[]` derived
 *                             from `online_agents`.
 *
 * Mirrors the auth-header shape used by the sibling
 * `sap-agents-client.ts` / `sap-mutations-client.ts` — JWT in
 * `Authorization: Bearer ...`, optional `X-Organization-ID`. The Rust
 * route resolves `organization_id` from the JWT claim, never from the
 * header / query string — `X-Organization-ID` is defence-in-depth
 * only.
 *
 * Old per-section hooks (`useAgentDetection`, `useJobQueue`, ad-hoc
 * `sap_audit_log` queries, `sap_agent_schedules` queries) STAY in
 * place during the Phase 8 → Phase 11 soak window. Phase 11 deletes
 * them after the new dashboard hook has soaked in production. The
 * complete fallback list lives in
 * `Implementations/Implement-Rust-Work-Service-Phase8.md`.
 */
import { supabase } from '@/lib/supabase/client'
import type { FleetAgent, RecentJob } from './sap-agents-client'

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

let _organizationId: string | null = null

export function setSapTestingOrganization(orgId: string | null) {
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
 * One row of the `recent_audits` section. Mirrors the Rust
 * `AuditLogRow` struct.
 *
 * `payload`, `result`, `prev_state` are loose JSON so the FE can
 * render whatever fields it wants without a coordinated FE/BE deploy
 * when the audit blob shape evolves.
 */
export interface AuditLogRow {
  id: string
  organization_id: string
  user_id: string | null
  transaction_code: string
  action: string
  status: string
  step: string | null
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  prev_state: Record<string, unknown> | null
  sap_message: string | null
  sap_message_type: string | null
  agent_version: string | null
  duration_ms: number | null
  job_id: string | null
  reverses_audit_id: string | null
  reversal_status: string | null
  created_at: string
}

/**
 * One row of the `scheduled_jobs` section. Mirrors the Rust
 * `ScheduledJob` struct.
 *
 * `payload` is a loose JSON object that gets templated into the
 * `sap_agent_jobs.payload` blob when the scheduler tick fires.
 */
export interface ScheduledJob {
  id: string
  organization_id: string
  name: string
  description: string | null
  enabled: boolean
  cron_expression: string
  endpoint: string
  payload: Record<string, unknown>
  assigned_agent_id: string | null
  max_attempts: number
  priority: number
  last_run_at: string | null
  last_job_id: string | null
  last_error: string | null
  next_run_at: string
  created_at: string
  updated_at: string
}

/**
 * Aggregated dashboard payload. Mirrors the Rust `DashboardResponse`
 * struct. The five sections are computed in parallel server-side; the
 * FE consumes them as a single React Query cache entry under
 * `['sap-testing', 'dashboard']`.
 *
 * `fleet_capabilities` is derived from `online_agents` (no extra DB
 * round-trip). The keys are agent ids; the values are capability
 * vectors — empty `[]` when an agent reports no capabilities, never
 * missing-key.
 */
export interface SapTestingDashboard {
  online_agents: FleetAgent[]
  in_flight_jobs: RecentJob[]
  recent_audits: AuditLogRow[]
  scheduled_jobs: ScheduledJob[]
  fleet_capabilities: Record<string, string[]>
  /**
   * Phase 10 — work-service-level capability strings (NOT per-agent).
   * Today carries `'agent-identity-v2'`. The FE can use this to
   * decide whether to surface admin UIs (e.g. "Agent Setup" tab) or
   * status badges. Optional in the type because older deployments
   * may not have shipped the field yet — `service_capabilities ??
   * []` is the safe consumer pattern.
   */
  service_capabilities?: string[]
}

export interface GetSapTestingDashboardOptions {
  /** Number of audit rows to return. Default 50 server-side, clamped
   *  to `0..=500`. Pass `0` to skip the audit query entirely. */
  includeAudit?: number
  /** When `false`, skip the schedules query. Default `true`. */
  includeSchedules?: boolean
}

export async function getSapTestingDashboard(
  opts: GetSapTestingDashboardOptions = {}
): Promise<SapTestingDashboard> {
  const headers = await getAuthHeaders()
  const url = new URL(`${WORK_SERVICE_URL}/api/v1/sap-testing/dashboard`)
  if (opts.includeAudit !== undefined) {
    url.searchParams.set('include_audit', String(opts.includeAudit))
  }
  if (opts.includeSchedules !== undefined) {
    url.searchParams.set('include_schedules', String(opts.includeSchedules))
  }
  const res = await fetch(url.toString(), { headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'getSapTestingDashboard failed')
  }
  return res.json()
}

// Created and developed by Jai Singh
