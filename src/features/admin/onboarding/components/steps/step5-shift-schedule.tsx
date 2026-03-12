/**
 * Step 5: Shift Schedule
 * Configure work schedule and targets
 */
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Clock, Calendar, Target, TrendingUp, Coffee } from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService, {
  type ShiftSchedule,
} from '@/lib/supabase/labor-management.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { TimePicker } from '@/components/ui/time-picker'
import { useOnboarding } from '../../context/onboarding-context'
import {
  ShiftScheduleData,
  shiftScheduleSchema,
} from '../../types/onboarding.types'

const DAYS_OF_WEEK = [
  { id: 1, label: 'Mon', full: 'Monday' },
  { id: 2, label: 'Tue', full: 'Tuesday' },
  { id: 3, label: 'Wed', full: 'Wednesday' },
  { id: 4, label: 'Thu', full: 'Thursday' },
  { id: 5, label: 'Fri', full: 'Friday' },
  { id: 6, label: 'Sat', full: 'Saturday' },
  { id: 7, label: 'Sun', full: 'Sunday' },
]

export function Step5ShiftSchedule() {
  const { state, updateStepData } = useOnboarding()
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id

  const [scheduleTemplates, setScheduleTemplates] = useState<ShiftSchedule[]>(
    []
  )
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true)
  const [useTemplate, setUseTemplate] = useState(
    !!state.shiftSchedule?.shift_schedule_id
  )

  const form = useForm<ShiftScheduleData>({
    resolver: zodResolver(shiftScheduleSchema),
    defaultValues: state.shiftSchedule || {
      shift_pattern: 'fixed',
      shift_start_time: '08:00',
      shift_end_time: '17:00',
      working_days: [1, 2, 3, 4, 5],
      shift_schedule_id: null,
      productivity_target: 100,
      quality_target: 95,
    },
    mode: 'onChange',
  })

  const workingDays = form.watch('working_days')
  const productivityTarget = form.watch('productivity_target')
  const qualityTarget = form.watch('quality_target')
  const selectedScheduleId = form.watch('shift_schedule_id')

  // Load available shift schedule templates
  useEffect(() => {
    async function loadTemplates() {
      if (!organizationId) return
      setIsLoadingTemplates(true)
      try {
        const schedules =
          await LaborManagementService.getShiftSchedules(organizationId)
        setScheduleTemplates(schedules.filter((s) => s.is_active))
      } catch (error) {
        logger.error('Error loading shift schedules:', error)
      } finally {
        setIsLoadingTemplates(false)
      }
    }
    loadTemplates()
  }, [organizationId])

  // Watch form changes and update context
  useEffect(() => {
    const subscription = form.watch((data) => {
      if (data) {
        updateStepData('shiftSchedule', data as ShiftScheduleData)
      }
    })
    return () => subscription.unsubscribe()
  }, [form, updateStepData])

  // Helper to normalize time format (HH:mm:ss -> HH:mm)
  const normalizeTime = (time: string) => {
    if (!time) return '08:00'
    // Strip seconds if present (HH:mm:ss -> HH:mm)
    const parts = time.split(':')
    return `${parts[0]}:${parts[1]}`
  }

  // Map schedule_type from shift schedules to shift_pattern for onboarding
  const mapScheduleTypeToPattern = (
    scheduleType: string
  ): 'fixed' | 'rotating' | 'flexible' | 'on_call' => {
    const mapping: Record<
      string,
      'fixed' | 'rotating' | 'flexible' | 'on_call'
    > = {
      standard: 'fixed',
      rotating: 'rotating',
      flex: 'flexible',
      flexible: 'flexible',
      on_call: 'on_call',
      split: 'fixed', // Map split shifts to fixed
    }
    return mapping[scheduleType] || 'fixed'
  }

  // When a template is selected, populate the form with its values
  useEffect(() => {
    if (selectedScheduleId && useTemplate) {
      const template = scheduleTemplates.find(
        (s) => s.id === selectedScheduleId
      )
      if (template) {
        // Normalize time format and trigger validation
        form.setValue(
          'shift_start_time',
          normalizeTime(template.shift_start_time),
          { shouldValidate: true }
        )
        form.setValue(
          'shift_end_time',
          normalizeTime(template.shift_end_time),
          { shouldValidate: true }
        )
        form.setValue('working_days', template.operating_days, {
          shouldValidate: true,
        })
        // Map schedule_type to the correct shift_pattern enum value
        form.setValue(
          'shift_pattern',
          mapScheduleTypeToPattern(template.schedule_type),
          { shouldValidate: true }
        )
      }
    }
  }, [selectedScheduleId, scheduleTemplates, useTemplate, form])

  const toggleDay = (dayId: number) => {
    const currentDays = form.getValues('working_days')
    if (currentDays.includes(dayId)) {
      form.setValue(
        'working_days',
        currentDays.filter((d) => d !== dayId)
      )
    } else {
      form.setValue('working_days', [...currentDays, dayId].sort())
    }
  }

  const handleTemplateToggle = (useTemplateValue: boolean) => {
    setUseTemplate(useTemplateValue)
    if (!useTemplateValue) {
      form.setValue('shift_schedule_id', null)
    }
  }

  const formatTime = (time: string) => {
    if (!time) return ''
    const parts = time.split(':')
    const hours = parts[0]
    const minutes = parts[1]
    const hour = parseInt(hours)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour % 12 || 12
    return `${displayHour}:${minutes} ${ampm}`
  }

  const selectedTemplate = scheduleTemplates.find(
    (s) => s.id === selectedScheduleId
  )

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Clock className='h-5 w-5' />
            Shift Schedule
          </CardTitle>
          <CardDescription>
            Configure the employee's work schedule
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className='space-y-6'>
              {/* Schedule Template Selection */}
              {isLoadingTemplates ? (
                <div className='space-y-3'>
                  <Skeleton className='h-5 w-32' />
                  <Skeleton className='h-10 w-full' />
                </div>
              ) : (
                scheduleTemplates.length > 0 && (
                  <div className='space-y-4'>
                    <div className='flex gap-4'>
                      <button
                        type='button'
                        onClick={() => handleTemplateToggle(true)}
                        className={cn(
                          'flex-1 rounded-lg border p-4 text-left transition-colors',
                          useTemplate
                            ? 'border-primary bg-primary/5'
                            : 'border-input hover:border-primary/50'
                        )}
                      >
                        <p className='font-medium'>Use Schedule Template</p>
                        <p className='text-muted-foreground text-sm'>
                          Select from pre-configured shift schedules
                        </p>
                      </button>
                      <button
                        type='button'
                        onClick={() => handleTemplateToggle(false)}
                        className={cn(
                          'flex-1 rounded-lg border p-4 text-left transition-colors',
                          !useTemplate
                            ? 'border-primary bg-primary/5'
                            : 'border-input hover:border-primary/50'
                        )}
                      >
                        <p className='font-medium'>Custom Schedule</p>
                        <p className='text-muted-foreground text-sm'>
                          Configure a custom work schedule
                        </p>
                      </button>
                    </div>

                    {useTemplate && (
                      <FormField
                        control={form.control}
                        name='shift_schedule_id'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Select Schedule Template</FormLabel>
                            <Select
                              value={field.value || ''}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder='Choose a schedule...' />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {scheduleTemplates.map((schedule) => (
                                  <SelectItem
                                    key={schedule.id}
                                    value={schedule.id}
                                  >
                                    <div className='flex items-center gap-2'>
                                      <div
                                        className='h-3 w-3 rounded-full'
                                        style={{
                                          backgroundColor:
                                            schedule.color || '#3b82f6',
                                        }}
                                      />
                                      <span>{schedule.schedule_name}</span>
                                      <span className='text-muted-foreground'>
                                        ({formatTime(schedule.shift_start_time)}{' '}
                                        - {formatTime(schedule.shift_end_time)})
                                      </span>
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

                    {/* Display selected template details */}
                    {useTemplate && selectedTemplate && (
                      <Card className='bg-muted/50'>
                        <CardContent className='pt-4'>
                          <div className='flex items-start gap-3'>
                            <div
                              className='h-full min-h-[60px] w-1 rounded-full'
                              style={{
                                backgroundColor:
                                  selectedTemplate.color || '#3b82f6',
                              }}
                            />
                            <div className='flex-1 space-y-2'>
                              <div className='flex items-center gap-2'>
                                <h5 className='font-medium'>
                                  {selectedTemplate.schedule_name}
                                </h5>
                                {selectedTemplate.schedule_code && (
                                  <Badge variant='outline' className='text-xs'>
                                    {selectedTemplate.schedule_code}
                                  </Badge>
                                )}
                              </div>
                              <div className='grid grid-cols-2 gap-4 text-sm'>
                                <div>
                                  <p className='text-muted-foreground'>Hours</p>
                                  <p>
                                    {formatTime(
                                      selectedTemplate.shift_start_time
                                    )}{' '}
                                    -{' '}
                                    {formatTime(
                                      selectedTemplate.shift_end_time
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <p className='text-muted-foreground'>Days</p>
                                  <p>
                                    {selectedTemplate.operating_days
                                      .map(
                                        (d) =>
                                          DAYS_OF_WEEK.find(
                                            (day) => day.id === d
                                          )?.label
                                      )
                                      .join(', ')}
                                  </p>
                                </div>
                              </div>
                              {selectedTemplate.breaks &&
                                selectedTemplate.breaks.length > 0 && (
                                  <div className='pt-2'>
                                    <p className='text-muted-foreground mb-1 text-sm'>
                                      Scheduled Breaks
                                    </p>
                                    <div className='flex flex-wrap gap-2'>
                                      {selectedTemplate.breaks.map(
                                        (breakItem, index) => (
                                          <Badge
                                            key={index}
                                            variant='secondary'
                                            className='flex items-center gap-1'
                                          >
                                            <Coffee className='h-3 w-3' />
                                            {breakItem.break_name} (
                                            {formatTime(breakItem.start_time)},{' '}
                                            {breakItem.duration_minutes}min)
                                          </Badge>
                                        )
                                      )}
                                    </div>
                                  </div>
                                )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {!useTemplate && <Separator />}
                  </div>
                )
              )}

              {/* Custom Schedule Fields (shown when not using template or no templates exist) */}
              {(!useTemplate || scheduleTemplates.length === 0) && (
                <>
                  {/* Shift Pattern */}
                  <FormField
                    control={form.control}
                    name='shift_pattern'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Shift Pattern</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder='Select pattern...' />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='fixed'>
                                Fixed Schedule
                              </SelectItem>
                              <SelectItem value='rotating'>
                                Rotating Shifts
                              </SelectItem>
                              <SelectItem value='flexible'>
                                Flexible Hours
                              </SelectItem>
                              <SelectItem value='on_call'>On-Call</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          The type of schedule this employee will work
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

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

                  {/* Working Days */}
                  <div className='space-y-3'>
                    <Label className='flex items-center gap-2'>
                      <Calendar className='h-4 w-4' />
                      Working Days
                    </Label>
                    <div className='flex flex-wrap gap-2'>
                      {DAYS_OF_WEEK.map((day) => (
                        <button
                          key={day.id}
                          type='button'
                          onClick={() => toggleDay(day.id)}
                          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                            workingDays.includes(day.id)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-muted border-input'
                          } `}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                    <p className='text-muted-foreground text-sm'>
                      {workingDays.length} days selected
                    </p>
                  </div>
                </>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Performance Targets */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Target className='h-5 w-5' />
            Performance Targets
          </CardTitle>
          <CardDescription>
            Set initial productivity and quality goals
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className='space-y-6'>
              {/* Productivity Target */}
              <FormField
                control={form.control}
                name='productivity_target'
                render={({ field }) => (
                  <FormItem>
                    <div className='flex items-center justify-between'>
                      <FormLabel className='flex items-center gap-2'>
                        <TrendingUp className='h-4 w-4' />
                        Productivity Target
                      </FormLabel>
                      <span className='text-sm font-medium'>
                        {productivityTarget}%
                      </span>
                    </div>
                    <FormControl>
                      <Slider
                        value={[field.value || 100]}
                        onValueChange={([value]) => field.onChange(value)}
                        max={150}
                        min={50}
                        step={5}
                        className='py-4'
                      />
                    </FormControl>
                    <FormDescription>
                      Expected productivity level relative to standard (100% =
                      standard)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Quality Target */}
              <FormField
                control={form.control}
                name='quality_target'
                render={({ field }) => (
                  <FormItem>
                    <div className='flex items-center justify-between'>
                      <FormLabel>Quality Target</FormLabel>
                      <span className='text-sm font-medium'>
                        {qualityTarget}%
                      </span>
                    </div>
                    <FormControl>
                      <Slider
                        value={[field.value || 95]}
                        onValueChange={([value]) => field.onChange(value)}
                        max={100}
                        min={80}
                        step={1}
                        className='py-4'
                      />
                    </FormControl>
                    <FormDescription>
                      Expected accuracy/quality percentage
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}

export default Step5ShiftSchedule
