// Created and developed by Jai Singh
import { useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { permissionActions, resourceTypes } from '../../roles/data/data'

const createPermissionSchema = z.object({
  resource: z.string().min(1, 'Resource is required'),
  action: z.string().min(1, 'Action is required'),
  description: z.string().optional(),
})

type CreatePermissionFormData = z.infer<typeof createPermissionSchema>

interface PermissionCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PermissionCreateDialog({
  open,
  onOpenChange,
}: PermissionCreateDialogProps) {
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<CreatePermissionFormData>({
    resolver: zodResolver(createPermissionSchema),
    defaultValues: {
      resource: '',
      action: '',
      description: '',
    },
  })

  const watchedResource = form.watch('resource')
  const watchedAction = form.watch('action')

  // Auto-generate permission name
  const generatePermissionName = (resource: string, action: string) => {
    if (resource && action) {
      return `${resource}:${action}`
    }
    return ''
  }

  const onSubmit = async (data: CreatePermissionFormData) => {
    setIsLoading(true)
    try {
      const permissionData = {
        ...data,
        name: generatePermissionName(data.resource, data.action),
      }

      // TODO: Implement Supabase permission creation
      logger.log('Creating permission:', permissionData)

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to create permission:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>Create New Permission</DialogTitle>
          <DialogDescription>
            Define a new permission by specifying the resource and action.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='resource'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Resource</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder='Select a resource' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {resourceTypes.map((resource) => (
                        <SelectItem key={resource.value} value={resource.value}>
                          <div>
                            <div className='font-medium'>{resource.label}</div>
                            <div className='text-muted-foreground text-xs'>
                              {resource.description}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    The system resource this permission applies to.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='action'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Action</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder='Select an action' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {permissionActions.map((action) => (
                        <SelectItem key={action.value} value={action.value}>
                          <div className='flex items-center gap-2'>
                            <action.icon size={16} />
                            <div>
                              <div className='font-medium'>{action.label}</div>
                              <div className='text-muted-foreground text-xs'>
                                {action.description}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    The action that can be performed on the resource.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchedResource && watchedAction && (
              <div className='bg-muted/50 rounded-md border p-3'>
                <p className='text-sm font-medium'>Generated Permission:</p>
                <code className='bg-background rounded px-2 py-1 font-mono text-sm'>
                  {generatePermissionName(watchedResource, watchedAction)}
                </code>
              </div>
            )}

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
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isLoading}>
                {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                Create Permission
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
