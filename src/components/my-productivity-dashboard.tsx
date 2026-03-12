/**
 * My Productivity Dashboard Component
 * Personal productivity view matching the Associate Performance tab design
 * Shows current day performance metrics, timeline, and task breakdown
 * Created: January 3, 2026
 */
import { useMemo } from 'react'
import { format, isToday } from 'date-fns'
import { motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  Clock,
  Coffee,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Shield,
  Target,
  UserCheck,
  Users,
} from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ActivityGantt,
  ActivityLegend,
} from '@/features/shift-productivity/team-performance/components/activity-gantt'
import { useTeamPerformance } from '@/features/shift-productivity/team-performance/hooks/use-team-performance'
import type {
  AssociateProductivity,
  TaskBreakdownByArea,
} from '@/features/shift-productivity/team-performance/types/team-performance.types'

interface MyProductivityDashboardProps {
  className?: string
}

export function MyProductivityDashboard({
  className,
}: MyProductivityDashboardProps) {
  const { authState } = useUnifiedAuth()
  const currentUserId = authState.user?.id

  const {
    performanceData,
    isLoadingPerformance,
    refresh,
    organizationId,
    selectedDate,
    // Timeline events and overtime for activity visualization
    timelineEvents,
    approvedOvertime,
  } = useTeamPerformance({
    autoRefresh: true,
    refreshInterval: 60000,
    // Enable timeline events and overtime for gantt visualization
    enableTimelineEvents: true,
    enableOvertimeRequests: true,
  })

  // Get current user's data from the team performance data
  const currentUserData = useMemo(() => {
    if (!performanceData?.associates || !currentUserId) return null
    return (
      performanceData.associates.find((a) => a.user_id === currentUserId) ||
      null
    )
  }, [performanceData?.associates, currentUserId])

  // Get user initials
  const getInitials = (name: string) => {
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }

  if (!organizationId) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <p className='text-muted-foreground'>Organization not found</p>
      </div>
    )
  }

  if (isLoadingPerformance) {
    return <MyProductivitySkeleton />
  }

  if (!performanceData || !currentUserData) {
    const dateDisplayText = format(selectedDate, 'MMMM d, yyyy')

    return (
      <div className='py-12 text-center'>
        <Users className='text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50' />
        <p className='text-muted-foreground'>
          No performance data available for {dateDisplayText}
        </p>
        <div className='mt-4 flex justify-center gap-2'>
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
      {/* Header with Today's Date */}
      <Card>
        <CardContent className='py-4'>
          <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
            <div className='flex items-center gap-3'>
              <Avatar className='h-10 w-10'>
                <AvatarImage src={currentUserData.avatar_url} />
                <AvatarFallback className='bg-primary/10 text-sm'>
                  {getInitials(currentUserData.user_name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className='text-lg font-semibold'>
                  {currentUserData.user_name}
                </h3>
                <p className='text-muted-foreground text-sm'>
                  Today's Performance •{' '}
                  {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                </p>
              </div>
            </div>

            <div className='flex items-center gap-2'>
              {isToday(selectedDate) && <Badge variant='default'>Live</Badge>}
              <Button variant='outline' size='sm' onClick={refresh}>
                <RefreshCw className='mr-2 h-4 w-4' />
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile Card Section */}
      <MyProfileCard associate={currentUserData} />

      {/* Gantt Timeline Section */}
      <MyGanttSection
        associate={currentUserData}
        selectedDate={selectedDate}
        timelineEvents={timelineEvents}
        approvedOvertime={approvedOvertime}
      />

      {/* Task Breakdown Section */}
      <MyTaskBreakdown associate={currentUserData} />
    </motion.div>
  )
}

// ========== PROFILE CARD SECTION ==========

interface MyProfileCardProps {
  associate: AssociateProductivity
}

function MyProfileCard({ associate }: MyProfileCardProps) {
  // Get user initials
  const getInitials = (name: string) => {
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }

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

// ========== GANTT TIMELINE SECTION ==========

interface MyGanttSectionProps {
  associate: AssociateProductivity
  selectedDate: Date
  timelineEvents?: import('@/lib/supabase/timeline-events.service').TimelineEventWithCategory[]
  approvedOvertime?: import('@/lib/supabase/overtime.service').ApprovedOvertimeForTimeline[]
}

function MyGanttSection({
  associate,
  selectedDate,
  timelineEvents = [],
  approvedOvertime = [],
}: MyGanttSectionProps) {
  const dateLabel = isToday(selectedDate)
    ? 'today'
    : format(selectedDate, 'MMMM d, yyyy')

  // Find approved overtime for this user
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

    // Filter events that apply to this specific user based on scope
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

    // If no applicable events for this user, return original timeline
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
  }, [associate, timelineEvents])

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
            24-hour view of your daily activities for {dateLabel}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='text-muted-foreground py-8 text-center'>
            <Activity className='mx-auto mb-4 h-12 w-12 opacity-50' />
            <p>No activity recorded for {dateLabel}</p>
            <p className='mt-2 text-sm'>
              Your activities will appear here as you work
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
              24-hour view of your daily activities with shift markers for{' '}
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

// ========== TASK BREAKDOWN SECTION ==========

interface MyTaskBreakdownProps {
  associate: AssociateProductivity
}

function MyTaskBreakdown({ associate }: MyTaskBreakdownProps) {
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

function MyProductivitySkeleton() {
  return (
    <div className='space-y-6'>
      {/* Header */}
      <Card>
        <CardContent className='py-4'>
          <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
            <div className='flex items-center gap-3'>
              <Skeleton className='h-10 w-10 rounded-full' />
              <div className='space-y-2'>
                <Skeleton className='h-5 w-32' />
                <Skeleton className='h-4 w-48' />
              </div>
            </div>
            <Skeleton className='h-9 w-24' />
          </div>
        </CardContent>
      </Card>

      {/* Profile Card */}
      <Skeleton className='h-48 rounded-lg' />

      {/* Scorecard */}
      <div className='grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6'>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className='h-24 rounded-lg' />
        ))}
      </div>

      {/* Gantt */}
      <Skeleton className='h-48 rounded-lg' />

      {/* Breakdown */}
      <Skeleton className='h-64 rounded-lg' />
    </div>
  )
}
