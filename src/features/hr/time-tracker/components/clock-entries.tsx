/**
 * Clock Entries Component
 * Real clock entry log viewer with filtering, status indicators, and photo preview.
 */
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import {
  IconSearch,
  IconFilter,
  IconPhoto,
  IconFingerprint,
  IconCheck,
  IconAlertTriangle,
  IconBan,
  IconUser,
  IconClock,
  IconRefresh,
  IconLoader2,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  fetchClockEntries,
  type ClockEntryRow,
} from '../services/time-tracker.service'

// ── Helpers ────────────────────────────────────────────────────────────────

function getStatusIndicator(entry: ClockEntryRow) {
  switch (entry.status) {
    case 'active':
      return (
        <div className='flex items-center gap-1.5'>
          <span className='inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-green-500' />
          <span className='text-xs font-medium text-green-600 dark:text-green-400'>
            Active
          </span>
        </div>
      )
    case 'completed':
      return (
        <div className='flex items-center gap-1.5'>
          <IconCheck className='h-3.5 w-3.5 text-blue-600' />
          <span className='text-xs font-medium text-blue-600 dark:text-blue-400'>
            Completed
          </span>
        </div>
      )
    case 'missed_punch':
      return (
        <div className='flex items-center gap-1.5'>
          <IconAlertTriangle className='h-3.5 w-3.5 text-amber-500' />
          <span className='text-xs font-medium text-amber-600 dark:text-amber-400'>
            Missed
          </span>
        </div>
      )
    case 'void':
      return (
        <div className='flex items-center gap-1.5'>
          <IconBan className='h-3.5 w-3.5 text-red-500' />
          <span className='text-xs font-medium text-red-600 line-through dark:text-red-400'>
            Void
          </span>
        </div>
      )
  }
}

function getMethodBadge(method: string) {
  switch (method) {
    case 'badge':
      return (
        <Badge variant='outline' className='gap-1 text-xs'>
          <IconFingerprint className='h-3 w-3' />
          Badge
        </Badge>
      )
    case 'manual':
      return (
        <Badge
          variant='outline'
          className='gap-1 border-amber-200 text-xs text-amber-600'
        >
          Manual
        </Badge>
      )
    case 'supervisor_entry':
      return (
        <Badge
          variant='outline'
          className='gap-1 border-purple-200 text-xs text-purple-600'
        >
          Supervisor
        </Badge>
      )
    default:
      return (
        <Badge variant='outline' className='text-xs'>
          {method}
        </Badge>
      )
  }
}

function calcDuration(clockIn: string, clockOut: string | null): string {
  if (!clockOut) return '—'
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${mins}m`
}

// ── Component ──────────────────────────────────────────────────────────────

function ClockEntries() {
  const [entries, setEntries] = useState<ClockEntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [methodFilter, setMethodFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  const loadEntries = async () => {
    setLoading(true)
    try {
      const data = await fetchClockEntries({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        method: methodFilter !== 'all' ? methodFilter : undefined,
        search: searchQuery || undefined,
      })
      setEntries(data)
      setCurrentPage(1)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run on mount only; loadEntries uses current filter state
  }, [])

  // Re-fetch when filters change
  useEffect(() => {
    const timer = setTimeout(() => {
      loadEntries()
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadEntries reads filter state; adding would cause double-fetch
  }, [searchQuery, methodFilter, statusFilter, dateFrom, dateTo])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize))
  const paginatedEntries = entries.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  const openPhoto = (employeeName: string) => {
    setSelectedEmployee(employeeName)
    setPhotoDialogOpen(true)
  }

  return (
    <div className='space-y-4'>
      {/* Filter Bar */}
      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative min-w-[200px] flex-1'>
          <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search by employee name or badge #...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>

        <div className='flex items-center gap-2'>
          <Input
            type='date'
            className='w-[150px]'
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <span className='text-muted-foreground text-sm'>to</span>
          <Input
            type='date'
            className='w-[150px]'
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className='w-[150px]'>
            <IconFilter className='mr-2 h-4 w-4' />
            <SelectValue placeholder='Method' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Methods</SelectItem>
            <SelectItem value='badge'>Badge</SelectItem>
            <SelectItem value='manual'>Manual</SelectItem>
            <SelectItem value='supervisor_entry'>Supervisor</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className='w-[150px]'>
            <SelectValue placeholder='Status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Statuses</SelectItem>
            <SelectItem value='active'>Active</SelectItem>
            <SelectItem value='completed'>Completed</SelectItem>
            <SelectItem value='missed_punch'>Missed Punch</SelectItem>
            <SelectItem value='void'>Void</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant='outline'
          size='sm'
          onClick={loadEntries}
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

      {/* Summary */}
      <div className='text-muted-foreground text-sm'>
        Showing{' '}
        <span className='text-foreground font-medium'>{entries.length}</span>{' '}
        entries
      </div>

      {/* Table */}
      <Card>
        <CardContent className='p-0'>
          {loading ? (
            <div className='space-y-2 p-6'>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className='bg-muted h-12 w-full animate-pulse rounded'
                />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-16 text-center'>
              <IconClock className='text-muted-foreground/30 mb-3 h-12 w-12' />
              <p className='text-muted-foreground font-medium'>
                No entries found
              </p>
              <p className='text-muted-foreground/60 mt-1 text-sm'>
                Try adjusting your filters or date range.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Badge #</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-center'>Photo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className='font-mono text-xs'>
                      {format(new Date(entry.clock_in), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <div className='bg-muted flex h-7 w-7 items-center justify-center rounded-full'>
                          <IconUser className='text-muted-foreground h-3.5 w-3.5' />
                        </div>
                        <span className='text-sm font-medium'>
                          {entry.employee_name || 'Unknown'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className='text-muted-foreground font-mono text-xs'>
                      {entry.badge_number || '—'}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {format(new Date(entry.clock_in), 'h:mm:ss a')}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {entry.clock_out
                        ? format(new Date(entry.clock_out), 'h:mm:ss a')
                        : '—'}
                    </TableCell>
                    <TableCell className='text-sm tabular-nums'>
                      {calcDuration(entry.clock_in, entry.clock_out)}
                    </TableCell>
                    <TableCell>
                      {getMethodBadge(entry.clock_in_method)}
                    </TableCell>
                    <TableCell>{getStatusIndicator(entry)}</TableCell>
                    <TableCell className='text-center'>
                      {entry.clock_in_photo_url ? (
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-8 w-8 p-0'
                          onClick={() =>
                            openPhoto(entry.employee_name || 'Employee')
                          }
                        >
                          <IconPhoto className='h-4 w-4 text-blue-500' />
                        </Button>
                      ) : (
                        <span className='text-muted-foreground/30'>—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground text-sm'>
            Page {currentPage} of {totalPages}
          </span>
          <div className='flex items-center gap-1'>
            <Button
              variant='outline'
              size='sm'
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Photo Preview Dialog */}
      <Dialog open={photoDialogOpen} onOpenChange={setPhotoDialogOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <IconPhoto className='h-5 w-5' />
              Clock-in Photo — {selectedEmployee}
            </DialogTitle>
          </DialogHeader>
          <div className='bg-muted/30 flex items-center justify-center rounded-lg border p-8'>
            <div className='text-muted-foreground flex flex-col items-center gap-3'>
              <IconFingerprint className='h-16 w-16 opacity-30' />
              <p className='text-sm'>Photo preview</p>
              <p className='text-xs'>Captured at clock-in time</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ClockEntries
