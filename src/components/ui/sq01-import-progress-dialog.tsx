// Created and developed by Jai Singh
import React from 'react'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import type { ImportProgress } from '@/lib/supabase/sq01-data.service'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'

interface SQ01ImportProgressDialogProps {
  isOpen: boolean
  progress: ImportProgress | null
  onClose?: () => void
}

export const SQ01ImportProgressDialog = React.memo(
  ({ isOpen, progress, onClose }: SQ01ImportProgressDialogProps) => {
    if (!progress) return null

    // Memoized phase icon to prevent re-renders
    const phaseIcon = React.useMemo(() => {
      switch (progress.phase) {
        case 'completed':
          return <CheckCircle2 className='h-5 w-5 text-green-500' />
        case 'parsing':
        case 'validating':
        case 'clearing':
        case 'processing':
        case 'inserting':
          return <Loader2 className='h-5 w-5 animate-spin text-blue-500' />
        default:
          return <AlertCircle className='h-5 w-5 text-yellow-500' />
      }
    }, [progress.phase])

    // Memoized phase label
    const phaseLabel = React.useMemo(() => {
      switch (progress.phase) {
        case 'parsing':
          return 'Parsing Data'
        case 'validating':
          return 'Validating Headers'
        case 'clearing':
          return 'Clearing Existing Data'
        case 'processing':
          return 'Processing Rows'
        case 'inserting':
          return 'Inserting to Database'
        case 'completed':
          return 'Completed'
        default:
          return progress.phase
      }
    }, [progress.phase])

    // Memoized progress calculation with throttling
    const progressValue = React.useMemo(() => {
      if (progress.totalRows === 0) return 0

      switch (progress.phase) {
        case 'parsing':
          return 5
        case 'validating':
          return 10
        case 'clearing':
          return 15
        case 'processing':
          return 20 + (progress.currentRow / progress.totalRows) * 35
        case 'inserting':
          return 55 + (progress.processedChunks / progress.totalChunks) * 40
        case 'completed':
          return 100
        default:
          return 0
      }
    }, [
      progress.phase,
      progress.currentRow,
      progress.totalRows,
      progress.processedChunks,
      progress.totalChunks,
    ])

    const isCompleted = progress.phase === 'completed'

    // Memoized static elements to prevent re-renders
    const headerContent = React.useMemo(
      () => (
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            {phaseIcon}
            SQ01 Import Progress
          </DialogTitle>
          <DialogDescription>
            Processing {progress.totalRows.toLocaleString()} SQ01 data records
          </DialogDescription>
        </DialogHeader>
      ),
      [phaseIcon, progress.totalRows]
    )

    // Memoized results badges to prevent flashing
    const resultsBadges = React.useMemo(
      () => (
        <div className='flex flex-wrap gap-2'>
          {progress.insertedRows > 0 && (
            <Badge
              key='inserted'
              variant='default'
              className='bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
            >
              ✓ {progress.insertedRows.toLocaleString()} Inserted
            </Badge>
          )}
          {progress.duplicateRows > 0 && (
            <Badge key='duplicates' variant='secondary'>
              ⊖ {progress.duplicateRows.toLocaleString()} Duplicates
            </Badge>
          )}
          {progress.errorRows > 0 && (
            <Badge key='errors' variant='destructive'>
              ✗ {progress.errorRows.toLocaleString()} Errors
            </Badge>
          )}
        </div>
      ),
      [progress.insertedRows, progress.duplicateRows, progress.errorRows]
    )

    // Memoized detailed progress info to reduce re-renders
    const detailedProgress = React.useMemo(
      () =>
        progress.phase === 'processing' || progress.phase === 'inserting' ? (
          <div className='space-y-1 text-sm'>
            <div className='flex justify-between'>
              <span>Rows Processed:</span>
              <span className='font-mono'>
                {progress.currentRow.toLocaleString()} /{' '}
                {progress.totalRows.toLocaleString()}
              </span>
            </div>
            {progress.totalChunks > 0 && (
              <div className='flex justify-between'>
                <span>Chunks:</span>
                <span className='font-mono'>
                  {progress.processedChunks} / {progress.totalChunks}
                </span>
              </div>
            )}
          </div>
        ) : null,
      [
        progress.phase,
        progress.currentRow,
        progress.totalRows,
        progress.processedChunks,
        progress.totalChunks,
      ]
    )

    // Memoized error display
    const errorDetails = React.useMemo(
      () =>
        progress.errors.length > 0 ? (
          <div className='space-y-2'>
            <p className='text-destructive text-sm font-medium'>
              Recent Errors:
            </p>
            <div className='max-h-20 space-y-1 overflow-y-auto'>
              {progress.errors.slice(-3).map((error, index) => (
                <p
                  key={`error-${index}`}
                  className='text-destructive bg-destructive/10 rounded p-2 text-xs'
                >
                  {error}
                </p>
              ))}
            </div>
          </div>
        ) : null,
      [progress.errors]
    )

    return (
      <Dialog open={isOpen} onOpenChange={isCompleted ? onClose : undefined}>
        <DialogContent
          className='sm:max-w-[500px]'
          style={{
            willChange: 'auto',
            transform: 'none', // Disable transform animations that cause flashing
            transition: 'none', // Disable transitions during progress updates
          }}
        >
          {headerContent}

          <div className='space-y-6'>
            {/* Overall Progress - Optimized to prevent flashing */}
            <div className='space-y-2'>
              <div className='flex justify-between text-sm'>
                <span className='font-medium'>{phaseLabel}</span>
                <span className='text-muted-foreground'>
                  {Math.round(progressValue)}%
                </span>
              </div>
              <Progress
                value={progressValue}
                className='h-2'
                style={{
                  willChange: 'auto',
                  transition: 'none', // Disable progress bar animations
                  animation: 'none', // Disable any CSS animations
                }}
              />
            </div>

            {/* Current Status */}
            <div className='space-y-3'>
              <p className='text-muted-foreground text-sm'>
                {progress.message}
              </p>

              {/* Phase-specific details */}
              {detailedProgress}

              {/* Results Summary */}
              {resultsBadges}

              {/* Error Details */}
              {errorDetails}
            </div>

            {/* Performance Tips for Large Imports */}
            {progress.totalRows > 50000 && progress.phase !== 'completed' && (
              <div className='rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20'>
                <p className='text-xs text-blue-700 dark:text-blue-300'>
                  💡 <strong>Large Import Detected:</strong> This may take
                  several minutes. The import will continue in the background -
                  please don't close this browser tab.
                </p>
              </div>
            )}

            {/* Completion Summary */}
            {isCompleted && (
              <div className='rounded-lg bg-green-50 p-3 dark:bg-green-900/20'>
                <p className='text-sm font-medium text-green-700 dark:text-green-300'>
                  🎉 SQ01 Import Completed Successfully!
                </p>
                <p className='mt-1 text-xs text-green-600 dark:text-green-400'>
                  {progress.insertedRows.toLocaleString()} records added to your
                  SQ01 database.
                  {progress.errorRows > 0 &&
                    ` ${progress.errorRows.toLocaleString()} records had errors.`}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )
  }
)

SQ01ImportProgressDialog.displayName = 'SQ01ImportProgressDialog'

// Created and developed by Jai Singh
