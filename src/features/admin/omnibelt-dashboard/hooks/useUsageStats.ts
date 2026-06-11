// Created and developed by Jai Singh
/**
 * useUsageStats — telemetry reads for the Overview + Analytics tabs.
 *
 * Three independent queries so each can refetch / suspend on its
 * own timeline:
 *   - `useEvents24h()`  — 24h MV; cheap; staleTime 60s.
 *   - `useRecentEvents(limit)` — last N raw events; staleTime 30s.
 *   - `usePrefsAggregate()` — best-effort prefs counts (RLS may
 *     restrict to self-only; surfaces an empty result silently).
 *
 * All reads route through `supabaseRead`. `refetchInterval` is 60s
 * and gated on `document.visibilityState === 'visible'` so the
 * dashboard stops polling when the tab is backgrounded — matches
 * the polling-discipline posture in
 * `ADR-Scaling-Roadmap-To-100k-Concurrent`.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { OmnibeltToolEvent } from '@/lib/supabase/database.types'
import {
  omnibeltAdminService,
  type EventBucket,
  type PrefsAggregate,
} from '../services/omnibelt-admin.service'

export const OMNIBELT_EVENTS_24H_KEY = [
  'omnibelt',
  'admin',
  'events24h',
] as const
export const OMNIBELT_RECENT_EVENTS_KEY = [
  'omnibelt',
  'admin',
  'recentEvents',
] as const
export const OMNIBELT_PREFS_AGGREGATE_KEY = [
  'omnibelt',
  'admin',
  'prefsAggregate',
] as const

const VISIBILITY_INTERVAL_MS = 60_000

function activeRefetchInterval(): number | false {
  if (typeof document === 'undefined') return VISIBILITY_INTERVAL_MS
  return document.visibilityState === 'visible' ? VISIBILITY_INTERVAL_MS : false
}

export function useEvents24h(): UseQueryResult<EventBucket[]> {
  const { authState } = useUnifiedAuth()
  const orgId = authState.profile?.organization_id ?? null
  return useQuery<EventBucket[]>({
    queryKey: [...OMNIBELT_EVENTS_24H_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: () => omnibeltAdminService.getEventsLast24h(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: activeRefetchInterval,
    refetchIntervalInBackground: false,
    retry: 1,
  })
}

export function useRecentEvents(
  limit = 50
): UseQueryResult<OmnibeltToolEvent[]> {
  const { authState } = useUnifiedAuth()
  const orgId = authState.profile?.organization_id ?? null
  return useQuery<OmnibeltToolEvent[]>({
    queryKey: [...OMNIBELT_RECENT_EVENTS_KEY, orgId, limit],
    enabled: Boolean(orgId),
    queryFn: () => omnibeltAdminService.getRecentEvents(limit),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: activeRefetchInterval,
    refetchIntervalInBackground: false,
    retry: 1,
  })
}

export function usePrefsAggregate(): UseQueryResult<PrefsAggregate> {
  const { authState } = useUnifiedAuth()
  const orgId = authState.profile?.organization_id ?? null
  return useQuery<PrefsAggregate>({
    queryKey: [...OMNIBELT_PREFS_AGGREGATE_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: () => omnibeltAdminService.getPrefsAggregate(),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

// Created and developed by Jai Singh
