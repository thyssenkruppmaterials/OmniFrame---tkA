// Created and developed by Jai Singh
/**
 * Operation Control client — thin wrappers around the Rust work-service
 * routes that the supervisor command center fires from drag-and-drop.
 *
 * Every mutating call carries an `Idempotency-Key` (UUIDv7 generated client
 * side) so a flaky network re-send does not double-reassign zones.
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { workEngineIdempotencyKey } from './idempotency'

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

async function authHeaders(
  includeContentType = false
): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('No active session')
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
  }
  if (includeContentType) headers['Content-Type'] = 'application/json'
  return headers
}

export interface ReassignZoneRequest {
  zone: string
  from_user_id: string
  to_user_id: string
  mode: 'soft' | 'hard'
}

export interface ReassignZoneResponse {
  tasks_moved: number
  events_written: number
  idempotency_key: string
}

export const operationControlClient = {
  async reassignZone(req: ReassignZoneRequest): Promise<ReassignZoneResponse> {
    const key = workEngineIdempotencyKey()
    const headers = await authHeaders(true)
    headers['Idempotency-Key'] = key

    const response = await fetch(
      `${WORK_SERVICE_URL}/api/v1/work/reassign_zone`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
      }
    )

    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ error: response.statusText }))
      logger.error(`[operationControl] reassignZone failed: ${err.error}`)
      throw new Error(err.error || `Reassign failed (${response.status})`)
    }
    return response.json()
  },

  /**
   * Push the top-N pending tasks of the given (task_type, priority) to one
   * operator. N defaults to 1; client passes a higher count for shift+drag.
   */
  async pushTopN(args: {
    task_type: string
    priority: string
    user_id: string
    n: number
  }): Promise<{ pushed: number; idempotency_key: string }> {
    const key = workEngineIdempotencyKey()
    const headers = await authHeaders(true)
    headers['Idempotency-Key'] = key

    const response = await fetch(`${WORK_SERVICE_URL}/api/v1/work/push_top_n`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    })

    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ error: response.statusText }))
      throw new Error(err.error || `Push top-N failed (${response.status})`)
    }
    return response.json()
  },
}

// Created and developed by Jai Singh
