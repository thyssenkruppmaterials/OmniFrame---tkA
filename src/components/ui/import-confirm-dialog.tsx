import React from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type ImportOperation = 'clear' | 'upsert' | 'append'

interface ImportConfirmDialogProps {
  isOpen: boolean
  rowCount: number
  operation?: ImportOperation
  datasetName?: string
  onConfirm: () => void
  onCancel: () => void
  isProcessing?: boolean
  additionalWarnings?: string[]
}

const operationMessages = {
  clear: 'All existing data will be cleared before import',
  upsert: 'Existing records will be updated, new records will be inserted',
  append: 'New records will be added to existing data',
}

export const ImportConfirmDialog = React.memo(
  ({
    isOpen,
    rowCount,
    operation = 'clear',
    datasetName = 'data',
    onConfirm,
    onCancel,
    isProcessing = false,
    additionalWarnings,
  }: ImportConfirmDialogProps) => {
    return (
      <Dialog
        open={isOpen}
        onOpenChange={(open) => !open && !isProcessing && onCancel()}
      >
        <DialogContent
          className='sm:max-w-[500px]'
          showCloseButton={!isProcessing}
        >
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <AlertTriangle className='h-5 w-5 text-yellow-500' />
              Large Dataset Detected
            </DialogTitle>
            <DialogDescription>
              Please review the import details before proceeding
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-4'>
            {/* Import Information */}
            <div className='rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20'>
              <div className='space-y-3'>
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium text-yellow-900 dark:text-yellow-200'>
                    Rows to Import:
                  </span>
                  <Badge variant='secondary' className='font-mono text-base'>
                    {rowCount.toLocaleString()}
                  </Badge>
                </div>

                <div className='space-y-1 text-xs text-yellow-800 dark:text-yellow-300'>
                  <p>• This may take several minutes to complete</p>
                  <p>• {operationMessages[operation]}</p>
                  <p>• Please keep this browser tab open during import</p>
                  {additionalWarnings &&
                    additionalWarnings.map((warning, index) => (
                      <p key={index}>• {warning}</p>
                    ))}
                </div>
              </div>
            </div>

            {/* Warning Message */}
            {operation === 'clear' && (
              <div className='bg-muted flex items-start gap-2 rounded-lg p-3'>
                <AlertTriangle className='mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-500' />
                <p className='text-muted-foreground text-sm'>
                  This operation cannot be undone. Make sure you have a backup
                  of your current {datasetName} if needed.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className='gap-2'>
            <Button
              variant='outline'
              onClick={onCancel}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={isProcessing}
              className='bg-blue-600 hover:bg-blue-700'
            >
              {isProcessing ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Starting Import...
                </>
              ) : (
                'Continue with Import'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
)

ImportConfirmDialog.displayName = 'ImportConfirmDialog'
