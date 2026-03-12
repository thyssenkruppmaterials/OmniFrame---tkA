/**
 * Start Kit Confirmation Dialog
 * Shows kit details and confirms the creation of a kit build
 * Upon confirmation, generates and displays a Kit Build Sheet
 *
 * @component
 * Created: December 19, 2025
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Package,
  Play,
  Printer,
  X,
} from 'lucide-react'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

// Spring animation configuration
const springTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
}

interface KitDetails {
  kitPoNumber: string
  kitBuildNumber: string
  kitSerialNumber: string
  engineProgram: string
  kitNumber: string
  deliverToPlant: string
  dueDate: string | null
  status: string
  priority: number
  totalToLines: number
}

interface StartKitConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskId: string
  kitPoNumber: string | null
  onConfirm: () => Promise<void>
  onCancel?: () => void
}

export function StartKitConfirmDialog({
  open,
  onOpenChange,
  taskId: _taskId,
  kitPoNumber,
  onConfirm,
  onCancel,
}: StartKitConfirmDialogProps) {
  // Note: _taskId is available for future use if needed (e.g., for logging or tracking)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [kitDetails, setKitDetails] = useState<KitDetails | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Track if we've already loaded details for the current kit
  const loadedKitPoRef = useRef<string | null>(null)

  // Load kit details when dialog opens
  const loadKitDetails = useCallback(async () => {
    if (!kitPoNumber) return

    setLoading(true)
    setError(null)

    try {
      const details =
        await RRKittingDataService.getKitBuildPlanDetails(kitPoNumber)

      if (details) {
        setKitDetails({
          kitPoNumber: details.kitPoNumber,
          kitBuildNumber: details.kitBuildNumber,
          kitSerialNumber: details.kitSerialNumber,
          engineProgram: details.engineProgram,
          kitNumber: details.kitNumber,
          deliverToPlant: details.deliverToPlant,
          dueDate: details.dueDate,
          status: details.status,
          priority: details.priority,
          totalToLines: details.toLines.length,
        })
      } else {
        setError('Failed to load kit details')
      }
    } catch (err) {
      logger.error('Error loading kit details:', err)
      setError('An error occurred while loading kit details')
    } finally {
      setLoading(false)
    }
  }, [kitPoNumber])

  useEffect(() => {
    if (open && kitPoNumber) {
      // Only load if we haven't loaded this kit yet
      if (loadedKitPoRef.current !== kitPoNumber) {
        loadedKitPoRef.current = kitPoNumber
        loadKitDetails()
      }
    } else if (!open) {
      // Only reset when dialog is actually closed
      setKitDetails(null)
      setError(null)
      loadedKitPoRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kitPoNumber])

  // Handle confirm button click
  const handleConfirm = async () => {
    setConfirming(true)
    try {
      await onConfirm()
      // Parent component will handle opening the build sheet
    } catch (err) {
      logger.error('Error confirming kit start:', err)
      setError('Failed to start kit. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  // Handle cancel
  const handleCancel = () => {
    onCancel?.()
    onOpenChange(false)
  }

  // Format date for display
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Not set'
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[600px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 text-xl'>
            <Play className='text-primary h-5 w-5' />
            Start Kit Build
          </DialogTitle>
          <DialogDescription>
            Confirm you want to start the kit build process. This will generate
            a Kit Build Sheet for printing.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode='wait'>
          {loading && (
            <motion.div
              key='loading'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className='flex items-center justify-center py-12'
            >
              <div className='space-y-3 text-center'>
                <Loader2 className='text-primary mx-auto h-8 w-8 animate-spin' />
                <p className='text-muted-foreground text-sm'>
                  Loading kit details...
                </p>
              </div>
            </motion.div>
          )}

          {error && !loading && (
            <motion.div
              key='error'
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className='py-8'
            >
              <div className='flex flex-col items-center space-y-3 text-center'>
                <div className='bg-destructive/10 flex h-12 w-12 items-center justify-center rounded-full'>
                  <AlertTriangle className='text-destructive h-6 w-6' />
                </div>
                <p className='text-destructive text-sm'>{error}</p>
                <Button variant='outline' size='sm' onClick={loadKitDetails}>
                  Retry
                </Button>
              </div>
            </motion.div>
          )}

          {kitDetails && !loading && !error && (
            <motion.div
              key='details'
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={springTransition}
              className='space-y-6'
            >
              {/* Kit Information Card */}
              <Card className='bg-muted/50'>
                <CardContent className='pt-6'>
                  <div className='space-y-4'>
                    {/* Header with Serial and PO */}
                    <div className='flex items-start justify-between'>
                      <div>
                        <h3 className='text-lg font-bold'>
                          {kitDetails.kitSerialNumber || 'N/A'}
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Kit Serial Number
                        </p>
                      </div>
                      <Badge
                        variant='outline'
                        className={cn(
                          'font-mono text-base tabular-nums',
                          kitDetails.priority === 1 &&
                            'border-red-500/20 bg-red-500/10 text-red-500',
                          kitDetails.priority === 2 &&
                            'border-orange-500/20 bg-orange-500/10 text-orange-500',
                          kitDetails.priority === 3 &&
                            'border-yellow-500/20 bg-yellow-500/10 text-yellow-500',
                          kitDetails.priority > 3 &&
                            'border-blue-500/20 bg-blue-500/10 text-blue-500'
                        )}
                      >
                        Priority #{kitDetails.priority}
                      </Badge>
                    </div>

                    <Separator />

                    {/* Kit Details Grid */}
                    <div className='grid grid-cols-2 gap-4 text-sm'>
                      <div>
                        <p className='text-muted-foreground'>Kit PO Number</p>
                        <p className='font-semibold'>
                          {kitDetails.kitPoNumber}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>
                          Kit Build Number
                        </p>
                        <p className='font-semibold'>
                          {kitDetails.kitBuildNumber}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>Engine Program</p>
                        <p className='font-semibold'>
                          {kitDetails.engineProgram || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>Kit Number</p>
                        <p className='font-semibold'>
                          {kitDetails.kitNumber || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>
                          Deliver To Plant
                        </p>
                        <p className='font-semibold'>
                          {kitDetails.deliverToPlant || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground flex items-center gap-1'>
                          <Calendar className='h-3 w-3' />
                          Due Date
                        </p>
                        <p className='font-semibold'>
                          {formatDate(kitDetails.dueDate)}
                        </p>
                      </div>
                    </div>

                    <Separator />

                    {/* Summary Stats */}
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        <Package className='text-muted-foreground h-4 w-4' />
                        <span className='text-muted-foreground text-sm'>
                          Transfer Order Lines:
                        </span>
                        <span className='font-semibold'>
                          {kitDetails.totalToLines}
                        </span>
                      </div>
                      <div className='flex items-center gap-2'>
                        <ClipboardList className='text-muted-foreground h-4 w-4' />
                        <span className='text-muted-foreground text-sm'>
                          Current Status:
                        </span>
                        <Badge variant='outline'>{kitDetails.status}</Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Confirmation Message */}
              <div className='bg-primary/5 border-primary/20 flex items-start gap-3 rounded-lg border p-4'>
                <CheckCircle2 className='text-primary mt-0.5 h-5 w-5 flex-shrink-0' />
                <div className='space-y-1'>
                  <p className='text-sm font-medium'>
                    Ready to Start Kit Build
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    Clicking "Confirm & Print" will move this kit to "In
                    Progress" and generate a Kit Build Sheet that you can print
                    for the assembly team.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <DialogFooter className='flex gap-2 sm:gap-2'>
          <Button
            variant='outline'
            onClick={handleCancel}
            disabled={confirming}
          >
            <X className='mr-2 h-4 w-4' />
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || confirming || !!error || !kitDetails}
            className='gap-2'
          >
            {confirming ? (
              <>
                <Loader2 className='h-4 w-4 animate-spin' />
                Starting...
              </>
            ) : (
              <>
                <Printer className='h-4 w-4' />
                Confirm & Print
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
