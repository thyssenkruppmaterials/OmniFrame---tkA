/**
 * Team Performance Dashboard
 * Main dashboard component - consolidated single view with date picker
 * Created: December 20, 2025
 * Updated: January 1, 2026 - Consolidated Real-time and Historical into single view with date picker
 * OPTIMIZED: January 3, 2026 - Progressive loading with deferred secondary data
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertCircle,
  Info,
  RefreshCw,
  Target,
  Users,
  Zap,
} from 'lucide-react'
import type { WorkingArea } from '@/lib/supabase/labor-management.service'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { RealTimeView } from './components/real-time-view'
import { useTeamPerformance } from './hooks/use-team-performance'

// Stat Card Component - clean neutral design matching inbound scan search
interface StatCardProps {
  icon: React.ElementType
  title: string
  value: number | string
  description?: string
  isLoading?: boolean
  /** Optional info tooltip content to explain the metric */
  infoTooltip?: string
}

function StatCard({
  icon: Icon,
  title,
  value,
  description,
  isLoading,
  infoTooltip,
}: StatCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className='p-6'>
          <div className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <Skeleton className='h-4 w-24' />
            <Skeleton className='h-4 w-4' />
          </div>
          <Skeleton className='mt-2 h-8 w-16' />
          <Skeleton className='mt-2 h-3 w-32' />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className='p-0'>
        <div className='flex flex-row items-center justify-between space-y-0 p-6 pb-2'>
          <div className='flex items-center gap-1.5'>
            <p className='text-sm font-medium'>{title}</p>
            {infoTooltip && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className='text-muted-foreground h-3.5 w-3.5 cursor-help' />
                  </TooltipTrigger>
                  <TooltipContent side='top' className='max-w-xs'>
                    <p className='text-xs'>{infoTooltip}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <Icon className='text-muted-foreground h-4 w-4' />
        </div>
        <div className='p-6 pt-0'>
          <div className='text-2xl font-bold'>{value}</div>
          {description && (
            <p className='text-muted-foreground text-xs'>{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

interface TeamPerformanceDashboardProps {
  className?: string
}

export function TeamPerformanceDashboard({
  className,
}: TeamPerformanceDashboardProps) {
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const {
    // Data
    performanceData,
    weeklyTrend,
    workingAreas,
    departments,
    timelineEvents,
    approvedOvertime,

    // Loading states
    isLoadingPerformance,

    // Errors
    error,

    // Filters
    updateFilters,

    // Date
    selectedDate,
    setSelectedDate,
    goToToday,
    goToPreviousDay,
    goToNextDay,
    canGoForward,

    // Actions
    refresh,
    exportToCSV,

    // Organization
    organizationId,
  } = useTeamPerformance({
    autoRefresh: true, // Auto-refresh when viewing today
    refreshInterval: 30000,
  })

  // Update last updated timestamp on data refresh
  useEffect(() => {
    if (performanceData) {
      setLastUpdated(new Date())
    }
  }, [performanceData])

  // Handle filter changes from views
  const handleFilterChange = (newFilters: {
    departments?: string[]
    areas?: string[]
    search?: string
    sortBy?: 'name' | 'efficiency' | 'tasks' | 'department' | 'area'
    sortOrder?: 'asc' | 'desc'
  }) => {
    updateFilters(newFilters)
  }

  // Handle refresh
  const handleRefresh = () => {
    refresh()
    setLastUpdated(new Date())
  }

  // Get summary data for stat cards
  const summary = performanceData?.summary

  // No organization error
  if (!organizationId) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <Alert variant='destructive' className='max-w-md'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>
            Unable to load team performance data. Organization not found.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className='space-y-4'>
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>
            Error loading performance data: {error.message || 'Unknown error'}
          </AlertDescription>
        </Alert>
        <Button variant='outline' onClick={handleRefresh}>
          <RefreshCw className='mr-2 h-4 w-4' />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <motion.div
      className={cn('w-full space-y-6', className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Team Performance</h2>
        <p className='text-muted-foreground'>
          Monitor and analyze team productivity across shifts and departments
        </p>
      </div>

      {/* Stat Cards - Above Tabs */}
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <StatCard
          icon={Users}
          title='Total Associates'
          value={summary?.totalAssociates ?? 0}
          description={`${summary?.activeAssociates ?? 0} currently active`}
          isLoading={isLoadingPerformance}
        />
        <StatCard
          icon={Target}
          title='Tasks Completed'
          value={summary?.totalTasksCompleted ?? 0}
          description='Total tasks today'
          isLoading={isLoadingPerformance}
        />
        <StatCard
          icon={Zap}
          title='Avg Efficiency'
          value={`${summary?.averageEfficiency ?? 0}%`}
          description='Team average'
          isLoading={isLoadingPerformance}
          infoTooltip='Individual efficiency is capped at 150% to prevent outliers from skewing team averages. Calculated against labor standards.'
        />
        <StatCard
          icon={Activity}
          title='Active Now'
          value={summary?.activeAssociates ?? 0}
          description={`${summary?.onBreakAssociates ?? 0} on break, ${summary?.offlineAssociates ?? 0} offline`}
          isLoading={isLoadingPerformance}
        />
      </div>

      {/* Main Content - Unified View */}
      <RealTimeView
        data={performanceData}
        weeklyTrend={weeklyTrend}
        isLoading={isLoadingPerformance}
        workingAreas={workingAreas as WorkingArea[]}
        departments={departments}
        timelineEvents={timelineEvents}
        approvedOvertime={approvedOvertime}
        onRefresh={handleRefresh}
        onFilterChange={handleFilterChange}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        onPreviousDay={goToPreviousDay}
        onNextDay={goToNextDay}
        onGoToToday={goToToday}
        canGoForward={canGoForward}
        lastUpdated={lastUpdated}
        onExport={exportToCSV}
      />

      {/* Performance Tips */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <Alert className='border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20'>
          <Activity className='h-4 w-4 text-blue-600 dark:text-blue-400' />
          <AlertDescription className='text-blue-700 dark:text-blue-300'>
            <strong className='text-blue-800 dark:text-blue-200'>
              Pro Tip:
            </strong>{' '}
            Use the Real-time view for current shift monitoring with
            auto-refresh. Switch to Historical view to analyze past performance
            and identify trends.
          </AlertDescription>
        </Alert>
      </motion.div>
    </motion.div>
  )
}

export default TeamPerformanceDashboard
