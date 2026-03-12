/**
 * Work Service HTTP Client
 * Handles all HTTP communication with the Rust work service
 * Follows OmniFrame service patterns with JWT authentication
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
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
 * Generic fetch wrapper with authentication
 * Handles errors and response parsing
 */
async function fetchWithAuth<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const hasBody = options.body !== undefined
  const headers = await getAuthHeaders(hasBody)
  const url = `${WORK_SERVICE_URL}${endpoint}`

  logger.log(`[WorkServiceClient] ${options.method || 'GET'} ${endpoint}`)

  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  })

  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as WorkServiceError
    logger.error(`[WorkServiceClient] Error: ${error.error}`)
    throw new Error(error.error || 'Request failed')
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
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
   * Claim the next available task (pull mode)
   * Returns the claimed task or null if none available
   */
  async claimNext(): Promise<ClaimResponse> {
    return fetchWithAuth<ClaimResponse>('/api/v1/work/claim', {
      method: 'POST',
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
}

/**
 * Export the work service URL for WebSocket connections
 */
export const getWorkServiceUrl = (): string => WORK_SERVICE_URL
// Developer and Creator: Jai Singh
