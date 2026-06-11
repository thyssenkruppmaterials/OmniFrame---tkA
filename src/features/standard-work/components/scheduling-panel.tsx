// Created and developed by Jai Singh
/**
 * Scheduling Panel Component
 * Configuration panel for template scheduling (daily/weekly/monthly)
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  Clock,
  Bell,
  AlertCircle,
  CalendarDays,
  CalendarRange,
  Globe,
  Repeat,
  Save,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import {
  useStandardWork,
  type StandardWorkTemplate,
  type ScheduleConfig,
  type NotificationSettings,
} from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Switch } from '@/components/ui/switch'

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun', fullLabel: 'Sunday' },
  { value: 1, label: 'Mon', fullLabel: 'Monday' },
  { value: 2, label: 'Tue', fullLabel: 'Tuesday' },
  { value: 3, label: 'Wed', fullLabel: 'Wednesday' },
  { value: 4, label: 'Thu', fullLabel: 'Thursday' },
  { value: 5, label: 'Fri', fullLabel: 'Friday' },
  { value: 6, label: 'Sat', fullLabel: 'Saturday' },
]

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1)

const FREQUENCY_OPTIONS = [
  {
    value: 'daily',
    label: 'Daily',
    icon: CalendarDays,
    description: 'Every day',
  },
  {
    value: 'weekly',
    label: 'Weekly',
    icon: CalendarRange,
    description: 'Specific days of the week',
  },
  {
    value: 'monthly',
    label: 'Monthly',
    icon: Calendar,
    description: 'Specific days of the month',
  },
  {
    value: 'shift_start',
    label: 'Shift Start',
    icon: Clock,
    description: 'At the beginning of each shift',
  },
  {
    value: 'shift_end',
    label: 'Shift End',
    icon: Clock,
    description: 'At the end of each shift',
  },
  {
    value: 'as_needed',
    label: 'As Needed',
    icon: Repeat,
    description: 'No scheduled frequency',
  },
]

interface SchedulingPanelProps {
  template: StandardWorkTemplate
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SchedulingPanel({
  template,
  open,
  onOpenChange,
}: SchedulingPanelProps) {
  const { updateTemplateSchedule, isUpdatingSchedule, updateTemplate } =
    useStandardWork()

  // Local state
  const [frequency, setFrequency] = useState(template.frequency)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    template.schedule_config?.days_of_week || [1, 2, 3, 4, 5] // Default weekdays
  )
  const [daysOfMonth, setDaysOfMonth] = useState<number[]>(
    template.schedule_config?.days_of_month || [1]
  )
  const [endOfMonth, setEndOfMonth] = useState(
    template.schedule_config?.end_of_month || false
  )
  const [dueTime, setDueTime] = useState(template.due_time || '')
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(
    template.grace_period_minutes || 60
  )
  const [remindBefore, setRemindBefore] = useState(
    template.notification_settings?.remind_before_minutes || 30
  )
  const [notifyOnOverdue, setNotifyOnOverdue] = useState(
    template.notification_settings?.notify_on_overdue ?? true
  )

  // Reset state when template changes
  useEffect(() => {
    setFrequency(template.frequency)
    setDaysOfWeek(template.schedule_config?.days_of_week || [1, 2, 3, 4, 5])
    setDaysOfMonth(template.schedule_config?.days_of_month || [1])
    setEndOfMonth(template.schedule_config?.end_of_month || false)
    setDueTime(template.due_time || '')
    setGracePeriodMinutes(template.grace_period_minutes || 60)
    setRemindBefore(template.notification_settings?.remind_before_minutes || 30)
    setNotifyOnOverdue(
      template.notification_settings?.notify_on_overdue ?? true
    )
  }, [template])

  const toggleDayOfWeek = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    )
  }

  const toggleDayOfMonth = (day: number) => {
    setDaysOfMonth((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort((a, b) => a - b)
    )
  }

  const handleSave = async () => {
    try {
      // Build schedule config
      const scheduleConfig: ScheduleConfig = {}
      if (frequency === 'weekly') {
        scheduleConfig.days_of_week = daysOfWeek
      } else if (frequency === 'monthly') {
        scheduleConfig.days_of_month = daysOfMonth
        scheduleConfig.end_of_month = endOfMonth
      }

      const notificationSettings: NotificationSettings = {
        remind_before_minutes: remindBefore,
        notify_on_overdue: notifyOnOverdue,
      }

      // Two mutations: frequency lives on the template row; the rest live in
      // the dedicated schedule columns. The mutations themselves toast on
      // success/failure -- we deliberately don't toast a third time here.
      await updateTemplate({
        id: template.id,
        updates: { frequency },
      })

      await updateTemplateSchedule({
        templateId: template.id,
        scheduleConfig,
        dueTime: dueTime || undefined,
        gracePeriodMinutes,
        notificationSettings,
      })

      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to save schedule:', error)
      // The originating mutation already toasted the failure; no second toast.
    }
  }

  const getScheduleSummary = () => {
    switch (frequency) {
      case 'daily':
        return 'Every day'
      case 'weekly':
        if (daysOfWeek.length === 0) return 'No days selected'
        if (daysOfWeek.length === 7) return 'Every day'
        if (
          daysOfWeek.length === 5 &&
          !daysOfWeek.includes(0) &&
          !daysOfWeek.includes(6)
        ) {
          return 'Weekdays'
        }
        return daysOfWeek
          .map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label)
          .join(', ')
      case 'monthly':
        if (daysOfMonth.length === 0 && !endOfMonth) return 'No days selected'
        // eslint-disable-next-line no-case-declarations
        const parts: string[] = []
        if (daysOfMonth.length > 0) {
          parts.push(
            daysOfMonth.map((d) => `${d}${getOrdinalSuffix(d)}`).join(', ')
          )
        }
        if (endOfMonth) {
          parts.push('End of month')
        }
        return parts.join(' & ')
      case 'shift_start':
        return 'At shift start'
      case 'shift_end':
        return 'At shift end'
      case 'as_needed':
        return 'No schedule'
      default:
        return ''
    }
  }

  const getOrdinalSuffix = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return s[(v - 20) % 10] || s[v] || s[0]
  }

  // Browser timezone for the due-time input. Shown as a small label so users
  // know whether 09:00 means 9 AM local or in some shared facility timezone.
  const browserTimezone = useMemo(
    () =>
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : 'local',
    []
  )

  // Compute the next 5 occurrence dates client-side from the current local
  // schedule + due time. This is a preview; the canonical generator lives in
  // SQL (`get_scheduled_tasks_for_date`) but this helps users sanity-check
  // their selections before saving.
  const nextOccurrences = useMemo(() => {
    const out: Date[] = []
    const now = new Date()
    const cursor = new Date(now)
    cursor.setHours(0, 0, 0, 0)
    const limit = 60 // look 60 days ahead at most
    const matches = (d: Date) => {
      switch (frequency) {
        case 'daily':
          return true
        case 'weekly':
          return daysOfWeek.includes(d.getDay())
        case 'monthly': {
          const dom = d.getDate()
          const lastDayOfMonth = new Date(
            d.getFullYear(),
            d.getMonth() + 1,
            0
          ).getDate()
          if (endOfMonth && dom === lastDayOfMonth) return true
          return daysOfMonth.includes(dom)
        }
        case 'shift_start':
        case 'shift_end':
        case 'as_needed':
        default:
          return false
      }
    }
    for (let i = 0; i < limit && out.length < 5; i++) {
      const d = new Date(cursor)
      d.setDate(d.getDate() + i)
      if (!matches(d)) continue
      if (dueTime) {
        const [h = '00', m = '00'] = dueTime.split(':')
        d.setHours(parseInt(h, 10) || 0, parseInt(m, 10) || 0, 0, 0)
      }
      // Skip occurrences already in the past for today.
      if (d.getTime() < now.getTime()) continue
      out.push(d)
    }
    return out
  }, [frequency, daysOfWeek, daysOfMonth, endOfMonth, dueTime])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Calendar className='h-5 w-5' />
            Schedule Configuration
          </DialogTitle>
          <DialogDescription>
            Configure when this checklist should be completed
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-6 py-4'>
          {/* Frequency Selection */}
          <div className='space-y-3'>
            <Label className='text-sm font-medium'>Frequency</Label>
            <div className='grid grid-cols-2 gap-2'>
              {FREQUENCY_OPTIONS.map((option) => {
                const Icon = option.icon
                const isSelected = frequency === option.value
                return (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() =>
                      setFrequency(
                        option.value as StandardWorkTemplate['frequency']
                      )
                    }
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/5 ring-primary ring-1'
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      )}
                    >
                      <Icon className='h-4 w-4' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-medium'>{option.label}</p>
                      <p className='text-muted-foreground text-xs'>
                        {option.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Weekly Configuration */}
          {frequency === 'weekly' && (
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm'>Days of Week</CardTitle>
                <CardDescription>
                  Select which days this task should be completed
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className='flex flex-wrap gap-2'>
                  {DAYS_OF_WEEK.map((day) => {
                    const isSelected = daysOfWeek.includes(day.value)
                    return (
                      <button
                        key={day.value}
                        type='button'
                        onClick={() => toggleDayOfWeek(day.value)}
                        className={cn(
                          'h-10 w-10 rounded-full border text-sm font-medium transition-colors',
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-muted border-border'
                        )}
                      >
                        {day.label}
                      </button>
                    )
                  })}
                </div>
                <div className='mt-3 flex gap-2'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setDaysOfWeek([1, 2, 3, 4, 5])}
                  >
                    Weekdays
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setDaysOfWeek([0, 1, 2, 3, 4, 5, 6])}
                  >
                    Every Day
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setDaysOfWeek([])}
                  >
                    Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Monthly Configuration */}
          {frequency === 'monthly' && (
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm'>Days of Month</CardTitle>
                <CardDescription>
                  Select which days this task should be completed
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='grid grid-cols-7 gap-1'>
                  {DAYS_OF_MONTH.map((day) => {
                    const isSelected = daysOfMonth.includes(day)
                    return (
                      <button
                        key={day}
                        type='button'
                        onClick={() => toggleDayOfMonth(day)}
                        className={cn(
                          'h-8 w-8 rounded text-xs font-medium transition-colors',
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background hover:bg-muted border-border border'
                        )}
                      >
                        {day}
                      </button>
                    )
                  })}
                </div>
                <div className='flex items-center gap-2 border-t pt-2'>
                  <Checkbox
                    id='end_of_month'
                    checked={endOfMonth}
                    onCheckedChange={(checked) =>
                      setEndOfMonth(checked === true)
                    }
                  />
                  <Label
                    htmlFor='end_of_month'
                    className='cursor-pointer text-sm'
                  >
                    Also on the last day of the month
                  </Label>
                </div>
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setDaysOfMonth([1])}
                  >
                    1st Only
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setDaysOfMonth([1, 15])}
                  >
                    1st & 15th
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setDaysOfMonth([])}
                  >
                    Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* Due Time */}
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='due_time' className='flex items-center gap-2'>
                <Clock className='h-4 w-4' />
                Due Time
              </Label>
              <Input
                id='due_time'
                type='time'
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                placeholder='No specific time'
              />
              <p className='text-muted-foreground flex items-center gap-1 text-xs'>
                <Globe className='h-3 w-3' aria-hidden='true' />
                Local to <span className='font-medium'>{browserTimezone}</span>
              </p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='grace_period' className='flex items-center gap-2'>
                <AlertCircle className='h-4 w-4' />
                Grace Period
              </Label>
              <Select
                value={gracePeriodMinutes.toString()}
                onValueChange={(value) =>
                  setGracePeriodMinutes(parseInt(value))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='15'>15 minutes</SelectItem>
                  <SelectItem value='30'>30 minutes</SelectItem>
                  <SelectItem value='60'>1 hour</SelectItem>
                  <SelectItem value='120'>2 hours</SelectItem>
                  <SelectItem value='240'>4 hours</SelectItem>
                </SelectContent>
              </Select>
              <p className='text-muted-foreground text-xs'>
                Time after due before marking as overdue
              </p>
            </div>
          </div>

          <Separator />

          {/* Notifications */}
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='flex items-center gap-2 text-sm'>
                <Bell className='h-4 w-4' />
                Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex items-center justify-between'>
                <div className='space-y-0.5'>
                  <Label htmlFor='remind_before'>Reminder</Label>
                  <p className='text-muted-foreground text-xs'>
                    Send reminder before due time
                  </p>
                </div>
                <Select
                  value={remindBefore.toString()}
                  onValueChange={(value) => setRemindBefore(parseInt(value))}
                >
                  <SelectTrigger className='w-[140px]'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='0'>No reminder</SelectItem>
                    <SelectItem value='15'>15 minutes</SelectItem>
                    <SelectItem value='30'>30 minutes</SelectItem>
                    <SelectItem value='60'>1 hour</SelectItem>
                    <SelectItem value='120'>2 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='flex items-center justify-between'>
                <div className='space-y-0.5'>
                  <Label htmlFor='notify_overdue'>Overdue Notifications</Label>
                  <p className='text-muted-foreground text-xs'>
                    Notify when task becomes overdue
                  </p>
                </div>
                <Switch
                  id='notify_overdue'
                  checked={notifyOnOverdue}
                  onCheckedChange={setNotifyOnOverdue}
                />
              </div>
            </CardContent>
          </Card>

          {/* Summary + next-occurrence preview */}
          <Card className='bg-muted/50'>
            <CardContent className='space-y-3 pt-4'>
              <div className='flex flex-wrap items-center gap-2 text-sm'>
                <Repeat
                  className='text-muted-foreground h-4 w-4'
                  aria-hidden='true'
                />
                <span className='text-muted-foreground'>Schedule:</span>
                <Badge variant='secondary'>{getScheduleSummary()}</Badge>
                {dueTime && (
                  <>
                    <span className='text-muted-foreground'>by</span>
                    <Badge variant='outline'>{dueTime}</Badge>
                  </>
                )}
              </div>
              {nextOccurrences.length > 0 && (
                <div className='text-muted-foreground space-y-1.5 text-xs'>
                  <p className='font-medium'>Next occurrences</p>
                  <ul className='ml-3 list-disc space-y-0.5'>
                    {nextOccurrences.map((d) => (
                      <li key={d.toISOString()}>
                        {d.toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {dueTime && (
                          <>
                            {' · '}
                            {d.toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {frequency !== 'daily' &&
                frequency !== 'weekly' &&
                frequency !== 'monthly' &&
                frequency !== 'as_needed' && (
                  <p className='text-muted-foreground text-xs'>
                    Occurrences depend on shift configuration.
                  </p>
                )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isUpdatingSchedule}>
            {isUpdatingSchedule ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Save className='mr-2 h-4 w-4' />
            )}
            Save Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SchedulingPanel

// Created and developed by Jai Singh
