// Created and developed by Jai Singh
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useUserManagement } from '../hooks/use-user-management'
import {
  updateUserSchema,
  type UpdateUserFormData,
  type UserProfile,
} from '../types'

const userRoles = [
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Read-only access to basic features',
  },
  {
    value: 'cashier',
    label: 'Cashier',
    description: 'Can process transactions and view reports',
  },
  {
    value: 'manager',
    label: 'Manager',
    description: 'Can manage operations and view analytics',
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full access to system configuration',
  },
  {
    value: 'superadmin',
    label: 'Super Admin',
    description: 'Complete system access and user management',
  },
  {
    value: 'tka_associate',
    label: 'TKA Associate',
    description: 'Warehouse associate with specialized access',
  },
]

const userStatuses = [
  {
    value: 'active',
    label: 'Active',
    description: 'User can access the system',
  },
  {
    value: 'inactive',
    label: 'Inactive',
    description: 'User cannot access the system',
  },
  {
    value: 'suspended',
    label: 'Suspended',
    description: 'User is temporarily banned',
  },
  {
    value: 'invited',
    label: 'Invited',
    description: 'User has been invited but not activated',
  },
]

interface EditUserDialogProps {
  user?: UserProfile | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function EditUserDialog({
  user,
  open = false,
  onOpenChange,
}: EditUserDialogProps) {
  const { updateUser, isUpdating } = useUserManagement()
  const [loading, setLoading] = useState(false)

  const form = useForm<UpdateUserFormData>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      username: '',
      first_name: '',
      last_name: '',
      phone_number: '',
      role: 'viewer',
      status: 'active',
      email_verified: false,
      two_factor_enabled: false,
    },
  })

  // Update form when user changes
  useEffect(() => {
    if (user && open) {
      form.reset({
        username: user.username || '',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        phone_number: user.phone_number || '',
        role: user.role || 'viewer',
        status: user.status || 'active',
        email_verified: user.email_verified || false,
        two_factor_enabled: user.two_factor_enabled || false,
      })
    }
  }, [user, open, form])

  const onSubmit = async (data: UpdateUserFormData) => {
    if (!user) return

    setLoading(true)
    try {
      await updateUser(user.id, data)
      onOpenChange?.(false)
    } catch (error) {
      logger.error('Error updating user:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    form.reset()
    onOpenChange?.(false)
  }

  if (!user) {
    return null
  }

  const fullName =
    user.full_name ||
    `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
    'Unnamed User'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-hidden'>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update {fullName}'s profile information and account settings.
          </DialogDescription>
        </DialogHeader>

        <div className='max-h-[70vh] overflow-y-auto px-1'>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
              {/* Basic Information */}
              <div className='space-y-4'>
                <h3 className='text-lg font-medium'>Basic Information</h3>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='first_name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input placeholder='John' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='last_name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input placeholder='Doe' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='username'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input placeholder='john.doe' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='phone_number'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input placeholder='+1234567890' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Role and Status */}
              <div className='space-y-4'>
                <h3 className='text-lg font-medium'>Role & Status</h3>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='role'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Role</FormLabel>
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
                            {userRoles.map((role) => (
                              <SelectItem key={role.value} value={role.value}>
                                {role.label}
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
                    name='status'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder='Select status' />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {userStatuses.map((status) => (
                              <SelectItem
                                key={status.value}
                                value={status.value}
                              >
                                {status.label}
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

              {/* Account Settings */}
              <div className='space-y-4'>
                <h3 className='text-lg font-medium'>Account Settings</h3>
                <div className='space-y-4'>
                  <FormField
                    control={form.control}
                    name='email_verified'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-start space-y-0 space-x-3 rounded-md border p-4'>
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className='space-y-1 leading-none'>
                          <FormLabel>Email Verified</FormLabel>
                          <p className='text-muted-foreground text-sm'>
                            Mark the user's email address as verified
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='two_factor_enabled'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-start space-y-0 space-x-3 rounded-md border p-4'>
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className='space-y-1 leading-none'>
                          <FormLabel>Two-Factor Authentication</FormLabel>
                          <p className='text-muted-foreground text-sm'>
                            Enable or disable two-factor authentication for this
                            user
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  type='button'
                  variant='outline'
                  onClick={handleCancel}
                  disabled={loading || isUpdating}
                >
                  Cancel
                </Button>
                <Button type='submit' disabled={loading || isUpdating}>
                  {(loading || isUpdating) && (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  )}
                  Update User
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
