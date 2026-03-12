import { useState, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  IconLogin,
  IconLogout,
  IconClock,
  IconShield,
  IconSearch,
  IconCalendar,
  IconRefresh,
  IconDownload,
  IconActivity,
  IconUser,
} from '@tabler/icons-react'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SessionManagementService } from '../services/session-management.service'
import type { SessionActivity } from '../types'

export function SessionHistory() {
  const [searchTerm, setSearchTerm] = useState('')
  const [eventFilter, setEventFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState('7d')
  const [sessionHistory, setSessionHistory] = useState<SessionActivity[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 25

  // Load session history on component mount and when filters change
  useEffect(() => {
    loadSessionHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadSessionHistory reads timeFilter; adding would cause unnecessary re-fetches
  }, [timeFilter])

  const loadSessionHistory = async () => {
    setIsLoading(true)
    try {
      const history = await SessionManagementService.getSessionHistory()

      // Filter by time range
      const timeFilteredHistory = filterHistoryByTime(history, timeFilter)
      setSessionHistory(timeFilteredHistory)
    } catch (error) {
      logger.error('Error loading session history:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const filterHistoryByTime = (
    history: SessionActivity[],
    range: string
  ): SessionActivity[] => {
    const now = new Date()
    let cutoffDate: Date

    switch (range) {
      case '1d':
        cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        break
      case '7d':
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '30d':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      default:
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    }

    return history.filter((item) => new Date(item.timestamp) >= cutoffDate)
  }

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'login':
        return <IconLogin className='h-4 w-4 text-green-500' />
      case 'logout':
        return <IconLogout className='h-4 w-4 text-blue-500' />
      case 'timeout':
        return <IconClock className='h-4 w-4 text-orange-500' />
      case 'forced_logout':
        return <IconShield className='h-4 w-4 text-red-500' />
      case 'refresh':
        return <IconRefresh className='h-4 w-4 text-purple-500' />
      case 'password_change':
        return <IconShield className='h-4 w-4 text-blue-600' />
      case 'role_change':
        return <IconUser className='h-4 w-4 text-indigo-500' />
      case 'permission_check':
        return <IconActivity className='h-4 w-4 text-gray-500' />
      default:
        return <IconActivity className='h-4 w-4 text-gray-500' />
    }
  }

  const getEventBadgeVariant = (eventType: string) => {
    switch (eventType) {
      case 'login':
        return 'default' as const
      case 'logout':
        return 'secondary' as const
      case 'timeout':
        return 'outline' as const
      case 'forced_logout':
        return 'destructive' as const
      case 'refresh':
        return 'secondary' as const
      case 'password_change':
      case 'role_change':
        return 'default' as const
      default:
        return 'outline' as const
    }
  }

  const getEventDisplayName = (eventType: string): string => {
    switch (eventType) {
      case 'login':
        return 'Login'
      case 'logout':
        return 'Logout'
      case 'timeout':
        return 'Timeout'
      case 'forced_logout':
        return 'Force Logout'
      case 'refresh':
        return 'Token Refresh'
      case 'password_change':
        return 'Password Change'
      case 'role_change':
        return 'Role Change'
      case 'permission_check':
        return 'Permission Check'
      default:
        return eventType
          .replace('_', ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase())
    }
  }

  const handleRefresh = async () => {
    await loadSessionHistory()
  }

  const handleExport = async () => {
    try {
      // Export filtered history as CSV
      const csvData = [
        'Timestamp,User Name,User Email,Event Type,IP Address,User Agent,Duration,Details',
        ...filteredHistory.map(
          (item) =>
            `"${item.timestamp}","${item.user_name || ''}","${item.user_email || ''}","${item.event_type}","${item.ip_address || ''}","${item.user_agent || ''}","${item.session_duration || ''}","${item.details || ''}"`
        ),
      ].join('\n')

      const blob = new Blob([csvData], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `session-history-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Error exporting session history:', error)
    }
  }

  const filteredHistory = sessionHistory.filter((item) => {
    const matchesSearch =
      !searchTerm ||
      (item.user_name &&
        item.user_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.user_email &&
        item.user_email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.event_type &&
        item.event_type.toLowerCase().includes(searchTerm.toLowerCase()))

    const matchesEvent =
      eventFilter === 'all' || item.event_type === eventFilter

    return matchesSearch && matchesEvent
  })

  // Pagination
  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedHistory = filteredHistory.slice(
    startIndex,
    startIndex + itemsPerPage
  )

  return (
    <div className='space-y-6'>
      {/* Header and Controls */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-4'>
          <h3 className='text-lg font-semibold'>Session History</h3>
          <Badge variant='outline'>{filteredHistory.length} events</Badge>
        </div>
        <div className='flex items-center space-x-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <IconRefresh className='mr-2 h-4 w-4' />
            {isLoading ? 'Loading...' : 'Refresh'}
          </Button>
          <Button variant='outline' size='sm' onClick={handleExport}>
            <IconDownload className='mr-2 h-4 w-4' />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className='flex items-center space-x-4'>
        <div className='flex-1'>
          <div className='relative'>
            <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
            <Input
              placeholder='Search users, emails, or event types...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='pl-10'
            />
          </div>
        </div>
        <Select value={eventFilter} onValueChange={setEventFilter}>
          <SelectTrigger className='w-48'>
            <SelectValue placeholder='Event type' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Events</SelectItem>
            <SelectItem value='login'>Login</SelectItem>
            <SelectItem value='logout'>Logout</SelectItem>
            <SelectItem value='timeout'>Timeout</SelectItem>
            <SelectItem value='forced_logout'>Forced Logout</SelectItem>
            <SelectItem value='refresh'>Token Refresh</SelectItem>
            <SelectItem value='password_change'>Password Change</SelectItem>
            <SelectItem value='role_change'>Role Change</SelectItem>
          </SelectContent>
        </Select>
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className='w-32'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='1d'>Last 24h</SelectItem>
            <SelectItem value='7d'>Last 7 days</SelectItem>
            <SelectItem value='30d'>Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Session History List */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center justify-between'>
            <div className='flex items-center space-x-2'>
              <IconCalendar className='h-5 w-5' />
              <span>Recent Session Activity</span>
            </div>
            {totalPages > 1 && (
              <div className='text-muted-foreground text-sm'>
                Page {currentPage} of {totalPages}
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className='flex items-center justify-center p-8'>
              <div className='text-center'>
                <IconRefresh className='text-muted-foreground mx-auto mb-2 h-8 w-8 animate-spin' />
                <p className='text-muted-foreground'>
                  Loading session history...
                </p>
              </div>
            </div>
          ) : paginatedHistory.length === 0 ? (
            <div className='flex items-center justify-center p-8'>
              <div className='text-center'>
                <IconActivity className='text-muted-foreground mx-auto mb-2 h-8 w-8' />
                <p className='text-muted-foreground'>
                  No session activity found
                </p>
                <p className='text-muted-foreground text-sm'>
                  Try adjusting your filters
                </p>
              </div>
            </div>
          ) : (
            <div className='space-y-2'>
              {paginatedHistory.map((item) => (
                <div
                  key={item.id}
                  className='hover:bg-muted/50 flex items-center justify-between rounded-lg border p-4 transition-colors'
                >
                  <div className='flex items-center space-x-4'>
                    <div className='flex-shrink-0'>
                      {getEventIcon(item.event_type)}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center space-x-2'>
                        <div className='truncate font-medium'>
                          {item.user_name || 'Unknown User'}
                        </div>
                        <Badge
                          variant={getEventBadgeVariant(item.event_type)}
                          className='text-xs'
                        >
                          {getEventDisplayName(item.event_type)}
                        </Badge>
                      </div>
                      <div className='text-muted-foreground text-sm'>
                        {item.user_email || 'No email'}
                      </div>
                      {item.details && (
                        <div className='text-muted-foreground mt-1 text-xs'>
                          {item.details}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className='flex-shrink-0 text-right'>
                    <div className='text-sm font-medium'>
                      {formatDistanceToNow(new Date(item.timestamp), {
                        addSuffix: true,
                      })}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {item.ip_address && <>IP: {item.ip_address}</>}
                    </div>
                    {item.user_agent && (
                      <div className='text-muted-foreground max-w-32 truncate text-xs'>
                        {item.user_agent}
                      </div>
                    )}
                    {item.session_duration && (
                      <div className='text-muted-foreground text-xs'>
                        Duration: {item.session_duration}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className='mt-6 flex items-center justify-center space-x-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <div className='text-muted-foreground text-sm'>
                {currentPage} of {totalPages}
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
