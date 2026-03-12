/**
 * Associate Performance Row Component
 * Displays individual associate metrics with efficiency and status
 * Created: December 20, 2025
 * Updated: January 1, 2026 - Added expandable row with task breakdown and Gantt timeline
 * Updated: January 3, 2026 - Added timeline events integration for event blocks
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronRight, Clock, MapPin } from 'lucide-react'
import { TIMEZONE } from '@/lib/constants'
import type { ApprovedOvertimeForTimeline } from '@/lib/supabase/overtime.service'
import type { TimelineEventWithCategory } from '@/lib/supabase/timeline-events.service'
import { cn } from '@/lib/utils'
import { useActivityConfig } from '@/hooks/use-activity-config'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type {
  ActivityBlock,
  AssociateProductivity,
  DailyTimeline,
  TaskBreakdownByArea,
} from '../types/team-performance.types'
import {
  getEfficiencyBadgeVariant,
  getEfficiencyColor,
  getEfficiencyStatus,
} from '../types/team-performance.types'
import {
  ActivityGantt,
  ActivityLegend,
  type OvertimeMarker,
} from './activity-gantt'

// Format duration in hours and minutes
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

interface AssociatePerformanceRowProps {
  associate: AssociateProductivity
  showArea?: boolean
  showPosition?: boolean
  showDetails?: boolean
  compact?: boolean
  expandable?: boolean
  defaultExpanded?: boolean
  onClick?: () => void
  timelineEvents?: import('@/lib/supabase/timeline-events.service').TimelineEventWithCategory[]
  approvedOvertime?: ApprovedOvertimeForTimeline[]
  className?: string
}

export function AssociatePerformanceRow({
  associate,
  showArea = true,
  showPosition = true,
  showDetails = false,
  compact = false,
  expandable = true,
  defaultExpanded = false,
  onClick,
  timelineEvents = [],
  approvedOvertime = [],
  className,
}: AssociatePerformanceRowProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

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
    } as OvertimeMarker
  }, [approvedOvertime, associate.user_id])

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

  const efficiencyStatus = getEfficiencyStatus(associate.efficiency)
  const efficiencyColor = getEfficiencyColor(associate.efficiency)
  const badgeVariant = getEfficiencyBadgeVariant(associate.efficiency)

  // Get user initials
  const getInitials = (name: string) => {
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }

  const hasTimeline =
    associate.timeline && associate.timeline.activityBlocks.length > 0
  const hasBreakdown =
    associate.taskBreakdown && associate.taskBreakdown.length > 0

  // Merge timeline events into the activity blocks, splitting idle blocks around events
  const enhancedTimeline: DailyTimeline | undefined = useMemo(() => {
    if (!associate.timeline) return undefined
    if (timelineEvents.length === 0) return associate.timeline

    // Filter events that apply to this specific associate based on scope
    const applicableEvents = timelineEvents.filter(
      (event: TimelineEventWithCategory) => {
        // Scope: all - applies to everyone
        if (event.scope_type === 'all') return true

        // Scope: area - check if associate's working area matches
        if (event.scope_type === 'area') {
          return event.working_area_id === associate.working_area_id
        }

        // Scope: shift - check if associate is on the same shift schedule
        // Note: This requires the associate to have a shift_schedule_id (from shift_assignments)
        if (event.scope_type === 'shift') {
          // If the associate has shift info, check if it matches
          // For now, include shift-scoped events for all associates since we track scheduled_shift_* times
          // A more precise implementation would check shift_schedule_id
          return true
        }

        // Scope: user - check if associate is in the assigned users list
        if (event.scope_type === 'user') {
          return event.assigned_user_ids?.includes(associate.user_id)
        }

        return false
      }
    )

    // If no applicable events for this associate, return original timeline
    if (applicableEvents.length === 0) return associate.timeline

    // Helper to get minutes from time string "HH:MM:SS" or "HH:MM"
    const timeToMinutes = (timeStr: string): number => {
      const parts = timeStr.split(':').map(Number)
      return parts[0] * 60 + (parts[1] || 0)
    }

    // Helper to get minutes since midnight from ISO timestamp in EST
    // IMPORTANT: Must match the timezone used in activity-gantt.tsx
    const timestampToMinutes = (timestamp: string): number => {
      const date = new Date(timestamp)
      const estTimeStr = date.toLocaleString('en-US', {
        timeZone: TIMEZONE,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })
      const [hours, minutes] = estTimeStr.split(':').map(Number)
      return hours * 60 + minutes
    }

    // Helper to detect if a date is in DST using Intl.DateTimeFormat
    // This correctly handles DST transitions (2nd Sunday of March, 1st Sunday of November)
    const isDateInDST = (date: Date): boolean => {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        timeZoneName: 'short',
      })
      const parts = formatter.formatToParts(date)
      const tzName = parts.find((p) => p.type === 'timeZoneName')?.value
      // EDT = Eastern Daylight Time (DST), EST = Eastern Standard Time (no DST)
      return tzName === 'EDT'
    }

    // Helper to create timestamp from date and minutes in EST
    // Creates proper ISO timestamp accounting for EST timezone offset
    const minutesToTimestamp = (dateStr: string, mins: number): string => {
      // Clamp minutes to valid day range
      const clampedMins = Math.max(0, Math.min(1439, mins))

      // Create a date object to properly detect DST
      const hours = Math.floor(clampedMins / 60)
      const minutes = clampedMins % 60
      const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`

      // Create a temporary date to check DST status
      // Use noon to avoid edge cases around DST transitions
      const testDate = new Date(`${dateStr}T12:00:00`)
      const isDST = isDateInDST(testDate)
      const estOffsetHours = isDST ? 4 : 5

      return new Date(
        `${dateStr}T${timeStr}.000-0${estOffsetHours}:00`
      ).toISOString()
    }

    // Convert applicable timeline events to event info with minute ranges
    const eventRanges = applicableEvents.map(
      (event: TimelineEventWithCategory) => {
        const startMin = timeToMinutes(event.start_time)
        const endMin = timeToMinutes(event.end_time)
        return {
          event,
          startMin,
          endMin,
          duration: endMin - startMin,
        }
      }
    )

    // Process each block - split idle blocks around events
    const resultBlocks: ActivityBlock[] = []

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
    // These will overlay on work blocks but that's expected
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
  }, [
    associate.timeline,
    timelineEvents,
    associate.user_id,
    associate.working_area_id,
  ])

  const hasEnhancedTimeline =
    enhancedTimeline && enhancedTimeline.activityBlocks.length > 0

  return (
    <TooltipProvider>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div
          className={cn(
            'bg-muted/50 relative rounded-lg transition-all duration-200',
            isExpanded && 'bg-muted/70 ring-border/50 z-10 ring-1',
            className
          )}
        >
          {/* Main row */}
          <CollapsibleTrigger asChild disabled={!expandable}>
            <motion.div
              className={cn(
                'hover:bg-muted flex items-center justify-between transition-all duration-200',
                compact ? 'gap-2 p-2' : 'gap-4 p-3',
                expandable && 'cursor-pointer hover:shadow-sm',
                !expandable && onClick && 'cursor-pointer'
              )}
              whileHover={{ x: expandable ? 2 : 0 }}
              onClick={!expandable ? onClick : undefined}
            >
              {/* Expand indicator */}
              {expandable && (
                <div className='w-5 flex-shrink-0'>
                  {isExpanded ? (
                    <ChevronDown className='text-muted-foreground h-4 w-4' />
                  ) : (
                    <ChevronRight className='text-muted-foreground h-4 w-4' />
                  )}
                </div>
              )}

              {/* Left side - Avatar and info */}
              <div className='flex min-w-0 flex-1 items-center gap-3'>
                {/* Avatar with status indicator */}
                <div className='relative flex-shrink-0'>
                  <Avatar className={compact ? 'h-8 w-8' : 'h-10 w-10'}>
                    <AvatarImage
                      src={associate.avatar_url}
                      alt={associate.user_name}
                    />
                    <AvatarFallback className='bg-primary/10 text-xs'>
                      {getInitials(associate.user_name)}
                    </AvatarFallback>
                  </Avatar>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          'border-background absolute -right-0.5 -bottom-0.5 rounded-full border-2',
                          statusColors[associate.status],
                          compact ? 'h-2.5 w-2.5' : 'h-3 w-3'
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent side='bottom' className='text-xs'>
                      {statusLabels[associate.status]}
                    </TooltipContent>
                  </Tooltip>
                </div>

                {/* Name and details */}
                <div className='min-w-0 flex-1'>
                  <p
                    className={cn(
                      'truncate font-medium',
                      compact ? 'text-sm' : 'text-base'
                    )}
                  >
                    {associate.user_name}
                  </p>
                  <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                    {showPosition && associate.position_title && (
                      <span className='truncate'>
                        {associate.position_title}
                      </span>
                    )}
                    {showPosition &&
                      showArea &&
                      associate.position_title &&
                      associate.working_area_name && (
                        <span className='text-muted-foreground/50'>•</span>
                      )}
                    {showArea && associate.working_area_name && (
                      <span className='truncate'>
                        {associate.working_area_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Mini timeline indicator (when collapsed) */}
              {!isExpanded && hasTimeline && !compact && (
                <MiniGanttTimeline timeline={associate.timeline!} />
              )}

              {/* Middle - Task count */}
              <div
                className={cn(
                  'text-center',
                  compact ? 'min-w-[60px]' : 'min-w-[80px]'
                )}
              >
                <p
                  className={cn(
                    'font-semibold',
                    compact ? 'text-lg' : 'text-xl'
                  )}
                >
                  {associate.total_tasks}
                </p>
                <p className='text-muted-foreground text-xs'>tasks</p>
              </div>

              {/* Right - Efficiency */}
              <div
                className={cn(
                  'text-right',
                  compact ? 'min-w-[60px]' : 'min-w-[80px]'
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <p
                        className={cn(
                          'font-bold',
                          compact ? 'text-lg' : 'text-xl',
                          efficiencyColor
                        )}
                      >
                        {associate.efficiency}%
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        efficiency
                      </p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side='left' className='max-w-[200px] text-xs'>
                    <p>
                      Status:{' '}
                      <span className='capitalize'>{efficiencyStatus}</span>
                    </p>
                    <p>Tasks: {associate.total_tasks} completed</p>
                    <p className='text-muted-foreground mt-1'>
                      Based on Labor Standards
                    </p>
                    <p className='text-muted-foreground/80 border-border/50 mt-1 border-t pt-1 text-[10px]'>
                      Capped at 150% to maintain meaningful team comparisons
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Optional efficiency badge for compact view */}
              {compact && (
                <Badge variant={badgeVariant} className='ml-2'>
                  {efficiencyStatus}
                </Badge>
              )}
            </motion.div>
          </CollapsibleTrigger>

          {/* Expanded content - using CSS grid animation for reliable height transitions */}
          <CollapsibleContent>
            <div className='border-border/50 border-t'>
              <div className='space-y-4 p-4'>
                {/* Gantt Timeline */}
                {hasEnhancedTimeline && enhancedTimeline && (
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <h4 className='text-muted-foreground text-sm font-medium'>
                        Activity Timeline
                      </h4>
                      {userOvertime && (
                        <Badge
                          variant='outline'
                          className='border-orange-300 text-xs text-orange-600'
                        >
                          +{formatDuration(userOvertime.overtimeMinutes)}{' '}
                          Overtime
                        </Badge>
                      )}
                    </div>
                    <ActivityGantt
                      timeline={enhancedTimeline}
                      height={40}
                      showLabels={true}
                      overtimeMarker={userOvertime}
                    />
                  </div>
                )}

                {/* Task Breakdown by Area */}
                {hasBreakdown && (
                  <div className='space-y-2'>
                    <h4 className='text-muted-foreground flex items-center gap-2 text-sm font-medium'>
                      <MapPin className='h-4 w-4' />
                      Tasks by Area
                    </h4>
                    <div className='grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3'>
                      {associate.taskBreakdown!.map((breakdown, idx) => (
                        <TaskBreakdownCard key={idx} breakdown={breakdown} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Task Type Summary - Dynamic, only shows non-zero values */}
                {(() => {
                  const taskMetrics = [
                    {
                      label: 'Scans',
                      value: associate.inbound_scans,
                      color: 'blue',
                    },
                    {
                      label: 'Putaway',
                      value: associate.put_aways,
                      color: 'purple',
                    },
                    {
                      label: 'Picking',
                      value: associate.picking,
                      color: 'green',
                    },
                    { label: 'Pack', value: associate.packed, color: 'orange' },
                    { label: 'Ship', value: associate.shipped, color: 'teal' },
                    {
                      label: 'Final Pack',
                      value: associate.final_packed,
                      color: 'amber',
                    },
                    {
                      label: 'Putback',
                      value: associate.putbacks,
                      color: 'rose',
                    },
                    {
                      label: 'Counts',
                      value: associate.cycle_counts,
                      color: 'indigo',
                    },
                  ].filter((m) => m.value > 0)

                  if (taskMetrics.length === 0) return null

                  return (
                    <div className='space-y-2'>
                      <h4 className='text-muted-foreground text-sm font-medium'>
                        Task Summary
                      </h4>
                      <div className='flex flex-wrap gap-2'>
                        {taskMetrics.map((metric) => (
                          <TaskDetail
                            key={metric.label}
                            label={metric.label}
                            value={metric.value}
                            color={metric.color}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* Activity Legend */}
                <ActivityLegend className='border-border/30 border-t pt-2' />
              </div>
            </div>
          </CollapsibleContent>
        </div>

        {/* Old expanded details (kept for backwards compatibility) - Now dynamic */}
        {showDetails &&
          !expandable &&
          (() => {
            const legacyMetrics = [
              { label: 'Inbound', value: associate.inbound_scans },
              { label: 'Put Away', value: associate.put_aways },
              { label: 'Picking', value: associate.picking },
              {
                label: 'Packed',
                value: associate.packed + associate.final_packed,
              },
              { label: 'Shipped', value: associate.shipped },
              { label: 'Putbacks', value: associate.putbacks },
              { label: 'Counts', value: associate.cycle_counts },
              { label: 'Work Queue', value: associate.work_queue_tasks },
            ].filter((m) => m.value > 0)

            if (legacyMetrics.length === 0) return null

            return (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className='mt-2 ml-12 flex flex-wrap gap-2 text-xs'
              >
                {legacyMetrics.map((metric) => (
                  <TaskDetail
                    key={metric.label}
                    label={metric.label}
                    value={metric.value}
                  />
                ))}
              </motion.div>
            )
          })()}
      </Collapsible>
    </TooltipProvider>
  )
}

// Task Breakdown Card Component
interface TaskBreakdownCardProps {
  breakdown: TaskBreakdownByArea
}

function TaskBreakdownCard({ breakdown }: TaskBreakdownCardProps) {
  const taskTypes = [
    { label: 'Scans', value: breakdown.inbound_scans, color: 'bg-blue-500' },
    { label: 'Putaway', value: breakdown.put_aways, color: 'bg-purple-500' },
    { label: 'Picks', value: breakdown.picking, color: 'bg-green-500' },
    { label: 'Pack', value: breakdown.packed, color: 'bg-orange-500' },
    { label: 'Ship', value: breakdown.shipped, color: 'bg-teal-500' },
    { label: 'Final', value: breakdown.final_packed, color: 'bg-amber-500' },
    { label: 'Putback', value: breakdown.putbacks, color: 'bg-rose-500' },
    { label: 'Count', value: breakdown.cycle_counts, color: 'bg-indigo-500' },
  ].filter((t) => t.value > 0)

  return (
    <div className='bg-background border-border/50 rounded-lg border p-2.5'>
      <div className='mb-2 flex items-center justify-between'>
        <div className='flex items-center gap-1.5'>
          <MapPin className='text-muted-foreground h-3 w-3' />
          <span className='truncate text-sm font-medium'>{breakdown.area}</span>
        </div>
        <Badge variant='secondary' className='px-1.5 text-xs'>
          {breakdown.total}
        </Badge>
      </div>
      <div className='flex flex-wrap gap-1'>
        {taskTypes.map((task, idx) => (
          <Tooltip key={idx}>
            <TooltipTrigger asChild>
              <div className='bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 text-xs'>
                <div className={cn('h-2 w-2 rounded-full', task.color)} />
                <span>{task.value}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side='top' className='text-xs'>
              {task.label}: {task.value}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

/**
 * Mini Gantt Timeline Component
 * Compact timeline visualization for collapsed rows showing proper time-based positioning
 * Updated: January 4, 2026 - Now uses dynamic activity config for colors
 */
interface MiniGanttTimelineProps {
  timeline: NonNullable<AssociateProductivity['timeline']>
}

// Fallback colors for mini gantt (used when config not loaded yet)
// Special block types (idle, break) that aren't in activity_source_config
const MINI_GANTT_SPECIAL_COLORS: Record<string, string> = {
  idle: 'bg-gray-300 dark:bg-gray-600',
  break: 'bg-yellow-400',
}

/**
 * Get minutes since midnight in EST timezone
 */
function getESTMinutesSinceMidnight(timestamp: string): number {
  const date = new Date(timestamp)
  const estTimeStr = date.toLocaleString('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const [hours, minutes] = estTimeStr.split(':').map(Number)
  return hours * 60 + minutes
}

function MiniGanttTimeline({ timeline }: MiniGanttTimelineProps) {
  // Load dynamic activity colors from config
  const { colorMap } = useActivityConfig()

  const MINUTES_IN_DAY = 24 * 60

  // Calculate block positions based on actual time of day
  const blockPositions = timeline.activityBlocks.map((block) => {
    const startMinutes = getESTMinutesSinceMidnight(block.startTime)
    const endMinutes = getESTMinutesSinceMidnight(block.endTime)

    const left = (startMinutes / MINUTES_IN_DAY) * 100
    const width = ((endMinutes - startMinutes) / MINUTES_IN_DAY) * 100

    return {
      ...block,
      left: Math.max(0, Math.min(100, left)),
      width: Math.max(0.5, Math.min(100 - Math.max(0, left), width)), // Min width of 0.5%
    }
  })

  // Calculate the working hours range (6 AM to 6 PM) for subtle background
  const workDayStart = (6 / 24) * 100 // 6 AM = 25%
  const workDayWidth = (12 / 24) * 100 // 12 hours = 50%

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='hidden w-[200px] cursor-pointer items-center gap-2 lg:flex'>
            <Clock className='text-muted-foreground h-3 w-3 flex-shrink-0' />
            <div className='bg-muted relative h-3 flex-1 overflow-hidden rounded'>
              {/* Work day highlight (6 AM - 6 PM) */}
              <div
                className='bg-primary/5 dark:bg-primary/10 absolute inset-y-0'
                style={{ left: `${workDayStart}%`, width: `${workDayWidth}%` }}
              />

              {/* Activity blocks with proper positioning - colors from dynamic config */}
              {blockPositions.map((block, idx) => {
                const isIdle = block.type === 'idle'
                const isBreak = block.type === 'break'

                // Set z-index: idle lowest, break middle, work activities highest
                const zIndex = isIdle ? 1 : isBreak ? 2 : 3

                // Get color from dynamic config, fallback to special colors, then default
                const bgColor =
                  MINI_GANTT_SPECIAL_COLORS[block.type] ||
                  colorMap[block.type] ||
                  'bg-gray-400'

                return (
                  <div
                    key={idx}
                    className={cn(
                      'absolute inset-y-0 rounded-[1px]',
                      bgColor,
                      // Add subtle border for breaks
                      isBreak && 'ring-1 ring-yellow-500/50'
                    )}
                    style={{
                      left: `${block.left}%`,
                      width: `${block.width}%`,
                      zIndex,
                    }}
                  />
                )
              })}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side='bottom' className='max-w-[200px] text-xs'>
          <div className='space-y-1'>
            <p className='font-medium'>Day Activity</p>
            <div className='text-muted-foreground flex items-center gap-2'>
              <span className='text-emerald-500'>Work:</span>
              <span>{formatDuration(timeline.totalWorkMinutes)}</span>
            </div>
            {timeline.totalBreakMinutes > 0 && (
              <div className='text-muted-foreground flex items-center gap-2'>
                <span className='text-yellow-500'>Break:</span>
                <span>{formatDuration(timeline.totalBreakMinutes)}</span>
              </div>
            )}
            <div className='text-muted-foreground flex items-center gap-2'>
              <span className='text-gray-400'>Idle:</span>
              <span>{formatDuration(timeline.totalIdleMinutes)}</span>
            </div>
            <p className='text-muted-foreground/70 border-border/50 border-t pt-1 text-[10px]'>
              Click row to expand timeline
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Task type to color mapping
const TASK_COLORS: Record<string, string> = {
  blue: 'border-blue-500/50 bg-blue-50 dark:bg-blue-950/30',
  purple: 'border-purple-500/50 bg-purple-50 dark:bg-purple-950/30',
  green: 'border-green-500/50 bg-green-50 dark:bg-green-950/30',
  orange: 'border-orange-500/50 bg-orange-50 dark:bg-orange-950/30',
  teal: 'border-teal-500/50 bg-teal-50 dark:bg-teal-950/30',
  amber: 'border-amber-500/50 bg-amber-50 dark:bg-amber-950/30',
  rose: 'border-rose-500/50 bg-rose-50 dark:bg-rose-950/30',
  indigo: 'border-indigo-500/50 bg-indigo-50 dark:bg-indigo-950/30',
  default: 'bg-background',
}

// Small task detail component
function TaskDetail({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: string
}) {
  return (
    <div
      className={cn(
        'rounded border p-1.5 text-center',
        color ? TASK_COLORS[color] : TASK_COLORS.default,
        !color && 'border-transparent'
      )}
    >
      <p className='font-semibold'>{value}</p>
      <p className='text-muted-foreground text-[10px]'>{label}</p>
    </div>
  )
}

// List variant for scrollable associate lists with virtualization for large datasets
interface AssociateListProps {
  associates: AssociateProductivity[]
  showArea?: boolean
  showPosition?: boolean
  maxHeight?: string
  compact?: boolean
  expandable?: boolean
  onSelectAssociate?: (associate: AssociateProductivity) => void
  timelineEvents?: import('@/lib/supabase/timeline-events.service').TimelineEventWithCategory[]
  approvedOvertime?: ApprovedOvertimeForTimeline[]
  className?: string
}

// Threshold for enabling virtualization (below this count, render all items normally)
// Set to 50 to disable virtualization for typical team sizes where expandable rows
// cause height estimation issues. Virtualization is only beneficial for very large lists.
const VIRTUALIZATION_THRESHOLD = 50

export function AssociateList({
  associates,
  showArea = true,
  showPosition = true,
  maxHeight = '400px',
  compact = false,
  expandable = true,
  onSelectAssociate,
  timelineEvents = [],
  approvedOvertime = [],
  className,
}: AssociateListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  // Track which rows are expanded to recalculate sizes
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Determine if we should use virtualization based on list size
  const shouldVirtualize = associates.length >= VIRTUALIZATION_THRESHOLD

  // Estimate row height based on expanded state
  // This provides initial estimates; ResizeObserver handles real-time measurement for accuracy
  // Accounts for all expanded sections: timeline, breakdown grid, task summary, legend
  // IMPORTANT: Always overestimate to prevent overlap - ResizeObserver will correct if needed
  const estimateSize = useCallback(
    (index: number) => {
      const associate = associates[index]
      const isExpanded = expandedRows.has(associate.user_id)

      // Base row height + bottom padding (pb-3 = 12px)
      const baseHeight = (compact ? 64 : 72) + 12

      if (isExpanded) {
        // Content padding (p-4 = 16px top+bottom) + border-t (1px)
        const contentPadding = 33
        const sectionGap = 16 // space-y-4 gap between sections

        // Activity Timeline section: header(28) + gantt(48) + work metrics row(24) + overtime badge area(24)
        const hasTimeline =
          (associate.timeline?.activityBlocks?.length ?? 0) > 0
        const timelineHeight = hasTimeline ? 124 : 0

        // Task Breakdown grid - estimate based on responsive columns
        // On mobile: single column, on larger screens: 2-3 columns
        // Each card is ~80px tall, use conservative single-column estimate
        const hasBreakdown =
          associate.taskBreakdown && associate.taskBreakdown.length > 0
        const breakdownItems = hasBreakdown
          ? associate.taskBreakdown!.length
          : 0
        // Header(32px) + items * 88px (card height + gap + padding)
        const breakdownHeight = hasBreakdown ? 36 + breakdownItems * 88 : 0

        // Task Summary: header(28px) + flex-wrap badges which can span 2 rows(~48px)
        const taskSummaryHeight = 76

        // Activity Legend: border-t pt-2(8px) + legend content
        // Legend has 15 items that wrap across 2-3 rows depending on viewport width
        // Each row ~28px, assume 3 rows worst case = 84px + header/padding
        const legendHeight = 100

        // Sum all sections
        let height =
          baseHeight +
          contentPadding +
          timelineHeight +
          breakdownHeight +
          taskSummaryHeight +
          legendHeight

        // Add gaps between rendered sections
        const sectionCount = (hasTimeline ? 1 : 0) + (hasBreakdown ? 1 : 0) + 2 // +2 for summary and legend
        height += Math.max(0, sectionCount - 1) * sectionGap

        // Large safety buffer to absolutely prevent overlap
        // Better to have extra space than content overlapping
        height += 80

        return height
      }
      return baseHeight
    },
    [associates, expandedRows, compact]
  )

  // Create virtualizer instance
  const virtualizer = useVirtualizer({
    count: associates.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5, // Render 5 extra items above and below the visible area
    getItemKey: (index) => associates[index].user_id,
  })

  // Handle row expansion changes to trigger size recalculation
  // Note: Primary height tracking is now done via ResizeObserver in VirtualizedAssociateRow
  // This callback just tracks state and triggers a backup measurement after animation completes
  const handleExpansionChange = useCallback(
    (userId: string, isExpanded: boolean) => {
      setExpandedRows((prev) => {
        const next = new Set(prev)
        if (isExpanded) {
          next.add(userId)
        } else {
          next.delete(userId)
        }
        return next
      })
      // Single measurement after CSS transition completes (300ms animation + buffer)
      // The ResizeObserver handles real-time updates, this is just a safety backup
      setTimeout(() => virtualizer.measure(), 350)
    },
    [virtualizer]
  )

  if (associates.length === 0) {
    return (
      <div className='text-muted-foreground py-8 text-center'>
        <p>No associates found</p>
      </div>
    )
  }

  // For small lists, render without virtualization to preserve animations
  if (!shouldVirtualize) {
    return (
      <motion.div
        className={cn('space-y-2 overflow-y-auto pr-1', className)}
        style={{ maxHeight }}
        initial='hidden'
        animate='visible'
        variants={{
          hidden: { opacity: 0 },
          visible: {
            opacity: 1,
            transition: { staggerChildren: 0.05 },
          },
        }}
      >
        {associates.map((associate) => (
          <motion.div
            key={associate.user_id}
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0 },
            }}
          >
            <AssociatePerformanceRow
              associate={associate}
              showArea={showArea}
              showPosition={showPosition}
              compact={compact}
              expandable={expandable}
              onClick={
                onSelectAssociate
                  ? () => onSelectAssociate(associate)
                  : undefined
              }
              timelineEvents={timelineEvents}
              approvedOvertime={approvedOvertime}
            />
          </motion.div>
        ))}
      </motion.div>
    )
  }

  // For large lists, use virtualization for performance
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      ref={parentRef}
      className={cn('overflow-y-auto pr-1', className)}
      style={{ maxHeight }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const associate = associates[virtualRow.index]
          const isInitialRender = virtualRow.index < 10 // Animate first 10 items

          return (
            <VirtualizedRowWrapper
              key={virtualRow.key}
              virtualRow={virtualRow}
              measureElement={virtualizer.measureElement}
              isInitialRender={isInitialRender}
            >
              <VirtualizedAssociateRow
                associate={associate}
                showArea={showArea}
                showPosition={showPosition}
                compact={compact}
                expandable={expandable}
                onClick={
                  onSelectAssociate
                    ? () => onSelectAssociate(associate)
                    : undefined
                }
                timelineEvents={timelineEvents}
                approvedOvertime={approvedOvertime}
                onExpandedChange={(isExpanded) =>
                  handleExpansionChange(associate.user_id, isExpanded)
                }
              />
            </VirtualizedRowWrapper>
          )
        })}
      </div>
    </div>
  )
}

// Wrapper component with ResizeObserver for accurate height tracking
interface VirtualizedRowWrapperProps {
  virtualRow: { key: React.Key; index: number; start: number }
  measureElement: (node: Element | null) => void
  isInitialRender: boolean
  children: React.ReactNode
}

function VirtualizedRowWrapper({
  virtualRow,
  measureElement,
  isInitialRender,
  children,
}: VirtualizedRowWrapperProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<((node: Element | null) => void) | null>(null)

  // Store the measureElement function ref
  measureRef.current = measureElement

  // Use ResizeObserver to detect actual size changes and trigger re-measurement
  // This ensures the virtualizer always has accurate heights, especially during animations
  useEffect(() => {
    const element = rowRef.current
    if (!element) return

    const resizeObserver = new ResizeObserver(() => {
      // Trigger the virtualizer's measureElement when size changes
      // This is called during expansion/collapse animations for real-time updates
      if (measureRef.current && element) {
        measureRef.current(element)
      }
    })

    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // Combined ref callback to attach both our ref and the virtualizer's measureElement
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      // Update our local ref
      ;(rowRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      // Call the virtualizer's measureElement
      measureElement(node)
    },
    [measureElement]
  )

  return (
    <div
      ref={setRefs}
      data-index={virtualRow.index}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${virtualRow.start}px)`,
      }}
    >
      <motion.div
        initial={isInitialRender ? { opacity: 0, y: 10 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.2,
          delay: isInitialRender ? virtualRow.index * 0.03 : 0,
        }}
        className='pb-3' // Increased spacing (12px) between rows for better visual separation
      >
        {children}
      </motion.div>
    </div>
  )
}

// Wrapper component that tracks expansion state for virtualization
interface VirtualizedAssociateRowProps extends Omit<
  AssociatePerformanceRowProps,
  'defaultExpanded'
> {
  onExpandedChange?: (isExpanded: boolean) => void
}

function VirtualizedAssociateRow({
  onExpandedChange,
  ...props
}: VirtualizedAssociateRowProps) {
  return (
    <AssociatePerformanceRowWithCallback
      {...props}
      onExpandedChange={onExpandedChange}
    />
  )
}

// Extended version of AssociatePerformanceRow that notifies parent of expansion changes
interface AssociatePerformanceRowWithCallbackProps extends AssociatePerformanceRowProps {
  onExpandedChange?: (isExpanded: boolean) => void
}

function AssociatePerformanceRowWithCallback({
  associate,
  showArea = true,
  showPosition = true,
  showDetails = false,
  compact = false,
  expandable = true,
  defaultExpanded = false,
  onClick,
  timelineEvents = [],
  approvedOvertime = [],
  onExpandedChange,
  className,
}: AssociatePerformanceRowWithCallbackProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const handleExpandedChange = (expanded: boolean) => {
    setIsExpanded(expanded)
    onExpandedChange?.(expanded)
  }

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
    } as OvertimeMarker
  }, [approvedOvertime, associate.user_id])

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

  const efficiencyStatus = getEfficiencyStatus(associate.efficiency)
  const efficiencyColor = getEfficiencyColor(associate.efficiency)
  const badgeVariant = getEfficiencyBadgeVariant(associate.efficiency)

  // Get user initials
  const getInitials = (name: string) => {
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }

  const hasTimeline =
    associate.timeline && associate.timeline.activityBlocks.length > 0
  const hasBreakdown =
    associate.taskBreakdown && associate.taskBreakdown.length > 0

  // Merge timeline events into the activity blocks (same logic as original)
  const enhancedTimeline: DailyTimeline | undefined = useMemo(() => {
    if (!associate.timeline) return undefined
    if (timelineEvents.length === 0) return associate.timeline

    // Filter events that apply to this specific associate based on scope
    const applicableEvents = timelineEvents.filter(
      (event: TimelineEventWithCategory) => {
        if (event.scope_type === 'all') return true
        if (event.scope_type === 'area') {
          return event.working_area_id === associate.working_area_id
        }
        if (event.scope_type === 'shift') {
          return true
        }
        if (event.scope_type === 'user') {
          return event.assigned_user_ids?.includes(associate.user_id)
        }
        return false
      }
    )

    if (applicableEvents.length === 0) return associate.timeline

    const timeToMinutes = (timeStr: string): number => {
      const parts = timeStr.split(':').map(Number)
      return parts[0] * 60 + (parts[1] || 0)
    }

    const timestampToMinutes = (timestamp: string): number => {
      const date = new Date(timestamp)
      const estTimeStr = date.toLocaleString('en-US', {
        timeZone: TIMEZONE,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })
      const [hours, minutes] = estTimeStr.split(':').map(Number)
      return hours * 60 + minutes
    }

    const isDateInDST = (date: Date): boolean => {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        timeZoneName: 'short',
      })
      const parts = formatter.formatToParts(date)
      const tzName = parts.find((p) => p.type === 'timeZoneName')?.value
      return tzName === 'EDT'
    }

    const minutesToTimestamp = (dateStr: string, mins: number): string => {
      const clampedMins = Math.max(0, Math.min(1439, mins))
      const hours = Math.floor(clampedMins / 60)
      const minutes = clampedMins % 60
      const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`
      const testDate = new Date(`${dateStr}T12:00:00`)
      const isDST = isDateInDST(testDate)
      const estOffsetHours = isDST ? 4 : 5
      return new Date(
        `${dateStr}T${timeStr}.000-0${estOffsetHours}:00`
      ).toISOString()
    }

    const eventRanges = applicableEvents.map(
      (event: TimelineEventWithCategory) => {
        const startMin = timeToMinutes(event.start_time)
        const endMin = timeToMinutes(event.end_time)
        return { event, startMin, endMin, duration: endMin - startMin }
      }
    )

    const resultBlocks: ActivityBlock[] = []

    for (const block of associate.timeline.activityBlocks) {
      if (block.type !== 'idle') {
        resultBlocks.push(block)
        continue
      }

      const blockStartMin = timestampToMinutes(block.startTime)
      const blockEndMin = timestampToMinutes(block.endTime)
      const dateStr = block.startTime.split('T')[0]

      const overlappingEvents = eventRanges.filter(
        (er) => er.startMin < blockEndMin && er.endMin > blockStartMin
      )

      if (overlappingEvents.length === 0) {
        resultBlocks.push(block)
        continue
      }

      overlappingEvents.sort((a, b) => a.startMin - b.startMin)

      let currentPos = blockStartMin

      for (const er of overlappingEvents) {
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

    resultBlocks.sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    )

    const newTotalIdleMinutes = resultBlocks
      .filter((b) => b.type === 'idle')
      .reduce((sum, b) => sum + b.duration, 0)

    return {
      ...associate.timeline,
      activityBlocks: resultBlocks,
      totalIdleMinutes: newTotalIdleMinutes,
    }
  }, [
    associate.timeline,
    timelineEvents,
    associate.user_id,
    associate.working_area_id,
  ])

  const hasEnhancedTimeline =
    enhancedTimeline && enhancedTimeline.activityBlocks.length > 0

  return (
    <TooltipProvider>
      <Collapsible open={isExpanded} onOpenChange={handleExpandedChange}>
        <div
          className={cn(
            'bg-muted/50 relative rounded-lg transition-all duration-200',
            isExpanded && 'bg-muted/70 ring-border/50 z-10 ring-1',
            className
          )}
        >
          {/* Main row */}
          <CollapsibleTrigger asChild disabled={!expandable}>
            <motion.div
              className={cn(
                'hover:bg-muted flex items-center justify-between transition-all duration-200',
                compact ? 'gap-2 p-2' : 'gap-4 p-3',
                expandable && 'cursor-pointer hover:shadow-sm',
                !expandable && onClick && 'cursor-pointer'
              )}
              whileHover={{ x: expandable ? 2 : 0 }}
              onClick={!expandable ? onClick : undefined}
            >
              {/* Expand indicator */}
              {expandable && (
                <div className='w-5 flex-shrink-0'>
                  {isExpanded ? (
                    <ChevronDown className='text-muted-foreground h-4 w-4' />
                  ) : (
                    <ChevronRight className='text-muted-foreground h-4 w-4' />
                  )}
                </div>
              )}

              {/* Left side - Avatar and info */}
              <div className='flex min-w-0 flex-1 items-center gap-3'>
                <div className='relative flex-shrink-0'>
                  <Avatar className={compact ? 'h-8 w-8' : 'h-10 w-10'}>
                    <AvatarImage
                      src={associate.avatar_url}
                      alt={associate.user_name}
                    />
                    <AvatarFallback className='bg-primary/10 text-xs'>
                      {getInitials(associate.user_name)}
                    </AvatarFallback>
                  </Avatar>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          'border-background absolute -right-0.5 -bottom-0.5 rounded-full border-2',
                          statusColors[associate.status],
                          compact ? 'h-2.5 w-2.5' : 'h-3 w-3'
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent side='bottom' className='text-xs'>
                      {statusLabels[associate.status]}
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className='min-w-0 flex-1'>
                  <p
                    className={cn(
                      'truncate font-medium',
                      compact ? 'text-sm' : 'text-base'
                    )}
                  >
                    {associate.user_name}
                  </p>
                  <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                    {showPosition && associate.position_title && (
                      <span className='truncate'>
                        {associate.position_title}
                      </span>
                    )}
                    {showPosition &&
                      showArea &&
                      associate.position_title &&
                      associate.working_area_name && (
                        <span className='text-muted-foreground/50'>•</span>
                      )}
                    {showArea && associate.working_area_name && (
                      <span className='truncate'>
                        {associate.working_area_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Mini timeline indicator (when collapsed) */}
              {!isExpanded && hasTimeline && !compact && (
                <MiniGanttTimeline timeline={associate.timeline!} />
              )}

              {/* Middle - Task count */}
              <div
                className={cn(
                  'text-center',
                  compact ? 'min-w-[60px]' : 'min-w-[80px]'
                )}
              >
                <p
                  className={cn(
                    'font-semibold',
                    compact ? 'text-lg' : 'text-xl'
                  )}
                >
                  {associate.total_tasks}
                </p>
                <p className='text-muted-foreground text-xs'>tasks</p>
              </div>

              {/* Right - Efficiency */}
              <div
                className={cn(
                  'text-right',
                  compact ? 'min-w-[60px]' : 'min-w-[80px]'
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <p
                        className={cn(
                          'font-bold',
                          compact ? 'text-lg' : 'text-xl',
                          efficiencyColor
                        )}
                      >
                        {associate.efficiency}%
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        efficiency
                      </p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side='left' className='max-w-[200px] text-xs'>
                    <p>
                      Status:{' '}
                      <span className='capitalize'>{efficiencyStatus}</span>
                    </p>
                    <p>Tasks: {associate.total_tasks} completed</p>
                    <p className='text-muted-foreground mt-1'>
                      Based on Labor Standards
                    </p>
                    <p className='text-muted-foreground/80 border-border/50 mt-1 border-t pt-1 text-[10px]'>
                      Capped at 150% to maintain meaningful team comparisons
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {compact && (
                <Badge variant={badgeVariant} className='ml-2'>
                  {efficiencyStatus}
                </Badge>
              )}
            </motion.div>
          </CollapsibleTrigger>

          {/* Expanded content - using CSS grid animation for reliable height transitions */}
          <CollapsibleContent>
            <div className='border-border/50 border-t'>
              <div className='space-y-4 p-4'>
                {hasEnhancedTimeline && enhancedTimeline && (
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <h4 className='text-muted-foreground text-sm font-medium'>
                        Activity Timeline
                      </h4>
                      {userOvertime && (
                        <Badge
                          variant='outline'
                          className='border-orange-300 text-xs text-orange-600'
                        >
                          +{formatDuration(userOvertime.overtimeMinutes)}{' '}
                          Overtime
                        </Badge>
                      )}
                    </div>
                    <ActivityGantt
                      timeline={enhancedTimeline}
                      height={40}
                      showLabels={true}
                      overtimeMarker={userOvertime}
                    />
                  </div>
                )}

                {hasBreakdown && (
                  <div className='space-y-2'>
                    <h4 className='text-muted-foreground flex items-center gap-2 text-sm font-medium'>
                      <MapPin className='h-4 w-4' />
                      Tasks by Area
                    </h4>
                    <div className='grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3'>
                      {associate.taskBreakdown!.map((breakdown, idx) => (
                        <TaskBreakdownCard key={idx} breakdown={breakdown} />
                      ))}
                    </div>
                  </div>
                )}

                {(() => {
                  const taskMetrics = [
                    {
                      label: 'Scans',
                      value: associate.inbound_scans,
                      color: 'blue',
                    },
                    {
                      label: 'Putaway',
                      value: associate.put_aways,
                      color: 'purple',
                    },
                    {
                      label: 'Picking',
                      value: associate.picking,
                      color: 'green',
                    },
                    { label: 'Pack', value: associate.packed, color: 'orange' },
                    { label: 'Ship', value: associate.shipped, color: 'teal' },
                    {
                      label: 'Final Pack',
                      value: associate.final_packed,
                      color: 'amber',
                    },
                    {
                      label: 'Putback',
                      value: associate.putbacks,
                      color: 'rose',
                    },
                    {
                      label: 'Counts',
                      value: associate.cycle_counts,
                      color: 'indigo',
                    },
                  ].filter((m) => m.value > 0)

                  if (taskMetrics.length === 0) return null

                  return (
                    <div className='space-y-2'>
                      <h4 className='text-muted-foreground text-sm font-medium'>
                        Task Summary
                      </h4>
                      <div className='flex flex-wrap gap-2'>
                        {taskMetrics.map((metric) => (
                          <TaskDetail
                            key={metric.label}
                            label={metric.label}
                            value={metric.value}
                            color={metric.color}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })()}

                <ActivityLegend className='border-border/30 border-t pt-2' />
              </div>
            </div>
          </CollapsibleContent>
        </div>

        {showDetails &&
          !expandable &&
          (() => {
            const legacyMetrics = [
              { label: 'Inbound', value: associate.inbound_scans },
              { label: 'Put Away', value: associate.put_aways },
              { label: 'Picking', value: associate.picking },
              {
                label: 'Packed',
                value: associate.packed + associate.final_packed,
              },
              { label: 'Shipped', value: associate.shipped },
              { label: 'Putbacks', value: associate.putbacks },
              { label: 'Counts', value: associate.cycle_counts },
              { label: 'Work Queue', value: associate.work_queue_tasks },
            ].filter((m) => m.value > 0)

            if (legacyMetrics.length === 0) return null

            return (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className='mt-2 ml-12 flex flex-wrap gap-2 text-xs'
              >
                {legacyMetrics.map((metric) => (
                  <TaskDetail
                    key={metric.label}
                    label={metric.label}
                    value={metric.value}
                  />
                ))}
              </motion.div>
            )
          })()}
      </Collapsible>
    </TooltipProvider>
  )
}

// Compact inline avatar group
interface AvatarGroupProps {
  associates: AssociateProductivity[]
  max?: number
  size?: 'sm' | 'md' | 'lg'
}

export function AvatarGroup({
  associates,
  max = 5,
  size = 'md',
}: AvatarGroupProps) {
  const shown = associates.slice(0, max)
  const remaining = associates.length - max

  const sizeClasses = {
    sm: 'h-6 w-6 text-[10px]',
    md: 'h-8 w-8 text-xs',
    lg: 'h-10 w-10 text-sm',
  }

  const getInitials = (name: string) => {
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }

  return (
    <div className='flex -space-x-2'>
      {shown.map((associate) => (
        <Tooltip key={associate.user_id}>
          <TooltipTrigger asChild>
            <Avatar
              className={cn(sizeClasses[size], 'border-background border-2')}
            >
              <AvatarImage
                src={associate.avatar_url}
                alt={associate.user_name}
              />
              <AvatarFallback className='bg-primary/10'>
                {getInitials(associate.user_name)}
              </AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent side='bottom' className='text-xs'>
            <p className='font-medium'>{associate.user_name}</p>
            <p>{associate.efficiency}% efficiency</p>
          </TooltipContent>
        </Tooltip>
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            sizeClasses[size],
            'bg-muted border-background flex items-center justify-center rounded-full border-2 font-medium'
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  )
}
