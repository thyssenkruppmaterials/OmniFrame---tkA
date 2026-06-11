// Created and developed by Jai Singh
/**
 * Manage Events Dialog Component
 * Full CRUD management for timeline events (view, add, edit, delete)
 * Created: January 2, 2026
 */
import { useCallback, useEffect, useState } from 'react'
import * as z from 'zod'
import { format, parse, addDays } from 'date-fns'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Calendar as CalendarIcon,
  Edit2,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  Trash2,
  XCircle,
  User,
  Users,
  Check,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { WorkingArea } from '@/lib/supabase/labor-management.service'
import type {
  TimelineEventCategory,
  TimelineEventWithCategory,
  CreateTimelineEventInput,
  UpdateTimelineEventInput,
} from '@/lib/supabase/timeline-events.service'
import {
  createEvent,
  getEventCategories,
  getEmployeeEvents,
  getRecurringAreaEvents,
  getOneTimeTeamEvents,
  getAllEvents,
  getUsersForEventAssignment,
  getUserNamesByIds,
  updateEvent,
  deleteEvent,
  cancelEvent,
  initializeEventCategories,
  generateRecurringInstances,
} from '@/lib/supabase/timeline-events.service'
import type { UserForEventAssignment } from '@/lib/supabase/timeline-events.service'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

// Form schema for event
// Issue 1.7: Added shift_schedule_id for full 'shift' scope support
const eventSchema = z
  .object({
    event_name: z
      .string()
      .trim()
      .min(2, 'Event name must be at least 2 characters')
      .max(300),
    category_id: z.string().min(1, 'Please select an event type'),
    event_date: z.date({ message: 'Please select a date' }),
    start_time: z
      .string()
      .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
    end_time: z
      .string()
      .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
    scope_type: z.enum(['all', 'area', 'shift', 'user']).default('all'),
    working_area_id: z.string().optional(),
    shift_schedule_id: z.string().optional(), // Issue 1.7: Added for shift scope
    assigned_user_ids: z.array(z.string()).optional(),
    description: z.string().max(1000).optional(),
    location: z.string().max(200).optional(),
    is_recurring: z.boolean().default(false),
    recurrence_pattern: z.enum(['daily', 'weekly']).optional(),
    recurrence_days: z.array(z.number()).optional(),
    recurrence_end_date: z.date().optional(),
    is_mandatory: z.boolean().default(false),
  })
  .refine(
    (data) => {
      const start = parse(data.start_time, 'HH:mm', new Date())
      const end = parse(data.end_time, 'HH:mm', new Date())
      return end > start
    },
    {
      message: 'End time must be after start time',
      path: ['end_time'],
    }
  )
  .refine(
    (data) => {
      if (data.scope_type === 'area' && !data.working_area_id) {
        return false
      }
      return true
    },
    {
      message: 'Please select a working area',
      path: ['working_area_id'],
    }
  )
  .refine(
    (data) => {
      // Issue 1.7: Validate shift_schedule_id when shift scope is selected
      if (data.scope_type === 'shift' && !data.shift_schedule_id) {
        return false
      }
      return true
    },
    {
      message: 'Please select a shift schedule',
      path: ['shift_schedule_id'],
    }
  )
  .refine(
    (data) => {
      if (
        data.scope_type === 'user' &&
        (!data.assigned_user_ids || data.assigned_user_ids.length === 0)
      ) {
        return false
      }
      return true
    },
    {
      message: 'Please select at least one employee',
      path: ['assigned_user_ids'],
    }
  )
  .refine(
    (data) => {
      // Validate recurrence_days when weekly pattern is selected
      if (data.is_recurring && data.recurrence_pattern === 'weekly') {
        return data.recurrence_days && data.recurrence_days.length > 0
      }
      return true
    },
    {
      message: 'Please select at least one day for weekly recurrence',
      path: ['recurrence_days'],
    }
  )
  .refine(
    (data) => {
      // Validate recurrence_end_date is after event_date for recurring events
      if (data.is_recurring && data.recurrence_end_date && data.event_date) {
        return data.recurrence_end_date > data.event_date
      }
      return true
    },
    {
      message: 'Recurrence end date must be after event date',
      path: ['recurrence_end_date'],
    }
  )

type EventFormData = z.infer<typeof eventSchema>

// Day of week names
const DAYS_OF_WEEK = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]

// Common time presets
const TIME_PRESETS = [
  { start: '06:00', end: '06:30', label: 'Morning Huddle' },
  { start: '12:00', end: '12:30', label: 'Lunch Meeting' },
  { start: '14:30', end: '15:00', label: 'Shift Handover' },
]

// Issue 1.7: Add ShiftSchedule type for shift scope support
interface ShiftSchedule {
  id: string
  schedule_name: string
  shift_start_time: string
  shift_end_time: string
}

interface ManageEventsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  workingAreas?: WorkingArea[]
  shiftSchedules?: ShiftSchedule[] // Issue 1.7: Added for shift scope
  selectedDate?: Date
  onEventsChanged?: () => void
}

export function ManageEventsDialog({
  open,
  onOpenChange,
  organizationId,
  workingAreas = [],
  shiftSchedules = [], // Issue 1.7: Added for shift scope
  selectedDate,
  onEventsChanged,
}: ManageEventsDialogProps) {
  // State
  const [categories, setCategories] = useState<TimelineEventCategory[]>([])
  const [recurringAreaEvents, setRecurringAreaEvents] = useState<
    TimelineEventWithCategory[]
  >([])
  const [teamEvents, setTeamEvents] = useState<TimelineEventWithCategory[]>([])
  const [employeeEvents, setEmployeeEvents] = useState<
    TimelineEventWithCategory[]
  >([])
  const [allEvents, setAllEvents] = useState<TimelineEventWithCategory[]>([])
  const [availableUsers, setAvailableUsers] = useState<
    UserForEventAssignment[]
  >([])
  const [userNamesMap, setUserNamesMap] = useState<Map<string, string>>(
    new Map()
  )
  const [isLoadingCategories, setIsLoadingCategories] = useState(false)
  const [isLoadingRecurringAreaEvents, setIsLoadingRecurringAreaEvents] =
    useState(false)
  const [isLoadingTeamEvents, setIsLoadingTeamEvents] = useState(false)
  const [isLoadingEmployeeEvents, setIsLoadingEmployeeEvents] = useState(false)
  const [isLoadingAllEvents, setIsLoadingAllEvents] = useState(false)
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // View state
  const [activeTab, setActiveTab] = useState<
    'recurring-area' | 'team' | 'employee' | 'all' | 'add'
  >('recurring-area')
  const [editingEvent, setEditingEvent] =
    useState<TimelineEventWithCategory | null>(null)
  const [deleteConfirmEvent, setDeleteConfirmEvent] =
    useState<TimelineEventWithCategory | null>(null)

  // Filter state
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterStatus] = useState<string>('active')
  const [searchQuery, setSearchQuery] = useState('')
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('')
  const [userSearchQuery, setUserSearchQuery] = useState('')

  // Form
  const form = useForm<EventFormData>({
    resolver: zodResolver(eventSchema) as never,
    defaultValues: {
      event_name: '',
      category_id: '',
      event_date: selectedDate || new Date(),
      start_time: '08:00',
      end_time: '09:00',
      scope_type: 'all',
      working_area_id: undefined,
      shift_schedule_id: undefined, // Issue 1.7
      assigned_user_ids: [],
      description: '',
      location: '',
      is_recurring: false,
      recurrence_pattern: undefined,
      recurrence_days: [],
      recurrence_end_date: undefined,
      is_mandatory: false,
    },
  })

  // Load categories
  const loadCategories = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingCategories(true)
    try {
      let cats = await getEventCategories(organizationId, true)
      if (cats.length === 0) {
        await initializeEventCategories(organizationId)
        cats = await getEventCategories(organizationId, true)
      }
      setCategories(cats)
    } catch (error) {
      logger.error('Error loading categories:', error)
      toast.error('Failed to load event types')
    } finally {
      setIsLoadingCategories(false)
    }
  }, [organizationId])

  // Load recurring area events - recurring events for specific areas (excluding past)
  const loadRecurringAreaEvents = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingRecurringAreaEvents(true)
    try {
      const evts = await getRecurringAreaEvents(organizationId, {
        categoryId: filterCategory !== 'all' ? filterCategory : undefined,
        status:
          filterStatus === 'all'
            ? undefined
            : filterStatus === 'active'
              ? undefined
              : filterStatus,
        excludePast: true,
      })
      setRecurringAreaEvents(evts)
    } catch (error) {
      logger.error('Error loading recurring area events:', error)
      toast.error('Failed to load recurring area events')
    } finally {
      setIsLoadingRecurringAreaEvents(false)
    }
  }, [organizationId, filterCategory, filterStatus])

  // Load team events - one-time team events (excluding past and user-scoped)
  const loadTeamEvents = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingTeamEvents(true)
    try {
      const evts = await getOneTimeTeamEvents(organizationId, {
        categoryId: filterCategory !== 'all' ? filterCategory : undefined,
        status:
          filterStatus === 'all'
            ? undefined
            : filterStatus === 'active'
              ? undefined
              : filterStatus,
        excludePast: true,
      })
      setTeamEvents(evts)
    } catch (error) {
      logger.error('Error loading team events:', error)
      toast.error('Failed to load team events')
    } finally {
      setIsLoadingTeamEvents(false)
    }
  }, [organizationId, filterCategory, filterStatus])

  // Load all events - consolidated view (past and present)
  const loadAllEvents = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingAllEvents(true)
    try {
      const evts = await getAllEvents(organizationId, {
        categoryId: filterCategory !== 'all' ? filterCategory : undefined,
        includeAllStatuses: false,
      })
      setAllEvents(evts)
    } catch (error) {
      logger.error('Error loading all events:', error)
      toast.error('Failed to load events')
    } finally {
      setIsLoadingAllEvents(false)
    }
  }, [organizationId, filterCategory])

  // Load employee-specific events (excluding past)
  const loadEmployeeEvents = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingEmployeeEvents(true)
    try {
      const evts = await getEmployeeEvents(organizationId, {
        status:
          filterStatus === 'all'
            ? undefined
            : filterStatus === 'active'
              ? undefined
              : filterStatus,
        excludePast: true,
      })
      setEmployeeEvents(evts)

      // Collect all user IDs from employee events to fetch their names
      const allUserIds = new Set<string>()
      evts.forEach((evt) => {
        evt.assigned_user_ids?.forEach((id) => allUserIds.add(id))
      })

      if (allUserIds.size > 0) {
        const names = await getUserNamesByIds(Array.from(allUserIds))
        setUserNamesMap(names)
      }
    } catch (error) {
      logger.error('Error loading employee events:', error)
      toast.error('Failed to load employee events')
    } finally {
      setIsLoadingEmployeeEvents(false)
    }
  }, [organizationId, filterStatus])

  // Load available users for assignment (client-side filtering via filteredUsers)
  const loadUsers = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingUsers(true)
    try {
      const users = await getUsersForEventAssignment(organizationId, {
        limit: 200, // Load more users, filter client-side
      })
      setAvailableUsers(users)
    } catch (error) {
      logger.error('Error loading users:', error)
    } finally {
      setIsLoadingUsers(false)
    }
  }, [organizationId])

  // Initial load
  useEffect(() => {
    if (open) {
      loadCategories()
      loadRecurringAreaEvents()
      loadTeamEvents()
      loadEmployeeEvents()
      loadAllEvents()
      loadUsers()
      setActiveTab('recurring-area')
      setEditingEvent(null)
      resetForm()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetForm defined below; runs only on dialog open
  }, [
    open,
    loadCategories,
    loadRecurringAreaEvents,
    loadTeamEvents,
    loadEmployeeEvents,
    loadAllEvents,
    loadUsers,
  ])

  // Reload events when filters change
  useEffect(() => {
    if (open) {
      loadRecurringAreaEvents()
      loadTeamEvents()
      loadAllEvents()
    }
  }, [
    filterCategory,
    filterStatus,
    loadRecurringAreaEvents,
    loadTeamEvents,
    loadAllEvents,
    open,
  ])

  // Reset form
  const resetForm = () => {
    form.reset({
      event_name: '',
      category_id: '',
      event_date: selectedDate || new Date(),
      start_time: '08:00',
      end_time: '09:00',
      scope_type: 'all',
      working_area_id: undefined,
      shift_schedule_id: undefined, // Issue 1.7
      assigned_user_ids: [],
      description: '',
      location: '',
      is_recurring: false,
      recurrence_pattern: undefined,
      recurrence_days: [],
      recurrence_end_date: undefined,
      is_mandatory: false,
    })
    setEditingEvent(null)
  }

  // Start editing an event
  const handleEdit = (event: TimelineEventWithCategory) => {
    setEditingEvent(event)
    form.reset({
      event_name: event.event_name,
      category_id: event.category_id,
      event_date: new Date(event.event_date),
      start_time: event.start_time.substring(0, 5),
      end_time: event.end_time.substring(0, 5),
      scope_type: event.scope_type,
      working_area_id: event.working_area_id || undefined,
      shift_schedule_id:
        (event as unknown as Record<string, string>).shift_schedule_id ||
        undefined, // Issue 1.7
      assigned_user_ids: event.assigned_user_ids || [],
      description: event.description || '',
      location: event.location || '',
      is_recurring: event.is_recurring,
      recurrence_pattern: event.recurrence_pattern as
        | 'daily'
        | 'weekly'
        | undefined,
      recurrence_days: event.recurrence_days || [],
      recurrence_end_date: event.recurrence_end_date
        ? new Date(event.recurrence_end_date)
        : undefined,
      is_mandatory: event.is_mandatory,
    })
    setActiveTab('add')
  }

  // Delete an event
  const handleDelete = async () => {
    if (!deleteConfirmEvent) return

    try {
      await deleteEvent(deleteConfirmEvent.id)
      toast.success('Event deleted successfully')
      setDeleteConfirmEvent(null)
      loadRecurringAreaEvents()
      loadTeamEvents()
      loadEmployeeEvents()
      loadAllEvents()
      onEventsChanged?.()
    } catch (error) {
      logger.error('Error deleting event:', error)
      toast.error('Failed to delete event')
    }
  }

  // Cancel an event (soft delete)
  const handleCancel = async (event: TimelineEventWithCategory) => {
    try {
      await cancelEvent(event.id)
      toast.success('Event cancelled')
      loadRecurringAreaEvents()
      loadTeamEvents()
      loadEmployeeEvents()
      loadAllEvents()
      onEventsChanged?.()
    } catch (error) {
      logger.error('Error cancelling event:', error)
      toast.error('Failed to cancel event')
    }
  }

  // Handle form submission
  const onSubmit = async (data: EventFormData) => {
    setIsSubmitting(true)
    try {
      if (editingEvent) {
        // Update existing event
        const updateInput: UpdateTimelineEventInput = {
          event_name: data.event_name,
          category_id: data.category_id,
          event_date: format(data.event_date, 'yyyy-MM-dd'),
          start_time: data.start_time,
          end_time: data.end_time,
          scope_type: data.scope_type,
          working_area_id:
            data.scope_type === 'area' ? data.working_area_id : null,
          shift_schedule_id:
            data.scope_type === 'shift' ? data.shift_schedule_id : null, // Issue 1.7
          assigned_user_ids:
            data.scope_type === 'user' ? data.assigned_user_ids : null,
          description: data.description || null,
          location: data.location || null,
          is_mandatory: data.is_mandatory,
        }

        await updateEvent(editingEvent.id, updateInput)
        toast.success('Event updated successfully')
      } else {
        // Create new event
        const createInput: CreateTimelineEventInput = {
          event_name: data.event_name,
          category_id: data.category_id,
          event_date: format(data.event_date, 'yyyy-MM-dd'),
          start_time: data.start_time,
          end_time: data.end_time,
          scope_type: data.scope_type,
          working_area_id:
            data.scope_type === 'area' ? data.working_area_id : undefined,
          shift_schedule_id:
            data.scope_type === 'shift' ? data.shift_schedule_id : undefined, // Issue 1.7
          assigned_user_ids:
            data.scope_type === 'user' ? data.assigned_user_ids : undefined,
          description: data.description || undefined,
          location: data.location || undefined,
          is_recurring: data.is_recurring,
          recurrence_pattern: data.is_recurring
            ? data.recurrence_pattern
            : undefined,
          recurrence_days:
            data.is_recurring && data.recurrence_pattern === 'weekly'
              ? data.recurrence_days
              : undefined,
          recurrence_end_date:
            data.is_recurring && data.recurrence_end_date
              ? format(data.recurrence_end_date, 'yyyy-MM-dd')
              : undefined,
          is_mandatory: data.is_mandatory,
        }

        const newEvent = await createEvent(organizationId, createInput)

        // If this is a recurring event, generate all instances
        // Issue 1.6: Added proper error handling for recurring instance generation
        if (data.is_recurring && newEvent?.id) {
          const endDateStr = data.recurrence_end_date
            ? format(data.recurrence_end_date, 'yyyy-MM-dd')
            : undefined
          try {
            const instanceCount = await generateRecurringInstances(
              newEvent.id,
              endDateStr
            )
            toast.success(`Event created with ${instanceCount + 1} occurrences`)
          } catch (recurringError) {
            // Parent event was created but recurring instances failed
            // Show a warning but don't fail completely - user can still see the parent event
            logger.error(
              'Failed to generate recurring instances:',
              recurringError
            )
            toast.warning(
              'Event created but recurring instances failed to generate. Please check the event and try regenerating instances.',
              { duration: 6000 }
            )
          }
        } else {
          toast.success('Event created successfully')
        }

        // Reload events after creation - use Promise.all to avoid race conditions
        await Promise.all([
          loadRecurringAreaEvents().catch((e) =>
            logger.error('Error loading recurring area events:', e)
          ),
          loadTeamEvents().catch((e) =>
            logger.error('Error loading team events:', e)
          ),
          loadEmployeeEvents().catch((e) =>
            logger.error('Error loading employee events:', e)
          ),
          loadAllEvents().catch((e) =>
            logger.error('Error loading all events:', e)
          ),
        ])
      }

      resetForm()
      // Go back to appropriate tab based on event scope and type
      if (data.scope_type === 'user') {
        setActiveTab('employee')
      } else if (data.scope_type === 'area' && data.is_recurring) {
        setActiveTab('recurring-area')
      } else {
        setActiveTab('team')
      }
      onEventsChanged?.()
    } catch (error) {
      logger.error('Error saving event:', error)
      toast.error(
        editingEvent ? 'Failed to update event' : 'Failed to create event'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  // Apply time preset
  const handleTimePreset = (preset: (typeof TIME_PRESETS)[0]) => {
    form.setValue('start_time', preset.start)
    form.setValue('end_time', preset.end)
  }

  // Filter recurring area events by search query
  const filteredRecurringAreaEvents = recurringAreaEvents.filter((event) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      event.event_name.toLowerCase().includes(query) ||
      event.category?.category_name.toLowerCase().includes(query) ||
      event.location?.toLowerCase().includes(query) ||
      event.description?.toLowerCase().includes(query)
    )
  })

  // Filter team events by search query
  const filteredTeamEvents = teamEvents.filter((event) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      event.event_name.toLowerCase().includes(query) ||
      event.category?.category_name.toLowerCase().includes(query) ||
      event.location?.toLowerCase().includes(query) ||
      event.description?.toLowerCase().includes(query)
    )
  })

  // Filter employee events by search query
  const filteredEmployeeEvents = employeeEvents.filter((event) => {
    if (!employeeSearchQuery) return true
    const query = employeeSearchQuery.toLowerCase()
    // Also search by assigned user names
    const assignedNames =
      event.assigned_user_ids?.map(
        (id) => userNamesMap.get(id)?.toLowerCase() || ''
      ) || []
    return (
      event.event_name.toLowerCase().includes(query) ||
      event.category?.category_name.toLowerCase().includes(query) ||
      event.location?.toLowerCase().includes(query) ||
      event.description?.toLowerCase().includes(query) ||
      assignedNames.some((name) => name.includes(query))
    )
  })

  // Filter all events by search query
  const filteredAllEvents = allEvents.filter((event) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      event.event_name.toLowerCase().includes(query) ||
      event.category?.category_name.toLowerCase().includes(query) ||
      event.location?.toLowerCase().includes(query) ||
      event.description?.toLowerCase().includes(query)
    )
  })

  // Filter available users by search query
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
  const watchIsRecurring = form.watch('is_recurring')
  const watchRecurrencePattern = form.watch('recurrence_pattern')
  const watchCategoryId = form.watch('category_id')
  const watchAssignedUserIds = form.watch('assigned_user_ids') || []
  const selectedCategory = categories.find((c) => c.id === watchCategoryId)

  // Toggle user selection
  const toggleUserSelection = (userId: string) => {
    const current = form.getValues('assigned_user_ids') || []
    if (current.includes(userId)) {
      form.setValue(
        'assigned_user_ids',
        current.filter((id) => id !== userId)
      )
    } else {
      form.setValue('assigned_user_ids', [...current, userId])
    }
  }

  // Status badge helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'scheduled':
        return <Badge variant='secondary'>Scheduled</Badge>
      case 'in_progress':
        return (
          <Badge variant='default' className='bg-blue-500'>
            In Progress
          </Badge>
        )
      case 'completed':
        return (
          <Badge variant='default' className='bg-green-500'>
            Completed
          </Badge>
        )
      case 'cancelled':
        return <Badge variant='destructive'>Cancelled</Badge>
      default:
        return <Badge variant='outline'>{status}</Badge>
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='flex max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] flex-col overflow-y-auto'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <Settings className='text-primary h-5 w-5' />
              Manage Timeline Events
            </DialogTitle>
            <DialogDescription>
              View, create, edit, and delete timeline events for your team.
            </DialogDescription>
          </DialogHeader>

          {isLoadingCategories ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
            </div>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(
                  v as 'recurring-area' | 'team' | 'employee' | 'all' | 'add'
                )
                if (v === 'add' && !editingEvent) resetForm()
              }}
              className='flex min-h-0 flex-1 flex-col'
            >
              <TabsList className='grid w-full grid-cols-5'>
                <TabsTrigger
                  value='recurring-area'
                  className='flex items-center gap-2'
                >
                  <Repeat className='h-4 w-4' />
                  <span className='hidden sm:inline'>Recurring Area</span>
                  <span className='sm:hidden'>Area</span>
                  {recurringAreaEvents.length > 0 && (
                    <Badge variant='secondary' className='ml-1 text-xs'>
                      {recurringAreaEvents.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value='team' className='flex items-center gap-2'>
                  <Users className='h-4 w-4' />
                  <span className='hidden sm:inline'>Team Meetings</span>
                  <span className='sm:hidden'>Team</span>
                  {teamEvents.length > 0 && (
                    <Badge variant='secondary' className='ml-1 text-xs'>
                      {teamEvents.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value='employee'
                  className='flex items-center gap-2'
                >
                  <User className='h-4 w-4' />
                  <span className='hidden sm:inline'>Employee Events</span>
                  <span className='sm:hidden'>Employee</span>
                  {employeeEvents.length > 0 && (
                    <Badge variant='secondary' className='ml-1 text-xs'>
                      {employeeEvents.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value='all' className='flex items-center gap-2'>
                  <CalendarIcon className='h-4 w-4' />
                  <span className='hidden sm:inline'>All Events</span>
                  <span className='sm:hidden'>All</span>
                  {allEvents.length > 0 && (
                    <Badge variant='secondary' className='ml-1 text-xs'>
                      {allEvents.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value='add' className='flex items-center gap-2'>
                  {editingEvent ? (
                    <Edit2 className='h-4 w-4' />
                  ) : (
                    <Plus className='h-4 w-4' />
                  )}
                  {editingEvent ? 'Edit' : 'Add'}
                </TabsTrigger>
              </TabsList>

              {/* Recurring Area Meetings Tab */}
              <TabsContent
                value='recurring-area'
                className='mt-4 flex min-h-0 flex-1 flex-col space-y-4'
              >
                {/* Filters */}
                <div className='flex flex-wrap items-center gap-3'>
                  {/* Category Filter */}
                  <Select
                    value={filterCategory}
                    onValueChange={setFilterCategory}
                  >
                    <SelectTrigger className='w-[160px]'>
                      <Filter className='mr-2 h-4 w-4' />
                      <SelectValue placeholder='All Types' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>All Types</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <div className='flex items-center gap-2'>
                            <div
                              className='h-3 w-3 rounded-full'
                              style={{ backgroundColor: cat.color }}
                            />
                            {cat.category_name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Search */}
                  <div className='relative min-w-[200px] flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                    <Input
                      placeholder='Search recurring area meetings...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className='pl-9'
                    />
                  </div>

                  {/* Refresh */}
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={loadRecurringAreaEvents}
                    disabled={isLoadingRecurringAreaEvents}
                  >
                    <RefreshCw
                      className={cn(
                        'h-4 w-4',
                        isLoadingRecurringAreaEvents && 'animate-spin'
                      )}
                    />
                  </Button>

                  {/* Add New Button */}
                  <Button
                    onClick={() => {
                      resetForm()
                      form.setValue('scope_type', 'area')
                      form.setValue('is_recurring', true)
                      setActiveTab('add')
                    }}
                  >
                    <Plus className='mr-2 h-4 w-4' />
                    Add Recurring Area Meeting
                  </Button>
                </div>

                {/* Info Banner */}
                <Alert className='bg-muted/50'>
                  <Repeat className='h-4 w-4' />
                  <AlertDescription>
                    Recurring area meetings are applied to specific working
                    areas and repeat on a schedule. Past events are hidden.
                  </AlertDescription>
                </Alert>

                {/* Events Table */}
                <ScrollArea className='flex-1 rounded-lg border'>
                  {isLoadingRecurringAreaEvents ? (
                    <div className='flex items-center justify-center py-12'>
                      <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
                    </div>
                  ) : filteredRecurringAreaEvents.length === 0 ? (
                    <div className='text-muted-foreground flex flex-col items-center justify-center py-12'>
                      <Repeat className='mb-4 h-12 w-12 opacity-50' />
                      <p className='text-lg font-medium'>
                        No recurring area meetings
                      </p>
                      <p className='text-sm'>
                        Create recurring meetings for specific working areas
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-[200px]'>Meeting</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Start Date</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Recurrence</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className='text-right'>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRecurringAreaEvents.map((event) => (
                          <TableRow key={event.id}>
                            <TableCell>
                              <div className='flex items-center gap-2'>
                                <div
                                  className='h-3 w-3 flex-shrink-0 rounded-full'
                                  style={{
                                    backgroundColor:
                                      event.category?.color || '#6B7280',
                                  }}
                                />
                                <span className='max-w-[150px] truncate font-medium'>
                                  {event.event_name}
                                </span>
                                <Repeat className='text-primary h-3 w-3' />
                                {event.is_mandatory && (
                                  <Badge
                                    variant='outline'
                                    className='px-1 text-[10px]'
                                  >
                                    Required
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className='text-muted-foreground text-sm'>
                                {event.category?.category_name || 'Custom'}
                              </span>
                            </TableCell>
                            <TableCell>
                              {format(
                                new Date(event.event_date),
                                'MMM d, yyyy'
                              )}
                            </TableCell>
                            <TableCell>
                              <span className='text-sm'>
                                {event.start_time.substring(0, 5)} -{' '}
                                {event.end_time.substring(0, 5)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant='secondary' className='capitalize'>
                                {event.recurrence_pattern || 'Custom'}
                                {event.recurrence_end_date && (
                                  <span className='text-muted-foreground ml-1'>
                                    →{' '}
                                    {format(
                                      new Date(event.recurrence_end_date),
                                      'MMM d'
                                    )}
                                  </span>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(event.status)}
                            </TableCell>
                            <TableCell className='text-right'>
                              <div className='flex items-center justify-end gap-1'>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  onClick={() => handleEdit(event)}
                                  disabled={event.status === 'cancelled'}
                                >
                                  <Edit2 className='h-4 w-4' />
                                </Button>
                                {event.status !== 'cancelled' && (
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={() => handleCancel(event)}
                                  >
                                    <XCircle className='h-4 w-4 text-amber-500' />
                                  </Button>
                                )}
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  onClick={() => setDeleteConfirmEvent(event)}
                                >
                                  <Trash2 className='text-destructive h-4 w-4' />
                                </Button>
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
                  Showing {filteredRecurringAreaEvents.length} of{' '}
                  {recurringAreaEvents.length} recurring area meetings (upcoming
                  only)
                </div>
              </TabsContent>

              {/* Team Meetings Tab (One-time events) */}
              <TabsContent
                value='team'
                className='mt-4 flex min-h-0 flex-1 flex-col space-y-4'
              >
                {/* Filters */}
                <div className='flex flex-wrap items-center gap-3'>
                  {/* Category Filter */}
                  <Select
                    value={filterCategory}
                    onValueChange={setFilterCategory}
                  >
                    <SelectTrigger className='w-[160px]'>
                      <Filter className='mr-2 h-4 w-4' />
                      <SelectValue placeholder='All Types' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>All Types</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <div className='flex items-center gap-2'>
                            <div
                              className='h-3 w-3 rounded-full'
                              style={{ backgroundColor: cat.color }}
                            />
                            {cat.category_name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Search */}
                  <div className='relative min-w-[200px] flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                    <Input
                      placeholder='Search team meetings...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className='pl-9'
                    />
                  </div>

                  {/* Refresh */}
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={loadTeamEvents}
                    disabled={isLoadingTeamEvents}
                  >
                    <RefreshCw
                      className={cn(
                        'h-4 w-4',
                        isLoadingTeamEvents && 'animate-spin'
                      )}
                    />
                  </Button>

                  {/* Add New Button */}
                  <Button
                    onClick={() => {
                      resetForm()
                      setActiveTab('add')
                    }}
                  >
                    <Plus className='mr-2 h-4 w-4' />
                    Add Team Meeting
                  </Button>
                </div>

                {/* Info Banner */}
                <Alert className='bg-muted/50'>
                  <Users className='h-4 w-4' />
                  <AlertDescription>
                    One-time team meetings and events. For recurring meetings,
                    use the Recurring Area tab. Past events are hidden.
                  </AlertDescription>
                </Alert>

                {/* Events Table */}
                <ScrollArea className='flex-1 rounded-lg border'>
                  {isLoadingTeamEvents ? (
                    <div className='flex items-center justify-center py-12'>
                      <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
                    </div>
                  ) : filteredTeamEvents.length === 0 ? (
                    <div className='text-muted-foreground flex flex-col items-center justify-center py-12'>
                      <Users className='mb-4 h-12 w-12 opacity-50' />
                      <p className='text-lg font-medium'>
                        No upcoming team meetings
                      </p>
                      <p className='text-sm'>
                        Create a one-time team meeting to get started
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-[200px]'>Event</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Scope</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className='text-right'>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTeamEvents.map((event) => (
                          <TableRow key={event.id}>
                            <TableCell>
                              <div className='flex items-center gap-2'>
                                <div
                                  className='h-3 w-3 flex-shrink-0 rounded-full'
                                  style={{
                                    backgroundColor:
                                      event.category?.color || '#6B7280',
                                  }}
                                />
                                <span className='max-w-[150px] truncate font-medium'>
                                  {event.event_name}
                                </span>
                                {event.is_mandatory && (
                                  <Badge
                                    variant='outline'
                                    className='px-1 text-[10px]'
                                  >
                                    Required
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className='text-muted-foreground text-sm'>
                                {event.category?.category_name || 'Custom'}
                              </span>
                            </TableCell>
                            <TableCell>
                              {format(
                                new Date(event.event_date),
                                'MMM d, yyyy'
                              )}
                            </TableCell>
                            <TableCell>
                              <span className='text-sm'>
                                {event.start_time.substring(0, 5)} -{' '}
                                {event.end_time.substring(0, 5)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant='outline' className='capitalize'>
                                {event.scope_type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(event.status)}
                            </TableCell>
                            <TableCell className='text-right'>
                              <div className='flex items-center justify-end gap-1'>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  onClick={() => handleEdit(event)}
                                  disabled={event.status === 'cancelled'}
                                >
                                  <Edit2 className='h-4 w-4' />
                                </Button>
                                {event.status !== 'cancelled' && (
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={() => handleCancel(event)}
                                  >
                                    <XCircle className='h-4 w-4 text-amber-500' />
                                  </Button>
                                )}
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  onClick={() => setDeleteConfirmEvent(event)}
                                >
                                  <Trash2 className='text-destructive h-4 w-4' />
                                </Button>
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
                  Showing {filteredTeamEvents.length} of {teamEvents.length}{' '}
                  upcoming team meetings
                </div>
              </TabsContent>

              {/* Employee Events Tab */}
              <TabsContent
                value='employee'
                className='mt-4 flex min-h-0 flex-1 flex-col space-y-4'
              >
                {/* Header & Filters */}
                <div className='flex flex-wrap items-center gap-3'>
                  {/* Search */}
                  <div className='relative min-w-[200px] flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                    <Input
                      placeholder='Search by event or employee name...'
                      value={employeeSearchQuery}
                      onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                      className='pl-9'
                    />
                  </div>

                  {/* Refresh */}
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={loadEmployeeEvents}
                    disabled={isLoadingEmployeeEvents}
                  >
                    <RefreshCw
                      className={cn(
                        'h-4 w-4',
                        isLoadingEmployeeEvents && 'animate-spin'
                      )}
                    />
                  </Button>

                  {/* Add New Employee Event */}
                  <Button
                    onClick={() => {
                      resetForm()
                      form.setValue('scope_type', 'user')
                      setActiveTab('add')
                    }}
                  >
                    <Plus className='mr-2 h-4 w-4' />
                    Add Employee Event
                  </Button>
                </div>

                {/* Employee Events Table */}
                <ScrollArea className='flex-1 rounded-lg border'>
                  {isLoadingEmployeeEvents ? (
                    <div className='flex items-center justify-center py-12'>
                      <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
                    </div>
                  ) : filteredEmployeeEvents.length === 0 ? (
                    <div className='text-muted-foreground flex flex-col items-center justify-center py-12'>
                      <User className='mb-4 h-12 w-12 opacity-50' />
                      <p className='text-lg font-medium'>
                        No employee events found
                      </p>
                      <p className='text-sm'>
                        Create events for specific employees
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-[200px]'>Event</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead className='w-[250px]'>
                            Assigned Employees
                          </TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className='text-right'>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredEmployeeEvents.map((event) => (
                          <TableRow key={event.id}>
                            <TableCell>
                              <div className='flex items-center gap-2'>
                                <div
                                  className='h-3 w-3 flex-shrink-0 rounded-full'
                                  style={{
                                    backgroundColor:
                                      event.category?.color || '#6B7280',
                                  }}
                                />
                                <span className='max-w-[150px] truncate font-medium'>
                                  {event.event_name}
                                </span>
                                {event.is_recurring && (
                                  <Repeat className='text-muted-foreground h-3 w-3' />
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className='text-muted-foreground text-sm'>
                                {event.category?.category_name || 'Custom'}
                              </span>
                            </TableCell>
                            <TableCell>
                              {format(
                                new Date(event.event_date),
                                'MMM d, yyyy'
                              )}
                            </TableCell>
                            <TableCell>
                              <span className='text-sm'>
                                {event.start_time.substring(0, 5)} -{' '}
                                {event.end_time.substring(0, 5)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className='flex flex-wrap gap-1'>
                                {event.assigned_user_ids
                                  ?.slice(0, 3)
                                  .map((userId) => (
                                    <Badge
                                      key={userId}
                                      variant='secondary'
                                      className='text-xs'
                                    >
                                      {userNamesMap.get(userId) || 'Unknown'}
                                    </Badge>
                                  ))}
                                {(event.assigned_user_ids?.length || 0) > 3 && (
                                  <Badge variant='outline' className='text-xs'>
                                    +
                                    {(event.assigned_user_ids?.length || 0) - 3}{' '}
                                    more
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(event.status)}
                            </TableCell>
                            <TableCell className='text-right'>
                              <div className='flex items-center justify-end gap-1'>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  onClick={() => handleEdit(event)}
                                  disabled={event.status === 'cancelled'}
                                >
                                  <Edit2 className='h-4 w-4' />
                                </Button>
                                {event.status !== 'cancelled' && (
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={() => handleCancel(event)}
                                  >
                                    <XCircle className='h-4 w-4 text-amber-500' />
                                  </Button>
                                )}
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  onClick={() => setDeleteConfirmEvent(event)}
                                >
                                  <Trash2 className='text-destructive h-4 w-4' />
                                </Button>
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
                  Showing {filteredEmployeeEvents.length} of{' '}
                  {employeeEvents.length} upcoming employee events
                </div>
              </TabsContent>

              {/* All Events Tab (Consolidated view - past and present) */}
              <TabsContent
                value='all'
                className='mt-4 flex min-h-0 flex-1 flex-col space-y-4'
              >
                {/* Filters */}
                <div className='flex flex-wrap items-center gap-3'>
                  {/* Category Filter */}
                  <Select
                    value={filterCategory}
                    onValueChange={setFilterCategory}
                  >
                    <SelectTrigger className='w-[160px]'>
                      <Filter className='mr-2 h-4 w-4' />
                      <SelectValue placeholder='All Types' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>All Types</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <div className='flex items-center gap-2'>
                            <div
                              className='h-3 w-3 rounded-full'
                              style={{ backgroundColor: cat.color }}
                            />
                            {cat.category_name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Search */}
                  <div className='relative min-w-[200px] flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                    <Input
                      placeholder='Search all events...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className='pl-9'
                    />
                  </div>

                  {/* Refresh */}
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={loadAllEvents}
                    disabled={isLoadingAllEvents}
                  >
                    <RefreshCw
                      className={cn(
                        'h-4 w-4',
                        isLoadingAllEvents && 'animate-spin'
                      )}
                    />
                  </Button>

                  {/* Add New Button */}
                  <Button
                    onClick={() => {
                      resetForm()
                      setActiveTab('add')
                    }}
                  >
                    <Plus className='mr-2 h-4 w-4' />
                    Add Event
                  </Button>
                </div>

                {/* Info Banner */}
                <Alert className='bg-muted/50'>
                  <CalendarIcon className='h-4 w-4' />
                  <AlertDescription>
                    Consolidated view of all events including past and current.
                    Use other tabs for filtered views.
                  </AlertDescription>
                </Alert>

                {/* Events Table */}
                <ScrollArea className='flex-1 rounded-lg border'>
                  {isLoadingAllEvents ? (
                    <div className='flex items-center justify-center py-12'>
                      <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
                    </div>
                  ) : filteredAllEvents.length === 0 ? (
                    <div className='text-muted-foreground flex flex-col items-center justify-center py-12'>
                      <CalendarIcon className='mb-4 h-12 w-12 opacity-50' />
                      <p className='text-lg font-medium'>No events found</p>
                      <p className='text-sm'>
                        Create a new event to get started
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-[200px]'>Event</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Scope</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className='text-right'>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAllEvents.map((event) => {
                          const eventDate = new Date(event.event_date)
                          const today = new Date()
                          today.setHours(0, 0, 0, 0)
                          const isPast = eventDate < today

                          return (
                            <TableRow
                              key={event.id}
                              className={cn(isPast && 'opacity-60')}
                            >
                              <TableCell>
                                <div className='flex items-center gap-2'>
                                  <div
                                    className='h-3 w-3 flex-shrink-0 rounded-full'
                                    style={{
                                      backgroundColor:
                                        event.category?.color || '#6B7280',
                                    }}
                                  />
                                  <span className='max-w-[150px] truncate font-medium'>
                                    {event.event_name}
                                  </span>
                                  {event.is_recurring && (
                                    <Repeat className='text-muted-foreground h-3 w-3' />
                                  )}
                                  {event.is_mandatory && (
                                    <Badge
                                      variant='outline'
                                      className='px-1 text-[10px]'
                                    >
                                      Required
                                    </Badge>
                                  )}
                                  {isPast && (
                                    <Badge
                                      variant='secondary'
                                      className='px-1 text-[10px]'
                                    >
                                      Past
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className='text-muted-foreground text-sm'>
                                  {event.category?.category_name || 'Custom'}
                                </span>
                              </TableCell>
                              <TableCell>
                                {format(
                                  new Date(event.event_date),
                                  'MMM d, yyyy'
                                )}
                              </TableCell>
                              <TableCell>
                                <span className='text-sm'>
                                  {event.start_time.substring(0, 5)} -{' '}
                                  {event.end_time.substring(0, 5)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Badge variant='outline' className='capitalize'>
                                  {event.scope_type}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {getStatusBadge(event.status)}
                              </TableCell>
                              <TableCell className='text-right'>
                                <div className='flex items-center justify-end gap-1'>
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={() => handleEdit(event)}
                                    disabled={event.status === 'cancelled'}
                                  >
                                    <Edit2 className='h-4 w-4' />
                                  </Button>
                                  {event.status !== 'cancelled' && !isPast && (
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      onClick={() => handleCancel(event)}
                                    >
                                      <XCircle className='h-4 w-4 text-amber-500' />
                                    </Button>
                                  )}
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={() => setDeleteConfirmEvent(event)}
                                  >
                                    <Trash2 className='text-destructive h-4 w-4' />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>

                {/* Summary */}
                <div className='text-muted-foreground text-sm'>
                  Showing {filteredAllEvents.length} of {allEvents.length} total
                  events (past and present)
                </div>
              </TabsContent>

              {/* Add/Edit Event Tab */}
              <TabsContent value='add' className='mt-4 flex-1 overflow-y-auto'>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className='space-y-5'
                  >
                    {editingEvent && (
                      <Alert>
                        <Edit2 className='h-4 w-4' />
                        <AlertDescription>
                          Editing: <strong>{editingEvent.event_name}</strong>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='ml-2'
                            onClick={() => {
                              resetForm()
                              setActiveTab('all')
                            }}
                          >
                            Cancel Edit
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Event Type Selection */}
                    <FormField
                      control={form.control}
                      name='category_id'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Event Type *</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder='Select event type' />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories.map((category) => (
                                <SelectItem
                                  key={category.id}
                                  value={category.id}
                                >
                                  <div className='flex items-center gap-2'>
                                    <div
                                      className='h-3 w-3 rounded-full'
                                      style={{
                                        backgroundColor: category.color,
                                      }}
                                    />
                                    {category.category_name}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Event Name */}
                    <FormField
                      control={form.control}
                      name='event_name'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Event Name *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder='e.g., Morning Team Huddle'
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Date and Time */}
                    <div className='grid grid-cols-3 gap-4'>
                      <FormField
                        control={form.control}
                        name='event_date'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date *</FormLabel>
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
                              <PopoverContent
                                className='w-auto p-0'
                                align='start'
                              >
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

                      <FormField
                        control={form.control}
                        name='start_time'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Start Time *</FormLabel>
                            <FormControl>
                              <Input type='time' {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name='end_time'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>End Time *</FormLabel>
                            <FormControl>
                              <Input type='time' {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Time Presets */}
                    <div className='flex flex-wrap gap-2'>
                      <span className='text-muted-foreground mr-2 self-center text-xs'>
                        Quick:
                      </span>
                      {TIME_PRESETS.map((preset, idx) => (
                        <Button
                          key={idx}
                          type='button'
                          variant='outline'
                          size='sm'
                          className='text-xs'
                          onClick={() => handleTimePreset(preset)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>

                    {/* Scope Selection */}
                    <FormField
                      control={form.control}
                      name='scope_type'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Event Scope</FormLabel>
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
                              <SelectItem value='all'>
                                <div className='flex items-center gap-2'>
                                  <Users className='h-4 w-4' />
                                  All Associates
                                </div>
                              </SelectItem>
                              <SelectItem value='area'>
                                <div className='flex items-center gap-2'>
                                  <CalendarIcon className='h-4 w-4' />
                                  Specific Area
                                </div>
                              </SelectItem>
                              <SelectItem value='user'>
                                <div className='flex items-center gap-2'>
                                  <User className='h-4 w-4' />
                                  Specific Employees
                                </div>
                              </SelectItem>
                              <SelectItem value='shift'>
                                <div className='flex items-center gap-2'>
                                  <CalendarIcon className='h-4 w-4' />
                                  Current Shift
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Who should see this event on their timeline
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Working Area Selection (conditional) */}
                    {watchScopeType === 'area' && (
                      <FormField
                        control={form.control}
                        name='working_area_id'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Working Area *</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder='Select area' />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
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
                    )}

                    {/* Issue 1.7: Shift Schedule Selection (conditional) */}
                    {watchScopeType === 'shift' && (
                      <FormField
                        control={form.control}
                        name='shift_schedule_id'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Shift Schedule *</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder='Select shift schedule' />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {shiftSchedules.length === 0 ? (
                                  <SelectItem value='none' disabled>
                                    No shift schedules available
                                  </SelectItem>
                                ) : (
                                  shiftSchedules.map((schedule) => (
                                    <SelectItem
                                      key={schedule.id}
                                      value={schedule.id}
                                    >
                                      {schedule.schedule_name} (
                                      {schedule.shift_start_time} -{' '}
                                      {schedule.shift_end_time})
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            <FormDescription>
                              Event will appear for all employees assigned to
                              this shift
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {/* Employee Selection (conditional) */}
                    {watchScopeType === 'user' && (
                      <FormField
                        control={form.control}
                        name='assigned_user_ids'
                        render={() => (
                          <FormItem>
                            <FormLabel>Select Employees *</FormLabel>
                            <div className='space-y-3'>
                              {/* Search */}
                              <div
                                className='relative'
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                                <Input
                                  placeholder='Search employees...'
                                  value={userSearchQuery}
                                  onChange={(e) =>
                                    setUserSearchQuery(e.target.value)
                                  }
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                  className='pl-9'
                                />
                              </div>

                              {/* Selected Users */}
                              {watchAssignedUserIds.length > 0 && (
                                <div className='bg-muted/50 flex flex-wrap gap-2 rounded-lg p-2'>
                                  {watchAssignedUserIds.map((userId) => {
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
                                      const isSelected =
                                        watchAssignedUserIds.includes(user.id)
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
                                {watchAssignedUserIds.length} employee
                                {watchAssignedUserIds.length !== 1
                                  ? 's'
                                  : ''}{' '}
                                selected
                              </p>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {/* Recurring Event Toggle - only show for new events */}
                    {!editingEvent && (
                      <>
                        <FormField
                          control={form.control}
                          name='is_recurring'
                          render={({ field }) => (
                            <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                              <div className='space-y-0.5'>
                                <FormLabel className='text-base'>
                                  Recurring Event
                                </FormLabel>
                                <FormDescription>
                                  Repeat this event on multiple days
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

                        {/* Recurring Settings (conditional) */}
                        {watchIsRecurring && (
                          <div className='border-primary/20 space-y-4 border-l-2 pl-4'>
                            <FormField
                              control={form.control}
                              name='recurrence_pattern'
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Repeat Pattern</FormLabel>
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder='Select pattern' />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value='daily'>
                                        Daily
                                      </SelectItem>
                                      <SelectItem value='weekly'>
                                        Weekly on specific days
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            {watchRecurrencePattern === 'weekly' && (
                              <FormField
                                control={form.control}
                                name='recurrence_days'
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Repeat on Days</FormLabel>
                                    <div className='flex gap-2'>
                                      {DAYS_OF_WEEK.map((day) => (
                                        <Button
                                          key={day.value}
                                          type='button'
                                          variant={
                                            field.value?.includes(day.value)
                                              ? 'default'
                                              : 'outline'
                                          }
                                          size='sm'
                                          className='w-10'
                                          onClick={() => {
                                            const current = field.value || []
                                            if (current.includes(day.value)) {
                                              field.onChange(
                                                current.filter(
                                                  (d) => d !== day.value
                                                )
                                              )
                                            } else {
                                              field.onChange([
                                                ...current,
                                                day.value,
                                              ])
                                            }
                                          }}
                                        >
                                          {day.label}
                                        </Button>
                                      ))}
                                    </div>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}

                            <FormField
                              control={form.control}
                              name='recurrence_end_date'
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>End Repeat</FormLabel>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <FormControl>
                                        <Button
                                          variant='outline'
                                          className={cn(
                                            'w-full pl-3 text-left font-normal',
                                            !field.value &&
                                              'text-muted-foreground'
                                          )}
                                        >
                                          {field.value ? (
                                            format(field.value, 'MMM d, yyyy')
                                          ) : (
                                            <span>No end date</span>
                                          )}
                                          <CalendarIcon className='ml-auto h-4 w-4 opacity-50' />
                                        </Button>
                                      </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent
                                      className='w-auto p-0'
                                      align='start'
                                    >
                                      <Calendar
                                        mode='single'
                                        selected={field.value}
                                        onSelect={field.onChange}
                                        disabled={(date) =>
                                          date < addDays(new Date(), 1)
                                        }
                                        initialFocus
                                      />
                                    </PopoverContent>
                                  </Popover>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        )}
                      </>
                    )}

                    {/* Description */}
                    <FormField
                      control={form.control}
                      name='description'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder='Optional notes about this event...'
                              className='resize-none'
                              rows={2}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Location */}
                    <FormField
                      control={form.control}
                      name='location'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location</FormLabel>
                          <FormControl>
                            <Input
                              placeholder='e.g., Conference Room A, Warehouse Floor'
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Mandatory Toggle */}
                    <FormField
                      control={form.control}
                      name='is_mandatory'
                      render={({ field }) => (
                        <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                          <div className='space-y-0.5'>
                            <FormLabel className='text-base'>
                              Mandatory Event
                            </FormLabel>
                            <FormDescription>
                              Mark this as required for affected associates
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

                    {/* Selected Category Info */}
                    {selectedCategory && (
                      <div
                        className='flex items-center gap-3 rounded-lg border p-3'
                        style={{
                          borderColor: selectedCategory.color + '60',
                          backgroundColor: selectedCategory.color + '10',
                        }}
                      >
                        <div
                          className='h-4 w-4 flex-shrink-0 rounded-full'
                          style={{ backgroundColor: selectedCategory.color }}
                        />
                        <div className='flex-1 text-sm'>
                          <span className='font-medium'>
                            {selectedCategory.category_name}
                          </span>
                          <span className='text-muted-foreground ml-2'>
                            {selectedCategory.is_paid_time && '• Paid Time '}
                            {selectedCategory.is_productive_time &&
                              '• Productive '}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Form Actions */}
                    <DialogFooter className='pt-4'>
                      <Button
                        type='button'
                        variant='outline'
                        onClick={() => {
                          resetForm()
                          setActiveTab('recurring-area')
                        }}
                        disabled={isSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button type='submit' disabled={isSubmitting}>
                        {isSubmitting && (
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        )}
                        {editingEvent ? 'Update Event' : 'Create Event'}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteConfirmEvent}
        onOpenChange={() => setDeleteConfirmEvent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete "
              {deleteConfirmEvent?.event_name}"? This action cannot be undone.
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
    </>
  )
}

export default ManageEventsDialog

// Created and developed by Jai Singh
