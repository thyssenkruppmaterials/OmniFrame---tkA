/**
 * Review Settings Component
 * HR Employee Reviews - Configuration page for review cycles, reminders, rating scale, and acknowledgment
 */
import { useState } from 'react'
import {
  IconBell,
  IconCalendarCog,
  IconCheck,
  IconDeviceFloppy,
  IconHandStop,
  IconSettings,
  IconStar,
  IconStarFilled,
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

// ── Types ──────────────────────────────────────────────────────────────────────

interface CycleConfig {
  annualReviewMonth: string
  q1Month: string
  q2Month: string
  q3Month: string
  q4Month: string
}

interface ReminderConfig {
  daysBeforeDue: number
  autoSendReminders: boolean
  reminderFrequency: 'once' | 'daily' | 'weekly'
  notifyReviewer: boolean
  notifyEmployee: boolean
  notifyManager: boolean
}

interface RatingLabel {
  value: number
  label: string
  description: string
}

interface AcknowledgmentConfig {
  requireAcknowledgment: boolean
  acknowledgmentDeadlineDays: number
  allowComments: boolean
  requireSignature: boolean
}

// ── Default State ──────────────────────────────────────────────────────────────

const defaultCycleConfig: CycleConfig = {
  annualReviewMonth: 'december',
  q1Month: 'march',
  q2Month: 'june',
  q3Month: 'september',
  q4Month: 'december',
}

const defaultReminderConfig: ReminderConfig = {
  daysBeforeDue: 7,
  autoSendReminders: true,
  reminderFrequency: 'weekly',
  notifyReviewer: true,
  notifyEmployee: true,
  notifyManager: false,
}

const defaultRatingLabels: RatingLabel[] = [
  {
    value: 1,
    label: 'Needs Improvement',
    description:
      'Performance falls significantly below expectations and requires immediate attention.',
  },
  {
    value: 2,
    label: 'Below Average',
    description:
      'Performance does not consistently meet expectations and requires development.',
  },
  {
    value: 3,
    label: 'Meets Expectations',
    description:
      'Performance consistently meets role requirements and expected standards.',
  },
  {
    value: 4,
    label: 'Exceeds Expectations',
    description:
      'Performance frequently exceeds expectations with notable contributions.',
  },
  {
    value: 5,
    label: 'Outstanding',
    description: 'Performance is exceptional and sets the standard for others.',
  },
]

const defaultAcknowledgment: AcknowledgmentConfig = {
  requireAcknowledgment: true,
  acknowledgmentDeadlineDays: 5,
  allowComments: true,
  requireSignature: false,
}

const months = [
  { value: 'january', label: 'January' },
  { value: 'february', label: 'February' },
  { value: 'march', label: 'March' },
  { value: 'april', label: 'April' },
  { value: 'may', label: 'May' },
  { value: 'june', label: 'June' },
  { value: 'july', label: 'July' },
  { value: 'august', label: 'August' },
  { value: 'september', label: 'September' },
  { value: 'october', label: 'October' },
  { value: 'november', label: 'November' },
  { value: 'december', label: 'December' },
]

// ── Helper ─────────────────────────────────────────────────────────────────────

function RatingStars({ count }: { count: number }) {
  return (
    <div className='flex items-center gap-0.5'>
      {Array.from({ length: 5 }, (_, i) =>
        i < count ? (
          <IconStarFilled key={i} className='h-4 w-4 text-amber-500' />
        ) : (
          <IconStar key={i} className='text-muted-foreground/20 h-4 w-4' />
        )
      )}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

function ReviewSettings() {
  const [cycleConfig, setCycleConfig] =
    useState<CycleConfig>(defaultCycleConfig)
  const [reminderConfig, setReminderConfig] = useState<ReminderConfig>(
    defaultReminderConfig
  )
  const [ratingLabels, setRatingLabels] =
    useState<RatingLabel[]>(defaultRatingLabels)
  const [acknowledgment, setAcknowledgment] = useState<AcknowledgmentConfig>(
    defaultAcknowledgment
  )
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const updateRatingLabel = (
    index: number,
    field: keyof RatingLabel,
    value: string
  ) => {
    setRatingLabels((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  return (
    <div className='space-y-6'>
      {/* Page Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <div className='bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg'>
            <IconSettings className='text-primary h-5 w-5' />
          </div>
          <div>
            <h3 className='text-base font-semibold'>Review Settings</h3>
            <p className='text-muted-foreground text-xs'>
              Configure review cycles, reminders, and rating scales
            </p>
          </div>
        </div>
        <Button className='h-9 gap-1.5' onClick={handleSave}>
          {saved ? (
            <>
              <IconCheck className='h-4 w-4' />
              Saved
            </>
          ) : (
            <>
              <IconDeviceFloppy className='h-4 w-4' />
              Save Settings
            </>
          )}
        </Button>
      </div>

      {/* Review Cycle Configuration */}
      <Card>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-3'>
            <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10'>
              <IconCalendarCog className='h-5 w-5 text-blue-500' />
            </div>
            <div>
              <CardTitle className='text-base'>
                Review Cycle Configuration
              </CardTitle>
              <CardDescription className='text-xs'>
                Set when annual and quarterly reviews are scheduled
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-4 pt-0'>
          <div className='space-y-2'>
            <Label>Annual Review Month</Label>
            <Select
              value={cycleConfig.annualReviewMonth}
              onValueChange={(value) =>
                setCycleConfig((prev) => ({
                  ...prev,
                  annualReviewMonth: value,
                }))
              }
            >
              <SelectTrigger className='w-[200px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              The month in which annual performance reviews begin
            </p>
          </div>

          <Separator />

          <div className='space-y-2'>
            <Label>Quarterly Schedule</Label>
            <p className='text-muted-foreground mb-3 text-xs'>
              Set the end month for each quarter's review cycle
            </p>
            <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
              {(['q1Month', 'q2Month', 'q3Month', 'q4Month'] as const).map(
                (key, idx) => (
                  <div key={key} className='space-y-1.5'>
                    <Label className='text-muted-foreground text-xs'>
                      Q{idx + 1}
                    </Label>
                    <Select
                      value={cycleConfig[key]}
                      onValueChange={(value) =>
                        setCycleConfig((prev) => ({ ...prev, [key]: value }))
                      }
                    >
                      <SelectTrigger className='h-9'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {months.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reminder Settings */}
      <Card>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-3'>
            <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10'>
              <IconBell className='h-5 w-5 text-amber-500' />
            </div>
            <div>
              <CardTitle className='text-base'>Reminder Settings</CardTitle>
              <CardDescription className='text-xs'>
                Configure review deadline reminders and notifications
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-4 pt-0'>
          <div className='flex items-center justify-between'>
            <div>
              <Label>Auto-send Reminders</Label>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                Automatically send email reminders before review due dates
              </p>
            </div>
            <Switch
              checked={reminderConfig.autoSendReminders}
              onCheckedChange={(checked) =>
                setReminderConfig((prev) => ({
                  ...prev,
                  autoSendReminders: checked,
                }))
              }
            />
          </div>

          <Separator />

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label>Days Before Due Date</Label>
              <Input
                type='number'
                min={1}
                max={30}
                value={reminderConfig.daysBeforeDue}
                onChange={(e) =>
                  setReminderConfig((prev) => ({
                    ...prev,
                    daysBeforeDue: parseInt(e.target.value) || 7,
                  }))
                }
                className='w-[120px]'
              />
              <p className='text-muted-foreground text-xs'>
                First reminder sent this many days before the deadline
              </p>
            </div>

            <div className='space-y-2'>
              <Label>Reminder Frequency</Label>
              <Select
                value={reminderConfig.reminderFrequency}
                onValueChange={(value) =>
                  setReminderConfig((prev) => ({
                    ...prev,
                    reminderFrequency:
                      value as ReminderConfig['reminderFrequency'],
                  }))
                }
              >
                <SelectTrigger className='w-[150px]'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='once'>Once</SelectItem>
                  <SelectItem value='daily'>Daily</SelectItem>
                  <SelectItem value='weekly'>Weekly</SelectItem>
                </SelectContent>
              </Select>
              <p className='text-muted-foreground text-xs'>
                How often reminders are sent after the first one
              </p>
            </div>
          </div>

          <Separator />

          <div className='space-y-3'>
            <Label>Notification Recipients</Label>
            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-sm'>Notify Reviewer</p>
                  <p className='text-muted-foreground text-xs'>
                    Send reminders to the person conducting the review
                  </p>
                </div>
                <Switch
                  checked={reminderConfig.notifyReviewer}
                  onCheckedChange={(checked) =>
                    setReminderConfig((prev) => ({
                      ...prev,
                      notifyReviewer: checked,
                    }))
                  }
                />
              </div>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-sm'>Notify Employee</p>
                  <p className='text-muted-foreground text-xs'>
                    Send reminders to the employee being reviewed
                  </p>
                </div>
                <Switch
                  checked={reminderConfig.notifyEmployee}
                  onCheckedChange={(checked) =>
                    setReminderConfig((prev) => ({
                      ...prev,
                      notifyEmployee: checked,
                    }))
                  }
                />
              </div>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-sm'>Notify Manager</p>
                  <p className='text-muted-foreground text-xs'>
                    Send reminders to the employee's direct manager
                  </p>
                </div>
                <Switch
                  checked={reminderConfig.notifyManager}
                  onCheckedChange={(checked) =>
                    setReminderConfig((prev) => ({
                      ...prev,
                      notifyManager: checked,
                    }))
                  }
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rating Scale */}
      <Card>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-3'>
            <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10'>
              <IconStarFilled className='h-5 w-5 text-violet-500' />
            </div>
            <div>
              <CardTitle className='text-base'>Rating Scale</CardTitle>
              <CardDescription className='text-xs'>
                Define the 1-5 rating scale labels and descriptions
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-3 pt-0'>
          {ratingLabels.map((rating, idx) => (
            <div key={rating.value} className='space-y-3 rounded-lg border p-4'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <RatingStars count={rating.value} />
                  <span className='text-muted-foreground text-xs font-medium'>
                    ({rating.value}/5)
                  </span>
                </div>
              </div>
              <div className='grid gap-3 md:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Label</Label>
                  <Input
                    value={rating.label}
                    onChange={(e) =>
                      updateRatingLabel(idx, 'label', e.target.value)
                    }
                    className='h-8 text-sm'
                  />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Description</Label>
                  <Input
                    value={rating.description}
                    onChange={(e) =>
                      updateRatingLabel(idx, 'description', e.target.value)
                    }
                    className='h-8 text-sm'
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Acknowledgment Settings */}
      <Card>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-3'>
            <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10'>
              <IconHandStop className='h-5 w-5 text-green-500' />
            </div>
            <div>
              <CardTitle className='text-base'>
                Acknowledgment Settings
              </CardTitle>
              <CardDescription className='text-xs'>
                Configure employee acknowledgment requirements for completed
                reviews
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-4 pt-0'>
          <div className='flex items-center justify-between'>
            <div>
              <Label>Require Employee Acknowledgment</Label>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                Employees must formally acknowledge their review has been
                received and read
              </p>
            </div>
            <Switch
              checked={acknowledgment.requireAcknowledgment}
              onCheckedChange={(checked) =>
                setAcknowledgment((prev) => ({
                  ...prev,
                  requireAcknowledgment: checked,
                }))
              }
            />
          </div>

          <Separator />

          <div className='space-y-2'>
            <Label>Acknowledgment Deadline (days)</Label>
            <Input
              type='number'
              min={1}
              max={30}
              value={acknowledgment.acknowledgmentDeadlineDays}
              onChange={(e) =>
                setAcknowledgment((prev) => ({
                  ...prev,
                  acknowledgmentDeadlineDays: parseInt(e.target.value) || 5,
                }))
              }
              className='w-[120px]'
              disabled={!acknowledgment.requireAcknowledgment}
            />
            <p className='text-muted-foreground text-xs'>
              Number of days after review completion for the employee to
              acknowledge
            </p>
          </div>

          <Separator />

          <div className='flex items-center justify-between'>
            <div>
              <Label>Allow Employee Comments</Label>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                Let employees add written comments when acknowledging their
                review
              </p>
            </div>
            <Switch
              checked={acknowledgment.allowComments}
              onCheckedChange={(checked) =>
                setAcknowledgment((prev) => ({
                  ...prev,
                  allowComments: checked,
                }))
              }
              disabled={!acknowledgment.requireAcknowledgment}
            />
          </div>

          <div className='flex items-center justify-between'>
            <div>
              <Label>Require Digital Signature</Label>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                Require a digital signature as part of the acknowledgment
                process
              </p>
            </div>
            <Switch
              checked={acknowledgment.requireSignature}
              onCheckedChange={(checked) =>
                setAcknowledgment((prev) => ({
                  ...prev,
                  requireSignature: checked,
                }))
              }
              disabled={!acknowledgment.requireAcknowledgment}
            />
          </div>
        </CardContent>
      </Card>

      {/* Bottom Save Button */}
      <div className='flex justify-end'>
        <Button className='gap-1.5' onClick={handleSave}>
          {saved ? (
            <>
              <IconCheck className='h-4 w-4' />
              Settings Saved
            </>
          ) : (
            <>
              <IconDeviceFloppy className='h-4 w-4' />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

export default ReviewSettings
