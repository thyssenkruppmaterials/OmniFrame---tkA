// Created and developed by Jai Singh
/**
 * Work Service HTTP Client
 * Handles all HTTP communication with the Rust work service
 * Follows OmniFrame service patterns with JWT authentication
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { workEngineIdempotencyKey } from './idempotency'
import type {
  ClaimResponse,
  CycleCountTask,
  HeartbeatData,
  PushWorkRequest,
  QueueStats,
  TaskResult,
  WorkServiceError,
  WorkerStatus,
} from './types'
import type { WorkTypeId, WorkTask } from './work-task-types'

// Work service base URL (defaults to localhost for development)
const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

let _organizationId: string | null = null

/**
 * Set the organization context for all work service requests.
 * Should be called when the user's auth state changes.
 */
export function setWorkServiceOrganization(orgId: string | null) {
  _organizationId = orgId
}

/**
 * Get authentication headers with JWT token
 * @throws Error if no active session
 */
async function getAuthHeaders(
  includeContentType: boolean = false
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
  // Only set Content-Type when a request body will be sent (avoids unnecessary CORS preflights on GET)
  if (includeContentType) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

/**
 * Per-request options for `fetchWithAuth` that aren't part of `RequestInit`.
 *
 * `allowFalseSuccess` opts a single endpoint out of the default
 * "throw on `{ success: false }`" behaviour. The Rust `/api/v1/work/claim`
 * route uses `success: false` + `task: null` as the canonical "queue is
 * empty for this worker right now" signal — that's a normal idle state,
 * not an error. Endpoints that opt in MUST type their response so the
 * `success` discriminator is visible to callers.
 */
interface FetchWithAuthOptions extends RequestInit {
  allowFalseSuccess?: boolean
}

/**
 * Generic fetch wrapper with authentication
 * Handles errors and response parsing
 */
async function fetchWithAuth<T>(
  endpoint: string,
  options: FetchWithAuthOptions = {}
): Promise<T> {
  const { allowFalseSuccess = false, ...requestInit } = options
  const hasBody = requestInit.body !== undefined
  const headers = await getAuthHeaders(hasBody)
  const url = `${WORK_SERVICE_URL}${endpoint}`

  logger.log(`[WorkServiceClient] ${requestInit.method || 'GET'} ${endpoint}`)

  const response = await fetch(url, {
    ...requestInit,
    headers: { ...headers, ...requestInit.headers },
  })

  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as WorkServiceError
    logger.error(`[WorkServiceClient] Error: ${error.error}`)
    throw new Error(error.error || 'Request failed')
  }

  if (response.status === 204) {
    return undefined as T
  }

  const body = await response.json()

  if (
    body &&
    typeof body === 'object' &&
    'success' in body &&
    body.success === false
  ) {
    const msg = body.message || body.error || 'Operation failed'
    if (allowFalseSuccess) {
      // Caller knows about the `success: false` shape and handles it as
      // a normal product state (e.g. empty work queue). Log at debug so
      // a noisy idle state doesn't pollute the production console — but
      // still emit something so it's diagnosable from a verbose build.
      logger.debug(
        `[WorkServiceClient] ${endpoint} returned success=false: ${msg}`
      )
      return body as T
    }
    logger.error(`[WorkServiceClient] Server returned success=false: ${msg}`)
    throw new Error(msg)
  }

  return body as T
}

/**
 * Work Service Client
 * Singleton-like exported object for making API calls
 */
export const workServiceClient = {
  // ============================================
  // Queue Operations
  // ============================================

  /**
   * Get the current work queue
   * Returns all pending and in-progress tasks for the organization
   */
  async getQueue(): Promise<CycleCountTask[]> {
    return fetchWithAuth<CycleCountTask[]>('/api/v1/work/queue')
  },

  /**
   * Get queue statistics
   * Returns counts for pending, in-progress, completed, etc.
   */
  async getQueueStats(): Promise<QueueStats> {
    return fetchWithAuth<QueueStats>('/api/v1/work/queue/stats')
  },

  /**
   * Claim the next available task (pull mode).
   *
   * The Rust `/api/v1/work/claim` route returns `200 OK` with
   * `{ success: false, message: "No tasks available", task: null }` when
   * the queue is empty for this worker (capacity exhausted, no eligible
   * row, or every candidate filtered out by zone exclusivity). That is a
   * normal idle state — NOT an error. We pass `allowFalseSuccess: true`
   * so the wrapper returns the body verbatim instead of throwing, and
   * downstream callers branch on `response.task` (truthy = claimed,
   * `null` = waiting for work).
   *
   * Genuine failures (HTTP 4xx/5xx, malformed JSON, network) still throw
   * via the wrapper's normal error path.
   */
  async claimNext(): Promise<ClaimResponse> {
    return fetchWithAuth<ClaimResponse>('/api/v1/work/claim', {
      method: 'POST',
      allowFalseSuccess: true,
    })
  },

  /**
   * Push a task to a specific user (push mode)
   * Used by supervisors to assign work directly
   */
  async pushToUser(countId: string, userId: string): Promise<void> {
    const payload: PushWorkRequest = { count_id: countId, user_id: userId }
    await fetchWithAuth<void>('/api/v1/work/push', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  // ============================================
  // Task Operations
  // ============================================

  /**
   * Start working on a task
   * Transitions task from 'assigned' to 'in_progress'
   */
  async startTask(taskId: string): Promise<void> {
    await fetchWithAuth<void>(`/api/v1/work/tasks/${taskId}/start`, {
      method: 'POST',
    })
  },

  /**
   * Complete a task with results
   * Submits the counted quantity and optional notes
   */
  async completeTask(taskId: string, result: TaskResult): Promise<void> {
    await fetchWithAuth<void>(`/api/v1/work/tasks/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify(result),
    })
  },

  /**
   * Release a task back to the queue
   * Used when a worker cannot complete a task
   */
  async releaseTask(taskId: string): Promise<void> {
    await fetchWithAuth<void>(`/api/v1/work/tasks/${taskId}/release`, {
      method: 'POST',
    })
  },

  async skipTask(taskId: string, reason?: string): Promise<void> {
    await fetchWithAuth<void>(`/api/v1/work/tasks/${taskId}/skip`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || null }),
    })
  },

  /**
   * Acknowledge a pushed task
   * Worker confirms receipt of pushed work
   */
  async acknowledgePush(taskId: string): Promise<void> {
    await fetchWithAuth<void>(`/api/v1/work/tasks/${taskId}/acknowledge`, {
      method: 'POST',
    })
  },

  /**
   * Get a specific task by ID
   */
  async getTask(taskId: string): Promise<CycleCountTask> {
    return fetchWithAuth<CycleCountTask>(`/api/v1/work/tasks/${taskId}`)
  },

  // ============================================
  // Worker Operations
  // ============================================

  /**
   * Get all active workers in the organization
   */
  async getWorkers(): Promise<WorkerStatus[]> {
    return fetchWithAuth<WorkerStatus[]>('/api/v1/workers')
  },

  /**
   * Get a specific worker's status
   */
  async getWorkerStatus(workerId: string): Promise<WorkerStatus> {
    return fetchWithAuth<WorkerStatus>(`/api/v1/workers/${workerId}`)
  },

  /**
   * Get tasks assigned to a specific worker
   */
  async getWorkerTasks(workerId: string): Promise<CycleCountTask[]> {
    return fetchWithAuth<CycleCountTask[]>(`/api/v1/workers/${workerId}/tasks`)
  },

  /**
   * Send a heartbeat to maintain worker presence
   * Should be called periodically (every 30-60 seconds)
   */
  async sendHeartbeat(data: HeartbeatData): Promise<void> {
    await fetchWithAuth<void>('/api/v1/workers/heartbeat', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // ============================================
  // Health Check
  // ============================================

  /**
   * Check if the work service is healthy
   * Does not require authentication
   */
  async healthCheck(): Promise<{ status: string }> {
    const response = await fetch(`${WORK_SERVICE_URL}/health`)
    if (!response.ok) {
      throw new Error('Work service unavailable')
    }
    return response.json()
  },

  // ============================================
  // Phase 3.3 — Generic WorkType-aware methods
  // (additive; existing claimNext/completeTask/etc. continue to work)
  // ============================================

  /**
   * Generic claim — when `task_type` is omitted the server defaults to
   * 'cycle_count' so existing callers (`claimNext()`) keep behaving the
   * same.
   */
  async claimNextTask(taskType: WorkTypeId): Promise<WorkTask | null> {
    const headers = await getAuthHeaders(true)
    const response = await fetch(`${WORK_SERVICE_URL}/api/v1/work/claim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task_type: taskType }),
    })
    if (!response.ok) {
      const err = (await response
        .json()
        .catch(() => ({ error: response.statusText }))) as WorkServiceError
      throw new Error(err.error || 'Claim failed')
    }
    const body = await response.json()
    return (body?.task ?? null) as WorkTask | null
  },

  /** Push the same set of tasks to one user atomically (Phase 2.3). */
  async pushBatch(
    taskIds: string[],
    userId: string
  ): Promise<Array<{ task_id: string; ok: boolean; error?: string }>> {
    const headers = await getAuthHeaders(true)
    headers['Idempotency-Key'] = workEngineIdempotencyKey()
    const response = await fetch(`${WORK_SERVICE_URL}/api/v1/work/push_batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task_ids: taskIds, user_id: userId }),
    })
    if (!response.ok) {
      const err = (await response
        .json()
        .catch(() => ({ error: response.statusText }))) as WorkServiceError
      throw new Error(err.error || 'Push batch failed')
    }
    return response.json()
  },
}

/**
 * Export the work service URL for WebSocket connections
 */
export const getWorkServiceUrl = (): string => WORK_SERVICE_URL

// Created and developed by Jai Singh
