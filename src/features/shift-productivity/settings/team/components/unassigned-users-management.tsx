/**
 * Unassigned Users Management Component
 * Table-style bulk assignment for users without active primary shift assignments
 * Created: February 8, 2026
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService, {
  type ShiftSchedule,
} from '@/lib/supabase/labor-management.service'
import { logger } from '@/lib/utils/logger'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface UnassignedUser {
  id: string
  full_name: string | null
  email: string
  role_id: string
  roles: { name: string } | null
  status: string
}

interface RowAssignment {
  position_id: string
  working_area_id: string
  shift_schedule_id: string
}

export function UnassignedUsersManagement() {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id || ''
  const { shiftPositions, workingAreas, createShiftAssignment } =
    useLaborManagement()

  const [unassignedUsers, setUnassignedUsers] = useState<UnassignedUser[]>([])
  const [shiftSchedules, setShiftSchedules] = useState<ShiftSchedule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [rowAssignments, setRowAssignments] = useState<
    Record<string, RowAssignment>
  >({})
  const [bulkAssignment, setBulkAssignment] = useState<RowAssignment>({
    position_id: '',
    working_area_id: '',
    shift_schedule_id: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  // Load unassigned users
  const loadData = useCallback(async () => {
    if (!organizationId) return
    setIsLoading(true)
    try {
      const [users, schedules] = await Promise.all([
        LaborManagementService.getAvailableUsers(organizationId),
        LaborManagementService.getShiftSchedules(organizationId),
      ])
      setUnassignedUsers(users || [])
      setShiftSchedules(
        (schedules || []).filter((s: ShiftSchedule) => s.is_active)
      )
    } catch (error) {
      logger.error('Error loading unassigned users:', error)
      toast.error('Failed to load unassigned users')
    } finally {
      setIsLoading(false)
    }
  }, [organizationId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Filter users based on search
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return unassignedUsers
    const q = searchQuery.toLowerCase()
    return unassignedUsers.filter(
      (u) =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.roles?.name?.toLowerCase().includes(q)
    )
  }, [unassignedUsers, searchQuery])

  // Selection helpers
  const isAllSelected =
    filteredUsers.length > 0 &&
    filteredUsers.every((u) => selectedUserIds.includes(u.id))
  const isSomeSelected = selectedUserIds.length > 0

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedUserIds((prev) =>
        prev.filter((id) => !filteredUsers.some((u) => u.id === id))
      )
    } else {
      setSelectedUserIds((prev) => [
        ...new Set([...prev, ...filteredUsers.map((u) => u.id)]),
      ])
    }
  }, [isAllSelected, filteredUsers])

  const toggleUserSelection = useCallback((userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedUserIds([])
  }, [])

  // Per-row assignment updates
  const updateRowAssignment = useCallback(
    (userId: string, field: keyof RowAssignment, value: string) => {
      setRowAssignments((prev) => ({
        ...prev,
        [userId]: {
          ...prev[userId],
          [field]: value,
        },
      }))
    },
    []
  )

  // Apply bulk values to all selected rows
  const applyBulkToSelected = useCallback(() => {
    const updates: Record<string, RowAssignment> = {}
    for (const userId of selectedUserIds) {
      updates[userId] = {
        position_id:
          bulkAssignment.position_id ||
          rowAssignments[userId]?.position_id ||
          '',
        working_area_id:
          bulkAssignment.working_area_id ||
          rowAssignments[userId]?.working_area_id ||
          '',
        shift_schedule_id:
          bulkAssignment.shift_schedule_id ||
          rowAssignments[userId]?.shift_schedule_id ||
          '',
      }
    }
    setRowAssignments((prev) => ({ ...prev, ...updates }))
    toast.success(
      `Applied settings to ${selectedUserIds.length} selected user(s)`
    )
  }, [selectedUserIds, bulkAssignment, rowAssignments])

  // Validate a row has required fields
  const isRowValid = useCallback(
    (userId: string) => {
      const r = rowAssignments[userId]
      return r?.position_id && r?.shift_schedule_id
    },
    [rowAssignments]
  )

  // Get count of selected users with valid assignments
  const validSelectedCount = useMemo(
    () => selectedUserIds.filter((id) => isRowValid(id)).length,
    [selectedUserIds, isRowValid]
  )

  // Submit bulk assignments
  const handleBulkAssign = useCallback(async () => {
    const usersToAssign = selectedUserIds.filter((id) => isRowValid(id))
    if (usersToAssign.length === 0) {
      toast.error(
        'No selected users have complete assignments (position + schedule required)'
      )
      return
    }

    setIsSubmitting(true)
    setProgress({ current: 0, total: usersToAssign.length })

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < usersToAssign.length; i++) {
      const userId = usersToAssign[i]
      const assignment = rowAssignments[userId]
      setProgress({ current: i + 1, total: usersToAssign.length })

      try {
        await new Promise<void>((resolve, reject) => {
          createShiftAssignment(
            {
              user_id: userId,
              position_id: assignment.position_id,
              working_area_id:
                assignment.working_area_id &&
                assignment.working_area_id !== '__none__'
                  ? assignment.working_area_id
                  : undefined,
              shift_schedule_id: assignment.shift_schedule_id,
              assignment_type: 'permanent',
              shift_pattern: 'fixed',
              start_date: new Date().toISOString().split('T')[0],
              is_primary_position: true,
              status: 'active',
            } as Record<string, unknown>,
            {
              onSuccess: () => resolve(),
              onError: (error: unknown) => reject(error),
            }
          )
        })
        successCount++
      } catch (error) {
        logger.error(`Error assigning user ${userId}:`, error)
        failCount++
      }
    }

    if (successCount > 0 && failCount === 0) {
      toast.success(`Successfully assigned ${successCount} user(s)`)
    } else if (successCount > 0) {
      toast.warning(`Assigned ${successCount} user(s), ${failCount} failed`)
    } else {
      toast.error('Failed to assign users')
    }

    // Clean up state for assigned users
    const assignedIds = new Set(usersToAssign.slice(0, successCount))
    setSelectedUserIds((prev) => prev.filter((id) => !assignedIds.has(id)))
    setRowAssignments((prev) => {
      const next = { ...prev }
      assignedIds.forEach((id) => delete next[id])
      return next
    })
    setBulkAssignment({
      position_id: '',
      working_area_id: '',
      shift_schedule_id: '',
    })
    setIsSubmitting(false)
    setProgress({ current: 0, total: 0 })

    // Refresh the list
    await loadData()
  }, [
    selectedUserIds,
    rowAssignments,
    isRowValid,
    createShiftAssignment,
    loadData,
  ])

  // Assign a single user
  const handleSingleAssign = useCallback(
    async (userId: string) => {
      if (!isRowValid(userId)) {
        toast.error('Position and Shift Schedule are required')
        return
      }
      const assignment = rowAssignments[userId]
      setIsSubmitting(true)

      try {
        await new Promise<void>((resolve, reject) => {
          createShiftAssignment(
            {
              user_id: userId,
              position_id: assignment.position_id,
              working_area_id:
                assignment.working_area_id &&
                assignment.working_area_id !== '__none__'
                  ? assignment.working_area_id
                  : undefined,
              shift_schedule_id: assignment.shift_schedule_id,
              assignment_type: 'permanent',
              shift_pattern: 'fixed',
              start_date: new Date().toISOString().split('T')[0],
              is_primary_position: true,
              status: 'active',
            } as Record<string, unknown>,
            {
              onSuccess: () => resolve(),
              onError: (error: unknown) => reject(error),
            }
          )
        })
        toast.success(
          `Assigned ${unassignedUsers.find((u) => u.id === userId)?.full_name || 'user'} successfully`
        )
        setRowAssignments((prev) => {
          const next = { ...prev }
          delete next[userId]
          return next
        })
        setSelectedUserIds((prev) => prev.filter((id) => id !== userId))
        await loadData()
      } catch (error) {
        logger.error('Error assigning user:', error)
        toast.error('Failed to assign user')
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      rowAssignments,
      isRowValid,
      createShiftAssignment,
      loadData,
      unassignedUsers,
    ]
  )

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-48' />
          <Skeleton className='mt-1 h-4 w-72' />
        </CardHeader>
        <CardContent className='space-y-3'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-64 w-full' />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <div>
            <CardTitle className='flex items-center gap-2'>
              <Users className='h-5 w-5' />
              Unassigned Users
              {unassignedUsers.length > 0 && (
                <Badge variant='destructive' className='ml-1'>
                  {unassignedUsers.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Users without an active primary shift assignment. Assign them to a
              position, area, and schedule.
            </CardDescription>
          </div>
          <div className='flex items-center gap-2'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='outline'
                  size='icon'
                  onClick={loadData}
                  disabled={isLoading}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh list</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardHeader>

      <CardContent className='space-y-4'>
        {/* Search Bar */}
        <div className='relative'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search by name, email, or role...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>

        {/* Bulk Action Toolbar */}
        {isSomeSelected && (
          <div className='bg-muted/50 space-y-3 rounded-lg border p-4'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Badge variant='secondary' className='font-semibold'>
                  {selectedUserIds.length} selected
                </Badge>
                <Button variant='ghost' size='sm' onClick={clearSelection}>
                  <X className='mr-1 h-3 w-3' />
                  Clear
                </Button>
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={applyBulkToSelected}
                  disabled={
                    !bulkAssignment.position_id &&
                    !bulkAssignment.working_area_id &&
                    !bulkAssignment.shift_schedule_id
                  }
                >
                  Apply to Selected
                </Button>
                <Button
                  size='sm'
                  onClick={handleBulkAssign}
                  disabled={isSubmitting || validSelectedCount === 0}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {progress.current}/{progress.total}
                    </>
                  ) : (
                    <>
                      <UserPlus className='mr-2 h-4 w-4' />
                      Assign {validSelectedCount} User
                      {validSelectedCount !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Bulk assignment fields */}
            <div className='grid grid-cols-3 gap-3'>
              <div className='space-y-1'>
                <label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  Bulk Position
                </label>
                <Select
                  value={bulkAssignment.position_id}
                  onValueChange={(v) =>
                    setBulkAssignment((p) => ({ ...p, position_id: v }))
                  }
                >
                  <SelectTrigger className='h-9'>
                    <SelectValue placeholder='Select position...' />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      shiftPositions as Array<{
                        id: string
                        is_active?: boolean
                        position_level: number
                        position_title: string
                      }>
                    )
                      .filter((p) => p.is_active !== false)
                      .sort((a, b) => b.position_level - a.position_level)
                      .map((position) => (
                        <SelectItem key={position.id} value={position.id}>
                          L{position.position_level} - {position.position_title}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-1'>
                <label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  Bulk Working Area
                </label>
                <Select
                  value={bulkAssignment.working_area_id}
                  onValueChange={(v) =>
                    setBulkAssignment((p) => ({ ...p, working_area_id: v }))
                  }
                >
                  <SelectTrigger className='h-9'>
                    <SelectValue placeholder='Select area...' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__none__'>-- No Area --</SelectItem>
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
              </div>

              <div className='space-y-1'>
                <label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  Bulk Schedule
                </label>
                <Select
                  value={bulkAssignment.shift_schedule_id}
                  onValueChange={(v) =>
                    setBulkAssignment((p) => ({ ...p, shift_schedule_id: v }))
                  }
                >
                  <SelectTrigger className='h-9'>
                    <SelectValue placeholder='Select schedule...' />
                  </SelectTrigger>
                  <SelectContent>
                    {shiftSchedules.map((schedule) => (
                      <SelectItem key={schedule.id} value={schedule.id}>
                        <div className='flex items-center gap-2'>
                          {schedule.color && (
                            <div
                              className='h-2.5 w-2.5 shrink-0 rounded-full'
                              style={{ backgroundColor: schedule.color }}
                            />
                          )}
                          <span>{schedule.schedule_name}</span>
                          <span className='text-muted-foreground text-xs'>
                            ({schedule.shift_start_time} -{' '}
                            {schedule.shift_end_time})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {unassignedUsers.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-12 text-center'>
            <CheckCircle2 className='mb-4 h-12 w-12 text-green-500' />
            <h3 className='mb-2 text-lg font-semibold'>All Users Assigned</h3>
            <p className='text-muted-foreground max-w-sm text-sm'>
              Every active user in your organization has a primary shift
              assignment. Great job!
            </p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-12 text-center'>
            <Search className='text-muted-foreground mb-4 h-12 w-12' />
            <h3 className='mb-2 text-lg font-semibold'>No Users Match</h3>
            <p className='text-muted-foreground text-sm'>
              Try adjusting your search criteria.
            </p>
          </div>
        ) : (
          <>
            {/* Prerequisite warnings */}
            {shiftPositions.length === 0 && (
              <Alert variant='destructive'>
                <AlertCircle className='h-4 w-4' />
                <AlertDescription>
                  No positions defined. Go to <strong>Labor Management</strong>{' '}
                  settings to create positions first.
                </AlertDescription>
              </Alert>
            )}
            {shiftSchedules.length === 0 && (
              <Alert variant='destructive'>
                <AlertCircle className='h-4 w-4' />
                <AlertDescription>
                  No shift schedules defined. Create shift schedules above in{' '}
                  <strong>Shift Schedule Management</strong> first.
                </AlertDescription>
              </Alert>
            )}

            {/* Users Table */}
            <div className='overflow-hidden rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-muted/30'>
                    <TableHead className='w-[48px]'>
                      <Checkbox
                        checked={isAllSelected}
                        onCheckedChange={toggleSelectAll}
                        aria-label='Select all'
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className='min-w-[180px]'>Position *</TableHead>
                    <TableHead className='min-w-[160px]'>
                      Working Area
                    </TableHead>
                    <TableHead className='min-w-[200px]'>Schedule *</TableHead>
                    <TableHead className='w-[100px] text-right'>
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => {
                    const isSelected = selectedUserIds.includes(user.id)
                    const ra = rowAssignments[user.id] || {
                      position_id: '',
                      working_area_id: '',
                      shift_schedule_id: '',
                    }
                    const rowValid = ra.position_id && ra.shift_schedule_id

                    return (
                      <TableRow
                        key={user.id}
                        className={isSelected ? 'bg-primary/5' : undefined}
                      >
                        {/* Checkbox */}
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleUserSelection(user.id)}
                            aria-label={`Select ${user.full_name || user.email}`}
                          />
                        </TableCell>

                        {/* Name */}
                        <TableCell className='font-medium whitespace-nowrap'>
                          {user.full_name || 'Unnamed User'}
                        </TableCell>

                        {/* Email */}
                        <TableCell className='text-muted-foreground text-sm whitespace-nowrap'>
                          {user.email}
                        </TableCell>

                        {/* Role */}
                        <TableCell>
                          <Badge
                            variant='outline'
                            className='whitespace-nowrap capitalize'
                          >
                            {user.roles?.name || 'N/A'}
                          </Badge>
                        </TableCell>

                        {/* Position Select */}
                        <TableCell>
                          <Select
                            value={ra.position_id}
                            onValueChange={(v) =>
                              updateRowAssignment(user.id, 'position_id', v)
                            }
                          >
                            <SelectTrigger className='h-8 text-xs'>
                              <SelectValue placeholder='Select...' />
                            </SelectTrigger>
                            <SelectContent>
                              {(
                                shiftPositions as Array<{
                                  id: string
                                  is_active?: boolean
                                  position_level: number
                                  position_title: string
                                }>
                              )
                                .filter((p) => p.is_active !== false)
                                .sort(
                                  (a, b) => b.position_level - a.position_level
                                )
                                .map((position) => (
                                  <SelectItem
                                    key={position.id}
                                    value={position.id}
                                  >
                                    L{position.position_level} -{' '}
                                    {position.position_title}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </TableCell>

                        {/* Working Area Select */}
                        <TableCell>
                          <Select
                            value={ra.working_area_id || '__none__'}
                            onValueChange={(v) =>
                              updateRowAssignment(user.id, 'working_area_id', v)
                            }
                          >
                            <SelectTrigger className='h-8 text-xs'>
                              <SelectValue placeholder='Optional...' />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='__none__'>
                                -- None --
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
                        </TableCell>

                        {/* Schedule Select */}
                        <TableCell>
                          <Select
                            value={ra.shift_schedule_id}
                            onValueChange={(v) =>
                              updateRowAssignment(
                                user.id,
                                'shift_schedule_id',
                                v
                              )
                            }
                          >
                            <SelectTrigger className='h-8 text-xs'>
                              <SelectValue placeholder='Select...' />
                            </SelectTrigger>
                            <SelectContent>
                              {shiftSchedules.map((schedule) => (
                                <SelectItem
                                  key={schedule.id}
                                  value={schedule.id}
                                >
                                  <div className='flex items-center gap-1.5'>
                                    {schedule.color && (
                                      <div
                                        className='h-2 w-2 shrink-0 rounded-full'
                                        style={{
                                          backgroundColor: schedule.color,
                                        }}
                                      />
                                    )}
                                    <span>{schedule.schedule_name}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>

                        {/* Action */}
                        <TableCell className='text-right'>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size='sm'
                                variant={rowValid ? 'default' : 'ghost'}
                                disabled={!rowValid || isSubmitting}
                                onClick={() => handleSingleAssign(user.id)}
                                className='h-8'
                              >
                                <UserPlus className='mr-1 h-3.5 w-3.5' />
                                Assign
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {rowValid
                                ? 'Assign this user to the selected position and schedule'
                                : 'Select a position and schedule first'}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Footer summary */}
            <div className='text-muted-foreground flex items-center justify-between pt-2 text-sm'>
              <span>
                Showing {filteredUsers.length} of {unassignedUsers.length}{' '}
                unassigned user{unassignedUsers.length !== 1 ? 's' : ''}
              </span>
              {isSomeSelected && (
                <span>
                  {validSelectedCount} of {selectedUserIds.length} selected have
                  complete assignments
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
