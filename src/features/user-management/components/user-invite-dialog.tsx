// Created and developed by Jai Singh
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail, Loader2 } from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { useUserManagement } from '../hooks/use-user-management'
import { inviteUserSchema, type InviteUserFormData } from '../types'

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

export function UserInviteDialog() {
  const [open, setOpen] = useState(false)
  const { inviteUser, isInviting } = useUserManagement()

  const form = useForm<InviteUserFormData>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: {
      email: '',
      role: 'viewer',
      first_name: '',
      last_name: '',
      message: '',
    },
  })

  const onSubmit = async (data: InviteUserFormData) => {
    try {
      await inviteUser(data)
      setOpen(false)
      form.reset()
    } catch (error) {
      logger.error('Error inviting user:', error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <PermissionGuard resource='users' action='create'>
        <DialogTrigger asChild>
          <Button variant='outline'>
            <Mail className='mr-2 h-4 w-4' />
            Invite User
          </Button>
        </DialogTrigger>
      </PermissionGuard>
      <DialogContent className='max-w-xl'>
        <DialogHeader>
          <DialogTitle>Invite New User</DialogTitle>
          <DialogDescription>
            Send an invitation email to a new user. They will receive an email
            with instructions to set up their account and password.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input
                      type='email'
                      placeholder="Enter the user's email address"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid grid-cols-2 gap-4'>
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
                        <SelectValue placeholder='Select a role for the user' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {userRoles.map((role) => (
                        <SelectItem key={role.value} value={role.value}>
                          <div className='flex flex-col'>
                            <span className='font-medium'>{role.label}</span>
                            <span className='text-muted-foreground text-xs'>
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

            <FormField
              control={form.control}
              name='message'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Custom Message (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Add a personal message to the invitation email...'
                      className='min-h-20'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='flex justify-end space-x-2 pt-4'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setOpen(false)}
                disabled={isInviting}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isInviting}>
                {isInviting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                Send Invitation
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
