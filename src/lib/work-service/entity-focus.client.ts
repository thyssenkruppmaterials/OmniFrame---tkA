// Created and developed by Jai Singh
/**
 * Entity Focus REST client — Tier 2 #1 (2026-05-06).
 *
 * Thin wrapper around `fetch` calls to `rust-work-service`'s
 * `/api/v1/entity-focus/*` endpoints. Mirrors the auth shape of
 * `workServiceClient` (Bearer JWT + organization header) so every
 * call goes through the same auth path the WS upgrade does.
 *
 * Used by `useEntityFocus` (`src/hooks/use-entity-focus.ts`); not
 * intended to be called directly by components.
 */
import { supabase } from '@/lib/supabase/client'

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

let _organizationId: string | null = null

export function setEntityFocusOrganization(orgId: string | null) {
  _organizationId = orgId
}

async function getAuthHeaders(
  includeContentType = false
): Promise<Record<string, string>> {
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
  if (includeContentType) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

export interface FocusUserPublic {
  user_id: string
  /** Unix seconds when this user first started focusing the entity. */
  started_at: number
}

export interface EntityFocusBody {
  entity_kind: string
  entity_id: string
}

/** `POST /api/v1/entity-focus/heartbeat` — refresh / start a focus lease. */
export async function heartbeatFocus(
  body: EntityFocusBody
): Promise<{ action: 'enter' | 'heartbeat' }> {
  const headers = await getAuthHeaders(true)
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/entity-focus/heartbeat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'entity-focus heartbeat failed')
  }
  return res.json()
}

/**
 * `DELETE /api/v1/entity-focus` — explicit untrack on row deselect.
 *
 * Best-effort: when `useBeacon=true` and `navigator.sendBeacon` is
 * available, fall back to the beacon transport so the request
 * survives a `pagehide`. Beacons can't carry arbitrary headers, so
 * we only use that path on tab-close; in-app deselect uses fetch
 * with full Authorization headers.
 */
export async function untrackFocus(
  body: EntityFocusBody,
  opts: { useBeacon?: boolean } = {}
): Promise<{ removed: boolean } | null> {
  if (
    opts.useBeacon &&
    typeof navigator !== 'undefined' &&
    navigator.sendBeacon
  ) {
    // Beacons require a same-origin URL or CORS; the work service is
    // typically same-origin via the Vite dev proxy in development and
    // a Railway domain in production. Best-effort: enqueue and return.
    // We can't carry the Authorization header, so this is a fire-and-
    // forget signal — the server-side 30s TTL evicts the lease either
    // way. We send via beacon ONLY when the browser is closing; the
    // happy in-app deselect path goes through the Authorization-bearing
    // fetch below.
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' })
    navigator.sendBeacon(`${WORK_SERVICE_URL}/api/v1/entity-focus`, blob)
    return null
  }

  const headers = await getAuthHeaders(true)
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/entity-focus`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'entity-focus untrack failed')
  }
  return res.json()
}

/** `GET /api/v1/entity-focus/users` — bootstrap snapshot. */
export async function listFocusUsers(
  body: EntityFocusBody
): Promise<FocusUserPublic[]> {
  const headers = await getAuthHeaders()
  const url = new URL(`${WORK_SERVICE_URL}/api/v1/entity-focus/users`)
  url.searchParams.set('entity_kind', body.entity_kind)
  url.searchParams.set('entity_id', body.entity_id)
  const res = await fetch(url.toString(), { headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'entity-focus users query failed')
  }
  const data = (await res.json()) as { users: FocusUserPublic[] }
  return data.users
}

// Created and developed by Jai Singh
