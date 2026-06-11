// Created and developed by Jai Singh
/**
 * Dispatch broadcast REST client — Tier 2 #3 (2026-05-06).
 *
 * Wraps `POST /api/v1/dispatch/broadcast` (server-side supervisor
 * authz check). Used by the BroadcastDialog supervisor UI.
 */
import { supabase } from '@/lib/supabase/client'

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

let _organizationId: string | null = null

export function setDispatchOrganization(orgId: string | null) {
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

export interface BroadcastRequest {
  message: string
  priority?: 'critical' | 'hot' | 'normal' | 'low'
  target_zone?: string
  target_role?: string
  target_user_ids?: string[]
  work_task_id?: string
}

export interface BroadcastResponse {
  resolved_user_count: number
  target_type: 'zone' | 'role' | 'users' | 'mixed'
}

export async function broadcastDispatch(
  body: BroadcastRequest
): Promise<BroadcastResponse> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${WORK_SERVICE_URL}/api/v1/dispatch/broadcast`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'broadcast failed')
  }
  return res.json()
}

// Created and developed by Jai Singh
