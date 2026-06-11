// Created and developed by Jai Singh
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  applyPriorityRules,
  deletePriorityRule,
  listPriorityRules,
  upsertPriorityRule,
  type PriorityRule,
  type PriorityRuleUpsert,
} from '@/lib/supabase/priority-rules.service'
import {
  CYCLE_COUNT_OPERATIONS_QUERY_KEY,
  CYCLE_COUNT_STATISTICS_QUERY_KEY,
} from '@/hooks/use-cycle-count-operations'

const PRIORITY_RULES_QUERY_KEY = ['cycle-count-priority-rules'] as const

export interface UsePriorityRulesReturn {
  rules: PriorityRule[]
  isLoading: boolean
  isMutating: boolean
  isApplying: boolean
  save: (rule: PriorityRuleUpsert) => Promise<PriorityRule | null>
  remove: (id: string) => Promise<void>
  apply: () => Promise<{ touched: number }>
  refetch: () => Promise<void>
}

export function usePriorityRules(): UsePriorityRulesReturn {
  const queryClient = useQueryClient()

  const { data, isLoading, refetch } = useQuery({
    queryKey: PRIORITY_RULES_QUERY_KEY,
    queryFn: listPriorityRules,
    staleTime: 30_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: PRIORITY_RULES_QUERY_KEY })
  }

  const upsertMutation = useMutation({
    mutationFn: upsertPriorityRule,
    onSuccess: invalidate,
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : 'Failed to save priority rule'
      ),
  })

  const deleteMutation = useMutation({
    mutationFn: deletePriorityRule,
    onSuccess: invalidate,
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete priority rule'
      ),
  })

  const applyMutation = useMutation({
    mutationFn: applyPriorityRules,
    onSuccess: (res) => {
      // After re-scoring, the cycle counts grid + stats need to refresh so
      // priority chips reflect the new ranking immediately.
      if (res.success && (res.touched ?? 0) > 0) {
        queryClient.invalidateQueries({
          queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
        })
        queryClient.invalidateQueries({
          queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
        })
      }
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : 'Failed to apply priority rules'
      ),
  })

  const save = useCallback(
    async (rule: PriorityRuleUpsert) => await upsertMutation.mutateAsync(rule),
    [upsertMutation]
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteMutation.mutateAsync(id)
    },
    [deleteMutation]
  )

  const apply = useCallback(async () => {
    const res = await applyMutation.mutateAsync()
    if (res.success) {
      toast.success(
        res.touched
          ? `Re-scored ${res.touched} count${res.touched === 1 ? '' : 's'}.`
          : 'No priorities needed changing.'
      )
      return { touched: res.touched ?? 0 }
    }
    if (res.error) toast.error(res.error)
    return { touched: 0 }
  }, [applyMutation])

  const manualRefetch = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    rules: data ?? [],
    isLoading,
    isMutating: upsertMutation.isPending || deleteMutation.isPending,
    isApplying: applyMutation.isPending,
    save,
    remove,
    apply,
    refetch: manualRefetch,
  }
}

// Created and developed by Jai Singh
