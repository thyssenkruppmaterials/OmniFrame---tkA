// Created and developed by Jai Singh
/**
 * useOperatorTaskQueueOrder — supervisor-side per-operator queue reorder.
 *
 * Wraps a canonical task list (the backend ORDER BY in
 * `rust-work-service::db::queries::get_worker_tasks` — priority →
 * pushed_at → resolved_zone/aisle/sequence → location → assigned_at)
 * with a local user-visible reorder layer. Used by the
 * `<OperatorTaskQueue>` tab inside `<LiveOperatorStatus>` so a
 * supervisor can drag-to-reorder the next 10–15 tasks for a specific
 * operator without ever blocking on the backend.
 *
 * ## Why a local-only order today
 *
 * The `rr_cyclecount_data` table has no `task_assignment_order`
 * column — every per-operator query orders by the priority/path
 * heuristic baked into the SQL. Adding a server-owned ordering field
 * would require:
 *
 *   1. A migration (`task_assignment_order INTEGER NULL` + index).
 *   2. A new Rust route (`PUT /api/v1/workers/:id/tasks/reorder`).
 *   3. A `WsEvent::TaskOrderChanged` variant + listener trigger so
 *      every supervisor watching the same operator sees the reorder.
 *   4. A semantic decision: does reorder also re-prioritise what the
 *      operator's RF claim-next call returns? (Probably yes — but
 *      that interacts with the priority/zone engine in non-obvious
 *      ways and deserves its own ADR.)
 *
 * For the first ship the reorder is a **supervisor-side scratchpad**
 * — visible to one supervisor in one browser tab, persisted to
 * `localStorage` so a refresh doesn't lose it. The follow-up ADR
 * `ADR-Supervisor-Task-Queue-Reorder-Persistence` (see Implementation
 * note `Implement-Operator-Cycle-Count-Queue-Tab`) tracks the work
 * needed to make the reorder authoritative.
 *
 * ## Merge strategy
 *
 * `mergeOrder(savedIds, canonicalTasks)` produces the visible list:
 *
 *   - Tasks present in `savedIds` keep their saved positions.
 *   - Tasks NOT in `savedIds` (newly assigned, unknown to the local
 *     scratchpad) append at the end in canonical order. So a fresh
 *     reorder doesn't get blown away when a new task lands — the new
 *     task just shows up at the bottom of the supervisor's view.
 *   - Tasks in `savedIds` that are no longer in the canonical list
 *     (completed, released, reassigned to another operator) are
 *     pruned — the saved order is rewritten the next time the user
 *     drags so the localStorage entry stays bounded.
 *
 * ## Persistence
 *
 * `localStorage` key shape:
 *
 *   `omniframe.operator-task-queue-order.v1.<operatorId>`
 *
 * Value shape:
 *
 *   `string[]`  — array of task IDs in user-preferred order.
 *
 * The `v1` segment versions the schema for the day someone wants to
 * persist richer state (e.g. notes per task, hide flag per task) —
 * bumping to `v2` invalidates the v1 entries cleanly.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { logger } from '@/lib/utils/logger'

const ORDER_KEY_PREFIX = 'omniframe.operator-task-queue-order.v1.'

function orderStorageKey(operatorId: string): string {
  return `${ORDER_KEY_PREFIX}${operatorId}`
}

/**
 * Read the saved order for an operator from `localStorage`. Returns
 * `null` if no entry exists or the entry is malformed (so the caller
 * can fall back to canonical order without a try/catch).
 */
function readSavedOrder(operatorId: string): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(orderStorageKey(operatorId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch (err) {
    logger.warn(
      `[useOperatorTaskQueueOrder] Failed to read order for ${operatorId}:`,
      err
    )
    return null
  }
}

function writeSavedOrder(operatorId: string, ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      orderStorageKey(operatorId),
      JSON.stringify(ids)
    )
  } catch (err) {
    logger.warn(
      `[useOperatorTaskQueueOrder] Failed to persist order for ${operatorId}:`,
      err
    )
  }
}

function clearSavedOrder(operatorId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(orderStorageKey(operatorId))
  } catch (err) {
    logger.warn(
      `[useOperatorTaskQueueOrder] Failed to clear order for ${operatorId}:`,
      err
    )
  }
}

/**
 * Apply a saved order to a canonical list of items. Pure — exported
 * for unit tests so the merge contract has direct coverage without
 * mounting React.
 *
 * Items appear in this order:
 *
 *   1. Items whose id is in `savedIds`, in the order they appear in
 *      `savedIds`.
 *   2. Items whose id is NOT in `savedIds`, in the order they appear
 *      in `items` (i.e. canonical / backend order).
 *
 * If `savedIds` is `null` or empty, the canonical order is returned
 * unchanged.
 */
export function mergeOrder<T extends { id: string }>(
  savedIds: string[] | null,
  items: T[]
): T[] {
  if (!savedIds || savedIds.length === 0) return items
  const byId = new Map(items.map((t) => [t.id, t]))
  const seen = new Set<string>()
  const ordered: T[] = []
  for (const id of savedIds) {
    const item = byId.get(id)
    if (item && !seen.has(id)) {
      ordered.push(item)
      seen.add(id)
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      ordered.push(item)
      seen.add(item.id)
    }
  }
  return ordered
}

export interface UseOperatorTaskQueueOrderOptions<T extends { id: string }> {
  /**
   * The operator the queue is for. `null`/`undefined` disables
   * persistence (the canonical list is returned as-is). When the
   * operator changes, the hook re-reads `localStorage` for the new
   * operator and replaces its in-memory state.
   */
  operatorId: string | null | undefined
  /**
   * The canonical (backend-ordered) list of tasks. Hook does NOT
   * mutate this — produces a derived ordered view via `mergeOrder`.
   */
  items: T[]
}

export interface UseOperatorTaskQueueOrderReturn<T extends { id: string }> {
  /** Items in the user-preferred order (or canonical order if no override). */
  orderedItems: T[]
  /**
   * `true` when the user has at least one task with a non-canonical
   * position. Drives the "Custom order" badge in the UI so
   * supervisors know what they're looking at.
   */
  isCustomOrder: boolean
  /**
   * Reorder a single task by id. `activeId` is the task being
   * dragged; `overId` is the task it was dropped onto. Persists the
   * new order to `localStorage` and updates in-memory state. No-op
   * when either id is missing from the current canonical list (e.g.
   * the task completed mid-drag).
   */
  reorder: (activeId: string, overId: string) => void
  /**
   * Reset to the canonical backend order. Removes the operator's
   * `localStorage` entry and clears in-memory state. The next render
   * shows the canonical list.
   */
  resetOrder: () => void
}

/**
 * Hook entry point — see file-level docstring for the full contract.
 */
export function useOperatorTaskQueueOrder<T extends { id: string }>(
  options: UseOperatorTaskQueueOrderOptions<T>
): UseOperatorTaskQueueOrderReturn<T> {
  const { operatorId, items } = options

  const [savedIds, setSavedIds] = useState<string[] | null>(() =>
    operatorId ? readSavedOrder(operatorId) : null
  )

  // Refresh saved-id state when the operator switches. Without this
  // effect, dragging on operator A → switching to operator B would
  // show A's saved order as B's "in-memory" state until the next
  // drag.
  useEffect(() => {
    if (!operatorId) {
      setSavedIds(null)
      return
    }
    setSavedIds(readSavedOrder(operatorId))
  }, [operatorId])

  // Cross-surface sync. The dispatcher's cross-lane drag context
  // writes the order key directly via `localStorage.setItem` +
  // dispatches a synthetic `storage` event so this hook (mounted in
  // a sibling component, e.g. `<OperatorLane>` or
  // `<OperatorTaskQueueDialog>`) re-reads. Native multi-tab
  // localStorage sync uses the same event, so cross-tab supervisors
  // also stay coherent for free. No-op when `operatorId` is unset.
  useEffect(() => {
    if (!operatorId || typeof window === 'undefined') return
    const key = orderStorageKey(operatorId)
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return
      setSavedIds(readSavedOrder(operatorId))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [operatorId])

  const orderedItems = useMemo(
    () => mergeOrder(savedIds, items),
    [savedIds, items]
  )

  // Whether the user has actually customised the order vs the items
  // happen to coincide with the saved list (e.g. they dragged once,
  // then the backend caught up). If the merged ids match the
  // canonical ids 1:1, treat it as "no custom order" so the badge
  // doesn't lie.
  const isCustomOrder = useMemo(() => {
    if (!savedIds || savedIds.length === 0) return false
    if (orderedItems.length !== items.length) return false
    for (let i = 0; i < orderedItems.length; i++) {
      if (orderedItems[i].id !== items[i].id) return true
    }
    return false
  }, [savedIds, orderedItems, items])

  const reorder = useCallback(
    (activeId: string, overId: string) => {
      if (!operatorId) return
      if (activeId === overId) return
      const ids = orderedItems.map((t) => t.id)
      const fromIndex = ids.indexOf(activeId)
      const toIndex = ids.indexOf(overId)
      if (fromIndex === -1 || toIndex === -1) return
      const next = arrayMove(ids, fromIndex, toIndex)
      setSavedIds(next)
      writeSavedOrder(operatorId, next)
    },
    [operatorId, orderedItems]
  )

  const resetOrder = useCallback(() => {
    if (!operatorId) {
      setSavedIds(null)
      return
    }
    clearSavedOrder(operatorId)
    setSavedIds(null)
  }, [operatorId])

  return { orderedItems, isCustomOrder, reorder, resetOrder }
}

// Created and developed by Jai Singh
