/**
 * Delete Labor Standard Dialog Component
 * Confirmation dialog for deleting labor standards
 * Created: October 25, 2025
 */
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { LaborStandard } from '@/lib/supabase/labor-management.service'
import { logger } from '@/lib/utils/logger'
import { useLaborManagement } from '@/hooks/use-labor-management'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'

interface DeleteStandardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  standard: LaborStandard | null
}

export function DeleteStandardDialog({
  open,
  onOpenChange,
  standard,
}: DeleteStandardDialogProps) {
  const { deleteLaborStandard } = useLaborManagement()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!standard) return

    try {
      setIsDeleting(true)
      await deleteLaborStandard(standard.id)
      onOpenChange(false)
    } catch (error) {
      logger.error('Error deleting labor standard:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Labor Standard</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the standard "
            {standard?.standard_name}"?
          </AlertDialogDescription>
        </AlertDialogHeader>

        {standard && (
          <div className='space-y-4'>
            <div className='bg-muted/50 space-y-2 rounded-lg border p-4'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Type:</span>
                <Badge variant='outline' className='capitalize'>
                  {standard.standard_type}
                </Badge>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Task Type:</span>
                <span className='text-sm'>
                  {standard.task_type || 'All tasks'}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Target Value:</span>
                <span className='font-mono text-sm'>
                  {standard.target_value} {standard.unit_of_measure}
                </span>
              </div>
              {standard.minimum_acceptable && (
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium'>Minimum:</span>
                  <span className='font-mono text-sm'>
                    {standard.minimum_acceptable}
                  </span>
                </div>
              )}
              {standard.excellent_threshold && (
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium'>Excellent:</span>
                  <span className='font-mono text-sm'>
                    {standard.excellent_threshold}
                  </span>
                </div>
              )}
            </div>

            <p className='text-muted-foreground text-sm'>
              This action cannot be undone. The standard will be permanently
              deleted and will no longer be applied to performance tracking.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
          >
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Delete Standard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
