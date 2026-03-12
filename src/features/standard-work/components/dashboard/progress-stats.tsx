/**
 * Progress Stats Card Component
 * Modern enterprise progress dashboard with streak, rates, and completion metrics
 * Updated: February 8, 2026 - Complete redesign for enterprise experience
 */
import {
  Flame,
  Trophy,
  TrendingUp,
  Calendar,
  CalendarDays,
  Target,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import type { UserProgressStats } from '@/hooks/use-standard-work'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

interface ProgressStatsCardProps {
  stats?: UserProgressStats | null
  isLoading?: boolean
}

export function ProgressStatsCard({
  stats,
  isLoading,
}: ProgressStatsCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className='pb-4'>
          <Skeleton className='h-5 w-28' />
          <Skeleton className='mt-1 h-4 w-40' />
        </CardHeader>
        <CardContent className='space-y-4'>
          <Skeleton className='h-24 w-full rounded-xl' />
          <Skeleton className='h-14 w-full' />
          <Skeleton className='h-14 w-full' />
          <Skeleton className='h-14 w-full' />
        </CardContent>
      </Card>
    )
  }

  const todayPct = stats?.due_today
    ? Math.round(((stats?.completed_today || 0) / stats.due_today) * 100)
    : 0

  const weeklyPct = stats?.this_week_total
    ? Math.round((stats.this_week_completed / stats.this_week_total) * 100)
    : 0

  const monthlyPct = stats?.this_month_total
    ? Math.round((stats.this_month_completed / stats.this_month_total) * 100)
    : 0

  return (
    <Card className='overflow-hidden'>
      <CardHeader className='pb-4'>
        <div className='flex items-center gap-3'>
          <div className='bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg'>
            <TrendingUp className='text-primary h-5 w-5' />
          </div>
          <div>
            <CardTitle className='text-base'>My Progress</CardTitle>
            <CardDescription className='text-xs'>
              Your performance metrics
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className='space-y-5 pt-0'>
        {/* Streak Banner */}
        <div className='relative overflow-hidden rounded-xl bg-linear-to-br from-orange-500/10 via-amber-500/10 to-yellow-500/10 p-4 dark:from-orange-500/15 dark:via-amber-500/10 dark:to-yellow-500/5'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/20'>
                <Flame className='h-6 w-6 text-orange-500' />
              </div>
              <div>
                <p className='text-2xl font-bold tracking-tight'>
                  {stats?.current_streak || 0}
                </p>
                <p className='text-muted-foreground text-xs font-medium'>
                  Day Streak
                </p>
              </div>
            </div>
            <div className='text-right'>
              <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                <Trophy className='h-3.5 w-3.5 text-yellow-500' />
                <span>Best: {stats?.longest_streak || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Today's Progress */}
        <div className='space-y-2.5'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 text-sm'>
              <Target className='text-primary h-4 w-4' />
              <span className='font-medium'>Today</span>
            </div>
            <span className='text-sm font-semibold'>
              {stats?.completed_today || 0}/{stats?.due_today || 0}
              <span className='text-muted-foreground ml-1 text-xs font-normal'>
                ({todayPct}%)
              </span>
            </span>
          </div>
          <Progress value={todayPct} className='h-2' />
          {(stats?.overdue_count || 0) > 0 && (
            <div className='text-destructive flex items-center gap-1.5 text-xs font-medium'>
              <AlertCircle className='h-3 w-3' />
              {stats?.overdue_count} overdue
            </div>
          )}
        </div>

        <Separator />

        {/* Weekly Progress */}
        <div className='space-y-2.5'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 text-sm'>
              <CalendarDays className='text-muted-foreground h-4 w-4' />
              <span className='font-medium'>This Week</span>
            </div>
            <span className='text-sm font-semibold'>
              {stats?.this_week_completed || 0}/{stats?.this_week_total || 0}
              <span className='text-muted-foreground ml-1 text-xs font-normal'>
                ({weeklyPct}%)
              </span>
            </span>
          </div>
          <Progress value={weeklyPct} className='h-2' />
        </div>

        {/* Monthly Progress */}
        <div className='space-y-2.5'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 text-sm'>
              <Calendar className='text-muted-foreground h-4 w-4' />
              <span className='font-medium'>This Month</span>
            </div>
            <span className='text-sm font-semibold'>
              {stats?.this_month_completed || 0}/{stats?.this_month_total || 0}
              <span className='text-muted-foreground ml-1 text-xs font-normal'>
                ({monthlyPct}%)
              </span>
            </span>
          </div>
          <Progress value={monthlyPct} className='h-2' />
        </div>

        <Separator />

        {/* On-time Rate */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2.5'>
            <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10'>
              <CheckCircle2 className='h-4 w-4 text-green-500' />
            </div>
            <div>
              <p className='text-muted-foreground text-xs'>On-time Rate</p>
              <p className='text-sm font-semibold'>
                {stats?.on_time_rate || 100}%
              </p>
            </div>
          </div>
          <div className='text-right'>
            <p className='text-muted-foreground text-xs'>Last 30 days</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default ProgressStatsCard
