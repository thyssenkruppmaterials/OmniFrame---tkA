/**
 * Work Service Types
 * TypeScript interfaces matching Rust work-service models
 * For use with the Rust work service at Port 8030
 */

// Priority levels for cycle counts (matching database enum)
export type CycleCountPriority = 'critical' | 'hot' | 'normal' | 'low'

// Push mode for task assignment
export type PushMode = 'pull' | 'push'

// Worker status states
export type WorkerStatusType = 'online' | 'offline' | 'busy' | 'idle' | 'break'

/**
 * Cycle Count Task from the work queue
 * Matches Rust CycleCountTask model
 */
export interface CycleCountTask {
  id: string
  count_number: string
  material_number: string
  material_description: string | null
  location: string
  warehouse: string | null
  system_quantity: number
  counted_quantity: number | null
  unit_of_measure: string
  priority: CycleCountPriority
  status: string
  count_type: string | null
  assigned_to: string | null
  assigned_at: string | null
  push_mode: PushMode
  pushed_by: string | null
  pushed_at: string | null
  push_acknowledged: boolean
  organization_id: string
}

/**
 * Worker status from the work service
 * Tracks real-time worker presence and activity
 */
export interface WorkerStatus {
  user_id: string
  full_name: string | null
  email: string | null
  status: WorkerStatusType
  current_task_id: string | null
  current_task_type: string | null
  current_zone: string | null
  current_location: string | null
  last_heartbeat: string
}

/**
 * Queue statistics from the work service
 * Real-time metrics for work queue monitoring
 */
export interface QueueStats {
  pending: number
  in_progress: number
  completed_today: number
  pushed_pending: number
  total_workers_online: number
}

/**
 * Heartbeat data sent by workers to maintain presence
 */
export interface HeartbeatData {
  task_id?: string
  task_type?: string
  zone?: string
  location?: string
  status: string
}

/**
 * Task completion result
 */
export interface TaskResult {
  counted_quantity: number
  notes?: string
}

/**
 * Push work request payload
 * Note: Uses count_id to match Rust backend PushCycleCountRequest
 */
export interface PushWorkRequest {
  count_id: string
  user_id: string
}

/**
 * WebSocket event types from the work service
 */
export type WsEventType =
  | 'TaskAssigned'
  | 'TaskStatusChanged'
  | 'WorkerStatusChanged'
  | 'QueueStatsUpdated'
  | 'PushedWork'
  | 'Heartbeat'

/**
 * WebSocket event payload
 * Union type for all possible event data
 */
export interface WsEvent {
  type: WsEventType
  task_id?: string
  user_id?: string
  priority?: string
  location?: string
  material?: string
  count_number?: string
  old_status?: string
  new_status?: string
  status?: string
  pending?: number
  in_progress?: number
  completed_today?: number
}

/**
 * WebSocket subscription message
 */
export interface WsSubscribeMessage {
  type: 'Subscribe'
  organization_id: string
}

/**
 * WebSocket unsubscribe message
 */
export interface WsUnsubscribeMessage {
  type: 'Unsubscribe'
}

/**
 * WebSocket heartbeat message
 */
export interface WsHeartbeatMessage extends HeartbeatData {
  type: 'Heartbeat'
}

/**
 * Union type for all outgoing WebSocket messages
 */
export type WsOutgoingMessage =
  | WsSubscribeMessage
  | WsUnsubscribeMessage
  | WsHeartbeatMessage

/**
 * API Error response from work service
 */
export interface WorkServiceError {
  error: string
  code?: string
}

/**
 * Claim response - returns the claimed task or null if none available
 */
export type ClaimResponse = CycleCountTask | null

/**
 * Worker with their assigned tasks
 */
export interface WorkerWithTasks extends WorkerStatus {
  tasks: CycleCountTask[]
}
