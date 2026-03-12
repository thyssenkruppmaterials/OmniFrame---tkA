/**
 * Delete Assignment Dialog Component
 * Confirmation dialog for deleting user assignments
 * Created: October 25, 2025
 */
import { useState } from 'react'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import type { ShiftAssignmentWithDetails } from '@/lib/supabase/labor-management.service'
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

interface DeleteAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  assignment: ShiftAssignmentWithDetails | null
}

export function DeleteAssignmentDialog({
  open,
  onOpenChange,
  assignment,
}: DeleteAssignmentDialogProps) {
  const { deleteShiftAssignment } = useLaborManagement()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!assignment) return

    try {
      setIsDeleting(true)
      await deleteShiftAssignment(assignment.id)
      onOpenChange(false)
    } catch (error) {
      logger.error('Error deleting assignment:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Assignment</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this assignment?
          </AlertDialogDescription>
        </AlertDialogHeader>

        {assignment && (
          <div className='space-y-4'>
            <div className='bg-muted/50 space-y-2 rounded-lg border p-4'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Employee:</span>
                <div className='text-right text-sm'>
                  <div className='font-medium'>{assignment.user_full_name}</div>
                  <div className='text-muted-foreground'>
                    {assignment.user_email}
                  </div>
                </div>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Position:</span>
                <Badge variant='outline'>{assignment.position_title}</Badge>
              </div>
              {assignment.area_name && (
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium'>Working Area:</span>
                  <span className='text-sm'>{assignment.area_name}</span>
                </div>
              )}
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Type:</span>
                <Badge variant='secondary' className='capitalize'>
                  {assignment.assignment_type}
                </Badge>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Status:</span>
                <Badge
                  variant={
                    assignment.status === 'active' ? 'default' : 'secondary'
                  }
                  className='capitalize'
                >
                  {assignment.status}
                </Badge>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Start Date:</span>
                <span className='text-sm'>
                  {format(new Date(assignment.start_date), 'MMM dd, yyyy')}
                </span>
              </div>
              {assignment.supervisor_name && (
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium'>Supervisor:</span>
                  <span className='text-sm'>{assignment.supervisor_name}</span>
                </div>
              )}
            </div>

            <p className='text-muted-foreground text-sm'>
              This action cannot be undone. The assignment record will be
              permanently deleted from the system. Consider changing the status
              to "Terminated" or "Inactive" instead if you want to preserve the
              historical record.
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
            Delete Assignment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
