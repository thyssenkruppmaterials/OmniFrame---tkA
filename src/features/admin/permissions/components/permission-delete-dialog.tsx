// Created and developed by Jai Singh
import { useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Permission } from '../../roles/data/schema'

interface PermissionDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  permission: Permission | null
}

export function PermissionDeleteDialog({
  open,
  onOpenChange,
  permission,
}: PermissionDeleteDialogProps) {
  const [isLoading, setIsLoading] = useState(false)

  const onConfirmDelete = async () => {
    if (!permission) return

    setIsLoading(true)
    try {
      // TODO: Implement Supabase permission deletion
      logger.log('Deleting permission:', permission.id)

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to delete permission:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <AlertTriangle className='text-destructive h-5 w-5' />
            Delete Permission
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the
            permission and remove it from all roles and users.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {permission && (
            <div className='rounded-lg border p-4'>
              <h4 className='font-mono text-sm font-medium'>
                {permission.name}
              </h4>
              <p className='text-muted-foreground mt-1 text-sm'>
                {permission.description || 'No description'}
              </p>
              <div className='mt-2 text-sm'>
                <span className='font-medium'>Resource:</span>{' '}
                {permission.resource} <br />
                <span className='font-medium'>Action:</span> {permission.action}
              </div>
            </div>
          )}

          <Alert>
            <AlertTriangle className='h-4 w-4' />
            <AlertDescription>
              Warning: Deleting this permission will remove it from all roles
              and users that currently have it. This may affect user access to
              system features.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={onConfirmDelete}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Delete Permission
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
