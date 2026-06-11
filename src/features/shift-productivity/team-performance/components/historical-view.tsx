// Created and developed by Jai Singh
/**
 * Historical View Component
 * Daily performance view with date picker and trend analysis
 * Created: December 20, 2025
 * Updated: December 31, 2025 - Tabs moved inline with search, stats moved to dashboard
 */
import { useState } from 'react'
import { format, isToday } from 'date-fns'
import { motion } from 'framer-motion'
import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  BarChart3,
  Activity,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type {
  TeamPerformanceData,
  WeeklyPerformance,
  WorkingArea,
} from '../types/team-performance.types'
import { AssociateList } from './associate-performance-row'
import { DepartmentGrid, AreaGrid } from './department-card'
import { CombinedPerformanceChart } from './performance-chart'

interface HistoricalViewProps {
  data: TeamPerformanceData | undefined
  weeklyTrend: WeeklyPerformance | undefined
  isLoading: boolean
  selectedDate: Date
  departments: string[]
  workingAreas: WorkingArea[]
  onDateChange: (date: Date) => void
  onPreviousDay: () => void
  onNextDay: () => void
  onGoToToday: () => void
  onExport: () => void
  canGoForward: boolean
  className?: string
  activeTab?: string
  onTabChange?: (tab: string) => void
}

export function HistoricalView({
  data,
  weeklyTrend,
  isLoading,
  selectedDate,
  departments: _departments,
  workingAreas: _workingAreas,
  onDateChange,
  onPreviousDay,
  onNextDay,
  onGoToToday,
  onExport,
  canGoForward,
  className,
  activeTab: mainTab = 'historical',
  onTabChange,
}: HistoricalViewProps) {
  // _departments and _workingAreas are available for future filter enhancements
  void _departments
  void _workingAreas
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [detailTab, setDetailTab] = useState<
    'overview' | 'departments' | 'areas' | 'associates'
  >('overview')
  const [searchQuery, setSearchQuery] = useState('')

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      onDateChange(date)
      setCalendarOpen(false)
    }
  }

  if (isLoading) {
    return (
      <HistoricalViewSkeleton mainTab={mainTab} onTabChange={onTabChange} />
    )
  }

  return (
    <motion.div
      className={cn('space-y-6', className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header with Tabs and Search - All in one card */}
      <Card>
        <CardContent className='py-4'>
          <div className='flex flex-col items-start gap-4 xl:flex-row xl:items-center'>
            {/* Tabs - Inline with search */}
            <TabsList className='grid w-full max-w-[240px] flex-shrink-0 grid-cols-2'>
              <TabsTrigger
                value='realtime'
                className='flex items-center gap-2'
                onClick={() => onTabChange?.('realtime')}
              >
                <Activity className='h-4 w-4' />
                Real-time
              </TabsTrigger>
              <TabsTrigger
                value='historical'
                className='flex items-center gap-2'
                onClick={() => onTabChange?.('historical')}
              >
                <BarChart3 className='h-4 w-4' />
                Historical
              </TabsTrigger>
            </TabsList>

            {/* Search */}
            <div className='relative max-w-sm flex-1'>
              <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
              <Input
                placeholder='Search associates...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='pl-9'
              />
            </div>

            {/* Date Navigation */}
            <div className='flex items-center gap-1'>
              <Button variant='outline' size='icon' onClick={onPreviousDay}>
                <ChevronLeft className='h-4 w-4' />
              </Button>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant='outline'
                    className='min-w-[180px] justify-start text-left font-normal'
                  >
                    <CalendarIcon className='mr-2 h-4 w-4' />
                    {format(selectedDate, 'MMM d, yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className='w-auto p-0' align='start'>
                  <Calendar
                    mode='single'
                    selected={selectedDate}
                    onSelect={handleDateSelect}
                    initialFocus
                    disabled={(date) => date > new Date()}
                  />
                </PopoverContent>
              </Popover>
              <Button
                variant='outline'
                size='icon'
                onClick={onNextDay}
                disabled={!canGoForward}
              >
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>

            {!isToday(selectedDate) && (
              <Button variant='ghost' size='sm' onClick={onGoToToday}>
                Today
              </Button>
            )}
            {isToday(selectedDate) && <Badge variant='default'>Today</Badge>}

            {/* Export Button */}
            <Button
              variant='outline'
              size='sm'
              onClick={onExport}
              className='ml-auto'
            >
              <Download className='mr-2 h-4 w-4' />
              Export
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* No Data State */}
      {!data && (
        <div className='py-12 text-center'>
          <BarChart3 className='text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50' />
          <p className='text-muted-foreground'>
            No performance data for this date
          </p>
          <Button variant='outline' onClick={onGoToToday} className='mt-4'>
            Go to Today
          </Button>
        </div>
      )}

      {data && (
        <>
          {/* Weekly Performance Chart */}
          {weeklyTrend && (
            <CombinedPerformanceChart weeklyPerformance={weeklyTrend} />
          )}

          {/* Detailed Tabs */}
          <Tabs
            value={detailTab}
            onValueChange={(v) =>
              setDetailTab(
                v as 'overview' | 'departments' | 'areas' | 'associates'
              )
            }
          >
            <TabsList className='grid w-full max-w-md grid-cols-2 md:grid-cols-4'>
              <TabsTrigger value='overview'>Overview</TabsTrigger>
              <TabsTrigger value='departments'>Departments</TabsTrigger>
              <TabsTrigger value='areas'>Areas</TabsTrigger>
              <TabsTrigger value='associates'>Associates</TabsTrigger>
            </TabsList>

            <TabsContent value='overview' className='mt-6 space-y-6'>
              {/* Task Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle>Task Breakdown</CardTitle>
                  <CardDescription>
                    Summary of all tasks completed on this day
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8'>
                    <TaskStatCard
                      label='Inbound Scans'
                      value={data.stats.inbound_scans}
                    />
                    <TaskStatCard
                      label='Put Aways'
                      value={data.stats.put_aways}
                    />
                    <TaskStatCard label='Picking' value={data.stats.picking} />
                    <TaskStatCard label='Packed' value={data.stats.packed} />
                    <TaskStatCard label='Shipped' value={data.stats.shipped} />
                    <TaskStatCard
                      label='Final Packed'
                      value={data.stats.final_packed}
                    />
                    <TaskStatCard
                      label='Putbacks'
                      value={data.stats.putbacks}
                    />
                    <TaskStatCard
                      label='Cycle Counts'
                      value={data.stats.cycle_counts}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Labor Standards Comparison */}
              {data.laborStandardComparisons.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Labor Standards Performance</CardTitle>
                    <CardDescription>
                      Comparison against defined productivity standards
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className='space-y-3'>
                      {data.laborStandardComparisons.map((comparison) => (
                        <div
                          key={comparison.standard_id}
                          className='bg-muted/50 flex items-center justify-between rounded-lg p-3'
                        >
                          <div>
                            <p className='font-medium'>
                              {comparison.standard_name}
                            </p>
                            <p className='text-muted-foreground text-sm'>
                              {comparison.task_type} • {comparison.target_value}{' '}
                              {comparison.unit_of_measure}
                            </p>
                          </div>
                          <div className='flex items-center gap-3'>
                            <div className='text-right'>
                              <p className='font-semibold'>
                                {comparison.actual_value}
                              </p>
                              <p className='text-muted-foreground text-xs'>
                                Actual
                              </p>
                            </div>
                            <Badge
                              variant={
                                comparison.status === 'excellent'
                                  ? 'default'
                                  : comparison.status === 'meets'
                                    ? 'default'
                                    : comparison.status === 'below'
                                      ? 'secondary'
                                      : 'destructive'
                              }
                            >
                              {comparison.efficiency_percentage}%
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value='departments' className='mt-6'>
              <DepartmentGrid
                departments={data.byDepartment}
                columns={2}
                showAssociates={true}
              />
            </TabsContent>

            <TabsContent value='areas' className='mt-6'>
              <AreaGrid areas={data.byArea} columns={2} showAssociates={true} />
            </TabsContent>

            <TabsContent value='associates' className='mt-6'>
              <Card>
                <CardHeader>
                  <CardTitle className='flex items-center justify-between'>
                    <div>
                      <span>All Associates ({data.associates.length})</span>
                      <p className='text-muted-foreground mt-1 text-sm font-normal'>
                        Click on a row to expand and view task breakdown by area
                        with Gantt timeline
                      </p>
                    </div>
                    <Badge variant='secondary'>
                      {data.summary.activeAssociates} active
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <AssociateList
                    associates={data.associates}
                    showArea={true}
                    showPosition={true}
                    expandable={true}
                    maxHeight='800px'
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </motion.div>
  )
}

// Task stat card for breakdown
function TaskStatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className='bg-muted/50 rounded-lg p-3 text-center'>
      <p className='text-2xl font-bold'>{value.toLocaleString()}</p>
      <p className='text-muted-foreground text-xs'>{label}</p>
    </div>
  )
}

// Loading skeleton
function HistoricalViewSkeleton({
  onTabChange,
}: {
  mainTab?: string
  onTabChange?: (tab: string) => void
}) {
  return (
    <div className='space-y-6'>
      {/* Header with Tabs and Search */}
      <Card>
        <CardContent className='py-4'>
          <div className='flex flex-col items-start gap-4 xl:flex-row xl:items-center'>
            {/* Tabs */}
            <TabsList className='grid w-full max-w-[240px] flex-shrink-0 grid-cols-2'>
              <TabsTrigger
                value='realtime'
                className='flex items-center gap-2'
                onClick={() => onTabChange?.('realtime')}
              >
                <Activity className='h-4 w-4' />
                Real-time
              </TabsTrigger>
              <TabsTrigger
                value='historical'
                className='flex items-center gap-2'
                onClick={() => onTabChange?.('historical')}
              >
                <BarChart3 className='h-4 w-4' />
                Historical
              </TabsTrigger>
            </TabsList>

            {/* Search Skeleton */}
            <Skeleton className='h-10 w-full max-w-sm' />

            {/* Date Navigation Skeleton */}
            <div className='flex items-center gap-1'>
              <Skeleton className='h-9 w-9' />
              <Skeleton className='h-9 w-[180px]' />
              <Skeleton className='h-9 w-9' />
            </div>

            {/* Export Skeleton */}
            <Skeleton className='ml-auto h-9 w-24' />
          </div>
        </CardContent>
      </Card>

      {/* Chart */}
      <Skeleton className='h-[400px] rounded-lg' />

      {/* Tabs */}
      <Skeleton className='h-10 w-full max-w-md rounded-lg' />

      {/* Content */}
      <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
        <Skeleton className='h-80 rounded-lg' />
        <Skeleton className='h-80 rounded-lg' />
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
