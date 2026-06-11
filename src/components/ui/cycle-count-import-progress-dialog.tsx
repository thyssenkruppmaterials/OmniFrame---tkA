// Created and developed by Jai Singh
import React from 'react'
import { AlertCircle, CheckCircle2, Loader2, Upload } from 'lucide-react'
import type { ImportProgress } from '@/lib/supabase/cycle-count.service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'

interface CycleCountImportProgressDialogProps {
  isOpen: boolean
  progress: ImportProgress | null
  onClose?: () => void
}

/**
 * Progress dialog for the "Import Bulk Counts" flow in
 * `ManualCountsSearch`. Subscribes to the `importProgress` state on
 * `useCycleCountOperations` and renders a non-dismissable modal so the
 * user can't accidentally navigate away mid-upload (which would lose
 * any unprocessed rows — the loop is client-side row-by-row).
 *
 * The `ImportProgress` shape (`{ total, processed, errors, isComplete }`)
 * is simpler than the multi-phase delivery/LX03 importers, so we render
 * a single progress bar driven by `processed / total` plus a recent-
 * errors panel.
 */
export const CycleCountImportProgressDialog = React.memo(
  ({ isOpen, progress, onClose }: CycleCountImportProgressDialogProps) => {
    if (!progress) return null

    const total = progress.total
    const processed = progress.processed
    const errorCount = progress.errors.length
    const successCount = Math.max(processed - errorCount, 0)
    const isCompleted = progress.isComplete
    // Until we know the total (still in pre-flight) show an
    // indeterminate-feeling bar by clamping to a small non-zero value
    // so the user gets visual feedback that work is happening.
    const progressPct = React.useMemo(() => {
      if (isCompleted) return 100
      if (!total || total <= 0) return 5
      return Math.min(99, Math.round((processed / total) * 100))
    }, [isCompleted, processed, total])

    const phaseIcon = isCompleted ? (
      <CheckCircle2 className='h-5 w-5 text-emerald-500' />
    ) : (
      <Loader2 className='h-5 w-5 animate-spin text-blue-500' />
    )

    const phaseLabel = isCompleted
      ? errorCount > 0
        ? 'Import completed with errors'
        : 'Import completed'
      : total > 0
        ? `Importing row ${processed.toLocaleString()} of ${total.toLocaleString()}`
        : 'Preparing import…'

    return (
      <Dialog
        open={isOpen}
        // While importing, never let the dialog close via outside click
        // or Escape — the loop is client-side and dismissing the modal
        // is the most common way users accidentally interrupt it.
        onOpenChange={isCompleted ? onClose : undefined}
      >
        <DialogContent
          className='sm:max-w-[480px]'
          onInteractOutside={(e) => {
            if (!isCompleted) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (!isCompleted) e.preventDefault()
          }}
          // Hide the built-in close (×) button while running so there's
          // no in-modal escape hatch either.
          showCloseButton={isCompleted}
        >
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              {phaseIcon}
              {isCompleted ? 'Import Complete' : 'Importing Bulk Counts'}
            </DialogTitle>
            <DialogDescription>
              {total > 0
                ? `${total.toLocaleString()} rows detected in your clipboard`
                : 'Reading clipboard contents…'}
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-5'>
            <div className='space-y-2'>
              <div className='flex justify-between text-sm'>
                <span className='font-medium'>{phaseLabel}</span>
                <span className='text-muted-foreground tabular-nums'>
                  {progressPct}%
                </span>
              </div>
              <Progress value={progressPct} className='h-2' />
            </div>

            <div className='flex flex-wrap gap-2'>
              <Badge
                variant='default'
                className='bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300'
              >
                <CheckCircle2 className='mr-1 h-3 w-3' />
                {successCount.toLocaleString()} inserted
              </Badge>
              {errorCount > 0 && (
                <Badge variant='destructive'>
                  <AlertCircle className='mr-1 h-3 w-3' />
                  {errorCount.toLocaleString()} errors
                </Badge>
              )}
              {total > 0 && !isCompleted && (
                <Badge variant='secondary'>
                  <Upload className='mr-1 h-3 w-3' />
                  {Math.max(total - processed, 0).toLocaleString()} remaining
                </Badge>
              )}
            </div>

            {errorCount > 0 && (
              <div className='space-y-2'>
                <p className='text-destructive text-sm font-medium'>
                  Recent errors
                  {errorCount > 5 ? ` (showing last 5 of ${errorCount})` : ''}:
                </p>
                <div className='max-h-28 space-y-1 overflow-y-auto'>
                  {progress.errors.slice(-5).map((error, index) => (
                    <p
                      key={`cc-import-error-${index}`}
                      className='text-destructive bg-destructive/10 rounded p-2 text-xs'
                    >
                      {error}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {!isCompleted && (
              <div className='rounded-lg border border-amber-500/30 bg-amber-50 p-3 dark:bg-amber-900/15'>
                <p className='text-xs text-amber-800 dark:text-amber-300'>
                  ⚠️ <strong>Don't close this tab or navigate away.</strong>{' '}
                  Rows are inserted one at a time from your browser — leaving
                  the page now will stop the import after row{' '}
                  {processed.toLocaleString()}.
                </p>
              </div>
            )}

            {isCompleted && (
              <div className='space-y-3'>
                <div
                  className={
                    errorCount > 0
                      ? 'rounded-lg border border-amber-500/30 bg-amber-50 p-3 dark:bg-amber-900/15'
                      : 'rounded-lg border border-emerald-500/30 bg-emerald-50 p-3 dark:bg-emerald-900/15'
                  }
                >
                  <p
                    className={
                      errorCount > 0
                        ? 'text-sm font-medium text-amber-800 dark:text-amber-300'
                        : 'text-sm font-medium text-emerald-800 dark:text-emerald-300'
                    }
                  >
                    {errorCount > 0
                      ? `Imported ${successCount.toLocaleString()} of ${total.toLocaleString()} rows`
                      : `🎉 Imported ${successCount.toLocaleString()} rows`}
                  </p>
                  {errorCount > 0 && (
                    <p className='mt-1 text-xs text-amber-700 dark:text-amber-400'>
                      {errorCount.toLocaleString()} row
                      {errorCount === 1 ? '' : 's'} failed — see error list
                      above.
                    </p>
                  )}
                </div>
                <div className='flex justify-end'>
                  <Button size='sm' onClick={onClose}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )
  }
)

CycleCountImportProgressDialog.displayName = 'CycleCountImportProgressDialog'

// Created and developed by Jai Singh
