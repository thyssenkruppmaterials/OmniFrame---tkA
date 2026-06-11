// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Permission } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { useRoles } from '../context/roles-context'
import {
  createRole,
  getAllPermissions,
  updateRolePermissions,
  isRoleNameTaken,
} from '../services/role.service'

const createRoleSchema = z.object({
  name: z
    .string()
    .min(3, 'Role name must be at least 3 characters')
    .max(50, 'Role name must be less than 50 characters')
    .regex(
      /^[a-z0-9-_]+$/,
      'Role name must be lowercase and contain only letters, numbers, hyphens, and underscores'
    ),
  displayName: z
    .string()
    .min(3, 'Display name must be at least 3 characters')
    .max(100, 'Display name must be less than 100 characters'),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
  permissions: z.array(z.string()).optional(),
})

type CreateRoleFormData = z.infer<typeof createRoleSchema>

interface RoleCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RoleCreateDialog({
  open,
  onOpenChange,
}: RoleCreateDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [, setAvailablePermissions] = useState<Permission[]>([])
  const { refreshRoles } = useRoles()

  const form = useForm<CreateRoleFormData>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: {
      name: '',
      displayName: '',
      description: '',
      permissions: [],
    },
  })

  // Load available permissions when dialog opens
  useEffect(() => {
    if (open) {
      loadPermissions()
      form.reset()
    }
  }, [open, form])

  const loadPermissions = async () => {
    try {
      const permissions = await getAllPermissions()
      setAvailablePermissions(permissions)
    } catch (error) {
      logger.error('Error loading permissions:', error)
      toast.error('Failed to load permissions')
    }
  }

  const onSubmit = async (data: CreateRoleFormData) => {
    setIsLoading(true)
    try {
      // Check if role name is already taken
      const nameTaken = await isRoleNameTaken(data.name)
      if (nameTaken) {
        form.setError('name', {
          type: 'manual',
          message: 'This role name is already taken',
        })
        setIsLoading(false)
        return
      }

      // Create the new role
      const newRole = await createRole({
        name: data.name,
        display_name: data.displayName,
        description: data.description,
      })

      // Set up permissions if any were selected
      if (data.permissions && data.permissions.length > 0) {
        await updateRolePermissions(newRole.id, data.permissions)
      }

      toast.success(`Role "${data.displayName}" created successfully!`)

      // Refresh roles data
      await refreshRoles()

      form.reset()
      onOpenChange(false)
    } catch (error: unknown) {
      logger.error('Failed to create role:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to create role'
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Watch name field and auto-generate display name
  const watchName = form.watch('name')
  useEffect(() => {
    if (watchName && !form.getValues('displayName')) {
      // Convert snake_case or kebab-case to Title Case
      const displayName = watchName
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      form.setValue('displayName', displayName)
    }
  }, [watchName, form])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>Create New Role</DialogTitle>
          <DialogDescription>
            Create a custom role with specific permissions for your
            organization.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='e.g., content_editor, warehouse_manager'
                      {...field}
                      onChange={(e) => {
                        // Convert to lowercase and replace spaces with underscores
                        const value = e.target.value
                          .toLowerCase()
                          .replace(/\s+/g, '_')
                        field.onChange(value)
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    A unique identifier for this role (lowercase, no spaces).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='displayName'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='e.g., Content Editor, Warehouse Manager'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The user-friendly name shown in the interface.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Describe the purpose and scope of this role...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A clear description of what this role can do and its
                    intended use.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isLoading}>
                {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                Create Role
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
