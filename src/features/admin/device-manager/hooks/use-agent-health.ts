// Created and developed by Jai Singh
import { useQuery } from '@tanstack/react-query'
import { DeviceManagerService } from '@/lib/supabase/device-manager.service'

export function useIncidents(params: { status?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: ['mdm-incidents', params],
    queryFn: () => DeviceManagerService.getIncidents(params),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useWorkflows() {
  return useQuery({
    queryKey: ['mdm-workflows'],
    queryFn: DeviceManagerService.getWorkflows,
    staleTime: 60_000,
  })
}

export function useProfiles() {
  return useQuery({
    queryKey: ['mdm-profiles'],
    queryFn: DeviceManagerService.getProfiles,
    staleTime: 60_000,
  })
}

export function useApps() {
  return useQuery({
    queryKey: ['mdm-apps'],
    queryFn: DeviceManagerService.getApps,
    staleTime: 60_000,
  })
}

// Created and developed by Jai Singh
