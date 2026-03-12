/**
 * Step 4: Position Assignment
 * Assign job position, working area, and supervisor
 * Updated: January 2026 - Added working area selection with auto-population of supervisors
 */
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import {
  Briefcase,
  UserCheck,
  Users,
  Building,
  MapPin,
  Info,
} from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useOnboarding } from '../../context/onboarding-context'
import { OnboardingService } from '../../services/onboarding.service'
import {
  PositionAssignmentData,
  positionAssignmentSchema,
} from '../../types/onboarding.types'

// Extended form type to include working area (for auto-populating supervisors)
interface ExtendedPositionFormData extends PositionAssignmentData {
  working_area_id?: string
}

export function Step4PositionAssignment() {
  const { state, updateStepData } = useOnboarding()
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  // Fetch positions
  const { data: positions, isLoading: positionsLoading } = useQuery({
    queryKey: ['onboarding-positions', organizationId],
    queryFn: () => OnboardingService.getAvailablePositions(organizationId!),
    enabled: !!organizationId,
  })

  // Fetch working areas (with supervisor info for auto-population)
  const { data: workingAreas, isLoading: areasLoading } = useQuery({
    queryKey: ['onboarding-working-areas', organizationId],
    queryFn: () => OnboardingService.getAvailableWorkingAreas(organizationId!),
    enabled: !!organizationId,
  })

  // Fetch all available users for supervisor/team lead selection
  const { data: availableUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['onboarding-available-users', organizationId],
    queryFn: () => OnboardingService.getAvailableUsers(organizationId!),
    enabled: !!organizationId,
  })

  const form = useForm<ExtendedPositionFormData>({
    resolver: zodResolver(positionAssignmentSchema),
    defaultValues: {
      position_id: state.positionAssignment?.position_id || '',
      position_title: state.positionAssignment?.position_title || '',
      supervisor_id: state.positionAssignment?.supervisor_id || '',
      supervisor_name: state.positionAssignment?.supervisor_name || '',
      team_lead_id: state.positionAssignment?.team_lead_id || null,
      team_lead_name: state.positionAssignment?.team_lead_name || '',
      is_primary_position:
        state.positionAssignment?.is_primary_position ?? true,
      assignment_type: state.positionAssignment?.assignment_type || 'permanent',
      working_area_id: state.workingArea?.primary_area_id || '',
    },
    mode: 'onChange',
  })

  const selectedPositionId = form.watch('position_id')
  const selectedPosition = positions?.find((p) => p.id === selectedPositionId)
  const selectedWorkingAreaId = form.watch('working_area_id')
  const selectedWorkingArea = workingAreas?.find(
    (a) => a.id === selectedWorkingAreaId
  )
  const selectedSupervisorId = form.watch('supervisor_id')
  const selectedSupervisor = availableUsers?.find(
    (u) => u.id === selectedSupervisorId
  )
  const selectedTeamLeadId = form.watch('team_lead_id')
  const selectedTeamLead = availableUsers?.find(
    (u) => u.id === selectedTeamLeadId
  )

  // Watch form changes and update context
  useEffect(() => {
    const subscription = form.watch((data) => {
      if (data) {
        // Update position assignment data
        updateStepData('positionAssignment', {
          position_id: data.position_id || '',
          position_title: data.position_title || '',
          supervisor_id: data.supervisor_id || '',
          supervisor_name: data.supervisor_name || '',
          team_lead_id: data.team_lead_id || null,
          team_lead_name: data.team_lead_name || '',
          is_primary_position: data.is_primary_position ?? true,
          assignment_type: data.assignment_type || 'permanent',
        } as PositionAssignmentData)

        // Also update working area data if area is selected
        if (data.working_area_id && selectedWorkingArea) {
          updateStepData('workingArea', {
            primary_area_id: data.working_area_id,
            primary_area_name: selectedWorkingArea.area_name,
            secondary_areas: state.workingArea?.secondary_areas || [],
          })
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [
    form,
    updateStepData,
    selectedWorkingArea,
    state.workingArea?.secondary_areas,
  ])

  // Auto-populate supervisor and team lead when working area is selected
  useEffect(() => {
    if (selectedWorkingAreaId && selectedWorkingArea) {
      // Auto-populate direct supervisor from area's primary supervisor
      if (selectedWorkingArea.primary_supervisor_id) {
        form.setValue(
          'supervisor_id',
          selectedWorkingArea.primary_supervisor_id
        )
        form.setValue(
          'supervisor_name',
          selectedWorkingArea.primary_supervisor_name || ''
        )
      }
      // Auto-populate team lead from area's backup supervisor
      if (selectedWorkingArea.backup_supervisor_id) {
        form.setValue('team_lead_id', selectedWorkingArea.backup_supervisor_id)
        form.setValue(
          'team_lead_name',
          selectedWorkingArea.backup_supervisor_name || ''
        )
      }
    }
  }, [selectedWorkingAreaId, selectedWorkingArea, form])

  // Update display names when selections change
  useEffect(() => {
    if (selectedPosition) {
      form.setValue('position_title', selectedPosition.position_title)
    }
  }, [selectedPosition, form])

  useEffect(() => {
    if (selectedSupervisor) {
      form.setValue('supervisor_name', selectedSupervisor.full_name)
    }
  }, [selectedSupervisor, form])

  useEffect(() => {
    if (selectedTeamLead) {
      form.setValue('team_lead_name', selectedTeamLead.full_name)
    }
  }, [selectedTeamLead, form])

  const isLoading = positionsLoading || areasLoading || usersLoading

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Briefcase className='h-5 w-5' />
            Position Assignment
          </CardTitle>
          <CardDescription>
            Assign the employee to a job position and reporting structure
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className='space-y-6'>
              {/* Position Selection */}
              <FormField
                control={form.control}
                name='position_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Position *</FormLabel>
                    <FormControl>
                      {isLoading ? (
                        <Skeleton className='h-10 w-full' />
                      ) : (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Select a position...' />
                          </SelectTrigger>
                          <SelectContent>
                            {positions?.map((position) => (
                              <SelectItem key={position.id} value={position.id}>
                                <div className='flex items-center gap-2'>
                                  <span>{position.position_title}</span>
                                  {position.is_supervisory && (
                                    <Badge
                                      variant='secondary'
                                      className='text-xs'
                                    >
                                      Supervisory
                                    </Badge>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Selected Position Details */}
              {selectedPosition && (
                <div className='space-y-2 rounded-lg border p-4'>
                  <div className='flex items-center gap-2 text-sm'>
                    <Building className='text-muted-foreground h-4 w-4' />
                    <span className='text-muted-foreground'>Department:</span>
                    <span>
                      {selectedPosition.department || 'Not specified'}
                    </span>
                  </div>
                  <div className='flex items-center gap-2 text-sm'>
                    <Users className='text-muted-foreground h-4 w-4' />
                    <span className='text-muted-foreground'>Headcount:</span>
                    <span>
                      {selectedPosition.current_headcount} /{' '}
                      {selectedPosition.headcount_budget}
                    </span>
                  </div>
                  <div className='flex items-center gap-2 text-sm'>
                    <span className='text-muted-foreground'>
                      Position Level:
                    </span>
                    <Badge variant='outline'>
                      Level {selectedPosition.position_level}
                    </Badge>
                  </div>
                </div>
              )}

              {/* Working Area Selection */}
              <FormField
                control={form.control}
                name='working_area_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='flex items-center gap-2'>
                      <MapPin className='h-4 w-4' />
                      Working Area *
                    </FormLabel>
                    <FormControl>
                      {isLoading ? (
                        <Skeleton className='h-10 w-full' />
                      ) : (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Select a working area...' />
                          </SelectTrigger>
                          <SelectContent>
                            {workingAreas?.map((area) => (
                              <SelectItem key={area.id} value={area.id}>
                                <div className='flex items-center gap-2'>
                                  <span>{area.area_name}</span>
                                  <Badge variant='outline' className='text-xs'>
                                    {area.area_type}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </FormControl>
                    <FormDescription>
                      Selecting an area will auto-populate the supervisor and
                      team lead
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Selected Area Details */}
              {selectedWorkingArea && (
                <div className='space-y-2 rounded-lg border p-4'>
                  <div className='flex items-center gap-2 text-sm'>
                    <MapPin className='text-muted-foreground h-4 w-4' />
                    <span className='text-muted-foreground'>Area:</span>
                    <span>{selectedWorkingArea.area_name}</span>
                    <Badge variant='secondary' className='text-xs'>
                      {selectedWorkingArea.area_type}
                    </Badge>
                  </div>
                  {selectedWorkingArea.primary_supervisor_name && (
                    <div className='flex items-center gap-2 text-sm'>
                      <UserCheck className='text-muted-foreground h-4 w-4' />
                      <span className='text-muted-foreground'>
                        Area Supervisor:
                      </span>
                      <span className='font-medium'>
                        {selectedWorkingArea.primary_supervisor_name}
                      </span>
                    </div>
                  )}
                  {selectedWorkingArea.backup_supervisor_name && (
                    <div className='flex items-center gap-2 text-sm'>
                      <Users className='text-muted-foreground h-4 w-4' />
                      <span className='text-muted-foreground'>
                        Backup Supervisor:
                      </span>
                      <span className='font-medium'>
                        {selectedWorkingArea.backup_supervisor_name}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Info about auto-population */}
              {selectedWorkingArea &&
                (selectedWorkingArea.primary_supervisor_id ||
                  selectedWorkingArea.backup_supervisor_id) && (
                  <Alert>
                    <Info className='h-4 w-4' />
                    <AlertDescription>
                      Supervisor and Team Lead have been auto-populated from the
                      selected working area. You can still override these
                      selections below.
                    </AlertDescription>
                  </Alert>
                )}

              {/* Supervisor Selection */}
              <FormField
                control={form.control}
                name='supervisor_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='flex items-center gap-2'>
                      <UserCheck className='h-4 w-4' />
                      Direct Supervisor
                    </FormLabel>
                    <FormControl>
                      {isLoading ? (
                        <Skeleton className='h-10 w-full' />
                      ) : (
                        <Select
                          value={field.value || undefined}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Select a supervisor (optional)...' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='__none__'>
                              — No Supervisor —
                            </SelectItem>
                            {availableUsers?.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                <div className='flex flex-col'>
                                  <span>{user.full_name}</span>
                                  <span className='text-muted-foreground text-xs'>
                                    {user.email}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </FormControl>
                    <FormDescription>
                      {selectedWorkingArea?.primary_supervisor_id
                        ? 'Auto-populated from working area. You can override if needed.'
                        : 'Optional: Select the supervisor who will oversee this employee'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Team Lead (Optional) */}
              <FormField
                control={form.control}
                name='team_lead_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team Lead (Optional)</FormLabel>
                    <FormControl>
                      {isLoading ? (
                        <Skeleton className='h-10 w-full' />
                      ) : (
                        <Select
                          value={field.value || undefined}
                          onValueChange={(value) => field.onChange(value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Select a team lead (optional)...' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='__none__'>
                              — No Team Lead —
                            </SelectItem>
                            {availableUsers?.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                <div className='flex flex-col'>
                                  <span>{user.full_name}</span>
                                  <span className='text-muted-foreground text-xs'>
                                    {user.email}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </FormControl>
                    <FormDescription>
                      {selectedWorkingArea?.backup_supervisor_id
                        ? 'Auto-populated from working area. You can override if needed.'
                        : 'Optional: Select if the employee will have a team lead'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Assignment Type */}
              <FormField
                control={form.control}
                name='assignment_type'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assignment Type</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder='Select assignment type...' />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='permanent'>Permanent</SelectItem>
                          <SelectItem value='temporary'>Temporary</SelectItem>
                          <SelectItem value='seasonal'>Seasonal</SelectItem>
                          <SelectItem value='contractor'>Contractor</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Primary Position Toggle */}
              <FormField
                control={form.control}
                name='is_primary_position'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                    <div className='space-y-0.5'>
                      <FormLabel className='text-base'>
                        Primary Position
                      </FormLabel>
                      <FormDescription>
                        Mark this as the employee's main position
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
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}

export default Step4PositionAssignment
