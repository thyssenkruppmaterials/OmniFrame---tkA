// Created and developed by Jai Singh
import React from 'react'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import type { ImportProgress } from '@/lib/supabase/material-master-data.service'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'

interface MaterialMasterImportProgressDialogProps {
  isOpen: boolean
  progress: ImportProgress | null
  onClose?: () => void
}

export const MaterialMasterImportProgressDialog = React.memo(
  ({ isOpen, progress, onClose }: MaterialMasterImportProgressDialogProps) => {
    if (!progress) return null

    // Memoized phase icon to prevent re-renders
    const phaseIcon = React.useMemo(() => {
      switch (progress.phase) {
        case 'completed':
          return <CheckCircle2 className='h-5 w-5 text-green-500' />
        case 'parsing':
        case 'validating':
        case 'processing':
        case 'upserting':
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
        case 'processing':
          return 'Processing Rows'
        case 'upserting':
          return 'Upserting to Database'
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
          return 15
        case 'processing':
          return 25 + (progress.currentRow / progress.totalRows) * 40
        case 'upserting':
          return 65 + (progress.processedChunks / progress.totalChunks) * 30
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
            Material Master Import Progress
          </DialogTitle>
          <DialogDescription>
            Processing {progress.totalRows.toLocaleString()} Material Master
            records with UPSERT logic
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
              key='processed'
              variant='default'
              className='bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
            >
              ✓ {progress.insertedRows.toLocaleString()} Processed
            </Badge>
          )}
          {progress.updatedRows > 0 && (
            <Badge
              key='updated'
              variant='default'
              className='bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
            >
              ↻ {progress.updatedRows.toLocaleString()} Updated
            </Badge>
          )}
          {progress.skippedRows > 0 && (
            <Badge key='skipped' variant='secondary'>
              ⊖ {progress.skippedRows.toLocaleString()} Skipped
            </Badge>
          )}
          {progress.errorRows > 0 && (
            <Badge key='errors' variant='destructive'>
              ✗ {progress.errorRows.toLocaleString()} Errors
            </Badge>
          )}
        </div>
      ),
      [
        progress.insertedRows,
        progress.updatedRows,
        progress.skippedRows,
        progress.errorRows,
      ]
    )

    // Memoized detailed progress info to reduce re-renders
    const detailedProgress = React.useMemo(
      () =>
        progress.phase === 'processing' || progress.phase === 'upserting' ? (
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

            {/* UPSERT Information */}
            {progress.phase === 'upserting' && (
              <div className='rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20'>
                <p className='text-xs text-blue-700 dark:text-blue-300'>
                  🔄 <strong>UPSERT Mode:</strong> Existing records will be
                  updated, new records will be inserted. No data will be lost
                  during this process.
                </p>
              </div>
            )}

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
                  🎉 Material Master Import Completed Successfully!
                </p>
                <p className='mt-1 text-xs text-green-600 dark:text-green-400'>
                  {progress.insertedRows.toLocaleString()} records processed in
                  your Material Master database.
                  {progress.errorRows > 0 &&
                    ` ${progress.errorRows.toLocaleString()} records had errors.`}
                  <br />
                  <strong>UPSERT Mode:</strong> Existing data preserved, updates
                  and new records applied.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )
  }
)

MaterialMasterImportProgressDialog.displayName =
  'MaterialMasterImportProgressDialog'

// Created and developed by Jai Singh
