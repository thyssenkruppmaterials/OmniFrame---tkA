// Created and developed by Jai Singh
import { useQuery } from '@tanstack/react-query'
import {
  RailwayMonitoringService,
  type LogKind,
} from '../services/railway-monitoring.service'

const RAILWAY_KEYS = {
  all: ['railway-monitoring'] as const,
  overview: () => [...RAILWAY_KEYS.all, 'overview'] as const,
  runtimeLogs: (serviceId?: string, filter?: string) =>
    [
      ...RAILWAY_KEYS.all,
      'runtime-logs',
      serviceId ?? 'all',
      filter ?? '',
    ] as const,
  deployments: (serviceId: string) =>
    [...RAILWAY_KEYS.all, 'deployments', serviceId] as const,
  deploymentLogs: (deploymentId: string, kind: LogKind) =>
    [...RAILWAY_KEYS.all, 'deployment-logs', deploymentId, kind] as const,
}

export function useRailwayOverview() {
  return useQuery({
    queryKey: RAILWAY_KEYS.overview(),
    queryFn: () => RailwayMonitoringService.getOverview(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useRailwayRuntimeLogs(params: {
  serviceId?: string
  filter?: string
  limit?: number
  refetchInterval?: number | false
  enabled?: boolean
}) {
  return useQuery({
    queryKey: RAILWAY_KEYS.runtimeLogs(params.serviceId, params.filter),
    queryFn: () =>
      RailwayMonitoringService.getRuntimeLogs({
        serviceId: params.serviceId,
        filter: params.filter,
        limit: params.limit ?? 500,
      }),
    staleTime: 2_000,
    refetchInterval: params.refetchInterval ?? 5_000,
    enabled: params.enabled ?? true,
  })
}

export function useRailwayDeployments(serviceId: string, enabled = true) {
  return useQuery({
    queryKey: RAILWAY_KEYS.deployments(serviceId),
    queryFn: () =>
      RailwayMonitoringService.getDeployments({ serviceId, limit: 10 }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: !!serviceId && enabled,
  })
}

export function useRailwayDeploymentLogs(
  deploymentId: string,
  kind: LogKind = 'runtime',
  enabled = true
) {
  return useQuery({
    queryKey: RAILWAY_KEYS.deploymentLogs(deploymentId, kind),
    queryFn: () =>
      RailwayMonitoringService.getDeploymentLogs({
        deploymentId,
        kind,
        limit: 1000,
      }),
    staleTime: 5_000,
    refetchInterval: 5_000,
    enabled: !!deploymentId && enabled,
  })
}

// Created and developed by Jai Singh
