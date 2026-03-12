/**
 * Shift Schedule Management Component
 * Create, edit, and manage shift schedules with configurable break times
 * Created: December 27, 2025
 */
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  Coffee,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService, {
  type ShiftSchedule,
} from '@/lib/supabase/labor-management.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
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
import { Card, CardContent } from '@/components/ui/card'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { TimePicker } from '@/components/ui/time-picker'

const DAYS_OF_WEEK = [
  { id: 1, label: 'Mon', full: 'Monday' },
  { id: 2, label: 'Tue', full: 'Tuesday' },
  { id: 3, label: 'Wed', full: 'Wednesday' },
  { id: 4, label: 'Thu', full: 'Thursday' },
  { id: 5, label: 'Fri', full: 'Friday' },
  { id: 6, label: 'Sat', full: 'Saturday' },
  { id: 7, label: 'Sun', full: 'Sunday' },
]

const SCHEDULE_TYPES = [
  { value: 'standard', label: 'Standard' },
  { value: 'rotating', label: 'Rotating' },
  { value: 'flex', label: 'Flexible' },
  { value: 'split', label: 'Split Shift' },
  { value: 'on_call', label: 'On-Call' },
]

const SCHEDULE_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
]

const breakSchema = z.object({
  break_name: z.string().min(1, 'Break name is required'),
  start_time: z.string().min(1, 'Start time is required'),
  duration_minutes: z.coerce.number().min(5).max(120),
  is_paid: z.boolean().default(false),
})

const shiftScheduleSchema = z.object({
  schedule_name: z.string().min(1, 'Schedule name is required'),
  schedule_code: z.string().optional(),
  schedule_type: z.string().default('standard'),
  shift_start_time: z.string().min(1, 'Start time is required'),
  shift_end_time: z.string().min(1, 'End time is required'),
  operating_days: z.array(z.number()).min(1, 'Select at least one day'),
  breaks: z.array(breakSchema).default([]),
  description: z.string().optional(),
  color: z.string().default('#3b82f6'),
  is_active: z.boolean().default(true),
})

type ShiftScheduleFormData = z.infer<typeof shiftScheduleSchema>

interface ShiftScheduleManagementProps {
  className?: string
}

export function ShiftScheduleManagement({
  className,
}: ShiftScheduleManagementProps) {
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id

  const [schedules, setSchedules] = useState<ShiftSchedule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<ShiftSchedule | null>(
    null
  )
  const [deleteSchedule, setDeleteSchedule] = useState<ShiftSchedule | null>(
    null
  )
  const [expandedSchedule, setExpandedSchedule] = useState<string | null>(null)

  const loadSchedules = async () => {
    if (!organizationId) return
    setIsLoading(true)
    try {
      const data =
        await LaborManagementService.getShiftSchedules(organizationId)
      setSchedules(data)
    } catch (error) {
      logger.error('Error loading shift schedules:', error)
      toast.error('Failed to load shift schedules')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadSchedules()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: load on organizationId change; loadSchedules captures organizationId from closure
  }, [organizationId])

  const handleAdd = () => {
    setEditingSchedule(null)
    setIsDialogOpen(true)
  }

  const handleEdit = (schedule: ShiftSchedule) => {
    setEditingSchedule(schedule)
    setIsDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!deleteSchedule) return
    try {
      await LaborManagementService.deleteShiftSchedule(deleteSchedule.id)
      toast.success('Shift schedule deleted')
      setDeleteSchedule(null)
      loadSchedules()
    } catch (error) {
      logger.error('Error deleting schedule:', error)
      toast.error('Failed to delete shift schedule')
    }
  }

  const handleSave = async (data: ShiftScheduleFormData) => {
    if (!organizationId) return

    try {
      const scheduleData = {
        ...data,
        organization_id: organizationId,
        break_duration_minutes: data.breaks.reduce(
          (acc, b) => acc + b.duration_minutes,
          0
        ),
        break_start_time: data.breaks[0]?.start_time || undefined,
      }

      if (editingSchedule) {
        await LaborManagementService.updateShiftSchedule(
          editingSchedule.id,
          scheduleData
        )
        toast.success('Shift schedule updated')
      } else {
        await LaborManagementService.createShiftSchedule(scheduleData)
        toast.success('Shift schedule created')
      }

      setIsDialogOpen(false)
      loadSchedules()
    } catch (error) {
      logger.error('Error saving schedule:', error)
      toast.error('Failed to save shift schedule')
    }
  }

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':')
    const hour = parseInt(hours)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour % 12 || 12
    return `${displayHour}:${minutes} ${ampm}`
  }

  const getDaysLabel = (days: number[]) => {
    if (days.length === 7) return 'Every day'
    if (days.length === 5 && days.every((d) => d >= 1 && d <= 5))
      return 'Weekdays'
    if (days.length === 2 && days.includes(6) && days.includes(7))
      return 'Weekends'
    return days
      .map((d) => DAYS_OF_WEEK.find((day) => day.id === d)?.label)
      .join(', ')
  }

  if (isLoading) {
    return (
      <div className='space-y-4'>
        <div className='flex items-center justify-between'>
          <Skeleton className='h-6 w-40' />
          <Skeleton className='h-9 w-32' />
        </div>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className='h-20 w-full' />
        ))}
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div>
          <h4 className='text-sm font-medium'>Shift Schedules</h4>
          <p className='text-muted-foreground text-sm'>
            Create and manage shift schedules that can be assigned to associates
          </p>
        </div>
        <Button onClick={handleAdd} size='sm'>
          <Plus className='mr-2 h-4 w-4' />
          Add Schedule
        </Button>
      </div>

      {/* Schedules List */}
      {schedules.length === 0 ? (
        <Card>
          <CardContent className='py-12 text-center'>
            <Clock className='text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50' />
            <p className='text-muted-foreground'>
              No shift schedules configured
            </p>
            <Button onClick={handleAdd} variant='outline' className='mt-4'>
              <Plus className='mr-2 h-4 w-4' />
              Create First Schedule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className='space-y-3'>
          <AnimatePresence>
            {schedules.map((schedule) => (
              <motion.div
                key={schedule.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <Card
                  className={cn(
                    'transition-colors',
                    !schedule.is_active && 'opacity-60'
                  )}
                >
                  <CardContent className='py-4'>
                    <div className='flex items-start justify-between gap-4'>
                      <div className='flex flex-1 items-start gap-3'>
                        <div
                          className='h-12 w-3 flex-shrink-0 rounded-full'
                          style={{
                            backgroundColor: schedule.color || '#3b82f6',
                          }}
                        />
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-2'>
                            <h5 className='font-medium'>
                              {schedule.schedule_name}
                            </h5>
                            {schedule.schedule_code && (
                              <Badge variant='outline' className='text-xs'>
                                {schedule.schedule_code}
                              </Badge>
                            )}
                            {!schedule.is_active && (
                              <Badge variant='secondary'>Inactive</Badge>
                            )}
                          </div>
                          <div className='text-muted-foreground mt-1 flex flex-wrap items-center gap-4 text-sm'>
                            <span className='flex items-center gap-1'>
                              <Clock className='h-3.5 w-3.5' />
                              {formatTime(schedule.shift_start_time)} -{' '}
                              {formatTime(schedule.shift_end_time)}
                            </span>
                            <span className='flex items-center gap-1'>
                              <Calendar className='h-3.5 w-3.5' />
                              {getDaysLabel(schedule.operating_days)}
                            </span>
                            {schedule.breaks && schedule.breaks.length > 0 && (
                              <span className='flex items-center gap-1'>
                                <Coffee className='h-3.5 w-3.5' />
                                {schedule.breaks.length} break
                                {schedule.breaks.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() =>
                            setExpandedSchedule(
                              expandedSchedule === schedule.id
                                ? null
                                : schedule.id
                            )
                          }
                        >
                          {expandedSchedule === schedule.id ? (
                            <ChevronUp className='h-4 w-4' />
                          ) : (
                            <ChevronDown className='h-4 w-4' />
                          )}
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => handleEdit(schedule)}
                        >
                          <Pencil className='h-4 w-4' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => setDeleteSchedule(schedule)}
                        >
                          <Trash2 className='text-destructive h-4 w-4' />
                        </Button>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {expandedSchedule === schedule.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className='mt-4 border-t pt-4'
                        >
                          <div className='grid gap-4 md:grid-cols-2'>
                            <div>
                              <h6 className='mb-2 text-sm font-medium'>
                                Schedule Details
                              </h6>
                              <dl className='space-y-1 text-sm'>
                                <div className='flex justify-between'>
                                  <dt className='text-muted-foreground'>
                                    Type:
                                  </dt>
                                  <dd className='capitalize'>
                                    {schedule.schedule_type}
                                  </dd>
                                </div>
                                <div className='flex justify-between'>
                                  <dt className='text-muted-foreground'>
                                    Total Break Time:
                                  </dt>
                                  <dd>
                                    {schedule.break_duration_minutes || 0} min
                                  </dd>
                                </div>
                                {schedule.description && (
                                  <div className='pt-2'>
                                    <dt className='text-muted-foreground'>
                                      Description:
                                    </dt>
                                    <dd className='mt-1'>
                                      {schedule.description}
                                    </dd>
                                  </div>
                                )}
                              </dl>
                            </div>
                            {schedule.breaks && schedule.breaks.length > 0 && (
                              <div>
                                <h6 className='mb-2 text-sm font-medium'>
                                  Break Schedule
                                </h6>
                                <div className='space-y-2'>
                                  {schedule.breaks.map((breakItem, index) => (
                                    <div
                                      key={index}
                                      className='bg-muted/50 flex items-center justify-between rounded p-2'
                                    >
                                      <div className='flex items-center gap-2'>
                                        <Coffee className='text-muted-foreground h-4 w-4' />
                                        <span className='text-sm font-medium'>
                                          {breakItem.break_name}
                                        </span>
                                      </div>
                                      <div className='text-muted-foreground text-sm'>
                                        {formatTime(breakItem.start_time)} •{' '}
                                        {breakItem.duration_minutes} min
                                        {breakItem.is_paid && (
                                          <Badge
                                            variant='outline'
                                            className='ml-2 text-xs'
                                          >
                                            Paid
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <ShiftScheduleDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        schedule={editingSchedule}
        onSave={handleSave}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteSchedule}
        onOpenChange={() => setDeleteSchedule(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shift Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteSchedule?.schedule_name}"?
              This action cannot be undone. Associates assigned to this schedule
              will need to be reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface ShiftScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  schedule: ShiftSchedule | null
  onSave: (data: ShiftScheduleFormData) => void
}

function ShiftScheduleDialog({
  open,
  onOpenChange,
  schedule,
  onSave,
}: ShiftScheduleDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<ShiftScheduleFormData>({
    resolver: zodResolver(shiftScheduleSchema),
    defaultValues: {
      schedule_name: '',
      schedule_code: '',
      schedule_type: 'standard',
      shift_start_time: '08:00',
      shift_end_time: '17:00',
      operating_days: [1, 2, 3, 4, 5],
      breaks: [],
      description: '',
      color: '#3b82f6',
      is_active: true,
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'breaks',
  })

  useEffect(() => {
    if (schedule) {
      form.reset({
        schedule_name: schedule.schedule_name,
        schedule_code: schedule.schedule_code || '',
        schedule_type: schedule.schedule_type,
        shift_start_time: schedule.shift_start_time,
        shift_end_time: schedule.shift_end_time,
        operating_days: schedule.operating_days,
        breaks: schedule.breaks || [],
        description: schedule.description || '',
        color: schedule.color || '#3b82f6',
        is_active: schedule.is_active,
      })
    } else {
      form.reset({
        schedule_name: '',
        schedule_code: '',
        schedule_type: 'standard',
        shift_start_time: '08:00',
        shift_end_time: '17:00',
        operating_days: [1, 2, 3, 4, 5],
        breaks: [],
        description: '',
        color: '#3b82f6',
        is_active: true,
      })
    }
  }, [schedule, form, open])

  const handleSubmit = async (data: ShiftScheduleFormData) => {
    setIsSubmitting(true)
    try {
      await onSave(data)
    } finally {
      setIsSubmitting(false)
    }
  }

  const operatingDays = form.watch('operating_days')

  const toggleDay = (dayId: number) => {
    const currentDays = form.getValues('operating_days')
    if (currentDays.includes(dayId)) {
      form.setValue(
        'operating_days',
        currentDays.filter((d) => d !== dayId)
      )
    } else {
      form.setValue('operating_days', [...currentDays, dayId].sort())
    }
  }

  const addBreak = () => {
    append({
      break_name: `Break ${fields.length + 1}`,
      start_time: '12:00',
      duration_minutes: 30,
      is_paid: false,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] w-[90vw] max-w-[1200px] min-w-[900px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>
            {schedule ? 'Edit Shift Schedule' : 'Create Shift Schedule'}
          </DialogTitle>
          <DialogDescription>
            Configure a shift schedule with work hours and break times
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className='space-y-6'
          >
            {/* Basic Info */}
            <div className='grid gap-4 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='schedule_name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Schedule Name</FormLabel>
                    <FormControl>
                      <Input placeholder='e.g., Morning Shift' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='schedule_code'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Schedule Code (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder='e.g., MORN-01' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className='grid gap-4 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='schedule_type'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Schedule Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='Select type' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SCHEDULE_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='color'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color</FormLabel>
                    <FormControl>
                      <div className='flex gap-2'>
                        {SCHEDULE_COLORS.map((color) => (
                          <button
                            key={color}
                            type='button'
                            className={cn(
                              'h-8 w-8 rounded-full transition-all',
                              field.value === color &&
                                'ring-primary ring-2 ring-offset-2'
                            )}
                            style={{ backgroundColor: color }}
                            onClick={() => field.onChange(color)}
                          />
                        ))}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Shift Times */}
            <div className='grid gap-4 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='shift_start_time'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl>
                      <TimePicker
                        value={field.value}
                        onChange={field.onChange}
                        placeholder='Select start time'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='shift_end_time'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time</FormLabel>
                    <FormControl>
                      <TimePicker
                        value={field.value}
                        onChange={field.onChange}
                        placeholder='Select end time'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Operating Days */}
            <FormField
              control={form.control}
              name='operating_days'
              render={() => (
                <FormItem>
                  <FormLabel>Operating Days</FormLabel>
                  <div className='flex flex-wrap gap-2'>
                    {DAYS_OF_WEEK.map((day) => (
                      <button
                        key={day.id}
                        type='button'
                        onClick={() => toggleDay(day.id)}
                        className={cn(
                          'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                          operatingDays.includes(day.id)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-muted border-input'
                        )}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Breaks Section */}
            <div className='space-y-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <h4 className='text-sm font-medium'>Break Periods</h4>
                  <p className='text-muted-foreground text-sm'>
                    Add scheduled breaks for this shift
                  </p>
                </div>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={addBreak}
                >
                  <Plus className='mr-2 h-4 w-4' />
                  Add Break
                </Button>
              </div>

              {fields.length === 0 ? (
                <Card className='border-dashed'>
                  <CardContent className='text-muted-foreground py-6 text-center'>
                    <Coffee className='mx-auto mb-2 h-8 w-8 opacity-50' />
                    <p className='text-sm'>No breaks configured</p>
                  </CardContent>
                </Card>
              ) : (
                <div className='space-y-3'>
                  {fields.map((field, index) => (
                    <Card key={field.id}>
                      <CardContent className='py-4'>
                        <div className='flex items-start gap-4'>
                          <div className='flex-1 space-y-4'>
                            <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
                              <FormField
                                control={form.control}
                                name={`breaks.${index}.break_name`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className='text-xs'>
                                      Name
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        placeholder='Break name'
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name={`breaks.${index}.start_time`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className='text-xs'>
                                      Start Time
                                    </FormLabel>
                                    <FormControl>
                                      <TimePicker
                                        value={field.value}
                                        onChange={field.onChange}
                                        placeholder='Time'
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name={`breaks.${index}.duration_minutes`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className='text-xs'>
                                      Duration (min)
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        type='number'
                                        min={5}
                                        max={120}
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                            <FormField
                              control={form.control}
                              name={`breaks.${index}.is_paid`}
                              render={({ field }) => (
                                <FormItem className='flex items-center gap-3 space-y-0'>
                                  <FormControl>
                                    <Switch
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                    />
                                  </FormControl>
                                  <FormLabel className='cursor-pointer text-sm font-normal'>
                                    Paid
                                  </FormLabel>
                                </FormItem>
                              )}
                            />
                          </div>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            className='flex-shrink-0'
                            onClick={() => remove(index)}
                          >
                            <X className='h-4 w-4' />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Description */}
            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Additional notes about this schedule...'
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Active Status */}
            <FormField
              control={form.control}
              name='is_active'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Active Schedule</FormLabel>
                    <FormDescription>
                      Inactive schedules cannot be assigned to new associates
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

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting
                  ? 'Saving...'
                  : schedule
                    ? 'Update Schedule'
                    : 'Create Schedule'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default ShiftScheduleManagement
