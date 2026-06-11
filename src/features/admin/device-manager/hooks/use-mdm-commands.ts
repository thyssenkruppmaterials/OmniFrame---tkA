// Created and developed by Jai Singh
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DeviceManagerService } from '@/lib/supabase/device-manager.service'
import type { MdmCommandType } from '../types/device-manager.types'

const COMMAND_KEYS = {
  all: ['mdm-commands'] as const,
  list: (filters: Record<string, unknown>) =>
    [...COMMAND_KEYS.all, 'list', filters] as const,
  metrics: (days: number) => [...COMMAND_KEYS.all, 'metrics', days] as const,
  approvals: ['mdm-command-approvals'] as const,
  templates: ['mdm-command-templates'] as const,
}

export function useCommandList(params: {
  deviceId?: string
  status?: string
  page?: number
  perPage?: number
}) {
  const limit = params.perPage || 25
  const offset = ((params.page || 1) - 1) * limit
  return useQuery({
    queryKey: COMMAND_KEYS.list(params),
    queryFn: () =>
      DeviceManagerService.getCommands({
        deviceId: params.deviceId,
        status: params.status,
        limit,
        offset,
      }),
    staleTime: 15_000,
  })
}

export function useCommandMetrics(days = 7) {
  return useQuery({
    queryKey: COMMAND_KEYS.metrics(days),
    queryFn: () => DeviceManagerService.getCommandMetrics(days),
    staleTime: 60_000,
  })
}

export function useQueueCommand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: {
      deviceId: string
      commandType: MdmCommandType
      payload?: Record<string, unknown>
      priority?: number
      scheduledAt?: string
    }) => DeviceManagerService.queueCommand(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMMAND_KEYS.all })
    },
  })
}

export function useCommandApprovals() {
  return useQuery({
    queryKey: COMMAND_KEYS.approvals,
    queryFn: () => DeviceManagerService.getCommandApprovals(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

export function useApproveCommand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: {
      approvalId: string
      approved: boolean
      reason?: string
    }) =>
      DeviceManagerService.approveCommand(
        params.approvalId,
        params.approved,
        params.reason
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMMAND_KEYS.approvals })
      queryClient.invalidateQueries({ queryKey: COMMAND_KEYS.all })
    },
  })
}

export function useCommandTemplates() {
  return useQuery({
    queryKey: COMMAND_KEYS.templates,
    queryFn: DeviceManagerService.getCommandTemplates,
    staleTime: 120_000,
  })
}

// Created and developed by Jai Singh
