import { useState, useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { Permission } from '../../roles/data/schema'

const editPermissionSchema = z.object({
  description: z.string().optional(),
})

type EditPermissionFormData = z.infer<typeof editPermissionSchema>

interface PermissionEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  permission: Permission | null
}

export function PermissionEditDialog({
  open,
  onOpenChange,
  permission,
}: PermissionEditDialogProps) {
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<EditPermissionFormData>({
    resolver: zodResolver(editPermissionSchema),
    defaultValues: {
      description: '',
    },
  })

  // Update form when permission changes
  useEffect(() => {
    if (permission) {
      form.setValue('description', permission.description || '')
    }
  }, [permission, form])

  const onSubmit = async (data: EditPermissionFormData) => {
    if (!permission) return

    setIsLoading(true)
    try {
      // TODO: Implement Supabase permission update
      logger.log('Updating permission:', { id: permission.id, ...data })

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to update permission:', error)
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
          <DialogTitle>Edit Permission</DialogTitle>
          <DialogDescription>
            Update the permission details. The resource and action cannot be
            changed after creation.
          </DialogDescription>
        </DialogHeader>

        {permission && (
          <div className='bg-muted/50 mb-4 rounded-md border p-3'>
            <div className='text-sm font-medium'>Permission:</div>
            <code className='font-mono text-sm'>{permission.name}</code>
            <div className='text-muted-foreground mt-1 text-xs'>
              {permission.action} access to {permission.resource}
            </div>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Describe what this permission allows...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A clear description of what this permission grants access
                    to.
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
                Update Permission
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
