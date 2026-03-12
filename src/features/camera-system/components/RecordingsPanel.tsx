/**
 * Recordings Panel Component
 *
 * Displays camera recordings with:
 * - Date/time range picker
 * - Recording list with thumbnails
 * - Playback and download controls
 */
import { useState, useCallback, useMemo } from 'react'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import {
  IconCalendar,
  IconDownload,
  IconPlayerPlay,
  IconClock,
  IconFile,
  IconRefresh,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { useCameraRecordings } from '../hooks/use-camera-recordings'
import type { CameraRecording, RecordingFilter } from '../types/camera.types'

interface RecordingsPanelProps {
  cameraId?: string
  className?: string
  maxHeight?: string
}

// Format duration in HH:MM:SS
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m ${secs}s`
}

// Format file size
function formatFileSize(mb: number): string {
  if (mb >= 1000) {
    return `${(mb / 1000).toFixed(1)} GB`
  }
  return `${mb.toFixed(0)} MB`
}

export function RecordingsPanel({
  cameraId,
  className,
  maxHeight = '400px',
}: RecordingsPanelProps) {
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 7),
    to: new Date(),
  })
  const [eventTriggeredOnly, setEventTriggeredOnly] = useState(false)
  const [playbackRecording, setPlaybackRecording] =
    useState<CameraRecording | null>(null)

  const filter: RecordingFilter = useMemo(
    () => ({
      camera_id: cameraId,
      start_date: startOfDay(dateRange.from).toISOString(),
      end_date: endOfDay(dateRange.to).toISOString(),
      event_triggered: eventTriggeredOnly ? true : undefined,
    }),
    [cameraId, dateRange, eventTriggeredOnly]
  )

  const {
    recordings,
    totalDurationSeconds,
    totalSizeMb,
    isLoading,
    refresh,
    downloadRecording,
    getPlaybackUrl,
  } = useCameraRecordings({ cameraId, filter })

  // Handle date selection
  const handleDateSelect = useCallback(
    (range: { from?: Date; to?: Date } | undefined) => {
      if (range?.from && range?.to) {
        setDateRange({ from: range.from, to: range.to })
      } else if (range?.from) {
        setDateRange({ from: range.from, to: range.from })
      }
    },
    []
  )

  // Handle playback
  const handlePlayback = useCallback((recording: CameraRecording) => {
    setPlaybackRecording(recording)
  }, [])

  // Handle download
  const handleDownload = useCallback(
    (recordingId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      downloadRecording(recordingId)
    },
    [downloadRecording]
  )

  // Group recordings by date
  const groupedRecordings = useMemo(() => {
    const groups: Record<string, CameraRecording[]> = {}

    recordings.forEach((recording) => {
      const date = format(new Date(recording.start_time), 'yyyy-MM-dd')
      if (!groups[date]) {
        groups[date] = []
      }
      groups[date].push(recording)
    })

    return groups
  }, [recordings])

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className='space-y-3 border-b p-3'>
        <div className='flex items-center justify-between'>
          <h3 className='text-sm font-semibold'>Recordings</h3>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            onClick={refresh}
            disabled={isLoading}
          >
            <IconRefresh
              className={cn('h-4 w-4', isLoading && 'animate-spin')}
            />
          </Button>
        </div>

        {/* Date Range Picker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              className='w-full justify-start text-left font-normal'
            >
              <IconCalendar className='mr-2 h-4 w-4' />
              {format(dateRange.from, 'MMM d, yyyy')} -{' '}
              {format(dateRange.to, 'MMM d, yyyy')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className='w-auto p-0' align='start'>
            <Calendar
              mode='range'
              selected={{ from: dateRange.from, to: dateRange.to }}
              onSelect={handleDateSelect}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
            />
          </PopoverContent>
        </Popover>

        {/* Filters */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center space-x-2'>
            <Switch
              id='event-triggered'
              checked={eventTriggeredOnly}
              onCheckedChange={setEventTriggeredOnly}
            />
            <Label htmlFor='event-triggered' className='text-sm'>
              Event-triggered only
            </Label>
          </div>
        </div>

        {/* Stats */}
        <div className='text-muted-foreground flex items-center gap-4 text-xs'>
          <div className='flex items-center gap-1'>
            <IconClock className='h-3.5 w-3.5' />
            <span>{formatDuration(totalDurationSeconds)}</span>
          </div>
          <div className='flex items-center gap-1'>
            <IconFile className='h-3.5 w-3.5' />
            <span>{formatFileSize(totalSizeMb)}</span>
          </div>
          <span>{recordings.length} recordings</span>
        </div>
      </div>

      {/* Recordings List */}
      <ScrollArea style={{ height: maxHeight }}>
        <div className='space-y-4 p-2'>
          {isLoading && recordings.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center text-sm'>
              Loading recordings...
            </div>
          ) : recordings.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center text-sm'>
              No recordings found
            </div>
          ) : (
            Object.entries(groupedRecordings).map(([date, dayRecordings]) => (
              <div key={date}>
                {/* Date Header */}
                <h4 className='text-muted-foreground bg-background sticky top-0 mb-2 py-1 text-xs font-medium'>
                  {format(new Date(date), 'EEEE, MMM d, yyyy')}
                </h4>

                {/* Day's Recordings */}
                <div className='space-y-2'>
                  {dayRecordings.map((recording) => (
                    <div
                      key={recording.id}
                      onClick={() => handlePlayback(recording)}
                      className={cn(
                        'bg-card flex items-center gap-3 rounded-lg border p-2',
                        'hover:bg-accent cursor-pointer transition-colors',
                        recording.event_triggered &&
                          'border-l-4 border-l-amber-500'
                      )}
                    >
                      {/* Thumbnail */}
                      <div className='bg-muted relative h-12 w-20 flex-shrink-0 overflow-hidden rounded'>
                        {recording.thumbnail_url ? (
                          <img
                            src={recording.thumbnail_url}
                            alt='Recording thumbnail'
                            className='h-full w-full object-cover'
                          />
                        ) : (
                          <div className='flex h-full w-full items-center justify-center'>
                            <IconPlayerPlay className='text-muted-foreground h-6 w-6' />
                          </div>
                        )}
                        {recording.event_triggered && (
                          <div className='absolute top-1 right-1'>
                            <IconAlertTriangle className='h-3 w-3 text-amber-500' />
                          </div>
                        )}
                      </div>

                      {/* Recording Info */}
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            {format(new Date(recording.start_time), 'HH:mm')}
                          </span>
                          <span className='text-muted-foreground'>-</span>
                          <span className='text-sm font-medium'>
                            {format(new Date(recording.end_time), 'HH:mm')}
                          </span>
                        </div>
                        <div className='text-muted-foreground mt-0.5 flex items-center gap-3 text-xs'>
                          <span>
                            {formatDuration(recording.duration_seconds)}
                          </span>
                          <span>{formatFileSize(recording.file_size_mb)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className='flex items-center gap-1'>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8'
                          onClick={(e) => handleDownload(recording.id, e)}
                          title='Download'
                        >
                          <IconDownload className='h-4 w-4' />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Playback Dialog */}
      <Dialog
        open={!!playbackRecording}
        onOpenChange={() => setPlaybackRecording(null)}
      >
        <DialogContent className='max-w-4xl'>
          <DialogHeader>
            <DialogTitle>
              {playbackRecording?.camera_name} -{' '}
              {playbackRecording &&
                format(
                  new Date(playbackRecording.start_time),
                  'MMM d, yyyy HH:mm'
                )}
            </DialogTitle>
          </DialogHeader>
          <div className='aspect-video overflow-hidden rounded-lg bg-black'>
            {playbackRecording && (
              <video
                src={getPlaybackUrl(playbackRecording.id)}
                controls
                autoPlay
                className='h-full w-full'
              />
            )}
          </div>
          <div className='flex items-center justify-between'>
            <div className='text-muted-foreground text-sm'>
              Duration:{' '}
              {playbackRecording &&
                formatDuration(playbackRecording.duration_seconds)}
            </div>
            <Button
              variant='outline'
              onClick={() =>
                playbackRecording && downloadRecording(playbackRecording.id)
              }
            >
              <IconDownload className='mr-2 h-4 w-4' />
              Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
