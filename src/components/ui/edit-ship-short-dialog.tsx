// Created and developed by Jai Singh
/**
 * Edit Ship Short Dialog
 *
 * Post-creation editor for the `Authorized to Ship Short` list on a kit.
 * Mirrors the input pattern from `add-kit-build-plan-dialog.tsx` but
 * targets an existing kit (looked up by kit_serial_number) and persists
 * via `RRKittingDataService.updateAuthorizedShipShortItems` — which
 * also re-runs `recheckBomCoverage` so an auto-Black-Hat from a missing
 * BOM line can self-clear when the operator authorises the part to
 * ship short.
 *
 * Created: May 12, 2026
 */
import * as React from 'react'
import { Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export interface ShipShortDraftItem {
  lineNumber: number
  partNumber: string
  description: string
}

interface EditShipShortDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  kitSerialNumber: string | null
  kitPoNumber: string | null
  initialItems: ShipShortDraftItem[]
  onSubmit: (
    items: Array<{ partNumber: string; description: string }>
  ) => Promise<void>
}

const MAX_ITEMS = 7

export function EditShipShortDialog({
  isOpen,
  onOpenChange,
  kitSerialNumber,
  kitPoNumber,
  initialItems,
  onSubmit,
}: EditShipShortDialogProps) {
  const [items, setItems] = React.useState<ShipShortDraftItem[]>([])
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  // Reseed from the kit each time the dialog is opened so unsaved
  // edits from a previous session don't leak in.
  React.useEffect(() => {
    if (isOpen) {
      setItems(
        initialItems.map((item, idx) => ({
          lineNumber: idx + 1,
          partNumber: item.partNumber,
          description: item.description,
        }))
      )
    }
  }, [isOpen, initialItems])

  const handleAdd = () => {
    if (items.length >= MAX_ITEMS) {
      toast.error(`Maximum ${MAX_ITEMS} Authorized to Ship Short items allowed`)
      return
    }
    setItems((prev) => [
      ...prev,
      { lineNumber: prev.length + 1, partNumber: '', description: '' },
    ])
  }

  const handleRemove = (index: number) => {
    setItems((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, lineNumber: i + 1 }))
    )
  }

  const handleChange = (
    index: number,
    field: 'partNumber' | 'description',
    value: string
  ) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting || !kitSerialNumber) return

    // The service also sanitises, but failing fast here gives a clearer
    // toast and lets us short-circuit the network round-trip.
    const cleaned = items
      .map((item) => ({
        partNumber: item.partNumber.trim(),
        description: item.description.trim(),
      }))
      .filter((item) => item.partNumber.length > 0)

    const partialEntries = items.filter(
      (item) => !item.partNumber.trim() && item.description.trim().length > 0
    )
    if (partialEntries.length > 0) {
      toast.error('Each ship-short row needs a Part Number', {
        description:
          'Remove the empty rows or fill in the part numbers before saving.',
      })
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit(cleaned)
    } catch (err) {
      logger.error('[EditShipShortDialog] submit error:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = (open: boolean) => {
    if (!isSubmitting) {
      onOpenChange(open)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className='max-h-[80vh] overflow-y-auto sm:max-w-[640px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShieldCheck className='h-5 w-5 text-amber-600 dark:text-amber-400' />
            Edit Authorized to Ship Short
          </DialogTitle>
          <DialogDescription>
            {kitPoNumber
              ? `Kit PO ${kitPoNumber}`
              : 'Update the authorized list for this kit.'}{' '}
            A part number listed here negates the Black Hat flag for the
            matching BOM line so the kit can be picked without that material on
            hand. Saving re-runs BOM coverage and will clear an auto-Black-Hat
            if every missing component is authorized.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='text-muted-foreground text-xs'>
              {items.length}/{MAX_ITEMS} items
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleAdd}
              disabled={isSubmitting || items.length >= MAX_ITEMS}
              className='h-7 text-xs'
            >
              <Plus className='mr-1 h-3 w-3' />
              Add Item
            </Button>
          </div>

          <div className='space-y-2'>
            {items.length > 0 ? (
              items.map((item, index) => (
                <div key={index} className='flex items-center gap-2'>
                  <span className='text-muted-foreground w-6 text-center text-xs'>
                    {item.lineNumber}.
                  </span>
                  <Input
                    placeholder='Part #'
                    value={item.partNumber}
                    onChange={(e) =>
                      handleChange(index, 'partNumber', e.target.value)
                    }
                    disabled={isSubmitting}
                    className='h-8 w-32 text-sm'
                    aria-label={`Part number for ship-short row ${item.lineNumber}`}
                  />
                  <Input
                    placeholder='Description / Reason'
                    value={item.description}
                    onChange={(e) =>
                      handleChange(index, 'description', e.target.value)
                    }
                    disabled={isSubmitting}
                    className='h-8 flex-1 text-sm'
                    aria-label={`Description for ship-short row ${item.lineNumber}`}
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => handleRemove(index)}
                    disabled={isSubmitting}
                    className='h-8 w-8 shrink-0'
                    aria-label={`Remove ship-short row ${item.lineNumber}`}
                  >
                    <Trash2 className='text-muted-foreground hover:text-destructive h-3.5 w-3.5' />
                  </Button>
                </div>
              ))
            ) : (
              <div className='border-muted-foreground/30 bg-muted/30 rounded-md border border-dashed p-4'>
                <p className='text-muted-foreground text-center text-xs'>
                  No parts authorized to ship short. Click{' '}
                  <span className='font-semibold'>Add Item</span> to authorize a
                  part.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className='gap-3'>
            <Button
              type='button'
              variant='outline'
              onClick={() => handleClose(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={isSubmitting || !kitSerialNumber}>
              {isSubmitting ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
