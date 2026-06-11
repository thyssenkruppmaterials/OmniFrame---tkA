// Created and developed by Jai Singh
/**
 * Phase 9 — `agent_triggers` REST client.
 *
 * Wraps the rust-work-service `/api/v1/triggers/*` routes. Mirrors
 * the auth + org-scope pattern from the sibling
 * `sap-testing-client.ts`: JWT in `Authorization: Bearer`, optional
 * `X-Organization-ID` defence-in-depth header, server resolves the
 * authoritative org from the JWT claim (never from the body / header
 * / query string).
 *
 * The browser used to evaluate triggers via `use-agent-trigger-runtime.ts`
 * (deleted in this phase). It now ONLY does CRUD; evaluation runs
 * server-side in `rust-work-service::triggers::evaluator`.
 *
 * See:
 *   - Implementation note: `Implementations/Implement-Rust-Work-Service-Phase9.md`
 *   - ADR: `Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md`
 *   - Rust route: `rust-work-service/src/api/routes/triggers.rs`
 *   - Rust evaluator: `rust-work-service/src/triggers/evaluator.rs`
 */
import { supabase } from '@/lib/supabase/client'

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

let _organizationId: string | null = null

export function setTriggersOrganization(orgId: string | null) {
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

/**
 * Mirrors `rust-work-service::api::routes::triggers::TriggerRow`.
 *
 * `match_filter`, `payload_template`, and `post_success_patch` are
 * arbitrary JSON. The DSL grammar is documented in
 * `Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md`. The FE form
 * surfaces a free-text JSON editor + a `/preview` button to dry-run
 * the filter against an admin-supplied row before save.
 */
export interface TriggerRow {
  id: string
  organization_id: string
  enabled: boolean
  name: string
  description?: string
  source_table: string
  source_events: string[]
  match_filter: Record<string, unknown>
  target_endpoint: string
  payload_template: Record<string, unknown>
  post_success_patch?: Record<string, unknown>
  created_at: string
  updated_at: string
  created_by?: string
}

export interface CreateTriggerRequest {
  name: string
  description?: string
  enabled?: boolean
  source_table: string
  source_events: string[]
  match_filter: Record<string, unknown>
  target_endpoint: string
  payload_template: Record<string, unknown>
  post_success_patch?: Record<string, unknown>
}

export type UpdateTriggerRequest = Partial<CreateTriggerRequest>

export interface PreviewRequest {
  match_filter: Record<string, unknown>
  row: Record<string, unknown>
}

export interface PreviewResponse {
  matched: boolean
  error?: { pointer: string; message: string }
}

export interface AllowlistsResponse {
  source_tables: string[]
  target_endpoints: string[]
  source_events: string[]
  grammar_version: string
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg = (body as { error?: string })?.error ?? res.statusText
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export async function listTriggers(): Promise<TriggerRow[]> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/triggers`, { headers })
  return jsonOrThrow<TriggerRow[]>(res)
}

export async function createTrigger(
  body: CreateTriggerRequest
): Promise<TriggerRow> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/triggers`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return jsonOrThrow<TriggerRow>(res)
}

export async function updateTrigger(
  id: string,
  body: UpdateTriggerRequest
): Promise<TriggerRow> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/triggers/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
  return jsonOrThrow<TriggerRow>(res)
}

export async function deleteTrigger(id: string): Promise<void> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/triggers/${id}`, {
    method: 'DELETE',
    headers,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg = (body as { error?: string })?.error ?? res.statusText
    throw new Error(msg)
  }
}

export async function previewMatch(
  body: PreviewRequest
): Promise<PreviewResponse> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/triggers/preview`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return jsonOrThrow<PreviewResponse>(res)
}

export async function getAllowlists(): Promise<AllowlistsResponse> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/triggers/allowlists`, {
    headers,
  })
  return jsonOrThrow<AllowlistsResponse>(res)
}

// Created and developed by Jai Singh
