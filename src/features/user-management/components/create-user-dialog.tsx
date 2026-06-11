// Created and developed by Jai Singh
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Loader2 } from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { PasswordInput } from '@/components/password-input'
import { useUserManagement } from '../hooks/use-user-management'
import { createUserSchema, type CreateUserFormData } from '../types'

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

export function CreateUserDialog() {
  const [open, setOpen] = useState(false)
  const { createUser, isCreating } = useUserManagement()

  const form = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      username: '',
      first_name: '',
      last_name: '',
      phone_number: '',
      role: 'viewer',
      password: '',
      confirm_password: '',
      send_invite: false,
    },
  })

  const onSubmit = async (data: CreateUserFormData) => {
    try {
      // Handle invitation vs direct creation validation
      if (!data.send_invite) {
        // Direct creation - validate passwords
        if (!data.password || data.password.length < 8) {
          return
        }
        if (data.password !== data.confirm_password) {
          return
        }
      }

      // Clean up data before submission - remove password fields if sending invite
      const submitData = { ...data }
      if (data.send_invite) {
        delete submitData.password
        delete submitData.confirm_password
      }

      await createUser(submitData)
      setOpen(false)
      form.reset()
    } catch (error) {
      logger.error('Error creating user:', error)
    }
  }

  const watchSendInvite = form.watch('send_invite')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <PermissionGuard resource='users' action='create'>
        <DialogTrigger asChild>
          <Button>
            <Plus className='mr-2 h-4 w-4' />
            Create User
          </Button>
        </DialogTrigger>
      </PermissionGuard>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
          <DialogDescription>
            Add a new user to the system. You can either create the account
            directly or send an invitation email.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
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
                name='email'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input
                        type='email'
                        placeholder='john.doe@company.com'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='username'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder='john.doe' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='phone_number'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder='+1234567890' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='role'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='Select a role' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className='max-w-xs'>
                        {userRoles.map((role) => (
                          <SelectItem
                            key={role.value}
                            value={role.value}
                            className='cursor-pointer'
                          >
                            <div className='flex flex-col gap-1 py-1'>
                              <span className='font-medium'>{role.label}</span>
                              <span className='text-muted-foreground text-xs break-words'>
                                {role.description}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name='send_invite'
              render={({ field }) => (
                <FormItem className='flex flex-row items-start space-y-0 space-x-3 rounded-md border p-4'>
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className='space-y-1 leading-none'>
                    <FormLabel>Send Invitation Email</FormLabel>
                    <p className='text-muted-foreground text-sm'>
                      Send an email invitation instead of creating the account
                      directly. The user will set their own password.
                    </p>
                  </div>
                </FormItem>
              )}
            />

            {!watchSendInvite && (
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='password'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder='Enter password'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='confirm_password'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder='Confirm password'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className='flex justify-end space-x-2 pt-4'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setOpen(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isCreating}>
                {isCreating && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                {watchSendInvite ? 'Send Invitation' : 'Create User'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
