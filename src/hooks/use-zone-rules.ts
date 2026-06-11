// Created and developed by Jai Singh
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  deleteZoneAssignment,
  getZoneRules,
  listActiveZones,
  listOrgUsersForZoneAssignment,
  listZoneAssignments,
  releaseAllStuckAssignments,
  releaseStuckAssignment,
  subscribeToActiveZones,
  upsertZoneAssignment,
  upsertZoneRules,
  type ActiveZone,
  type OrgUserOption,
  type ZoneAssignment,
  type ZoneRules,
  type ZoneRulesUpdate,
} from '@/lib/supabase/zone-rules.service'

// Migration 253 review: query keys exported so cross-feature mutations
// (e.g. `useCycleCountOperations.assign/unassign/priority`) can invalidate
// the zone caches when the dashboard changes ownership of a row.
export const ZONE_RULES_QUERY_KEY = ['cycle-count-zone-rules'] as const
export const ACTIVE_ZONES_QUERY_KEY = ['cycle-count-active-zones'] as const
export const ZONE_ASSIGNMENTS_QUERY_KEY = [
  'cycle-count-zone-assignments',
] as const
const ORG_USERS_QUERY_KEY = ['cycle-count-zone-org-users'] as const

export interface UseZoneRulesReturn {
  rules: ZoneRules | null
  isLoading: boolean
  isSaving: boolean
  save: (updates: ZoneRulesUpdate) => Promise<void>
  refetch: () => Promise<void>
}

export function useZoneRules(): UseZoneRulesReturn {
  const queryClient = useQueryClient()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ZONE_RULES_QUERY_KEY,
    queryFn: getZoneRules,
    staleTime: 30_000,
  })

  const mutation = useMutation({
    mutationFn: upsertZoneRules,
    onSuccess: (saved) => {
      queryClient.setQueryData(ZONE_RULES_QUERY_KEY, saved)
      // Active-zones view may flip because the policy just changed.
      queryClient.invalidateQueries({ queryKey: ACTIVE_ZONES_QUERY_KEY })
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : 'Failed to save zone rules'
      toast.error(msg)
    },
  })

  const save = useCallback(
    async (updates: ZoneRulesUpdate) => {
      await mutation.mutateAsync(updates)
    },
    [mutation]
  )

  const manualRefetch = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    rules: data ?? null,
    isLoading,
    isSaving: mutation.isPending,
    save,
    refetch: manualRefetch,
  }
}

export interface UseActiveZonesReturn {
  zones: ActiveZone[]
  onlineZones: ActiveZone[]
  stuckZones: ActiveZone[]
  isLoading: boolean
  refetch: () => Promise<void>
  /**
   * Release a single stuck assignment. Default (soft): keeps `assigned_to`
   * so the original assignee retains priority. `{ hard: true }` clears the
   * assignment so the row returns to the general pool.
   */
  releaseStuck: (countId: string, opts?: { hard?: boolean }) => Promise<void>
  /**
   * Bulk release. `{ hard: true }` clears assignments too.
   */
  releaseAllStuck: (
    thresholdMinutes?: number,
    opts?: { hard?: boolean }
  ) => Promise<{ released: number }>
  isReleasing: boolean
}

/**
 * Live list of zones currently locked by counters. Subscribes to
 * rr_cyclecount_data realtime events so the UI stays in sync.
 *
 * Exposes `onlineZones` (owner currently online) and `stuckZones`
 * (operator offline > 10 min — admin should release).
 */
export function useActiveZones(): UseActiveZonesReturn {
  const queryClient = useQueryClient()
  const { data, isLoading, refetch } = useQuery({
    queryKey: ACTIVE_ZONES_QUERY_KEY,
    queryFn: listActiveZones,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })

  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    unsubRef.current = subscribeToActiveZones((zones) => {
      queryClient.setQueryData(ACTIVE_ZONES_QUERY_KEY, zones)
    })
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [queryClient])

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ACTIVE_ZONES_QUERY_KEY })
  }, [queryClient])

  const releaseMutation = useMutation({
    mutationFn: ({
      countId,
      alsoUnassign,
    }: {
      countId: string
      alsoUnassign: boolean
    }) => releaseStuckAssignment(countId, alsoUnassign),
    onSuccess: (res) => {
      if (res.success) invalidate()
      else if (res.error) toast.error(res.error)
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to release assignment'
      )
    },
  })

  const bulkReleaseMutation = useMutation({
    mutationFn: ({
      thresholdMinutes,
      alsoUnassign,
    }: {
      thresholdMinutes: number
      alsoUnassign: boolean
    }) => releaseAllStuckAssignments(thresholdMinutes, alsoUnassign),
    onSuccess: (res) => {
      if (res.success) invalidate()
      else if (res.error) toast.error(res.error)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to bulk-release')
    },
  })

  const releaseStuck = useCallback(
    async (countId: string, opts?: { hard?: boolean }) => {
      const hard = opts?.hard === true
      const res = await releaseMutation.mutateAsync({
        countId,
        alsoUnassign: hard,
      })
      if (res.success) {
        toast.success(
          hard
            ? 'Assignment cleared — back in the general queue.'
            : 'Released. Still reserved for the original assignee.'
        )
      }
    },
    [releaseMutation]
  )

  const releaseAllStuck = useCallback(
    async (thresholdMinutes = 10, opts?: { hard?: boolean }) => {
      const hard = opts?.hard === true
      const res = await bulkReleaseMutation.mutateAsync({
        thresholdMinutes,
        alsoUnassign: hard,
      })
      if (res.success) {
        const n = res.released ?? 0
        toast.success(
          n === 0
            ? 'No stuck assignments to release.'
            : hard
              ? `Cleared ${n} stuck assignment${n === 1 ? '' : 's'} back into the general queue.`
              : `Released ${n} stuck assignment${n === 1 ? '' : 's'}. Still reserved for original assignees.`
        )
        return { released: n }
      }
      return { released: 0 }
    },
    [bulkReleaseMutation]
  )

  const zones = data ?? []
  // Actively counting (owner online + has in-progress/recount rows).
  const onlineZones = zones.filter((z) => z.owner_online && z.has_active)
  // Stuck: owner offline + has reserved or active rows.
  const stuckZones = zones.filter((z) => z.is_stuck)

  const manualRefetch = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    zones,
    onlineZones,
    stuckZones,
    isLoading,
    refetch: manualRefetch,
    releaseStuck,
    releaseAllStuck,
    isReleasing: releaseMutation.isPending || bulkReleaseMutation.isPending,
  }
}

// ---------------------------------------------------------------------------
// Zone Assignments
// ---------------------------------------------------------------------------

export interface UseZoneAssignmentsReturn {
  assignments: ZoneAssignment[]
  isLoading: boolean
  isMutating: boolean
  save: (params: {
    zone: string
    user_id: string
    notes?: string | null
  }) => Promise<ZoneAssignment | null>
  remove: (zone: string) => Promise<void>
  refetch: () => Promise<void>
}

export function useZoneAssignments(): UseZoneAssignmentsReturn {
  const queryClient = useQueryClient()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ZONE_ASSIGNMENTS_QUERY_KEY,
    queryFn: listZoneAssignments,
    staleTime: 20_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ZONE_ASSIGNMENTS_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: ACTIVE_ZONES_QUERY_KEY })
  }

  const upsertMutation = useMutation({
    mutationFn: upsertZoneAssignment,
    onSuccess: invalidate,
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save zone assignment'
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteZoneAssignment,
    onSuccess: invalidate,
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to remove zone assignment'
      )
    },
  })

  const save = useCallback(
    async (params: { zone: string; user_id: string; notes?: string | null }) =>
      await upsertMutation.mutateAsync(params),
    [upsertMutation]
  )

  const remove = useCallback(
    async (zone: string) => {
      await deleteMutation.mutateAsync(zone)
    },
    [deleteMutation]
  )

  const manualRefetch = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    assignments: data ?? [],
    isLoading,
    isMutating: upsertMutation.isPending || deleteMutation.isPending,
    save,
    remove,
    refetch: manualRefetch,
  }
}

export function useOrgUsersForZoneAssignment(): {
  users: OrgUserOption[]
  isLoading: boolean
} {
  const { data, isLoading } = useQuery({
    queryKey: ORG_USERS_QUERY_KEY,
    queryFn: listOrgUsersForZoneAssignment,
    staleTime: 60_000,
  })
  return { users: data ?? [], isLoading }
}

/**
 * Convenience: returns a stable Set of zone strings currently locked by
 * OTHER users than `me`. Useful for row-level "zone busy" rendering.
 */
export function useZonesLockedByOthers(me: string | null | undefined): {
  lockedZones: Set<string>
  zoneOwners: Map<string, ActiveZone>
  isLoading: boolean
} {
  const { zones, isLoading } = useActiveZones()
  const [lockedZones, setLockedZones] = useState<Set<string>>(new Set())
  const [zoneOwners, setZoneOwners] = useState<Map<string, ActiveZone>>(
    new Map()
  )

  useEffect(() => {
    const next = new Set<string>()
    const owners = new Map<string, ActiveZone>()
    for (const z of zones) {
      if (me && z.locked_by === me) continue
      next.add(z.zone)
      owners.set(z.zone, z)
    }
    setLockedZones(next)
    setZoneOwners(owners)
  }, [zones, me])

  return { lockedZones, zoneOwners, isLoading }
}

// Created and developed by Jai Singh
