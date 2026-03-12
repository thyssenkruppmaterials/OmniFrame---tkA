/**
 * Associate Performance Dashboard
 * Single-associate focused view with comprehensive performance metrics
 * Created: December 27, 2025
 * Redesigned: January 1, 2026 - Complete redesign for single-associate deep-dive
 * Fixed: January 1, 2026 - Fixed date selection to work properly with per-day data
 * Fixed: January 1, 2026 - Fixed multi-date range aggregation: totals now properly aggregate across date range
 */
import { useEffect, useMemo, useState } from 'react'
import {
  endOfDay,
  format,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns'
import { motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  CalendarIcon,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Info,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Shield,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  Zap,
} from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ActivityGantt,
  ActivityLegend,
} from '../team-performance/components/activity-gantt'
import { useTeamPerformance } from '../team-performance/hooks/use-team-performance'
import type {
  AssociateProductivity,
  TaskBreakdownByArea,
} from '../team-performance/types/team-performance.types'
import { getEfficiencyStatus } from '../team-performance/types/team-performance.types'

// Custom tooltip props interface for recharts custom tooltips
interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    value: number
    name: string
    color: string
    dataKey?: string
  }>
  label?: string
}

interface AssociatePerformanceDashboardProps {
  className?: string
}

// Date range presets
const DATE_RANGE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 14 Days', days: 14 },
  { label: 'Last 30 Days', days: 30 },
  { label: 'This Week', days: -1 }, // Special case
  { label: 'This Month', days: -2 }, // Special case
] as const

export function AssociatePerformanceDashboard({
  className,
}: AssociatePerformanceDashboardProps) {
  const [selectedAssociateId, setSelectedAssociateId] = useState<string | null>(
    null
  )
  const [associateDropdownOpen, setAssociateDropdownOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)

  // Date mode state: 'single' for single day, 'range' for date range
  const [dateMode, setDateMode] = useState<'single' | 'range'>('single')
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [activePreset, setActivePreset] = useState<string | null>('Today')

  const {
    performanceData,
    isLoadingPerformance,
    refresh,
    organizationId,
    selectedDate,
    setSelectedDate,
    goToPreviousDay,
    goToNextDay,
    goToToday,
    canGoForward,
    // Date range support for multi-day aggregation
    setDateRangeFilter,
    clearDateRange,
    // Timeline events and overtime for activity visualization
    timelineEvents,
    approvedOvertime,
  } = useTeamPerformance({
    autoRefresh: true,
    refreshInterval: 60000,
    // Pass dateRange when in range mode
    dateRange:
      dateMode === 'range' && dateRange?.from && dateRange?.to
        ? dateRange
        : undefined,
    // Enable timeline events and overtime for gantt visualization
    enableTimelineEvents: true,
    enableOvertimeRequests: true,
  })

  // Handle preset selection
  const handlePresetSelect = (preset: (typeof DATE_RANGE_PRESETS)[number]) => {
    const today = new Date()
    setActivePreset(preset.label)

    if (preset.days === 0) {
      // Today - single day mode
      setDateMode('single')
      setSelectedDate(today)
      setDateRange(undefined)
      clearDateRange() // Clear hook's date range
    } else if (preset.days === -1) {
      // This Week
      setDateMode('range')
      const weekStart = startOfWeek(today, { weekStartsOn: 0 })
      const from = startOfDay(weekStart)
      const to = endOfDay(today)
      setDateRange({ from, to })
      setSelectedDate(today)
      setDateRangeFilter(from, to) // Trigger aggregated data fetch
    } else if (preset.days === -2) {
      // This Month
      setDateMode('range')
      const monthStart = startOfMonth(today)
      const from = startOfDay(monthStart)
      const to = endOfDay(today)
      setDateRange({ from, to })
      setSelectedDate(today)
      setDateRangeFilter(from, to) // Trigger aggregated data fetch
    } else {
      // Last N days
      setDateMode('range')
      const from = startOfDay(subDays(today, preset.days - 1))
      const to = endOfDay(today)
      setDateRange({ from, to })
      setSelectedDate(today)
      setDateRangeFilter(from, to) // Trigger aggregated data fetch
    }
    setCalendarOpen(false)
  }

  // Sync local dateRange with hook and manage preset matching
  useEffect(() => {
    if (dateRange?.from && dateRange?.to) {
      // Check if this matches any preset - if not, clear the active preset
      const today = new Date()
      const fromTime = startOfDay(dateRange.from).getTime()
      const toTime = startOfDay(dateRange.to).getTime()
      const todayTime = startOfDay(today).getTime()

      // Check if it matches a preset
      const matchesPreset = DATE_RANGE_PRESETS.some((preset) => {
        if (preset.days === 0) return false // Today is single mode
        if (preset.days === -1) {
          const weekStart = startOfWeek(today, { weekStartsOn: 0 })
          return (
            fromTime === startOfDay(weekStart).getTime() && toTime === todayTime
          )
        }
        if (preset.days === -2) {
          const monthStart = startOfMonth(today)
          return (
            fromTime === startOfDay(monthStart).getTime() &&
            toTime === todayTime
          )
        }
        const expectedFrom = subDays(today, preset.days - 1)
        return (
          fromTime === startOfDay(expectedFrom).getTime() &&
          toTime === todayTime
        )
      })

      if (!matchesPreset) {
        setActivePreset(null)
      }
    }
  }, [dateRange])

  // Switch to single day mode
  const handleSwitchToSingleDay = () => {
    setDateMode('single')
    setDateRange(undefined)
    setActivePreset('Today')
    clearDateRange() // Clear hook's date range to trigger single-day fetch
    goToToday()
  }

  // Get all associates sorted by name
  const sortedAssociates = useMemo(() => {
    if (!performanceData?.associates) return []
    return [...performanceData.associates].sort((a, b) =>
      a.user_name.localeCompare(b.user_name)
    )
  }, [performanceData?.associates])

  // Auto-select first associate when data loads
  useEffect(() => {
    if (!selectedAssociateId && sortedAssociates.length > 0) {
      setSelectedAssociateId(sortedAssociates[0].user_id)
    }
  }, [sortedAssociates, selectedAssociateId])

  // Get selected associate data
  const selectedAssociate = useMemo(() => {
    if (!selectedAssociateId || !performanceData?.associates) return null
    return (
      performanceData.associates.find(
        (a) => a.user_id === selectedAssociateId
      ) || null
    )
  }, [selectedAssociateId, performanceData?.associates])

  // Handle date selection from calendar
  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date)
      setCalendarOpen(false)
    }
  }

  if (!organizationId) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <p className='text-muted-foreground'>Organization not found</p>
      </div>
    )
  }

  if (isLoadingPerformance) {
    return <AssociatePerformanceSkeleton />
  }

  if (!performanceData || sortedAssociates.length === 0) {
    const dateDisplayText =
      dateMode === 'single'
        ? format(selectedDate, 'MMMM d, yyyy')
        : dateRange?.from && dateRange?.to
          ? `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`
          : format(selectedDate, 'MMMM d, yyyy')

    return (
      <div className='py-12 text-center'>
        <Users className='text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50' />
        <p className='text-muted-foreground'>
          No performance data available for {dateDisplayText}
        </p>
        <div className='mt-4 flex justify-center gap-2'>
          {!isToday(selectedDate) && (
            <Button variant='outline' onClick={handleSwitchToSingleDay}>
              Go to Today
            </Button>
          )}
          <Button variant='outline' onClick={refresh}>
            <RefreshCw className='mr-2 h-4 w-4' />
            Refresh Data
          </Button>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      className={cn('space-y-6', className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header with Selectors */}
      <Card>
        <CardContent className='py-4'>
          <div className='flex flex-col items-start gap-4 lg:flex-row lg:items-center'>
            {/* Associate Selector */}
            <div className='max-w-sm flex-1'>
              <Popover
                open={associateDropdownOpen}
                onOpenChange={setAssociateDropdownOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant='outline'
                    role='combobox'
                    aria-expanded={associateDropdownOpen}
                    className='h-auto w-full justify-between py-2'
                  >
                    {selectedAssociate ? (
                      <div className='flex items-center gap-3'>
                        <Avatar className='h-8 w-8'>
                          <AvatarImage src={selectedAssociate.avatar_url} />
                          <AvatarFallback className='bg-primary/10 text-xs'>
                            {getInitials(selectedAssociate.user_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className='text-left'>
                          <p className='font-medium'>
                            {selectedAssociate.user_name}
                          </p>
                          <p className='text-muted-foreground text-xs'>
                            {selectedAssociate.position_title ||
                              selectedAssociate.working_area_name ||
                              'No position'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <span className='text-muted-foreground'>
                        Select associate...
                      </span>
                    )}
                    <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className='w-[350px] p-0' align='start'>
                  <Command>
                    <CommandInput placeholder='Search associates...' />
                    <CommandList>
                      <CommandEmpty>No associate found.</CommandEmpty>
                      <CommandGroup>
                        {sortedAssociates.map((associate) => (
                          <CommandItem
                            key={associate.user_id}
                            value={associate.user_name}
                            onSelect={() => {
                              setSelectedAssociateId(associate.user_id)
                              setAssociateDropdownOpen(false)
                            }}
                            className='flex items-center gap-3 py-2'
                          >
                            <Avatar className='h-8 w-8'>
                              <AvatarImage src={associate.avatar_url} />
                              <AvatarFallback className='bg-primary/10 text-xs'>
                                {getInitials(associate.user_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className='min-w-0 flex-1'>
                              <p className='truncate font-medium'>
                                {associate.user_name}
                              </p>
                              <p className='text-muted-foreground truncate text-xs'>
                                {associate.position_title ||
                                  associate.working_area_name ||
                                  'No position'}
                              </p>
                            </div>
                            <StatusIndicator status={associate.status} />
                            {selectedAssociateId === associate.user_id && (
                              <Check className='text-primary h-4 w-4' />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Spacer */}
            <div className='flex-1' />

            {/* Date Navigation */}
            <div className='flex items-center gap-2'>
              {/* Single Day Navigation (only show in single mode) */}
              {dateMode === 'single' && (
                <div className='flex items-center gap-1'>
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={goToPreviousDay}
                  >
                    <ChevronLeft className='h-4 w-4' />
                  </Button>
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={goToNextDay}
                    disabled={!canGoForward}
                  >
                    <ChevronRight className='h-4 w-4' />
                  </Button>
                </div>
              )}

              {/* Date/Range Picker */}
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant='outline'
                    className={cn(
                      'min-w-[200px] justify-start text-left font-normal',
                      dateMode === 'range' && 'min-w-[280px]'
                    )}
                  >
                    {dateMode === 'single' ? (
                      <>
                        <CalendarIcon className='mr-2 h-4 w-4' />
                        {format(selectedDate, 'MMM d, yyyy')}
                      </>
                    ) : (
                      <>
                        <CalendarRange className='mr-2 h-4 w-4' />
                        {dateRange?.from ? (
                          dateRange.to ? (
                            <>
                              {format(dateRange.from, 'MMM d')} -{' '}
                              {format(dateRange.to, 'MMM d, yyyy')}
                            </>
                          ) : (
                            format(dateRange.from, 'MMM d, yyyy')
                          )
                        ) : (
                          'Select date range'
                        )}
                      </>
                    )}
                    <ChevronDown className='ml-auto h-4 w-4 opacity-50' />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className='w-auto p-0' align='end'>
                  <div className='flex'>
                    {/* Presets Sidebar */}
                    <div className='min-w-[140px] space-y-1 border-r p-3'>
                      <p className='text-muted-foreground mb-2 px-2 text-xs font-medium'>
                        Quick Select
                      </p>
                      {DATE_RANGE_PRESETS.map((preset) => (
                        <Button
                          key={preset.label}
                          variant={
                            activePreset === preset.label
                              ? 'secondary'
                              : 'ghost'
                          }
                          size='sm'
                          className='w-full justify-start text-xs'
                          onClick={() => handlePresetSelect(preset)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                      <Separator className='my-2' />
                      {dateMode === 'range' && (
                        <Button
                          variant='ghost'
                          size='sm'
                          className='text-muted-foreground w-full justify-start text-xs'
                          onClick={handleSwitchToSingleDay}
                        >
                          <CalendarIcon className='mr-2 h-3 w-3' />
                          Single Day
                        </Button>
                      )}
                    </div>

                    {/* Calendar */}
                    <div className='p-3'>
                      {dateMode === 'single' ? (
                        <Calendar
                          mode='single'
                          defaultMonth={selectedDate}
                          selected={selectedDate}
                          onSelect={handleDateSelect}
                          initialFocus
                          disabled={(date) => date > new Date()}
                        />
                      ) : (
                        <Calendar
                          mode='range'
                          defaultMonth={dateRange?.from ?? new Date()}
                          selected={dateRange}
                          onSelect={setDateRange}
                          numberOfMonths={2}
                          disabled={(date) => date > new Date()}
                          className='rounded-md'
                        />
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Status Badges */}
              {dateMode === 'single' && isToday(selectedDate) && (
                <Badge variant='default'>Live</Badge>
              )}
              {dateMode === 'range' && dateRange?.from && dateRange?.to && (
                <Badge variant='secondary'>
                  {Math.ceil(
                    (dateRange.to.getTime() - dateRange.from.getTime()) /
                      (1000 * 60 * 60 * 24)
                  ) + 1}{' '}
                  days
                </Badge>
              )}
            </div>

            {/* Refresh Button */}
            <Button variant='outline' size='sm' onClick={refresh}>
              <RefreshCw className='mr-2 h-4 w-4' />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Content - Requires selected associate */}
      {selectedAssociate ? (
        <>
          {/* Profile Card Section */}
          <AssociateProfileCard associate={selectedAssociate} />

          {/* Scorecard Section */}
          <AssociateScorecard
            associate={selectedAssociate}
            selectedDate={selectedDate}
          />

          {/* Gantt Timeline Section */}
          <AssociateGanttSection
            associate={selectedAssociate}
            selectedDate={selectedDate}
            timelineEvents={timelineEvents}
            approvedOvertime={approvedOvertime}
          />

          {/* Work Over Time Chart */}
          <AssociateWorkTrendChart associate={selectedAssociate} />

          {/* Task Breakdown Section */}
          <AssociateTaskBreakdown associate={selectedAssociate} />
        </>
      ) : (
        <Card>
          <CardContent className='py-12 text-center'>
            <Users className='text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50' />
            <p className='text-muted-foreground'>
              Select an associate to view their performance
            </p>
          </CardContent>
        </Card>
      )}
    </motion.div>
  )
}

// ========== UTILITY FUNCTIONS ==========

// Get user initials from name
function getInitials(name: string): string {
  const parts = name.split(' ')
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return name.substring(0, 2).toUpperCase()
}

// ========== PROFILE CARD SECTION ==========

interface AssociateProfileCardProps {
  associate: AssociateProductivity
}

function AssociateProfileCard({ associate }: AssociateProfileCardProps) {
  // Format time string (e.g., "06:00" to "6:00 AM")
  const formatTimeString = (timeStr: string) => {
    if (!timeStr) return ''
    const [hours, minutes] = timeStr.split(':').map(Number)
    const period = hours >= 12 ? 'PM' : 'AM'
    const displayHours = hours % 12 || 12
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
  }

  // Calculate total break minutes
  const totalBreakMinutes = useMemo(() => {
    if (!associate.scheduled_breaks?.length) return 0
    return associate.scheduled_breaks.reduce(
      (sum, b) => sum + b.durationMinutes,
      0
    )
  }, [associate.scheduled_breaks])

  // Format hire date
  const hireDate = associate.hire_date
    ? format(new Date(associate.hire_date), 'MMM d, yyyy')
    : null

  // Status colors
  const statusColors = {
    active: 'bg-green-500',
    break: 'bg-yellow-500',
    offline: 'bg-gray-400',
  }

  const statusLabels = {
    active: 'Active',
    break: 'On Break',
    offline: 'Offline',
  }

  return (
    <Card>
      <CardContent className='p-6'>
        <div className='flex flex-col gap-6 lg:flex-row'>
          {/* Left Section - Avatar and Basic Info */}
          <div className='flex items-start gap-4'>
            {/* Large Avatar */}
            <div className='relative'>
              <Avatar className='h-20 w-20'>
                <AvatarImage
                  src={associate.avatar_url}
                  alt={associate.user_name}
                />
                <AvatarFallback className='bg-primary/10 text-xl'>
                  {getInitials(associate.user_name)}
                </AvatarFallback>
              </Avatar>
              {/* Status indicator */}
              <div
                className={cn(
                  'border-background absolute -right-1 -bottom-1 h-5 w-5 rounded-full border-2',
                  statusColors[associate.status]
                )}
              />
            </div>

            {/* Name and Position */}
            <div className='space-y-1'>
              <h3 className='text-xl font-semibold'>{associate.user_name}</h3>
              <div className='text-muted-foreground flex items-center gap-2'>
                <Briefcase className='h-4 w-4' />
                <span>
                  {associate.position_title || 'No position assigned'}
                </span>
                {associate.is_supervisory && (
                  <Badge variant='secondary' className='text-xs'>
                    <Shield className='mr-1 h-3 w-3' />
                    Supervisor
                  </Badge>
                )}
              </div>
              <div className='flex items-center gap-2'>
                <Badge
                  variant={
                    associate.status === 'active' ? 'default' : 'secondary'
                  }
                  className='text-xs'
                >
                  {statusLabels[associate.status]}
                </Badge>
                {associate.position_type && (
                  <Badge variant='outline' className='text-xs'>
                    {associate.position_type}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Separator */}
          <Separator
            orientation='vertical'
            className='hidden h-auto lg:block'
          />
          <Separator className='lg:hidden' />

          {/* Middle Section - Contact & Assignment Info */}
          <div className='grid flex-1 grid-cols-1 gap-4 md:grid-cols-3'>
            {/* Contact Information */}
            <div className='space-y-3'>
              <h4 className='text-muted-foreground text-sm font-medium'>
                Contact Information
              </h4>
              {associate.user_email && (
                <div className='flex items-center gap-2 text-sm'>
                  <Mail className='text-muted-foreground h-4 w-4' />
                  <span className='truncate'>{associate.user_email}</span>
                </div>
              )}
              {associate.phone_number && (
                <div className='flex items-center gap-2 text-sm'>
                  <Phone className='text-muted-foreground h-4 w-4' />
                  <span>{associate.phone_number}</span>
                </div>
              )}
              {hireDate && (
                <div className='flex items-center gap-2 text-sm'>
                  <CalendarDays className='text-muted-foreground h-4 w-4' />
                  <span>Joined {hireDate}</span>
                </div>
              )}
            </div>

            {/* Assignment Details */}
            <div className='space-y-3'>
              <h4 className='text-muted-foreground text-sm font-medium'>
                Assignment Details
              </h4>
              {associate.department && (
                <div className='flex items-center gap-2 text-sm'>
                  <Building2 className='text-muted-foreground h-4 w-4' />
                  <span>{associate.department}</span>
                </div>
              )}
              {associate.working_area_name && (
                <div className='flex items-center gap-2 text-sm'>
                  <MapPin className='text-muted-foreground h-4 w-4' />
                  <span>{associate.working_area_name}</span>
                  {associate.area_code && (
                    <Badge variant='outline' className='text-xs'>
                      {associate.area_code}
                    </Badge>
                  )}
                </div>
              )}
              {associate.shift_pattern && (
                <div className='flex items-center gap-2 text-sm'>
                  <Clock className='text-muted-foreground h-4 w-4' />
                  <span className='capitalize'>
                    {associate.shift_pattern.replace('_', ' ')}
                  </span>
                </div>
              )}
            </div>

            {/* Shift Schedule */}
            <div className='space-y-3'>
              <h4 className='text-muted-foreground text-sm font-medium'>
                Shift Schedule
              </h4>
              {associate.scheduled_shift_start &&
              associate.scheduled_shift_end ? (
                <>
                  <div className='flex items-center gap-2 text-sm'>
                    <Clock className='text-muted-foreground h-4 w-4' />
                    <span>
                      {formatTimeString(associate.scheduled_shift_start)} -{' '}
                      {formatTimeString(associate.scheduled_shift_end)}
                    </span>
                  </div>
                  {associate.schedule_name && (
                    <div className='flex items-center gap-2 text-sm'>
                      <Badge variant='outline' className='text-xs'>
                        {associate.schedule_name}
                      </Badge>
                    </div>
                  )}
                  {associate.scheduled_breaks &&
                    associate.scheduled_breaks.length > 0 && (
                      <div className='space-y-2 pt-1'>
                        <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                          <Coffee className='h-3 w-3' />
                          <span>
                            Scheduled Breaks ({totalBreakMinutes} min total)
                          </span>
                        </div>
                        <div className='space-y-1'>
                          {associate.scheduled_breaks.map((breakItem, idx) => (
                            <div
                              key={idx}
                              className='bg-muted/50 flex items-center justify-between rounded px-2 py-1 text-xs'
                            >
                              <span className='font-medium'>
                                {breakItem.name}
                              </span>
                              <span className='text-muted-foreground'>
                                {formatTimeString(breakItem.startTime)} (
                                {breakItem.durationMinutes}m)
                                {breakItem.isPaid && (
                                  <Badge
                                    variant='secondary'
                                    className='ml-1 px-1 text-[10px]'
                                  >
                                    Paid
                                  </Badge>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </>
              ) : (
                <div className='text-muted-foreground flex items-center gap-2 text-sm'>
                  <Clock className='h-4 w-4' />
                  <span>No schedule assigned</span>
                </div>
              )}
            </div>
          </div>

          {/* Separator */}
          <Separator
            orientation='vertical'
            className='hidden h-auto lg:block'
          />
          <Separator className='lg:hidden' />

          {/* Right Section - Supervisor Info */}
          <div className='min-w-[200px] space-y-3'>
            <h4 className='text-muted-foreground text-sm font-medium'>
              Reports To
            </h4>

            {/* Direct Supervisor */}
            {associate.supervisor_name ? (
              <div className='bg-muted/50 flex items-center gap-3 rounded-lg p-2'>
                <Avatar className='h-8 w-8'>
                  <AvatarImage src={associate.supervisor_avatar} />
                  <AvatarFallback className='bg-blue-100 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300'>
                    {getInitials(associate.supervisor_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className='text-sm font-medium'>
                    {associate.supervisor_name}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    Direct Supervisor
                  </p>
                </div>
              </div>
            ) : (
              <div className='text-muted-foreground bg-muted/30 flex items-center gap-2 rounded-lg p-2 text-sm'>
                <UserCheck className='h-4 w-4' />
                <span>No supervisor assigned</span>
              </div>
            )}

            {/* Team Lead */}
            {associate.team_lead_name &&
              associate.team_lead_name !== associate.supervisor_name && (
                <div className='bg-muted/50 flex items-center gap-3 rounded-lg p-2'>
                  <Avatar className='h-8 w-8'>
                    <AvatarImage src={associate.team_lead_avatar} />
                    <AvatarFallback className='bg-green-100 text-xs text-green-700 dark:bg-green-900 dark:text-green-300'>
                      {getInitials(associate.team_lead_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className='text-sm font-medium'>
                      {associate.team_lead_name}
                    </p>
                    <p className='text-muted-foreground text-xs'>Team Lead</p>
                  </div>
                </div>
              )}

            {/* Productivity Target */}
            {associate.productivity_target && (
              <div className='flex items-center gap-2 pt-2 text-sm'>
                <Target className='text-muted-foreground h-4 w-4' />
                <span>Target: {associate.productivity_target}%</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ========== SCORECARD SECTION ==========

interface AssociateScorecardProps {
  associate: AssociateProductivity
  selectedDate: Date
}

function AssociateScorecard({
  associate,
  selectedDate,
}: AssociateScorecardProps) {
  const timeline = associate.timeline
  const efficiencyStatus = getEfficiencyStatus(associate.efficiency)

  // Calculate activity window
  const activityWindow = useMemo(() => {
    if (!timeline?.firstActivity || !timeline?.lastActivity) return null
    const first = new Date(timeline.firstActivity)
    const last = new Date(timeline.lastActivity)
    const durationMinutes = Math.round(
      (last.getTime() - first.getTime()) / (1000 * 60)
    )
    return {
      first: format(first, 'h:mm a'),
      last: format(last, 'h:mm a'),
      duration: formatDuration(durationMinutes),
    }
  }, [timeline])

  // Date label for context
  const dateLabel = isToday(selectedDate)
    ? 'Today'
    : format(selectedDate, 'MMM d')

  return (
    <div className='grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6'>
      {/* Total Tasks */}
      <ScorecardCard
        icon={Target}
        title='Total Tasks'
        value={associate.total_tasks}
        description={`Completed ${dateLabel.toLowerCase()}`}
      />

      {/* Efficiency */}
      <ScorecardCard
        icon={Zap}
        title='Efficiency'
        value={`${associate.efficiency}%`}
        description={
          efficiencyStatus.charAt(0).toUpperCase() + efficiencyStatus.slice(1)
        }
        infoTooltip='Efficiency is calculated against labor standards and capped at 150% to prevent outliers from skewing team metrics.'
      />

      {/* Work Time */}
      <ScorecardCard
        icon={Activity}
        title='Work Time'
        value={formatDuration(timeline?.totalWorkMinutes || 0)}
        description='Productive time'
      />

      {/* Idle Time */}
      <ScorecardCard
        icon={Clock}
        title='Idle Time'
        value={formatDuration(timeline?.totalIdleMinutes || 0)}
        description='Non-productive'
      />

      {/* Break Time */}
      <ScorecardCard
        icon={Coffee}
        title='Break Time'
        value={formatDuration(timeline?.totalBreakMinutes || 0)}
        description='Scheduled breaks'
      />

      {/* Activity Window */}
      <ScorecardCard
        icon={TrendingUp}
        title='Activity Window'
        value={activityWindow?.duration || '--'}
        description={
          activityWindow
            ? `${activityWindow.first} - ${activityWindow.last}`
            : 'No activity'
        }
      />
    </div>
  )
}

// Scorecard Card Component - clean neutral design matching inbound scan search
interface ScorecardCardProps {
  icon: React.ElementType
  title: string
  value: string | number
  description: string
  /** Optional info tooltip content to explain the metric */
  infoTooltip?: string
}

function ScorecardCard({
  icon: Icon,
  title,
  value,
  description,
  infoTooltip,
}: ScorecardCardProps) {
  return (
    <Card>
      <CardContent className='p-0'>
        <div className='flex flex-row items-center justify-between space-y-0 p-4 pb-2'>
          <div className='flex items-center gap-1.5'>
            <p className='text-sm font-medium'>{title}</p>
            {infoTooltip && (
              <TooltipProvider>
                <ShadcnTooltip>
                  <TooltipTrigger asChild>
                    <Info className='text-muted-foreground h-3.5 w-3.5 cursor-help' />
                  </TooltipTrigger>
                  <TooltipContent side='top' className='max-w-xs'>
                    <p className='text-xs'>{infoTooltip}</p>
                  </TooltipContent>
                </ShadcnTooltip>
              </TooltipProvider>
            )}
          </div>
          <Icon className='text-muted-foreground h-4 w-4' />
        </div>
        <div className='p-4 pt-0'>
          <div className='text-2xl font-bold'>{value}</div>
          <p className='text-muted-foreground text-xs'>{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ========== GANTT TIMELINE SECTION ==========

interface AssociateGanttSectionProps {
  associate: AssociateProductivity
  selectedDate: Date
  timelineEvents?: import('@/lib/supabase/timeline-events.service').TimelineEventWithCategory[]
  approvedOvertime?: import('@/lib/supabase/overtime.service').ApprovedOvertimeForTimeline[]
}

function AssociateGanttSection({
  associate,
  selectedDate,
  timelineEvents = [],
  approvedOvertime = [],
}: AssociateGanttSectionProps) {
  const dateLabel = isToday(selectedDate)
    ? 'today'
    : format(selectedDate, 'MMMM d, yyyy')

  // Find approved overtime for this associate
  const userOvertime = useMemo(() => {
    const overtime = approvedOvertime.find(
      (ot) => ot.user_id === associate.user_id
    )
    if (!overtime) return undefined

    return {
      originalShiftEnd: overtime.original_shift_end.substring(0, 5),
      extendedShiftEnd: overtime.extended_shift_end.substring(0, 5),
      overtimeMinutes: overtime.overtime_minutes,
    }
  }, [approvedOvertime, associate.user_id])

  // Merge timeline events into the activity blocks, splitting idle blocks around events
  const enhancedTimeline = useMemo(() => {
    if (!associate.timeline) return undefined
    if (timelineEvents.length === 0) return associate.timeline

    // Filter events that apply to this specific associate based on scope
    const applicableEvents = timelineEvents.filter((event) => {
      // Scope: all - applies to everyone
      if (event.scope_type === 'all') return true

      // Scope: area - check if associate's working area matches
      if (event.scope_type === 'area') {
        return event.working_area_id === associate.working_area_id
      }

      // Scope: user - check if associate is in the assigned users list
      if (event.scope_type === 'user') {
        return event.assigned_user_ids?.includes(associate.user_id)
      }

      return false
    })

    // If no applicable events for this associate, return original timeline
    if (applicableEvents.length === 0) return associate.timeline

    // Helper to get minutes from time string "HH:MM:SS" or "HH:MM"
    const timeToMinutes = (timeStr: string): number => {
      const parts = timeStr.split(':').map(Number)
      return parts[0] * 60 + (parts[1] || 0)
    }

    // Helper to get minutes since midnight from ISO timestamp
    const timestampToMinutes = (timestamp: string): number => {
      const date = new Date(timestamp)
      return date.getHours() * 60 + date.getMinutes()
    }

    // Helper to create timestamp from date and minutes
    const minutesToTimestamp = (dateStr: string, mins: number): string => {
      const hours = Math.floor(mins / 60)
      const minutes = mins % 60
      return `${dateStr}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`
    }

    // Convert applicable timeline events to event info with minute ranges
    const eventRanges = applicableEvents.map((event) => {
      const startMin = timeToMinutes(event.start_time)
      const endMin = timeToMinutes(event.end_time)
      return {
        event,
        startMin,
        endMin,
        duration: endMin - startMin,
      }
    })

    // Process each block - split idle blocks around events
    const resultBlocks: typeof associate.timeline.activityBlocks = []

    for (const block of associate.timeline.activityBlocks) {
      // Only split idle blocks - work blocks and breaks stay as-is
      if (block.type !== 'idle') {
        resultBlocks.push(block)
        continue
      }

      const blockStartMin = timestampToMinutes(block.startTime)
      const blockEndMin = timestampToMinutes(block.endTime)
      const dateStr = block.startTime.split('T')[0]

      // Find events that overlap with this idle block
      const overlappingEvents = eventRanges.filter(
        (er) => er.startMin < blockEndMin && er.endMin > blockStartMin
      )

      if (overlappingEvents.length === 0) {
        // No overlap - keep idle block as-is
        resultBlocks.push(block)
        continue
      }

      // Sort overlapping events by start time
      overlappingEvents.sort((a, b) => a.startMin - b.startMin)

      // Split the idle block around events
      let currentPos = blockStartMin

      for (const er of overlappingEvents) {
        // Add idle time before this event (if any)
        if (er.startMin > currentPos) {
          const idleDuration = er.startMin - currentPos
          resultBlocks.push({
            startTime: minutesToTimestamp(dateStr, currentPos),
            endTime: minutesToTimestamp(dateStr, er.startMin),
            type: 'idle',
            taskCount: 0,
            duration: idleDuration,
          })
        }

        // Add the event block
        const eventStartMin = Math.max(er.startMin, blockStartMin)
        const eventEndMin = Math.min(er.endMin, blockEndMin)
        const eventDuration = eventEndMin - eventStartMin

        if (eventDuration > 0) {
          resultBlocks.push({
            startTime: minutesToTimestamp(dateStr, eventStartMin),
            endTime: minutesToTimestamp(dateStr, eventEndMin),
            type: 'event' as const,
            taskCount: 0,
            duration: eventDuration,
            eventId: er.event.id,
            eventName: er.event.event_name,
            eventType: er.event.category?.category_code || 'custom',
            eventColor: er.event.category?.color || '#8B5CF6',
            isPaidTime: er.event.category?.is_paid_time ?? true,
            isProductiveTime: er.event.category?.is_productive_time ?? false,
          })
        }

        currentPos = Math.max(currentPos, er.endMin)
      }

      // Add any remaining idle time after the last event
      if (currentPos < blockEndMin) {
        const remainingDuration = blockEndMin - currentPos
        resultBlocks.push({
          startTime: minutesToTimestamp(dateStr, currentPos),
          endTime: minutesToTimestamp(dateStr, blockEndMin),
          type: 'idle',
          taskCount: 0,
          duration: remainingDuration,
        })
      }
    }

    // Also add event blocks that don't overlap with any idle (e.g., during work time)
    for (const er of eventRanges) {
      const dateStr = er.event.event_date
      const alreadyAdded = resultBlocks.some(
        (b) => b.type === 'event' && b.eventId === er.event.id
      )

      if (!alreadyAdded) {
        resultBlocks.push({
          startTime: minutesToTimestamp(dateStr, er.startMin),
          endTime: minutesToTimestamp(dateStr, er.endMin),
          type: 'event' as const,
          taskCount: 0,
          duration: er.duration,
          eventId: er.event.id,
          eventName: er.event.event_name,
          eventType: er.event.category?.category_code || 'custom',
          eventColor: er.event.category?.color || '#8B5CF6',
          isPaidTime: er.event.category?.is_paid_time ?? true,
          isProductiveTime: er.event.category?.is_productive_time ?? false,
        })
      }
    }

    // Sort all blocks by start time
    resultBlocks.sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    )

    // Recalculate total idle minutes (excluding event time)
    const newTotalIdleMinutes = resultBlocks
      .filter((b) => b.type === 'idle')
      .reduce((sum, b) => sum + b.duration, 0)

    return {
      ...associate.timeline,
      activityBlocks: resultBlocks,
      totalIdleMinutes: newTotalIdleMinutes,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Specific associate properties tracked; adding whole `associate` object would over-trigger
  }, [
    associate.timeline,
    timelineEvents,
    associate.working_area_id,
    associate.user_id,
  ])

  const hasTimeline =
    enhancedTimeline && enhancedTimeline.activityBlocks.length > 0

  if (!hasTimeline) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <BarChart3 className='h-5 w-5' />
            Activity Timeline
          </CardTitle>
          <CardDescription>
            24-hour view of daily activities for {dateLabel}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='text-muted-foreground py-8 text-center'>
            <Activity className='mx-auto mb-4 h-12 w-12 opacity-50' />
            <p>No activity recorded for {dateLabel}</p>
            <p className='mt-2 text-sm'>
              Try selecting a different date using the calendar above
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <div>
            <CardTitle className='flex items-center gap-2'>
              <BarChart3 className='h-5 w-5' />
              Activity Timeline
            </CardTitle>
            <CardDescription>
              24-hour view of daily activities with shift markers for{' '}
              {dateLabel}
            </CardDescription>
          </div>
          {userOvertime && (
            <Badge
              variant='outline'
              className='border-orange-300 text-xs text-orange-600'
            >
              +{formatDuration(userOvertime.overtimeMinutes)} Overtime
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {/* Full Gantt Chart */}
        <ActivityGantt
          timeline={enhancedTimeline}
          height={56}
          showLabels={true}
          showSummary={true}
          showShiftMarkers={true}
          overtimeMarker={userOvertime}
        />

        {/* Legend */}
        <ActivityLegend
          className='border-border/50 border-t pt-4'
          showShiftMarker={true}
          showEvents={true}
          showOvertime={true}
        />
      </CardContent>
    </Card>
  )
}

// ========== WORK TREND CHART ==========

interface AssociateWorkTrendChartProps {
  associate: AssociateProductivity
}

// Custom tooltip for chart
function ChartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className='bg-background border-border rounded-lg border p-3 shadow-lg'>
      <p className='text-foreground mb-2 font-semibold'>{label}</p>
      <div className='space-y-1'>
        {payload.map((entry, index) => (
          <p key={index} className='text-sm' style={{ color: entry.color }}>
            <span className='font-medium'>{entry.name}:</span> {entry.value}
            {entry.dataKey === 'efficiency' ? '%' : ''}
          </p>
        ))}
      </div>
    </div>
  )
}

function AssociateWorkTrendChart({ associate }: AssociateWorkTrendChartProps) {
  // Create chart data from task breakdown
  // For a single day, we show breakdown by task type
  const chartData = useMemo(() => {
    const taskTypes = [
      { key: 'inbound_scans', label: 'Scans', value: associate.inbound_scans },
      { key: 'put_aways', label: 'Putaway', value: associate.put_aways },
      { key: 'picking', label: 'Picking', value: associate.picking },
      { key: 'packed', label: 'Pack', value: associate.packed },
      { key: 'shipped', label: 'Ship', value: associate.shipped },
      {
        key: 'final_packed',
        label: 'Final Pack',
        value: associate.final_packed,
      },
      { key: 'putbacks', label: 'Putback', value: associate.putbacks },
      { key: 'cycle_counts', label: 'Counts', value: associate.cycle_counts },
    ].filter((t) => t.value > 0)

    return taskTypes.map((t) => ({
      name: t.label,
      tasks: t.value,
    }))
  }, [associate])

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <TrendingUp className='h-5 w-5' />
            Work Completed
          </CardTitle>
          <CardDescription>Task completion breakdown by type</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='text-muted-foreground py-8 text-center'>
            <BarChart3 className='mx-auto mb-4 h-12 w-12 opacity-50' />
            <p>No tasks completed for this date</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <div>
            <CardTitle className='flex items-center gap-2'>
              <TrendingUp className='h-5 w-5' />
              Work Completed
            </CardTitle>
            <CardDescription>Task completion breakdown by type</CardDescription>
          </div>
          <div className='text-right'>
            <p className='text-2xl font-bold'>{associate.total_tasks}</p>
            <p className='text-muted-foreground text-xs'>Total Tasks</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width='100%' height={300}>
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <CartesianGrid
              strokeDasharray='3 3'
              stroke='var(--border)'
              opacity={0.3}
            />
            <XAxis
              dataKey='name'
              tick={{ fill: 'var(--foreground)', fontSize: 11 }}
              stroke='var(--border)'
            />
            <YAxis
              tick={{ fill: 'var(--foreground)', fontSize: 11 }}
              stroke='var(--border)'
              label={{
                value: 'Tasks',
                angle: -90,
                position: 'insideLeft',
                style: { fill: 'var(--foreground)', fontSize: 12 },
              }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Bar
              dataKey='tasks'
              name='Tasks'
              fill='var(--primary)'
              radius={[4, 4, 0, 0]}
              opacity={0.9}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

// ========== TASK BREAKDOWN SECTION ==========

interface AssociateTaskBreakdownProps {
  associate: AssociateProductivity
}

function AssociateTaskBreakdown({ associate }: AssociateTaskBreakdownProps) {
  const hasBreakdown =
    associate.taskBreakdown && associate.taskBreakdown.length > 0

  // Task type summary with colors
  const taskMetrics = useMemo(() => {
    return [
      { label: 'Scans', value: associate.inbound_scans, color: 'blue' },
      { label: 'Putaway', value: associate.put_aways, color: 'purple' },
      { label: 'Picking', value: associate.picking, color: 'green' },
      { label: 'Pack', value: associate.packed, color: 'orange' },
      { label: 'Ship', value: associate.shipped, color: 'teal' },
      { label: 'Final Pack', value: associate.final_packed, color: 'amber' },
      { label: 'Putback', value: associate.putbacks, color: 'rose' },
      { label: 'Counts', value: associate.cycle_counts, color: 'indigo' },
    ].filter((m) => m.value > 0)
  }, [associate])

  if (taskMetrics.length === 0 && !hasBreakdown) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <MapPin className='h-5 w-5' />
          Task Breakdown
        </CardTitle>
        <CardDescription>
          Detailed view of completed tasks by area and type
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        {/* Task Breakdown by Area */}
        {hasBreakdown && (
          <div className='space-y-3'>
            <h4 className='text-muted-foreground text-sm font-medium'>
              By Working Area
            </h4>
            <div className='grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3'>
              {associate.taskBreakdown!.map((breakdown, idx) => (
                <TaskBreakdownCard key={idx} breakdown={breakdown} />
              ))}
            </div>
          </div>
        )}

        {/* Task Type Summary */}
        {taskMetrics.length > 0 && (
          <div className='space-y-3'>
            <h4 className='text-muted-foreground text-sm font-medium'>
              By Task Type
            </h4>
            <div className='flex flex-wrap gap-3'>
              {taskMetrics.map((metric) => (
                <TaskTypeBadge
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  color={metric.color}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Task Breakdown Card Component
interface TaskBreakdownCardProps {
  breakdown: TaskBreakdownByArea
}

function TaskBreakdownCard({ breakdown }: TaskBreakdownCardProps) {
  const taskTypes = useMemo(() => {
    return [
      { label: 'Scans', value: breakdown.inbound_scans, color: 'bg-blue-500' },
      { label: 'Putaway', value: breakdown.put_aways, color: 'bg-purple-500' },
      { label: 'Picks', value: breakdown.picking, color: 'bg-green-500' },
      { label: 'Pack', value: breakdown.packed, color: 'bg-orange-500' },
      { label: 'Ship', value: breakdown.shipped, color: 'bg-teal-500' },
      { label: 'Final', value: breakdown.final_packed, color: 'bg-amber-500' },
      { label: 'Putback', value: breakdown.putbacks, color: 'bg-rose-500' },
      { label: 'Count', value: breakdown.cycle_counts, color: 'bg-indigo-500' },
    ].filter((t) => t.value > 0)
  }, [breakdown])

  return (
    <div className='bg-muted/50 border-border/50 rounded-lg border p-3'>
      <div className='mb-2 flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <MapPin className='text-muted-foreground h-4 w-4' />
          <span className='truncate font-medium'>{breakdown.area}</span>
        </div>
        <Badge variant='secondary' className='text-xs'>
          {breakdown.total}
        </Badge>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {taskTypes.map((task, idx) => (
          <div
            key={idx}
            className='bg-background flex items-center gap-1 rounded px-2 py-1 text-xs'
          >
            <div className={cn('h-2 w-2 rounded-full', task.color)} />
            <span className='font-medium'>{task.value}</span>
            <span className='text-muted-foreground'>{task.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Task Type Badge Component
const TASK_COLORS: Record<string, string> = {
  blue: 'border-blue-500/50 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
  purple:
    'border-purple-500/50 bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300',
  green:
    'border-green-500/50 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300',
  orange:
    'border-orange-500/50 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300',
  teal: 'border-teal-500/50 bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300',
  amber:
    'border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  rose: 'border-rose-500/50 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
  indigo:
    'border-indigo-500/50 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300',
}

function TaskTypeBadge({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2',
        TASK_COLORS[color]
      )}
    >
      <span className='text-lg font-bold'>{value}</span>
      <span className='text-sm'>{label}</span>
    </div>
  )
}

// ========== STATUS INDICATOR ==========

function StatusIndicator({
  status,
}: {
  status: 'active' | 'break' | 'offline'
}) {
  const statusColors = {
    active: 'bg-green-500',
    break: 'bg-yellow-500',
    offline: 'bg-gray-400',
  }

  const statusLabels = {
    active: 'Active',
    break: 'On Break',
    offline: 'Offline',
  }

  return (
    <div className='flex items-center gap-1.5'>
      <div className={cn('h-2 w-2 rounded-full', statusColors[status])} />
      <span className='text-muted-foreground text-xs'>
        {statusLabels[status]}
      </span>
    </div>
  )
}

// ========== UTILITY FUNCTIONS ==========

function formatDuration(minutes: number): string {
  if (minutes === 0) return '0m'
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

// ========== SKELETON LOADER ==========

function AssociatePerformanceSkeleton() {
  return (
    <div className='space-y-6'>
      {/* Header */}
      <Card>
        <CardContent className='py-4'>
          <div className='flex flex-col items-start gap-4 lg:flex-row lg:items-center'>
            <Skeleton className='h-12 w-[350px]' />
            <div className='flex-1' />
            <div className='flex items-center gap-1'>
              <Skeleton className='h-10 w-10' />
              <Skeleton className='h-10 w-[160px]' />
              <Skeleton className='h-10 w-10' />
            </div>
            <Skeleton className='h-10 w-24' />
          </div>
        </CardContent>
      </Card>

      {/* Scorecard */}
      <div className='grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6'>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className='h-24 rounded-lg' />
        ))}
      </div>

      {/* Gantt */}
      <Skeleton className='h-48 rounded-lg' />

      {/* Chart */}
      <Skeleton className='h-80 rounded-lg' />

      {/* Breakdown */}
      <Skeleton className='h-64 rounded-lg' />
    </div>
  )
}
