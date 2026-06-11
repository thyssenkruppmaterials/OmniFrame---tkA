// Created and developed by Jai Singh
/**
 * Delete Position Dialog Component
 * Confirmation dialog for deleting organizational positions
 * Created: October 25, 2025
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { ShiftPosition } from '@/lib/supabase/labor-management.service'
import { logger } from '@/lib/utils/logger'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

interface DeletePositionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: ShiftPosition | null
}

export function DeletePositionDialog({
  open,
  onOpenChange,
  position,
}: DeletePositionDialogProps) {
  const { shiftAssignments, deleteShiftPosition } = useLaborManagement()
  const [isDeleting, setIsDeleting] = useState(false)

  // Check if position has active assignments
  const activeAssignments = useMemo(() => {
    if (!position) return []
    return shiftAssignments.filter(
      (assignment) =>
        assignment.position_id === position.id && assignment.status === 'active'
    )
  }, [position, shiftAssignments])

  const hasActiveAssignments = activeAssignments.length > 0

  const handleDelete = async () => {
    if (!position) return

    try {
      setIsDeleting(true)
      await deleteShiftPosition(position.id)
      onOpenChange(false)
    } catch (error) {
      logger.error('Error deleting position:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Position</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the position "
            {position?.position_title}"?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className='space-y-4'>
          {hasActiveAssignments && (
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                <strong>Warning:</strong> This position has{' '}
                {activeAssignments.length} active assignment(s).
                <div className='mt-2 space-y-1'>
                  {activeAssignments.slice(0, 5).map((assignment) => (
                    <div key={assignment.id} className='text-sm'>
                      • {assignment.user_full_name || assignment.user_email}
                    </div>
                  ))}
                  {activeAssignments.length > 5 && (
                    <div className='text-sm'>
                      • And {activeAssignments.length - 5} more...
                    </div>
                  )}
                </div>
                <div className='mt-2 text-sm'>
                  Deleting this position may affect these assignments. Consider
                  reassigning users first.
                </div>
              </AlertDescription>
            </Alert>
          )}

          {position && (
            <div className='bg-muted/50 space-y-2 rounded-lg border p-4'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Position Code:</span>
                <Badge variant='outline'>{position.position_code}</Badge>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Department:</span>
                <span className='text-sm'>{position.department}</span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Level:</span>
                <Badge variant='secondary'>L{position.position_level}</Badge>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Headcount Budget:</span>
                <span className='text-sm'>{position.headcount_budget}</span>
              </div>
            </div>
          )}

          <p className='text-muted-foreground text-sm'>
            This action cannot be undone. All historical data related to this
            position will be preserved, but the position will no longer be
            available for new assignments.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
          >
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Delete Position
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// Created and developed by Jai Singh
