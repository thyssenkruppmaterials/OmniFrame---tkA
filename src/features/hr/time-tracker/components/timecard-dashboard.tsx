// Created and developed by Jai Singh
/**
 * Timecard Dashboard Component
 * Real-time metrics and attendance data from Supabase.
 */
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import {
  IconClock,
  IconClockCheck,
  IconAlertTriangle,
  IconHourglass,
  IconUser,
  IconCalendar,
  IconRefresh,
  IconLoader2,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  fetchDashboardMetrics,
  fetchClockEntries,
  type ClockEntryRow,
  type DashboardMetrics,
} from '../services/time-tracker.service'

// ── Helpers ────────────────────────────────────────────────────────────────

function getEntryStatusBadge(entry: ClockEntryRow) {
  if (entry.status === 'active' && !entry.clock_out) {
    return (
      <Badge className='border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400'>
        <span className='mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500' />
        Active
      </Badge>
    )
  }
  if (entry.status === 'completed') {
    return (
      <Badge className='border-green-200 bg-green-100 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400'>
        Completed
      </Badge>
    )
  }
  if (entry.status === 'missed_punch') {
    return (
      <Badge className='border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400'>
        Missed Punch
      </Badge>
    )
  }
  if (entry.status === 'void') {
    return (
      <Badge className='border-red-200 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'>
        Void
      </Badge>
    )
  }
  return <Badge variant='outline'>{entry.status}</Badge>
}

function calcHours(clockIn: string, clockOut: string | null): string {
  if (!clockOut) return '—'
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime()
  const hrs = diff / (1000 * 60 * 60)
  return `${hrs.toFixed(2)} hrs`
}

// ── Component ──────────────────────────────────────────────────────────────

function TimecardDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [entries, setEntries] = useState<ClockEntryRow[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    setLoading(true)
    try {
      const [m, e] = await Promise.all([
        fetchDashboardMetrics(),
        fetchClockEntries(),
      ])
      setMetrics(m)
      setEntries(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const metricCards = [
    {
      id: 'total-hours',
      label: 'Total Hours Tracked',
      value: metrics ? metrics.totalHours.toFixed(1) : '—',
      icon: IconClock,
      iconColor: 'text-blue-600',
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    },
    {
      id: 'pending-approvals',
      label: 'Pending Approvals',
      value: metrics ? String(metrics.pendingApprovals) : '—',
      icon: IconClockCheck,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-100 dark:bg-amber-900/30',
    },
    {
      id: 'active-clock-ins',
      label: 'Active Clock-Ins',
      value: metrics ? String(metrics.activeClockIns) : '—',
      icon: IconAlertTriangle,
      iconColor: 'text-green-600',
      iconBg: 'bg-green-100 dark:bg-green-900/30',
    },
    {
      id: 'total-entries',
      label: 'Total Entries',
      value: metrics ? String(metrics.totalEntries) : '—',
      icon: IconHourglass,
      iconColor: 'text-purple-600',
      iconBg: 'bg-purple-100 dark:bg-purple-900/30',
    },
  ]

  const activeEntries = entries.filter((e) => e.status === 'active')
  const completedEntries = entries.filter((e) => e.status === 'completed')

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <IconCalendar className='h-4 w-4' />
          <span>As of {format(new Date(), 'MMMM d, yyyy h:mm a')}</span>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={loadData}
          disabled={loading}
          className='gap-2'
        >
          {loading ? (
            <IconLoader2 className='h-4 w-4 animate-spin' />
          ) : (
            <IconRefresh className='h-4 w-4' />
          )}
          Refresh
        </Button>
      </div>

      {/* Metric Cards Grid */}
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {metricCards.map((metric) => {
          const Icon = metric.icon
          return (
            <Card key={metric.id}>
              <CardContent className='pt-0'>
                <div className='flex items-start justify-between'>
                  <div className='space-y-2'>
                    <p className='text-muted-foreground text-sm font-medium'>
                      {metric.label}
                    </p>
                    <p className='text-3xl font-bold tracking-tight'>
                      {loading ? (
                        <span className='bg-muted inline-block h-8 w-16 animate-pulse rounded' />
                      ) : (
                        metric.value
                      )}
                    </p>
                  </div>
                  <div className={`rounded-lg p-2.5 ${metric.iconBg}`}>
                    <Icon className={`h-5 w-5 ${metric.iconColor}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Attendance Overview */}
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='text-lg'>Recent Clock Entries</CardTitle>
              <CardDescription>
                All clock-in/out activity from the time clock system
              </CardDescription>
            </div>
            <div className='flex items-center gap-4 text-sm'>
              <div className='flex items-center gap-1.5'>
                <span className='inline-block h-2.5 w-2.5 rounded-full bg-blue-500' />
                <span className='text-muted-foreground'>
                  Active ({activeEntries.length})
                </span>
              </div>
              <div className='flex items-center gap-1.5'>
                <span className='inline-block h-2.5 w-2.5 rounded-full bg-green-500' />
                <span className='text-muted-foreground'>
                  Completed ({completedEntries.length})
                </span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className='space-y-3'>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className='bg-muted h-12 w-full animate-pulse rounded'
                />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-12 text-center'>
              <IconClock className='text-muted-foreground/30 mb-3 h-12 w-12' />
              <p className='text-muted-foreground font-medium'>
                No clock entries yet
              </p>
              <p className='text-muted-foreground/60 mt-1 text-sm'>
                Entries will appear here when employees clock in via the time
                clock kiosk.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Badge #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className='font-medium'>
                      <div className='flex items-center gap-2'>
                        <div className='bg-muted flex h-8 w-8 items-center justify-center rounded-full'>
                          <IconUser className='text-muted-foreground h-4 w-4' />
                        </div>
                        {entry.employee_name || 'Unknown'}
                      </div>
                    </TableCell>
                    <TableCell className='text-muted-foreground font-mono text-xs'>
                      {entry.badge_number || '—'}
                    </TableCell>
                    <TableCell>
                      {format(new Date(entry.clock_in), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      {format(new Date(entry.clock_in), 'h:mm:ss a')}
                    </TableCell>
                    <TableCell>
                      {entry.clock_out
                        ? format(new Date(entry.clock_out), 'h:mm:ss a')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {calcHours(entry.clock_in, entry.clock_out)}
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline' className='text-xs capitalize'>
                        {entry.clock_in_method.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>{getEntryStatusBadge(entry)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {entries.length > 0 && (
            <div className='text-muted-foreground mt-4 flex items-center justify-between border-t pt-4 text-sm'>
              <span>Showing {entries.length} entries</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default TimecardDashboard

// Created and developed by Jai Singh
