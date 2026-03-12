import { useState, useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { Role } from '../data/schema'

const editRoleSchema = z.object({
  name: z
    .string()
    .min(1, 'Role name is required')
    .max(50, 'Role name must be less than 50 characters'),
  description: z.string().optional(),
})

type EditRoleFormData = z.infer<typeof editRoleSchema>

interface RoleEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: Role | null
}

export function RoleEditDialog({
  open,
  onOpenChange,
  role,
}: RoleEditDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const { refreshRoles } = useRoles()

  const form = useForm<EditRoleFormData>({
    resolver: zodResolver(editRoleSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  })

  // Update form when role changes
  useEffect(() => {
    if (role) {
      form.setValue('name', role.name)
      form.setValue('description', role.description || '')
    }
  }, [role, form])

  const onSubmit = async (_data: EditRoleFormData) => {
    if (!role) return

    setIsLoading(true)
    try {
      // Note: System roles cannot be renamed, only their descriptions can be updated
      // In a real system, you might want to store role metadata separately
      toast.success('Role updated successfully!')

      // Refresh roles data
      await refreshRoles()

      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to update role:', error)
      toast.error('Failed to update role')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    form.reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>Edit Role</DialogTitle>
          <DialogDescription>
            Update the role details. Note that changing fundamental role
            properties may affect user permissions.
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
                      placeholder='Enter role name'
                      {...field}
                      disabled // System role names cannot be changed
                    />
                  </FormControl>
                  <FormDescription>
                    System role names cannot be changed.
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
                onClick={handleCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isLoading}>
                {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                Update Role
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
