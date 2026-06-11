// Created and developed by Jai Singh
/**
 * Add Event Dialog Component
 * Form dialog for creating timeline events (meetings, planned downtime, etc.)
 * Created: January 2, 2026
 */
import { useCallback, useEffect, useState } from 'react'
import * as z from 'zod'
import { addDays, format, isValid, parse } from 'date-fns'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  AlertCircle,
  Calendar as CalendarIcon,
  Clock,
  Loader2,
  MapPin,
  Plus,
  Repeat,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import type { WorkingArea } from '@/lib/supabase/labor-management.service'
import type {
  CreateTimelineEventInput,
  TimelineEventCategory,
} from '@/lib/supabase/timeline-events.service'
import {
  createEvent,
  generateRecurringInstances,
  getEventCategories,
  initializeEventCategories,
} from '@/lib/supabase/timeline-events.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// Form schema
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
      // Validate end time is after start time
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
      // If area scope, require area selection
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
  { start: '06:00', end: '06:30', label: 'Morning Huddle (6:00 - 6:30)' },
  { start: '12:00', end: '12:30', label: 'Lunch Meeting (12:00 - 12:30)' },
  { start: '14:30', end: '15:00', label: 'Shift Handover (2:30 - 3:00)' },
  { start: '10:00', end: '10:15', label: 'Break Extension (10:00 - 10:15)' },
]

// Icon components for categories
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  planned_downtime: <AlertCircle className='h-4 w-4' />,
  team_meeting: <Users className='h-4 w-4' />,
  training: <CalendarIcon className='h-4 w-4' />,
  safety_briefing: <AlertCircle className='h-4 w-4' />,
  extended_break: <Clock className='h-4 w-4' />,
  quality_audit: <CalendarIcon className='h-4 w-4' />,
  inventory_count: <MapPin className='h-4 w-4' />,
  shift_handover: <Repeat className='h-4 w-4' />,
  company_event: <Users className='h-4 w-4' />,
  custom: <Plus className='h-4 w-4' />,
}

interface AddEventDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  workingAreas?: WorkingArea[]
  selectedDate?: Date
  onEventCreated?: () => void
}

export function AddEventDialog({
  open,
  onOpenChange,
  organizationId,
  workingAreas = [],
  selectedDate,
  onEventCreated,
}: AddEventDialogProps) {
  const [categories, setCategories] = useState<TimelineEventCategory[]>([])
  const [isLoadingCategories, setIsLoadingCategories] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'quick' | 'custom'>('quick')

  // Form with default values
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
      description: '',
      location: '',
      is_recurring: false,
      recurrence_pattern: undefined,
      recurrence_days: [],
      recurrence_end_date: undefined,
      is_mandatory: false,
    },
  })

  // Load categories when dialog opens
  const loadCategories = useCallback(async () => {
    if (!organizationId) return

    setIsLoadingCategories(true)
    try {
      // First try to get existing categories
      let cats = await getEventCategories(organizationId, true)

      // If no categories exist, initialize defaults
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

  useEffect(() => {
    if (open) {
      loadCategories()
      // Reset form when dialog opens
      form.reset({
        event_name: '',
        category_id: '',
        event_date: selectedDate || new Date(),
        start_time: '08:00',
        end_time: '09:00',
        scope_type: 'all',
        working_area_id: undefined,
        description: '',
        location: '',
        is_recurring: false,
        recurrence_pattern: undefined,
        recurrence_days: [],
        recurrence_end_date: undefined,
        is_mandatory: false,
      })
    }
  }, [open, organizationId, selectedDate, loadCategories, form])

  // Quick select a category (sets form fields based on category defaults)
  const handleQuickSelect = (category: TimelineEventCategory) => {
    form.setValue('category_id', category.id)
    form.setValue('event_name', category.category_name)

    // Set duration based on category default
    const startTime = form.getValues('start_time')
    if (startTime && category.default_duration_minutes) {
      const start = parse(startTime, 'HH:mm', new Date())
      if (isValid(start)) {
        const end = new Date(
          start.getTime() + category.default_duration_minutes * 60 * 1000
        )
        form.setValue('end_time', format(end, 'HH:mm'))
      }
    }

    // Switch to custom tab to complete the form
    setActiveTab('custom')
  }

  // Apply time preset
  const handleTimePreset = (preset: (typeof TIME_PRESETS)[0]) => {
    form.setValue('start_time', preset.start)
    form.setValue('end_time', preset.end)
  }

  // Handle form submission
  const onSubmit = async (data: EventFormData) => {
    setIsSubmitting(true)
    try {
      const eventInput: CreateTimelineEventInput = {
        event_name: data.event_name,
        category_id: data.category_id,
        event_date: format(data.event_date, 'yyyy-MM-dd'),
        start_time: data.start_time,
        end_time: data.end_time,
        scope_type: data.scope_type,
        working_area_id: data.working_area_id,
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

      const newEvent = await createEvent(organizationId, eventInput)

      // If this is a recurring event, generate all instances
      if (data.is_recurring && newEvent?.id) {
        const endDateStr = data.recurrence_end_date
          ? format(data.recurrence_end_date, 'yyyy-MM-dd')
          : undefined
        const instanceCount = await generateRecurringInstances(
          newEvent.id,
          endDateStr
        )
        toast.success(`Event created with ${instanceCount + 1} occurrences`)
      } else {
        toast.success('Event created successfully')
      }

      onOpenChange(false)
      onEventCreated?.()
    } catch (error) {
      logger.error('Error creating event:', error)
      toast.error('Failed to create event')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Watch form values for conditional rendering
  const watchScopeType = form.watch('scope_type')
  const watchIsRecurring = form.watch('is_recurring')
  const watchRecurrencePattern = form.watch('recurrence_pattern')
  const watchCategoryId = form.watch('category_id')
  const selectedCategory = categories.find((c) => c.id === watchCategoryId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[700px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Plus className='text-primary h-5 w-5' />
            Add Timeline Event
          </DialogTitle>
          <DialogDescription>
            Add meetings, planned downtime, or other events to the activity
            timeline.
          </DialogDescription>
        </DialogHeader>

        {isLoadingCategories ? (
          <div className='flex items-center justify-center py-12'>
            <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
          </div>
        ) : categories.length === 0 ? (
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertDescription>
              No event categories available. Please contact an administrator.
            </AlertDescription>
          </Alert>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'quick' | 'custom')}
          >
            <TabsList className='grid w-full grid-cols-2'>
              <TabsTrigger value='quick'>Quick Select</TabsTrigger>
              <TabsTrigger value='custom'>Custom Event</TabsTrigger>
            </TabsList>

            {/* Quick Select Tab - Predefined event types */}
            <TabsContent value='quick' className='space-y-4'>
              <div className='grid grid-cols-2 gap-3'>
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type='button'
                    onClick={() => handleQuickSelect(category)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border-2 p-4 transition-all',
                      'hover:border-primary hover:bg-accent/50',
                      'text-left'
                    )}
                    style={{
                      borderColor: category.color + '40',
                      backgroundColor: category.color + '10',
                    }}
                  >
                    <div
                      className='flex h-10 w-10 items-center justify-center rounded-lg'
                      style={{ backgroundColor: category.color + '30' }}
                    >
                      <span style={{ color: category.color }}>
                        {CATEGORY_ICONS[category.category_code] || (
                          <CalendarIcon className='h-4 w-4' />
                        )}
                      </span>
                    </div>
                    <div className='min-w-0 flex-1'>
                      <p className='truncate font-medium'>
                        {category.category_name}
                      </p>
                      <p className='text-muted-foreground truncate text-xs'>
                        {category.description ||
                          `${category.default_duration_minutes} min default`}
                      </p>
                    </div>
                    {category.is_paid_time && (
                      <Badge variant='secondary' className='text-[10px]'>
                        Paid
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            </TabsContent>

            {/* Custom Event Tab - Full form */}
            <TabsContent value='custom' className='space-y-4'>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className='space-y-5'
                >
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
                              <SelectItem key={category.id} value={category.id}>
                                <div className='flex items-center gap-2'>
                                  <div
                                    className='h-3 w-3 rounded-full'
                                    style={{ backgroundColor: category.color }}
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
                      Quick times:
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
                            <SelectItem value='all'>All Associates</SelectItem>
                            <SelectItem value='area'>Specific Area</SelectItem>
                            <SelectItem value='shift'>Current Shift</SelectItem>
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

                  {/* Recurring Event Toggle */}
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
                                <SelectItem value='daily'>Daily</SelectItem>
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
                                          current.filter((d) => d !== day.value)
                                        )
                                      } else {
                                        field.onChange([...current, day.value])
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
                                      !field.value && 'text-muted-foreground'
                                    )}
                                  >
                                    {field.value ? (
                                      format(field.value, 'MMM d, yyyy')
                                    ) : (
                                      <span>
                                        No end date (3 months default)
                                      </span>
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
                            Mark this as a required event for affected
                            associates
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
                      onClick={() => onOpenChange(false)}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button type='submit' disabled={isSubmitting}>
                      {isSubmitting && (
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      )}
                      Create Event
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default AddEventDialog

// Created and developed by Jai Singh
