// Created and developed by Jai Singh
import React from 'react'
import { AlertTriangle, CheckCircle, Clock, Package, X } from 'lucide-react'
import type { RFCycleCountOperation } from '@/lib/supabase/rf-cycle-count.service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface CountResumePromptProps {
  isOpen: boolean
  onClose: () => void
  onResume: () => void
  onDiscard: () => void
  assignedCounts: RFCycleCountOperation[]
}

const CountResumePrompt: React.FC<CountResumePromptProps> = ({
  isOpen,
  onClose,
  onResume,
  onDiscard,
  assignedCounts,
}) => {
  if (assignedCounts.length === 0) return null

  const count = assignedCounts[0] // Show first assigned count
  const multipleCountsAssigned = assignedCounts.length > 1

  // Calculate time since assignment
  const getMinutesSinceAssignment = (assignedAt: string): number => {
    const assigned = new Date(assignedAt)
    const now = new Date()
    return (now.getTime() - assigned.getTime()) / (1000 * 60)
  }

  const minutesSince = count.assigned_at
    ? getMinutesSinceAssignment(count.assigned_at)
    : 0
  const isApproachingAbandonment = minutesSince >= 20
  const isAbandoned = minutesSince >= 30

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Package className='text-primary h-5 w-5' />
            Resume Cycle Count?
          </DialogTitle>
        </DialogHeader>

        <div className='space-y-4'>
          {/* Warning for abandoned/approaching counts */}
          {isApproachingAbandonment && (
            <Card
              className={cn(
                'border-2',
                isAbandoned
                  ? 'border-red-300 bg-red-50'
                  : 'border-orange-300 bg-orange-50'
              )}
            >
              <CardContent className='p-3'>
                <div className='flex items-start gap-2'>
                  <AlertTriangle
                    className={cn(
                      'mt-0.5 h-4 w-4 flex-shrink-0',
                      isAbandoned ? 'text-red-600' : 'text-orange-600'
                    )}
                  />
                  <div className='text-sm'>
                    <p
                      className={cn(
                        'font-medium',
                        isAbandoned ? 'text-red-800' : 'text-orange-800'
                      )}
                    >
                      {isAbandoned ? 'Count Abandoned' : 'Abandonment Warning'}
                    </p>
                    <p
                      className={cn(
                        'mt-1 text-xs',
                        isAbandoned ? 'text-red-700' : 'text-orange-700'
                      )}
                    >
                      {isAbandoned
                        ? `This count has been in progress for ${minutesSince.toFixed(0)} minutes and may be auto-released soon.`
                        : `Count has been in progress for ${minutesSince.toFixed(0)} minutes. Will auto-release at 30 minutes.`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Count Details */}
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base'>Count in Progress</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='grid grid-cols-2 gap-3 text-sm'>
                <div>
                  <p className='text-muted-foreground text-xs'>Count Number</p>
                  <p className='font-mono font-medium'>{count.count_number}</p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>Material</p>
                  <p className='font-medium'>{count.material_number}</p>
                </div>
                <div className='col-span-2'>
                  <p className='text-muted-foreground text-xs'>Description</p>
                  <p className='text-sm'>
                    {count.material_description || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>Location</p>
                  <p className='font-mono font-medium'>{count.location}</p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>Unit</p>
                  <p className='font-medium'>{count.unit_of_measure || 'EA'}</p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>Status</p>
                  <Badge variant='secondary'>
                    {count.status?.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>Assigned</p>
                  <div className='flex items-center gap-1'>
                    <Clock className='text-muted-foreground h-3 w-3' />
                    <p className='text-xs'>{minutesSince.toFixed(0)} min ago</p>
                  </div>
                </div>
              </div>

              {/* Multiple counts warning */}
              {multipleCountsAssigned && (
                <div className='border-t pt-2'>
                  <p className='flex items-center gap-1 text-xs text-orange-600'>
                    <AlertTriangle className='h-3 w-3' />
                    You have {assignedCounts.length} counts in progress. Showing
                    the oldest.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Info box */}
          <div className='rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20'>
            <p className='text-sm text-blue-800 dark:text-blue-200'>
              <strong>Resume:</strong> Continue from where you left off with
              saved progress
            </p>
            <p className='mt-1 text-sm text-blue-800 dark:text-blue-200'>
              <strong>Discard:</strong> Release this count back to the queue for
              others to complete
            </p>
          </div>
        </div>

        <DialogFooter className='gap-2'>
          <Button variant='outline' onClick={onDiscard} className='flex-1'>
            <X className='mr-2 h-4 w-4' />
            Discard & Release
          </Button>
          <Button onClick={onResume} className='flex-1'>
            <CheckCircle className='mr-2 h-4 w-4' />
            Resume Count
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CountResumePrompt

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ')
}

// Created and developed by Jai Singh
