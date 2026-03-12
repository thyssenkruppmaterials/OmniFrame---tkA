/**
 * Live Operator Status Panel
 * Real-time display of active operators and their current status
 * Part of Phase 6: Work Management System Redesign
 */
import { formatDistanceToNow } from 'date-fns'
import {
  Clock,
  MapPin,
  RefreshCw,
  User,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkerStatusType } from '@/lib/work-service/types'
import { useActiveWorkers } from '@/hooks/use-active-workers'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function LiveOperatorStatus() {
  const {
    workers,
    isLoading,
    refreshWorkers,
    onlineCount,
    idleCount,
    busyCount,
    isWsConnected,
  } = useActiveWorkers()

  const getStatusColor = (status: WorkerStatusType): string => {
    switch (status) {
      case 'online':
      case 'idle':
        return 'bg-green-500'
      case 'busy':
        return 'bg-orange-500'
      case 'break':
        return 'bg-yellow-500'
      case 'offline':
        return 'bg-gray-400'
      default:
        return 'bg-gray-400'
    }
  }

  const getStatusBadge = (status: WorkerStatusType) => {
    switch (status) {
      case 'online':
        return (
          <Badge
            variant='default'
            className='bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
          >
            Online
          </Badge>
        )
      case 'idle':
        return <Badge variant='secondary'>Idle</Badge>
      case 'busy':
        return (
          <Badge
            variant='default'
            className='bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
          >
            Busy
          </Badge>
        )
      case 'break':
        return (
          <Badge
            variant='default'
            className='bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
          >
            Break
          </Badge>
        )
      default:
        return <Badge variant='outline'>Offline</Badge>
    }
  }

  // Sort workers: online/busy first, then idle, then break, then offline
  const sortedWorkers = [...workers].sort((a, b) => {
    const statusOrder: Record<WorkerStatusType, number> = {
      busy: 0,
      online: 1,
      idle: 2,
      break: 3,
      offline: 4,
    }
    return (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5)
  })

  // Only show active workers (not offline)
  const activeWorkers = sortedWorkers.filter((w) => w.status !== 'offline')

  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between pb-3'>
        <div className='flex items-center gap-3'>
          <CardTitle className='flex items-center gap-2 text-lg'>
            <Users className='h-5 w-5' />
            Active Operators
          </CardTitle>
          <div className='flex items-center gap-2'>
            <Badge variant='outline' className='text-xs'>
              {onlineCount + busyCount} online
            </Badge>
            {idleCount > 0 && (
              <Badge variant='secondary' className='text-xs'>
                {idleCount} idle
              </Badge>
            )}
          </div>
        </div>
        <div className='flex items-center gap-2'>
          {/* WebSocket connection status indicator */}
          <div className='text-muted-foreground flex items-center gap-1 text-xs'>
            {isWsConnected ? (
              <>
                <Wifi className='h-3 w-3 text-green-500' />
                <span>Live</span>
              </>
            ) : (
              <>
                <WifiOff className='h-3 w-3 text-orange-500' />
                <span>Polling</span>
              </>
            )}
          </div>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => refreshWorkers()}
            disabled={isLoading}
            className='h-8 w-8 p-0'
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            <span className='sr-only'>Refresh workers</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {activeWorkers.length === 0 ? (
          <div className='text-muted-foreground py-8 text-center'>
            <Users className='mx-auto mb-2 h-12 w-12 opacity-50' />
            <p className='font-medium'>No active operators</p>
            <p className='mt-1 text-sm'>
              Operators will appear when they sign in to RF Interface
            </p>
          </div>
        ) : (
          <div className='space-y-2'>
            {activeWorkers.map((worker) => (
              <div
                key={worker.user_id}
                className='bg-card hover:bg-accent/50 flex items-center justify-between rounded-lg border p-3 transition-colors'
              >
                <div className='flex items-center gap-3'>
                  <div
                    className={cn(
                      'ring-offset-background h-3 w-3 rounded-full ring-2 ring-offset-2',
                      getStatusColor(worker.status),
                      worker.status === 'busy' && 'animate-pulse'
                    )}
                  />
                  <div>
                    <div className='flex items-center gap-2'>
                      <User className='text-muted-foreground h-4 w-4' />
                      <span className='font-medium'>
                        {worker.full_name || 'Unknown'}
                      </span>
                      {getStatusBadge(worker.status)}
                    </div>
                    {worker.current_task_id && (
                      <div className='text-muted-foreground mt-1 flex items-center gap-1 text-sm'>
                        <MapPin className='h-3 w-3' />
                        <span>{worker.current_location || 'Working...'}</span>
                        {worker.current_task_type && (
                          <Badge variant='outline' className='ml-2 text-xs'>
                            {worker.current_task_type}
                          </Badge>
                        )}
                      </div>
                    )}
                    {!worker.current_task_id && worker.status === 'idle' && (
                      <div className='text-muted-foreground mt-1 text-sm'>
                        Waiting for assignment
                      </div>
                    )}
                  </div>
                </div>
                <div className='text-muted-foreground flex items-center gap-1 text-xs'>
                  <Clock className='h-3 w-3' />
                  {formatDistanceToNow(new Date(worker.last_heartbeat), {
                    addSuffix: true,
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary footer */}
        {activeWorkers.length > 0 && (
          <div className='text-muted-foreground mt-4 flex items-center justify-between border-t pt-3 text-xs'>
            <span>Total tracked: {workers.length} operators</span>
            <span>Active: {activeWorkers.length}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
