import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DeviceManagerService } from '@/lib/supabase/device-manager.service'
import type { MdmDevice } from '../types/device-manager.types'

const DEVICE_KEYS = {
  all: ['mdm-devices'] as const,
  list: (filters: Record<string, unknown>) =>
    [...DEVICE_KEYS.all, 'list', filters] as const,
  detail: (id: string) => [...DEVICE_KEYS.all, 'detail', id] as const,
  statistics: ['mdm-fleet-statistics'] as const,
  groups: ['mdm-device-groups'] as const,
}

export function useDeviceList(params: {
  search?: string
  status?: string
  groupId?: string
  page?: number
  perPage?: number
}) {
  const offset = ((params.page || 1) - 1) * (params.perPage || 25)
  return useQuery({
    queryKey: DEVICE_KEYS.list(params),
    queryFn: () =>
      DeviceManagerService.searchDevices({
        search: params.search,
        status: params.status,
        groupId: params.groupId,
        limit: params.perPage || 25,
        offset,
      }),
    staleTime: 30_000,
  })
}

export function useDeviceDetail(deviceId: string | null) {
  return useQuery({
    queryKey: DEVICE_KEYS.detail(deviceId || ''),
    queryFn: () => DeviceManagerService.getDevice(deviceId!),
    enabled: !!deviceId,
    staleTime: 15_000,
  })
}

export function useFleetStatistics() {
  return useQuery({
    queryKey: DEVICE_KEYS.statistics,
    queryFn: DeviceManagerService.getFleetStatistics,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useDeviceGroups() {
  return useQuery({
    queryKey: DEVICE_KEYS.groups,
    queryFn: DeviceManagerService.getDeviceGroups,
    staleTime: 120_000,
  })
}

export function useUpdateDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      deviceId,
      updates,
    }: {
      deviceId: string
      updates: Partial<MdmDevice>
    }) => DeviceManagerService.updateDevice(deviceId, updates),
    onSuccess: (_, { deviceId }) => {
      queryClient.invalidateQueries({ queryKey: DEVICE_KEYS.detail(deviceId) })
      queryClient.invalidateQueries({ queryKey: DEVICE_KEYS.all })
    },
  })
}
