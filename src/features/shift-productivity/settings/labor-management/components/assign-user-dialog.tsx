/**
 * Assign User Dialog Component
 * Form modal for assigning users to positions and working areas
 * Created: October 20, 2025
 * Updated: December 28, 2025 - Added shift schedule template dropdown
 */
import { useEffect, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Clock, Loader2, Search } from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService, {
  type ShiftSchedule,
} from '@/lib/supabase/labor-management.service'
import { logger } from '@/lib/utils/logger'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
import { DatePicker } from '@/components/ui/date-picker'
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
import { Textarea } from '@/components/ui/textarea'

const assignmentSchema = z.object({
  user_id: z.string().min(1, 'Please select a user'),
  position_id: z.string().min(1, 'Please select a position'),
  working_area_id: z.string().optional(),
  assignment_type: z.enum([
    'permanent',
    'temporary',
    'seasonal',
    'contractor',
    'intern',
  ]),
  shift_pattern: z.enum(['fixed', 'rotating', 'flexible', 'on_call', 'split']),
  direct_supervisor_id: z.string().optional(),
  team_lead_id: z.string().optional(),
  start_date: z.date(),
  end_date: z.date().optional(),
  is_primary_position: z.boolean().default(true),
  assignment_notes: z.string().optional(),
  shift_schedule_id: z.string().min(1, 'Please select a shift schedule'),
})

type AssignmentFormData = z.infer<typeof assignmentSchema>

interface AssignUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AssignUserDialog({
  open,
  onOpenChange,
}: AssignUserDialogProps) {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id || ''
  const {
    shiftPositions,
    workingAreas,
    createShiftAssignment,
    getAvailableUsers,
  } = useLaborManagement()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [availableUsers, setAvailableUsers] = useState<
    { id: string; full_name?: string | null; email?: string | null }[]
  >([])
  const [shiftSchedules, setShiftSchedules] = useState<ShiftSchedule[]>([])
  const [userSearchOpen, setUserSearchOpen] = useState(false)

  const form = useForm<AssignmentFormData>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: {
      user_id: '',
      position_id: '',
      working_area_id: '__none__',
      assignment_type: 'permanent',
      shift_pattern: 'fixed',
      direct_supervisor_id: '__none__',
      team_lead_id: '__none__',
      start_date: new Date(),
      end_date: undefined,
      is_primary_position: true,
      assignment_notes: '',
      shift_schedule_id: '',
    },
  })

  // Load available users and shift schedules when dialog opens
  useEffect(() => {
    if (open) {
      loadUsers()
      loadShiftSchedules()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: load data on dialog open only; functions are stable async helpers
  }, [open])

  const loadUsers = async () => {
    try {
      const users = await getAvailableUsers() // Get all available users
      setAvailableUsers(users || [])
    } catch (error) {
      logger.error('Error loading users:', error)
      setAvailableUsers([])
    }
  }

  const loadShiftSchedules = async () => {
    if (!organizationId) return
    try {
      const schedules =
        await LaborManagementService.getShiftSchedules(organizationId)
      setShiftSchedules(schedules.filter((s) => s.is_active))
    } catch (error) {
      logger.error('Error loading shift schedules:', error)
      setShiftSchedules([])
    }
  }

  // Auto-populate supervisor from working area when area is selected
  const selectedAreaId = form.watch('working_area_id')
  useEffect(() => {
    if (selectedAreaId && selectedAreaId !== '__none__') {
      const selectedArea = workingAreas.find((a) => a.id === selectedAreaId)
      if (selectedArea) {
        // Auto-populate direct supervisor from area's primary supervisor
        if (selectedArea.primary_supervisor_id) {
          form.setValue(
            'direct_supervisor_id',
            selectedArea.primary_supervisor_id
          )
        } else {
          form.setValue('direct_supervisor_id', '__none__')
        }
        // Auto-populate team lead from area's backup supervisor (common pattern)
        if (selectedArea.backup_supervisor_id) {
          form.setValue('team_lead_id', selectedArea.backup_supervisor_id)
        } else {
          form.setValue('team_lead_id', '__none__')
        }
      }
    } else if (selectedAreaId === '__none__') {
      // Reset supervisor fields when no area is selected
      form.setValue('direct_supervisor_id', '__none__')
      form.setValue('team_lead_id', '__none__')
    }
  }, [selectedAreaId, workingAreas, form])

  const onSubmit = async (data: AssignmentFormData) => {
    try {
      setIsSubmitting(true)

      // Validation: Check area capacity
      // Note: Removed capacity check as shiftAssignments is not available in this context
      // This validation should be performed on the backend or via a separate API call

      await createShiftAssignment({
        user_id: data.user_id,
        position_id: data.position_id,
        working_area_id:
          data.working_area_id && data.working_area_id !== '__none__'
            ? data.working_area_id
            : undefined,
        assignment_type: data.assignment_type,
        shift_pattern: data.shift_pattern,
        shift_schedule_id: data.shift_schedule_id,
        direct_supervisor_id:
          data.direct_supervisor_id && data.direct_supervisor_id !== '__none__'
            ? data.direct_supervisor_id
            : undefined,
        team_lead_id:
          data.team_lead_id && data.team_lead_id !== '__none__'
            ? data.team_lead_id
            : undefined,
        start_date: data.start_date.toISOString().split('T')[0],
        end_date: data.end_date
          ? data.end_date.toISOString().split('T')[0]
          : undefined,
        is_primary_position: data.is_primary_position,
        assignment_notes: data.assignment_notes || undefined,
        status: 'active',
      })

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Error creating assignment:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedUser = availableUsers.find(
    (u) => u.id === form.watch('user_id')
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Assign User to Position</DialogTitle>
          <DialogDescription>
            Assign a team member to an organizational position and working area
            with shift schedule.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
            {/* User Selection */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Employee Selection
              </h4>

              <FormField
                control={form.control}
                name='user_id'
                render={({ field }) => (
                  <FormItem className='flex flex-col'>
                    <FormLabel>Select Employee *</FormLabel>
                    <Popover
                      open={userSearchOpen}
                      onOpenChange={setUserSearchOpen}
                    >
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant='outline'
                            role='combobox'
                            className='w-full justify-between'
                          >
                            {selectedUser ? (
                              <span>
                                {selectedUser.full_name} ({selectedUser.email})
                              </span>
                            ) : (
                              <span className='text-muted-foreground'>
                                Search and select employee...
                              </span>
                            )}
                            <Search className='ml-2 h-4 w-4 shrink-0 opacity-50' />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className='w-[600px] p-0'>
                        <Command>
                          <CommandInput placeholder='Search employees by name or email...' />
                          <CommandEmpty>No employees found.</CommandEmpty>
                          <CommandGroup className='max-h-64 overflow-y-auto'>
                            {availableUsers.map((user) => (
                              <CommandItem
                                key={user.id}
                                onSelect={() => {
                                  field.onChange(user.id)
                                  setUserSearchOpen(false)
                                }}
                              >
                                <div className='flex flex-col'>
                                  <span className='font-medium'>
                                    {user.full_name || user.email}
                                  </span>
                                  <span className='text-muted-foreground text-sm'>
                                    {user.email}
                                  </span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormDescription>
                      Search for an employee to assign
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Position & Area Assignment */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Position & Location
              </h4>

              <div className='grid grid-cols-2 gap-6'>
                <FormField
                  control={form.control}
                  name='position_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Position *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select position' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {shiftPositions
                            .sort((a, b) => b.position_level - a.position_level)
                            .map((position) => (
                              <SelectItem key={position.id} value={position.id}>
                                L{position.position_level} -{' '}
                                {position.position_title} (
                                {position.position_type})
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
                  name='working_area_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Working Area</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select area (optional)' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='__none__'>
                            — No Specific Area —
                          </SelectItem>
                          {workingAreas.map((area) => (
                            <SelectItem key={area.id} value={area.id}>
                              {area.area_name} ({area.area_type})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Optional working area assignment
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Assignment Details */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Assignment Details
              </h4>

              <div className='grid grid-cols-3 gap-4'>
                <FormField
                  control={form.control}
                  name='assignment_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assignment Type *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='permanent'>Permanent</SelectItem>
                          <SelectItem value='temporary'>Temporary</SelectItem>
                          <SelectItem value='seasonal'>Seasonal</SelectItem>
                          <SelectItem value='contractor'>Contractor</SelectItem>
                          <SelectItem value='intern'>Intern</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='shift_pattern'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Shift Pattern *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='fixed'>Fixed</SelectItem>
                          <SelectItem value='rotating'>Rotating</SelectItem>
                          <SelectItem value='flexible'>Flexible</SelectItem>
                          <SelectItem value='on_call'>On Call</SelectItem>
                          <SelectItem value='split'>Split Shift</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='is_primary_position'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm'>
                      <div className='space-y-0.5'>
                        <FormLabel className='text-xs'>
                          Primary Position
                        </FormLabel>
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
              </div>

              <div className='grid grid-cols-4 gap-6'>
                <FormField
                  control={form.control}
                  name='start_date'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date *</FormLabel>
                      <FormControl>
                        <DatePicker
                          date={field.value}
                          onSelect={field.onChange}
                          placeholder='Select start date'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='end_date'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date</FormLabel>
                      <FormControl>
                        <DatePicker
                          date={field.value}
                          onSelect={field.onChange}
                          placeholder='Select end date (optional)'
                        />
                      </FormControl>
                      <FormDescription>
                        Leave blank for permanent
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Reporting Structure */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Reporting Structure
              </h4>

              <div className='grid grid-cols-2 gap-6'>
                <FormField
                  control={form.control}
                  name='direct_supervisor_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Direct Supervisor</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select supervisor (optional)' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='__none__'>
                            — No Supervisor —
                          </SelectItem>
                          {availableUsers
                            .filter((u) => u.id !== form.watch('user_id'))
                            .map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.full_name || user.email}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Auto-populated from area's primary supervisor if set
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='team_lead_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team Lead</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select team lead (optional)' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='__none__'>
                            — No Team Lead —
                          </SelectItem>
                          {availableUsers
                            .filter((u) => u.id !== form.watch('user_id'))
                            .map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.full_name || user.email}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Auto-populated from area's backup supervisor if set
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Shift Schedule */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Shift Schedule
              </h4>

              <div className='grid grid-cols-2 gap-6'>
                <FormField
                  control={form.control}
                  name='shift_schedule_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Shift Schedule Template *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select a shift schedule' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {shiftSchedules.length === 0 ? (
                            <SelectItem value='__none__' disabled>
                              No shift schedules available
                            </SelectItem>
                          ) : (
                            shiftSchedules.map((schedule) => (
                              <SelectItem key={schedule.id} value={schedule.id}>
                                <div className='flex items-center gap-2'>
                                  {schedule.color && (
                                    <div
                                      className='h-3 w-3 rounded-full'
                                      style={{
                                        backgroundColor: schedule.color,
                                      }}
                                    />
                                  )}
                                  <span>{schedule.schedule_name}</span>
                                  <span className='text-muted-foreground text-xs'>
                                    ({schedule.shift_start_time} -{' '}
                                    {schedule.shift_end_time})
                                  </span>
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Select a pre-defined shift schedule from Team Settings
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Preview of selected schedule */}
                {form.watch('shift_schedule_id') && (
                  <div className='bg-muted/50 space-y-2 rounded-lg p-4'>
                    {(() => {
                      const schedule = shiftSchedules.find(
                        (s) => s.id === form.watch('shift_schedule_id')
                      )
                      if (!schedule) return null
                      const dayNames = [
                        '',
                        'Mon',
                        'Tue',
                        'Wed',
                        'Thu',
                        'Fri',
                        'Sat',
                        'Sun',
                      ]
                      return (
                        <>
                          <div className='flex items-center gap-2 font-medium'>
                            <Clock className='h-4 w-4' />
                            <span>Schedule Preview</span>
                          </div>
                          <div className='space-y-1 text-sm'>
                            <div className='flex justify-between'>
                              <span className='text-muted-foreground'>
                                Hours:
                              </span>
                              <span>
                                {schedule.shift_start_time} -{' '}
                                {schedule.shift_end_time}
                              </span>
                            </div>
                            <div className='flex justify-between'>
                              <span className='text-muted-foreground'>
                                Days:
                              </span>
                              <span>
                                {schedule.operating_days
                                  ?.map((d) => dayNames[d])
                                  .join(', ')}
                              </span>
                            </div>
                            {schedule.breaks && schedule.breaks.length > 0 && (
                              <div className='flex justify-between'>
                                <span className='text-muted-foreground'>
                                  Breaks:
                                </span>
                                <span>{schedule.breaks.length} break(s)</span>
                              </div>
                            )}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            <FormField
              control={form.control}
              name='assignment_notes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assignment Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Any special notes or instructions for this assignment...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  form.reset()
                  onOpenChange(false)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                Assign User
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
