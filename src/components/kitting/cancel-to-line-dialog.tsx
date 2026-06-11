// Created and developed by Jai Singh
/**
 * CancelTOLineDialog
 *
 * Modal that captures an operator-supplied reason before calling
 * `RRKittingDataService.cancelTOLine` for a single TO row inside the
 * Kit Build Audit Trail. Cancelling a TO line:
 *
 *   1. Marks the row with `cancelled = true` + actor + reason on
 *      `RR_Kitting_DATA` (migration 325).
 *   2. Excludes the row from picking / kitting / total stage counts
 *      so the kit can keep advancing. The cancelled row stays visible
 *      in the audit trail's TO Lines table for traceability.
 *   3. Drops a system note on the kit's `kit_notes` thread (event_kind
 *      = `to_line_cancelled`) — the parent dialog wires this via
 *      `addSystemNote` after the service call returns success.
 *
 * The reason is required (the DB CHECK constraint
 * `rr_kitting_data_cancellation_invariants` enforces this on the
 * server too). The dialog disables Confirm until the operator has
 * typed something non-blank, so the round-trip never fails on a
 * client validation oversight.
 *
 * See `memorybank/OmniFrame/Implementations/Cancel-Kit-TO-Line.md`.
 */
import { useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface CancelTOLineTarget {
  /** RR_Kitting_DATA row id — the line being cancelled. */
  toLineId: string
  /** Transfer Order number (for display in the dialog header). */
  transferOrderNumber: string
  /** Material number (for display). */
  material: string
  /** Material description (for display). */
  materialDescription: string
}

interface CancelTOLineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: CancelTOLineTarget | null
  /**
   * Called when the operator confirms with a non-empty reason. Returns
   * a promise so the dialog can show a loading state and keep itself
   * open until the parent's service call resolves. Parent is
   * responsible for closing the dialog on success.
   */
  onConfirm: (target: CancelTOLineTarget, reason: string) => Promise<void>
}

export function CancelTOLineDialog({
  open,
  onOpenChange,
  target,
  onConfirm,
}: CancelTOLineDialogProps) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reseed the input every time the dialog opens so the previous
  // operator's reason doesn't bleed into the next cancellation. This
  // matches the "ack is per-submission" pattern used by the
  // NonWarehouseBin confirm dialog.
  useEffect(() => {
    if (open) {
      setReason('')
      setSubmitting(false)
    }
  }, [open])

  const trimmed = reason.trim()
  const canSubmit = !!target && trimmed.length > 0 && !submitting

  const handleConfirm = async () => {
    if (!canSubmit || !target) return
    setSubmitting(true)
    try {
      await onConfirm(target, trimmed)
    } finally {
      // Parent owns the open/close transition on success; failure leaves
      // the dialog open so the operator can adjust the reason and retry.
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Trash2 className='text-destructive h-4 w-4' />
            Cancel Transfer Order Line
          </DialogTitle>
          <DialogDescription>
            Cancelled lines are excluded from picking / kitting progress so the
            kit can keep advancing, but they stay visible in the audit trail
            with the reason you provide below.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className='bg-muted/40 space-y-1.5 rounded-md border px-3 py-2.5 text-xs'>
            <div className='flex items-baseline justify-between gap-3'>
              <span className='text-muted-foreground'>TO #</span>
              <span className='font-mono font-medium'>
                {target.transferOrderNumber}
              </span>
            </div>
            <div className='flex items-baseline justify-between gap-3'>
              <span className='text-muted-foreground'>Material</span>
              <span className='font-mono font-medium'>{target.material}</span>
            </div>
            {target.materialDescription && (
              <div className='flex items-baseline justify-between gap-3'>
                <span className='text-muted-foreground shrink-0'>
                  Description
                </span>
                <span className='text-right font-medium'>
                  {target.materialDescription}
                </span>
              </div>
            )}
          </div>
        )}

        <div className='space-y-2'>
          <Label htmlFor='cancel-reason' className='text-sm font-medium'>
            Reason for cancellation
            <span className='text-destructive ml-1'>*</span>
          </Label>
          <Textarea
            id='cancel-reason'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder='e.g. Material substituted upstream — replacement TO will be added separately.'
            rows={4}
            maxLength={500}
            disabled={submitting}
            className='resize-none'
          />
          <p className='text-muted-foreground text-xs'>
            {trimmed.length === 0
              ? 'Required — captured in the kit audit trail.'
              : `${trimmed.length} / 500 characters.`}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Keep Line
          </Button>
          <Button
            variant='destructive'
            onClick={handleConfirm}
            disabled={!canSubmit}
          >
            {submitting ? (
              <>
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                Cancelling…
              </>
            ) : (
              <>
                <Trash2 className='mr-1.5 h-3.5 w-3.5' />
                Cancel Line
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
