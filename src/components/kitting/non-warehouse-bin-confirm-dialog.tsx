// Created and developed by Jai Singh
/**
 * NonWarehouseBinConfirmDialog — modal wrapper around the
 * `NonWarehouseBinNotice` for the Append TOs to Kit flow.
 *
 * The Append flow doesn't use an inline form (the operator clicks a
 * dropdown action → clipboard parse → append), so the notice surfaces
 * as a blocking dialog with Confirm / Cancel actions instead.
 *
 * Reuses the same inline notice component so visuals + copy stay in
 * sync with the Add Kit Build Plan dialog's variant.
 */
import { useEffect, useState } from 'react'
import type { NonWarehouseBinDetection } from '@/lib/kitting/non-warehouse-bins'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NonWarehouseBinNotice } from '@/components/kitting/non-warehouse-bin-notice'

interface NonWarehouseBinConfirmDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Detection produced from the clipboard-imported TO records. */
  detection: NonWarehouseBinDetection
  /** Optional context for the dialog description ("Append to KIT-…"). */
  contextLabel?: string
  /** Fired when the operator confirms the acknowledgement. */
  onConfirm: () => void | Promise<void>
  /** Fired when the operator cancels (or closes the dialog). */
  onCancel: () => void
  isSubmitting?: boolean
}

export function NonWarehouseBinConfirmDialog({
  isOpen,
  onOpenChange,
  detection,
  contextLabel,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: NonWarehouseBinConfirmDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false)

  // Reseed the ack checkbox every time the dialog opens — never
  // pre-checked. The operator must consciously tick it for THIS batch.
  useEffect(() => {
    if (isOpen) setAcknowledged(false)
  }, [isOpen])

  const handleOpenChange = (open: boolean) => {
    if (isSubmitting) return
    if (!open) onCancel()
    onOpenChange(open)
  }

  const handleConfirm = async () => {
    if (!acknowledged || isSubmitting) return
    await onConfirm()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-[640px]'>
        <DialogHeader>
          <DialogTitle>Acknowledge External Plant Bins</DialogTitle>
          <DialogDescription>
            {contextLabel ? `${contextLabel} — ` : ''}
            Some of the TO rows you're about to append reference bins that live
            at the plant rather than inside our warehouse. Review and
            acknowledge before continuing.
          </DialogDescription>
        </DialogHeader>

        <NonWarehouseBinNotice
          detection={detection}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          disabled={isSubmitting}
        />

        <DialogFooter className='gap-3'>
          <Button
            type='button'
            variant='outline'
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type='button'
            onClick={handleConfirm}
            disabled={!acknowledged || isSubmitting}
          >
            {isSubmitting ? 'Appending…' : 'Acknowledge & Append'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
