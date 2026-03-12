import { useCallback, useEffect, useState } from 'react'
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
} from 'date-fns'
import {
  AlertTriangle,
  Briefcase,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Timer,
  Users,
  XCircle,
  Trash2,
  X,
  History,
  ClipboardList,
  HandCoins,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import type { WorkingArea } from '@/lib/supabase/labor-management.service'
import { runAutoPick } from '@/lib/supabase/overtime-autopick.service'
import {
  getAllOvertimeRequests,
  approveOvertimeRequest,
  denyOvertimeRequest,
  cancelOvertimeRequest,
  deleteOvertimeRequest,
  getOvertimeStatistics,
  formatOvertimeDuration,
  getOvertimeStatusVariant,
  getOvertimeStatusText,
  getOvertimeErrorMessage,
  getSignupsForRequests,
  type OvertimeRequestWithDetails,
  type OvertimeStatus,
  type OvertimeStatistics,
} from '@/lib/supabase/overtime.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTeamPerformance } from '@/features/shift-productivity/team-performance/hooks/use-team-performance'

const DURATION_BLOCKS = [
  { hours: 2, label: '2 Hours', minutes: 120 },
  { hours: 4, label: '4 Hours', minutes: 240 },
  { hours: 8, label: '8 Hours (Full Day)', minutes: 480 },
  { hours: 10, label: '10 Hours (Off-Day / Extended)', minutes: 600 },
] as const

const PAGE_SIZE = 20

interface OvertimeManagementDashboardProps {
  className?: string
}

export function OvertimeManagementDashboard({
  className,
}: OvertimeManagementDashboardProps) {
  const { authState } = useUnifiedAuth()
  const currentUserId = authState.profile?.id || ''
  const { organizationId, workingAreas: rawWorkingAreas } = useTeamPerformance({
    autoRefresh: false,
  })
  const workingAreas = (rawWorkingAreas || []) as WorkingArea[]
  const { shiftPositions } = useLaborManagement()

  const activePositions = shiftPositions.filter((p) => p.is_active)

  // Data state
  const [requests, setRequests] = useState<OvertimeRequestWithDetails[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [statistics, setStatistics] = useState<OvertimeStatistics | null>(null)

  // Loading state
  const [isLoadingRequests, setIsLoadingRequests] = useState(false)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // View state
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<OvertimeStatus | 'all'>(
    'all'
  )
  const [areaFilter, setAreaFilter] = useState('__any__')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date()
    return {
      start: startOfWeek(now, { weekStartsOn: 0 }),
      end: endOfWeek(now, { weekStartsOn: 0 }),
    }
  })

  // Create form state
  const [formDate, setFormDate] = useState<Date>(new Date())
  const [formPositionId, setFormPositionId] = useState('')
  const [formDuration, setFormDuration] = useState<number>(120)
  const [formStartTime, setFormStartTime] = useState('14:30')
  const [formAreaId, setFormAreaId] = useState('__any__')
  const [formSlots, setFormSlots] = useState(1)
  const [formPriority, setFormPriority] = useState<
    'low' | 'normal' | 'high' | 'urgent'
  >('normal')
  const [formReason, setFormReason] = useState('')
  const [formCutoffTime, setFormCutoffTime] = useState('')
  const [formMinSignups, setFormMinSignups] = useState(1)
  const [calendarOpen, setCalendarOpen] = useState(false)

  const [signupCounts, setSignupCounts] = useState<Record<string, number>>({})

  // Action dialogs
  const [deleteConfirmRequest, setDeleteConfirmRequest] =
    useState<OvertimeRequestWithDetails | null>(null)
  const [denyDialogRequest, setDenyDialogRequest] =
    useState<OvertimeRequestWithDetails | null>(null)
  const [denyReason, setDenyReason] = useState('')

  // Computed end time from start + duration
  const computedEndTime = (() => {
    const [h, m] = formStartTime.split(':').map(Number)
    let totalMins = h * 60 + m + formDuration
    if (totalMins >= 1440) totalMins = totalMins % 1440
    const endH = Math.floor(totalMins / 60)
    const endM = totalMins % 60
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
  })()

  // Data fetching
  const loadRequests = useCallback(async () => {
    if (!organizationId) return
    setIsLoadingRequests(true)
    try {
      const { data, totalCount: count } = await getAllOvertimeRequests(
        organizationId,
        {
          startDate: format(dateRange.start, 'yyyy-MM-dd'),
          endDate: format(dateRange.end, 'yyyy-MM-dd'),
          status: statusFilter,
          searchQuery: searchQuery || undefined,
          workingAreaId: areaFilter !== '__any__' ? areaFilter : undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }
      )
      setRequests(data)
      setTotalCount(count)
    } catch (error) {
      logger.error('Error loading overtime requests:', error)
      toast.error('Failed to load overtime positions')
    } finally {
      setIsLoadingRequests(false)
    }
  }, [organizationId, dateRange, statusFilter, searchQuery, areaFilter, page])

  const loadStatistics = useCallback(async () => {
    if (!organizationId) return
    setIsLoadingStats(true)
    try {
      const stats = await getOvertimeStatistics(
        organizationId,
        format(dateRange.start, 'yyyy-MM-dd'),
        format(dateRange.end, 'yyyy-MM-dd')
      )
      setStatistics(stats)
    } catch (error) {
      logger.error('Error loading statistics:', error)
    } finally {
      setIsLoadingStats(false)
    }
  }, [organizationId, dateRange])

  useEffect(() => {
    loadRequests()
    loadStatistics()
  }, [loadRequests, loadStatistics])

  useEffect(() => {
    const loadSignupCounts = async () => {
      if (requests.length === 0) return
      try {
        const ids = requests.map((r) => r.id)
        const signups = await getSignupsForRequests(ids)
        const counts: Record<string, number> = {}
        for (const s of signups) {
          const rid = s.overtime_request_id || ''
          counts[rid] = (counts[rid] || 0) + 1
        }
        setSignupCounts(counts)
      } catch (_error) {
        // silent fail - counts are supplementary
      }
    }
    loadSignupCounts()
  }, [requests])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, searchQuery, areaFilter, dateRange])

  const refreshAll = () => {
    loadRequests()
    loadStatistics()
  }

  const resetForm = () => {
    setFormDate(new Date())
    setFormPositionId('')
    setFormDuration(120)
    setFormStartTime('14:30')
    setFormAreaId('__any__')
    setFormSlots(1)
    setFormPriority('normal')
    setFormReason('')
    setFormCutoffTime('')
    setFormMinSignups(1)
  }

  const selectedPosition = activePositions.find((p) => p.id === formPositionId)

  useEffect(() => {
    if (showCreateForm && formDate) {
      const dayBefore = new Date(formDate)
      dayBefore.setDate(dayBefore.getDate() - 1)
      dayBefore.setHours(17, 0, 0, 0)
      const isoLocal = `${dayBefore.getFullYear()}-${String(dayBefore.getMonth() + 1).padStart(2, '0')}-${String(dayBefore.getDate()).padStart(2, '0')}T17:00`
      setFormCutoffTime(isoLocal)
    }
  }, [showCreateForm, formDate])

  // Create overtime position(s) by inserting directly into overtime_requests
  // without associating specific users - these are open positions to be fulfilled
  const handleCreate = async () => {
    if (!formPositionId) {
      toast.error('Please select a position')
      return
    }
    if (!organizationId) return

    setIsSubmitting(true)
    try {
      const dateStr = format(formDate, 'yyyy-MM-dd')
      const workingAreaId = formAreaId !== '__any__' ? formAreaId : undefined
      const position = activePositions.find((p) => p.id === formPositionId)
      const positionLabel = position?.position_title || 'Unknown Position'

      const genRequestNumber = () => {
        const ds = dateStr.replace(/-/g, '')
        const rand = Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, '0')
        return `OT-${ds}-${rand}`
      }

      const insertRows = Array.from({ length: formSlots }, () => ({
        organization_id: organizationId,
        request_number: genRequestNumber(),
        request_date: dateStr,
        original_shift_end: formStartTime,
        extended_shift_end: computedEndTime,
        overtime_duration_minutes: formDuration,
        scope_type: 'area' as const,
        assigned_user_ids: [],
        working_area_id: workingAreaId || null,
        reason: formReason || null,
        notes: `Position: ${positionLabel} (${position?.position_code || ''})\nDuration Block: ${formDuration / 60}h${formSlots > 1 ? `\nBatch: ${positionLabel} OT - ${format(formDate, 'MMM d, yyyy')}` : ''}`,
        priority: formPriority,
        status: 'pending' as const,
        requested_by: currentUserId,
        created_by: currentUserId,
        is_voluntary: true,
        is_paid: true,
        pay_multiplier: 1.5,
        signup_cutoff_time: formCutoffTime
          ? new Date(formCutoffTime).toISOString()
          : null,
        min_signups_required: formMinSignups,
      }))

      /* eslint-disable @typescript-eslint/no-explicit-any -- new columns not yet in generated DB types */
      const { error } = await (
        supabase.from('overtime_requests') as any
      ).insert(insertRows)
      /* eslint-enable @typescript-eslint/no-explicit-any */

      if (error) throw error

      toast.success(
        formSlots === 1
          ? `Overtime position created for ${positionLabel}`
          : `${formSlots} overtime positions created for ${positionLabel}`
      )
      resetForm()
      setShowCreateForm(false)
      refreshAll()
    } catch (error) {
      logger.error('Error creating overtime position:', error)
      toast.error(getOvertimeErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  // Actions
  const handleApprove = async (request: OvertimeRequestWithDetails) => {
    try {
      await approveOvertimeRequest(request.id, currentUserId)
      toast.success('Overtime position approved')
      refreshAll()
    } catch (error) {
      logger.error('Error approving overtime:', error)
      toast.error(getOvertimeErrorMessage(error))
    }
  }

  const handleDeny = async () => {
    if (!denyDialogRequest) return
    try {
      await denyOvertimeRequest(
        denyDialogRequest.id,
        currentUserId,
        denyReason || undefined
      )
      toast.success('Overtime position denied')
      setDenyDialogRequest(null)
      setDenyReason('')
      refreshAll()
    } catch (error) {
      logger.error('Error denying overtime:', error)
      toast.error(getOvertimeErrorMessage(error))
    }
  }

  const handleCancel = async (request: OvertimeRequestWithDetails) => {
    try {
      await cancelOvertimeRequest(request.id)
      toast.success('Overtime position cancelled')
      refreshAll()
    } catch (error) {
      logger.error('Error cancelling overtime:', error)
      toast.error(getOvertimeErrorMessage(error))
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirmRequest) return
    try {
      await deleteOvertimeRequest(deleteConfirmRequest.id)
      toast.success('Overtime position deleted')
      setDeleteConfirmRequest(null)
      refreshAll()
    } catch (error) {
      logger.error('Error deleting overtime:', error)
      toast.error(getOvertimeErrorMessage(error))
    }
  }

  // Derived
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1
  const getStatusBadge = (status: OvertimeStatus) => (
    <Badge variant={getOvertimeStatusVariant(status)}>
      {getOvertimeStatusText(status)}
    </Badge>
  )

  const parseDurationFromNotes = (notes?: string) => {
    const match = notes?.match(/Duration Block: (\d+)h/)
    return match ? `${match[1]}h` : null
  }

  const parsePositionFromNotes = (notes?: string) => {
    const match = notes?.match(/Position: (.+?)(?:\s*\(|$)/)
    return match ? match[1].trim() : null
  }

  if (!organizationId) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <p className='text-muted-foreground'>Organization not found</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Stats Cards */}
      <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
        {isLoadingStats ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className='h-24 rounded-lg' />
            ))}
          </>
        ) : statistics ? (
          <>
            <StatCard
              icon={ClipboardList}
              title='Total Positions'
              value={statistics.total_requests}
              description={`${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d')}`}
            />
            <StatCard
              icon={Clock}
              title='Pending Approval'
              value={statistics.pending_count}
              description='Awaiting review'
              highlight={statistics.pending_count > 0}
            />
            <StatCard
              icon={CheckCircle2}
              title='Approved'
              value={statistics.approved_count}
              description={formatOvertimeDuration(
                statistics.approved_overtime_minutes
              )}
            />
            <StatCard
              icon={Users}
              title='Open Slots'
              value={statistics.pending_count + statistics.approved_count}
              description='Available for associates'
            />
          </>
        ) : (
          <div className='col-span-4 py-8 text-center'>
            <p className='text-muted-foreground'>No statistics available</p>
          </div>
        )}
      </div>

      {/* Pending Approval Alert */}
      {statistics && statistics.pending_count > 0 && (
        <Alert className='border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30'>
          <AlertTriangle className='h-4 w-4 text-yellow-600' />
          <AlertDescription className='text-yellow-800 dark:text-yellow-200'>
            <strong>{statistics.pending_count}</strong> overtime position
            {statistics.pending_count !== 1 ? 's' : ''} pending approval.
            Approve to make them available for associates to claim.
          </AlertDescription>
        </Alert>
      )}

      {/* Toolbar */}
      <div className='flex flex-wrap items-center gap-3'>
        <div className='flex items-center gap-2'>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant='outline' className='w-[130px] text-left text-sm'>
                <CalendarIcon className='mr-2 h-4 w-4' />
                {format(dateRange.start, 'MMM d')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-auto p-0' align='start'>
              <Calendar
                mode='single'
                selected={dateRange.start}
                onSelect={(date) =>
                  date && setDateRange((prev) => ({ ...prev, start: date }))
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <span className='text-muted-foreground text-sm'>to</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant='outline' className='w-[130px] text-left text-sm'>
                <CalendarIcon className='mr-2 h-4 w-4' />
                {format(dateRange.end, 'MMM d')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-auto p-0' align='start'>
              <Calendar
                mode='single'
                selected={dateRange.end}
                onSelect={(date) =>
                  date && setDateRange((prev) => ({ ...prev, end: date }))
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className='flex items-center gap-1'>
          {(['This Week', 'This Month', '3 Months'] as const).map((label) => (
            <Button
              key={label}
              variant='ghost'
              size='sm'
              className='text-xs'
              onClick={() => {
                const now = new Date()
                if (label === 'This Week')
                  setDateRange({
                    start: startOfWeek(now, { weekStartsOn: 0 }),
                    end: endOfWeek(now, { weekStartsOn: 0 }),
                  })
                else if (label === 'This Month')
                  setDateRange({
                    start: startOfMonth(now),
                    end: endOfMonth(now),
                  })
                else
                  setDateRange({
                    start: subMonths(startOfMonth(now), 2),
                    end: endOfMonth(now),
                  })
              }}
            >
              {label}
            </Button>
          ))}
        </div>

        <Separator orientation='vertical' className='h-8' />

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as OvertimeStatus | 'all')}
        >
          <SelectTrigger className='w-[150px]'>
            <Filter className='mr-2 h-4 w-4' />
            <SelectValue placeholder='All Statuses' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Statuses</SelectItem>
            <SelectItem value='pending'>Pending</SelectItem>
            <SelectItem value='approved'>Approved</SelectItem>
            <SelectItem value='rejected'>Denied</SelectItem>
            <SelectItem value='completed'>Completed</SelectItem>
            <SelectItem value='cancelled'>Cancelled</SelectItem>
          </SelectContent>
        </Select>

        {workingAreas.length > 0 && (
          <Select value={areaFilter} onValueChange={setAreaFilter}>
            <SelectTrigger className='w-[150px]'>
              <SelectValue placeholder='All Areas' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='__any__'>All Areas</SelectItem>
              {workingAreas.map((area) => (
                <SelectItem key={area.id} value={area.id}>
                  {area.area_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className='relative min-w-[180px] flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search positions...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>

        <Button
          variant='outline'
          size='icon'
          onClick={refreshAll}
          disabled={isLoadingRequests}
        >
          <RefreshCw
            className={cn('h-4 w-4', isLoadingRequests && 'animate-spin')}
          />
        </Button>

        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className='mr-2 h-4 w-4' />
          Create Position
        </Button>
      </div>

      {/* Create Overtime Position Panel */}
      {showCreateForm && (
        <Card className='border-primary/20'>
          <CardHeader className='pb-4'>
            <div className='flex items-center justify-between'>
              <div>
                <CardTitle className='flex items-center gap-2 text-lg'>
                  <HandCoins className='h-5 w-5' />
                  Create Overtime Position
                </CardTitle>
                <CardDescription>
                  Open an overtime slot tied to a labor position. Associates can
                  claim it once they meet the criteria.
                </CardDescription>
              </div>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => {
                  resetForm()
                  setShowCreateForm(false)
                }}
              >
                <X className='h-4 w-4' />
              </Button>
            </div>
          </CardHeader>
          <CardContent className='space-y-5'>
            {/* Position & Date Row */}
            <div className='grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3'>
              {/* Position Selector */}
              <div className='space-y-2'>
                <Label>Position *</Label>
                <Select
                  value={formPositionId}
                  onValueChange={setFormPositionId}
                >
                  <SelectTrigger>
                    <Briefcase className='mr-2 h-4 w-4 opacity-50' />
                    <SelectValue placeholder='Select a position...' />
                  </SelectTrigger>
                  <SelectContent>
                    {activePositions.length === 0 ? (
                      <div className='text-muted-foreground px-3 py-6 text-center text-sm'>
                        No positions configured. Add them in Labor Management
                        Settings.
                      </div>
                    ) : (
                      activePositions.map((pos) => (
                        <SelectItem key={pos.id} value={pos.id}>
                          <div className='flex items-center gap-2'>
                            <span>{pos.position_title}</span>
                            <span className='text-muted-foreground text-xs'>
                              ({pos.position_code})
                            </span>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {selectedPosition && (
                  <p className='text-muted-foreground text-xs'>
                    {selectedPosition.position_type} &middot; L
                    {selectedPosition.position_level}
                    {selectedPosition.department &&
                      ` · ${selectedPosition.department}`}
                  </p>
                )}
              </div>

              {/* Date */}
              <div className='space-y-2'>
                <Label>Overtime Date *</Label>
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant='outline'
                      className='w-full justify-start text-left font-normal'
                    >
                      <CalendarIcon className='mr-2 h-4 w-4' />
                      {format(formDate, 'MMM d, yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className='w-auto p-0' align='start'>
                    <Calendar
                      mode='single'
                      selected={formDate}
                      onSelect={(d) => {
                        if (d) setFormDate(d)
                        setCalendarOpen(false)
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Number of Slots */}
              <div className='space-y-2'>
                <Label>Number of Slots</Label>
                <Input
                  type='number'
                  min={1}
                  max={50}
                  value={formSlots}
                  onChange={(e) =>
                    setFormSlots(Math.max(1, parseInt(e.target.value) || 1))
                  }
                />
                <p className='text-muted-foreground text-xs'>
                  How many associates can fill this overtime
                </p>
              </div>
            </div>

            {/* Duration Block Selector */}
            <div className='space-y-2'>
              <Label>Duration Block *</Label>
              <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                {DURATION_BLOCKS.map((block) => (
                  <button
                    key={block.minutes}
                    type='button'
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border-2 p-4 transition-all',
                      formDuration === block.minutes
                        ? 'border-primary bg-primary/5 ring-primary/20 ring-2'
                        : 'border-border hover:border-primary/40 hover:bg-muted/50'
                    )}
                    onClick={() => setFormDuration(block.minutes)}
                  >
                    <Timer
                      className={cn(
                        'h-6 w-6',
                        formDuration === block.minutes
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      )}
                    />
                    <span className='text-lg font-bold'>{block.hours}h</span>
                    <span className='text-muted-foreground text-center text-xs'>
                      {block.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Start Time & Computed End */}
            <div className='grid grid-cols-1 gap-5 md:grid-cols-3'>
              <div className='space-y-2'>
                <Label>Start Time</Label>
                <Input
                  type='time'
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                />
              </div>
              <div className='space-y-2'>
                <Label>End Time (computed)</Label>
                <div className='border-border bg-muted/30 flex h-10 items-center rounded-md border px-3 text-sm font-medium'>
                  <Clock className='text-muted-foreground mr-2 h-4 w-4' />
                  {computedEndTime}
                  <Badge
                    variant='outline'
                    className='ml-auto border-orange-300 text-orange-600'
                  >
                    {formDuration / 60}h block
                  </Badge>
                </div>
              </div>
              <div className='space-y-2'>
                <Label>Priority</Label>
                <Select
                  value={formPriority}
                  onValueChange={(v) =>
                    setFormPriority(v as 'low' | 'normal' | 'high' | 'urgent')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='low'>Low</SelectItem>
                    <SelectItem value='normal'>Normal</SelectItem>
                    <SelectItem value='high'>High</SelectItem>
                    <SelectItem value='urgent'>Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Cutoff & Min Signups */}
            <div className='grid grid-cols-1 gap-5 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label>Signup Cutoff Time *</Label>
                <Input
                  type='datetime-local'
                  value={formCutoffTime}
                  onChange={(e) => setFormCutoffTime(e.target.value)}
                />
                <p className='text-muted-foreground text-xs'>
                  When signups close. Auto-extends by 1 hour if not enough
                  signups.
                </p>
              </div>
              <div className='space-y-2'>
                <Label>Minimum Signups Required</Label>
                <Input
                  type='number'
                  min={1}
                  max={50}
                  value={formMinSignups}
                  onChange={(e) =>
                    setFormMinSignups(
                      Math.max(1, parseInt(e.target.value) || 1)
                    )
                  }
                />
                <p className='text-muted-foreground text-xs'>
                  How many associates must sign up before auto-pick can run
                </p>
              </div>
            </div>

            {/* Area & Reason */}
            <div className='grid grid-cols-1 gap-5 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label>Working Area (Optional)</Label>
                <Select value={formAreaId} onValueChange={setFormAreaId}>
                  <SelectTrigger>
                    <SelectValue placeholder='Any area' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__any__'>Any Area</SelectItem>
                    {workingAreas.map((area) => (
                      <SelectItem key={area.id} value={area.id}>
                        {area.area_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-2'>
                <Label>Reason (Optional)</Label>
                <Textarea
                  placeholder='e.g., High volume, urgent shipments...'
                  className='h-10 resize-none'
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                />
              </div>
            </div>

            {/* Summary */}
            {formPositionId && (
              <Alert className='border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30'>
                <Timer className='h-4 w-4 text-orange-600' />
                <AlertDescription className='text-orange-800 dark:text-orange-200'>
                  Creating{' '}
                  <strong>
                    {formSlots} &times; {formDuration / 60}-hour
                  </strong>{' '}
                  overtime slot{formSlots !== 1 ? 's' : ''} for{' '}
                  <strong>{selectedPosition?.position_title}</strong> on{' '}
                  {format(formDate, 'EEEE, MMM d')} ({formStartTime} &ndash;{' '}
                  {computedEndTime})
                </AlertDescription>
              </Alert>
            )}

            {/* Submit */}
            <div className='flex justify-end gap-3'>
              <Button
                variant='outline'
                onClick={() => {
                  resetForm()
                  setShowCreateForm(false)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={isSubmitting || !formPositionId}
              >
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                Create {formSlots > 1 ? `${formSlots} Positions` : 'Position'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overtime Positions Table */}
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='flex items-center gap-2 text-lg'>
                <History className='h-5 w-5' />
                Overtime Positions
              </CardTitle>
              <CardDescription>
                {totalCount} position{totalCount !== 1 ? 's' : ''} found
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingRequests ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
            </div>
          ) : requests.length === 0 ? (
            <div className='text-muted-foreground flex flex-col items-center justify-center py-12'>
              <ClipboardList className='mb-4 h-12 w-12 opacity-50' />
              <p className='text-lg font-medium'>No overtime positions found</p>
              <p className='text-sm'>
                Create a new position or adjust the filters above
              </p>
              <Button
                variant='outline'
                className='mt-4'
                onClick={() => setShowCreateForm(true)}
              >
                <Plus className='mr-2 h-4 w-4' />
                Create Position
              </Button>
            </div>
          ) : (
            <>
              <div className='rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Position</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Area</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Signups</TableHead>
                      <TableHead>Cutoff</TableHead>
                      <TableHead className='text-right'>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((request) => {
                      const posTitle =
                        parsePositionFromNotes(request.notes) ||
                        request.user_profile?.full_name ||
                        'Open Position'
                      const durLabel = parseDurationFromNotes(request.notes)
                      return (
                        <TableRow key={request.id}>
                          <TableCell>
                            <div className='flex items-center gap-2'>
                              <div className='bg-primary/10 flex h-8 w-8 items-center justify-center rounded-full'>
                                <Briefcase className='text-primary h-4 w-4' />
                              </div>
                              <div>
                                <p className='text-sm font-medium'>
                                  {posTitle}
                                </p>
                                {request.request_number && (
                                  <p className='text-muted-foreground text-xs'>
                                    {request.request_number}
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className='text-sm'>
                              {format(
                                new Date(request.request_date),
                                'MMM d, yyyy'
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className='text-sm'>
                              {request.original_shift_end?.substring(0, 5) ||
                                '--:--'}
                              {' – '}
                              <span className='font-medium text-orange-600 dark:text-orange-400'>
                                {request.extended_shift_end?.substring(0, 5) ||
                                  '--:--'}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant='outline'
                              className='border-orange-300 text-orange-600'
                            >
                              {durLabel ||
                                `+${formatOvertimeDuration(request.overtime_duration_minutes || 0)}`}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className='text-muted-foreground text-sm'>
                              {request.working_area_name || '—'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <PriorityBadge priority={request.priority} />
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(request.status)}
                          </TableCell>
                          <TableCell>
                            <span className='text-sm'>
                              {signupCounts[request.id] || 0} /{' '}
                              {request.min_signups_required || 1}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className='text-muted-foreground text-xs'>
                              {request.signup_cutoff_time
                                ? format(
                                    new Date(request.signup_cutoff_time),
                                    'MMM d, h:mm a'
                                  )
                                : 'No cutoff'}
                            </span>
                          </TableCell>
                          <TableCell className='text-right'>
                            <div className='flex items-center justify-end gap-1'>
                              {request.status === 'pending' && (
                                <>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant='ghost'
                                          size='icon'
                                          onClick={() => handleApprove(request)}
                                          className='text-green-600 hover:bg-green-50 hover:text-green-700'
                                        >
                                          <CheckCircle2 className='h-4 w-4' />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Approve</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant='ghost'
                                          size='icon'
                                          onClick={() =>
                                            setDenyDialogRequest(request)
                                          }
                                          className='text-red-600 hover:bg-red-50 hover:text-red-700'
                                        >
                                          <XCircle className='h-4 w-4' />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Deny</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant='ghost' size='icon'>
                                    <MoreHorizontal className='h-4 w-4' />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align='end'>
                                  {request.status === 'approved' && (
                                    <>
                                      <DropdownMenuItem
                                        onClick={async () => {
                                          try {
                                            const result = await runAutoPick(
                                              request.id
                                            )
                                            if (result.outcome === 'selected') {
                                              toast.success(
                                                `Selected ${result.userName || 'associate'} for this position`
                                              )
                                            } else if (
                                              result.outcome === 'extended'
                                            ) {
                                              toast.info(
                                                `Cutoff extended to ${format(new Date(result.newCutoff), 'MMM d, h:mm a')}`
                                              )
                                            } else {
                                              toast.info(result.reason)
                                            }
                                            refreshAll()
                                          } catch {
                                            toast.error(
                                              'Failed to run auto-pick'
                                            )
                                          }
                                        }}
                                      >
                                        <CheckCircle2 className='mr-2 h-4 w-4' />
                                        Run Auto-Pick
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => handleCancel(request)}
                                      >
                                        <XCircle className='mr-2 h-4 w-4' />
                                        Cancel
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setDeleteConfirmRequest(request)
                                    }
                                    className='text-destructive'
                                  >
                                    <Trash2 className='mr-2 h-4 w-4' />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className='text-muted-foreground mt-4 flex items-center justify-between text-sm'>
                <span>
                  Showing {Math.min((page - 1) * PAGE_SIZE + 1, totalCount)} -{' '}
                  {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
                </span>
                <div className='flex items-center gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || isLoadingRequests}
                  >
                    <ChevronLeft className='mr-1 h-4 w-4' />
                    Previous
                  </Button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages || isLoadingRequests}
                  >
                    Next
                    <ChevronRight className='ml-1 h-4 w-4' />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteConfirmRequest}
        onOpenChange={() => setDeleteConfirmRequest(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Overtime Position</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete this overtime
              position? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deny Confirmation */}
      <AlertDialog
        open={!!denyDialogRequest}
        onOpenChange={() => {
          setDenyDialogRequest(null)
          setDenyReason('')
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deny Overtime Position</AlertDialogTitle>
            <AlertDialogDescription>
              Deny this overtime position?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='py-4'>
            <Label>Reason (Optional)</Label>
            <Textarea
              placeholder='Provide a reason for denial...'
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              className='mt-2'
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeny}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Deny Position
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StatCard({
  icon: Icon,
  title,
  value,
  description,
  highlight = false,
}: {
  icon: React.ElementType
  title: string
  value: number | string
  description: string
  highlight?: boolean
}) {
  return (
    <Card
      className={highlight ? 'border-yellow-300 dark:border-yellow-700' : ''}
    >
      <CardContent className='p-0'>
        <div className='flex flex-row items-center justify-between space-y-0 p-4 pb-2'>
          <p className='text-sm font-medium'>{title}</p>
          <Icon
            className={cn(
              'h-4 w-4',
              highlight
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-muted-foreground'
            )}
          />
        </div>
        <div className='p-4 pt-0'>
          <div className='text-2xl font-bold'>{value}</div>
          <p className='text-muted-foreground text-xs'>{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function PriorityBadge({
  priority,
}: {
  priority: 'low' | 'normal' | 'high' | 'urgent'
}) {
  const variants: Record<string, string> = {
    low: 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400',
    normal: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    high: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    urgent: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize',
        variants[priority] || variants.normal
      )}
    >
      {priority}
    </span>
  )
}
