import React, { useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, User, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  CycleCountService,
  type CycleCountPriority,
} from '@/lib/supabase/cycle-count.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useUserManagement } from '@/features/user-management/hooks/use-user-management'

interface UserAssignmentModalProps {
  isOpen: boolean
  onClose: () => void
  onAssign: (userId: string) => Promise<void>
  currentAssignee?: { id: string; full_name: string; email: string } | null
  countInfo?: {
    id: string
    count_number: string
    material_number: string
    location: string
    priority?: CycleCountPriority
  }
}

export const UserAssignmentModal: React.FC<UserAssignmentModalProps> = ({
  isOpen,
  onClose,
  onAssign,
  currentAssignee,
  countInfo,
}) => {
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [isAssigning, setIsAssigning] = useState(false)
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)

  const { users, loading: usersLoading } = useUserManagement()

  // Filter users to only show active users from same organization
  const availableUsers = users.filter(
    (user) => user.status === 'active' && user.role !== 'viewer' // Viewers typically can't perform counts
  )

  // Reset selected user when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedUserId(currentAssignee?.id || '')
    }
  }, [isOpen, currentAssignee])

  const handleAssign = async () => {
    if (!selectedUserId) {
      toast.error('Please select a user to assign the count to')
      return
    }

    try {
      setIsAssigning(true)
      await onAssign(selectedUserId)
      onClose()
    } catch (error) {
      logger.error('Assignment error:', error)
      // Error handling is done in the onAssign function
    } finally {
      setIsAssigning(false)
    }
  }

  const selectedUser = availableUsers.find((user) => user.id === selectedUserId)

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <UserCheck className='h-5 w-5' />
            Assign Cycle Count
          </DialogTitle>
        </DialogHeader>

        <div className='space-y-4'>
          {/* Count Information */}
          {countInfo && (
            <div className='bg-muted/50 space-y-1 rounded-lg p-3'>
              <div className='flex items-center justify-between'>
                <div className='font-mono text-sm font-medium'>
                  {countInfo.count_number}
                </div>
                {countInfo.priority && (
                  <Badge
                    className={CycleCountService.getPriorityColor(
                      countInfo.priority
                    )}
                  >
                    {CycleCountService.getPriorityLabel(countInfo.priority)}
                  </Badge>
                )}
              </div>
              <div className='text-muted-foreground text-sm'>
                {countInfo.material_number} - {countInfo.location}
              </div>
            </div>
          )}

          {/* Current Assignment */}
          {currentAssignee && (
            <div className='rounded-lg bg-blue-50 p-3 dark:bg-blue-950/20'>
              <div className='text-sm font-medium text-blue-900 dark:text-blue-100'>
                Currently Assigned To:
              </div>
              <div className='mt-1 flex items-center gap-2'>
                <User className='h-4 w-4 text-blue-600' />
                <span className='text-blue-700 dark:text-blue-300'>
                  {currentAssignee.full_name}
                </span>
                <Badge variant='secondary' className='text-xs'>
                  {currentAssignee.email}
                </Badge>
              </div>
            </div>
          )}

          {/* User Selection */}
          <div className='space-y-2'>
            <label className='text-sm font-medium'>
              {currentAssignee ? 'Reassign to:' : 'Assign to:'}
            </label>

            <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant='outline'
                  role='combobox'
                  aria-expanded={isPopoverOpen}
                  className='w-full justify-between'
                  disabled={usersLoading}
                >
                  {usersLoading ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Loading users...
                    </>
                  ) : selectedUser ? (
                    <>
                      <div className='flex items-center gap-2'>
                        <User className='h-4 w-4' />
                        <span>{selectedUser.full_name}</span>
                        <Badge variant='secondary' className='text-xs'>
                          {selectedUser.role}
                        </Badge>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className='text-muted-foreground'>
                        Select a user...
                      </span>
                    </>
                  )}
                  <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-full p-0'>
                <Command>
                  <CommandInput placeholder='Search users...' />
                  <CommandEmpty>No users found.</CommandEmpty>
                  <CommandList>
                    <CommandGroup>
                      {availableUsers.map((user) => (
                        <CommandItem
                          key={user.id}
                          value={`${user.full_name} ${user.email} ${user.role}`}
                          onSelect={() => {
                            setSelectedUserId(user.id)
                            setIsPopoverOpen(false)
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              selectedUserId === user.id
                                ? 'opacity-100'
                                : 'opacity-0'
                            )}
                          />
                          <div className='flex flex-1 items-center gap-2'>
                            <User className='h-4 w-4' />
                            <div className='flex-1'>
                              <div className='font-medium'>
                                {user.full_name}
                              </div>
                              <div className='text-muted-foreground text-sm'>
                                {user.email}
                              </div>
                            </div>
                            <Badge variant='outline' className='text-xs'>
                              {user.role}
                            </Badge>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Assignment Note */}
          <div className='rounded-lg bg-amber-50 p-3 dark:bg-amber-950/20'>
            <div className='text-sm text-amber-800 dark:text-amber-200'>
              <strong>Note:</strong> Once assigned, only the assigned user will
              be able to see and work on this cycle count.
            </div>
          </div>
        </div>

        <div className='mt-6 flex justify-end gap-2'>
          <Button type='button' variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={!selectedUserId || isAssigning || usersLoading}
          >
            {isAssigning ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Assigning...
              </>
            ) : (
              <>
                <UserCheck className='mr-2 h-4 w-4' />
                Assign Count
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
