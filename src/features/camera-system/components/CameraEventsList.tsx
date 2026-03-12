/**
 * Camera Events List Component
 *
 * Displays list of camera events with:
 * - Event filtering by type
 * - Snapshot preview
 * - Acknowledge functionality
 */
import { useState, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  IconAlertTriangle,
  IconActivity,
  IconBan,
  IconWifi,
  IconWifiOff,
  IconCheck,
  IconChecks,
  IconPhoto,
  IconRefresh,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCameraEvents } from '../hooks/use-camera-events'
import type { CameraEvent, CameraEventType } from '../types/camera.types'

interface CameraEventsListProps {
  cameraId?: string
  className?: string
  maxHeight?: string
}

const EVENT_TYPE_CONFIG: Record<
  CameraEventType,
  { icon: typeof IconActivity; label: string; color: string }
> = {
  motion: { icon: IconActivity, label: 'Motion', color: 'text-blue-500' },
  alarm: { icon: IconAlertTriangle, label: 'Alarm', color: 'text-red-500' },
  line_crossing: {
    icon: IconBan,
    label: 'Line Crossing',
    color: 'text-orange-500',
  },
  intrusion: {
    icon: IconAlertTriangle,
    label: 'Intrusion',
    color: 'text-red-600',
  },
  loitering: {
    icon: IconActivity,
    label: 'Loitering',
    color: 'text-amber-500',
  },
  offline: { icon: IconWifiOff, label: 'Offline', color: 'text-gray-500' },
  online: { icon: IconWifi, label: 'Online', color: 'text-green-500' },
}

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-600 border-red-500/20',
}

export function CameraEventsList({
  cameraId,
  className,
  maxHeight = '400px',
}: CameraEventsListProps) {
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [previewEvent, setPreviewEvent] = useState<CameraEvent | null>(null)

  const {
    events,
    unacknowledgedCount,
    isLoading,
    refresh,
    acknowledgeEvent,
    acknowledgeAll,
  } = useCameraEvents({
    cameraId,
    eventTypes:
      typeFilter !== 'all' ? [typeFilter as CameraEventType] : undefined,
  })

  // Handle acknowledge
  const handleAcknowledge = useCallback(
    async (eventId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      await acknowledgeEvent(eventId)
    },
    [acknowledgeEvent]
  )

  // Handle acknowledge all
  const handleAcknowledgeAll = useCallback(async () => {
    await acknowledgeAll()
  }, [acknowledgeAll])

  // Open snapshot preview
  const handlePreview = useCallback((event: CameraEvent) => {
    if (event.snapshot_url) {
      setPreviewEvent(event)
    }
  }, [])

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className='flex items-center justify-between border-b p-3'>
        <div className='flex items-center gap-2'>
          <h3 className='text-sm font-semibold'>Events</h3>
          {unacknowledgedCount > 0 && (
            <Badge variant='destructive' className='text-xs'>
              {unacknowledgedCount}
            </Badge>
          )}
        </div>
        <div className='flex items-center gap-2'>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className='h-8 w-32 text-xs'>
              <SelectValue placeholder='All types' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Types</SelectItem>
              {Object.entries(EVENT_TYPE_CONFIG).map(([type, config]) => (
                <SelectItem key={type} value={type}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      </div>

      {/* Acknowledge All Button */}
      {unacknowledgedCount > 0 && (
        <div className='bg-muted/50 border-b p-2'>
          <Button
            variant='outline'
            size='sm'
            className='w-full text-xs'
            onClick={handleAcknowledgeAll}
          >
            <IconChecks className='mr-1.5 h-3.5 w-3.5' />
            Acknowledge All ({unacknowledgedCount})
          </Button>
        </div>
      )}

      {/* Events List */}
      <ScrollArea style={{ height: maxHeight }}>
        <div className='space-y-2 p-2'>
          {isLoading && events.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center text-sm'>
              Loading events...
            </div>
          ) : events.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center text-sm'>
              No events found
            </div>
          ) : (
            events.map((event) => {
              const config = EVENT_TYPE_CONFIG[event.event_type]
              const Icon = config.icon

              return (
                <div
                  key={event.id}
                  onClick={() => handlePreview(event)}
                  className={cn(
                    'bg-card rounded-lg border p-3 transition-colors',
                    !event.acknowledged && 'border-l-destructive border-l-4',
                    event.snapshot_url && 'hover:bg-accent cursor-pointer'
                  )}
                >
                  <div className='flex items-start gap-3'>
                    {/* Event Icon */}
                    <div className={cn('mt-0.5', config.color)}>
                      <Icon className='h-4 w-4' />
                    </div>

                    {/* Event Content */}
                    <div className='min-w-0 flex-1'>
                      <div className='mb-1 flex items-center gap-2'>
                        <span className='truncate text-sm font-medium'>
                          {event.camera_name}
                        </span>
                        <Badge
                          variant='outline'
                          className={cn(
                            'text-xs',
                            SEVERITY_COLORS[event.severity]
                          )}
                        >
                          {event.severity}
                        </Badge>
                      </div>
                      <p className='text-muted-foreground line-clamp-2 text-sm'>
                        {event.message}
                      </p>
                      <div className='mt-2 flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>
                          {formatDistanceToNow(new Date(event.timestamp), {
                            addSuffix: true,
                          })}
                        </span>
                        <div className='flex items-center gap-1'>
                          {event.snapshot_url && (
                            <IconPhoto className='text-muted-foreground h-3.5 w-3.5' />
                          )}
                          {!event.acknowledged && (
                            <Button
                              variant='ghost'
                              size='sm'
                              className='h-6 px-2 text-xs'
                              onClick={(e) => handleAcknowledge(event.id, e)}
                            >
                              <IconCheck className='mr-1 h-3 w-3' />
                              Ack
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>

      {/* Snapshot Preview Dialog */}
      <Dialog open={!!previewEvent} onOpenChange={() => setPreviewEvent(null)}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {previewEvent?.camera_name} - {previewEvent?.event_type}
            </DialogTitle>
          </DialogHeader>
          {previewEvent?.snapshot_url && (
            <img
              src={previewEvent.snapshot_url}
              alt='Event snapshot'
              className='h-auto w-full rounded-lg'
            />
          )}
          <div className='text-muted-foreground text-sm'>
            <p>{previewEvent?.message}</p>
            <p className='mt-1'>
              {previewEvent &&
                formatDistanceToNow(new Date(previewEvent.timestamp), {
                  addSuffix: true,
                })}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
