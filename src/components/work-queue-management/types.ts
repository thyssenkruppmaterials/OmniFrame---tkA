// Created and developed by Jai Singh
/**
 * Local types for the Work Queue Management dispatcher.
 *
 * Reuses the canonical `WorkerStatus` + `CycleCountTask` from
 * `@/lib/work-service/types`; everything here is dispatcher-shaped
 * derived state (lane state, drag state, undo bookkeeping).
 */
import type { CycleCountTask, WorkerStatus } from '@/lib/work-service/types'

/**
 * One supervisor lane = one active operator + their NOW + NEXT.
 * `tasks` is the canonical (priority-ordered) list returned by
 * `GET /api/v1/workers/:id/tasks` after merging the per-operator
 * supervisor reorder scratchpad. `isLoading` / `error` mirror the
 * underlying TanStack Query state so the lane can render its own
 * skeleton / error treatment without prop-drilling the parent.
 */
export interface OperatorLaneState {
  worker: WorkerStatus
  tasks: CycleCountTask[]
  isLoading: boolean
  error: Error | null
  /**
   * Set of task ids whose enter animation should use the staggered
   * `delayChildren`. Tracked at the shell level so a burst (multiple
   * `TaskAssigned` events within ~100ms) staggers, while a single
   * arrival animates immediately.
   */
  staggerEnter: boolean
}

/**
 * Drag state for the cross-lane drag context. `task` is the task
 * being dragged (we keep the full record so the drag overlay can
 * render the real card without a per-id re-fetch). `sourceWorkerId`
 * is the lane id the drag started on; `null` while no drag is
 * active.
 */
export interface CrossLaneDragState {
  task: CycleCountTask | null
  sourceWorkerId: string | null
}

/**
 * Drop zone in a lane. Each lane exposes two distinct droppables —
 * "drop after current" (just below the NOW card) and "drop at end"
 * (the bottom of the NEXT pipeline). Encoded in the droppable id so
 * the drag-end handler can branch without storing extra state.
 */
type LaneDropZoneKind = 'after-now' | 'end-of-pipeline'

/**
 * Encoded sortable id for a task within a lane. Cross-lane drag
 * needs to disambiguate "task X in lane A" from "task X in lane B"
 * (same task can never appear in two lanes simultaneously by
 * domain invariant — but the drag context still needs lane scope
 * to compute drop intent). The id format is
 * `task::<workerId>::<taskId>`.
 */
const LANE_TASK_ID_PREFIX = 'task::'
const LANE_DROP_ZONE_ID_PREFIX = 'lane-zone::'

export function encodeLaneTaskId(workerId: string, taskId: string): string {
  return `${LANE_TASK_ID_PREFIX}${workerId}::${taskId}`
}

export function decodeLaneTaskId(
  encoded: string
): { workerId: string; taskId: string } | null {
  if (!encoded.startsWith(LANE_TASK_ID_PREFIX)) return null
  const rest = encoded.slice(LANE_TASK_ID_PREFIX.length)
  const sep = rest.indexOf('::')
  if (sep === -1) return null
  return {
    workerId: rest.slice(0, sep),
    taskId: rest.slice(sep + 2),
  }
}

export function encodeLaneDropZoneId(
  workerId: string,
  zone: LaneDropZoneKind
): string {
  return `${LANE_DROP_ZONE_ID_PREFIX}${workerId}::${zone}`
}

export function decodeLaneDropZoneId(
  encoded: string
): { workerId: string; zone: LaneDropZoneKind } | null {
  if (!encoded.startsWith(LANE_DROP_ZONE_ID_PREFIX)) return null
  const rest = encoded.slice(LANE_DROP_ZONE_ID_PREFIX.length)
  const sep = rest.indexOf('::')
  if (sep === -1) return null
  const zone = rest.slice(sep + 2)
  if (zone !== 'after-now' && zone !== 'end-of-pipeline') return null
  return { workerId: rest.slice(0, sep), zone }
}

/**
 * Pending undo bookkeeping for a cross-lane reassign. Holds enough
 * context for the toast Undo handler to call `pushToUser` back to
 * the original lane.
 */
export interface PendingReassignUndo {
  taskId: string
  countNumber: string
  fromWorkerId: string
  fromWorkerName: string
  toWorkerId: string
  toWorkerName: string
  timeoutId: ReturnType<typeof setTimeout> | null
}

// Created and developed by Jai Singh
