// Created and developed by Jai Singh
import { useQuery } from '@tanstack/react-query'
import { DeviceManagerService } from '@/lib/supabase/device-manager.service'

export function useCompliancePolicies() {
  return useQuery({
    queryKey: ['mdm-compliance-policies'],
    queryFn: DeviceManagerService.getCompliancePolicies,
    staleTime: 120_000,
  })
}

export function useComplianceViolations(
  params: { status?: string; limit?: number } = {}
) {
  return useQuery({
    queryKey: ['mdm-compliance-violations', params],
    queryFn: () => DeviceManagerService.getViolations(params),
    staleTime: 30_000,
  })
}

// Created and developed by Jai Singh
