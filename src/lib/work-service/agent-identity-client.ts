// Created and developed by Jai Singh
/**
 * Phase 10 (`.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`)
 * — agent identity v2 REST client.
 *
 * Wraps the rust-work-service `/api/v1/agent-identity/*` routes
 * mirroring the auth + org-scope pattern from the sibling
 * `triggers-client.ts` / `sap-testing-client.ts`: JWT in
 * `Authorization: Bearer`, optional `X-Organization-ID` defence-in-
 * depth header, server resolves the authoritative org from the JWT
 * claim (never from the body / header / query string).
 *
 * Four routes:
 *
 *   - POST /register — admin-only. Mints an `omni_sk_*` plaintext
 *     key; the response carries the plaintext ONCE (it is NEVER
 *     recoverable thereafter — admins must save it before closing
 *     the dialog).
 *   - POST /exchange — public (no auth header). The agent calls
 *     this; the FE doesn't.
 *   - POST /revoke   — admin-only. Sets `revoked_at = now()`. The
 *     middleware's revocation check trips within ~60 s of the
 *     server-side cache TTL.
 *   - GET  /list     — admin-only. Returns active rows by default;
 *     pass `?include_revoked=true` to see revoked keys for forensic
 *     work.
 *
 * See:
 *   - Implementation note: `Implementations/Implement-Rust-Work-Service-Phase10.md`
 *   - ADR: `Decisions/ADR-Agent-Identity-V2-Phase10.md`
 *   - Rust route: `rust-work-service/src/api/routes/agent_identity.rs`
 */
import { supabase } from '@/lib/supabase/client'

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

let _organizationId: string | null = null

export function setAgentIdentityOrganization(orgId: string | null) {
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

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
    }
    const msg = body?.error ?? res.statusText
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ─────────────────────────────────────────────────────────────────
// /list — surface active service keys
// ─────────────────────────────────────────────────────────────────

export interface ServiceKeyListEntry {
  key_id: string
  agent_id: string
  key_prefix: string
  label: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  created_by_email: string | null
  revoke_reason: string | null
}

export interface ListResponse {
  keys: ServiceKeyListEntry[]
}

export async function listAgentServiceKeys(
  options: { includeRevoked?: boolean } = {}
): Promise<ServiceKeyListEntry[]> {
  const headers = await getAuthHeaders()
  const url = new URL(`${WORK_SERVICE_URL}/api/v1/agent-identity/list`)
  if (options.includeRevoked) {
    url.searchParams.set('include_revoked', 'true')
  }
  const res = await fetch(url.toString(), { headers })
  const body = await jsonOrThrow<ListResponse>(res)
  return body.keys
}

// ─────────────────────────────────────────────────────────────────
// /register — admin mints a fresh `omni_sk_*` key
// ─────────────────────────────────────────────────────────────────

export interface RegisterRequest {
  agent_id: string
  label?: string
}

export interface RegisterResponse {
  /** `agent_service_keys.id`. */
  key_id: string
  /**
   * The plaintext key. **Shown once.** Save it before closing the
   * dialog — there is NO recovery path.
   */
  plaintext_key: string
  /** First 8 chars of `plaintext_key`; safe to render in lists. */
  key_prefix: string
  agent_id: string
  label: string | null
  /** Reserved — always `null` today; plaintext keys live until the admin revokes. */
  expires_at: string | null
}

export async function registerAgentServiceKey(
  body: RegisterRequest
): Promise<RegisterResponse> {
  const headers = await getAuthHeaders()
  const res = await fetch(
    `${WORK_SERVICE_URL}/api/v1/agent-identity/register`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }
  )
  return jsonOrThrow<RegisterResponse>(res)
}

// ─────────────────────────────────────────────────────────────────
// /revoke — admin marks a key revoked
// ─────────────────────────────────────────────────────────────────

export interface RevokeRequest {
  key_id: string
  reason?: string
}

export interface RevokeResponse {
  key_id: string
  revoked_at: string
  agent_id: string
}

export async function revokeAgentServiceKey(
  body: RevokeRequest
): Promise<RevokeResponse> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/agent-identity/revoke`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return jsonOrThrow<RevokeResponse>(res)
}

// Created and developed by Jai Singh
