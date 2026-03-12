/**
 * Standard Work Dashboard Component
 * Enterprise-grade dashboard with KPI cards, task management, and progress tracking
 * Updated: February 8, 2026 - Complete redesign for modern enterprise experience
 */
import { useState } from 'react'
import {
  ClipboardCheck,
  Clock,
  Filter,
  Flame,
  MapPin,
  RefreshCw,
  Target,
  TrendingUp,
} from 'lucide-react'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { useStandardWork } from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ProgressStatsCard } from './progress-stats'
import { SubmissionHistory } from './submission-history'
import { TodayTasksSection } from './today-tasks'
import { UpcomingTasksSection } from './upcoming-tasks'

interface StandardWorkDashboardProps {
  onStartChecklist: (templateId: string) => void
  onContinueChecklist: (submissionId: string) => void
}

export function StandardWorkDashboard({
  onStartChecklist,
  onContinueChecklist,
}: StandardWorkDashboardProps) {
  const { workingAreas, areasLoading } = useLaborManagement()
  const {
    useDashboardTasks,
    useUserProgress,
    useUpcomingTasks,
    todaySubmissions,
  } = useStandardWork()

  const [selectedAreaId, setSelectedAreaId] = useState<string>('')

  const {
    data: dashboardTasks,
    isLoading: tasksLoading,
    refetch: refetchTasks,
  } = useDashboardTasks(selectedAreaId || undefined)

  const { data: userProgress, isLoading: progressLoading } = useUserProgress()
  const { data: upcomingTasks, isLoading: upcomingLoading } = useUpcomingTasks(
    7,
    selectedAreaId || undefined
  )

  const activeAreas = workingAreas.filter((a) => a.is_active)
  const isLoading = areasLoading || tasksLoading

  // Quick KPI calculations
  const totalToday = dashboardTasks
    ? dashboardTasks.overdue.length +
      dashboardTasks.dueSoon.length +
      dashboardTasks.upcoming.length +
      dashboardTasks.completed.length
    : 0
  const completedToday = dashboardTasks?.completed.length || 0
  const overdueToday = dashboardTasks?.overdue.length || 0

  if (isLoading) {
    return (
      <div className='space-y-6'>
        {/* KPI Skeletons */}
        <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className='p-5'>
                <Skeleton className='mb-2 h-4 w-20' />
                <Skeleton className='h-8 w-12' />
              </CardContent>
            </Card>
          ))}
        </div>
        {/* Content Skeletons */}
        <div className='grid gap-6 lg:grid-cols-3'>
          <div className='space-y-6 lg:col-span-2'>
            <Skeleton className='h-[350px] rounded-lg' />
            <Skeleton className='h-[200px] rounded-lg' />
          </div>
          <div className='space-y-6'>
            <Skeleton className='h-[280px] rounded-lg' />
            <Skeleton className='h-[220px] rounded-lg' />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {/* Quick KPI Strip */}
      <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
        <Card className='overflow-hidden'>
          <CardContent className='p-5'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  Today's Tasks
                </p>
                <p className='mt-1 text-2xl font-bold'>{totalToday}</p>
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  {completedToday} completed
                </p>
              </div>
              <div className='bg-primary/10 flex h-10 w-10 items-center justify-center rounded-xl'>
                <ClipboardCheck className='text-primary h-5 w-5' />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className='overflow-hidden'>
          <CardContent className='p-5'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  Completion
                </p>
                <p className='mt-1 text-2xl font-bold'>
                  {totalToday > 0
                    ? Math.round((completedToday / totalToday) * 100)
                    : 0}
                  %
                </p>
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  {completedToday}/{totalToday} tasks
                </p>
              </div>
              <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10'>
                <Target className='h-5 w-5 text-green-500' />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className='overflow-hidden'>
          <CardContent className='p-5'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  Streak
                </p>
                <p className='mt-1 text-2xl font-bold'>
                  {userProgress?.current_streak || 0}
                </p>
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  consecutive days
                </p>
              </div>
              <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10'>
                <Flame className='h-5 w-5 text-orange-500' />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className='overflow-hidden'>
          <CardContent className='p-5'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  {overdueToday > 0 ? 'Overdue' : 'On-Time Rate'}
                </p>
                <p
                  className={`mt-1 text-2xl font-bold ${overdueToday > 0 ? 'text-destructive' : ''}`}
                >
                  {overdueToday > 0
                    ? overdueToday
                    : `${userProgress?.on_time_rate || 100}%`}
                </p>
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  {overdueToday > 0 ? 'tasks need attention' : 'last 30 days'}
                </p>
              </div>
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  overdueToday > 0 ? 'bg-destructive/10' : 'bg-blue-500/10'
                }`}
              >
                {overdueToday > 0 ? (
                  <Clock className='text-destructive h-5 w-5' />
                ) : (
                  <TrendingUp className='h-5 w-5 text-blue-500' />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-3'>
          <div className='text-muted-foreground flex items-center gap-2 text-sm'>
            <Filter className='h-4 w-4' />
            <span className='font-medium'>Filter</span>
          </div>
          <Select
            value={selectedAreaId || '_all'}
            onValueChange={(value) =>
              setSelectedAreaId(value === '_all' ? '' : value)
            }
          >
            <SelectTrigger className='h-9 w-[220px]'>
              <MapPin className='text-muted-foreground mr-2 h-3.5 w-3.5' />
              <SelectValue placeholder='All Working Areas' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='_all'>All Working Areas</SelectItem>
              {activeAreas.map((area) => (
                <SelectItem key={area.id} value={area.id}>
                  {area.area_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedAreaId && (
            <Badge
              variant='secondary'
              className='cursor-pointer gap-1 text-xs'
              onClick={() => setSelectedAreaId('')}
            >
              Filtered
              <span className='text-muted-foreground'>×</span>
            </Badge>
          )}
        </div>

        <Button
          variant='outline'
          size='sm'
          onClick={() => refetchTasks()}
          className='h-9 gap-2'
        >
          <RefreshCw className='h-3.5 w-3.5' />
          Refresh
        </Button>
      </div>

      {/* Main Dashboard Grid */}
      <div className='grid gap-6 lg:grid-cols-3'>
        {/* Left Column - Primary Content */}
        <div className='space-y-6 lg:col-span-2'>
          <TodayTasksSection
            tasks={
              dashboardTasks || {
                overdue: [],
                dueSoon: [],
                upcoming: [],
                completed: [],
              }
            }
            todaySubmissions={todaySubmissions}
            onStartChecklist={onStartChecklist}
            onContinueChecklist={onContinueChecklist}
          />

          <UpcomingTasksSection
            upcomingTasks={upcomingTasks || []}
            isLoading={upcomingLoading}
          />
        </div>

        {/* Right Column - Stats & Activity */}
        <div className='space-y-6'>
          <ProgressStatsCard stats={userProgress} isLoading={progressLoading} />
          <SubmissionHistory submissions={todaySubmissions} limit={5} />
        </div>
      </div>
    </div>
  )
}

export default StandardWorkDashboard
