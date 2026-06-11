// Created and developed by Jai Singh
/**
 * SAP-mutations REST client — Phase 5 of the rust-work-service full-
 * integration plan (2026-05-06).
 *
 * Wraps `rust-work-service`'s `/api/v1/sap-mutations/*` endpoints which
 * own the server-side defence-in-depth pipeline for the highest-risk
 * SAP Testing surface: Material Master mutations.
 *
 * Five layered checks happen on the server before the
 * `sap_agent_jobs` row is enqueued:
 *
 *   1. Role gate (admin / superadmin / sap_mutator).
 *   2. Per-material concurrency lock — 5min TTL — 409 on collision.
 *   3. Per-org rate limit — 10 mutations/min/org — 429 with
 *      `Retry-After` on overflow.
 *   4. Pre-flight `sap_audit_log` row at `status='pending'`.
 *   5. `sap_agent_jobs` INSERT with the audit row's id linked back.
 *
 * The matching incremental updates already arrive via
 * `WsEvent::SapJobStatusChanged` (shipped in Phase 4), so the FE
 * flow is:
 *
 *   1. Mount → call `postMaterialMasterMutation(...)` to enqueue.
 *   2. Subscribe to `WsEvent::SapJobStatusChanged` on
 *      `workServiceWs` (already wired through `useJobQueue`) for
 *      live status pushes.
 *
 * Mirrors the auth-header shape used by the sibling
 * `sap-agents-client.ts` — JWT in `Authorization: Bearer ...`,
 * optional `X-Organization-ID` for defence-in-depth, plus the
 * Phase 5 specific `Idempotency-Key` so a network retry never
 * enqueues the same mutation twice.
 */
import { supabase } from '@/lib/supabase/client'

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

let _organizationId: string | null = null

/** Set the org context broadcast in the optional `X-Organization-ID`
 *  header on every request. Wired from the auth-state listener at
 *  app boot, same as the other work-service clients. */
export function setSapMutationsOrganization(orgId: string | null) {
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
    'Content-Type': 'application/json',
  }
  if (_organizationId) {
    headers['X-Organization-ID'] = _organizationId
  }
  return headers
}

/** Material Master mutation request body. Mirrors the Rust
 *  `MaterialMasterMutation` struct in
 *  `rust-work-service/src/api/routes/sap_mutations.rs`.
 *
 *  `fields` accepts `string | null` — `null` is meaningful in MM02
 *  (clear the field, e.g. blank a storage bin). */
export interface MaterialMasterMutation {
  /** SAP material number (required). Used as the lock key. */
  material: string
  /** SAP plant code (required). */
  plant: string
  /** Optional warehouse number (storage-bin handler). */
  warehouse?: string
  /** Optional storage type filter (storage-bin handler). */
  storage_type?: string
  /** Field map of MM02 columns to mutate; `null` clears the field. */
  fields: Record<string, string | null>
  /** Optional pin to a specific SAP agent (`sap_agents.id`). When
   *  omitted, any online agent in the org may claim. */
  assigned_agent_id?: string | null
  /** Optional pre-mutation snapshot — forwarded to the audit row's
   *  `prev_state` column so the reversal engine can later compute
   *  the inverse mutation without re-reading from SAP. */
  prev_state?: Record<string, unknown> | null
  /** Optional override of which agent endpoint to enqueue. The
   *  server whitelists the value — defaults to
   *  `/sap/material-master-bin`. */
  endpoint?: string
  /** Optional override of the audit row's `transaction_code`. */
  transaction_code?: string
  /** Optional override of the audit row's `action` label. */
  action?: string
}

/** Mutation response. Mirrors the Rust `MutationResult` struct. */
export interface MutationResult {
  ok: boolean
  /** UUID of the newly-INSERTed `sap_agent_jobs` row. Pass to
   *  `useJobQueue.watch(...)` to observe lifecycle WS pushes. */
  job_id: string
  /** UUID of the paired `sap_audit_log` pre-flight row. */
  audit_log_id: string
}

/** Standard server error shape returned by the Rust route. */
interface SapMutationErrorBody {
  error: string
  details?: string
  code?: string
}

/** Custom error thrown when the server returned a non-2xx response.
 *  Carries the HTTP status, the parsed error body, and (for 429s)
 *  the Retry-After value so the caller can show "try again in N
 *  seconds" UX. */
export class SapMutationError extends Error {
  status: number
  code?: string
  retryAfterSecs?: number
  details?: string
  constructor(opts: {
    message: string
    status: number
    code?: string
    retryAfterSecs?: number
    details?: string
  }) {
    super(opts.message)
    this.name = 'SapMutationError'
    this.status = opts.status
    this.code = opts.code
    this.retryAfterSecs = opts.retryAfterSecs
    this.details = opts.details
  }
}

/**
 * Submit a Material Master mutation through the rust-work-service
 * defence-in-depth pipeline.
 *
 * The `idempotencyKey` is forwarded to `sap_agent_jobs.idempotency_key`
 * via the `Idempotency-Key` header and used by the agent dedup
 * layer — generate a fresh `crypto.randomUUID()` per logical
 * mutation attempt; reuse it ONLY when retrying the SAME mutation
 * after a network blip.
 *
 * Throws `SapMutationError` on any non-2xx response so callers can
 * branch on `.status` (409 = locked, 429 = rate-limited, 403 =
 * role-gate, 400 = validation, etc.).
 */
export async function postMaterialMasterMutation(
  body: MaterialMasterMutation,
  idempotencyKey: string
): Promise<MutationResult> {
  const headers = await getAuthHeaders()
  headers['Idempotency-Key'] = idempotencyKey
  const url = `${WORK_SERVICE_URL}/api/v1/sap-mutations/material-master`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let parsed: SapMutationErrorBody | null = null
    try {
      parsed = (await res.json()) as SapMutationErrorBody
    } catch {
      /* ignore — fall through to status-based message */
    }
    const message =
      parsed?.error ?? `postMaterialMasterMutation failed (HTTP ${res.status})`
    const retryAfterRaw = res.headers.get('Retry-After')
    const retryAfterSecs = retryAfterRaw
      ? Number.parseInt(retryAfterRaw, 10)
      : undefined
    throw new SapMutationError({
      message,
      status: res.status,
      code: parsed?.code,
      retryAfterSecs: Number.isFinite(retryAfterSecs)
        ? retryAfterSecs
        : undefined,
      details: parsed?.details,
    })
  }
  return res.json() as Promise<MutationResult>
}

// Created and developed by Jai Singh
