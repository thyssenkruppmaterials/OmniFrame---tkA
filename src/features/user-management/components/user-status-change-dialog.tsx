import { useState, useEffect } from 'react'
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useUserManagement } from '../hooks/use-user-management'
import { USER_STATUS_CONFIG, type UserProfile, type UserStatus } from '../types'

// Form schema for status change
const statusChangeFormSchema = z.object({
  new_status: z.enum([
    'active',
    'inactive',
    'invited',
    'suspended',
    'terminated',
    'on_leave',
  ]),
  reason: z
    .string()
    .min(1, 'Reason is required')
    .max(500, 'Reason must be less than 500 characters'),
  notes: z
    .string()
    .max(1000, 'Notes must be less than 1000 characters')
    .optional(),
  leave_return_date: z.date().optional(),
})

type StatusChangeFormData = z.infer<typeof statusChangeFormSchema>

interface UserStatusChangeDialogProps {
  user: UserProfile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Status option configuration for the UI
const STATUS_OPTIONS: {
  status: UserStatus
  label: string
  description: string
  icon: React.ReactNode
  variant: 'default' | 'destructive' | 'secondary' | 'outline'
  requiresReason: boolean
  showReturnDate: boolean
}[] = [
  {
    status: 'active',
    label: 'Activate',
    description: 'Restore full system access',
    icon: <UserCheck className='h-5 w-5' />,
    variant: 'default',
    requiresReason: false,
    showReturnDate: false,
  },
  {
    status: 'inactive',
    label: 'Deactivate',
    description: 'Disable system access',
    icon: <UserMinus className='h-5 w-5' />,
    variant: 'secondary',
    requiresReason: true,
    showReturnDate: false,
  },
  {
    status: 'suspended',
    label: 'Suspend',
    description: 'Temporarily ban user',
    icon: <Ban className='h-5 w-5' />,
    variant: 'destructive',
    requiresReason: true,
    showReturnDate: false,
  },
  {
    status: 'on_leave',
    label: 'Set On Leave',
    description: 'Mark as temporarily away',
    icon: <Clock className='h-5 w-5' />,
    variant: 'secondary',
    requiresReason: true,
    showReturnDate: true,
  },
  {
    status: 'terminated',
    label: 'Terminate',
    description: 'Permanent separation',
    icon: <UserX className='h-5 w-5' />,
    variant: 'destructive',
    requiresReason: true,
    showReturnDate: false,
  },
]

export function UserStatusChangeDialog({
  user,
  open,
  onOpenChange,
}: UserStatusChangeDialogProps) {
  const { updateUserStatusWithReason, isUpdatingStatus } = useUserManagement()
  const [selectedStatus, setSelectedStatus] = useState<UserStatus | null>(null)
  const [step, setStep] = useState<'select' | 'confirm'>('select')

  const form = useForm<StatusChangeFormData>({
    resolver: zodResolver(statusChangeFormSchema),
    defaultValues: {
      new_status: 'active',
      reason: '',
      notes: '',
    },
  })

  // Reset form when dialog opens/closes or user changes
  useEffect(() => {
    if (open && user) {
      setSelectedStatus(null)
      setStep('select')
      form.reset({
        new_status: 'active',
        reason: '',
        notes: '',
      })
    }
  }, [open, user, form])

  // Get available status transitions for current user
  const availableTransitions = user?.status
    ? USER_STATUS_CONFIG[user.status as UserStatus]?.canTransitionTo || []
    : []

  const handleStatusSelect = (status: UserStatus) => {
    setSelectedStatus(status)
    form.setValue('new_status', status)
    setStep('confirm')
  }

  const handleBack = () => {
    setStep('select')
    setSelectedStatus(null)
  }

  const onSubmit = async (data: StatusChangeFormData) => {
    if (!user || !selectedStatus) return

    try {
      await updateUserStatusWithReason(user.id, {
        new_status: data.new_status,
        reason: data.reason,
        notes: data.notes,
        leave_return_date: data.leave_return_date?.toISOString(),
      })
      onOpenChange(false)
    } catch (error) {
      logger.error('Error updating user status:', error)
    }
  }

  if (!user) return null

  const currentStatusConfig = USER_STATUS_CONFIG[user.status as UserStatus]
  const selectedStatusOption = STATUS_OPTIONS.find(
    (opt) => opt.status === selectedStatus
  )
  const fullName =
    user.full_name ||
    `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
    'Unnamed User'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Change User Status</DialogTitle>
          <DialogDescription>
            Update the employment status for <strong>{fullName}</strong>
          </DialogDescription>
        </DialogHeader>

        {/* Current Status Display */}
        <div className='bg-muted/50 flex items-center gap-4 rounded-lg p-4'>
          <div className='flex-1'>
            <p className='text-muted-foreground text-sm'>Current Status</p>
            <Badge
              variant='outline'
              className={cn('mt-1', currentStatusConfig?.color)}
            >
              {currentStatusConfig?.label || user.status}
            </Badge>
          </div>
          <div className='flex-1'>
            <p className='text-muted-foreground text-sm'>Email</p>
            <p className='text-sm font-medium'>{user.email}</p>
          </div>
          <div className='flex-1'>
            <p className='text-muted-foreground text-sm'>Role</p>
            <p className='text-sm font-medium capitalize'>
              {user.role || 'No Role'}
            </p>
          </div>
        </div>

        {step === 'select' ? (
          /* Step 1: Select New Status */
          <div className='space-y-4'>
            <h4 className='text-sm font-medium'>Select New Status</h4>

            {user.status === 'terminated' ? (
              <Alert variant='destructive'>
                <AlertTriangle className='h-4 w-4' />
                <AlertTitle>Cannot Change Status</AlertTitle>
                <AlertDescription>
                  Terminated users cannot have their status changed. Please
                  create a new user account if needed.
                </AlertDescription>
              </Alert>
            ) : availableTransitions.length === 0 ? (
              <Alert>
                <AlertTriangle className='h-4 w-4' />
                <AlertTitle>No Available Transitions</AlertTitle>
                <AlertDescription>
                  There are no available status transitions for this user's
                  current status.
                </AlertDescription>
              </Alert>
            ) : (
              <div className='grid grid-cols-2 gap-3'>
                {STATUS_OPTIONS.filter((opt) =>
                  availableTransitions.includes(opt.status)
                ).map((option) => (
                  <button
                    key={option.status}
                    type='button'
                    onClick={() => handleStatusSelect(option.status)}
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
                          'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400'
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
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Step 2: Confirm and Add Details */
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
              {/* Selected Status Summary */}
              {selectedStatusOption && (
                <Alert
                  className={cn(
                    selectedStatusOption.variant === 'destructive' &&
                      'border-destructive'
                  )}
                >
                  <div className='flex items-center gap-2'>
                    {selectedStatusOption.icon}
                    <AlertTitle>{selectedStatusOption.label}</AlertTitle>
                  </div>
                  <AlertDescription>
                    {selectedStatusOption.description}
                  </AlertDescription>
                </Alert>
              )}

              {selectedStatus === 'terminated' && (
                <Alert variant='destructive'>
                  <AlertTriangle className='h-4 w-4' />
                  <AlertTitle>Warning: Permanent Action</AlertTitle>
                  <AlertDescription>
                    Terminating a user is permanent and cannot be undone. The
                    user will lose all system access.
                  </AlertDescription>
                </Alert>
              )}

              <Separator />

              {/* Reason Field */}
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
                        placeholder='Enter the reason for this status change'
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      This will be recorded in the user's status history
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Return Date for On Leave */}
              {selectedStatusOption?.showReturnDate && (
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
                        When is the user expected to return?
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Additional Notes */}
              <FormField
                control={form.control}
                name='notes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Additional Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='Any additional notes or context (optional)'
                        className='resize-none'
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className='gap-2 sm:gap-0'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={handleBack}
                  disabled={isUpdatingStatus}
                >
                  Back
                </Button>
                <Button
                  type='submit'
                  variant={
                    selectedStatusOption?.variant === 'destructive'
                      ? 'destructive'
                      : 'default'
                  }
                  disabled={isUpdatingStatus}
                >
                  {isUpdatingStatus && (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  )}
                  Confirm {selectedStatusOption?.label}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}

        {step === 'select' && (
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
