import { useState } from 'react'
import { z } from 'zod'
import { format } from 'date-fns'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  CalendarIcon,
  Loader2,
  UserCheck,
  UserMinus,
  UserX,
  Ban,
  Clock,
  Shield,
  Mail,
  Download,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
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
import { Separator } from '@/components/ui/separator'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { useUserManagement } from '../hooks/use-user-management'
import { SYSTEM_ROLES, type BulkAction, type UserProfile } from '../types'

// Form schema for bulk actions
const bulkActionFormSchema = z.object({
  action: z.enum([
    'activate',
    'deactivate',
    'suspend',
    'terminate',
    'set_on_leave',
    'delete',
    'change_role',
    'send_invitation',
    'export',
  ]),
  reason: z
    .string()
    .max(500, 'Reason must be less than 500 characters')
    .optional(),
  role: z.string().optional(),
  leave_return_date: z.date().optional(),
})

type BulkActionFormData = z.infer<typeof bulkActionFormSchema>

interface BulkActionsDialogProps {
  selectedUsers?: UserProfile[]
  selectedUserIds?: string[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

// Action option configuration for the UI
const ACTION_OPTIONS: {
  action: BulkAction
  label: string
  description: string
  icon: React.ReactNode
  variant: 'default' | 'destructive' | 'secondary' | 'outline'
  requiresReason: boolean
  requiresRole: boolean
  showReturnDate: boolean
  requiresConfirmation: boolean
}[] = [
  {
    action: 'activate',
    label: 'Activate',
    description: 'Restore full system access',
    icon: <UserCheck className='h-5 w-5' />,
    variant: 'default',
    requiresReason: false,
    requiresRole: false,
    showReturnDate: false,
    requiresConfirmation: true,
  },
  {
    action: 'deactivate',
    label: 'Deactivate',
    description: 'Disable system access',
    icon: <UserMinus className='h-5 w-5' />,
    variant: 'secondary',
    requiresReason: true,
    requiresRole: false,
    showReturnDate: false,
    requiresConfirmation: true,
  },
  {
    action: 'suspend',
    label: 'Suspend',
    description: 'Temporarily ban users',
    icon: <Ban className='h-5 w-5' />,
    variant: 'destructive',
    requiresReason: true,
    requiresRole: false,
    showReturnDate: false,
    requiresConfirmation: true,
  },
  {
    action: 'set_on_leave',
    label: 'Set On Leave',
    description: 'Mark as temporarily away',
    icon: <Clock className='h-5 w-5' />,
    variant: 'secondary',
    requiresReason: true,
    requiresRole: false,
    showReturnDate: true,
    requiresConfirmation: true,
  },
  {
    action: 'terminate',
    label: 'Terminate',
    description: 'Permanent separation',
    icon: <UserX className='h-5 w-5' />,
    variant: 'destructive',
    requiresReason: true,
    requiresRole: false,
    showReturnDate: false,
    requiresConfirmation: true,
  },
  {
    action: 'change_role',
    label: 'Change Role',
    description: 'Update role for all selected',
    icon: <Shield className='h-5 w-5' />,
    variant: 'outline',
    requiresReason: false,
    requiresRole: true,
    showReturnDate: false,
    requiresConfirmation: true,
  },
  {
    action: 'send_invitation',
    label: 'Resend Invitation',
    description: 'Send invitation emails',
    icon: <Mail className='h-5 w-5' />,
    variant: 'outline',
    requiresReason: false,
    requiresRole: false,
    showReturnDate: false,
    requiresConfirmation: false,
  },
  {
    action: 'export',
    label: 'Export',
    description: 'Export to CSV file',
    icon: <Download className='h-5 w-5' />,
    variant: 'outline',
    requiresReason: false,
    requiresRole: false,
    showReturnDate: false,
    requiresConfirmation: false,
  },
  {
    action: 'delete',
    label: 'Delete',
    description: 'Soft delete users',
    icon: <Trash2 className='h-5 w-5' />,
    variant: 'destructive',
    requiresReason: false,
    requiresRole: false,
    showReturnDate: false,
    requiresConfirmation: true,
  },
]

const ROLE_OPTIONS = SYSTEM_ROLES.map((role) => ({
  value: role,
  label: role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' '),
}))

export function BulkActionsDialog({
  selectedUsers = [],
  selectedUserIds = [],
  open = false,
  onOpenChange,
}: BulkActionsDialogProps) {
  const { bulkUpdateUsers, exportUsers, isBulkUpdating, users } =
    useUserManagement()
  const [selectedAction, setSelectedAction] = useState<BulkAction | null>(null)
  const [step, setStep] = useState<'select' | 'confirm'>('select')

  const form = useForm<BulkActionFormData>({
    resolver: zodResolver(bulkActionFormSchema),
    defaultValues: {
      action: 'activate',
      reason: '',
      role: '',
    },
  })

  // Get the actual user IDs to work with
  const userIds =
    selectedUserIds.length > 0
      ? selectedUserIds
      : selectedUsers.map((u) => u.id)
  const userCount = userIds.length

  // Reset when dialog opens/closes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedAction(null)
      setStep('select')
      form.reset()
    }
    onOpenChange?.(isOpen)
  }

  const handleActionSelect = (action: BulkAction) => {
    const actionConfig = ACTION_OPTIONS.find((opt) => opt.action === action)

    setSelectedAction(action)
    form.setValue('action', action)

    // If action doesn't require confirmation, execute immediately
    if (!actionConfig?.requiresConfirmation) {
      if (action === 'export') {
        // Handle export immediately
        const usersToExport =
          selectedUsers.length > 0
            ? selectedUsers
            : users.filter((u) => userIds.includes(u.id))
        exportUsers(usersToExport)
        handleOpenChange(false)
        return
      }
      if (action === 'send_invitation') {
        // Execute send invitation immediately
        handleSubmit({ action, reason: '', role: '' })
        return
      }
    }

    setStep('confirm')
  }

  const handleBack = () => {
    setStep('select')
    setSelectedAction(null)
  }

  const handleSubmit = async (data: BulkActionFormData) => {
    if (userIds.length === 0) return

    try {
      await bulkUpdateUsers({
        action: data.action,
        user_ids: userIds,
        reason: data.reason,
        role: data.role,
        leave_return_date: data.leave_return_date?.toISOString(),
      })
      handleOpenChange(false)
    } catch (error) {
      logger.error('Error performing bulk action:', error)
    }
  }

  const selectedActionOption = ACTION_OPTIONS.find(
    (opt) => opt.action === selectedAction
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Bulk Actions</DialogTitle>
          <DialogDescription>
            Perform actions on {userCount} selected user
            {userCount !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        {/* Selected Users Summary */}
        <div className='bg-muted/50 flex items-center gap-2 rounded-lg p-3'>
          <Badge variant='secondary' className='px-3 py-1 text-lg'>
            {userCount}
          </Badge>
          <span className='text-muted-foreground text-sm'>
            user{userCount !== 1 ? 's' : ''} selected
          </span>
        </div>

        {step === 'select' ? (
          /* Step 1: Select Action */
          <div className='space-y-4'>
            <h4 className='text-sm font-medium'>Select Action</h4>

            {userCount === 0 ? (
              <Alert>
                <AlertTriangle className='h-4 w-4' />
                <AlertTitle>No Users Selected</AlertTitle>
                <AlertDescription>
                  Please select at least one user to perform bulk actions.
                </AlertDescription>
              </Alert>
            ) : (
              <div className='grid grid-cols-2 gap-3'>
                {ACTION_OPTIONS.map((option) => {
                  const actionButton = (
                    <button
                      key={option.action}
                      type='button'
                      onClick={() => handleActionSelect(option.action)}
                      className={cn(
                        'hover:border-primary flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-all',
                        'focus:ring-ring focus:ring-2 focus:ring-offset-2 focus:outline-none',
                        option.variant === 'destructive' &&
                          'hover:border-destructive hover:bg-destructive/5'
                      )}
                    >
                      <div
                        className={cn(
                          'rounded-md p-2',
                          option.variant === 'default' &&
                            'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400',
                          option.variant === 'secondary' &&
                            'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                          option.variant === 'destructive' &&
                            'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400',
                          option.variant === 'outline' &&
                            'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                        )}
                      >
                        {option.icon}
                      </div>
                      <div>
                        <p className='font-medium'>{option.label}</p>
                        <p className='text-muted-foreground text-sm'>
                          {option.description}
                        </p>
                      </div>
                    </button>
                  )

                  // Permission-gate destructive and privileged actions
                  let guard: { resource: string; action: string } | null = null
                  if (
                    option.action === 'terminate' ||
                    option.action === 'delete'
                  ) {
                    guard = { resource: 'users', action: 'delete' }
                  } else if (option.action === 'change_role') {
                    guard = { resource: 'roles', action: 'update' }
                  } else if (
                    option.action === 'suspend' ||
                    option.action === 'deactivate'
                  ) {
                    guard = { resource: 'users', action: 'update' }
                  }

                  if (guard) {
                    return (
                      <PermissionGuard
                        key={option.action}
                        resource={guard.resource}
                        action={guard.action}
                      >
                        {actionButton}
                      </PermissionGuard>
                    )
                  }

                  return actionButton
                })}
              </div>
            )}
          </div>
        ) : (
          /* Step 2: Confirm and Add Details */
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className='space-y-4'
            >
              {/* Selected Action Summary */}
              {selectedActionOption && (
                <Alert
                  className={cn(
                    selectedActionOption.variant === 'destructive' &&
                      'border-destructive'
                  )}
                >
                  <div className='flex items-center gap-2'>
                    {selectedActionOption.icon}
                    <AlertTitle>{selectedActionOption.label}</AlertTitle>
                  </div>
                  <AlertDescription>
                    {selectedActionOption.description} for {userCount} user
                    {userCount !== 1 ? 's' : ''}
                  </AlertDescription>
                </Alert>
              )}

              {(selectedAction === 'terminate' ||
                selectedAction === 'delete') && (
                <Alert variant='destructive'>
                  <AlertTriangle className='h-4 w-4' />
                  <AlertTitle>Warning: Destructive Action</AlertTitle>
                  <AlertDescription>
                    {selectedAction === 'terminate'
                      ? 'Terminating users is permanent and cannot be undone.'
                      : 'Deleting users will remove their access. This is a soft delete.'}
                  </AlertDescription>
                </Alert>
              )}

              <Separator />

              {/* Reason Field (if required) */}
              {selectedActionOption?.requiresReason && (
                <FormField
                  control={form.control}
                  name='reason'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Reason <span className='text-destructive'>*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder='Enter the reason for this action'
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        This will be recorded for all affected users
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Role Selection (for change_role action) */}
              {selectedActionOption?.requiresRole && (
                <FormField
                  control={form.control}
                  name='role'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        New Role <span className='text-destructive'>*</span>
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select a role' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ROLE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        All selected users will be assigned this role
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Return Date for On Leave */}
              {selectedActionOption?.showReturnDate && (
                <FormField
                  control={form.control}
                  name='leave_return_date'
                  render={({ field }) => (
                    <FormItem className='flex flex-col'>
                      <FormLabel>Expected Return Date</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant='outline'
                              className={cn(
                                'w-full pl-3 text-left font-normal',
                                !field.value && 'text-muted-foreground'
                              )}
                            >
                              {field.value ? (
                                format(field.value, 'PPP')
                              ) : (
                                <span>Pick a date</span>
                              )}
                              <CalendarIcon className='ml-auto h-4 w-4 opacity-50' />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className='w-auto p-0' align='start'>
                          <Calendar
                            mode='single'
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) => date < new Date()}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormDescription>
                        When are the users expected to return?
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <DialogFooter className='gap-2 sm:gap-0'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={handleBack}
                  disabled={isBulkUpdating}
                >
                  Back
                </Button>
                <Button
                  type='submit'
                  variant={
                    selectedActionOption?.variant === 'destructive'
                      ? 'destructive'
                      : 'default'
                  }
                  disabled={
                    isBulkUpdating ||
                    (selectedActionOption?.requiresRole &&
                      !form.watch('role')) ||
                    (selectedActionOption?.requiresReason &&
                      !form.watch('reason'))
                  }
                >
                  {isBulkUpdating && (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  )}
                  Confirm {selectedActionOption?.label}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}

        {step === 'select' && userCount > 0 && (
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
