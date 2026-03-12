/**
 * Bulk Assign Users Dialog Component
 * Form modal for assigning multiple users to positions and working areas at once
 * Created: December 28, 2025
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Clock, Loader2, Search, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService, {
  type ShiftSchedule,
} from '@/lib/supabase/labor-management.service'
import { logger } from '@/lib/utils/logger'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const bulkAssignmentSchema = z.object({
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

type BulkAssignmentFormData = z.infer<typeof bulkAssignmentSchema>

interface BulkAssignUsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BulkAssignUsersDialog({
  open,
  onOpenChange,
}: BulkAssignUsersDialogProps) {
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
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])

  const form = useForm<BulkAssignmentFormData>({
    resolver: zodResolver(bulkAssignmentSchema),
    defaultValues: {
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
      setSelectedUserIds([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: load data on dialog open only; functions are stable async helpers
  }, [open])

  const loadUsers = async () => {
    try {
      const users = await getAvailableUsers()
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

  // Filter users based on search query - memoized to prevent re-computation
  const filteredUsers = useMemo(() => {
    return availableUsers.filter((user) => {
      if (!userSearchQuery.trim()) return true
      const query = userSearchQuery.toLowerCase()
      return (
        user.full_name?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query)
      )
    })
  }, [availableUsers, userSearchQuery])

  const toggleUserSelection = useCallback((userId: string) => {
    setSelectedUserIds((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId)
      } else {
        return [...prev, userId]
      }
    })
  }, [])

  const selectAllFiltered = useCallback(() => {
    const filteredIds = filteredUsers.map((u) => u.id)
    const allSelected = filteredIds.every((id) => selectedUserIds.includes(id))

    if (allSelected) {
      // Deselect all filtered
      setSelectedUserIds((prev) =>
        prev.filter((id) => !filteredIds.includes(id))
      )
    } else {
      // Select all filtered
      setSelectedUserIds((prev) => [...new Set([...prev, ...filteredIds])])
    }
  }, [filteredUsers, selectedUserIds])

  const clearSelection = useCallback(() => {
    setSelectedUserIds([])
  }, [])

  const onSubmit = async (data: BulkAssignmentFormData) => {
    // Validate that we have selected users
    if (selectedUserIds.length === 0) {
      toast.error('Please select at least one user')
      return
    }

    try {
      setIsSubmitting(true)
      setProgress({ current: 0, total: selectedUserIds.length })

      let successCount = 0
      let failCount = 0

      for (let i = 0; i < selectedUserIds.length; i++) {
        const userId = selectedUserIds[i]
        setProgress({ current: i + 1, total: selectedUserIds.length })

        try {
          await createShiftAssignment({
            user_id: userId,
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
            start_date: data.start_date.toISOString().split('T')[0],
            end_date: data.end_date
              ? data.end_date.toISOString().split('T')[0]
              : undefined,
            is_primary_position: data.is_primary_position,
            assignment_notes: data.assignment_notes || undefined,
            status: 'active',
          })
          successCount++
        } catch (error) {
          logger.error(`Error assigning user ${userId}:`, error)
          failCount++
        }
      }

      if (successCount > 0 && failCount === 0) {
        toast.success(`Successfully assigned ${successCount} user(s)`)
      } else if (successCount > 0 && failCount > 0) {
        toast.warning(`Assigned ${successCount} user(s), ${failCount} failed`)
      } else {
        toast.error('Failed to assign users')
      }

      form.reset()
      setSelectedUserIds([])
      onOpenChange(false)
    } catch (error) {
      logger.error('Error during bulk assignment:', error)
      toast.error('An error occurred during bulk assignment')
    } finally {
      setIsSubmitting(false)
      setProgress({ current: 0, total: 0 })
    }
  }

  const selectedUsers = useMemo(() => {
    return availableUsers.filter((u) => selectedUserIds.includes(u.id))
  }, [availableUsers, selectedUserIds])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Users className='h-5 w-5' />
            Bulk Assign Users to Position
          </DialogTitle>
          <DialogDescription>
            Select multiple team members and assign them to the same position
            and working area with identical settings.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
            {/* User Selection Section */}
            <div className='space-y-4'>
              <div className='flex items-center justify-between'>
                <h4 className='text-primary flex-1 border-b pb-2 text-sm font-semibold'>
                  Select Employees ({selectedUserIds.length} selected)
                </h4>
                <div className='flex items-center gap-2'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={selectAllFiltered}
                  >
                    {filteredUsers.every((u) => selectedUserIds.includes(u.id))
                      ? 'Deselect All'
                      : 'Select All'}
                  </Button>
                  {selectedUserIds.length > 0 && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={clearSelection}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {/* Selected Users Badges */}
              {selectedUserIds.length > 0 && (
                <div className='bg-muted/50 flex flex-wrap gap-2 rounded-lg p-3'>
                  {selectedUsers.map((user) => (
                    <Badge
                      key={user.id}
                      variant='secondary'
                      className='flex items-center gap-1 pr-1'
                    >
                      <span>{user.full_name || user.email}</span>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='hover:bg-destructive/20 h-4 w-4 p-0'
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleUserSelection(user.id)
                        }}
                      >
                        <X className='h-3 w-3' />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}

              {/* User Search and List */}
              <div className='rounded-lg border'>
                <div className='border-b p-3'>
                  <div className='relative'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                    <Input
                      placeholder='Search employees by name or email...'
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      className='pl-9'
                    />
                  </div>
                </div>
                <ScrollArea className='h-[200px]'>
                  <div className='p-2'>
                    {filteredUsers.length === 0 ? (
                      <div className='text-muted-foreground py-6 text-center'>
                        No employees found
                      </div>
                    ) : (
                      <div className='space-y-1'>
                        {filteredUsers.map((user) => {
                          const isSelected = selectedUserIds.includes(user.id)
                          return (
                            <label
                              key={user.id}
                              className={`hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md p-2 ${
                                isSelected ? 'bg-primary/10' : ''
                              }`}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() =>
                                  toggleUserSelection(user.id)
                                }
                              />
                              <div className='min-w-0 flex-1'>
                                <div className='truncate font-medium'>
                                  {user.full_name || 'Unnamed User'}
                                </div>
                                <div className='text-muted-foreground truncate text-sm'>
                                  {user.email}
                                </div>
                              </div>
                              {isSelected && (
                                <Check className='text-primary h-4 w-4' />
                              )}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
              {selectedUserIds.length === 0 && (
                <p className='text-destructive text-sm'>
                  Please select at least one user
                </p>
              )}
            </div>

            {/* Position & Area Assignment */}
            <div className='space-y-4'>
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
            <div className='space-y-4'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Assignment Details
              </h4>

              <div className='grid grid-cols-4 gap-4'>
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
            <div className='space-y-4'>
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
                            .filter((u) => !selectedUserIds.includes(u.id))
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
                            .filter((u) => !selectedUserIds.includes(u.id))
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
            <div className='space-y-4'>
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
                      placeholder='Any special notes or instructions for these assignments...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              {isSubmitting && progress.total > 0 && (
                <div className='text-muted-foreground flex-1 text-sm'>
                  Processing {progress.current} of {progress.total} users...
                </div>
              )}
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
              <Button
                type='submit'
                disabled={isSubmitting || selectedUserIds.length === 0}
              >
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                Assign {selectedUserIds.length} User
                {selectedUserIds.length !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
