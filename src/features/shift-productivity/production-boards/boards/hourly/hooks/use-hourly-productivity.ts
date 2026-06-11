// Created and developed by Jai Singh
import { useCallback, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService from '@/lib/supabase/labor-management.service'
import TeamPerformanceService, {
  type ShiftAssignmentDetailRow,
} from '@/lib/supabase/team-performance.service'
import { logger } from '@/lib/utils/logger'
import { useShiftProductivitySettings } from '@/hooks/use-shift-productivity-settings'
import {
  bucketEventsByHour,
  collectDemonstratedSkills,
  effectiveTargetForBucket,
  getCurrentHour,
  getHourCellState,
  isHourWithinShift,
  parseClockTime,
  summariseBucket,
} from '../lib/hour-bucket'
import {
  deriveAreaColor,
  mapPositionToSkill,
  type AreaColorKey,
  type SkillId,
} from '../lib/skills'
import type {
  AssociateRow,
  HourBucket,
  HourCellState,
  HourTargets,
} from '../lib/types'

const PRODUCTION_BOARDS_QUERY_KEY = 'production-boards-hourly'

export interface ProductionBoardsFilters {
  workingAreaIds: string[]
  departments: string[]
  search: string
}

const EMPTY_FILTERS: ProductionBoardsFilters = {
  workingAreaIds: [],
  departments: [],
  search: '',
}

function isSameLocalDay(a: Date, b: Date, timezone: string): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(a) === fmt.format(b)
}

function formatDateString(date: Date, timezone: string): string {
  // ISO-style YYYY-MM-DD in the supplied tz.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(date)
}

function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible'
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const handler = (): void => {
      setVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return visible
}

interface ProductionBoardsResult {
  /** Roster filtered by the active filters (area, department, search). */
  associates: AssociateRow[]
  /** Roster unfiltered — used by the per-area tab strip for live counts. */
  allAssociates: AssociateRow[]
  hourBuckets: Map<string, Map<number, HourBucket>>
  workingAreas: Array<{
    id: string
    area_name: string
    area_code: string
    is_active: boolean
  }>
  departments: string[]
  hourTargets: HourTargets
  lastUpdatedAt: Date | null
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  selectedDate: Date
  setSelectedDate: (d: Date) => void
  goToToday: () => void
  filters: ProductionBoardsFilters
  updateFilters: (next: Partial<ProductionBoardsFilters>) => void
  clearFilters: () => void
  refresh: () => void
  timezone: string
  currentHour: number
  isToday: boolean
  getCellState: (userId: string, hour: number) => HourCellState
  getCellBucket: (userId: string, hour: number) => HourBucket | undefined
}

export function useHourlyProductivity(): ProductionBoardsResult {
  const { authState } = useUnifiedAuth()
  const { effectiveSettings } = useShiftProductivitySettings()
  const organizationId = authState.profile?.organization_id || ''
  const timezone = effectiveSettings.timezone || 'America/New_York'

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const [filters, setFilters] = useState<ProductionBoardsFilters>(EMPTY_FILTERS)
  const visible = useDocumentVisibility()

  const isToday = useMemo(
    () => isSameLocalDay(selectedDate, new Date(), timezone),
    [selectedDate, timezone]
  )

  const dateString = useMemo(
    () => formatDateString(selectedDate, timezone),
    [selectedDate, timezone]
  )

  // ===== Queries =====
  const associatesQuery = useQuery({
    queryKey: ['production-boards-associates', organizationId],
    queryFn: () => LaborManagementService.getActiveAssociates(organizationId),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  })

  const workingAreasQuery = useQuery({
    queryKey: ['working-areas', organizationId],
    queryFn: () => LaborManagementService.getWorkingAreas(organizationId),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  })

  const assignmentsQuery = useQuery({
    queryKey: ['production-boards-assignments', organizationId],
    queryFn: () =>
      TeamPerformanceService.getShiftAssignmentsRaw(organizationId),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  })

  const eventsQuery = useQuery({
    queryKey: [
      PRODUCTION_BOARDS_QUERY_KEY,
      organizationId,
      dateString,
      timezone,
    ],
    queryFn: () =>
      TeamPerformanceService.getActivityEventsForDate(
        organizationId,
        dateString,
        timezone
      ),
    enabled: !!organizationId,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    // v6 (2026-05-10): bumped from 30 s → 60 s now that there are six
    // boards stacked behind the global tab strip (each with its own 60 s
    // polling). The hourly grid is the busiest of the six and the polling
    // cost dominates total board-page traffic, so a single doubled cadence
    // here keeps the org-wide network footprint under the budget.
    refetchInterval: isToday && visible ? 60_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: isToday,
  })

  // ===== Build associates roster (org-scoped) =====
  // We compute the *intrinsic* row (with the associate's own area colour)
  // here so the roster is stable across filter changes. The active-area
  // colour override happens below so a single-area tab can recolour every
  // visible card to that area's accent.
  const intrinsicAssociates: AssociateRow[] = useMemo(() => {
    if (!associatesQuery.data) return []

    // Index assignments by user for shift start/end clock times.
    const byUserShift = new Map<
      string,
      { startMinutes: number | null; endMinutes: number | null }
    >()
    if (assignmentsQuery.data) {
      for (const a of assignmentsQuery.data as ShiftAssignmentDetailRow[]) {
        const start =
          parseClockTime(a.shift_start_time) ??
          parseClockTime(a.inline_shift_schedule?.start_time)
        const end =
          parseClockTime(a.shift_end_time) ??
          parseClockTime(a.inline_shift_schedule?.end_time)
        byUserShift.set(a.user_id, { startMinutes: start, endMinutes: end })
      }
    }

    const rows: AssociateRow[] = []
    for (const a of associatesQuery.data) {
      const shift = byUserShift.get(a.user_id)
      const positionTitle = a.position_title ?? null
      const workingAreaCode =
        (a as unknown as { working_areas?: { area_code?: string | null } })
          .working_areas?.area_code ?? null
      rows.push({
        userId: a.user_id,
        fullName: a.user_full_name ?? 'Unknown',
        email: a.user_email ?? null,
        avatarUrl:
          (a as unknown as { user_profiles?: { avatar_url?: string | null } })
            .user_profiles?.avatar_url ?? null,
        positionTitle,
        workingAreaId: a.working_area_id ?? null,
        workingAreaName: a.area_name ?? null,
        workingAreaCode,
        department:
          (a as unknown as { shift_positions?: { department?: string | null } })
            .shift_positions?.department ?? null,
        shiftStartMinutes: shift?.startMinutes ?? null,
        shiftEndMinutes: shift?.endMinutes ?? null,
        primarySkill: mapPositionToSkill(positionTitle),
        // Demonstrated skills get filled in once event buckets are built
        // — see the merge step below.
        demonstratedSkills: new Set<SkillId>(),
        areaColor: deriveAreaColor(workingAreaCode),
      })
    }
    return rows
  }, [associatesQuery.data, assignmentsQuery.data])

  // ===== Bucket events =====
  // Computed before the merged `associates` so we can fold each user's
  // demonstrated skills into their AssociateRow in a single pass.
  const hourBuckets = useMemo(() => {
    const out = new Map<string, Map<number, HourBucket>>()
    if (!eventsQuery.data) return out
    const raw = bucketEventsByHour(eventsQuery.data, timezone)
    for (const [userId, hourMap] of raw.entries()) {
      const summary = new Map<number, HourBucket>()
      for (const [hour, byType] of hourMap.entries()) {
        summary.set(hour, summariseBucket(hour, byType))
      }
      out.set(userId, summary)
    }
    return out
  }, [eventsQuery.data, timezone])

  // ===== Merge demonstrated skills + active-area colour override =====
  // Area-colour rule (also documented on AssociateRow.areaColor):
  //
  //   - All-Areas view (`workingAreaIds.length !== 1`) → keep each
  //     associate's intrinsic colour. The cards stay distinguishable
  //     across departments.
  //   - Single-area view (`workingAreaIds.length === 1`) → recolour every
  //     visible row to the active area's colour so the cards read as a
  //     cohesive tab.
  const associates: AssociateRow[] = useMemo(() => {
    const activeAreaOverride: AreaColorKey | null =
      filters.workingAreaIds.length === 1
        ? deriveAreaColor(
            workingAreasQuery.data?.find(
              (w) => w.id === filters.workingAreaIds[0]
            )?.area_code
          )
        : null

    if (intrinsicAssociates.length === 0) return intrinsicAssociates
    return intrinsicAssociates.map((row) => {
      const demonstratedSkills = collectDemonstratedSkills(
        hourBuckets.get(row.userId)
      )
      const areaColor = activeAreaOverride ?? row.areaColor
      // Cheap reference stability — if nothing changed, return the same
      // row object so React.memo'd children downstream don't rerender.
      if (
        demonstratedSkills.size === 0 &&
        row.demonstratedSkills.size === 0 &&
        row.areaColor === areaColor
      ) {
        return row
      }
      return { ...row, demonstratedSkills, areaColor }
    })
  }, [
    intrinsicAssociates,
    hourBuckets,
    filters.workingAreaIds,
    workingAreasQuery.data,
  ])

  // ===== Apply filters =====
  const filteredAssociates = useMemo(() => {
    let next = associates
    if (filters.workingAreaIds.length > 0) {
      const set = new Set(filters.workingAreaIds)
      next = next.filter(
        (a) => a.workingAreaId != null && set.has(a.workingAreaId)
      )
    }
    if (filters.departments.length > 0) {
      const set = new Set(filters.departments)
      next = next.filter((a) => a.department != null && set.has(a.department))
    }
    const search = filters.search.trim().toLowerCase()
    if (search.length > 0) {
      next = next.filter((a) => a.fullName.toLowerCase().includes(search))
    }
    next = [...next].sort((a, b) => a.fullName.localeCompare(b.fullName))
    return next
  }, [associates, filters])

  // ===== Hour targets from settings =====
  const hourTargets: HourTargets = useMemo(() => {
    const s = effectiveSettings
    return {
      inbound_scans: s.target_scans_per_hour ?? 30,
      put_aways: s.target_putaways_per_hour ?? 15,
      picking: s.target_picks_per_hour ?? 20,
      cycle_counts: s.target_cycle_counts_per_hour ?? 5,
      // Pick a reasonable middle-of-the-road default for unknown task types.
      default: s.target_picks_per_hour ?? 20,
    }
  }, [effectiveSettings])

  // ===== Per-cell helpers =====
  const getCellBucket = useCallback(
    (userId: string, hour: number): HourBucket | undefined => {
      return hourBuckets.get(userId)?.get(hour)
    },
    [hourBuckets]
  )

  const getCellState = useCallback(
    (userId: string, hour: number): HourCellState => {
      const associate = filteredAssociates.find((a) => a.userId === userId)
      const hasShift = associate
        ? isHourWithinShift(
            hour,
            associate.shiftStartMinutes,
            associate.shiftEndMinutes
          )
        : true
      const bucket = getCellBucket(userId, hour)
      const count = bucket?.total ?? 0
      const target = bucket
        ? effectiveTargetForBucket(bucket.byType, hourTargets)
        : hourTargets.default
      return getHourCellState({ count, target, hasShift })
    },
    [filteredAssociates, getCellBucket, hourTargets]
  )

  // ===== Departments derived from associates =====
  const departments = useMemo(() => {
    const set = new Set<string>()
    for (const a of associates) {
      if (a.department) set.add(a.department)
    }
    return Array.from(set).sort()
  }, [associates])

  // ===== Last updated bookkeeping =====
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  useEffect(() => {
    if (eventsQuery.dataUpdatedAt) {
      setLastUpdatedAt(new Date(eventsQuery.dataUpdatedAt))
    }
  }, [eventsQuery.dataUpdatedAt])

  // ===== Stable refs for actions =====
  const updateFilters = useCallback(
    (next: Partial<ProductionBoardsFilters>): void => {
      setFilters((prev) => ({ ...prev, ...next }))
    },
    []
  )

  const clearFilters = useCallback((): void => {
    setFilters(EMPTY_FILTERS)
  }, [])

  const refetchEvents = eventsQuery.refetch
  const refetchAssociates = associatesQuery.refetch
  const refetchAssignments = assignmentsQuery.refetch
  const refresh = useCallback((): void => {
    void refetchEvents()
    void refetchAssociates()
    void refetchAssignments()
  }, [refetchEvents, refetchAssociates, refetchAssignments])

  const goToToday = useCallback((): void => {
    setSelectedDate(new Date())
  }, [])

  const currentHour = useMemo(
    () => getCurrentHour(timezone),
    // selectedDate changing triggers re-render so the highlight matches if the
    // hour ticks over while the page is open. Pure cosmetic — no need to be precise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timezone, selectedDate, lastUpdatedAt]
  )

  const isError = Boolean(
    associatesQuery.error || workingAreasQuery.error || eventsQuery.error
  )

  if (isError && import.meta.env.DEV) {
    logger.warn('[useHourlyProductivity] one or more queries errored', {
      associates: associatesQuery.error?.message,
      areas: workingAreasQuery.error?.message,
      events: eventsQuery.error?.message,
    })
  }

  return {
    associates: filteredAssociates,
    allAssociates: associates,
    hourBuckets,
    workingAreas: (workingAreasQuery.data ?? []).map((w) => ({
      id: w.id,
      area_name: w.area_name,
      area_code: w.area_code,
      is_active: w.is_active,
    })),
    departments,
    hourTargets,
    lastUpdatedAt,
    isLoading:
      associatesQuery.isLoading ||
      workingAreasQuery.isLoading ||
      eventsQuery.isLoading,
    isFetching: eventsQuery.isFetching,
    isError,
    selectedDate,
    setSelectedDate,
    goToToday,
    filters,
    updateFilters,
    clearFilters,
    refresh,
    timezone,
    currentHour,
    isToday,
    getCellState,
    getCellBucket,
  }
}

export type { HourCellState, HourBucket, AssociateRow, HourTargets }

// Created and developed by Jai Singh
