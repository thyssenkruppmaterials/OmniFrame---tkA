// Created and developed by Jai Singh
/**
 * Standard Work Overview Hook
 *
 * Single source of truth for dashboard "today" metrics. Reconciles the three
 * underlying queries (dashboard tasks bucket, user progress RPC, upcoming
 * schedule) into one consistent shape with explicit precedence rules so the
 * KPI strip, today list, and right rail never disagree.
 *
 * Precedence:
 *   - "today" counts derive from `useDashboardTasks` (live scheduled tasks).
 *   - "this_week_*" / "this_month_*" / "current_streak" / "on_time_rate" come
 *     from `useUserProgress` (server-aggregated stats).
 *   - "upcoming" (7-day) comes from `useUpcomingTasks`.
 */
import { useMemo } from 'react'
import {
  useStandardWork,
  type ScheduledTask,
  type UserProgressStats,
} from '@/hooks/use-standard-work'

export interface StandardWorkOverview {
  today: {
    total: number
    completed: number
    overdue: number
    dueSoon: number
    laterToday: number
    completionPct: number
  }
  buckets: {
    overdue: ScheduledTask[]
    dueSoon: ScheduledTask[]
    laterToday: ScheduledTask[]
    completed: ScheduledTask[]
  }
  progress: UserProgressStats | null
  upcoming: { date: string; tasks: ScheduledTask[] }[]
  upcomingWindowDays: number
  isLoading: boolean
  isError: boolean
  errors: { tasks?: Error; progress?: Error; upcoming?: Error }
  refetchAll: () => Promise<void>
  isRefetching: boolean
}

const EMPTY_BUCKETS = {
  overdue: [] as ScheduledTask[],
  dueSoon: [] as ScheduledTask[],
  laterToday: [] as ScheduledTask[],
  completed: [] as ScheduledTask[],
}

export function useStandardWorkOverview({
  workingAreaId,
  upcomingDays = 7,
}: {
  workingAreaId?: string
  upcomingDays?: number
} = {}): StandardWorkOverview {
  const { useDashboardTasks, useUserProgress, useUpcomingTasks } =
    useStandardWork()

  const tasksQuery = useDashboardTasks(workingAreaId)
  const progressQuery = useUserProgress()
  const upcomingQuery = useUpcomingTasks(upcomingDays, workingAreaId)

  return useMemo(() => {
    // The service still ships an "upcoming" key on dashboard tasks meaning
    // "scheduled later today, > 1h from now". We rename it to laterToday in
    // the overview so it stops colliding with the 7-day Upcoming Schedule.
    const raw = tasksQuery.data
    const buckets = raw
      ? {
          overdue: raw.overdue,
          dueSoon: raw.dueSoon,
          laterToday: raw.upcoming,
          completed: raw.completed,
        }
      : EMPTY_BUCKETS

    const total =
      buckets.overdue.length +
      buckets.dueSoon.length +
      buckets.laterToday.length +
      buckets.completed.length

    const completed = buckets.completed.length
    const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0

    return {
      today: {
        total,
        completed,
        overdue: buckets.overdue.length,
        dueSoon: buckets.dueSoon.length,
        laterToday: buckets.laterToday.length,
        completionPct,
      },
      buckets,
      progress: progressQuery.data ?? null,
      upcoming: upcomingQuery.data ?? [],
      upcomingWindowDays: upcomingDays,
      isLoading:
        tasksQuery.isLoading ||
        progressQuery.isLoading ||
        upcomingQuery.isLoading,
      isError:
        tasksQuery.isError || progressQuery.isError || upcomingQuery.isError,
      errors: {
        tasks: (tasksQuery.error as Error) ?? undefined,
        progress: (progressQuery.error as Error) ?? undefined,
        upcoming: (upcomingQuery.error as Error) ?? undefined,
      },
      isRefetching:
        tasksQuery.isFetching ||
        progressQuery.isFetching ||
        upcomingQuery.isFetching,
      refetchAll: async () => {
        await Promise.all([
          tasksQuery.refetch(),
          progressQuery.refetch(),
          upcomingQuery.refetch(),
        ])
      },
    }
  }, [
    tasksQuery.data,
    tasksQuery.isLoading,
    tasksQuery.isError,
    tasksQuery.isFetching,
    tasksQuery.error,
    tasksQuery.refetch,
    progressQuery.data,
    progressQuery.isLoading,
    progressQuery.isError,
    progressQuery.isFetching,
    progressQuery.error,
    progressQuery.refetch,
    upcomingQuery.data,
    upcomingQuery.isLoading,
    upcomingQuery.isError,
    upcomingQuery.isFetching,
    upcomingQuery.error,
    upcomingQuery.refetch,
    upcomingDays,
  ])
}

// Created and developed by Jai Singh
