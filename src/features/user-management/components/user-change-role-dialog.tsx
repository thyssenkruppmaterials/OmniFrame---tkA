'use client'

import { useState, useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { UserCog, ArrowRight, AlertTriangle, Mail, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  getRoles,
  type RoleData,
} from '../../admin/roles/services/role.service'
import { useUserManagement } from '../hooks/use-user-management'
import { UserManagementService } from '../services/user-management.service'
import type { UserProfile, UserRole } from '../types'
import { userRoleSchema } from '../types'

const changeRoleSchema = z.object({
  newRole: userRoleSchema,
  reason: z
    .string()
    .optional()
    .refine((val) => !val || val.length >= 10, {
      message: 'Reason must be at least 10 characters when provided',
    }),
  notifyUser: z.boolean().default(true),
  effectiveImmediately: z.boolean().default(true),
})

type ChangeRoleForm = z.infer<typeof changeRoleSchema>

interface Props {
  user: UserProfile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserChangeRoleDialog({ user, open, onOpenChange }: Props) {
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingRoles, setIsLoadingRoles] = useState(false)
  const [availableRoles, setAvailableRoles] = useState<RoleData[]>([])
  const { refreshUsers } = useUserManagement()

  // Load available roles when dialog opens
  useEffect(() => {
    if (open) {
      loadRoles()
    }
  }, [open])

  const loadRoles = async () => {
    try {
      setIsLoadingRoles(true)
      logger.log('🔄 Loading available roles from database...')

      const roles = await getRoles()
      logger.log('✅ Loaded roles:', roles.length, 'roles found')
      logger.log(
        'Available roles:',
        roles.map((r) => ({
          name: r.name,
          displayName: r.displayName,
          isActive: r.isActive,
        }))
      )

      // Only show active roles for role assignment
      const activeRoles = roles.filter((role) => role.isActive)
      setAvailableRoles(activeRoles)

      logger.log(
        `📋 Filtered to ${activeRoles.length} active roles for dropdown`
      )
    } catch (error) {
      logger.error('❌ Error loading roles:', error)
      toast.error('Failed to load available roles')

      // Fallback to hardcoded roles if database fetch fails
      const fallbackRoles: RoleData[] = [
        {
          id: '',
          name: 'superadmin',
          displayName: 'Super Admin',
          description: '',
          isSystem: true,
          isActive: true,
          userCount: 0,
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '',
          name: 'admin',
          displayName: 'Admin',
          description: '',
          isSystem: true,
          isActive: true,
          userCount: 0,
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '',
          name: 'manager',
          displayName: 'Manager',
          description: '',
          isSystem: true,
          isActive: true,
          userCount: 0,
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '',
          name: 'cashier',
          displayName: 'Cashier',
          description: '',
          isSystem: true,
          isActive: true,
          userCount: 0,
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '',
          name: 'viewer',
          displayName: 'Viewer',
          description: '',
          isSystem: true,
          isActive: true,
          userCount: 0,
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '',
          name: 'tka_associate',
          displayName: 'TKA Associate',
          description: '',
          isSystem: false,
          isActive: true,
          userCount: 0,
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]
      setAvailableRoles(fallbackRoles)
      logger.log('🔄 Using fallback roles due to database error')
    } finally {
      setIsLoadingRoles(false)
    }
  }

  const form = useForm<ChangeRoleForm>({
    resolver: zodResolver(changeRoleSchema),
    defaultValues: {
      newRole: 'viewer' as UserRole,
      reason: '',
      notifyUser: true,
      effectiveImmediately: true,
    },
  })

  if (!user) return null

  const selectedRole = form.watch('newRole') as UserRole

  const onSubmit = async (values: ChangeRoleForm) => {
    logger.log('Change role form submission data:', values)

    if (values.newRole === user.role) {
      toast.error('The selected role is the same as the current role')
      return
    }

    setIsLoading(true)
    try {
      logger.log(
        `Updating user ${user.id} role from ${user.role} to ${values.newRole}`
      )

      // Call the actual API to update user role
      await UserManagementService.updateUserRole(user.id, values.newRole)

      toast.success(
        `${user.full_name || user.email} is now a ${getRoleDescription(values.newRole)}`
      )

      // Refresh the users list to show the updated role
      await refreshUsers()

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Error changing user role:', error)
      if (error instanceof Error) {
        logger.error('Error message:', error.message)
        logger.error('Error stack:', error.stack)
      }
      toast.error('Failed to update user role. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const getRoleColor = (role: UserRole) => {
    const colors: Record<string, string> = {
      superadmin:
        'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300',
      admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
      manager:
        'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300',
      cashier:
        'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300',
      viewer:
        'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300',
      tka_associate:
        'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-300',
      inventory_specialist:
        'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
      logistics_coordinator:
        'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300',
      quality_specialist:
        'bg-rose-100 text-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
    }
    // Return custom role color for roles not in the predefined list
    return (
      colors[role] ||
      'bg-teal-100 text-teal-800 dark:bg-teal-900/20 dark:text-teal-300'
    )
  }

  const getRoleDescription = (role: UserRole) => {
    const roleData = availableRoles.find((r) => r.name === role)
    return (
      roleData?.displayName ||
      role.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
    )
  }

  const isElevatingRole = (currentRole: UserRole, newRole: UserRole) => {
    const hierarchy = [
      'viewer',
      'tka_associate',
      'inventory_specialist',
      'logistics_coordinator',
      'quality_specialist',
      'cashier',
      'manager',
      'admin',
      'superadmin',
    ]
    const currentIndex = hierarchy.indexOf(currentRole)
    const newIndex = hierarchy.indexOf(newRole)
    // If either role is not in hierarchy (custom role), return false
    if (currentIndex === -1 || newIndex === -1) return false
    return newIndex > currentIndex
  }

  const isDemotingRole = (currentRole: UserRole, newRole: UserRole) => {
    const hierarchy = [
      'viewer',
      'tka_associate',
      'inventory_specialist',
      'logistics_coordinator',
      'quality_specialist',
      'cashier',
      'manager',
      'admin',
      'superadmin',
    ]
    const currentIndex = hierarchy.indexOf(currentRole)
    const newIndex = hierarchy.indexOf(newRole)
    // If either role is not in hierarchy (custom role), return false
    if (currentIndex === -1 || newIndex === -1) return false
    return newIndex < currentIndex
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(state) => {
        form.reset()
        onOpenChange(state)
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center space-x-2'>
            <UserCog className='h-5 w-5' />
            <span>Change User Role</span>
          </DialogTitle>
          <DialogDescription>
            Update the role for {user.full_name || user.email}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {/* Current Role Display */}
          <div className='bg-muted/30 rounded-lg border p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='font-medium'>{user.full_name || user.email}</p>
                <p className='text-muted-foreground text-sm'>{user.email}</p>
              </div>
              <div className='text-right'>
                <div className='text-muted-foreground text-sm'>
                  Current Role
                </div>
                <Badge className={getRoleColor(user.role || 'viewer')}>
                  {getRoleDescription(user.role || 'viewer')}
                </Badge>
              </div>
            </div>

            {selectedRole && selectedRole !== user.role && (
              <div className='mt-3 flex items-center justify-center space-x-2 border-t pt-3'>
                <Badge className={getRoleColor(user.role || 'viewer')}>
                  {getRoleDescription(user.role || 'viewer')}
                </Badge>
                <ArrowRight className='text-muted-foreground h-4 w-4' />
                <Badge className={getRoleColor(selectedRole)}>
                  {getRoleDescription(selectedRole)}
                </Badge>
              </div>
            )}
          </div>

          {/* Warning for role changes */}
          {selectedRole && selectedRole !== user.role && (
            <div className='flex items-start space-x-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20'>
              <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0 text-amber-600' />
              <div className='text-sm text-amber-800 dark:text-amber-200'>
                <p className='font-medium'>
                  {isElevatingRole(user.role || 'viewer', selectedRole) &&
                    'Role Elevation'}
                  {isDemotingRole(user.role || 'viewer', selectedRole) &&
                    'Role Demotion'}
                  {!isElevatingRole(user.role || 'viewer', selectedRole) &&
                    !isDemotingRole(user.role || 'viewer', selectedRole) &&
                    'Role Change'}
                </p>
                <p>
                  {isElevatingRole(user.role || 'viewer', selectedRole) &&
                    'This user will gain additional permissions and access levels.'}
                  {isDemotingRole(user.role || 'viewer', selectedRole) &&
                    'This user will lose some permissions and access levels.'}
                  {!isElevatingRole(user.role || 'viewer', selectedRole) &&
                    !isDemotingRole(user.role || 'viewer', selectedRole) &&
                    "This will change the user's access permissions."}
                </p>
              </div>
            </div>
          )}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, (errors) => {
                logger.error('Change role form validation errors:', errors)
              })}
              className='space-y-4'
            >
              <FormField
                control={form.control}
                name='newRole'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Role</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='Select a new role' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {isLoadingRoles ? (
                          <div className='flex items-center justify-center p-3'>
                            <Loader2 className='h-4 w-4 animate-spin' />
                            <span className='text-muted-foreground ml-2 text-sm'>
                              Loading roles...
                            </span>
                          </div>
                        ) : (
                          availableRoles
                            .filter((role) => role.name !== user.role) // Hide current role
                            .sort((a, b) => {
                              // Sort system roles first, then custom roles
                              if (a.isSystem && !b.isSystem) return -1
                              if (!a.isSystem && b.isSystem) return 1
                              return a.displayName.localeCompare(b.displayName)
                            })
                            .map((role) => (
                              <SelectItem key={role.name} value={role.name}>
                                <div className='flex w-full items-center justify-between'>
                                  <div className='flex flex-col'>
                                    <span className='font-medium'>
                                      {role.displayName}
                                    </span>
                                    {role.description && (
                                      <span className='text-muted-foreground max-w-[200px] truncate text-xs'>
                                        {role.description}
                                      </span>
                                    )}
                                  </div>
                                  {role.isSystem && (
                                    <Badge
                                      variant='outline'
                                      className='ml-2 text-xs'
                                    >
                                      System
                                    </Badge>
                                  )}
                                </div>
                              </SelectItem>
                            ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='reason'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason for Role Change</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='Explain why this role change is necessary...'
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='space-y-3'>
                <FormField
                  control={form.control}
                  name='notifyUser'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-start space-y-0 space-x-3'>
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className='space-y-1 leading-none'>
                        <FormLabel className='flex items-center space-x-1'>
                          <Mail className='h-3 w-3' />
                          <span>Send email notification</span>
                        </FormLabel>
                        <p className='text-muted-foreground text-sm'>
                          User will receive notification about their role change
                        </p>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='effectiveImmediately'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-start space-y-0 space-x-3'>
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className='space-y-1 leading-none'>
                        <FormLabel>Apply changes immediately</FormLabel>
                        <p className='text-muted-foreground text-sm'>
                          New permissions will take effect immediately
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type='submit'
            onClick={form.handleSubmit(onSubmit)}
            disabled={isLoading || !selectedRole || selectedRole === user.role}
          >
            {isLoading ? 'Updating...' : 'Update Role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
