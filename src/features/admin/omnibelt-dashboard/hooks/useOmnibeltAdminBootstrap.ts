// Created and developed by Jai Singh
/**
 * useOmnibeltAdminBootstrap — aggregate bootstrap query for the
 * admin dashboard.
 *
 * One TanStack Query pulls everything the dashboard's "always-on"
 * surfaces (header + Overview cards) need in a single round trip.
 * Per-tab heavier reads (24h MV, recent events, prefs aggregate)
 * live in their own dedicated hooks so each tab can refetch
 * independently.
 *
 * Cache budget: 60s staleTime (matches the analytics polling
 * cadence), 5min gcTime. No refetchInterval — the dashboard
 * exposes a "Reload" button that calls `queryClient.invalidateQueries`
 * with this hook's key, and the workServiceWs invalidator
 * (`useOmnibeltConfigInvalidator`, mounted by `OmniBeltHost`)
 * already wakes us when an admin elsewhere writes config.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { OmnibeltRoleConfig } from '@/lib/supabase/database.types'
import {
  omnibeltAdminService,
  type KillSwitchRow,
  type RoleRow,
} from '../services/omnibelt-admin.service'

export interface OmnibeltAdminBootstrap {
  killSwitch: KillSwitchRow
  allowList: string[] | null
  roles: RoleRow[]
  roleConfigs: OmnibeltRoleConfig[]
  activeUsersLast5m: number
}

export const OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY = [
  'omnibelt',
  'admin',
  'bootstrap',
] as const

export function useOmnibeltAdminBootstrap(): UseQueryResult<OmnibeltAdminBootstrap> {
  const { authState } = useUnifiedAuth()
  const isAuthenticated = authState.isAuthenticated
  const orgId = authState.profile?.organization_id ?? null

  return useQuery<OmnibeltAdminBootstrap>({
    queryKey: [...OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY, orgId],
    enabled: isAuthenticated && Boolean(orgId),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    queryFn: async () => {
      const [killSwitch, allowList, roles, roleConfigs, activeUsersLast5m] =
        await Promise.all([
          omnibeltAdminService.getKillSwitch(),
          omnibeltAdminService.getAllowList(),
          omnibeltAdminService.getRoles(),
          omnibeltAdminService.getRoleConfigs(),
          omnibeltAdminService.getActiveUsersLast5m().catch(() => 0),
        ])
      return {
        killSwitch,
        allowList,
        roles,
        roleConfigs,
        activeUsersLast5m,
      }
    },
  })
}

// Created and developed by Jai Singh
