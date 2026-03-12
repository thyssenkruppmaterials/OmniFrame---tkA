import { useState, useEffect } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
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
import { useRoles } from '../context/roles-context'
import { Role } from '../data/schema'
import { canDeleteRole, deleteRole } from '../services/role.service'

interface RoleDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: Role | null
}

export function RoleDeleteDialog({
  open,
  onOpenChange,
  role,
}: RoleDeleteDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [canDelete, setCanDelete] = useState(false)
  const { refreshRoles } = useRoles()

  // Check if role can be deleted when role changes
  useEffect(() => {
    const checkCanDelete = async () => {
      if (!role) {
        setCanDelete(false)
        return
      }

      try {
        const result = await canDeleteRole(role.id)
        setCanDelete(result)
      } catch (error) {
        logger.error('Error checking if role can be deleted:', error)
        setCanDelete(false)
      }
    }

    checkCanDelete()
  }, [role])
  const hasUsers = role && (role.userCount || 0) > 0

  const onConfirmDelete = async () => {
    if (!role) return

    if (!canDelete) {
      toast.error('This system role cannot be deleted')
      return
    }

    setIsLoading(true)
    try {
      // Actually delete the role using the deleteRole service function
      await deleteRole(role.id)

      toast.success(`Role "${role.name}" has been successfully deleted`)

      // Refresh roles data
      await refreshRoles()

      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to delete role:', error)

      // Handle specific error messages
      if (
        error instanceof Error &&
        error.message === 'System roles cannot be deleted'
      ) {
        toast.error(
          'System roles cannot be deleted. Only custom roles can be removed.'
        )
      } else {
        toast.error('Failed to delete role. Please try again.')
      }
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
            Delete Role
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the role
            and remove it from all users.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {role && (
            <div className='rounded-lg border p-4'>
              <h4 className='font-medium capitalize'>{role.name}</h4>
              <p className='text-muted-foreground mt-1 text-sm'>
                {role.description || 'No description'}
              </p>
              <div className='mt-2 text-sm'>
                <span className='font-medium'>Users assigned:</span>{' '}
                {role.userCount || 0}
              </div>
            </div>
          )}

          {!canDelete && (
            <Alert>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                The superadmin and admin roles cannot be deleted as they're
                required for system administration.
              </AlertDescription>
            </Alert>
          )}

          {hasUsers && canDelete && (
            <Alert>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                Warning: This role is currently assigned to {role.userCount}{' '}
                user(s). Deleting this role will remove it from all assigned
                users, and they may lose access to certain features.
              </AlertDescription>
            </Alert>
          )}
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
            disabled={isLoading || !canDelete}
          >
            {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {canDelete ? 'Delete Role' : 'Cannot Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
