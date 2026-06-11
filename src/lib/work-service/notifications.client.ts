// Created and developed by Jai Singh
/**
 * Notifications REST client — Tier 2 #2 (2026-05-06).
 *
 * Wraps `rust-work-service`'s `/api/v1/notifications/*` endpoints.
 * Used by `useNotifications` (`src/hooks/use-notifications.ts`).
 */
import { supabase } from '@/lib/supabase/client'

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

let _organizationId: string | null = null

// 2026-05-10 — bell-icon notifications endpoint probe cache.
//
// `useNotifications` bootstraps on every authenticated route mount + every
// 5 minutes while the WS is disconnected. When the rust-work-service
// deployment lags the FE bundle (route missing on this server) the bell
// rings 404 EVERY route load, and Chrome DevTools logs the failed request
// at the network layer BEFORE our JS sees the response — so a try/catch
// alone can't suppress the spam. Instead we probe once per page load:
// after the first 404 we set `_endpointReachable = false` and short-circuit
// every subsequent call with an in-memory empty payload. The cache resets
// on page reload, so a service redeploy is picked up by the next bootstrap.
let _endpointReachable: boolean | null = null

const EMPTY_RESPONSE: ListNotificationsResponse = {
  notifications: [],
  unread_count: 0,
}

/**
 * Test seam — let unit tests reset the probe cache between cases without
 * having to re-import the module. Not exported in the public ESM surface
 * since callers shouldn't depend on this.
 */
export function __resetNotificationsEndpointProbe(): void {
  _endpointReachable = null
}

export function setNotificationsOrganization(orgId: string | null) {
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

/**
 * One row of the user's notification feed. Mirrors the Rust
 * `NotificationRow` type — see `rust-work-service/src/api/routes/
 * notifications.rs` for the source of truth.
 */
export interface NotificationRow {
  id: string
  user_id: string
  organization_id: string
  /** `notification_type` enum: `info | warning | error | success`. */
  severity: string | null
  /** Free-form event-class label, e.g. `'sap_job_complete'`. */
  kind: string | null
  title: string
  body: string | null
  link: string | null
  read: boolean
  read_at: string | null
  created_at: string | null
}

export interface ListNotificationsResponse {
  notifications: NotificationRow[]
  unread_count: number
}

export async function listNotifications(
  opts: {
    unreadOnly?: boolean
    limit?: number
  } = {}
): Promise<ListNotificationsResponse> {
  // Short-circuit if a previous probe established the endpoint isn't
  // deployed on this server. No network call, no browser-level 404 log.
  if (_endpointReachable === false) {
    return EMPTY_RESPONSE
  }

  const headers = await getAuthHeaders()
  const url = new URL(`${WORK_SERVICE_URL}/api/v1/notifications/`)
  if (opts.unreadOnly !== undefined) {
    url.searchParams.set('unread_only', String(opts.unreadOnly))
  }
  if (opts.limit !== undefined) {
    url.searchParams.set('limit', String(opts.limit))
  }
  const res = await fetch(url.toString(), { headers })
  // 2026-05-10 — bell-icon notifications are an OPTIONAL feature.
  // When the rust-work-service deployment lags the FE bundle (route
  // missing on this server) OR when a regional outage trips a 5xx,
  // the bootstrap should fail SOFT — render the bell empty, no toast,
  // no console spam. The `mark_read` / `mark_all_read` calls below
  // still throw on failure because those ARE user-initiated mutations
  // where a silent failure would be a UX bug.
  if (res.status === 404) {
    // Endpoint not deployed on this server — cache the verdict so we
    // don't trigger another browser-level 404 log on the next mount /
    // safety-net interval. Reset on page reload (module re-init).
    _endpointReachable = false
    return EMPTY_RESPONSE
  }
  if (res.status >= 500) {
    // Transient server outage — don't poison the cache; let the next
    // safety-net tick retry. Still fail soft for this call.
    return EMPTY_RESPONSE
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'list notifications failed')
  }
  _endpointReachable = true
  return res.json()
}

export async function markNotificationRead(
  id: string
): Promise<{ marked: boolean }> {
  const headers = await getAuthHeaders(true)
  const res = await fetch(
    `${WORK_SERVICE_URL}/api/v1/notifications/${id}/read`,
    { method: 'POST', headers }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'mark read failed')
  }
  return res.json()
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  const headers = await getAuthHeaders(true)
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/notifications/read-all`, {
    method: 'POST',
    headers,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'mark all read failed')
  }
  return res.json()
}

// Created and developed by Jai Singh
