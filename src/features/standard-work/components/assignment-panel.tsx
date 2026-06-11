// Created and developed by Jai Singh
/**
 * Assignment Panel Component
 * Dialog for assigning standard work templates to users, positions, or working areas
 * Created: February 8, 2026
 */
import { useEffect, useState } from 'react'
import {
  Briefcase,
  ClipboardCheck,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2,
  User2,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useLaborManagement } from '@/hooks/use-labor-management'
import {
  useStandardWork,
  type StandardWorkTemplate,
  type StandardWorkTemplateAssignment,
} from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

// ===== TYPES =====

interface AssignmentPanelProps {
  template: StandardWorkTemplate
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AssignmentTab = 'user' | 'position' | 'area'

interface UserSearchResult {
  id: string
  full_name: string
  email: string
}

// ===== COMPONENT =====

export function AssignmentPanel({
  template,
  open,
  onOpenChange,
}: AssignmentPanelProps) {
  const {
    useTemplateAssignments,
    createAssignment,
    deleteAssignment,
    isCreatingAssignment,
  } = useStandardWork()
  const { workingAreas, shiftPositions } = useLaborManagement()

  // Assignments data
  const { data: assignments = [], isLoading: assignmentsLoading } =
    useTemplateAssignments(template.id)

  // Add assignment state
  const [activeTab, setActiveTab] = useState<AssignmentTab>('user')
  const [assignmentType, setAssignmentType] = useState<'required' | 'optional'>(
    'required'
  )
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedPositionId, setSelectedPositionId] = useState('')
  const [selectedAreaId, setSelectedAreaId] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // User search state
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<UserSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [, setSelectedUser] = useState<UserSearchResult | null>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab('user')
      setAssignmentType('required')
      setSelectedUserId('')
      setSelectedPositionId('')
      setSelectedAreaId('')
      setUserSearch('')
      setUserResults([])
      setSelectedUser(null)
      setShowUserDropdown(false)
    }
  }, [open])

  // User search effect
  useEffect(() => {
    const searchUsers = async () => {
      if (userSearch.trim().length < 2) {
        setUserResults([])
        setShowUserDropdown(false)
        return
      }

      setIsSearching(true)
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('id, full_name, email')
          .ilike('full_name', `%${userSearch.trim()}%`)
          .limit(10)

        if (error) throw error
        setUserResults((data || []) as UserSearchResult[])
        setShowUserDropdown(true)
      } catch (err) {
        // Surface a toast so users notice when search isn't returning a list
        // because of a network or auth issue, not because no users matched.
        setUserResults([])
        toast.error(
          `User search failed: ${(err as Error)?.message ?? 'unknown error'}`
        )
      } finally {
        setIsSearching(false)
      }
    }

    const debounce = setTimeout(searchUsers, 300)
    return () => clearTimeout(debounce)
  }, [userSearch])

  // Handlers
  const handleSelectUser = (user: UserSearchResult) => {
    setSelectedUser(user)
    setSelectedUserId(user.id)
    setUserSearch(user.full_name)
    setShowUserDropdown(false)
  }

  const handleAddAssignment = async () => {
    try {
      const base: Partial<StandardWorkTemplateAssignment> = {
        template_id: template.id,
        assignment_type: assignmentType,
        is_active: true,
        priority: 0,
      }

      if (activeTab === 'user') {
        if (!selectedUserId) {
          toast.error('Please select a user')
          return
        }
        // Check for duplicate
        if (assignments.some((a) => a.user_id === selectedUserId)) {
          toast.error('This user is already assigned')
          return
        }
        await createAssignment({ ...base, user_id: selectedUserId })
      } else if (activeTab === 'position') {
        if (!selectedPositionId) {
          toast.error('Please select a position')
          return
        }
        if (assignments.some((a) => a.position_id === selectedPositionId)) {
          toast.error('This position is already assigned')
          return
        }
        await createAssignment({ ...base, position_id: selectedPositionId })
      } else {
        if (!selectedAreaId) {
          toast.error('Please select a working area')
          return
        }
        if (
          assignments.some(
            (a) =>
              a.working_area_id === selectedAreaId &&
              !a.user_id &&
              !a.position_id
          )
        ) {
          toast.error('This area is already assigned')
          return
        }
        await createAssignment({ ...base, working_area_id: selectedAreaId })
      }

      // Reset form after success
      setSelectedUserId('')
      setSelectedPositionId('')
      setSelectedAreaId('')
      setUserSearch('')
      setSelectedUser(null)
    } catch {
      // Error handled by mutation
    }
  }

  const handleDeleteAssignment = async (assignmentId: string) => {
    setDeletingId(assignmentId)
    try {
      await deleteAssignment({ assignmentId, templateId: template.id })
    } catch {
      // Error handled by mutation
    } finally {
      setDeletingId(null)
    }
  }

  // Helpers
  const getAssignmentIcon = (assignment: StandardWorkTemplateAssignment) => {
    if (assignment.user_id) return User2
    if (assignment.position_id) return Briefcase
    return MapPin
  }

  const getAssignmentLabel = (assignment: StandardWorkTemplateAssignment) => {
    if (assignment.user_id && assignment.user) {
      return {
        name: assignment.user.full_name,
        subtitle: assignment.user.email,
      }
    }
    if (assignment.position_id && assignment.position) {
      return {
        name: assignment.position.position_title,
        subtitle: assignment.position.position_code,
      }
    }
    if (assignment.working_area_id && assignment.area) {
      return {
        name: assignment.area.area_name,
        subtitle: assignment.area.area_code,
      }
    }
    return { name: 'Unknown', subtitle: '' }
  }

  const getAssignmentTypeBadge = (type: string) => {
    if (type === 'required') {
      return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
    }
    return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
  }

  const activeAreas = workingAreas.filter((a) => a.is_active)
  const activePositions = shiftPositions.filter(
    (p: { is_active?: boolean }) => p.is_active !== false
  )

  const tabs: { key: AssignmentTab; label: string; icon: typeof User2 }[] = [
    { key: 'user', label: 'User', icon: User2 },
    { key: 'position', label: 'Position', icon: Briefcase },
    { key: 'area', label: 'Area', icon: MapPin },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[85vh] max-w-lg flex-col overflow-hidden'>
        {/* Header */}
        <DialogHeader className='shrink-0'>
          <div className='flex items-center gap-3'>
            <div
              className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl'
              style={{ backgroundColor: `${template.color}12` }}
            >
              <Users className='h-5 w-5' style={{ color: template.color }} />
            </div>
            <div className='min-w-0'>
              <DialogTitle className='truncate text-base'>
                {template.template_name}
              </DialogTitle>
              <DialogDescription className='text-xs'>
                Manage who is assigned to complete this template
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-hidden'>
          {/* Current Assignments */}
          <div className='shrink-0'>
            <p className='text-muted-foreground mb-2 text-[10px] font-medium tracking-wider uppercase'>
              Current Assignments
            </p>
          </div>

          {assignmentsLoading ? (
            <div className='shrink-0 space-y-2'>
              {[1, 2, 3].map((i) => (
                <div key={i} className='flex items-center gap-3 p-3'>
                  <Skeleton className='h-8 w-8 rounded-lg' />
                  <div className='flex-1 space-y-1.5'>
                    <Skeleton className='h-3.5 w-32' />
                    <Skeleton className='h-3 w-24' />
                  </div>
                  <Skeleton className='h-5 w-16 rounded-full' />
                </div>
              ))}
            </div>
          ) : assignments.length === 0 ? (
            <div className='flex shrink-0 flex-col items-center justify-center py-8 text-center'>
              <div className='bg-muted mb-3 flex h-12 w-12 items-center justify-center rounded-xl'>
                <UserPlus className='text-muted-foreground/40 h-6 w-6' />
              </div>
              <p className='text-muted-foreground text-sm font-medium'>
                No Assignments Yet
              </p>
              <p className='text-muted-foreground/70 mt-1 max-w-[240px] text-xs'>
                Add users, positions, or areas below to assign this template
              </p>
            </div>
          ) : (
            <ScrollArea className='-mx-1 min-h-0 flex-1 px-1'>
              <div className='space-y-1'>
                {assignments.map((assignment) => {
                  const Icon = getAssignmentIcon(assignment)
                  const label = getAssignmentLabel(assignment)
                  const isDeleting = deletingId === assignment.id

                  return (
                    <div
                      key={assignment.id}
                      className='group hover:bg-muted/50 flex items-center gap-3 rounded-lg p-2.5 transition-colors'
                    >
                      <div
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          assignment.user_id
                            ? 'bg-violet-500/10'
                            : assignment.position_id
                              ? 'bg-amber-500/10'
                              : 'bg-emerald-500/10'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4',
                            assignment.user_id
                              ? 'text-violet-500'
                              : assignment.position_id
                                ? 'text-amber-500'
                                : 'text-emerald-500'
                          )}
                        />
                      </div>

                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-medium'>
                          {label.name}
                        </p>
                        {label.subtitle && (
                          <p className='text-muted-foreground truncate text-xs'>
                            {label.subtitle}
                          </p>
                        )}
                      </div>

                      <Badge
                        variant='outline'
                        className={cn(
                          'h-5 shrink-0 text-[10px] capitalize',
                          getAssignmentTypeBadge(assignment.assignment_type)
                        )}
                      >
                        {assignment.assignment_type}
                      </Badge>

                      <Button
                        variant='ghost'
                        size='icon'
                        className='text-muted-foreground hover:text-destructive h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100'
                        onClick={() => handleDeleteAssignment(assignment.id)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <Loader2 className='h-3.5 w-3.5 animate-spin' />
                        ) : (
                          <Trash2 className='h-3.5 w-3.5' />
                        )}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}

          <Separator className='shrink-0' />

          {/* Add Assignment Section */}
          <div className='shrink-0 space-y-3'>
            <p className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
              Add Assignment
            </p>

            {/* Tab Buttons */}
            <div className='bg-muted flex gap-1 rounded-lg p-1'>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type='button'
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                    activeTab === tab.key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <tab.icon className='h-3.5 w-3.5' />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Selection Input */}
            <div className='space-y-2'>
              {activeTab === 'user' ? (
                <div className='relative'>
                  <div className='relative'>
                    <Search className='text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
                    <Input
                      placeholder='Search users by name...'
                      value={userSearch}
                      onChange={(e) => {
                        setUserSearch(e.target.value)
                        setSelectedUser(null)
                        setSelectedUserId('')
                      }}
                      onFocus={() => {
                        if (userResults.length > 0) setShowUserDropdown(true)
                      }}
                      className='h-9 pl-8 text-sm'
                    />
                    {isSearching && (
                      <Loader2 className='text-muted-foreground absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 animate-spin' />
                    )}
                  </div>

                  {/* User Search Dropdown */}
                  {showUserDropdown && userResults.length > 0 && (
                    <div className='bg-popover absolute z-50 mt-1 w-full overflow-hidden rounded-lg border shadow-md'>
                      <ScrollArea className='max-h-[180px]'>
                        {userResults.map((user) => (
                          <button
                            key={user.id}
                            type='button'
                            className='hover:bg-muted/50 flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors'
                            onClick={() => handleSelectUser(user)}
                          >
                            <div className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10'>
                              <User2 className='h-3.5 w-3.5 text-violet-500' />
                            </div>
                            <div className='min-w-0'>
                              <p className='truncate text-sm font-medium'>
                                {user.full_name}
                              </p>
                              <p className='text-muted-foreground truncate text-xs'>
                                {user.email}
                              </p>
                            </div>
                          </button>
                        ))}
                      </ScrollArea>
                    </div>
                  )}

                  {/* No results state */}
                  {showUserDropdown &&
                    userResults.length === 0 &&
                    userSearch.trim().length >= 2 &&
                    !isSearching && (
                      <div className='bg-popover absolute z-50 mt-1 w-full rounded-lg border p-3 text-center shadow-md'>
                        <p className='text-muted-foreground text-xs'>
                          No users found
                        </p>
                      </div>
                    )}
                </div>
              ) : activeTab === 'position' ? (
                <Select
                  value={selectedPositionId}
                  onValueChange={setSelectedPositionId}
                >
                  <SelectTrigger className='h-9 text-sm'>
                    <SelectValue placeholder='Select a position...' />
                  </SelectTrigger>
                  <SelectContent>
                    {activePositions.map((pos) => (
                      <SelectItem key={pos.id} value={pos.id}>
                        <div className='flex items-center gap-2'>
                          <Briefcase className='h-3.5 w-3.5 shrink-0 text-amber-500' />
                          <span>{pos.position_title}</span>
                          <span className='text-muted-foreground text-xs'>
                            ({pos.position_code})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                    {activePositions.length === 0 && (
                      <div className='text-muted-foreground px-3 py-2 text-center text-xs'>
                        No positions available
                      </div>
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={selectedAreaId}
                  onValueChange={setSelectedAreaId}
                >
                  <SelectTrigger className='h-9 text-sm'>
                    <SelectValue placeholder='Select a working area...' />
                  </SelectTrigger>
                  <SelectContent>
                    {activeAreas.map((area) => (
                      <SelectItem key={area.id} value={area.id}>
                        <div className='flex items-center gap-2'>
                          <MapPin className='h-3.5 w-3.5 shrink-0 text-emerald-500' />
                          <span>{area.area_name}</span>
                          <span className='text-muted-foreground text-xs'>
                            ({area.area_code})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                    {activeAreas.length === 0 && (
                      <div className='text-muted-foreground px-3 py-2 text-center text-xs'>
                        No working areas available
                      </div>
                    )}
                  </SelectContent>
                </Select>
              )}

              {/* Assignment Type + Add Button row */}
              <div className='flex items-center gap-2'>
                <Select
                  value={assignmentType}
                  onValueChange={(v) =>
                    setAssignmentType(v as 'required' | 'optional')
                  }
                >
                  <SelectTrigger className='h-9 w-[130px] shrink-0 text-sm'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='required'>
                      <div className='flex items-center gap-1.5'>
                        <div className='h-1.5 w-1.5 rounded-full bg-red-500' />
                        Required
                      </div>
                    </SelectItem>
                    <SelectItem value='optional'>
                      <div className='flex items-center gap-1.5'>
                        <div className='h-1.5 w-1.5 rounded-full bg-blue-500' />
                        Optional
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  className='h-9 flex-1 gap-1.5 text-sm'
                  onClick={handleAddAssignment}
                  disabled={isCreatingAssignment}
                >
                  {isCreatingAssignment ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <Plus className='h-4 w-4' />
                  )}
                  Add
                </Button>
              </div>
            </div>
          </div>

          {/* Summary footer */}
          {assignments.length > 0 && (
            <div className='text-muted-foreground flex shrink-0 items-center gap-3 border-t pt-1 text-xs'>
              <span className='flex items-center gap-1'>
                <ClipboardCheck className='h-3 w-3' />
                {assignments.length} total
              </span>
              <Separator orientation='vertical' className='h-3' />
              <span className='flex items-center gap-1'>
                <User2 className='h-3 w-3' />
                {assignments.filter((a) => a.user_id).length} users
              </span>
              <span className='flex items-center gap-1'>
                <Briefcase className='h-3 w-3' />
                {
                  assignments.filter((a) => a.position_id && !a.user_id).length
                }{' '}
                positions
              </span>
              <span className='flex items-center gap-1'>
                <MapPin className='h-3 w-3' />
                {
                  assignments.filter(
                    (a) => a.working_area_id && !a.user_id && !a.position_id
                  ).length
                }{' '}
                areas
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AssignmentPanel

// Created and developed by Jai Singh
