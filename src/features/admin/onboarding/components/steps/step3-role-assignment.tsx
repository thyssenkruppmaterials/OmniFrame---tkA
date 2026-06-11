// Created and developed by Jai Singh
/**
 * Step 3: Role & Permissions Assignment
 * Select role and configure access level
 */
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Shield, Users, Star, Info } from 'lucide-react'
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
import { useOnboarding } from '../../context/onboarding-context'
import { OnboardingService } from '../../services/onboarding.service'
import {
  RoleAssignmentData,
  roleAssignmentSchema,
} from '../../types/onboarding.types'

export function Step3RoleAssignment() {
  const { state, updateStepData } = useOnboarding()

  // Fetch available roles
  const { data: roles, isLoading } = useQuery({
    queryKey: ['onboarding-roles'],
    queryFn: () => OnboardingService.getAvailableRoles(),
  })

  const form = useForm<RoleAssignmentData>({
    resolver: zodResolver(roleAssignmentSchema) as never,
    defaultValues: state.roleAssignment || {
      role_id: '',
      role_name: '',
      customize_permissions: false,
      custom_permissions: [],
    },
    mode: 'onChange',
  })

  const selectedRoleId = form.watch('role_id')
  const selectedRole = roles?.find((r) => r.id === selectedRoleId)

  // Watch form changes and update context
  useEffect(() => {
    const subscription = form.watch((data) => {
      if (data) {
        updateStepData('roleAssignment', data as RoleAssignmentData)
      }
    })
    return () => subscription.unsubscribe()
  }, [form, updateStepData])

  // Update role name when role is selected
  useEffect(() => {
    if (selectedRole) {
      form.setValue('role_name', selectedRole.name)
    }
  }, [selectedRole, form])

  const getRoleBadgeVariant = (roleName: string) => {
    switch (roleName) {
      case 'superadmin':
        return 'destructive'
      case 'admin':
        return 'default'
      case 'manager':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Shield className='h-5 w-5' />
            Role Assignment
          </CardTitle>
          <CardDescription>
            Select the system access level for the new employee
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className='space-y-6'>
              {/* Role Selection */}
              <FormField
                control={form.control}
                name='role_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Role *</FormLabel>
                    <FormControl>
                      {isLoading ? (
                        <Skeleton className='h-10 w-full' />
                      ) : (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Choose a role...' />
                          </SelectTrigger>
                          <SelectContent>
                            {roles?.map((role) => (
                              <SelectItem key={role.id} value={role.id}>
                                <div className='flex items-center gap-2'>
                                  <span>{role.display_name}</span>
                                  {role.is_system && (
                                    <Badge
                                      variant='outline'
                                      className='text-xs'
                                    >
                                      System
                                    </Badge>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </FormControl>
                    <FormDescription>
                      The role determines what features and data the employee
                      can access
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Selected Role Details */}
      {selectedRole && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-lg'>
              <Star className='h-5 w-5' />
              Role Details
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex items-center gap-3'>
              <Badge
                variant={getRoleBadgeVariant(selectedRole.name)}
                className='text-sm'
              >
                {selectedRole.display_name}
              </Badge>
              {selectedRole.is_system && (
                <Badge variant='outline'>System Role</Badge>
              )}
            </div>

            {selectedRole.description && (
              <p className='text-muted-foreground text-sm'>
                {selectedRole.description}
              </p>
            )}

            <div className='space-y-3 rounded-lg border p-4'>
              <h4 className='flex items-center gap-2 font-medium'>
                <Users className='h-4 w-4' />
                Role Capabilities
              </h4>
              <div className='grid gap-2 text-sm'>
                {selectedRole.name === 'superadmin' && (
                  <>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-green-500' />
                      Full system access and administration
                    </div>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-green-500' />
                      User and role management
                    </div>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-green-500' />
                      System configuration and settings
                    </div>
                  </>
                )}
                {selectedRole.name === 'admin' && (
                  <>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-green-500' />
                      User management within organization
                    </div>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-green-500' />
                      Full access to operational features
                    </div>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-green-500' />
                      Report generation and analytics
                    </div>
                  </>
                )}
                {selectedRole.name === 'manager' && (
                  <>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-green-500' />
                      Team management and oversight
                    </div>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-green-500' />
                      Access to team performance data
                    </div>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-green-500' />
                      Shift and schedule management
                    </div>
                  </>
                )}
                {selectedRole.name === 'viewer' && (
                  <>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-blue-500' />
                      Read-only access to assigned resources
                    </div>
                    <div className='flex items-center gap-2'>
                      <span className='h-2 w-2 rounded-full bg-blue-500' />
                      View personal productivity data
                    </div>
                  </>
                )}
                {!['superadmin', 'admin', 'manager', 'viewer'].includes(
                  selectedRole.name
                ) && (
                  <div className='flex items-center gap-2'>
                    <span className='h-2 w-2 rounded-full bg-blue-500' />
                    Custom role with specific permissions
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Alert */}
      <Alert>
        <Info className='h-4 w-4' />
        <AlertDescription>
          Role permissions can be customized later through the Role Management
          system. Choose a role that best matches the employee's
          responsibilities.
        </AlertDescription>
      </Alert>
    </div>
  )
}

export default Step3RoleAssignment

// Created and developed by Jai Singh
