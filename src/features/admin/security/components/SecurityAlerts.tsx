// Created and developed by Jai Singh
import { useState } from 'react'
import { format } from 'date-fns'
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconEye,
  IconFilter,
  IconMapPin,
  IconSearch,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useSecurityEventActions } from '../hooks/use-security-monitoring'
import type { SecurityAlert } from '../types'

interface SecurityAlertsProps {
  alerts: SecurityAlert[]
  isLoading?: boolean
  showFilters?: boolean
}

export function SecurityAlerts({
  alerts,
  isLoading,
  showFilters,
}: SecurityAlertsProps) {
  const [filterSeverity, setFilterSeverity] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [resolveNotes, setResolveNotes] = useState('')

  const { updateEventStatus } = useSecurityEventActions()

  const getSeverityColor = (severity: string) => {
    const colors = {
      low: 'bg-blue-100 text-blue-800 border-blue-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      critical: 'bg-red-100 text-red-800 border-red-300',
    }
    return colors[severity as keyof typeof colors] || colors.low
  }

  const getStatusColor = (status: string) => {
    const colors = {
      active: 'bg-red-100 text-red-800',
      investigating: 'bg-orange-100 text-orange-800',
      resolved: 'bg-green-100 text-green-800',
      false_positive: 'bg-gray-100 text-gray-800',
    }
    return colors[status as keyof typeof colors] || colors.active
  }

  const getEventTypeIcon = (eventType: string) => {
    switch (eventType) {
      case 'login_anomaly':
        return <IconUser className='h-4 w-4' />
      case 'permission_escalation':
        return <IconAlertTriangle className='h-4 w-4' />
      case 'data_access':
        return <IconEye className='h-4 w-4' />
      case 'failed_login':
        return <IconX className='h-4 w-4' />
      case 'suspicious_activity':
        return <IconAlertTriangle className='h-4 w-4' />
      default:
        return <IconAlertTriangle className='h-4 w-4' />
    }
  }

  const formatEventType = (eventType: string) => {
    return eventType
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const handleStatusUpdate = async (
    alertId: string,
    newStatus: SecurityAlert['status']
  ) => {
    try {
      await updateEventStatus.mutateAsync({
        eventId: alertId,
        status: newStatus,
        notes: newStatus === 'resolved' ? resolveNotes : undefined,
      })
      setDialogOpen(false)
      setResolveNotes('')
    } catch (error) {
      logger.error('Failed to update alert status:', error)
    }
  }

  // Filter alerts based on current filters
  const filteredAlerts = alerts.filter((alert) => {
    const matchesSeverity = !filterSeverity || alert.severity === filterSeverity
    const matchesStatus = !filterStatus || alert.status === filterStatus
    const matchesSearch =
      !searchTerm ||
      alert.user?.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      alert.user?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      formatEventType(alert.event_type)
        .toLowerCase()
        .includes(searchTerm.toLowerCase())

    return matchesSeverity && matchesStatus && matchesSearch
  })

  if (isLoading) {
    return (
      <div className='space-y-4'>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className='p-4'>
              <div className='flex items-start justify-between space-x-4'>
                <div className='flex-1 space-y-2'>
                  <div className='flex items-center space-x-2'>
                    <Skeleton className='h-4 w-4' />
                    <Skeleton className='h-4 w-32' />
                    <Skeleton className='h-5 w-16' />
                  </div>
                  <Skeleton className='h-3 w-48' />
                  <Skeleton className='h-3 w-64' />
                </div>
                <Skeleton className='h-8 w-20' />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (filteredAlerts.length === 0) {
    return (
      <div className='py-8 text-center'>
        <IconCheck className='mx-auto mb-4 h-12 w-12 text-green-500' />
        <h3 className='mb-2 text-lg font-medium text-gray-900'>
          {alerts.length === 0 ? 'No Security Alerts' : 'No Matching Alerts'}
        </h3>
        <p className='text-gray-500'>
          {alerts.length === 0
            ? 'Everything looks secure! No active security alerts at this time.'
            : 'Try adjusting your filters to see more results.'}
        </p>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {showFilters && (
        <div className='flex flex-wrap gap-4 rounded-lg bg-gray-50 p-4'>
          <div className='min-w-64 flex-1'>
            <div className='relative'>
              <IconSearch className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-gray-400' />
              <Input
                placeholder='Search alerts by user, email, or event type...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='pl-10'
              />
            </div>
          </div>
          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className='w-40 max-w-full min-w-0'>
              <IconFilter className='mr-2 h-4 w-4' />
              <SelectValue placeholder='Severity' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=''>All Severities</SelectItem>
              <SelectItem value='critical'>Critical</SelectItem>
              <SelectItem value='high'>High</SelectItem>
              <SelectItem value='medium'>Medium</SelectItem>
              <SelectItem value='low'>Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className='w-40 max-w-full min-w-0'>
              <IconFilter className='mr-2 h-4 w-4' />
              <SelectValue placeholder='Status' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=''>All Statuses</SelectItem>
              <SelectItem value='active'>Active</SelectItem>
              <SelectItem value='investigating'>Investigating</SelectItem>
              <SelectItem value='resolved'>Resolved</SelectItem>
              <SelectItem value='false_positive'>False Positive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {filteredAlerts.map((alert) => (
        <Card
          key={alert.id}
          className={alert.is_new ? 'border-orange-200 bg-orange-50' : ''}
        >
          <CardContent className='p-4'>
            <div className='flex items-start justify-between space-x-4'>
              <div className='flex-1 space-y-2'>
                <div className='flex items-center space-x-2'>
                  {getEventTypeIcon(alert.event_type)}
                  <span className='font-medium'>
                    {formatEventType(alert.event_type)}
                  </span>
                  <Badge className={getSeverityColor(alert.severity)}>
                    {alert.severity.toUpperCase()}
                  </Badge>
                  <Badge
                    variant='outline'
                    className={getStatusColor(alert.status)}
                  >
                    {alert.status.replace('_', ' ').toUpperCase()}
                  </Badge>
                  {alert.is_new && <Badge variant='secondary'>NEW</Badge>}
                </div>

                {alert.user && (
                  <div className='flex items-center space-x-4 text-sm text-gray-600'>
                    <span className='flex items-center'>
                      <IconUser className='mr-1 h-3 w-3' />
                      {alert.user.full_name} ({alert.user.email})
                    </span>
                  </div>
                )}

                <div className='flex items-center space-x-4 text-sm text-gray-500'>
                  <span className='flex items-center'>
                    <IconClock className='mr-1 h-3 w-3' />
                    {format(new Date(alert.created_at), 'MMM dd, yyyy HH:mm')}
                  </span>
                  {alert.ip_address && (
                    <span className='flex items-center'>
                      <IconMapPin className='mr-1 h-3 w-3' />
                      {alert.ip_address}
                    </span>
                  )}
                  {typeof alert.location?.country === 'string' && (
                    <span>{alert.location.country}</span>
                  )}
                </div>

                {alert.metadata && Object.keys(alert.metadata).length > 0 && (
                  <div className='text-xs text-gray-500'>
                    Additional data available
                  </div>
                )}
              </div>

              <div className='flex space-x-2'>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant='outline' size='sm'>
                      Actions
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Manage Security Alert</DialogTitle>
                      <DialogDescription>
                        Update the status of this security alert
                      </DialogDescription>
                    </DialogHeader>

                    <div className='space-y-4'>
                      <div>
                        <h4 className='mb-2 font-medium'>Alert Details</h4>
                        <div className='space-y-1 text-sm'>
                          <div>Type: {formatEventType(alert.event_type)}</div>
                          <div>Severity: {alert.severity.toUpperCase()}</div>
                          <div>
                            Current Status:{' '}
                            {alert.status.replace('_', ' ').toUpperCase()}
                          </div>
                          <div>
                            Created:{' '}
                            {format(new Date(alert.created_at), 'PPP pp')}
                          </div>
                        </div>
                      </div>

                      {alert.status !== 'resolved' && (
                        <div>
                          <label className='text-sm font-medium'>
                            Resolution Notes
                          </label>
                          <Textarea
                            placeholder='Add notes about the resolution...'
                            value={resolveNotes}
                            onChange={(e) => setResolveNotes(e.target.value)}
                            className='mt-1'
                          />
                        </div>
                      )}
                    </div>

                    <DialogFooter className='space-x-2'>
                      {alert.status === 'active' && (
                        <>
                          <Button
                            variant='outline'
                            onClick={() =>
                              handleStatusUpdate(alert.id, 'investigating')
                            }
                            disabled={updateEventStatus.isPending}
                          >
                            Mark Investigating
                          </Button>
                          <Button
                            variant='outline'
                            onClick={() =>
                              handleStatusUpdate(alert.id, 'false_positive')
                            }
                            disabled={updateEventStatus.isPending}
                          >
                            False Positive
                          </Button>
                          <Button
                            onClick={() =>
                              handleStatusUpdate(alert.id, 'resolved')
                            }
                            disabled={updateEventStatus.isPending}
                          >
                            Resolve
                          </Button>
                        </>
                      )}
                      {alert.status === 'investigating' && (
                        <>
                          <Button
                            variant='outline'
                            onClick={() =>
                              handleStatusUpdate(alert.id, 'false_positive')
                            }
                            disabled={updateEventStatus.isPending}
                          >
                            False Positive
                          </Button>
                          <Button
                            onClick={() =>
                              handleStatusUpdate(alert.id, 'resolved')
                            }
                            disabled={updateEventStatus.isPending}
                          >
                            Resolve
                          </Button>
                        </>
                      )}
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// Created and developed by Jai Singh
