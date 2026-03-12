/**
 * Delete Working Area Dialog Component
 * Confirmation dialog for deleting working areas
 * Created: October 25, 2025
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { WorkingArea } from '@/lib/supabase/labor-management.service'
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

interface DeleteAreaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  area: WorkingArea | null
}

export function DeleteAreaDialog({
  open,
  onOpenChange,
  area,
}: DeleteAreaDialogProps) {
  const { shiftAssignments, deleteWorkingArea } = useLaborManagement()
  const [isDeleting, setIsDeleting] = useState(false)

  // Check if area has active assignments
  const activeAssignments = useMemo(() => {
    if (!area) return []
    return shiftAssignments.filter(
      (assignment) =>
        assignment.working_area_id === area.id && assignment.status === 'active'
    )
  }, [area, shiftAssignments])

  const hasActiveAssignments = activeAssignments.length > 0

  const handleDelete = async () => {
    if (!area) return

    try {
      setIsDeleting(true)
      await deleteWorkingArea(area.id)
      onOpenChange(false)
    } catch (error) {
      logger.error('Error deleting working area:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Working Area</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the working area "{area?.area_name}
            "?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className='space-y-4'>
          {hasActiveAssignments && (
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                <strong>Warning:</strong> This area has{' '}
                {activeAssignments.length} active assignment(s).
                <div className='mt-2 space-y-1'>
                  {activeAssignments.slice(0, 5).map((assignment) => (
                    <div key={assignment.id} className='text-sm'>
                      • {assignment.user_full_name || assignment.user_email} (
                      {assignment.position_title})
                    </div>
                  ))}
                  {activeAssignments.length > 5 && (
                    <div className='text-sm'>
                      • And {activeAssignments.length - 5} more...
                    </div>
                  )}
                </div>
                <div className='mt-2 text-sm'>
                  Deleting this area may affect these assignments. Consider
                  reassigning users first.
                </div>
              </AlertDescription>
            </Alert>
          )}

          {area && (
            <div className='bg-muted/50 space-y-2 rounded-lg border p-4'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Area Code:</span>
                <Badge variant='outline'>{area.area_code}</Badge>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Type:</span>
                <span className='text-sm capitalize'>
                  {area.area_type.replace('_', ' ')}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Capacity:</span>
                <span className='text-sm'>{area.capacity} workers</span>
              </div>
              {area.requires_certification && (
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium'>Certifications:</span>
                  <Badge variant='secondary'>Required</Badge>
                </div>
              )}
            </div>
          )}

          <p className='text-muted-foreground text-sm'>
            This action cannot be undone. All historical data related to this
            area will be preserved, but the area will no longer be available for
            new assignments.
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
            Delete Area
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
