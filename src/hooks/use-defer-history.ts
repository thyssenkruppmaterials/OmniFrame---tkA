// Created and developed by Jai Singh
/**
 * Defer history hooks
 *
 * React Query wrappers around `DeferHistoryService` (migration 269).
 * Designed for LAZY consumption by the Inventory Counts dashboard:
 *   - `useDeferHistoryForCount(countId, enabled)` powers the popover on
 *     the Skipped badge and the Skip/Defer History section in
 *     `EditCountModal`. Disabled by default (`enabled` flag).
 *   - `useDistinctDeferUsers(enabled)` populates the "Deferred by"
 *     multi-select filter; only fetched when the dropdown opens.
 *   - `useDeferHistoryForOrg(opts)` is the lower-level escape hatch used
 *     when the filter intersects with the dashboard rows.
 *
 * Stale-time defaults are conservative (60s) — defer activity is
 * low-frequency and the WS path doesn't broadcast defer events today.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  deferHistoryService,
  type DeferHistoryEntry,
  type DeferHistoryFilter,
} from '@/lib/supabase/defer-history.service'

export const DEFER_HISTORY_QUERY_KEY = 'defer-history'
export const DEFER_HISTORY_USERS_QUERY_KEY = 'defer-history-users'
export const DEFER_HISTORY_ORG_QUERY_KEY = 'defer-history-org'

export function useDeferHistoryForCount(
  countId: string | null | undefined,
  enabled: boolean = true
): UseQueryResult<DeferHistoryEntry[], Error> {
  return useQuery({
    queryKey: [DEFER_HISTORY_QUERY_KEY, countId],
    enabled: !!countId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (!countId) return []
      const { data, error } = await deferHistoryService.fetchForCount(countId)
      if (error) throw error
      return data
    },
  })
}

export interface DistinctDeferUser {
  user_id: string
  user_full_name: string | null
  user_email: string | null
  latest_deferred_at: string
}

export function useDistinctDeferUsers(
  enabled: boolean = false,
  opts: { includeCleared?: boolean } = {}
): UseQueryResult<DistinctDeferUser[], Error> {
  const { includeCleared } = opts
  return useQuery({
    queryKey: [DEFER_HISTORY_USERS_QUERY_KEY, !!includeCleared],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await deferHistoryService.fetchDistinctUsers({
        includeCleared,
      })
      if (error) throw error
      return data
    },
  })
}

export function useDeferHistoryForOrg(
  opts: DeferHistoryFilter,
  enabled: boolean = false
): UseQueryResult<DeferHistoryEntry[], Error> {
  const { userIds, countId, includeCleared, since, until, limit } = opts
  return useQuery({
    queryKey: [
      DEFER_HISTORY_ORG_QUERY_KEY,
      userIds,
      countId ?? '',
      includeCleared ?? true,
      since ?? '',
      until ?? '',
      limit ?? 0,
    ],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await deferHistoryService.fetchForOrg({
        userIds,
        countId,
        includeCleared,
        since,
        until,
        limit,
      })
      if (error) throw error
      return data
    },
  })
}

// Created and developed by Jai Singh
