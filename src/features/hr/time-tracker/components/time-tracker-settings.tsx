/**
 * Time Tracker Settings Component
 * Configuration page for pay periods, overtime rules, break policies, and notifications.
 */
import { useState } from 'react'
import {
  IconCalendarEvent,
  IconClock,
  IconCoffee,
  IconBell,
  IconDeviceFloppy,
  IconRotateClockwise,
  IconInfoCircle,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

// ── Types ──────────────────────────────────────────────────────────────────

interface PayPeriodConfig {
  type: 'weekly' | 'biweekly'
  startDay: string
}

interface OvertimeRules {
  dailyThreshold: number
  weeklyThreshold: number
  dailyOvertimeEnabled: boolean
  weeklyOvertimeEnabled: boolean
}

interface BreakPolicies {
  autoDeductBreaks: boolean
  minimumBreakDuration: number
  breakAfterHours: number
  paidBreaks: boolean
}

interface NotificationSettings {
  notifyMissedPunch: boolean
  notifyOvertime: boolean
  notifyTimecardSubmission: boolean
  notifyApprovalRequired: boolean
  notifyPayPeriodEnding: boolean
  reminderHoursBefore: number
}

// ── Component ──────────────────────────────────────────────────────────────

function TimeTrackerSettings() {
  const [payPeriod, setPayPeriod] = useState<PayPeriodConfig>({
    type: 'biweekly',
    startDay: 'monday',
  })

  const [overtime, setOvertime] = useState<OvertimeRules>({
    dailyThreshold: 8,
    weeklyThreshold: 40,
    dailyOvertimeEnabled: true,
    weeklyOvertimeEnabled: true,
  })

  const [breakPolicy, setBreakPolicy] = useState<BreakPolicies>({
    autoDeductBreaks: true,
    minimumBreakDuration: 30,
    breakAfterHours: 5,
    paidBreaks: false,
  })

  const [notifications, setNotifications] = useState<NotificationSettings>({
    notifyMissedPunch: true,
    notifyOvertime: true,
    notifyTimecardSubmission: true,
    notifyApprovalRequired: true,
    notifyPayPeriodEnding: true,
    reminderHoursBefore: 24,
  })

  const [isSaving, setIsSaving] = useState(false)

  const handleSave = () => {
    setIsSaving(true)
    // Simulate save
    setTimeout(() => setIsSaving(false), 1500)
  }

  return (
    <div className='space-y-6'>
      {/* Pay Period Configuration */}
      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30'>
              <IconCalendarEvent className='h-5 w-5 text-blue-600' />
            </div>
            <div>
              <CardTitle className='text-lg'>
                Pay Period Configuration
              </CardTitle>
              <CardDescription>
                Configure pay period frequency and start day
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid grid-cols-1 gap-6 sm:grid-cols-2'>
            {/* Pay Period Type */}
            <div className='space-y-2'>
              <Label>Pay Period Frequency</Label>
              <div className='flex gap-2'>
                <button
                  onClick={() =>
                    setPayPeriod((p) => ({ ...p, type: 'weekly' }))
                  }
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                    payPeriod.type === 'weekly'
                      ? 'border-primary bg-primary/5 text-primary ring-primary/20 ring-1'
                      : 'hover:border-border hover:bg-muted/50'
                  }`}
                >
                  <div className='text-center'>
                    <p className='font-semibold'>Weekly</p>
                    <p className='text-muted-foreground mt-1 text-xs'>
                      7-day pay cycle
                    </p>
                  </div>
                </button>
                <button
                  onClick={() =>
                    setPayPeriod((p) => ({ ...p, type: 'biweekly' }))
                  }
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                    payPeriod.type === 'biweekly'
                      ? 'border-primary bg-primary/5 text-primary ring-primary/20 ring-1'
                      : 'hover:border-border hover:bg-muted/50'
                  }`}
                >
                  <div className='text-center'>
                    <p className='font-semibold'>Bi-Weekly</p>
                    <p className='text-muted-foreground mt-1 text-xs'>
                      14-day pay cycle
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Start Day */}
            <div className='space-y-2'>
              <Label>Start Day of Week</Label>
              <Select
                value={payPeriod.startDay}
                onValueChange={(v) =>
                  setPayPeriod((p) => ({ ...p, startDay: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='sunday'>Sunday</SelectItem>
                  <SelectItem value='monday'>Monday</SelectItem>
                  <SelectItem value='tuesday'>Tuesday</SelectItem>
                  <SelectItem value='wednesday'>Wednesday</SelectItem>
                  <SelectItem value='thursday'>Thursday</SelectItem>
                  <SelectItem value='friday'>Friday</SelectItem>
                  <SelectItem value='saturday'>Saturday</SelectItem>
                </SelectContent>
              </Select>
              <p className='text-muted-foreground flex items-start gap-1.5 text-xs'>
                <IconInfoCircle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
                This determines when each pay period begins for timecard
                calculations.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Overtime Rules */}
      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='rounded-lg bg-amber-100 p-2 dark:bg-amber-900/30'>
              <IconClock className='h-5 w-5 text-amber-600' />
            </div>
            <div>
              <CardTitle className='text-lg'>Overtime Rules</CardTitle>
              <CardDescription>
                Set daily and weekly overtime thresholds
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* Daily Overtime */}
          <div className='flex items-start justify-between gap-8'>
            <div className='space-y-1'>
              <Label>Daily Overtime</Label>
              <p className='text-muted-foreground text-sm'>
                Automatically calculate overtime after daily threshold is
                exceeded.
              </p>
            </div>
            <Switch
              checked={overtime.dailyOvertimeEnabled}
              onCheckedChange={(checked) =>
                setOvertime((p) => ({ ...p, dailyOvertimeEnabled: checked }))
              }
            />
          </div>
          {overtime.dailyOvertimeEnabled && (
            <div className='ml-0 flex items-center gap-3'>
              <Label className='text-sm whitespace-nowrap'>
                Daily Threshold:
              </Label>
              <Input
                type='number'
                className='w-[100px]'
                value={overtime.dailyThreshold}
                onChange={(e) =>
                  setOvertime((p) => ({
                    ...p,
                    dailyThreshold: parseFloat(e.target.value) || 0,
                  }))
                }
                min={1}
                max={24}
                step={0.5}
              />
              <span className='text-muted-foreground text-sm'>
                hours per day
              </span>
            </div>
          )}

          <Separator />

          {/* Weekly Overtime */}
          <div className='flex items-start justify-between gap-8'>
            <div className='space-y-1'>
              <Label>Weekly Overtime</Label>
              <p className='text-muted-foreground text-sm'>
                Automatically calculate overtime after weekly threshold is
                exceeded.
              </p>
            </div>
            <Switch
              checked={overtime.weeklyOvertimeEnabled}
              onCheckedChange={(checked) =>
                setOvertime((p) => ({ ...p, weeklyOvertimeEnabled: checked }))
              }
            />
          </div>
          {overtime.weeklyOvertimeEnabled && (
            <div className='ml-0 flex items-center gap-3'>
              <Label className='text-sm whitespace-nowrap'>
                Weekly Threshold:
              </Label>
              <Input
                type='number'
                className='w-[100px]'
                value={overtime.weeklyThreshold}
                onChange={(e) =>
                  setOvertime((p) => ({
                    ...p,
                    weeklyThreshold: parseFloat(e.target.value) || 0,
                  }))
                }
                min={1}
                max={168}
                step={1}
              />
              <span className='text-muted-foreground text-sm'>
                hours per week
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Break Policies */}
      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='rounded-lg bg-green-100 p-2 dark:bg-green-900/30'>
              <IconCoffee className='h-5 w-5 text-green-600' />
            </div>
            <div>
              <CardTitle className='text-lg'>Break Policies</CardTitle>
              <CardDescription>
                Configure automatic break deduction and break rules
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* Auto-deduct breaks */}
          <div className='flex items-start justify-between gap-8'>
            <div className='space-y-1'>
              <Label>Auto-Deduct Breaks</Label>
              <p className='text-muted-foreground text-sm'>
                Automatically deduct break time from total worked hours.
              </p>
            </div>
            <Switch
              checked={breakPolicy.autoDeductBreaks}
              onCheckedChange={(checked) =>
                setBreakPolicy((p) => ({ ...p, autoDeductBreaks: checked }))
              }
            />
          </div>

          {breakPolicy.autoDeductBreaks && (
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label className='text-sm'>Minimum Break Duration</Label>
                <div className='flex items-center gap-3'>
                  <Input
                    type='number'
                    className='w-[100px]'
                    value={breakPolicy.minimumBreakDuration}
                    onChange={(e) =>
                      setBreakPolicy((p) => ({
                        ...p,
                        minimumBreakDuration: parseInt(e.target.value) || 0,
                      }))
                    }
                    min={0}
                    max={120}
                    step={5}
                  />
                  <span className='text-muted-foreground text-sm'>minutes</span>
                </div>
              </div>
              <div className='space-y-2'>
                <Label className='text-sm'>Required Break After</Label>
                <div className='flex items-center gap-3'>
                  <Input
                    type='number'
                    className='w-[100px]'
                    value={breakPolicy.breakAfterHours}
                    onChange={(e) =>
                      setBreakPolicy((p) => ({
                        ...p,
                        breakAfterHours: parseFloat(e.target.value) || 0,
                      }))
                    }
                    min={1}
                    max={12}
                    step={0.5}
                  />
                  <span className='text-muted-foreground text-sm'>
                    consecutive hours
                  </span>
                </div>
              </div>
            </div>
          )}

          <Separator />

          {/* Paid breaks */}
          <div className='flex items-start justify-between gap-8'>
            <div className='space-y-1'>
              <Label>Paid Breaks</Label>
              <p className='text-muted-foreground text-sm'>
                Count break time as paid working hours.
              </p>
            </div>
            <Switch
              checked={breakPolicy.paidBreaks}
              onCheckedChange={(checked) =>
                setBreakPolicy((p) => ({ ...p, paidBreaks: checked }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='rounded-lg bg-purple-100 p-2 dark:bg-purple-900/30'>
              <IconBell className='h-5 w-5 text-purple-600' />
            </div>
            <div>
              <CardTitle className='text-lg'>Notification Settings</CardTitle>
              <CardDescription>
                Configure alerts and reminders for time tracking events
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-5'>
          <div className='flex items-start justify-between gap-8'>
            <div className='space-y-1'>
              <Label>Missed Punch Notifications</Label>
              <p className='text-muted-foreground text-sm'>
                Alert when an employee misses a clock-in or clock-out.
              </p>
            </div>
            <Switch
              checked={notifications.notifyMissedPunch}
              onCheckedChange={(checked) =>
                setNotifications((p) => ({ ...p, notifyMissedPunch: checked }))
              }
            />
          </div>

          <Separator />

          <div className='flex items-start justify-between gap-8'>
            <div className='space-y-1'>
              <Label>Overtime Notifications</Label>
              <p className='text-muted-foreground text-sm'>
                Alert when an employee approaches or exceeds overtime
                thresholds.
              </p>
            </div>
            <Switch
              checked={notifications.notifyOvertime}
              onCheckedChange={(checked) =>
                setNotifications((p) => ({ ...p, notifyOvertime: checked }))
              }
            />
          </div>

          <Separator />

          <div className='flex items-start justify-between gap-8'>
            <div className='space-y-1'>
              <Label>Timecard Submission</Label>
              <p className='text-muted-foreground text-sm'>
                Notify supervisors when a timecard is submitted for approval.
              </p>
            </div>
            <Switch
              checked={notifications.notifyTimecardSubmission}
              onCheckedChange={(checked) =>
                setNotifications((p) => ({
                  ...p,
                  notifyTimecardSubmission: checked,
                }))
              }
            />
          </div>

          <Separator />

          <div className='flex items-start justify-between gap-8'>
            <div className='space-y-1'>
              <Label>Approval Required</Label>
              <p className='text-muted-foreground text-sm'>
                Remind supervisors of pending timecard approvals.
              </p>
            </div>
            <Switch
              checked={notifications.notifyApprovalRequired}
              onCheckedChange={(checked) =>
                setNotifications((p) => ({
                  ...p,
                  notifyApprovalRequired: checked,
                }))
              }
            />
          </div>

          <Separator />

          <div className='flex items-start justify-between gap-8'>
            <div className='space-y-1'>
              <Label>Pay Period Ending Reminder</Label>
              <p className='text-muted-foreground text-sm'>
                Remind employees to review and submit timecards before the
                period closes.
              </p>
            </div>
            <Switch
              checked={notifications.notifyPayPeriodEnding}
              onCheckedChange={(checked) =>
                setNotifications((p) => ({
                  ...p,
                  notifyPayPeriodEnding: checked,
                }))
              }
            />
          </div>

          {notifications.notifyPayPeriodEnding && (
            <div className='ml-0 flex items-center gap-3'>
              <Label className='text-sm whitespace-nowrap'>Remind:</Label>
              <Input
                type='number'
                className='w-[80px]'
                value={notifications.reminderHoursBefore}
                onChange={(e) =>
                  setNotifications((p) => ({
                    ...p,
                    reminderHoursBefore: parseInt(e.target.value) || 0,
                  }))
                }
                min={1}
                max={72}
              />
              <span className='text-muted-foreground text-sm'>
                hours before period end
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className='bg-muted/30 flex items-center justify-between rounded-lg border p-4'>
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <IconInfoCircle className='h-4 w-4' />
          Changes will apply to the next pay period after saving.
        </div>
        <div className='flex items-center gap-3'>
          <Button variant='outline' className='gap-1.5'>
            <IconRotateClockwise className='h-4 w-4' />
            Reset Defaults
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className='gap-1.5'>
            <IconDeviceFloppy className='h-4 w-4' />
            {isSaving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default TimeTrackerSettings
