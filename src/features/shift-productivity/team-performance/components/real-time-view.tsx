// Created and developed by Jai Singh
/**
 * Real-Time View Component
 * Current shift status with auto-refresh functionality
 * Created: December 20, 2025
 * Updated: January 1, 2026 - Consolidated all functionality, added date picker, removed Historical tab dependency
 * Updated: January 2, 2026 - Added More dropdown with Add Events functionality
 */
import { useState, useCallback, lazy, Suspense } from 'react'
import { format, isToday } from 'date-fns'
import { motion } from 'framer-motion'
import {
  TrendingUp,
  Clock,
  RefreshCw,
  Search,
  Activity,
  LineChart,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  ChevronDown,
  CalendarPlus,
  Settings,
  Download,
  LayoutGrid,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { WorkingArea as LaborWorkingArea } from '@/lib/supabase/labor-management.service'
import type { ApprovedOvertimeForTimeline } from '@/lib/supabase/overtime.service'
import type { TimelineEventWithCategory } from '@/lib/supabase/timeline-events.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  TeamPerformanceData,
  WorkingArea,
  WeeklyPerformance,
} from '../types/team-performance.types'
import { AddEventDialog } from './add-event-dialog'
import { AssociateList } from './associate-performance-row'
import { AreaGrid } from './department-card'
import { PulseIndicator } from './kpi-card'
import { ManageEventsDialog } from './manage-events-dialog'
import { ManageOvertimeDialog } from './manage-overtime-dialog'
import { CombinedPerformanceChart } from './performance-chart'

const LaborBoard = lazy(() => import('./labor-board'))

interface RealTimeViewProps {
  data: TeamPerformanceData | undefined
  weeklyTrend?: WeeklyPerformance
  isLoading: boolean
  workingAreas: WorkingArea[]
  departments?: string[]
  timelineEvents?: TimelineEventWithCategory[]
  approvedOvertime?: ApprovedOvertimeForTimeline[]
  onRefresh: () => void
  onFilterChange: (filters: {
    departments?: string[]
    areas?: string[]
    search?: string
    sortBy?: 'name' | 'efficiency' | 'tasks' | 'department' | 'area'
    sortOrder?: 'asc' | 'desc'
  }) => void
  // Date navigation props
  selectedDate: Date
  onDateChange: (date: Date) => void
  onPreviousDay: () => void
  onNextDay: () => void
  onGoToToday: () => void
  canGoForward: boolean
  // Other props
  lastUpdated?: Date
  className?: string
  timezone?: string
  // Export handler
  onExport?: () => void
}

export function RealTimeView({
  data,
  weeklyTrend,
  isLoading,
  workingAreas,
  departments = [],
  timelineEvents = [],
  approvedOvertime = [],
  onRefresh,
  onFilterChange,
  selectedDate,
  onDateChange,
  onPreviousDay,
  onNextDay,
  onGoToToday,
  canGoForward,
  lastUpdated,
  className,
  timezone,
  onExport,
}: RealTimeViewProps) {
  const [viewMode, setViewMode] = useState<
    'all' | 'area' | 'analytics' | 'labor-board' | 'leaderboard'
  >('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedArea, setSelectedArea] = useState<string>('all')
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all')
  const [sortConfig, setSortConfig] = useState<{
    field: string
    order: 'asc' | 'desc'
  }>({ field: 'name', order: 'asc' })
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [addEventDialogOpen, setAddEventDialogOpen] = useState(false)
  const [manageEventsDialogOpen, setManageEventsDialogOpen] = useState(false)
  const [manageOvertimeDialogOpen, setManageOvertimeDialogOpen] =
    useState(false)

  // Get organization ID for event creation
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  // Handle export
  const handleExport = useCallback(() => {
    if (!onExport) {
      toast.error('Export functionality not available')
      return
    }
    if (!data) {
      toast.warning('No data to export')
      return
    }
    try {
      onExport()
      toast.success('Export downloaded successfully')
    } catch (error) {
      logger.error('Export error:', error)
      toast.error('Failed to export data')
    }
  }, [onExport, data])

  // Handle date selection from calendar
  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      onDateChange(date)
      setCalendarOpen(false)
    }
  }

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query)
    onFilterChange({ search: query })
  }

  // Handle area filter
  const handleAreaChange = (areaId: string) => {
    setSelectedArea(areaId)
    onFilterChange({
      areas: areaId === 'all' ? undefined : [areaId],
    })
  }

  // Handle department filter
  const handleDepartmentChange = (dept: string) => {
    setSelectedDepartment(dept)
    onFilterChange({
      departments: dept === 'all' ? undefined : [dept],
    })
  }

  // Handle sort change
  const handleSortChange = (value: string) => {
    const [field, order] = value.split('-') as [string, 'asc' | 'desc']
    setSortConfig({ field, order })
    onFilterChange({
      sortBy: field as 'name' | 'efficiency' | 'tasks' | 'department' | 'area',
      sortOrder: order,
    })
  }

  if (isLoading) {
    return <RealTimeViewSkeleton />
  }

  if (!data) {
    return (
      <div className='space-y-6'>
        {/* Header with Search and Date Picker */}
        <Card>
          <CardContent className='py-4'>
            <div className='flex flex-col items-start gap-4 lg:flex-row lg:items-center'>
              {/* Search */}
              <div className='relative max-w-sm flex-1'>
                <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                <Input
                  placeholder='Search associates...'
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className='pl-9'
                />
              </div>

              {/* Date Navigation - Right side */}
              <div className='ml-auto flex items-center gap-1'>
                <Button variant='outline' size='icon' onClick={onPreviousDay}>
                  <ChevronLeft className='h-4 w-4' />
                </Button>
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant='outline'
                      className='min-w-[160px] justify-start text-left font-normal'
                    >
                      <CalendarIcon className='mr-2 h-4 w-4' />
                      {format(selectedDate, 'MMM d, yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className='w-auto p-0' align='end'>
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
                {!isToday(selectedDate) && (
                  <Button variant='ghost' size='sm' onClick={onGoToToday}>
                    Today
                  </Button>
                )}
                {isToday(selectedDate) && (
                  <Badge variant='default'>Today</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className='py-12 text-center'>
          <Activity className='text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50' />
          <p className='text-muted-foreground'>
            No performance data available for{' '}
            {format(selectedDate, 'MMMM d, yyyy')}
          </p>
          <div className='mt-4 flex justify-center gap-2'>
            <Button variant='outline' onClick={onGoToToday}>
              Go to Today
            </Button>
            <Button variant='outline' onClick={onRefresh}>
              <RefreshCw className='mr-2 h-4 w-4' />
              Refresh
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const { summary, byArea, associates } = data

  return (
    <motion.div
      className={cn('space-y-6', className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header with Search, Filters, and Date Picker */}
      <Card>
        <CardContent className='py-4'>
          <div className='flex flex-col items-start gap-4 xl:flex-row xl:items-center'>
            {/* Search */}
            <div className='relative max-w-sm flex-1'>
              <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
              <Input
                placeholder='Search associates...'
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className='pl-9'
              />
            </div>

            {/* Area Filter */}
            <Select value={selectedArea} onValueChange={handleAreaChange}>
              <SelectTrigger className='w-[180px]'>
                <SelectValue placeholder='All Areas' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Areas</SelectItem>
                {workingAreas.map((area) => (
                  <SelectItem key={area.id} value={area.id}>
                    {area.area_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Department Filter */}
            <Select
              value={selectedDepartment}
              onValueChange={handleDepartmentChange}
            >
              <SelectTrigger className='w-[180px]'>
                <SelectValue placeholder='Department' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Sort Dropdown */}
            <Select
              value={`${sortConfig.field}-${sortConfig.order}`}
              onValueChange={handleSortChange}
            >
              <SelectTrigger className='w-[180px]'>
                <SelectValue placeholder='Sort by' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='name-asc'>Name (A-Z)</SelectItem>
                <SelectItem value='name-desc'>Name (Z-A)</SelectItem>
                <SelectItem value='efficiency-desc'>
                  Efficiency (High-Low)
                </SelectItem>
                <SelectItem value='efficiency-asc'>
                  Efficiency (Low-High)
                </SelectItem>
                <SelectItem value='tasks-desc'>Tasks (High-Low)</SelectItem>
                <SelectItem value='tasks-asc'>Tasks (Low-High)</SelectItem>
                <SelectItem value='department-asc'>Department (A-Z)</SelectItem>
                <SelectItem value='area-asc'>Area (A-Z)</SelectItem>
              </SelectContent>
            </Select>

            {/* Refresh Action */}
            <Button variant='outline' size='sm' onClick={onRefresh}>
              <RefreshCw className='mr-2 h-4 w-4' />
              Refresh
            </Button>

            {/* More Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  size='sm'
                  className='border-border hover:bg-accent'
                >
                  <MoreHorizontal className='mr-2 h-4 w-4' />
                  More
                  <ChevronDown className='ml-2 h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                className='bg-background border-border w-56'
              >
                <DropdownMenuItem
                  onClick={() => setAddEventDialogOpen(true)}
                  className='hover:bg-accent cursor-pointer'
                >
                  <CalendarPlus className='mr-2 h-4 w-4' />
                  Add Event
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setManageEventsDialogOpen(true)}
                  className='hover:bg-accent cursor-pointer'
                >
                  <Settings className='mr-2 h-4 w-4' />
                  Manage Events
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setManageOvertimeDialogOpen(true)}
                  className='hover:bg-accent cursor-pointer'
                >
                  <Clock className='mr-2 h-4 w-4' />
                  Manage Overtime
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleExport}
                  className='hover:bg-accent cursor-pointer'
                >
                  <Download className='mr-2 h-4 w-4' />
                  Export to CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onRefresh}
                  className='hover:bg-accent cursor-pointer'
                >
                  <RefreshCw className='mr-2 h-4 w-4' />
                  Refresh Data
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSearchQuery('')}
                  className='hover:bg-accent cursor-pointer'
                >
                  <Search className='mr-2 h-4 w-4' />
                  Clear Search
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Date Navigation - Right side (where Export was) */}
            <div className='ml-auto flex flex-shrink-0 items-center gap-1'>
              <Button variant='outline' size='icon' onClick={onPreviousDay}>
                <ChevronLeft className='h-4 w-4' />
              </Button>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant='outline'
                    className='min-w-[160px] justify-start text-left font-normal'
                  >
                    <CalendarIcon className='mr-2 h-4 w-4' />
                    {format(selectedDate, 'MMM d, yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className='w-auto p-0' align='end'>
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
              {!isToday(selectedDate) && (
                <Button variant='ghost' size='sm' onClick={onGoToToday}>
                  Today
                </Button>
              )}
              {isToday(selectedDate) && <Badge variant='default'>Today</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shift Status Header - Dynamic based on selected date */}
      <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
        <div className='flex items-center gap-3'>
          <PulseIndicator
            active={isToday(selectedDate)}
            color={isToday(selectedDate) ? 'green' : 'blue'}
            size='md'
          />
          <div>
            <h3 className='text-lg font-semibold'>
              {isToday(selectedDate)
                ? 'Current Shift Status'
                : `Performance for ${format(selectedDate, 'MMMM d, yyyy')}`}
            </h3>
            <p className='text-muted-foreground text-sm'>
              {isToday(selectedDate)
                ? lastUpdated
                  ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                  : 'Live data'
                : 'Historical data'}
            </p>
          </div>
        </div>
        {/* View Toggle */}
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground text-sm'>View:</span>
          <div className='flex overflow-hidden rounded-lg border'>
            <Button
              variant={viewMode === 'all' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => setViewMode('all')}
              className='rounded-none'
            >
              All
            </Button>
            <Button
              variant={viewMode === 'area' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => setViewMode('area')}
              className='rounded-none'
            >
              Areas
            </Button>
            <Button
              variant={viewMode === 'analytics' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => setViewMode('analytics')}
              className='rounded-none'
            >
              Analytics
            </Button>
            <Button
              variant={viewMode === 'labor-board' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => setViewMode('labor-board')}
              className='gap-1.5 rounded-none'
            >
              <LayoutGrid className='h-3.5 w-3.5' />
              Labor Board
            </Button>
            <Button
              variant={viewMode === 'leaderboard' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => setViewMode('leaderboard')}
              className='rounded-none'
            >
              Leaderboard
            </Button>
          </div>
        </div>
      </div>

      {/* Content based on view mode */}
      {viewMode === 'all' && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center justify-between'>
              <div>
                <span>All Associates ({associates.length})</span>
                <p className='text-muted-foreground mt-1 text-sm font-normal'>
                  Click on a row to expand and view task breakdown by area with
                  Gantt timeline
                </p>
              </div>
              <Badge variant='secondary'>
                {summary.activeAssociates} active
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AssociateList
              associates={associates}
              showArea={true}
              showPosition={true}
              expandable={true}
              maxHeight='calc(100vh - 280px)'
              timelineEvents={timelineEvents}
              approvedOvertime={approvedOvertime}
              timezone={timezone}
            />
          </CardContent>
        </Card>
      )}

      {viewMode === 'area' && (
        <AreaGrid areas={byArea} columns={2} showAssociates={true} />
      )}

      {/* Analytics View - Performance Charts */}
      {viewMode === 'analytics' && (
        <div className='space-y-6'>
          {weeklyTrend ? (
            <CombinedPerformanceChart weeklyPerformance={weeklyTrend} />
          ) : (
            <Card>
              <CardContent className='py-12'>
                <div className='text-center'>
                  <LineChart className='text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50' />
                  <p className='text-muted-foreground'>
                    No analytics data available
                  </p>
                  <p className='text-muted-foreground mt-1 text-sm'>
                    Performance analytics will appear here once data is
                    collected
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Labor Board View - Interactive Drag & Drop */}
      {viewMode === 'labor-board' && (
        <Suspense
          fallback={
            <div className='flex gap-3 overflow-hidden'>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className='w-[300px] min-w-[300px] space-y-3 rounded-xl border p-3'
                >
                  <Skeleton className='h-6 w-3/4' />
                  <Skeleton className='h-1.5 w-full' />
                  <div className='space-y-2'>
                    {Array.from({ length: 3 }).map((_, j) => (
                      <Skeleton key={j} className='h-14 w-full rounded-lg' />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          }
        >
          <LaborBoard
            data={data}
            isLoading={isLoading}
            isToday={isToday(selectedDate)}
            organizationId={organizationId || ''}
          />
        </Suspense>
      )}

      {/* Leaderboard View - Top Performers & Needs Attention */}
      {viewMode === 'leaderboard' && (
        <div className='space-y-6'>
          <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
            {/* Top Performers */}
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <TrendingUp className='h-5 w-5 text-green-600' />
                  Top Performers
                  {summary.topPerformers.length > 0 && (
                    <Badge variant='secondary' className='ml-auto'>
                      {summary.topPerformers.length}
                    </Badge>
                  )}
                </CardTitle>
                <p className='text-muted-foreground text-sm'>
                  Associates exceeding performance standards
                </p>
              </CardHeader>
              <CardContent>
                {summary.topPerformers.length > 0 ? (
                  <AssociateList
                    associates={summary.topPerformers}
                    showArea={true}
                    showPosition={true}
                    compact={false}
                    expandable={true}
                    maxHeight='500px'
                    timelineEvents={timelineEvents}
                    approvedOvertime={approvedOvertime}
                    timezone={timezone}
                  />
                ) : (
                  <div className='py-8 text-center'>
                    <TrendingUp className='text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50' />
                    <p className='text-muted-foreground'>
                      No top performers data available
                    </p>
                    <p className='text-muted-foreground mt-1 text-sm'>
                      Associates with efficiency ≥85% will appear here
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Needs Attention */}
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <Clock className='h-5 w-5 text-yellow-600' />
                  Needs Attention
                  {summary.needsAttention.length > 0 && (
                    <Badge variant='destructive' className='ml-auto'>
                      {summary.needsAttention.length}
                    </Badge>
                  )}
                </CardTitle>
                <p className='text-muted-foreground text-sm'>
                  Associates below minimum performance thresholds
                </p>
              </CardHeader>
              <CardContent>
                {summary.needsAttention.length > 0 ? (
                  <AssociateList
                    associates={summary.needsAttention}
                    showArea={true}
                    showPosition={true}
                    compact={false}
                    expandable={true}
                    maxHeight='500px'
                    timelineEvents={timelineEvents}
                    approvedOvertime={approvedOvertime}
                    timezone={timezone}
                  />
                ) : (
                  <div className='py-8 text-center'>
                    <Clock className='mx-auto mb-4 h-12 w-12 text-green-500 opacity-70' />
                    <p className='text-muted-foreground'>
                      All associates performing well!
                    </p>
                    <p className='text-muted-foreground mt-1 text-sm'>
                      No one is below the minimum acceptable threshold
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Add Event Dialog */}
      {organizationId && (
        <AddEventDialog
          open={addEventDialogOpen}
          onOpenChange={setAddEventDialogOpen}
          organizationId={organizationId}
          workingAreas={workingAreas as LaborWorkingArea[]}
          selectedDate={selectedDate}
          onEventCreated={onRefresh}
        />
      )}

      {/* Manage Events Dialog */}
      {organizationId && (
        <ManageEventsDialog
          open={manageEventsDialogOpen}
          onOpenChange={setManageEventsDialogOpen}
          organizationId={organizationId}
          workingAreas={workingAreas as LaborWorkingArea[]}
          selectedDate={selectedDate}
          onEventsChanged={onRefresh}
        />
      )}

      {/* Manage Overtime Dialog */}
      {organizationId && (
        <ManageOvertimeDialog
          open={manageOvertimeDialogOpen}
          onOpenChange={setManageOvertimeDialogOpen}
          organizationId={organizationId}
          workingAreas={workingAreas as LaborWorkingArea[]}
          selectedDate={selectedDate}
          onOvertimeChanged={onRefresh}
        />
      )}
    </motion.div>
  )
}

// Loading skeleton
function RealTimeViewSkeleton() {
  return (
    <div className='space-y-6'>
      {/* Header with Date Picker and Search */}
      <Card>
        <CardContent className='py-4'>
          <div className='flex flex-col items-start gap-4 xl:flex-row xl:items-center'>
            {/* Date Navigation Skeleton */}
            <div className='flex items-center gap-1'>
              <Skeleton className='h-9 w-9' />
              <Skeleton className='h-9 w-[160px]' />
              <Skeleton className='h-9 w-9' />
              <Skeleton className='h-9 w-16' />
            </div>

            {/* Search Skeleton */}
            <Skeleton className='h-10 w-full max-w-sm' />

            {/* Filter Skeletons */}
            <Skeleton className='h-10 w-[180px]' />
            <Skeleton className='h-10 w-[180px]' />

            {/* Actions */}
            <div className='ml-auto flex gap-2'>
              <Skeleton className='h-9 w-24' />
              <Skeleton className='h-9 w-24' />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-3 w-3 rounded-full' />
          <div>
            <Skeleton className='mb-1 h-5 w-40' />
            <Skeleton className='h-4 w-32' />
          </div>
        </div>
        <Skeleton className='h-9 w-64' />
      </div>

      {/* Content */}
      <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
        <Skeleton className='h-80 rounded-lg' />
        <Skeleton className='h-80 rounded-lg' />
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
