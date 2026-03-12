/**
 * Activity Gantt Component
 * Visual timeline showing work activity blocks throughout the day
 * Created: January 1, 2026
 * Updated: January 1, 2026 - Fixed timezone alignment issue between timeline and activity blocks
 * Updated: January 1, 2026 - Fixed break/idle overlap: breaks now properly split from idle blocks
 *   - Removed separate break block overlay rendering
 *   - Breaks are now integrated into activityBlocks with type 'break'
 *   - Idle time no longer incorrectly includes scheduled break periods
 * Updated: January 4, 2026 - Made activity colors dynamic from activity_source_config table
 *   - Now supports custom activity types added via Settings → Activity Sources
 *   - Colors and labels are loaded from database configuration
 */
import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { TIMEZONE } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useActivityConfig } from '@/hooks/use-activity-config'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type {
  ActivityBlock,
  DailyTimeline,
} from '../types/team-performance.types'

// Zoom presets for quick time range selection
const ZOOM_PRESETS = [
  { label: 'Full Day', start: 0, end: 24, tooltip: undefined },
  { label: 'Morning', start: 6, end: 12, tooltip: '6 AM - 12 PM' },
  { label: 'Afternoon', start: 12, end: 18, tooltip: '12 PM - 6 PM' },
  { label: 'Evening', start: 18, end: 24, tooltip: '6 PM - 12 AM' },
  { label: 'Work Hours', start: 6, end: 18, tooltip: '6 AM - 6 PM' },
] as const

// Tailwind safelist for dynamic activity colors (ensures these classes are included in build)
// These colors can be configured via activity_source_config in the database
// prettier-ignore
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Intentionally unused - exists to force Tailwind to include these dynamic classes in build
const _DYNAMIC_COLOR_SAFELIST = [
  'bg-lime-500', 'bg-lime-400', 'hover:bg-lime-400',
  'bg-teal-500', 'bg-teal-400', 'hover:bg-teal-400',
  'bg-pink-500', 'bg-pink-400', 'hover:bg-pink-400',
  'bg-fuchsia-500', 'bg-fuchsia-400', 'hover:bg-fuchsia-400',
  'bg-red-500', 'bg-red-400', 'hover:bg-red-400',
  'bg-green-500', 'bg-green-400', 'hover:bg-green-400',
  'bg-blue-500', 'bg-blue-400', 'hover:bg-blue-400',
] as const

// Fallback colors for special block types (idle, break, event)
// These are not configurable via activity_source_config
const SPECIAL_BLOCK_COLORS: Record<
  string,
  {
    bg: string
    bgHover: string
    text: string
    label: string
  }
> = {
  idle: {
    bg: 'bg-gray-200 dark:bg-gray-700',
    bgHover: 'hover:bg-gray-300 dark:hover:bg-gray-600',
    text: 'text-gray-600 dark:text-gray-400',
    label: 'Idle',
  },
  break: {
    bg: 'bg-yellow-200 dark:bg-yellow-800',
    bgHover: 'hover:bg-yellow-300 dark:hover:bg-yellow-700',
    text: 'text-yellow-800 dark:text-yellow-200',
    label: 'Break',
  },
  event: {
    bg: 'bg-purple-300 dark:bg-purple-700',
    bgHover: 'hover:bg-purple-400 dark:hover:bg-purple-600',
    text: 'text-purple-900 dark:text-purple-100',
    label: 'Event',
  },
}

// Hour labels for the timeline
const HOUR_LABELS = [
  '12 AM',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12 PM',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
]

// Default timezone for timeline display - uses centralized constant
// TODO: Make this configurable via organization settings
const DEFAULT_TIMEZONE = TIMEZONE

/**
 * Get minutes since midnight in configured timezone
 * This is used for precise block positioning on the Gantt chart
 * @param timestamp - ISO timestamp
 * @param timezone - Optional timezone override (defaults to organization timezone)
 */
function getMinutesSinceMidnightInTimezone(
  timestamp: string,
  timezone: string = DEFAULT_TIMEZONE
): number {
  const date = new Date(timestamp)
  const timeStr = date.toLocaleString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

// Legacy alias for backwards compatibility
const getESTMinutesSinceMidnight = getMinutesSinceMidnightInTimezone

// Format time for display
function formatTime(
  timestamp: string,
  timezone: string = DEFAULT_TIMEZONE
): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  })
}

// Format duration for display
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

/**
 * Apply opacity to any CSS color format safely
 * Handles hex, rgb, hsl, and named colors
 * @param color - Any valid CSS color string
 * @param opacity - Opacity value from 0 to 1
 * @returns CSS color string with opacity applied
 */
function applyOpacity(color: string, opacity: number): string {
  // If it's a hex color, we can append the alpha channel directly
  if (color.startsWith('#')) {
    const alpha = Math.round(opacity * 255)
      .toString(16)
      .padStart(2, '0')
    // Handle both 3-digit (#RGB) and 6-digit (#RRGGBB) hex colors
    const baseColor =
      color.length === 4
        ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
        : color.slice(0, 7) // Truncate any existing alpha
    return baseColor + alpha
  }
  // For any other format (rgb, hsl, named colors), use color-mix
  // color-mix is well-supported in modern browsers (Chrome 111+, Firefox 113+, Safari 16.4+)
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`
}

export interface OvertimeMarker {
  originalShiftEnd: string // Time string like "14:30"
  extendedShiftEnd: string // Time string like "16:30"
  overtimeMinutes: number
}

interface ActivityGanttProps {
  timeline: DailyTimeline
  height?: number
  showLabels?: boolean
  showSummary?: boolean
  showShiftMarkers?: boolean
  overtimeMarker?: OvertimeMarker
  className?: string
  /** Start hour for the timeline display (0-23, default: 0 for midnight) */
  startHour?: number
  /** End hour for the timeline display (1-24, default: 24 for full day) */
  endHour?: number
  /** Use compact text size for summary footer (25% smaller) */
  compactSummary?: boolean
  /** Optional callback fired when an activity block is clicked */
  onBlockClick?: (block: ActivityBlock, event: React.MouseEvent) => void
  /** Enable zoom controls for focusing on specific time ranges */
  enableZoom?: boolean
  /** Enable export button to download the timeline as PNG */
  enableExport?: boolean
  /** Custom filename for the exported PNG (defaults to activity-timeline-{timestamp}.png) */
  exportFilename?: string
}

/**
 * Validate time string format (HH:MM, H:MM, HH:MM:SS, or H:MM:SS)
 * Returns true if valid time format with hours 0-23 and minutes 0-59
 */
function isValidTimeString(timeStr: string | undefined | null): boolean {
  if (!timeStr || typeof timeStr !== 'string') return false
  // Match both HH:MM and HH:MM:SS formats
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return false
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

/**
 * Convert a time string (like "06:00", "14:30", "07:30:00") to minutes since midnight
 * Handles both HH:MM and HH:MM:SS formats
 * Returns 0 for invalid time formats
 */
function timeStringToMinutes(timeStr: string): number {
  if (!isValidTimeString(timeStr)) {
    logger.warn(`Invalid time string format: "${timeStr}", defaulting to 0`)
    return 0
  }
  const parts = timeStr.split(':').map(Number)
  // Only use hours and minutes (ignore seconds if present)
  return parts[0] * 60 + (parts[1] || 0)
}

/**
 * Format a time string for display
 */
function formatTimeString(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const hour = hours % 12 || 12
  const ampm = hours >= 12 ? 'PM' : 'AM'
  return minutes
    ? `${hour}:${minutes.toString().padStart(2, '0')} ${ampm}`
    : `${hour} ${ampm}`
}

export function ActivityGantt({
  timeline,
  height = 48,
  showLabels = true,
  showSummary = true,
  showShiftMarkers = true,
  overtimeMarker,
  className,
  startHour = 0,
  endHour = 24,
  compactSummary = false,
  onBlockClick,
  enableZoom = false,
  enableExport = false,
  exportFilename,
}: ActivityGanttProps) {
  // Load dynamic activity configuration from database
  const { getActivityColors } = useActivityConfig()

  // Ref for the timeline container (used for PNG export)
  const timelineRef = useRef<HTMLDivElement>(null)

  // Export state for loading indicator
  const [isExporting, setIsExporting] = useState(false)

  // Zoom state - only used when enableZoom is true
  const [zoomRange, setZoomRange] = useState({ start: startHour, end: endHour })

  /**
   * Export the timeline as a PNG image
   * Uses html-to-image for high-quality rendering
   */
  const handleExport = async () => {
    if (!timelineRef.current || isExporting) return

    setIsExporting(true)
    try {
      // Dynamically import html-to-image to reduce initial bundle size
      const { toPng } = await import('html-to-image')

      const dataUrl = await toPng(timelineRef.current, {
        backgroundColor: '#ffffff',
        pixelRatio: 2, // Higher quality for reports
        style: {
          // Ensure consistent rendering for export
          borderRadius: '8px',
        },
      })

      // Create download link and trigger download
      const link = document.createElement('a')
      const timestamp = format(new Date(timeline.dayStart), 'yyyy-MM-dd')
      link.download = exportFilename || `activity-timeline-${timestamp}.png`
      link.href = dataUrl
      link.click()

      toast.success('Timeline exported successfully')
    } catch (error) {
      logger.error('Export failed:', error)
      toast.error('Failed to export timeline')
    } finally {
      setIsExporting(false)
    }
  }

  // Use zoom range when zoom is enabled, otherwise use props
  const effectiveStartHour = enableZoom ? zoomRange.start : startHour
  const effectiveEndHour = enableZoom ? zoomRange.end : endHour

  // Calculate visible time range in minutes
  // Guard against invalid hour ranges to prevent division by zero
  const safeStartHour = Math.max(0, Math.min(23, effectiveStartHour))
  const safeEndHour = Math.max(
    safeStartHour + 1,
    Math.min(24, effectiveEndHour)
  )
  const visibleStartMinutes = safeStartHour * 60
  const visibleEndMinutes = safeEndHour * 60
  const VISIBLE_MINUTES = Math.max(60, visibleEndMinutes - visibleStartMinutes) // Minimum 1 hour to prevent division by zero

  // Generate hour markers for the visible range only
  const hourMarkers = useMemo(() => {
    const markers: { label: string; hour: number; position: number }[] = []
    // Calculate appropriate step based on visible range (2 hours for full day, 1 hour for shorter ranges)
    const hourStep = safeEndHour - safeStartHour <= 16 ? 1 : 2
    const hourRange = safeEndHour - safeStartHour
    for (let h = safeStartHour; h <= safeEndHour; h += hourStep) {
      const hourIndex = h % 24
      markers.push({
        label: HOUR_LABELS[hourIndex] || '12 AM',
        hour: h,
        position: hourRange > 0 ? ((h - safeStartHour) / hourRange) * 100 : 0, // Position relative to visible range
      })
    }
    return markers
  }, [safeStartHour, safeEndHour])

  // Calculate shift marker positions relative to visible range
  // Issue 3.18: Adjust markers at exact 0% or 100% to prevent clipping
  const shiftMarkers = useMemo(() => {
    const markers: {
      position: number
      label: string
      type: 'start' | 'end'
    }[] = []

    // Helper to adjust position to prevent clipping at edges
    const adjustPosition = (pos: number): number => {
      // Add small offset at exact boundaries to prevent clipping
      if (pos <= 0.5) return 0.5 // Prevent left edge clipping
      if (pos >= 99.5) return 99.5 // Prevent right edge clipping
      return pos
    }

    if (showShiftMarkers && timeline.scheduledShiftStart) {
      const startMinutes = timeStringToMinutes(timeline.scheduledShiftStart)
      const position =
        ((startMinutes - visibleStartMinutes) / VISIBLE_MINUTES) * 100
      // Only show marker if within visible range
      if (position >= 0 && position <= 100) {
        markers.push({
          position: adjustPosition(position),
          label: formatTimeString(timeline.scheduledShiftStart),
          type: 'start',
        })
      }
    }

    if (showShiftMarkers && timeline.scheduledShiftEnd) {
      const endMinutes = timeStringToMinutes(timeline.scheduledShiftEnd)
      const position =
        ((endMinutes - visibleStartMinutes) / VISIBLE_MINUTES) * 100
      // Only show marker if within visible range
      if (position >= 0 && position <= 100) {
        markers.push({
          position: adjustPosition(position),
          label: formatTimeString(timeline.scheduledShiftEnd),
          type: 'end',
        })
      }
    }

    return markers
  }, [
    timeline.scheduledShiftStart,
    timeline.scheduledShiftEnd,
    showShiftMarkers,
    visibleStartMinutes,
    VISIBLE_MINUTES,
  ])

  // Calculate overtime marker position relative to visible range
  // Issue 3.18: Adjust position at edges to prevent clipping
  const overtimeMarkerData = useMemo(() => {
    if (!overtimeMarker) return null

    const extendedMinutes = timeStringToMinutes(overtimeMarker.extendedShiftEnd)
    let position =
      ((extendedMinutes - visibleStartMinutes) / VISIBLE_MINUTES) * 100
    // Only show if within visible range
    if (position < 0 || position > 100) return null

    // Adjust position to prevent clipping at edges
    if (position <= 0.5) position = 0.5
    if (position >= 99.5) position = 99.5

    return {
      position,
      label: formatTimeString(overtimeMarker.extendedShiftEnd),
      originalEnd: formatTimeString(overtimeMarker.originalShiftEnd),
      overtimeMinutes: overtimeMarker.overtimeMinutes,
    }
  }, [overtimeMarker, visibleStartMinutes, VISIBLE_MINUTES])

  // Calculate block positions based on EST time of day, relative to visible range
  // Note: Breaks are now integrated into activityBlocks via service layer (split from idle)
  // Issue 3.11: Sort blocks by type for proper z-index layering
  // Issue 3.12: Use proportional minimum width based on actual duration
  // Issue 3.17: Ensure width doesn't overflow past 100%
  const blockPositions = useMemo(() => {
    const processedBlocks = timeline.activityBlocks
      .map((block, originalIndex) => {
        // Get minutes since midnight in EST for start and end times
        const startMinutes = getESTMinutesSinceMidnight(block.startTime)
        const endMinutes = getESTMinutesSinceMidnight(block.endTime)

        // Clamp to visible range
        const clampedStart = Math.max(startMinutes, visibleStartMinutes)
        const clampedEnd = Math.min(endMinutes, visibleEndMinutes)

        // Skip blocks entirely outside visible range
        if (
          clampedEnd <= visibleStartMinutes ||
          clampedStart >= visibleEndMinutes
        ) {
          return null
        }

        // Calculate position as percentage of visible range
        const left =
          ((clampedStart - visibleStartMinutes) / VISIBLE_MINUTES) * 100
        const rawWidth = ((clampedEnd - clampedStart) / VISIBLE_MINUTES) * 100

        // Issue 3.12: Use smaller minimum width (0.15%) to reduce visual inflation
        // Only apply minimum to work blocks with actual tasks, not to all blocks
        const hasActivity = block.taskCount > 0
        const isWorkBlock = block.type !== 'idle' && block.type !== 'break'
        const minWidth = hasActivity && isWorkBlock ? 0.15 : 0

        // Issue 3.17: Ensure width doesn't overflow past 100%
        const maxWidth = Math.max(0, 100 - Math.max(0, left))
        const width = Math.max(minWidth, Math.min(maxWidth, rawWidth))

        // Issue 3.11: Assign z-index based on block type for proper layering
        // Higher z-index = rendered on top
        let zIndex = 5 // Default for idle
        if (block.type === 'break') zIndex = 10
        else if (block.type === 'event') zIndex = 12
        else if (block.type !== 'idle') zIndex = 15 // Work activities on top

        return {
          ...block,
          left: Math.max(0, Math.min(100, left)),
          width,
          zIndex,
          originalIndex, // Preserve original order for stable sorting
        }
      })
      .filter((block): block is NonNullable<typeof block> => block !== null)

    // Issue 3.11: Sort by z-index (ascending) so higher z-index blocks render later (on top)
    // Use originalIndex as tiebreaker for stable sort
    return processedBlocks.sort((a, b) => {
      if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex
      return a.originalIndex - b.originalIndex
    })
  }, [
    timeline.activityBlocks,
    visibleStartMinutes,
    visibleEndMinutes,
    VISIBLE_MINUTES,
  ])

  // Calculate total event minutes from activity blocks
  const totalEventMinutes = useMemo(() => {
    return timeline.activityBlocks
      .filter((block) => block.type === 'event')
      .reduce((total, block) => total + (block.duration || 0), 0)
  }, [timeline.activityBlocks])

  // No activity - show empty state with shift markers if available
  // Issue 3.14: Empty state should still show scheduled shift markers
  if (timeline.activityBlocks.length === 0) {
    const hasShiftSchedule =
      timeline.scheduledShiftStart && timeline.scheduledShiftEnd

    return (
      <div className={cn('', className)}>
        <div className='relative'>
          <div
            className='bg-muted/20 text-muted-foreground border-muted-foreground/30 flex w-full items-center justify-center rounded-lg border border-dashed text-sm'
            style={{ height }}
          >
            No activity recorded for this day
          </div>
          {/* Show shift markers even when no activity */}
          {hasShiftSchedule && showShiftMarkers && (
            <>
              {shiftMarkers.map((marker, idx) => (
                <div
                  key={`empty-shift-${idx}`}
                  className='pointer-events-none absolute top-0 bottom-0 z-10'
                  style={{ left: `${marker.position}%` }}
                  aria-label={`${marker.type === 'start' ? 'Shift start' : 'Shift end'} at ${marker.label}`}
                >
                  <div
                    className={cn(
                      'absolute top-0 bottom-0 w-0.5',
                      marker.type === 'start' ? 'bg-green-500' : 'bg-red-500'
                    )}
                    aria-hidden='true'
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className={cn('space-y-2', className)}>
        {/* Toolbar with zoom controls and export button */}
        {(enableZoom || enableExport) && (
          <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
            {/* Zoom controls */}
            {enableZoom && (
              <div className='flex flex-wrap items-center gap-1'>
                {ZOOM_PRESETS.map((preset) => {
                  const isActive =
                    zoomRange.start === preset.start &&
                    zoomRange.end === preset.end
                  return (
                    <Tooltip key={preset.label}>
                      <TooltipTrigger asChild>
                        <Button
                          size='sm'
                          variant={isActive ? 'default' : 'outline'}
                          onClick={() =>
                            setZoomRange({
                              start: preset.start,
                              end: preset.end,
                            })
                          }
                          className='h-7 px-2 text-xs'
                        >
                          {preset.label}
                        </Button>
                      </TooltipTrigger>
                      {preset.tooltip && (
                        <TooltipContent side='bottom' className='text-xs'>
                          {preset.tooltip}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  )
                })}
              </div>
            )}

            {/* Export button */}
            {enableExport && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={handleExport}
                    disabled={isExporting}
                    className='h-7 px-2 text-xs'
                  >
                    <Download
                      className={cn(
                        'mr-1 h-4 w-4',
                        isExporting && 'animate-pulse'
                      )}
                    />
                    {isExporting ? 'Exporting...' : 'Export PNG'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' className='text-xs'>
                  Download timeline as PNG image
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {/* Timeline container */}
        <div
          ref={timelineRef}
          className='bg-background relative rounded-lg p-1'
        >
          {/* Hour markers header */}
          {showLabels && (
            <div className='relative mb-1 h-5' aria-hidden='true'>
              {hourMarkers.map((marker, idx) => {
                // Only show labels that fit within bounds
                if (marker.position < 0 || marker.position > 100) return null
                return (
                  <span
                    key={idx}
                    className='text-muted-foreground absolute -translate-x-1/2 transform text-[10px] font-medium'
                    style={{ left: `${marker.position}%` }}
                  >
                    {marker.label}
                  </span>
                )
              })}
            </div>
          )}

          {/* Gantt bar container */}
          <div
            role='img'
            aria-label={`Activity timeline for ${format(new Date(timeline.dayStart), 'MMMM d, yyyy')}`}
            className='from-muted/30 via-muted/20 to-muted/30 relative overflow-hidden rounded-lg bg-gradient-to-r'
            style={{ height }}
          >
            {/* Background gradient for time of day feel */}
            <div
              className='pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-900/5 via-transparent to-slate-900/5 dark:from-white/5 dark:via-transparent dark:to-white/5'
              aria-hidden='true'
            />

            {/* Hour grid lines */}
            {hourMarkers.map((marker, idx) => {
              if (marker.position <= 0 || marker.position >= 100) return null
              return (
                <div
                  key={`grid-${idx}`}
                  className='bg-border/40 absolute top-0 bottom-0 w-px'
                  style={{ left: `${marker.position}%` }}
                  aria-hidden='true'
                />
              )
            })}

            {/* Work day indicator - uses scheduled shift times if available, falls back to 6 AM - 6 PM */}
            {/* Issue 3.15: Now uses actual shift schedule instead of hardcoded hours */}
            {(() => {
              // Use scheduled shift times if available, otherwise default to typical work hours
              let workdayStart = 6 * 60 // Default 6 AM in minutes
              let workdayEnd = 18 * 60 // Default 6 PM in minutes

              if (timeline.scheduledShiftStart && timeline.scheduledShiftEnd) {
                workdayStart = timeStringToMinutes(timeline.scheduledShiftStart)
                workdayEnd = timeStringToMinutes(timeline.scheduledShiftEnd)

                // Handle overnight shifts (end time before start time)
                if (workdayEnd <= workdayStart) {
                  // For overnight shifts, highlight from shift start to midnight and midnight to shift end
                  const beforeMidnightStart = Math.max(
                    workdayStart,
                    visibleStartMinutes
                  )
                  const beforeMidnightEnd = Math.min(1440, visibleEndMinutes)
                  const afterMidnightStart = Math.max(0, visibleStartMinutes)
                  const afterMidnightEnd = Math.min(
                    workdayEnd,
                    visibleEndMinutes
                  )

                  const elements: React.ReactNode[] = []

                  // Before midnight portion
                  if (beforeMidnightEnd > beforeMidnightStart) {
                    const left1 =
                      ((beforeMidnightStart - visibleStartMinutes) /
                        VISIBLE_MINUTES) *
                      100
                    const width1 =
                      ((beforeMidnightEnd - beforeMidnightStart) /
                        VISIBLE_MINUTES) *
                      100
                    elements.push(
                      <div
                        key='workday-before-midnight'
                        className='bg-primary/5 dark:bg-primary/10 pointer-events-none absolute top-0 bottom-0'
                        style={{ left: `${left1}%`, width: `${width1}%` }}
                        aria-hidden='true'
                      />
                    )
                  }

                  // After midnight portion
                  if (afterMidnightEnd > afterMidnightStart) {
                    const left2 =
                      ((afterMidnightStart - visibleStartMinutes) /
                        VISIBLE_MINUTES) *
                      100
                    const width2 =
                      ((afterMidnightEnd - afterMidnightStart) /
                        VISIBLE_MINUTES) *
                      100
                    elements.push(
                      <div
                        key='workday-after-midnight'
                        className='bg-primary/5 dark:bg-primary/10 pointer-events-none absolute top-0 bottom-0'
                        style={{ left: `${left2}%`, width: `${width2}%` }}
                        aria-hidden='true'
                      />
                    )
                  }

                  return elements.length > 0 ? <>{elements}</> : null
                }
              }

              const clampedStart = Math.max(workdayStart, visibleStartMinutes)
              const clampedEnd = Math.min(workdayEnd, visibleEndMinutes)
              // Only show if workday overlaps with visible range
              if (clampedEnd > clampedStart) {
                const left =
                  ((clampedStart - visibleStartMinutes) / VISIBLE_MINUTES) * 100
                const width =
                  ((clampedEnd - clampedStart) / VISIBLE_MINUTES) * 100
                return (
                  <div
                    className='bg-primary/5 dark:bg-primary/10 pointer-events-none absolute top-0 bottom-0'
                    style={{ left: `${left}%`, width: `${width}%` }}
                    aria-hidden='true'
                  />
                )
              }
              return null
            })()}

            {/* Activity blocks - Issue 3.11: Now properly z-indexed via blockPositions sorting */}
            {/* Note: Breaks are now properly integrated into activityBlocks, split from idle time */}
            {/* Events appear as separate timeline blocks with custom colors */}
            <div role='list' className='absolute inset-0'>
              {blockPositions.map((block, idx) => {
                const isEvent = block.type === 'event'
                const isIdle = block.type === 'idle'
                const isBreak = block.type === 'break'

                // Get colors - dynamically from config or use special block colors
                // Priority: 1) Event custom color, 2) Block's displayColor, 3) Config lookup, 4) Fallback
                let colors: {
                  bg: string
                  bgHover: string
                  text: string
                  label: string
                }

                if (isEvent && block.eventColor) {
                  colors = {
                    bg: '',
                    bgHover: '',
                    text: 'text-white',
                    label: block.eventName || 'Event',
                  }
                } else if (SPECIAL_BLOCK_COLORS[block.type]) {
                  colors = SPECIAL_BLOCK_COLORS[block.type]
                } else if (block.displayColor) {
                  // Use display color directly from the block (comes from activity_source_config)
                  // Convert color name to Tailwind class (e.g., 'lime-500' -> 'bg-lime-500')
                  const bgClass = block.displayColor.startsWith('bg-')
                    ? block.displayColor
                    : `bg-${block.displayColor}`
                  const hoverClass = bgClass
                    .replace('bg-', 'hover:bg-')
                    .replace('-500', '-400')
                  colors = {
                    bg: bgClass,
                    bgHover: hoverClass,
                    text: 'text-white',
                    label:
                      block.activityLabel ||
                      block.type
                        .split('_')
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(' '),
                  }
                } else {
                  colors = getActivityColors(block.type)
                }

                // Build descriptive ARIA label for the activity block
                const activityLabel = isEvent
                  ? block.eventName || 'Event'
                  : block.activityLabel || colors.label
                const ariaLabel = `${activityLabel}: ${formatTime(block.startTime)} to ${formatTime(block.endTime)}, ${formatDuration(block.duration)}${block.taskCount > 0 ? `, ${block.taskCount} ${block.taskCount === 1 ? 'task' : 'tasks'}` : ''}`

                return (
                  <Tooltip key={idx}>
                    <TooltipTrigger asChild>
                      <motion.div
                        role='listitem'
                        aria-label={ariaLabel}
                        onClick={(e) => onBlockClick?.(block, e)}
                        className={cn(
                          'absolute top-1 bottom-1 rounded-md transition-all duration-150',
                          'shadow-sm hover:z-50 hover:shadow-md', // Hover brings to front
                          // Add cursor pointer only when click handler is provided
                          onBlockClick && 'cursor-pointer',
                          // Use custom color for events, otherwise use predefined
                          !isEvent && colors.bg,
                          !isEvent && colors.bgHover,
                          // Add border for break blocks to make them more visible
                          isBreak &&
                            'border border-yellow-500 dark:border-yellow-400',
                          // Add border for event blocks
                          isEvent && 'border-2 border-dashed',
                          // Add faint border for idle blocks to improve visibility
                          isIdle &&
                            'border border-gray-300/60 dark:border-gray-500/40'
                        )}
                        style={{
                          left: `${block.left}%`,
                          width: `${block.width}%`,
                          // Issue 3.11: Use dynamic z-index from block data
                          zIndex: block.zIndex,
                          // Custom background color for events
                          ...(isEvent &&
                            block.eventColor && {
                              backgroundColor: applyOpacity(
                                block.eventColor,
                                0.5
                              ),
                              borderColor: block.eventColor,
                            }),
                        }}
                        initial={{ opacity: 0, scaleY: 0.5 }}
                        animate={{ opacity: 1, scaleY: 1 }}
                        transition={{ duration: 0.3, delay: idx * 0.015 }}
                      >
                        {/* Activity label inside block if wide enough */}
                        {block.width > 6 && (
                          <span
                            className={cn(
                              'absolute inset-0 flex items-center justify-center truncate px-0.5 text-[9px] font-semibold',
                              isEvent ? 'text-foreground' : colors.text
                            )}
                          >
                            {isBreak
                              ? '☕'
                              : isEvent
                                ? '📅'
                                : block.taskCount > 0
                                  ? block.taskCount
                                  : ''}
                          </span>
                        )}
                      </motion.div>
                    </TooltipTrigger>
                    <TooltipContent
                      side='top'
                      className={cn(
                        'bg-popover text-popover-foreground max-w-xs border px-3 py-2 shadow-lg',
                        isBreak &&
                          'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950',
                        isEvent &&
                          'border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950'
                      )}
                    >
                      <div className='space-y-1'>
                        {/* Header row with activity type */}
                        <div className='flex items-center gap-2'>
                          {isBreak ? (
                            <span className='text-base'>☕</span>
                          ) : isEvent ? (
                            <span className='text-base'>📅</span>
                          ) : (
                            <div
                              className={cn(
                                'h-3 w-3 flex-shrink-0 rounded-sm',
                                colors.bg
                              )}
                            />
                          )}
                          <span
                            className={cn(
                              'text-foreground text-sm font-semibold',
                              isBreak &&
                                '!text-yellow-800 dark:!text-yellow-200',
                              isEvent &&
                                '!text-purple-800 dark:!text-purple-200'
                            )}
                          >
                            {isEvent
                              ? block.eventName || 'Event'
                              : block.activityLabel || colors.label}
                          </span>
                        </div>

                        {/* Event type for events */}
                        {isEvent && block.eventType && (
                          <div className='text-xs text-purple-600 capitalize dark:text-purple-400'>
                            {block.eventType.replace(/_/g, ' ')}
                          </div>
                        )}

                        {/* Time range */}
                        <div
                          className={cn(
                            'text-muted-foreground text-xs',
                            isBreak && '!text-yellow-700 dark:!text-yellow-300',
                            isEvent && '!text-purple-700 dark:!text-purple-300'
                          )}
                        >
                          {formatTime(block.startTime)} —{' '}
                          {formatTime(block.endTime)}
                        </div>

                        {/* Quantity for work activities */}
                        {!isBreak &&
                          !isIdle &&
                          !isEvent &&
                          block.taskCount > 0 && (
                            <div className='text-foreground text-xs font-medium'>
                              Quantity: {block.taskCount}
                            </div>
                          )}

                        {/* Duration */}
                        <div
                          className={cn(
                            'text-muted-foreground text-xs',
                            isBreak && '!text-yellow-600 dark:!text-yellow-400',
                            isEvent && '!text-purple-600 dark:!text-purple-400'
                          )}
                        >
                          Duration: {formatDuration(block.duration)}
                          {isBreak && ' • Scheduled Break'}
                          {isEvent && block.isPaidTime && ' • Paid Time'}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>

            {/* Scheduled Shift Markers */}
            {shiftMarkers.map((marker, idx) => (
              <Tooltip key={`shift-${idx}`}>
                <TooltipTrigger asChild>
                  <div
                    className='group absolute top-0 bottom-0 z-15 cursor-pointer'
                    style={{ left: `${marker.position}%` }}
                    aria-label={`${marker.type === 'start' ? 'Shift start' : 'Shift end'} at ${marker.label}`}
                  >
                    {/* Marker line */}
                    <div
                      className={cn(
                        'absolute top-0 bottom-0 w-0.5',
                        marker.type === 'start' ? 'bg-red-500' : 'bg-red-600'
                      )}
                      aria-hidden='true'
                    />
                    {/* Top triangle marker */}
                    <div
                      className={cn(
                        'absolute -top-1.5 left-1/2 h-0 w-0 -translate-x-1/2',
                        'border-l-[5px] border-l-transparent',
                        'border-r-[5px] border-r-transparent',
                        'border-t-[7px]',
                        marker.type === 'start'
                          ? 'border-t-red-500'
                          : 'border-t-red-600'
                      )}
                      aria-hidden='true'
                    />
                    {/* Bottom triangle marker */}
                    <div
                      className={cn(
                        'absolute -bottom-1.5 left-1/2 h-0 w-0 -translate-x-1/2',
                        'border-l-[5px] border-l-transparent',
                        'border-r-[5px] border-r-transparent',
                        'border-b-[7px]',
                        marker.type === 'start'
                          ? 'border-b-red-500'
                          : 'border-b-red-600'
                      )}
                      aria-hidden='true'
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side='top'
                  className='border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'
                >
                  <div className='flex items-center gap-2 text-xs'>
                    <span className='font-semibold text-red-700 dark:text-red-300'>
                      {marker.type === 'start' ? 'Shift Start' : 'Shift End'}
                    </span>
                    <span className='text-red-600 dark:text-red-400'>
                      {marker.label}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}

            {/* Overtime End Marker */}
            {overtimeMarkerData && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className='group absolute top-0 bottom-0 z-16 cursor-pointer'
                    style={{ left: `${overtimeMarkerData.position}%` }}
                    aria-label={`Overtime end at ${overtimeMarkerData.label}, ${formatDuration(overtimeMarkerData.overtimeMinutes)} overtime approved`}
                  >
                    {/* Marker line - orange/amber for overtime */}
                    {/* Uses motion-safe for accessibility - animation only shown when user hasn't requested reduced motion */}
                    <div
                      className='absolute top-0 bottom-0 w-1 bg-gradient-to-b from-orange-400 via-orange-500 to-orange-400 motion-safe:animate-pulse'
                      aria-hidden='true'
                    />
                    {/* Top marker - clock icon representation */}
                    <div
                      className='absolute -top-2 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border-2 border-orange-300 bg-orange-500'
                      aria-hidden='true'
                    >
                      <div className='h-1.5 w-1.5 rounded-full bg-white' />
                    </div>
                    {/* Bottom marker */}
                    <div
                      className='absolute -bottom-2 left-1/2 h-0 w-0 -translate-x-1/2 border-r-[6px] border-b-[8px] border-l-[6px] border-r-transparent border-b-orange-500 border-l-transparent'
                      aria-hidden='true'
                    />
                    {/* Overtime zone highlight */}
                    <div
                      className='pointer-events-none absolute top-0 bottom-0 -left-full bg-gradient-to-r from-transparent via-orange-500/10 to-orange-500/20'
                      style={{ width: '100%' }}
                      aria-hidden='true'
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side='top'
                  className='border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950'
                >
                  <div className='space-y-1'>
                    <div className='flex items-center gap-2 text-xs'>
                      <span className='font-semibold text-orange-700 dark:text-orange-300'>
                        ⏰ Overtime End
                      </span>
                      <span className='font-medium text-orange-600 dark:text-orange-400'>
                        {overtimeMarkerData.label}
                      </span>
                    </div>
                    <div className='text-xs text-orange-600 dark:text-orange-400'>
                      +{formatDuration(overtimeMarkerData.overtimeMinutes)}{' '}
                      overtime approved
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      Original end: {overtimeMarkerData.originalEnd}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Current time indicator (if today) - adjusted for visible range */}
            {timeline.dayEnd &&
              new Date().toDateString() ===
                new Date(timeline.dayStart).toDateString() &&
              (() => {
                const currentMinutes = getESTMinutesSinceMidnight(
                  new Date().toISOString()
                )
                const position =
                  ((currentMinutes - visibleStartMinutes) / VISIBLE_MINUTES) *
                  100
                // Only show if current time is within visible range
                if (position >= 0 && position <= 100) {
                  const currentTimeLabel = formatTime(new Date().toISOString())
                  return (
                    <div
                      className='absolute top-0 bottom-0 z-20 w-0.5 bg-emerald-500'
                      style={{ left: `${position}%` }}
                      aria-label={`Current time: ${currentTimeLabel}`}
                    >
                      <div
                        className='absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 animate-pulse rounded-full bg-emerald-500'
                        aria-hidden='true'
                      />
                    </div>
                  )
                }
                return null
              })()}
          </div>

          {/* Bottom hour ticks */}
          {showLabels && (
            <div className='relative mt-0.5 h-2' aria-hidden='true'>
              {hourMarkers.map((marker, idx) => {
                if (marker.position < 0 || marker.position > 100) return null
                return (
                  <div
                    key={`tick-${idx}`}
                    className='bg-border/60 absolute h-1.5 w-px'
                    style={{ left: `${marker.position}%` }}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* Summary footer - Shows Work, Break (Accounted), and Idle time */}
        {showSummary && (
          <div
            className={cn(
              'flex items-center justify-between px-1',
              compactSummary ? 'gap-2 text-[11px]' : 'text-sm'
            )}
          >
            <div
              className={cn(
                'flex items-center',
                compactSummary ? 'gap-2' : 'gap-4'
              )}
            >
              {timeline.firstActivity && (
                <span className='text-muted-foreground'>
                  <span className='text-foreground font-medium'>First:</span>{' '}
                  {formatTime(timeline.firstActivity)}
                </span>
              )}
              {timeline.lastActivity && (
                <span className='text-muted-foreground'>
                  <span className='text-foreground font-medium'>Last:</span>{' '}
                  {formatTime(timeline.lastActivity)}
                </span>
              )}
            </div>
            <div
              className={cn(
                'flex items-center',
                compactSummary ? 'gap-2' : 'gap-4'
              )}
            >
              <span className='text-muted-foreground'>
                <span className='font-medium text-emerald-600 dark:text-emerald-400'>
                  Work:
                </span>{' '}
                {formatDuration(timeline.totalWorkMinutes)}
              </span>
              {timeline.totalBreakMinutes > 0 && (
                <span className='text-muted-foreground'>
                  <span className='font-medium text-yellow-600 dark:text-yellow-400'>
                    Break:
                  </span>{' '}
                  {formatDuration(timeline.totalBreakMinutes)}
                </span>
              )}
              {totalEventMinutes > 0 && (
                <span className='text-muted-foreground'>
                  <span className='font-medium text-purple-600 dark:text-purple-400'>
                    Event:
                  </span>{' '}
                  {formatDuration(totalEventMinutes)}
                </span>
              )}
              <span className='text-muted-foreground'>
                <span className='font-medium text-gray-500'>Idle:</span>{' '}
                {formatDuration(timeline.totalIdleMinutes)}
              </span>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

// Compact version for inline display
interface ActivityGanttCompactProps {
  timeline: DailyTimeline
  className?: string
}

export function ActivityGanttCompact({
  timeline,
  className,
}: ActivityGanttCompactProps) {
  return (
    <ActivityGantt
      timeline={timeline}
      height={24}
      showLabels={false}
      showSummary={false}
      className={className}
    />
  )
}

// Activity Legend Component - Improved design with shift markers, breaks, events, and overtime
// Supports dynamic filtering based on timeline data to save space
// Updated: January 4, 2026 - Now uses dynamic activity config for colors and labels
export function ActivityLegend({
  className,
  showShiftMarker = true,
  showEvents = true,
  showOvertime = true,
  timeline,
  compact = false,
}: {
  className?: string
  showShiftMarker?: boolean
  showEvents?: boolean
  showOvertime?: boolean
  /** When provided, only show legend items for activities present in the timeline */
  timeline?: DailyTimeline
  /** Compact mode for mobile - smaller text and tighter spacing */
  compact?: boolean
}) {
  // Load dynamic activity configuration from database
  const {
    getActivityColors,
    getTimelineActivityTypes,
    activityConfigs: _activityConfigs,
  } = useActivityConfig()

  // Get all possible activity types from config (sorted by display_order)
  const allActivities = useMemo(() => {
    const types = getTimelineActivityTypes()
    // Always include 'idle' in legend
    if (!types.includes('idle')) {
      types.push('idle')
    }
    return types
  }, [getTimelineActivityTypes])

  // Calculate which activities are actually present in the timeline
  const presentActivities = useMemo(() => {
    if (!timeline) return allActivities // Show all if no timeline provided

    const presentTypes = new Set<string>()
    timeline.activityBlocks.forEach((block) => {
      if (block.type !== 'break' && block.type !== 'event') {
        presentTypes.add(block.type)
      }
    })

    return allActivities.filter((type) => presentTypes.has(type))
  }, [timeline, allActivities])

  // Check if breaks are present in timeline
  const hasBreaks = useMemo(() => {
    if (!timeline) return true // Show by default if no timeline
    return (
      timeline.activityBlocks.some((block) => block.type === 'break') ||
      timeline.totalBreakMinutes > 0
    )
  }, [timeline])

  // Check if events are present in timeline
  const hasEvents = useMemo(() => {
    if (!timeline) return true // Show by default if no timeline
    return timeline.activityBlocks.some((block) => block.type === 'event')
  }, [timeline])

  // Check if shift markers should be shown (only if shift times are defined)
  const hasShiftMarkers = useMemo(() => {
    if (!timeline) return true // Show by default if no timeline
    return !!(timeline.scheduledShiftStart || timeline.scheduledShiftEnd)
  }, [timeline])

  return (
    <div
      className={cn(
        'flex flex-wrap text-xs',
        compact ? 'gap-x-2 gap-y-1' : 'gap-x-4 gap-y-2',
        className
      )}
    >
      {presentActivities.map((type) => {
        // Get colors from dynamic config or fallbacks
        const colors = SPECIAL_BLOCK_COLORS[type] || getActivityColors(type)
        return (
          <div key={type} className='flex items-center gap-1'>
            <div
              className={cn(
                'rounded',
                compact ? 'h-2 w-2' : 'h-3 w-3',
                colors.bg
              )}
            />
            <span
              className={cn('text-muted-foreground', compact && 'text-[10px]')}
            >
              {colors.label}
            </span>
          </div>
        )
      })}
      {showShiftMarker && hasShiftMarkers && (
        <>
          <div className='flex items-center gap-1'>
            <div className='flex items-center'>
              <div
                className={cn(
                  'bg-red-500',
                  compact ? 'h-2 w-0.5' : 'h-3 w-0.5'
                )}
              />
              <div
                className={cn(
                  'h-0 w-0 border-t-red-500 border-r-transparent border-l-transparent',
                  compact
                    ? '-mt-2 -ml-[2px] border-t-[3px] border-r-[2px] border-l-[2px]'
                    : '-mt-3 -ml-[3px] border-t-[4px] border-r-[3px] border-l-[3px]'
                )}
              />
            </div>
            <span
              className={cn('text-muted-foreground', compact && 'text-[10px]')}
            >
              Shift Time
            </span>
          </div>
          {hasBreaks && (
            <div className='flex items-center gap-1'>
              <div
                className={cn(
                  'rounded border border-yellow-500/50 bg-yellow-400/50',
                  compact ? 'h-2 w-2' : 'h-3 w-3'
                )}
              />
              <span
                className={cn(
                  'text-muted-foreground',
                  compact && 'text-[10px]'
                )}
              >
                Break
              </span>
            </div>
          )}
        </>
      )}
      {showEvents && hasEvents && (
        <div className='flex items-center gap-1'>
          <div
            className={cn(
              'rounded border-2 border-dashed border-purple-500/50 bg-purple-400/50',
              compact ? 'h-2 w-2' : 'h-3 w-3'
            )}
          />
          <span
            className={cn('text-muted-foreground', compact && 'text-[10px]')}
          >
            Event
          </span>
        </div>
      )}
      {showOvertime && (
        <div className='flex items-center gap-1'>
          <div className='flex items-center'>
            <div
              className={cn(
                'rounded-sm bg-orange-500',
                compact ? 'h-2 w-0.5' : 'h-3 w-1'
              )}
            />
            <div
              className={cn(
                '-ml-1 rounded-full bg-orange-500',
                compact ? 'h-1.5 w-1.5' : 'h-2 w-2'
              )}
            />
          </div>
          <span
            className={cn('text-muted-foreground', compact && 'text-[10px]')}
          >
            Overtime End
          </span>
        </div>
      )}
    </div>
  )
}

export default ActivityGantt
