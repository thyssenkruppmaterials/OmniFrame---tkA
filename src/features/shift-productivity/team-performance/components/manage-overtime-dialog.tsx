// Created and developed by Jai Singh
/**
 * Manage Overtime Dialog Component
 * Allows supervisors to manage overtime requests for associates
 * - View pending/approved/denied overtime requests
 * - Create individual or batch overtime assignments
 * - Approve or deny overtime requests
 * Created: January 3, 2026
 */
import { useCallback, useEffect, useState } from 'react'
import * as z from 'zod'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  subMonths,
} from 'date-fns'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit,
  Filter,
  History,
  LayoutDashboard,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  User,
  Users,
  X,
  XCircle,
  Timer,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { WorkingArea } from '@/lib/supabase/labor-management.service'
import {
  getAllOvertimeRequests,
  getCurrentWeekOvertimeRequests,
  createOvertimeRequest,
  createBatchOvertime,
  approveOvertimeRequest,
  denyOvertimeRequest,
  cancelOvertimeRequest,
  deleteOvertimeRequest,
  updateOvertimeRequest,
  getOvertimeStatistics,
  formatOvertimeDuration,
  calculateOvertimeMinutes,
  getOvertimeStatusVariant,
  getOvertimeStatusText,
  getOvertimeErrorMessage,
  // Issue 2.11: Import error message helper
  type OvertimeRequestWithDetails,
  type OvertimeStatus,
  type OvertimeStatistics,
} from '@/lib/supabase/overtime.service'
import {
  getUsersForEventAssignment,
  type UserForEventAssignment,
} from '@/lib/supabase/timeline-events.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
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
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DialogFooter } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// Common overtime durations
const OVERTIME_PRESETS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '1.5 hours' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
  { minutes: 240, label: '4 hours' },
]

// Maximum overtime limit in minutes (8 hours = 480 minutes)
const MAX_OVERTIME_MINUTES = 480

// Form schema for creating overtime
const overtimeFormSchema = z
  .object({
    request_date: z.date({ message: 'Please select a date' }),
    original_shift_end: z
      .string()
      .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
    extended_shift_end: z
      .string()
      .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
    scope_type: z.enum(['individual', 'batch']).default('individual'),
    user_id: z.string().optional(),
    user_ids: z.array(z.string()).optional(),
    batch_name: z.string().trim().optional(),
    working_area_id: z.string().optional(),
    reason: z.string().trim().max(500).optional(),
    auto_approve: z.boolean().default(true),
  })
  .refine(
    (data) => {
      // Validate that extended time is after original time
      const orig = data.original_shift_end.split(':').map(Number)
      const ext = data.extended_shift_end.split(':').map(Number)
      const origMins = orig[0] * 60 + orig[1]
      let extMins = ext[0] * 60 + ext[1]
      // Handle overnight: if extended appears earlier, add 24 hours
      if (extMins <= origMins) {
        extMins += 1440
      }
      return extMins > origMins
    },
    {
      message: 'Extended shift end must be after original shift end',
      path: ['extended_shift_end'],
    }
  )
  .refine(
    (data) => {
      // Validate maximum overtime duration (8 hours max)
      const orig = data.original_shift_end.split(':').map(Number)
      const ext = data.extended_shift_end.split(':').map(Number)
      const origMins = orig[0] * 60 + orig[1]
      let extMins = ext[0] * 60 + ext[1]
      // Handle overnight: if extended appears earlier, add 24 hours
      if (extMins <= origMins) {
        extMins += 1440
      }
      const overtimeMinutes = extMins - origMins
      return overtimeMinutes <= MAX_OVERTIME_MINUTES
    },
    {
      message: 'Overtime cannot exceed 8 hours (480 minutes)',
      path: ['extended_shift_end'],
    }
  )
  .refine(
    (data) => {
      if (data.scope_type === 'individual' && !data.user_id) {
        return false
      }
      return true
    },
    {
      message: 'Please select an employee',
      path: ['user_id'],
    }
  )
  .refine(
    (data) => {
      if (
        data.scope_type === 'batch' &&
        (!data.user_ids || data.user_ids.length === 0)
      ) {
        return false
      }
      return true
    },
    {
      message: 'Please select at least one employee',
      path: ['user_ids'],
    }
  )
  .refine(
    (data) => {
      if (data.scope_type === 'batch' && !data.batch_name) {
        return false
      }
      return true
    },
    {
      message: 'Please provide a batch name',
      path: ['batch_name'],
    }
  )

type OvertimeFormData = z.infer<typeof overtimeFormSchema>

interface ManageOvertimeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  workingAreas?: WorkingArea[]
  selectedDate?: Date
  onOvertimeChanged?: () => void
}

export function ManageOvertimeDialog({
  open,
  onOpenChange,
  organizationId,
  workingAreas = [],
  selectedDate,
  onOvertimeChanged,
}: ManageOvertimeDialogProps) {
  // Get current user for created_by fields
  const { authState } = useUnifiedAuth()
  const currentUserId = authState.profile?.id || ''

  // State
  const [requests, setRequests] = useState<OvertimeRequestWithDetails[]>([]) // Current week requests
  const [dashboardRequests, setDashboardRequests] = useState<
    OvertimeRequestWithDetails[]
  >([]) // Historical requests
  const [dashboardTotalCount, setDashboardTotalCount] = useState(0)
  const [availableUsers, setAvailableUsers] = useState<
    UserForEventAssignment[]
  >([])
  const [statistics, setStatistics] = useState<OvertimeStatistics | null>(null)
  const [isLoadingRequests, setIsLoadingRequests] = useState(false)
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false)
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  // View state
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'requests' | 'create' | 'statistics'
  >('dashboard')
  const [statusFilter, setStatusFilter] = useState<OvertimeStatus | 'all'>(
    'all'
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [deleteConfirmRequest, setDeleteConfirmRequest] =
    useState<OvertimeRequestWithDetails | null>(null)
  const [denyDialogRequest, setDenyDialogRequest] =
    useState<OvertimeRequestWithDetails | null>(null)
  const [denyReason, setDenyReason] = useState('')

  // Dashboard filters state
  const [dashboardStatusFilter, setDashboardStatusFilter] = useState<
    OvertimeStatus | 'all'
  >('all')
  const [dashboardSearchQuery, setDashboardSearchQuery] = useState('')
  const [dashboardAreaFilter, setDashboardAreaFilter] =
    useState<string>('__any__')
  const [dashboardDateRange, setDashboardDateRange] = useState<{
    start: Date
    end: Date
  }>(() => {
    const now = new Date()
    return {
      start: subMonths(startOfMonth(now), 2), // Last 3 months by default
      end: endOfMonth(now),
    }
  })
  const [dashboardPage, setDashboardPage] = useState(1)
  const DASHBOARD_PAGE_SIZE = 25

  // Edit overtime state
  const [editingRequest, setEditingRequest] =
    useState<OvertimeRequestWithDetails | null>(null)
  const [editFormData, setEditFormData] = useState<{
    request_date: string
    original_shift_end: string
    extended_shift_end: string
    working_area_id: string
    reason: string
    notes: string
  } | null>(null)

  // Form
  const form = useForm<OvertimeFormData>({
    resolver: zodResolver(overtimeFormSchema) as never,
    defaultValues: {
      request_date: selectedDate || new Date(),
      original_shift_end: '14:30',
      extended_shift_end: '16:30',
      scope_type: 'individual',
      user_id: undefined,
      user_ids: [],
      batch_name: '',
      working_area_id: undefined,
      reason: '',
      auto_approve: true,
    },
  })

  // Load current week requests (for Requests tab - only pending/approved)
  const loadRequests = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingRequests(true)
    try {
      const data = await getCurrentWeekOvertimeRequests(
        organizationId,
        selectedDate || new Date()
      )

      // Apply local filters
      let filteredData = data
      if (statusFilter !== 'all') {
        filteredData = filteredData.filter((r) => r.status === statusFilter)
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        filteredData = filteredData.filter(
          (r) =>
            r.user_profile?.full_name?.toLowerCase().includes(query) ||
            r.user_profile?.email?.toLowerCase().includes(query) ||
            r.working_area_name?.toLowerCase().includes(query) ||
            r.batch_name?.toLowerCase().includes(query)
        )
      }

      setRequests(filteredData)
    } catch (error) {
      logger.error('Error loading current week overtime requests:', error)
      toast.error('Failed to load overtime requests')
    } finally {
      setIsLoadingRequests(false)
    }
  }, [organizationId, selectedDate, statusFilter, searchQuery])

  // Load dashboard requests (historical - all statuses)
  const loadDashboardRequests = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingDashboard(true)
    try {
      const { data, totalCount } = await getAllOvertimeRequests(
        organizationId,
        {
          startDate: format(dashboardDateRange.start, 'yyyy-MM-dd'),
          endDate: format(dashboardDateRange.end, 'yyyy-MM-dd'),
          status: dashboardStatusFilter,
          searchQuery: dashboardSearchQuery || undefined,
          workingAreaId:
            dashboardAreaFilter !== '__any__' ? dashboardAreaFilter : undefined,
          limit: DASHBOARD_PAGE_SIZE,
          offset: (dashboardPage - 1) * DASHBOARD_PAGE_SIZE,
        }
      )

      setDashboardRequests(data)
      setDashboardTotalCount(totalCount)
    } catch (error) {
      logger.error('Error loading dashboard overtime requests:', error)
      toast.error('Failed to load overtime history')
    } finally {
      setIsLoadingDashboard(false)
    }
  }, [
    organizationId,
    dashboardDateRange,
    dashboardStatusFilter,
    dashboardSearchQuery,
    dashboardAreaFilter,
    dashboardPage,
  ])

  // Load available users
  const loadUsers = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingUsers(true)
    try {
      const users = await getUsersForEventAssignment(organizationId, {
        limit: 200,
      })
      setAvailableUsers(users)
    } catch (error) {
      logger.error('Error loading users:', error)
    } finally {
      setIsLoadingUsers(false)
    }
  }, [organizationId])

  // Load statistics
  const loadStatistics = useCallback(async () => {
    if (!organizationId || !selectedDate) return

    setIsLoadingStats(true)
    try {
      const startDate = format(startOfMonth(selectedDate), 'yyyy-MM-dd')
      const endDate = format(endOfMonth(selectedDate), 'yyyy-MM-dd')
      const stats = await getOvertimeStatistics(
        organizationId,
        startDate,
        endDate
      )
      setStatistics(stats)
    } catch (error) {
      logger.error('Error loading statistics:', error)
    } finally {
      setIsLoadingStats(false)
    }
  }, [organizationId, selectedDate])

  // Initial load when dialog opens
  useEffect(() => {
    if (open) {
      loadDashboardRequests()
      loadRequests()
      loadUsers()
      loadStatistics()
      setActiveTab('dashboard')
      resetForm()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetForm defined below; runs only on dialog open
  }, [open, loadDashboardRequests, loadRequests, loadUsers, loadStatistics])

  // Reload requests when filter changes
  useEffect(() => {
    if (open && activeTab === 'requests') {
      loadRequests()
    }
  }, [statusFilter, searchQuery, open, activeTab, loadRequests])

  // Reload dashboard when filters change
  useEffect(() => {
    if (open && activeTab === 'dashboard') {
      loadDashboardRequests()
    }
  }, [
    dashboardStatusFilter,
    dashboardSearchQuery,
    dashboardAreaFilter,
    dashboardDateRange,
    dashboardPage,
    open,
    activeTab,
    loadDashboardRequests,
  ])

  // Reset dashboard page when filters change
  useEffect(() => {
    setDashboardPage(1)
  }, [
    dashboardStatusFilter,
    dashboardSearchQuery,
    dashboardAreaFilter,
    dashboardDateRange,
  ])

  // Reset form
  const resetForm = () => {
    form.reset({
      request_date: selectedDate || new Date(),
      original_shift_end: '14:30',
      extended_shift_end: '16:30',
      scope_type: 'individual',
      user_id: undefined,
      user_ids: [],
      batch_name: '',
      working_area_id: undefined,
      reason: '',
      auto_approve: true,
    })
  }

  // Handle form submission
  const onSubmit = async (data: OvertimeFormData) => {
    setIsSubmitting(true)
    try {
      const dateStr = format(data.request_date, 'yyyy-MM-dd')

      // Convert __any__ to undefined for working_area_id
      const workingAreaId =
        data.working_area_id === '__any__' ? undefined : data.working_area_id

      if (data.scope_type === 'individual' && data.user_id) {
        // Create individual request
        // Issue 2.12: Pass auto_approve for individual overtime
        await createOvertimeRequest(organizationId, currentUserId, {
          user_ids: [data.user_id],
          request_date: dateStr,
          original_shift_end: data.original_shift_end,
          extended_shift_end: data.extended_shift_end,
          reason: data.reason,
          working_area_id: workingAreaId,
          auto_approve: data.auto_approve,
        })
        toast.success(
          data.auto_approve
            ? 'Overtime created and approved'
            : 'Overtime request created successfully'
        )
      } else if (
        data.scope_type === 'batch' &&
        data.user_ids &&
        data.user_ids.length > 0
      ) {
        // Create batch overtime
        await createBatchOvertime(organizationId, currentUserId, {
          batch_name:
            data.batch_name ||
            `Overtime - ${format(data.request_date, 'MMM d, yyyy')}`,
          request_date: dateStr,
          original_shift_end: data.original_shift_end,
          extended_shift_end: data.extended_shift_end,
          user_ids: data.user_ids,
          working_area_id: workingAreaId,
          auto_approve: data.auto_approve,
        })
        toast.success(
          `Batch overtime created for ${data.user_ids.length} employees`
        )
      }

      resetForm()
      loadRequests()
      loadDashboardRequests()
      loadStatistics()
      setActiveTab('requests')
      onOvertimeChanged?.()
    } catch (error) {
      logger.error('Error creating overtime:', error)
      // Issue 2.11: Use specific error message helper
      toast.error(getOvertimeErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  // Approve request
  const handleApprove = async (request: OvertimeRequestWithDetails) => {
    try {
      await approveOvertimeRequest(request.id, currentUserId)
      toast.success(
        `Approved overtime for ${request.user_profile?.full_name || 'employee'}`
      )
      loadRequests()
      loadDashboardRequests()
      loadStatistics()
      onOvertimeChanged?.()
    } catch (error) {
      logger.error('Error approving overtime:', error)
      // Issue 2.11: Use specific error message helper
      toast.error(getOvertimeErrorMessage(error))
    }
  }

  // Deny request
  const handleDeny = async () => {
    if (!denyDialogRequest) return

    try {
      await denyOvertimeRequest(
        denyDialogRequest.id,
        currentUserId,
        denyReason || undefined
      )
      toast.success(
        `Denied overtime for ${denyDialogRequest.user_profile?.full_name || 'employee'}`
      )
      setDenyDialogRequest(null)
      setDenyReason('')
      loadRequests()
      loadDashboardRequests()
      loadStatistics()
      onOvertimeChanged?.()
    } catch (error) {
      logger.error('Error denying overtime:', error)
      toast.error(getOvertimeErrorMessage(error))
    }
  }

  // Cancel request
  const handleCancel = async (request: OvertimeRequestWithDetails) => {
    try {
      await cancelOvertimeRequest(request.id)
      toast.success('Overtime request cancelled')
      loadRequests()
      loadDashboardRequests()
      loadStatistics()
      onOvertimeChanged?.()
    } catch (error) {
      logger.error('Error cancelling overtime:', error)
      toast.error(getOvertimeErrorMessage(error))
    }
  }

  // Delete request
  const handleDelete = async () => {
    if (!deleteConfirmRequest) return

    try {
      await deleteOvertimeRequest(deleteConfirmRequest.id)
      toast.success('Overtime request deleted')
      setDeleteConfirmRequest(null)
      loadRequests()
      loadDashboardRequests()
      loadStatistics()
      onOvertimeChanged?.()
    } catch (error) {
      logger.error('Error deleting overtime:', error)
      toast.error(getOvertimeErrorMessage(error))
    }
  }

  // Start editing a request
  const handleStartEdit = (request: OvertimeRequestWithDetails) => {
    setEditingRequest(request)
    setEditFormData({
      request_date: request.request_date,
      original_shift_end:
        request.original_shift_end?.substring(0, 5) || '14:30',
      extended_shift_end:
        request.extended_shift_end?.substring(0, 5) || '16:30',
      working_area_id: request.working_area_id || '__any__',
      reason: request.reason || '',
      notes: request.notes || '',
    })
  }

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingRequest(null)
    setEditFormData(null)
  }

  // Save edited overtime
  const handleSaveEdit = async () => {
    if (!editingRequest || !editFormData) return

    setIsUpdating(true)
    try {
      await updateOvertimeRequest(editingRequest.id, {
        request_date: editFormData.request_date,
        original_shift_end: editFormData.original_shift_end,
        extended_shift_end: editFormData.extended_shift_end,
        working_area_id:
          editFormData.working_area_id === '__any__'
            ? null
            : editFormData.working_area_id,
        reason: editFormData.reason || undefined,
        notes: editFormData.notes || undefined,
      })

      toast.success('Overtime request updated successfully')
      setEditingRequest(null)
      setEditFormData(null)
      loadDashboardRequests()
      loadRequests()
      loadStatistics()
      onOvertimeChanged?.()
    } catch (error) {
      logger.error('Error updating overtime:', error)
      toast.error(getOvertimeErrorMessage(error))
    } finally {
      setIsUpdating(false)
    }
  }

  // Update edit form field
  const updateEditField = (
    field: keyof NonNullable<typeof editFormData>,
    value: string
  ) => {
    if (!editFormData) return
    setEditFormData({ ...editFormData, [field]: value })
  }

  // Calculate preview overtime for edit form
  const editOvertimeMinutes = editFormData
    ? calculateOvertimeMinutes(
        editFormData.original_shift_end,
        editFormData.extended_shift_end
      )
    : 0

  // Apply time preset
  // Issue 2.10: Allow overnight overtime by wrapping past midnight
  const applyOvertimePreset = (minutes: number) => {
    const originalEnd = form.getValues('original_shift_end')
    const [hours, mins] = originalEnd.split(':').map(Number)
    let totalMins = hours * 60 + mins + minutes

    // Handle overnight wrap: if past 24 hours, wrap to next day
    // e.g., 23:00 + 2 hours = 01:00 (next day)
    if (totalMins >= 1440) {
      totalMins = totalMins % 1440 // Wrap to next day
      toast.info('Overtime extends past midnight into the next day', {
        duration: 3000,
      })
    }

    const newHours = Math.floor(totalMins / 60)
    const newMins = totalMins % 60
    form.setValue(
      'extended_shift_end',
      `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`
    )
  }

  // Filter users
  const filteredUsers = availableUsers.filter((user) => {
    if (!userSearchQuery) return true
    const query = userSearchQuery.toLowerCase()
    return (
      user.full_name.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query) ||
      user.working_area_name?.toLowerCase().includes(query)
    )
  })

  // Watch form values
  const watchScopeType = form.watch('scope_type')
  const watchUserIds = form.watch('user_ids') || []
  const watchOriginalEnd = form.watch('original_shift_end')
  const watchExtendedEnd = form.watch('extended_shift_end')

  // Calculate overtime minutes
  const overtimeMinutes = calculateOvertimeMinutes(
    watchOriginalEnd,
    watchExtendedEnd
  )

  // Toggle user selection for batch
  const toggleUserSelection = (userId: string) => {
    const current = form.getValues('user_ids') || []
    if (current.includes(userId)) {
      form.setValue(
        'user_ids',
        current.filter((id) => id !== userId)
      )
    } else {
      form.setValue('user_ids', [...current, userId])
    }
  }

  // Get status badge
  const getStatusBadge = (status: OvertimeStatus) => {
    return (
      <Badge variant={getOvertimeStatusVariant(status)}>
        {getOvertimeStatusText(status)}
      </Badge>
    )
  }

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} size='lg'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className='flex items-center gap-2'>
            <Clock className='h-5 w-5 text-orange-500' />
            Manage Overtime
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            View, approve, and create overtime requests for{' '}
            {selectedDate ? format(selectedDate, 'MMMM d, yyyy') : 'today'}.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className='overflow-hidden'>
          {/* Issue 2.9: Reset form when switching away from create tab to prevent stale form data */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              const newTab = v as typeof activeTab
              // Reset form when leaving the create tab
              if (activeTab === 'create' && newTab !== 'create') {
                resetForm()
              }
              setActiveTab(newTab)
            }}
            className='flex min-h-0 flex-1 flex-col'
          >
            <TabsList className='grid w-full grid-cols-4'>
              <TabsTrigger
                value='dashboard'
                className='flex items-center gap-2'
              >
                <LayoutDashboard className='h-4 w-4' />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value='requests' className='flex items-center gap-2'>
                <Users className='h-4 w-4' />
                Requests
                {requests.filter((r) => r.status === 'pending').length > 0 && (
                  <Badge variant='destructive' className='ml-1 text-xs'>
                    {requests.filter((r) => r.status === 'pending').length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value='create' className='flex items-center gap-2'>
                <Plus className='h-4 w-4' />
                Create Overtime
              </TabsTrigger>
              <TabsTrigger
                value='statistics'
                className='flex items-center gap-2'
              >
                <TrendingUp className='h-4 w-4' />
                Statistics
              </TabsTrigger>
            </TabsList>

            {/* Dashboard Tab - All Historical Overtime */}
            <TabsContent
              value='dashboard'
              className='mt-4 flex min-h-0 flex-1 flex-col space-y-4'
            >
              {/* Dashboard Description */}
              <div className='text-muted-foreground flex items-center gap-2 text-sm'>
                <History className='h-4 w-4' />
                <span>
                  All overtime requests including completed and historical
                  records
                </span>
              </div>

              {/* Dashboard Filters */}
              <div className='flex flex-wrap items-center gap-3'>
                {/* Date Range Filter */}
                <div className='flex items-center gap-2'>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant='outline'
                        className='w-[130px] text-left text-sm'
                      >
                        <CalendarIcon className='mr-2 h-4 w-4' />
                        {format(dashboardDateRange.start, 'MMM d')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='w-auto p-0' align='start'>
                      <Calendar
                        mode='single'
                        selected={dashboardDateRange.start}
                        onSelect={(date) =>
                          date &&
                          setDashboardDateRange((prev) => ({
                            ...prev,
                            start: date,
                          }))
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <span className='text-muted-foreground'>to</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant='outline'
                        className='w-[130px] text-left text-sm'
                      >
                        <CalendarIcon className='mr-2 h-4 w-4' />
                        {format(dashboardDateRange.end, 'MMM d')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='w-auto p-0' align='start'>
                      <Calendar
                        mode='single'
                        selected={dashboardDateRange.end}
                        onSelect={(date) =>
                          date &&
                          setDashboardDateRange((prev) => ({
                            ...prev,
                            end: date,
                          }))
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Quick Date Range Buttons */}
                <div className='flex items-center gap-1'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => {
                      const now = new Date()
                      setDashboardDateRange({
                        start: startOfWeek(now, { weekStartsOn: 0 }),
                        end: endOfWeek(now, { weekStartsOn: 0 }),
                      })
                    }}
                    className='text-xs'
                  >
                    This Week
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => {
                      const now = new Date()
                      setDashboardDateRange({
                        start: startOfMonth(now),
                        end: endOfMonth(now),
                      })
                    }}
                    className='text-xs'
                  >
                    This Month
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => {
                      const now = new Date()
                      setDashboardDateRange({
                        start: subMonths(startOfMonth(now), 2),
                        end: endOfMonth(now),
                      })
                    }}
                    className='text-xs'
                  >
                    3 Months
                  </Button>
                </div>

                {/* Status Filter */}
                <Select
                  value={dashboardStatusFilter}
                  onValueChange={(v) =>
                    setDashboardStatusFilter(v as typeof dashboardStatusFilter)
                  }
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

                {/* Area Filter */}
                {workingAreas.length > 0 && (
                  <Select
                    value={dashboardAreaFilter}
                    onValueChange={setDashboardAreaFilter}
                  >
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

                {/* Search */}
                <div className='relative min-w-[180px] flex-1'>
                  <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                  <Input
                    placeholder='Search employees...'
                    value={dashboardSearchQuery}
                    onChange={(e) => setDashboardSearchQuery(e.target.value)}
                    className='pl-9'
                  />
                </div>

                {/* Refresh */}
                <Button
                  variant='outline'
                  size='icon'
                  onClick={loadDashboardRequests}
                  disabled={isLoadingDashboard}
                >
                  <RefreshCw
                    className={cn(
                      'h-4 w-4',
                      isLoadingDashboard && 'animate-spin'
                    )}
                  />
                </Button>
              </div>

              {/* Dashboard Table */}
              <ScrollArea className='flex-1 rounded-lg border'>
                {isLoadingDashboard ? (
                  <div className='flex items-center justify-center py-12'>
                    <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
                  </div>
                ) : dashboardRequests.length === 0 ? (
                  <div className='text-muted-foreground flex flex-col items-center justify-center py-12'>
                    <History className='mb-4 h-12 w-12 opacity-50' />
                    <p className='text-lg font-medium'>
                      No overtime records found
                    </p>
                    <p className='text-sm'>
                      Try adjusting the filters or date range
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-[180px]'>Employee</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Original End</TableHead>
                        <TableHead>Extended End</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Area</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className='text-right'>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboardRequests.map((request) => (
                        <TableRow
                          key={request.id}
                          className={
                            editingRequest?.id === request.id
                              ? 'bg-muted/50'
                              : ''
                          }
                        >
                          {editingRequest?.id === request.id && editFormData ? (
                            // Edit Mode Row
                            <>
                              <TableCell>
                                <div className='flex items-center gap-2'>
                                  <div className='bg-muted flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium'>
                                    {request.user_profile?.full_name
                                      ?.split(' ')
                                      .map((n) => n[0])
                                      .join('')
                                      .substring(0, 2)
                                      .toUpperCase() || '??'}
                                  </div>
                                  <span className='text-sm font-medium'>
                                    {request.user_profile?.full_name ||
                                      'Unknown'}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Input
                                  type='date'
                                  value={editFormData.request_date}
                                  onChange={(e) =>
                                    updateEditField(
                                      'request_date',
                                      e.target.value
                                    )
                                  }
                                  className='h-8 w-[130px] text-sm'
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type='time'
                                  value={editFormData.original_shift_end}
                                  onChange={(e) =>
                                    updateEditField(
                                      'original_shift_end',
                                      e.target.value
                                    )
                                  }
                                  className='h-8 w-[100px] text-sm'
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type='time'
                                  value={editFormData.extended_shift_end}
                                  onChange={(e) =>
                                    updateEditField(
                                      'extended_shift_end',
                                      e.target.value
                                    )
                                  }
                                  className='h-8 w-[100px] text-sm'
                                />
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant='outline'
                                  className='border-orange-300 text-orange-600'
                                >
                                  +{formatOvertimeDuration(editOvertimeMinutes)}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={editFormData.working_area_id}
                                  onValueChange={(v) =>
                                    updateEditField('working_area_id', v)
                                  }
                                >
                                  <SelectTrigger className='h-8 w-[120px] text-sm'>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value='__any__'>—</SelectItem>
                                    {workingAreas.map((area) => (
                                      <SelectItem key={area.id} value={area.id}>
                                        {area.area_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                {getStatusBadge(request.status)}
                              </TableCell>
                              <TableCell className='text-right'>
                                <div className='flex items-center justify-end gap-1'>
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={handleSaveEdit}
                                    disabled={isUpdating}
                                    className='text-green-600 hover:bg-green-50 hover:text-green-700'
                                  >
                                    {isUpdating ? (
                                      <Loader2 className='h-4 w-4 animate-spin' />
                                    ) : (
                                      <Save className='h-4 w-4' />
                                    )}
                                  </Button>
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={handleCancelEdit}
                                    disabled={isUpdating}
                                    className='text-muted-foreground hover:text-foreground'
                                  >
                                    <X className='h-4 w-4' />
                                  </Button>
                                </div>
                              </TableCell>
                            </>
                          ) : (
                            // View Mode Row
                            <>
                              <TableCell>
                                <div className='flex items-center gap-2'>
                                  <div className='bg-muted flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium'>
                                    {request.user_profile?.full_name
                                      ?.split(' ')
                                      .map((n) => n[0])
                                      .join('')
                                      .substring(0, 2)
                                      .toUpperCase() || '??'}
                                  </div>
                                  <div>
                                    <p className='text-sm font-medium'>
                                      {request.user_profile?.full_name ||
                                        'Unknown'}
                                    </p>
                                    {request.batch_name && (
                                      <p className='text-muted-foreground text-xs'>
                                        {request.batch_name}
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
                                  {request.original_shift_end?.substring(
                                    0,
                                    5
                                  ) || '--:--'}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className='text-sm font-medium text-orange-600 dark:text-orange-400'>
                                  {request.extended_shift_end?.substring(
                                    0,
                                    5
                                  ) || '--:--'}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant='outline'
                                  className='border-orange-300 text-orange-600'
                                >
                                  +
                                  {formatOvertimeDuration(
                                    request.overtime_duration_minutes || 0
                                  )}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <span className='text-muted-foreground text-sm'>
                                  {request.working_area_name || '—'}
                                </span>
                              </TableCell>
                              <TableCell>
                                {getStatusBadge(request.status)}
                              </TableCell>
                              <TableCell className='text-right'>
                                <div className='flex items-center justify-end gap-1'>
                                  {request.status === 'pending' && (
                                    <>
                                      <Button
                                        variant='ghost'
                                        size='icon'
                                        onClick={() => handleApprove(request)}
                                        className='text-green-600 hover:bg-green-50 hover:text-green-700'
                                      >
                                        <CheckCircle2 className='h-4 w-4' />
                                      </Button>
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
                                    </>
                                  )}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant='ghost' size='icon'>
                                        <MoreHorizontal className='h-4 w-4' />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align='end'>
                                      <DropdownMenuItem
                                        onClick={() => handleStartEdit(request)}
                                      >
                                        <Edit className='mr-2 h-4 w-4' />
                                        Edit
                                      </DropdownMenuItem>
                                      {request.status === 'approved' && (
                                        <DropdownMenuItem
                                          onClick={() => handleCancel(request)}
                                        >
                                          <XCircle className='mr-2 h-4 w-4' />
                                          Cancel
                                        </DropdownMenuItem>
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
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>

              {/* Dashboard Pagination */}
              <div className='text-muted-foreground flex items-center justify-between text-sm'>
                <span>
                  Showing{' '}
                  {Math.min(
                    (dashboardPage - 1) * DASHBOARD_PAGE_SIZE + 1,
                    dashboardTotalCount
                  )}{' '}
                  -{' '}
                  {Math.min(
                    dashboardPage * DASHBOARD_PAGE_SIZE,
                    dashboardTotalCount
                  )}{' '}
                  of {dashboardTotalCount} records
                </span>
                <div className='flex items-center gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setDashboardPage((p) => Math.max(1, p - 1))}
                    disabled={dashboardPage <= 1 || isLoadingDashboard}
                  >
                    <ChevronLeft className='h-4 w-4' />
                    Previous
                  </Button>
                  <span className='text-sm'>
                    Page {dashboardPage} of{' '}
                    {Math.ceil(dashboardTotalCount / DASHBOARD_PAGE_SIZE) || 1}
                  </span>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setDashboardPage((p) => p + 1)}
                    disabled={
                      dashboardPage >=
                        Math.ceil(dashboardTotalCount / DASHBOARD_PAGE_SIZE) ||
                      isLoadingDashboard
                    }
                  >
                    Next
                    <ChevronRight className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* Requests Tab - Current Week Only */}
            <TabsContent
              value='requests'
              className='mt-4 flex min-h-0 flex-1 flex-col space-y-4'
            >
              {/* Week Info Banner */}
              <div className='text-muted-foreground bg-muted/50 flex items-center gap-2 rounded-lg px-3 py-2 text-sm'>
                <Clock className='h-4 w-4' />
                <span>
                  Showing open and active overtime for current week (
                  {format(
                    startOfWeek(selectedDate || new Date(), {
                      weekStartsOn: 0,
                    }),
                    'MMM d'
                  )}{' '}
                  -{' '}
                  {format(
                    endOfWeek(selectedDate || new Date(), { weekStartsOn: 0 }),
                    'MMM d, yyyy'
                  )}
                  )
                </span>
              </div>

              {/* Filters */}
              <div className='flex flex-wrap items-center gap-3'>
                {/* Status Filter */}
                <Select
                  value={statusFilter}
                  onValueChange={(v) =>
                    setStatusFilter(v as typeof statusFilter)
                  }
                >
                  <SelectTrigger className='w-[160px]'>
                    <Filter className='mr-2 h-4 w-4' />
                    <SelectValue placeholder='All Statuses' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>All Open/Active</SelectItem>
                    <SelectItem value='pending'>Pending Only</SelectItem>
                    <SelectItem value='approved'>Approved Only</SelectItem>
                  </SelectContent>
                </Select>

                {/* Search */}
                <div className='relative min-w-[200px] flex-1'>
                  <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                  <Input
                    placeholder='Search by name, email, or area...'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className='pl-9'
                  />
                </div>

                {/* Refresh */}
                <Button
                  variant='outline'
                  size='icon'
                  onClick={loadRequests}
                  disabled={isLoadingRequests}
                >
                  <RefreshCw
                    className={cn(
                      'h-4 w-4',
                      isLoadingRequests && 'animate-spin'
                    )}
                  />
                </Button>

                {/* Create New Button */}
                <Button
                  onClick={() => {
                    resetForm()
                    setActiveTab('create')
                  }}
                >
                  <Plus className='mr-2 h-4 w-4' />
                  New Overtime
                </Button>
              </div>

              {/* Requests Table */}
              <ScrollArea className='flex-1 rounded-lg border'>
                {isLoadingRequests ? (
                  <div className='flex items-center justify-center py-12'>
                    <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
                  </div>
                ) : requests.length === 0 ? (
                  <div className='text-muted-foreground flex flex-col items-center justify-center py-12'>
                    <Clock className='mb-4 h-12 w-12 opacity-50' />
                    <p className='text-lg font-medium'>
                      No open overtime requests
                    </p>
                    <p className='text-sm'>
                      Create a new overtime request to get started
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-[180px]'>Employee</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Original End</TableHead>
                        <TableHead>Extended End</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Area</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className='text-right'>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requests.map((request) => (
                        <TableRow key={request.id}>
                          <TableCell>
                            <div className='flex items-center gap-2'>
                              <div className='bg-muted flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium'>
                                {request.user_profile?.full_name
                                  ?.split(' ')
                                  .map((n) => n[0])
                                  .join('')
                                  .substring(0, 2)
                                  .toUpperCase() || '??'}
                              </div>
                              <div>
                                <p className='text-sm font-medium'>
                                  {request.user_profile?.full_name || 'Unknown'}
                                </p>
                                {request.batch_name && (
                                  <p className='text-muted-foreground text-xs'>
                                    {request.batch_name}
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className='text-sm'>
                              {format(
                                new Date(request.request_date),
                                'EEE, MMM d'
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className='text-sm'>
                              {request.original_shift_end?.substring(0, 5) ||
                                '--:--'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className='text-sm font-medium text-orange-600 dark:text-orange-400'>
                              {request.extended_shift_end?.substring(0, 5) ||
                                '--:--'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant='outline'
                              className='border-orange-300 text-orange-600'
                            >
                              +
                              {formatOvertimeDuration(
                                request.overtime_duration_minutes || 0
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className='text-muted-foreground text-sm'>
                              {request.working_area_name || '—'}
                            </span>
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(request.status)}
                          </TableCell>
                          <TableCell className='text-right'>
                            <div className='flex items-center justify-end gap-1'>
                              {request.status === 'pending' && (
                                <>
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={() => handleApprove(request)}
                                    className='text-green-600 hover:bg-green-50 hover:text-green-700'
                                  >
                                    <CheckCircle2 className='h-4 w-4' />
                                  </Button>
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
                                </>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant='ghost' size='icon'>
                                    <MoreHorizontal className='h-4 w-4' />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align='end'>
                                  <DropdownMenuItem
                                    onClick={() => handleStartEdit(request)}
                                  >
                                    <Edit className='mr-2 h-4 w-4' />
                                    Edit
                                  </DropdownMenuItem>
                                  {request.status === 'approved' && (
                                    <DropdownMenuItem
                                      onClick={() => handleCancel(request)}
                                    >
                                      <XCircle className='mr-2 h-4 w-4' />
                                      Cancel
                                    </DropdownMenuItem>
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
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>

              {/* Summary */}
              <div className='text-muted-foreground text-sm'>
                {requests.length} open/active overtime request
                {requests.length !== 1 ? 's' : ''} this week
              </div>
            </TabsContent>

            {/* Create Overtime Tab */}
            <TabsContent value='create' className='mt-4 flex-1 overflow-y-auto'>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className='space-y-5'
                >
                  {/* Date Selection */}
                  <FormField
                    control={form.control}
                    name='request_date'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Overtime Date *</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant='outline'
                                className={cn(
                                  'w-full pl-3 text-left font-normal',
                                  !field.value && 'text-muted-foreground'
                                )}
                              >
                                {field.value ? (
                                  format(field.value, 'MMM d, yyyy')
                                ) : (
                                  <span>Pick a date</span>
                                )}
                                <CalendarIcon className='ml-auto h-4 w-4 opacity-50' />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className='w-auto p-0' align='start'>
                            <Calendar
                              mode='single'
                              selected={field.value}
                              onSelect={field.onChange}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Time Selection */}
                  <div className='grid grid-cols-2 gap-4'>
                    <FormField
                      control={form.control}
                      name='original_shift_end'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Original Shift End *</FormLabel>
                          <FormControl>
                            <Input type='time' {...field} />
                          </FormControl>
                          <FormDescription>
                            Regular scheduled end time
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name='extended_shift_end'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Extended End Time *</FormLabel>
                          <FormControl>
                            <Input type='time' {...field} />
                          </FormControl>
                          <FormDescription>
                            New end time with overtime
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Overtime Preview */}
                  {overtimeMinutes > 0 && (
                    <Alert className='border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30'>
                      <Timer className='h-4 w-4 text-orange-600' />
                      <AlertDescription className='text-orange-800 dark:text-orange-200'>
                        <span className='font-semibold'>
                          {formatOvertimeDuration(overtimeMinutes)}
                        </span>{' '}
                        of overtime will be added
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Overtime Presets */}
                  <div className='flex flex-wrap gap-2'>
                    <span className='text-muted-foreground mr-2 self-center text-xs'>
                      Quick Add:
                    </span>
                    {OVERTIME_PRESETS.map((preset) => (
                      <Button
                        key={preset.minutes}
                        type='button'
                        variant='outline'
                        size='sm'
                        className='text-xs'
                        onClick={() => applyOvertimePreset(preset.minutes)}
                      >
                        +{preset.label}
                      </Button>
                    ))}
                  </div>

                  {/* Scope Selection */}
                  <FormField
                    control={form.control}
                    name='scope_type'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assignment Type</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value='individual'>
                              <div className='flex items-center gap-2'>
                                <User className='h-4 w-4' />
                                Individual Employee
                              </div>
                            </SelectItem>
                            <SelectItem value='batch'>
                              <div className='flex items-center gap-2'>
                                <Users className='h-4 w-4' />
                                Multiple Employees (Batch)
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Individual Employee Selection */}
                  {watchScopeType === 'individual' && (
                    <FormField
                      control={form.control}
                      name='user_id'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Select Employee *</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder='Choose an employee' />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {availableUsers.map((user) => (
                                <SelectItem key={user.id} value={user.id}>
                                  <div className='flex items-center gap-2'>
                                    <span>{user.full_name}</span>
                                    {user.working_area_name && (
                                      <span className='text-muted-foreground text-xs'>
                                        ({user.working_area_name})
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {/* Batch Employee Selection */}
                  {watchScopeType === 'batch' && (
                    <>
                      <FormField
                        control={form.control}
                        name='batch_name'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Batch Name *</FormLabel>
                            <FormControl>
                              <Input
                                placeholder='e.g., Evening Shift Overtime - Q4 Surge'
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name='user_ids'
                        render={() => (
                          <FormItem>
                            <FormLabel>Select Employees *</FormLabel>
                            <div className='space-y-3'>
                              {/* Search */}
                              <div className='relative'>
                                <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                                <Input
                                  placeholder='Search employees...'
                                  value={userSearchQuery}
                                  onChange={(e) =>
                                    setUserSearchQuery(e.target.value)
                                  }
                                  className='pl-9'
                                />
                              </div>

                              {/* Selected Users */}
                              {watchUserIds.length > 0 && (
                                <div className='bg-muted/50 flex flex-wrap gap-2 rounded-lg p-2'>
                                  {watchUserIds.map((userId) => {
                                    const user = availableUsers.find(
                                      (u) => u.id === userId
                                    )
                                    return (
                                      <Badge
                                        key={userId}
                                        variant='secondary'
                                        className='flex items-center gap-1 pr-1'
                                      >
                                        {user?.full_name || 'Unknown'}
                                        <Button
                                          type='button'
                                          variant='ghost'
                                          size='icon'
                                          className='hover:bg-destructive hover:text-destructive-foreground h-4 w-4 rounded-full'
                                          onClick={() =>
                                            toggleUserSelection(userId)
                                          }
                                        >
                                          <X className='h-3 w-3' />
                                        </Button>
                                      </Badge>
                                    )
                                  })}
                                </div>
                              )}

                              {/* User List */}
                              <ScrollArea className='h-[200px] rounded-lg border'>
                                {isLoadingUsers ? (
                                  <div className='flex items-center justify-center py-8'>
                                    <Loader2 className='text-muted-foreground h-5 w-5 animate-spin' />
                                  </div>
                                ) : filteredUsers.length === 0 ? (
                                  <div className='text-muted-foreground flex flex-col items-center justify-center py-8'>
                                    <User className='mb-2 h-8 w-8 opacity-50' />
                                    <p className='text-sm'>
                                      No employees found
                                    </p>
                                  </div>
                                ) : (
                                  <div className='space-y-1 p-2'>
                                    {filteredUsers.map((user) => {
                                      const isSelected = watchUserIds.includes(
                                        user.id
                                      )
                                      return (
                                        <div
                                          key={user.id}
                                          className={cn(
                                            'flex cursor-pointer items-center justify-between rounded-lg p-2 transition-colors',
                                            isSelected
                                              ? 'bg-primary/10 border-primary/20 border'
                                              : 'hover:bg-muted'
                                          )}
                                          onClick={() =>
                                            toggleUserSelection(user.id)
                                          }
                                        >
                                          <div className='flex items-center gap-3'>
                                            <div className='bg-muted flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium'>
                                              {user.full_name
                                                .split(' ')
                                                .map((n) => n[0])
                                                .join('')
                                                .substring(0, 2)
                                                .toUpperCase()}
                                            </div>
                                            <div>
                                              <p className='text-sm font-medium'>
                                                {user.full_name}
                                              </p>
                                              <p className='text-muted-foreground text-xs'>
                                                {user.working_area_name ||
                                                  'No area assigned'}
                                              </p>
                                            </div>
                                          </div>
                                          {isSelected && (
                                            <Check className='text-primary h-4 w-4' />
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </ScrollArea>

                              <p className='text-muted-foreground text-xs'>
                                {watchUserIds.length} employee
                                {watchUserIds.length !== 1 ? 's' : ''} selected
                              </p>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Auto-approve Toggle */}
                      <FormField
                        control={form.control}
                        name='auto_approve'
                        render={({ field }) => (
                          <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                            <div className='space-y-0.5'>
                              <FormLabel className='text-base'>
                                Auto-Approve
                              </FormLabel>
                              <FormDescription>
                                Automatically approve overtime for all selected
                                employees
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  {/* Working Area (optional) */}
                  <FormField
                    control={form.control}
                    name='working_area_id'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Working Area (Optional)</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder='Any area' />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value='__any__'>Any Area</SelectItem>
                            {workingAreas.map((area) => (
                              <SelectItem key={area.id} value={area.id}>
                                {area.area_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Reason */}
                  <FormField
                    control={form.control}
                    name='reason'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reason (Optional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder='Why is overtime needed? e.g., High volume, urgent shipments...'
                            className='resize-none'
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Form Actions */}
                  <DialogFooter className='pt-4'>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={() => {
                        resetForm()
                        setActiveTab('requests')
                      }}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button type='submit' disabled={isSubmitting}>
                      {isSubmitting && (
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      )}
                      {watchScopeType === 'batch'
                        ? 'Create Batch Overtime'
                        : 'Create Overtime'}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </TabsContent>

            {/* Statistics Tab */}
            <TabsContent
              value='statistics'
              className='mt-4 flex-1 space-y-4 overflow-y-auto'
            >
              {isLoadingStats ? (
                <div className='flex items-center justify-center py-12'>
                  <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
                </div>
              ) : statistics ? (
                <>
                  <div className='text-muted-foreground mb-4 text-sm'>
                    Statistics for{' '}
                    {selectedDate
                      ? format(selectedDate, 'MMMM yyyy')
                      : 'this month'}
                  </div>

                  <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
                    <Card>
                      <CardHeader className='pb-2'>
                        <CardDescription>Total Requests</CardDescription>
                        <CardTitle className='text-2xl'>
                          {statistics.total_requests}
                        </CardTitle>
                      </CardHeader>
                    </Card>

                    <Card>
                      <CardHeader className='pb-2'>
                        <CardDescription>Pending</CardDescription>
                        <CardTitle className='text-2xl text-yellow-600'>
                          {statistics.pending_count}
                        </CardTitle>
                      </CardHeader>
                    </Card>

                    <Card>
                      <CardHeader className='pb-2'>
                        <CardDescription>Approved</CardDescription>
                        <CardTitle className='text-2xl text-green-600'>
                          {statistics.approved_count}
                        </CardTitle>
                      </CardHeader>
                    </Card>

                    <Card>
                      <CardHeader className='pb-2'>
                        <CardDescription>Denied</CardDescription>
                        <CardTitle className='text-2xl text-red-600'>
                          {statistics.rejected_count}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                  </div>

                  <div className='grid grid-cols-2 gap-4 md:grid-cols-3'>
                    <Card>
                      <CardHeader className='pb-2'>
                        <CardDescription>Total Overtime Hours</CardDescription>
                        <CardTitle className='text-xl'>
                          {formatOvertimeDuration(
                            statistics.total_overtime_minutes
                          )}
                        </CardTitle>
                      </CardHeader>
                    </Card>

                    <Card>
                      <CardHeader className='pb-2'>
                        <CardDescription>Approved Hours</CardDescription>
                        <CardTitle className='text-xl text-orange-600'>
                          {formatOvertimeDuration(
                            statistics.approved_overtime_minutes
                          )}
                        </CardTitle>
                      </CardHeader>
                    </Card>

                    <Card>
                      <CardHeader className='pb-2'>
                        <CardDescription>Unique Employees</CardDescription>
                        <CardTitle className='text-xl'>
                          {statistics.unique_employees}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                  </div>

                  {statistics.pending_count > 0 && (
                    <Alert className='border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30'>
                      <AlertTriangle className='h-4 w-4 text-yellow-600' />
                      <AlertDescription className='text-yellow-800 dark:text-yellow-200'>
                        You have <strong>{statistics.pending_count}</strong>{' '}
                        pending overtime request
                        {statistics.pending_count !== 1 ? 's' : ''} awaiting
                        approval.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : (
                <div className='text-muted-foreground flex flex-col items-center justify-center py-12'>
                  <TrendingUp className='mb-4 h-12 w-12 opacity-50' />
                  <p className='text-lg font-medium'>No statistics available</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </ResponsiveDialogBody>
      </ResponsiveDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteConfirmRequest}
        onOpenChange={() => setDeleteConfirmRequest(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Overtime Request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete the overtime request
              for{' '}
              {deleteConfirmRequest?.user_profile?.full_name || 'this employee'}
              ? This action cannot be undone.
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

      {/* Deny Confirmation Dialog */}
      <AlertDialog
        open={!!denyDialogRequest}
        onOpenChange={() => {
          setDenyDialogRequest(null)
          setDenyReason('')
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deny Overtime Request</AlertDialogTitle>
            <AlertDialogDescription>
              Deny the overtime request for{' '}
              {denyDialogRequest?.user_profile?.full_name || 'this employee'}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='py-4'>
            <label className='text-sm font-medium'>Reason (Optional)</label>
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
              Deny Request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default ManageOvertimeDialog

// Created and developed by Jai Singh
