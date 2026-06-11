// Created and developed by Jai Singh
/**
 * Edit Assignment Dialog Component
 * Form modal for editing existing user assignments
 * Created: October 25, 2025
 * Updated: December 30, 2025 - Added working area supervisor auto-population and shift schedule dropdown
 */
import { useEffect, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Clock, Loader2 } from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService, {
  type ShiftAssignmentWithDetails,
  type ShiftSchedule,
} from '@/lib/supabase/labor-management.service'
import { logger } from '@/lib/utils/logger'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const assignmentSchema = z.object({
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
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().optional(),
  is_primary_position: z.boolean().default(true),
  assignment_notes: z.string().optional(),
  status: z.enum([
    'active',
    'inactive',
    'on_leave',
    'transferred',
    'terminated',
  ]),
  shift_schedule_id: z.string().min(1, 'Please select a shift schedule'),
})

type AssignmentFormData = z.infer<typeof assignmentSchema>

interface EditAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  assignment: ShiftAssignmentWithDetails | null
}

export function EditAssignmentDialog({
  open,
  onOpenChange,
  assignment,
}: EditAssignmentDialogProps) {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id || ''
  const {
    shiftPositions,
    workingAreas,
    shiftAssignments,
    updateShiftAssignment,
    getAvailableUsers,
  } = useLaborManagement()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [shiftSchedules, setShiftSchedules] = useState<ShiftSchedule[]>([])
  const [availableUsers, setAvailableUsers] = useState<
    Array<{ id: string; full_name?: string | null; email?: string }>
  >([])

  const form = useForm<AssignmentFormData>({
    resolver: zodResolver(assignmentSchema) as never,
    defaultValues: {
      position_id: '',
      working_area_id: '__none__',
      assignment_type: 'permanent',
      shift_pattern: 'fixed',
      direct_supervisor_id: '__none__',
      team_lead_id: '__none__',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      is_primary_position: true,
      assignment_notes: '',
      status: 'active',
      shift_schedule_id: '',
    },
  })

  // Load shift schedules and available users when dialog opens
  useEffect(() => {
    if (open) {
      loadShiftSchedules()
      loadUsers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: load data on dialog open only; functions are stable async helpers
  }, [open])

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

  const loadUsers = async () => {
    try {
      const users = await getAvailableUsers()
      setAvailableUsers(users || [])
    } catch (error) {
      logger.error('Error loading users:', error)
      setAvailableUsers([])
    }
  }

  // Reset form when assignment changes
  useEffect(() => {
    if (assignment && open) {
      form.reset({
        position_id: assignment.position_id,
        working_area_id: assignment.working_area_id || '__none__',
        assignment_type:
          assignment.assignment_type as AssignmentFormData['assignment_type'],
        shift_pattern:
          assignment.shift_pattern as AssignmentFormData['shift_pattern'],
        direct_supervisor_id: assignment.direct_supervisor_id || '__none__',
        team_lead_id: assignment.team_lead_id || '__none__',
        start_date: assignment.start_date,
        end_date: assignment.end_date || '',
        is_primary_position: assignment.is_primary_position,
        assignment_notes: assignment.assignment_notes || '',
        status: assignment.status as AssignmentFormData['status'],
        shift_schedule_id: assignment.shift_schedule_id || '',
      })
    }
  }, [assignment, open, form])

  // Auto-populate supervisor from working area when area is selected
  const selectedAreaId = form.watch('working_area_id')
  useEffect(() => {
    if (selectedAreaId && selectedAreaId !== '__none__') {
      const selectedArea = (
        workingAreas as Array<{
          id: string
          primary_supervisor_id?: string
          backup_supervisor_id?: string
        }>
      ).find((a) => a.id === selectedAreaId)
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
    if (!assignment) return

    try {
      setIsSubmitting(true)

      // Validation: Check area capacity (only if area is changing or status is becoming active)
      if (data.working_area_id && data.status === 'active') {
        const selectedArea = (
          workingAreas as Array<{ id: string; capacity?: number }>
        ).find((a) => a.id === data.working_area_id)
        if (selectedArea && selectedArea.capacity) {
          const currentAssignments = shiftAssignments.filter(
            (a) =>
              a.working_area_id === data.working_area_id &&
              a.status === 'active' &&
              a.id !== assignment.id // Exclude current assignment from count
          ).length

          if (currentAssignments >= selectedArea.capacity) {
            form.setError('working_area_id', {
              message: `Area is at full capacity (${selectedArea.capacity} workers). Current: ${currentAssignments}`,
            })
            setIsSubmitting(false)
            return
          }
        }
      }

      await updateShiftAssignment({
        id: assignment.id,
        updates: {
          position_id: data.position_id,
          working_area_id:
            data.working_area_id && data.working_area_id !== '__none__'
              ? data.working_area_id
              : undefined,
          assignment_type: data.assignment_type,
          shift_pattern: data.shift_pattern,
          shift_schedule_id: data.shift_schedule_id,
          direct_supervisor_id:
            data.direct_supervisor_id &&
            data.direct_supervisor_id !== '__none__'
              ? data.direct_supervisor_id
              : undefined,
          team_lead_id:
            data.team_lead_id && data.team_lead_id !== '__none__'
              ? data.team_lead_id
              : undefined,
          start_date: data.start_date,
          end_date: data.end_date || undefined,
          is_primary_position: data.is_primary_position,
          assignment_notes: data.assignment_notes || undefined,
          status: data.status,
        },
      })

      onOpenChange(false)
    } catch (error) {
      logger.error('Error updating assignment:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Edit Assignment</DialogTitle>
          <DialogDescription>
            Update assignment for{' '}
            {assignment?.user_full_name || assignment?.user_email}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
            {/* Position & Area */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Position & Location
              </h4>

              <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4'>
                <FormField
                  control={form.control}
                  name='position_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Position *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select position' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(
                            shiftPositions as Array<{
                              id: string
                              is_active: boolean
                              position_level: number
                              position_title: string
                            }>
                          )
                            .filter((p) => p.is_active)
                            .sort((a, b) => b.position_level - a.position_level)
                            .map((position) => (
                              <SelectItem key={position.id} value={position.id}>
                                L{position.position_level} -{' '}
                                {position.position_title}
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
                        value={field.value}
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
                          {(
                            workingAreas as Array<{
                              id: string
                              is_active: boolean
                              area_name: string
                            }>
                          )
                            .filter((a) => a.is_active)
                            .map((area) => (
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
              </div>
            </div>

            {/* Assignment Details */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Assignment Details
              </h4>

              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <FormField
                  control={form.control}
                  name='assignment_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type *</FormLabel>
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
                        value={field.value}
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
                  name='status'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status *</FormLabel>
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
                          <SelectItem value='active'>Active</SelectItem>
                          <SelectItem value='inactive'>Inactive</SelectItem>
                          <SelectItem value='on_leave'>On Leave</SelectItem>
                          <SelectItem value='transferred'>
                            Transferred
                          </SelectItem>
                          <SelectItem value='terminated'>Terminated</SelectItem>
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
                        <FormLabel>Primary Position</FormLabel>
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

              <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4'>
                <FormField
                  control={form.control}
                  name='start_date'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date *</FormLabel>
                      <FormControl>
                        <Input type='date' {...field} />
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
                        <Input type='date' {...field} />
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
                            .filter((u) => u.id !== assignment?.user_id)
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
                            .filter((u) => u.id !== assignment?.user_id)
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
                        value={field.value}
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
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Additional Information
              </h4>

              <FormField
                control={form.control}
                name='assignment_notes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='Assignment notes, special instructions, etc...'
                        className='resize-none'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
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
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
