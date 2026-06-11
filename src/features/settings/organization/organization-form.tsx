// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import type { UserRole, Organization } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
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

const organizationFormSchema = z.object({
  defaultUserRole: z.enum([
    'superadmin',
    'admin',
    'manager',
    'cashier',
    'viewer',
    'tka_associate',
    'inventory_specialist',
    'logistics_coordinator',
    'quality_specialist',
  ]),
})

type OrganizationFormData = z.infer<typeof organizationFormSchema>

const roleDisplayNames: Record<UserRole, string> = {
  superadmin: 'Super Administrator',
  admin: 'Administrator',
  manager: 'Manager',
  cashier: 'Cashier',
  viewer: 'Viewer',
  tka_associate: 'TKA Associate',
  inventory_specialist: 'Inventory Specialist',
  logistics_coordinator: 'Logistics Coordinator',
  quality_specialist: 'Quality Specialist',
}

const roleDescriptions: Record<UserRole, string> = {
  superadmin: 'Full system access with all permissions',
  admin: 'Administrative access for managing users and settings',
  manager: 'Management access for overseeing operations',
  cashier: 'Point-of-sale and transaction access',
  viewer: 'Read-only access to basic features',
  tka_associate: 'TKA Associate access with specialized permissions',
  inventory_specialist:
    'Specialized access for inventory management and tracking',
  logistics_coordinator:
    'Specialized access for logistics and supply chain coordination',
  quality_specialist:
    'Specialized access for quality control and assurance processes',
}

export function OrganizationForm() {
  const [isLoading, setIsLoading] = useState(false)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const { authState } = useUnifiedAuth()
  const profile = authState.profile

  const form = useForm<OrganizationFormData>({
    resolver: zodResolver(organizationFormSchema),
    defaultValues: {
      defaultUserRole: 'viewer',
    },
  })

  // Load organization data
  useEffect(() => {
    const loadOrganization = async () => {
      if (!profile?.organization_id) return

      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', profile.organization_id)
          .single()

        if (error) throw error

        if (data) {
          setOrganization(data)
          form.setValue('defaultUserRole', data.default_user_role)
        }
      } catch (error) {
        logger.error('Error loading organization:', error)
        toast.error('Failed to load organization settings')
      }
    }

    loadOrganization()
  }, [profile?.organization_id, form])

  const onSubmit = async (data: OrganizationFormData) => {
    if (!organization?.id) {
      toast.error('Organization not found')
      return
    }

    setIsLoading(true)
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          default_user_role: data.defaultUserRole,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organization.id)

      if (error) throw error

      toast.success('Organization settings updated successfully!')

      // Update local state
      setOrganization((prev: Organization | null) =>
        prev ? { ...prev, default_user_role: data.defaultUserRole } : null
      )
    } catch (error) {
      logger.error('Error updating organization:', error)
      toast.error('Failed to update organization settings')
    } finally {
      setIsLoading(false)
    }
  }

  // Check if user has permission to modify organization settings (use role_id-based lookup via roles join)
  const canModifyOrganization =
    profile?.role === 'superadmin' || profile?.role === 'admin'

  if (!canModifyOrganization) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization Settings</CardTitle>
          <CardDescription>
            You don't have permission to modify organization settings.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization Settings</CardTitle>
        <CardDescription>
          Configure organization-wide settings that affect all users.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
            <FormField
              control={form.control}
              name='defaultUserRole'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default User Role</FormLabel>
                  <FormDescription>
                    The role automatically assigned to new users when they sign
                    up for your organization.
                  </FormDescription>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder='Select a default role' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(roleDisplayNames).map(
                        ([role, displayName]) => (
                          <SelectItem
                            key={role}
                            value={role}
                            disabled={role === 'superadmin'} // Prevent setting superadmin as default
                          >
                            <div className='flex flex-col items-start'>
                              <span className='font-medium'>{displayName}</span>
                              <span className='text-muted-foreground text-sm'>
                                {roleDescriptions[role as UserRole]}
                              </span>
                            </div>
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type='submit' disabled={isLoading}>
              {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Save Organization Settings
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

// Created and developed by Jai Singh
