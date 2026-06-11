// Created and developed by Jai Singh
/**
 * `useCrossLaneReassign` — drag-from-A-to-B reassignment with
 * optimistic UI + Undo toast.
 *
 * Calls `workServiceClient.pushToUser(taskId, targetUserId)` on
 * drop. Optimistic update removes the task from the source lane
 * cache and inserts it into the target lane cache; on error we
 * rollback both caches. On success a `sonner` toast surfaces with
 * an "Undo" action that reverses the reassignment back to the
 * original holder by re-calling `pushToUser` — same code path,
 * symmetric behaviour.
 *
 * In-progress tasks: `pushToUser` will reject server-side. We
 * surface a clear toast ("Cannot reassign in-progress task; release
 * first") rather than auto-releasing — the destructive path needs
 * explicit consent. The drag context disables drag for in-progress
 * cards before they ever get to this hook (see
 * `cross-lane-drag-context.tsx`), so this branch is purely a
 * defence-in-depth fallback.
 *
 * Honours `realtime-policy.mdc`: no new `supabase.channel(...)`
 * callsite. The shell-level WS handler in `useMultiOperatorTasks`
 * picks up the resulting `PushedWork` event and reconciles the
 * cache, so by the time the optimistic-rollback path could matter
 * the WS has already corrected any drift.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import { workServiceClient } from '@/lib/work-service/client'
import type { CycleCountTask, WorkerStatus } from '@/lib/work-service/types'
import { WORKER_TASKS_QUERY_KEY } from '@/hooks/use-active-workers'
import { CROSS_LANE_UNDO_TIMEOUT_MS } from '../constants'
import type { PendingReassignUndo } from '../types'

interface UseCrossLaneReassignOptions {
  /**
   * Map of every visible worker keyed by `user_id`. Used to build
   * the toast message ("CC-… moved to Nikki Mason") without a
   * round-trip to the workers list. Pass the same `workers` array
   * the dispatcher iterates over.
   */
  workers: WorkerStatus[]
}

interface UseCrossLaneReassignReturn {
  /**
   * Trigger a cross-lane reassign. Wraps `pushToUser` with optimistic
   * cache updates and the undo toast. Resolves once the underlying
   * mutation completes (success or failure); callers can `await`
   * if they need synchronous flow but the dispatcher fires-and-
   * forgets and lets the toast carry the result.
   */
  reassign: (args: {
    task: CycleCountTask
    fromWorkerId: string
    toWorkerId: string
  }) => Promise<void>
}

export function useCrossLaneReassign({
  workers,
}: UseCrossLaneReassignOptions): UseCrossLaneReassignReturn {
  const queryClient = useQueryClient()
  const pendingRef = useRef<Map<string, PendingReassignUndo>>(new Map())

  // Clear any timers we own when the dispatcher unmounts (tab
  // switch, sign-out). Avoids leaking a setTimeout that would log
  // a stale clear after the component is gone.
  useEffect(() => {
    const ref = pendingRef.current
    return () => {
      ref.forEach((p) => {
        if (p.timeoutId !== null) clearTimeout(p.timeoutId)
      })
      ref.clear()
    }
  }, [])

  const findWorker = useCallback(
    (id: string) => workers.find((w) => w.user_id === id) ?? null,
    [workers]
  )

  const performPush = useCallback(
    async (
      task: CycleCountTask,
      fromWorkerId: string,
      toWorkerId: string
    ): Promise<{ success: boolean; rollback: () => void }> => {
      const fromKey = [WORKER_TASKS_QUERY_KEY, fromWorkerId]
      const toKey = [WORKER_TASKS_QUERY_KEY, toWorkerId]

      // Snapshot current caches for rollback.
      const fromSnapshot =
        queryClient.getQueryData<CycleCountTask[]>(fromKey) ?? []
      const toSnapshot = queryClient.getQueryData<CycleCountTask[]>(toKey) ?? []

      // Optimistic: remove from source, append to target. The WS
      // event from the server will arrive shortly and will reconcile
      // any divergence (canonical priority order may put the task
      // higher than "end of list" once the server responds).
      const optimisticTo = [...toSnapshot]
      // De-dupe: the target lane could already contain this task in
      // a rare race (server updated cache via WS between our
      // mutation start and now).
      if (!optimisticTo.some((t) => t.id === task.id)) {
        optimisticTo.push({
          ...task,
          assigned_to: toWorkerId,
        })
      }
      queryClient.setQueryData(
        fromKey,
        fromSnapshot.filter((t) => t.id !== task.id)
      )
      queryClient.setQueryData(toKey, optimisticTo)

      const rollback = () => {
        queryClient.setQueryData(fromKey, fromSnapshot)
        queryClient.setQueryData(toKey, toSnapshot)
      }

      try {
        await workServiceClient.pushToUser(task.id, toWorkerId)
        // Force a refetch to pick up canonical ordering. The WS
        // event also invalidates, but invalidating here twice is a
        // no-op (TanStack dedupes in-flight queries).
        queryClient.invalidateQueries({ queryKey: fromKey })
        queryClient.invalidateQueries({ queryKey: toKey })
        return { success: true, rollback }
      } catch (err) {
        // The error itself is surfaced via the toast in `reassign`;
        // here we just need to roll back. Logged for diagnostics.
        logger.warn('[useCrossLaneReassign] pushToUser failed:', err)
        rollback()
        return { success: false, rollback }
      }
    },
    [queryClient]
  )

  const reassign = useCallback(
    async (args: {
      task: CycleCountTask
      fromWorkerId: string
      toWorkerId: string
    }) => {
      const { task, fromWorkerId, toWorkerId } = args
      if (fromWorkerId === toWorkerId) return

      // Defence-in-depth: the drag context blocks the drag for
      // in_progress tasks before this point, but if a programmatic
      // caller bypasses that we still want a graceful refusal.
      if (task.status === 'in_progress') {
        toast.error(
          "Cannot reassign a task that's already in progress. Release it first."
        )
        return
      }

      const fromWorker = findWorker(fromWorkerId)
      const toWorker = findWorker(toWorkerId)
      const toName = toWorker?.full_name ?? 'operator'
      const fromName = fromWorker?.full_name ?? 'operator'

      const result = await performPush(task, fromWorkerId, toWorkerId)

      if (!result.success) {
        toast.error(`Couldn't reassign ${task.count_number} to ${toName}.`, {
          description:
            'The work service rejected the push — the task may have completed or been re-assigned by another supervisor in the meantime.',
        })
        return
      }

      // Success: surface the Undo affordance. Sonner's `action` API
      // gives us a button; we keep our own bookkeeping in `pendingRef`
      // so the timer can be cancelled if the supervisor undoes
      // before the window closes.
      const undoKey = `${task.id}::${fromWorkerId}::${toWorkerId}`
      const previousPending = pendingRef.current.get(undoKey)
      if (
        previousPending?.timeoutId !== undefined &&
        previousPending?.timeoutId !== null
      ) {
        clearTimeout(previousPending.timeoutId)
      }

      const timeoutId = setTimeout(() => {
        pendingRef.current.delete(undoKey)
      }, CROSS_LANE_UNDO_TIMEOUT_MS)

      pendingRef.current.set(undoKey, {
        taskId: task.id,
        countNumber: task.count_number,
        fromWorkerId,
        fromWorkerName: fromName,
        toWorkerId,
        toWorkerName: toName,
        timeoutId,
      })

      toast.success(`${task.count_number} moved to ${toName}.`, {
        duration: CROSS_LANE_UNDO_TIMEOUT_MS,
        action: {
          label: 'Undo',
          onClick: async () => {
            const pending = pendingRef.current.get(undoKey)
            if (!pending) return
            if (pending.timeoutId !== null) clearTimeout(pending.timeoutId)
            pendingRef.current.delete(undoKey)
            const undo = await performPush(task, toWorkerId, fromWorkerId)
            if (undo.success) {
              toast.success(
                `Undone — ${task.count_number} returned to ${fromName}.`
              )
            } else {
              toast.error(
                `Undo failed — ${task.count_number} stayed with ${toName}.`
              )
            }
          },
        },
      })
      logger.debug(
        `[useCrossLaneReassign] ${task.count_number} ${fromWorkerId} -> ${toWorkerId} (undo key ${undoKey})`
      )
    },
    [findWorker, performPush]
  )

  return { reassign }
}

// Created and developed by Jai Singh
