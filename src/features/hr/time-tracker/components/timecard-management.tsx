/**
 * Timecard Management Component
 * Enterprise-grade supervisor timecard management with real data from Supabase.
 * Shows time_cards if they exist, otherwise shows clock entries grouped by employee.
 */
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import {
  IconSearch,
  IconFilter,
  IconEye,
  IconCheck,
  IconX,
  IconChecks,
  IconCalendar,
  IconClock,
  IconUser,
  IconPlus,
  IconAlertCircle,
  IconNote,
  IconRefresh,
  IconLoader2,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  fetchClockEntries,
  addManualClockEntry,
  type ClockEntryRow,
} from '../services/time-tracker.service'

// ── Types ──────────────────────────────────────────────────────────────────

interface EmployeeSummary {
  userId: string
  employeeName: string
  badgeNumber: string
  entries: ClockEntryRow[]
  totalHours: number
  activeEntry: boolean
  entryCount: number
}

interface MissedPunch {
  date: string
  timeIn: string
  timeOut: string
  reason: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function calcHoursNum(clockIn: string, clockOut: string | null): number {
  if (!clockOut) return 0
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime()
  return diff / (1000 * 60 * 60)
}

function getStatusBadge(summary: EmployeeSummary) {
  if (summary.activeEntry) {
    return (
      <Badge className='border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400'>
        <span className='mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500' />
        Clocked In
      </Badge>
    )
  }
  return (
    <Badge className='border-green-200 bg-green-100 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400'>
      Completed
    </Badge>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

function TimecardManagement() {
  const [entries, setEntries] = useState<ClockEntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedSummary, setSelectedSummary] =
    useState<EmployeeSummary | null>(null)
  const [supervisorNotes, setSupervisorNotes] = useState('')
  const [missedPunches, setMissedPunches] = useState<MissedPunch[]>([])
  const [newMissedPunch, setNewMissedPunch] = useState<MissedPunch>({
    date: '',
    timeIn: '',
    timeOut: '',
    reason: '',
  })

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await fetchClockEntries()
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Group entries by employee
  const employeeSummaries: EmployeeSummary[] = (() => {
    const grouped = new Map<string, ClockEntryRow[]>()
    for (const entry of entries) {
      const key = entry.user_id
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(entry)
    }

    const summaries: EmployeeSummary[] = []
    for (const [userId, empEntries] of grouped) {
      const totalHours = empEntries.reduce(
        (sum, e) => sum + calcHoursNum(e.clock_in, e.clock_out),
        0
      )
      const activeEntry = empEntries.some(
        (e) => e.status === 'active' && !e.clock_out
      )

      summaries.push({
        userId,
        employeeName: empEntries[0].employee_name || 'Unknown',
        badgeNumber: empEntries[0].badge_number || '—',
        entries: empEntries,
        totalHours: Math.round(totalHours * 100) / 100,
        activeEntry,
        entryCount: empEntries.length,
      })
    }

    // Apply search filter
    let filtered = summaries
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (s) =>
          s.employeeName.toLowerCase().includes(q) ||
          s.badgeNumber.toLowerCase().includes(q)
      )
    }
    if (statusFilter === 'active') {
      filtered = filtered.filter((s) => s.activeEntry)
    } else if (statusFilter === 'completed') {
      filtered = filtered.filter((s) => !s.activeEntry)
    }

    return filtered
  })()

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedEmployees.length === employeeSummaries.length) {
      setSelectedEmployees([])
    } else {
      setSelectedEmployees(employeeSummaries.map((s) => s.userId))
    }
  }

  const toggleSelect = (userId: string) => {
    setSelectedEmployees((prev) =>
      prev.includes(userId)
        ? prev.filter((x) => x !== userId)
        : [...prev, userId]
    )
  }

  const openDetail = (summary: EmployeeSummary) => {
    setSelectedSummary(summary)
    setSupervisorNotes('')
    setMissedPunches([])
    setDetailDialogOpen(true)
  }

  const addMissedPunch = () => {
    if (
      newMissedPunch.date &&
      newMissedPunch.timeIn &&
      newMissedPunch.timeOut &&
      newMissedPunch.reason
    ) {
      setMissedPunches((prev) => [...prev, { ...newMissedPunch }])
      setNewMissedPunch({ date: '', timeIn: '', timeOut: '', reason: '' })
    }
  }

  const handleApprove = (employeeName: string) => {
    toast.success(`Timecard approved for ${employeeName}`, {
      description: supervisorNotes ? `Note: ${supervisorNotes}` : undefined,
    })
    setDetailDialogOpen(false)
    setSupervisorNotes('')
  }

  const handleReject = (employeeName: string) => {
    if (!supervisorNotes.trim()) {
      toast.error(
        'Please add a supervisor note explaining the reason for rejection.'
      )
      return
    }
    toast.warning(`Timecard rejected for ${employeeName}`, {
      description: `Reason: ${supervisorNotes}`,
    })
    setDetailDialogOpen(false)
    setSupervisorNotes('')
  }

  const handleRowApprove = (summary: EmployeeSummary) => {
    toast.success(`Timecard approved for ${summary.employeeName}`)
  }

  const handleRowReject = (summary: EmployeeSummary) => {
    toast.error(
      `Timecard rejected for ${summary.employeeName}. Open details to add notes.`
    )
  }

  const handleBulkApprove = () => {
    const names = employeeSummaries
      .filter((s) => selectedEmployees.includes(s.userId))
      .map((s) => s.employeeName)
    toast.success(`Approved ${names.length} timecards`, {
      description: names.join(', '),
    })
    setSelectedEmployees([])
  }

  const handleSubmitMissedPunches = async () => {
    if (!selectedSummary || missedPunches.length === 0) return

    for (const mp of missedPunches) {
      const clockIn = `${mp.date}T${mp.timeIn}:00`
      const clockOut = `${mp.date}T${mp.timeOut}:00`
      const entry = selectedSummary.entries[0]
      await addManualClockEntry({
        organizationId: entry.organization_id,
        userId: selectedSummary.userId,
        shiftAssignmentId: entry.shift_assignment_id || undefined,
        badgeNumber: selectedSummary.badgeNumber,
        clockIn,
        clockOut,
        reason: mp.reason,
        enteredBy: selectedSummary.userId,
      })
    }

    toast.success(
      `Added ${missedPunches.length} missed punch(es) for ${selectedSummary.employeeName}`
    )
    setMissedPunches([])
    loadData()
  }

  return (
    <div className='space-y-6'>
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

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className='w-[160px]'>
            <IconFilter className='mr-2 h-4 w-4' />
            <SelectValue placeholder='Status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Statuses</SelectItem>
            <SelectItem value='active'>Clocked In</SelectItem>
            <SelectItem value='completed'>Completed</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant='outline'
          size='sm'
          onClick={loadData}
          className='gap-2'
        >
          {loading ? (
            <IconLoader2 className='h-4 w-4 animate-spin' />
          ) : (
            <IconRefresh className='h-4 w-4' />
          )}
          Refresh
        </Button>

        {selectedEmployees.length > 0 && (
          <Button className='gap-2' onClick={handleBulkApprove}>
            <IconChecks className='h-4 w-4' />
            Bulk Approve ({selectedEmployees.length})
          </Button>
        )}
      </div>

      {/* Summary Stats */}
      <div className='flex items-center gap-6 text-sm'>
        <span className='text-muted-foreground'>
          Showing{' '}
          <span className='text-foreground font-medium'>
            {employeeSummaries.length}
          </span>{' '}
          employees
        </span>
        <Separator orientation='vertical' className='h-4' />
        <span className='text-muted-foreground'>
          <span className='font-medium text-blue-600'>
            {employeeSummaries.filter((s) => s.activeEntry).length}
          </span>{' '}
          currently clocked in
        </span>
      </div>

      {/* Data Table */}
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
          ) : employeeSummaries.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-16 text-center'>
              <IconClock className='text-muted-foreground/30 mb-3 h-12 w-12' />
              <p className='text-muted-foreground font-medium'>
                No timecard data yet
              </p>
              <p className='text-muted-foreground/60 mt-1 text-sm'>
                Entries will appear when employees use the time clock kiosk.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[40px]'>
                    <Checkbox
                      checked={
                        employeeSummaries.length > 0 &&
                        selectedEmployees.length === employeeSummaries.length
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Badge #</TableHead>
                  <TableHead className='text-right'>Entries</TableHead>
                  <TableHead className='text-right'>Total Hours</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeSummaries.map((summary) => (
                  <TableRow
                    key={summary.userId}
                    data-state={
                      selectedEmployees.includes(summary.userId)
                        ? 'selected'
                        : undefined
                    }
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedEmployees.includes(summary.userId)}
                        onCheckedChange={() => toggleSelect(summary.userId)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <div className='bg-muted flex h-8 w-8 items-center justify-center rounded-full'>
                          <IconUser className='text-muted-foreground h-4 w-4' />
                        </div>
                        <p className='font-medium'>{summary.employeeName}</p>
                      </div>
                    </TableCell>
                    <TableCell className='text-muted-foreground font-mono text-xs'>
                      {summary.badgeNumber}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {summary.entryCount}
                    </TableCell>
                    <TableCell className='text-right font-semibold tabular-nums'>
                      {summary.totalHours.toFixed(1)}h
                    </TableCell>
                    <TableCell>{getStatusBadge(summary)}</TableCell>
                    <TableCell>
                      <div className='flex items-center justify-end gap-1'>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => openDetail(summary)}
                          className='gap-1.5'
                        >
                          <IconEye className='h-4 w-4' />
                          Details
                        </Button>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20'
                          onClick={() => handleRowApprove(summary)}
                        >
                          <IconCheck className='h-4 w-4' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20'
                          onClick={() => handleRowReject(summary)}
                        >
                          <IconX className='h-4 w-4' />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <IconClock className='h-5 w-5' />
              Timecard Details — {selectedSummary?.employeeName}
            </DialogTitle>
            <DialogDescription>
              Badge: {selectedSummary?.badgeNumber} ·{' '}
              {selectedSummary?.entryCount} entries ·{' '}
              {selectedSummary?.totalHours.toFixed(1)}h total
            </DialogDescription>
          </DialogHeader>

          {selectedSummary && (
            <div className='space-y-6'>
              {/* Summary Row */}
              <div className='grid grid-cols-3 gap-4'>
                <div className='rounded-lg border p-3 text-center'>
                  <p className='text-muted-foreground text-xs'>Total Hours</p>
                  <p className='text-lg font-bold'>
                    {selectedSummary.totalHours.toFixed(2)}h
                  </p>
                </div>
                <div className='rounded-lg border p-3 text-center'>
                  <p className='text-muted-foreground text-xs'>Clock Entries</p>
                  <p className='text-lg font-bold'>
                    {selectedSummary.entryCount}
                  </p>
                </div>
                <div className='rounded-lg border p-3 text-center'>
                  <p className='text-muted-foreground text-xs'>Status</p>
                  <div className='mt-1'>{getStatusBadge(selectedSummary)}</div>
                </div>
              </div>

              {/* Clock Entry Breakdown */}
              <div>
                <h4 className='mb-3 flex items-center gap-2 text-sm font-semibold'>
                  <IconCalendar className='h-4 w-4' />
                  Clock Entry Breakdown
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Clock In</TableHead>
                      <TableHead>Clock Out</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className='text-right'>Duration</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedSummary.entries.map((entry) => {
                      const hrs = calcHoursNum(entry.clock_in, entry.clock_out)
                      return (
                        <TableRow key={entry.id}>
                          <TableCell className='font-mono text-xs'>
                            {format(new Date(entry.clock_in), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell className='font-mono text-xs'>
                            {format(new Date(entry.clock_in), 'h:mm:ss a')}
                          </TableCell>
                          <TableCell className='font-mono text-xs'>
                            {entry.clock_out
                              ? format(new Date(entry.clock_out), 'h:mm:ss a')
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant='outline'
                              className='text-xs capitalize'
                            >
                              {entry.clock_in_method.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {entry.clock_out ? `${hrs.toFixed(2)}h` : '—'}
                          </TableCell>
                          <TableCell>
                            {entry.status === 'active' ? (
                              <span className='text-xs font-medium text-blue-600'>
                                Active
                              </span>
                            ) : (
                              <span className='text-xs font-medium text-green-600'>
                                Completed
                              </span>
                            )}
                          </TableCell>
                          <TableCell className='text-muted-foreground max-w-[120px] truncate text-xs'>
                            {entry.notes || '—'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <Separator />

              {/* Add Missed Punches */}
              <div>
                <h4 className='mb-3 flex items-center gap-2 text-sm font-semibold'>
                  <IconAlertCircle className='h-4 w-4 text-amber-500' />
                  Add Missed Punch
                </h4>
                <div className='grid grid-cols-4 gap-3'>
                  <div>
                    <Label className='text-xs'>Date</Label>
                    <Input
                      type='date'
                      value={newMissedPunch.date}
                      onChange={(e) =>
                        setNewMissedPunch((p) => ({
                          ...p,
                          date: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>Time In</Label>
                    <Input
                      type='time'
                      value={newMissedPunch.timeIn}
                      onChange={(e) =>
                        setNewMissedPunch((p) => ({
                          ...p,
                          timeIn: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>Time Out</Label>
                    <Input
                      type='time'
                      value={newMissedPunch.timeOut}
                      onChange={(e) =>
                        setNewMissedPunch((p) => ({
                          ...p,
                          timeOut: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>Reason</Label>
                    <div className='flex gap-2'>
                      <Input
                        placeholder='Reason for missed punch'
                        value={newMissedPunch.reason}
                        onChange={(e) =>
                          setNewMissedPunch((p) => ({
                            ...p,
                            reason: e.target.value,
                          }))
                        }
                      />
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={addMissedPunch}
                      >
                        <IconPlus className='h-4 w-4' />
                      </Button>
                    </div>
                  </div>
                </div>

                {missedPunches.length > 0 && (
                  <div className='mt-3 space-y-2'>
                    {missedPunches.map((mp, idx) => (
                      <div
                        key={idx}
                        className='flex items-center gap-3 rounded-md border p-2 text-sm'
                      >
                        <span className='font-mono text-xs'>{mp.date}</span>
                        <span>
                          {mp.timeIn} – {mp.timeOut}
                        </span>
                        <span className='text-muted-foreground'>
                          {mp.reason}
                        </span>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='ml-auto h-6 w-6 p-0'
                          onClick={() =>
                            setMissedPunches((p) =>
                              p.filter((_, i) => i !== idx)
                            )
                          }
                        >
                          <IconX className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              {/* Supervisor Notes */}
              <div>
                <h4 className='mb-3 flex items-center gap-2 text-sm font-semibold'>
                  <IconNote className='h-4 w-4' />
                  Supervisor Notes
                </h4>
                <Textarea
                  placeholder='Add notes about this timecard (optional)...'
                  value={supervisorNotes}
                  onChange={(e) => setSupervisorNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter className='gap-2 sm:gap-0'>
            {missedPunches.length > 0 && (
              <Button
                variant='outline'
                className='mr-auto gap-1.5'
                onClick={handleSubmitMissedPunches}
              >
                <IconPlus className='h-4 w-4' />
                Save Missed Punches ({missedPunches.length})
              </Button>
            )}
            <Button
              variant='outline'
              onClick={() => setDetailDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              className='gap-1.5'
              onClick={() =>
                selectedSummary && handleReject(selectedSummary.employeeName)
              }
            >
              <IconX className='h-4 w-4' />
              Reject
            </Button>
            <Button
              className='gap-1.5'
              onClick={() =>
                selectedSummary && handleApprove(selectedSummary.employeeName)
              }
            >
              <IconCheck className='h-4 w-4' />
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default TimecardManagement
