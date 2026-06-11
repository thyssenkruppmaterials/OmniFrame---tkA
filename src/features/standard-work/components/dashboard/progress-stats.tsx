// Created and developed by Jai Singh
/**
 * My Progress Card
 *
 * Right-rail companion to the dashboard KPI strip. Shows the user's
 * Today / This Week / This Month / On-time roll-ups. The streak (which used
 * to live here as a hero banner) is now rendered as a top-row KPI card so
 * we don't duplicate the same metric.
 */
import { motion, useReducedMotion } from 'framer-motion'
import {
  TrendingUp,
  Calendar,
  CalendarDays,
  Target,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import type { UserProgressStats } from '@/hooks/use-standard-work'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
  isError?: boolean
  onRetry?: () => void
}

export function ProgressStatsCard({
  stats,
  isLoading,
  isError,
  onRetry,
}: ProgressStatsCardProps) {
  const reduce = useReducedMotion()

  if (isLoading) {
    return (
      <Card>
        <CardHeader className='pb-4'>
          <Skeleton className='h-5 w-28' />
          <Skeleton className='mt-1 h-4 w-40' />
        </CardHeader>
        <CardContent className='space-y-4'>
          <Skeleton className='h-14 w-full' />
          <Skeleton className='h-14 w-full' />
          <Skeleton className='h-14 w-full' />
          <Skeleton className='h-12 w-full' />
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardHeader className='pb-4'>
          <CardTitle className='text-base'>My Progress</CardTitle>
          <CardDescription className='text-xs'>
            Your standard work this period
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertDescription className='flex items-center justify-between gap-2'>
              <span className='text-sm'>Couldn't load progress.</span>
              {onRetry && (
                <Button
                  size='sm'
                  variant='outline'
                  className='h-7'
                  onClick={onRetry}
                >
                  <RefreshCw className='mr-1.5 h-3 w-3' />
                  Retry
                </Button>
              )}
            </AlertDescription>
          </Alert>
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
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: reduce ? 0 : 0.15 }}
    >
      <Card className='overflow-hidden'>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-3'>
            <div className='bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg'>
              <TrendingUp className='text-primary h-5 w-5' aria-hidden='true' />
            </div>
            <div>
              <CardTitle className='text-base'>My Progress</CardTitle>
              <CardDescription className='text-xs'>
                Your standard work this period
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className='space-y-5 pt-0'>
          {/* Today's Progress */}
          <div className='space-y-2.5'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2 text-sm'>
                <Target className='text-primary h-4 w-4' aria-hidden='true' />
                <span className='font-medium'>Today</span>
              </div>
              <span className='text-sm font-semibold tabular-nums'>
                {stats?.completed_today || 0}/{stats?.due_today || 0}
                <span className='text-muted-foreground ml-1 text-xs font-normal'>
                  ({todayPct}%)
                </span>
              </span>
            </div>
            <Progress value={todayPct} className='h-2' />
            {(stats?.overdue_count || 0) > 0 && (
              <div className='text-destructive flex items-center gap-1.5 text-xs font-medium'>
                <AlertCircle className='h-3 w-3' aria-hidden='true' />
                {stats?.overdue_count} overdue
              </div>
            )}
          </div>

          <Separator />

          {/* Weekly Progress */}
          <div className='space-y-2.5'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2 text-sm'>
                <CalendarDays
                  className='text-muted-foreground h-4 w-4'
                  aria-hidden='true'
                />
                <span className='font-medium'>This Week</span>
              </div>
              <span className='text-sm font-semibold tabular-nums'>
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
                <Calendar
                  className='text-muted-foreground h-4 w-4'
                  aria-hidden='true'
                />
                <span className='font-medium'>This Month</span>
              </div>
              <span className='text-sm font-semibold tabular-nums'>
                {stats?.this_month_completed || 0}/
                {stats?.this_month_total || 0}
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
                <CheckCircle2
                  className='h-4 w-4 text-green-500'
                  aria-hidden='true'
                />
              </div>
              <div>
                <p className='text-muted-foreground text-xs'>On-time rate</p>
                <p className='text-sm font-semibold tabular-nums'>
                  {Math.round(stats?.on_time_rate ?? 100)}%
                </p>
              </div>
            </div>
            <div className='text-right'>
              <p className='text-muted-foreground text-xs'>Last 30 days</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default ProgressStatsCard

// Created and developed by Jai Singh
