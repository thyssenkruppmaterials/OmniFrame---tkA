// Created and developed by Jai Singh
/**
 * Standard Work Dashboard
 *
 * Hosts the Checklist Dashboard. Layout (top to bottom):
 *   1. Hero strip      -- greeting, summary, "Next up" pinned card, filter, refresh
 *   2. KPI tile row    -- four refined tiles with mini-visualizations
 *                          (progress ring, attention chip, weekly streak grid,
 *                          on-time sparkline)
 *   3. Main grid       -- 2/3 left column (Today's tasks + Upcoming schedule),
 *                          1/3 right rail (My Progress + Recent Activity)
 *
 * All "today" metrics flow through `useStandardWorkOverview` so KPIs, list,
 * and rail share a single source of truth and render an explicit error
 * state instead of falling through to the success-empty path.
 */
import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { useStandardWork } from '@/hooks/use-standard-work'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useStandardWorkOverview } from '@/features/standard-work/hooks/use-standard-work-overview'
import { DashboardHero } from './dashboard-hero'
import {
  AttentionTile,
  OnTimeRateTile,
  StreakTile,
  TodayProgressTile,
} from './kpi-tiles'
import { ProgressStatsCard } from './progress-stats'
import { SubmissionHistory } from './submission-history'
import { TodayTasksSection } from './today-tasks'
import { UpcomingTasksSection } from './upcoming-tasks'

const UPCOMING_DAYS = 7

interface StandardWorkDashboardProps {
  onStartChecklist: (templateId: string) => void
  onContinueChecklist: (submissionId: string) => void
}

export function StandardWorkDashboard({
  onStartChecklist,
  onContinueChecklist,
}: StandardWorkDashboardProps) {
  const reduce = useReducedMotion()
  const { authState } = useUnifiedAuth()
  const profile = authState.profile
  const { workingAreas, areasLoading } = useLaborManagement()
  const { todaySubmissions, userDailyCompletion } = useStandardWork()

  const [selectedAreaId, setSelectedAreaId] = useState<string>('')

  const overview = useStandardWorkOverview({
    workingAreaId: selectedAreaId || undefined,
    upcomingDays: UPCOMING_DAYS,
  })

  // Filter the org-wide daily completion table down to the current user's
  // last 14 days for the streak grid and on-time sparkline. Non-blocking:
  // if the query is still loading, the tiles render in a sensible fallback.
  const userTrend = useMemo(() => {
    const userId = profile?.id
    if (!userId) return undefined
    const row = userDailyCompletion.find((r) => r.user_id === userId)
    return row?.daily_data
      ?.slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ date: d.date, completed: d.completed }))
  }, [profile?.id, userDailyCompletion])

  const isInitialLoading = areasLoading || overview.isLoading
  const isError = !overview.isLoading && overview.isError
  const { today, progress, buckets, upcoming } = overview

  if (isInitialLoading) {
    return (
      <div className='space-y-6'>
        <Skeleton className='h-[160px] rounded-2xl' />
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className='p-5'>
                <Skeleton className='mb-2 h-4 w-20' />
                <Skeleton className='h-8 w-16' />
                <Skeleton className='mt-3 h-2 w-full' />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className='grid gap-6 lg:grid-cols-3'>
          <div className='space-y-6 lg:col-span-2'>
            <Skeleton className='h-[350px] rounded-xl' />
            <Skeleton className='h-[200px] rounded-xl' />
          </div>
          <div className='space-y-6'>
            <Skeleton className='h-[280px] rounded-xl' />
            <Skeleton className='h-[220px] rounded-xl' />
          </div>
        </div>
      </div>
    )
  }

  // Canonical "today" metrics. Prefer server-side counts when available so
  // the KPI tile and the rail "Today" row agree; fall back to live buckets.
  const dueToday = progress?.due_today ?? today.total
  const completedToday = progress?.completed_today ?? today.completed
  const overdueCount = today.overdue
  const dueSoonCount = today.dueSoon
  const onTimeRate = progress?.on_time_rate ?? 100
  const currentStreak = progress?.current_streak ?? 0
  const longestStreak = progress?.longest_streak ?? 0

  const nextOverdueLabel = buckets.overdue[0]?.template_name

  return (
    <div className='space-y-6' aria-busy={overview.isRefetching}>
      {/* Error banner -- renders alongside any partial success */}
      {isError && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertDescription className='flex items-center justify-between gap-3'>
              <span>
                Some sections couldn't load.{' '}
                {overview.errors.tasks?.message ||
                  overview.errors.progress?.message ||
                  overview.errors.upcoming?.message ||
                  'Please retry.'}
              </span>
              <Button
                size='sm'
                variant='outline'
                className='h-7'
                onClick={() => overview.refetchAll()}
              >
                <RefreshCw className='mr-1.5 h-3 w-3' />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </motion.div>
      )}

      {/* Hero -- greeting + Next up + filter + refresh */}
      <DashboardHero
        userName={profile?.full_name ?? undefined}
        buckets={{
          overdue: buckets.overdue,
          dueSoon: buckets.dueSoon,
          laterToday: buckets.laterToday,
          completed: buckets.completed,
        }}
        todaySubmissions={todaySubmissions}
        totalToday={today.total}
        completedToday={today.completed}
        workingAreas={workingAreas}
        selectedAreaId={selectedAreaId}
        onAreaChange={setSelectedAreaId}
        isRefetching={overview.isRefetching}
        onRefresh={() => overview.refetchAll()}
        onStartChecklist={onStartChecklist}
        onContinueChecklist={onContinueChecklist}
      />

      {/* KPI tiles -- 4-up on xl, 2-up on tablets, stacked on mobile */}
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <TodayProgressTile
          index={0}
          completed={completedToday}
          due={dueToday}
        />
        <AttentionTile
          index={1}
          overdue={overdueCount}
          dueSoon={dueSoonCount}
          nextOverdueLabel={nextOverdueLabel}
        />
        <StreakTile
          index={2}
          current={currentStreak}
          longest={longestStreak}
          weeklyCompletion={userTrend}
        />
        <OnTimeRateTile index={3} rate={onTimeRate} trend={userTrend} />
      </div>

      {/* Main Dashboard Grid */}
      <div className='grid gap-6 lg:grid-cols-3'>
        {/* Left Column - Primary Content */}
        <div className='space-y-6 lg:col-span-2'>
          <TodayTasksSection
            tasks={{
              overdue: buckets.overdue,
              dueSoon: buckets.dueSoon,
              upcoming: buckets.laterToday,
              completed: buckets.completed,
            }}
            todaySubmissions={todaySubmissions}
            onStartChecklist={onStartChecklist}
            onContinueChecklist={onContinueChecklist}
            isError={!!overview.errors.tasks}
          />

          <UpcomingTasksSection
            upcomingTasks={upcoming}
            isLoading={false}
            windowDays={UPCOMING_DAYS}
            isError={!!overview.errors.upcoming}
            onRetry={() => overview.refetchAll()}
          />
        </div>

        {/* Right Column - Stats & Activity */}
        <div className='space-y-6'>
          <ProgressStatsCard
            stats={progress}
            isLoading={false}
            isError={!!overview.errors.progress}
            onRetry={() => overview.refetchAll()}
          />
          <SubmissionHistory submissions={todaySubmissions} limit={5} />
        </div>
      </div>
    </div>
  )
}

export default StandardWorkDashboard

// Created and developed by Jai Singh
