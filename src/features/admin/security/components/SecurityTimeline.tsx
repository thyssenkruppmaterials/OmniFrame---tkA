import { useState } from 'react'
import { format } from 'date-fns'
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconEye,
  IconUser,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSecurityEvents } from '../hooks/use-security-monitoring'
import type { SecurityFilters } from '../types'

interface SecurityTimelineProps {
  expanded?: boolean
}

export function SecurityTimeline({ expanded }: SecurityTimelineProps) {
  const [filters] = useState<SecurityFilters>({
    date_range: {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      end: new Date(),
    },
  })

  const { data: eventsData, isLoading } = useSecurityEvents(
    filters,
    expanded ? 50 : 10
  )

  // Ensure events is always an array
  const events = Array.isArray(eventsData) ? eventsData : []

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'login_anomaly':
        return <IconUser className='h-4 w-4 text-orange-500' />
      case 'permission_escalation':
        return <IconAlertTriangle className='h-4 w-4 text-red-500' />
      case 'data_access':
        return <IconEye className='h-4 w-4 text-blue-500' />
      case 'failed_login':
        return <IconUser className='h-4 w-4 text-red-500' />
      case 'suspicious_activity':
        return <IconAlertTriangle className='h-4 w-4 text-yellow-500' />
      default:
        return <IconClock className='h-4 w-4 text-gray-500' />
    }
  }

  const getSeverityColor = (severity: string) => {
    const colors = {
      low: 'bg-blue-100 text-blue-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800',
    }
    return colors[severity as keyof typeof colors] || colors.low
  }

  const formatEventType = (eventType: string) => {
    return eventType
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  if (isLoading) {
    return (
      <div className='space-y-4'>
        {Array.from({ length: expanded ? 10 : 5 }).map((_, i) => (
          <div key={i} className='flex items-start space-x-3'>
            <div className='mt-1 flex-shrink-0'>
              <Skeleton className='h-8 w-8 rounded-full' />
            </div>
            <div className='min-w-0 flex-1'>
              <Card>
                <CardContent className='p-3'>
                  <div className='mb-2 flex items-center space-x-2'>
                    <Skeleton className='h-4 w-32' />
                    <Skeleton className='h-5 w-12' />
                  </div>
                  <Skeleton className='mb-1 h-3 w-48' />
                  <Skeleton className='h-3 w-32' />
                </CardContent>
              </Card>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!events || events.length === 0) {
    return (
      <div className='py-8 text-center'>
        <IconCheck className='mx-auto mb-3 h-10 w-10 text-green-500' />
        <h3 className='mb-1 font-medium text-gray-900'>No Recent Activity</h3>
        <p className='text-sm text-gray-500'>
          No security events recorded in the selected time period.
        </p>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {events.map((event, index) => (
        <div key={event.id} className='flex items-start space-x-3'>
          <div className='mt-1 flex-shrink-0'>
            <div className='flex h-8 w-8 items-center justify-center rounded-full border-2 border-gray-200 bg-white'>
              {getEventIcon(event.event_type)}
            </div>
            {index < events.length - 1 && (
              <div className='absolute mt-8 ml-4 h-16 w-0.5 bg-gray-200' />
            )}
          </div>
          <div className='min-w-0 flex-1'>
            <Card className='relative'>
              <CardContent className='p-3'>
                <div className='mb-2 flex items-center space-x-2'>
                  <span className='text-sm font-medium'>
                    {formatEventType(event.event_type)}
                  </span>
                  <Badge className={getSeverityColor(event.severity)}>
                    {event.severity.toUpperCase()}
                  </Badge>
                  {event.status === 'resolved' && (
                    <IconCheck className='h-4 w-4 text-green-500' />
                  )}
                </div>

                <div className='mb-1 text-xs text-gray-600'>
                  {format(new Date(event.created_at), 'MMM dd, yyyy HH:mm:ss')}
                </div>

                {event.ip_address && (
                  <div className='mb-1 text-xs text-gray-500'>
                    IP: {event.ip_address}
                  </div>
                )}

                {event.user_agent && (
                  <div className='truncate text-xs text-gray-400'>
                    {event.user_agent}
                  </div>
                )}

                {event.metadata && Object.keys(event.metadata).length > 0 && (
                  <div className='mt-1 text-xs text-gray-400'>
                    Additional metadata available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ))}
    </div>
  )
}
