// Created and developed by Jai Singh
/**
 * useWorkOperations — generic supervisor-side queue hook over `work_tasks`
 * (Phase 6.3). Wraps `workService.list`, mass-delete, mass-approve, and
 * priority change with React Query semantics.
 *
 * `useCycleCountOperations` (Phase 6.3 reshape) is expected to internally
 * delegate list/get/reassign here while keeping count-only operations
 * (start recount, approve variance, CSV import) in its own surface.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import {
  workService,
  type ListWorkTasksFilter,
} from '@/lib/supabase/work.service'
import type { WorkTask } from '@/lib/work-service/work-task-types'

export interface UseWorkOperations {
  tasks: WorkTask[]
  isLoading: boolean
  error: Error | null
  refresh: () => void
  massDelete: (ids: string[]) => Promise<number>
  massApprove: (ids: string[]) => Promise<number>
}

export function useWorkOperations(
  filter: ListWorkTasksFilter
): UseWorkOperations {
  const [tasks, setTasks] = useState<WorkTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    workService
      .list(filter)
      .then((rows) => {
        if (!cancelled) setTasks(rows)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)))
      })
      .finally(() => !cancelled && setIsLoading(false))

    const ch = supabase
      .channel(`work_tasks_use_ops_${filter.organization_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_tasks',
          filter: `organization_id=eq.${filter.organization_id}`,
        },
        () => setTick((t) => t + 1)
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(ch)
    }
  }, [
    filter.organization_id,
    filter.task_type,
    filter.status,
    filter.priority,
    filter.assigned_to,
    filter.warehouse,
    filter.limit,
    filter.offset,
    tick,
  ])

  const massDelete = useCallback(
    (ids: string[]) => workService.massDelete(ids, filter.organization_id),
    [filter.organization_id]
  )
  const massApprove = useCallback(
    (ids: string[]) =>
      workService.massApproveVariance(ids, filter.organization_id),
    [filter.organization_id]
  )

  return {
    tasks,
    isLoading,
    error,
    refresh: () => setTick((t) => t + 1),
    massDelete,
    massApprove,
  }
}

// Created and developed by Jai Singh
