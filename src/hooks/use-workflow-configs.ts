// Created and developed by Jai Singh
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  workflowConfigService,
  type WorkflowConfig,
  type WorkflowStepConfig,
} from '@/lib/supabase/workflow-config.service'
import { logger } from '@/lib/utils/logger'

export const WORKFLOW_CONFIGS_QUERY_KEY = 'workflow-configs'

export function useWorkflowConfigs() {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  const {
    data: configs = [],
    isLoading,
    error,
    refetch: refetchConfigs,
  } = useQuery({
    queryKey: [WORKFLOW_CONFIGS_QUERY_KEY, organizationId],
    queryFn: async () => {
      const result = await workflowConfigService.fetchConfigs()
      if (result.error) {
        throw new Error(
          result.error instanceof Error
            ? result.error.message
            : 'Failed to fetch workflow configs'
        )
      }
      return result.data
    },
    staleTime: 60000, // 1 min
    enabled: !!organizationId,
  })

  const upsertMutation = useMutation({
    mutationFn: async (config: {
      count_type: string
      display_name: string
      description?: string
      is_active: boolean
      steps: WorkflowStepConfig[]
    }) => {
      const result = await workflowConfigService.upsertConfig(config)
      if (!result.success) {
        throw new Error(
          result.error instanceof Error
            ? result.error.message
            : 'Failed to upsert workflow config'
        )
      }
      return result.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [WORKFLOW_CONFIGS_QUERY_KEY, organizationId],
      })
      toast.success('Workflow config saved successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to save workflow config: ${error.message}`)
      logger.error('Upsert workflow config error:', error)
    },
  })

  const resetMutation = useMutation({
    mutationFn: async (countType: string) => {
      const result = await workflowConfigService.resetToDefault(countType)
      if (!result.success) {
        throw new Error(
          result.error instanceof Error
            ? result.error.message
            : 'Failed to reset workflow config'
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [WORKFLOW_CONFIGS_QUERY_KEY, organizationId],
      })
      toast.success('Workflow config reset to default')
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset workflow config: ${error.message}`)
      logger.error('Reset workflow config error:', error)
    },
  })

  const upsertConfig = useCallback(
    async (config: {
      count_type: string
      display_name: string
      description?: string
      is_active: boolean
      steps: WorkflowStepConfig[]
    }) => {
      await upsertMutation.mutateAsync(config)
    },
    [upsertMutation]
  )

  const resetConfig = useCallback(
    async (countType: string) => {
      await resetMutation.mutateAsync(countType)
    },
    [resetMutation]
  )

  const getConfigForCountType = useCallback(
    (countType: string): WorkflowConfig | undefined =>
      configs.find((c) => c.count_type === countType),
    [configs]
  )

  const refreshConfigs = useCallback(() => {
    refetchConfigs()
  }, [refetchConfigs])

  return {
    configs,
    isLoading,
    error: error as Error | null,
    upsertConfig,
    resetConfig,
    getConfigForCountType,
    refreshConfigs,
  }
}

// Created and developed by Jai Singh
