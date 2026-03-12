/**
 * Team Performance React Hook
 * Provides data fetching and state management for team performance dashboard
 * Created: December 20, 2025
 * Updated: January 1, 2026 - Added date range support for multi-day aggregation
 * Updated: January 3, 2026 - Added timeline events fetching for activity timeline
 * Updated: January 4, 2026 - Added overtime requests fetching for overtime management
 * OPTIMIZED: January 3, 2026 - Intelligent caching, prefetching, and lazy loading
 */
import { useState, useEffect, useCallback } from 'react'
import { format, isToday as checkIsToday, startOfDay } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService from '@/lib/supabase/labor-management.service'
import {
  getOvertimeRequestsForDate,
  type OvertimeRequestWithDetails,
  type ApprovedOvertimeForTimeline,
} from '@/lib/supabase/overtime.service'
import TeamPerformanceService from '@/lib/supabase/team-performance.service'
import {
  getEventsForDate,
  type TimelineEventWithCategory,
} from '@/lib/supabase/timeline-events.service'
import { logger } from '@/lib/utils/logger'
import type { TeamPerformanceFilters } from '../types/team-performance.types'

export interface DateRange {
  from?: Date
  to?: Date
}

export interface UseTeamPerformanceOptions {
  autoRefresh?: boolean
  refreshInterval?: number // in milliseconds
  initialFilters?: TeamPerformanceFilters
  dateRange?: DateRange // Optional initial date range for multi-day queries
  enableWeeklyTrend?: boolean // Whether to load weekly trend (for lazy loading)
  enableTimelineEvents?: boolean // Whether to load timeline events (for lazy loading)
  enableOvertimeRequests?: boolean // Whether to load overtime requests (for lazy loading)
}

/**
 * Determine optimal staleTime based on date
 * Historical data never changes - cache indefinitely
 * Today's data is live - use short staleTime
 */
function getStaleTimeForDate(date: Date): number {
  const isTodayData = checkIsToday(date)
  return isTodayData ? 15000 : Infinity // 15s for today, infinite for historical
}

/**
 * Determine optimal gcTime (garbage collection time) based on date
 * Keep historical data in cache longer
 */
function getGcTimeForDate(date: Date): number {
  const isTodayData = checkIsToday(date)
  return isTodayData ? 1000 * 60 * 5 : 1000 * 60 * 30 // 5min for today, 30min for historical
}

export function useTeamPerformance(options: UseTeamPerformanceOptions = {}) {
  const {
    autoRefresh = true,
    refreshInterval = 30000, // 30 seconds
    initialFilters = {},
    dateRange: initialDateRange,
    enableWeeklyTrend = true,
    enableTimelineEvents = true,
    enableOvertimeRequests = true,
  } = options

  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''
  const queryClient = useQueryClient()

  // Filter state
  const [filters, setFilters] = useState<TeamPerformanceFilters>(initialFilters)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  // Date range for multi-day queries (null = single day mode)
  const [dateRange, setDateRange] = useState<DateRange | null>(
    initialDateRange ?? null
  )

  // Calculate stale time based on selected date
  const staleTime = getStaleTimeForDate(selectedDate)
  const gcTime = getGcTimeForDate(selectedDate)
  const isTodayData = checkIsToday(selectedDate)

  // ===== PREFETCH ADJACENT DATES =====
  // Prefetch previous and next day data for instant navigation
  const prefetchAdjacentDates = useCallback(
    (currentDate: Date) => {
      if (!organizationId) return

      // Prefetch previous day (always available)
      const previousDay = new Date(currentDate)
      previousDay.setDate(previousDay.getDate() - 1)
      const prevDateKey = startOfDay(previousDay).toISOString()

      queryClient.prefetchQuery({
        queryKey: ['team-performance', organizationId, prevDateKey, filters],
        queryFn: () =>
          TeamPerformanceService.getTeamProductivity(
            organizationId,
            previousDay,
            filters
          ),
        staleTime: Infinity, // Historical data never changes
        gcTime: 1000 * 60 * 30, // Keep 30 minutes
      })

      // Prefetch next day (only if not in future)
      const nextDay = new Date(currentDate)
      nextDay.setDate(nextDay.getDate() + 1)
      if (nextDay <= new Date()) {
        const nextDateKey = startOfDay(nextDay).toISOString()
        queryClient.prefetchQuery({
          queryKey: ['team-performance', organizationId, nextDateKey, filters],
          queryFn: () =>
            TeamPerformanceService.getTeamProductivity(
              organizationId,
              nextDay,
              filters
            ),
          staleTime: checkIsToday(nextDay) ? 15000 : Infinity,
          gcTime: checkIsToday(nextDay) ? 1000 * 60 * 5 : 1000 * 60 * 30,
        })
      }
    },
    [organizationId, filters, queryClient]
  )

  // Prefetch adjacent dates when current date changes
  useEffect(() => {
    prefetchAdjacentDates(selectedDate)
  }, [selectedDate, prefetchAdjacentDates])

  // ===== MAIN TEAM PERFORMANCE QUERY =====
  // Supports both single-day and date-range queries
  const {
    data: performanceData,
    isLoading: isLoadingPerformance,
    error: performanceError,
    refetch: refetchPerformance,
  } = useQuery({
    queryKey: [
      'team-performance',
      organizationId,
      dateRange,
      startOfDay(selectedDate).toISOString(),
      filters,
    ],
    queryFn: async () => {
      const startTime = performance.now()

      // Use date range query if range is set (with valid dates), otherwise single day
      let data
      if (dateRange && dateRange.from && dateRange.to) {
        data = await TeamPerformanceService.getTeamProductivityForDateRange(
          organizationId,
          dateRange.from,
          dateRange.to,
          filters
        )
      } else {
        data = await TeamPerformanceService.getTeamProductivity(
          organizationId,
          selectedDate,
          filters
        )
      }

      const duration = performance.now() - startTime
      logger.log(
        `[useTeamPerformance] Data fetched in ${duration.toFixed(0)}ms`
      )

      return data
    },
    enabled: !!organizationId,
    // Only auto-refresh today's data
    refetchInterval: autoRefresh && isTodayData ? refreshInterval : false,
    staleTime,
    gcTime,
  })

  // ===== WEEKLY TREND QUERY =====
  // Uses optimized RPC function - single query for 7 days
  const {
    data: weeklyTrend,
    isLoading: isLoadingTrend,
    error: trendError,
  } = useQuery({
    queryKey: [
      'team-performance-weekly',
      organizationId,
      format(selectedDate, 'yyyy-MM-dd'),
    ],
    queryFn: async () => {
      const data = await TeamPerformanceService.getWeeklyTrend(
        organizationId,
        selectedDate
      )
      return data
    },
    enabled: !!organizationId && enableWeeklyTrend,
    staleTime: isTodayData ? 60000 : Infinity, // 1 minute for today, infinite for historical
    gcTime: 1000 * 60 * 30, // 30 minutes
  })

  // ===== DEPARTMENTS QUERY =====
  const { data: departments = [], isLoading: isLoadingDepartments } = useQuery({
    queryKey: ['department-names', organizationId],
    queryFn: () =>
      LaborManagementService.getDistinctDepartments(organizationId),
    enabled: !!organizationId,
    staleTime: 300000, // 5 minutes
  })

  // ===== WORKING AREAS QUERY =====
  const { data: workingAreas = [], isLoading: isLoadingAreas } = useQuery({
    queryKey: ['working-areas', organizationId],
    queryFn: () => LaborManagementService.getWorkingAreas(organizationId),
    enabled: !!organizationId,
    staleTime: 300000, // 5 minutes
  })

  // ===== LABOR STANDARDS QUERY =====
  const { data: laborStandards = [], isLoading: isLoadingStandards } = useQuery(
    {
      queryKey: ['labor-standards', organizationId],
      queryFn: () => LaborManagementService.getLaborStandards(organizationId),
      enabled: !!organizationId,
      staleTime: 300000, // 5 minutes
    }
  )

  // ===== TIMELINE EVENTS QUERY =====
  // Lazy loaded - only fetches when enableTimelineEvents is true
  const {
    data: timelineEvents = [],
    isLoading: isLoadingEvents,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: [
      'timeline-events',
      organizationId,
      format(selectedDate, 'yyyy-MM-dd'),
    ],
    queryFn: async (): Promise<TimelineEventWithCategory[]> => {
      const dateStr = format(selectedDate, 'yyyy-MM-dd')
      const events = await getEventsForDate(organizationId, dateStr)
      return events
    },
    enabled: !!organizationId && enableTimelineEvents,
    staleTime: isTodayData ? 30000 : Infinity, // 30s for today, infinite for historical
    gcTime: 1000 * 60 * 15, // 15 minutes
  })

  // ===== OVERTIME REQUESTS QUERY =====
  // Lazy loaded - only fetches when enableOvertimeRequests is true
  const {
    data: overtimeRequests = [],
    isLoading: isLoadingOvertime,
    refetch: refetchOvertime,
  } = useQuery({
    queryKey: [
      'overtime-requests',
      organizationId,
      format(selectedDate, 'yyyy-MM-dd'),
    ],
    queryFn: async (): Promise<OvertimeRequestWithDetails[]> => {
      const dateStr = format(selectedDate, 'yyyy-MM-dd')
      const requests = await getOvertimeRequestsForDate(organizationId, dateStr)
      return requests
    },
    enabled: !!organizationId && enableOvertimeRequests,
    staleTime: isTodayData ? 30000 : Infinity, // 30s for today, infinite for historical
    gcTime: 1000 * 60 * 15, // 15 minutes
  })

  // ===== APPROVED OVERTIME FOR TIMELINE =====
  // Transform approved overtime requests into timeline format
  // Each request can have multiple assigned_user_ids, so we flatten them
  const approvedOvertime: ApprovedOvertimeForTimeline[] = overtimeRequests
    .filter((request) => request.status === 'approved')
    .flatMap((request) => {
      // Each request can have multiple users assigned
      return (request.assigned_user_ids || []).map((userId) => ({
        user_id: userId,
        original_shift_end: request.original_shift_end,
        extended_shift_end: request.extended_shift_end,
        overtime_duration_minutes: request.overtime_duration_minutes,
        overtime_minutes: request.overtime_duration_minutes, // Alias for compatibility
      }))
    })

  // ===== FILTER HANDLERS =====
  const updateFilters = (newFilters: Partial<TeamPerformanceFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
  }

  const clearFilters = () => {
    setFilters({})
  }

  const setDepartmentFilter = (departments: string[]) => {
    updateFilters({ departments })
  }

  const setAreaFilter = (areas: string[]) => {
    updateFilters({ areas })
  }

  const setStatusFilter = (statuses: ('active' | 'break' | 'offline')[]) => {
    updateFilters({ statuses })
  }

  const setSearchFilter = (search: string) => {
    updateFilters({ search })
  }

  const setSortBy = (
    sortBy: TeamPerformanceFilters['sortBy'],
    sortOrder: 'asc' | 'desc' = 'desc'
  ) => {
    updateFilters({ sortBy, sortOrder })
  }

  // ===== DATE HANDLERS =====
  const goToToday = () => {
    setSelectedDate(new Date())
    setDateRange(null) // Clear date range when going to today
  }

  const goToPreviousDay = () => {
    const newDate = new Date(selectedDate)
    newDate.setDate(newDate.getDate() - 1)
    setSelectedDate(newDate)
    setDateRange(null) // Clear date range for single day navigation
  }

  const goToNextDay = () => {
    const newDate = new Date(selectedDate)
    newDate.setDate(newDate.getDate() + 1)
    if (newDate <= new Date()) {
      setSelectedDate(newDate)
      setDateRange(null) // Clear date range for single day navigation
    }
  }

  // Set a date range for multi-day aggregation
  const setDateRangeFilter = (from: Date, to: Date) => {
    setDateRange({ from, to })
    setSelectedDate(to) // Keep selectedDate at end of range for reference
  }

  // Clear date range and return to single day mode
  const clearDateRange = () => {
    setDateRange(null)
  }

  // ===== REFRESH =====
  const refresh = useCallback(() => {
    // Only invalidate current date's data, not cached historical data
    const currentDateKey = startOfDay(selectedDate).toISOString()

    queryClient.invalidateQueries({
      queryKey: ['team-performance', organizationId, currentDateKey],
    })
    queryClient.invalidateQueries({
      queryKey: [
        'team-performance-weekly',
        organizationId,
        format(selectedDate, 'yyyy-MM-dd'),
      ],
    })
    queryClient.invalidateQueries({
      queryKey: [
        'timeline-events',
        organizationId,
        format(selectedDate, 'yyyy-MM-dd'),
      ],
    })
    queryClient.invalidateQueries({
      queryKey: [
        'overtime-requests',
        organizationId,
        format(selectedDate, 'yyyy-MM-dd'),
      ],
    })
  }, [queryClient, organizationId, selectedDate])

  // ===== EXPORT =====
  const exportToCSV = () => {
    if (!performanceData) return

    const csvContent = TeamPerformanceService.exportToCsv(performanceData)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `team-performance-${selectedDate.toISOString().split('T')[0]}.csv`
    link.click()
  }

  // ===== COMPUTED VALUES =====
  const isToday = isTodayData
  const canGoForward = !isTodayData // Can go forward if not viewing today

  const isLoading =
    isLoadingPerformance ||
    isLoadingTrend ||
    isLoadingDepartments ||
    isLoadingAreas ||
    isLoadingStandards ||
    isLoadingEvents ||
    isLoadingOvertime

  return {
    // Data
    performanceData,
    weeklyTrend,
    departments,
    workingAreas,
    laborStandards,
    timelineEvents,
    overtimeRequests,
    approvedOvertime,

    // Loading states
    isLoading,
    isLoadingPerformance,
    isLoadingTrend,
    isLoadingDepartments,
    isLoadingAreas,
    isLoadingStandards,
    isLoadingEvents,
    isLoadingOvertime,

    // Errors
    error: performanceError || trendError,
    performanceError,
    trendError,

    // Filters
    filters,
    updateFilters,
    clearFilters,
    setDepartmentFilter,
    setAreaFilter,
    setStatusFilter,
    setSearchFilter,
    setSortBy,

    // Date
    selectedDate,
    setSelectedDate,
    goToToday,
    goToPreviousDay,
    goToNextDay,
    isToday,
    canGoForward,
    // Date range
    dateRange,
    setDateRange,
    setDateRangeFilter,
    clearDateRange,

    // Actions
    refresh,
    refetchPerformance,
    refetchEvents,
    refetchOvertime,
    exportToCSV,

    // Organization
    organizationId,
  }
}
