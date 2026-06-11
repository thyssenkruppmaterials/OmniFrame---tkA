// Created and developed by Jai Singh
/**
 * AddTOForBlackHatDialog
 *
 * "Add TO to Clear Black Hat" — the sibling on-ramp to the inline
 * `BlackHatShipShortPanel`. Operators have two ways to clear a
 * Black-Hat-flagged kit:
 *
 *   1. **Authorize Ship Short** for the missing material (per-line
 *      checkbox flow inside the panel) — the kit ships short for that
 *      part; the operator owns reconciling on the back end.
 *   2. **Add a Transfer Order** that physically supplies the missing
 *      material (this dialog) — once the material is satisfied by an
 *      imported TO row, the BOM-coverage matcher counts that line as
 *      covered and the Black Hat self-clears when *every* missing
 *      component is covered by *some* mix of TOs + INCORA items +
 *      ship-short authorizations.
 *
 * The two paths are additive: a kit with two missing materials can be
 * cleared by authorizing one and adding a TO for the other, or by
 * doing the same thing for both via either method. The matcher in
 * `recheckBomCoverageBySerial` ORs together TOs, INCORA values, and
 * ship-short part numbers — Black Hat clears only when the unmatched
 * set is empty.
 *
 * Wiring:
 *   - Clipboard parse reuses `parseClipboardData` from the Add Kit
 *     Build Plan dialog so SAP-export rows paste exactly the same way
 *     they do at kit creation time.
 *   - Submit calls `RRKittingDataService.appendTOsToKit`, which already
 *     dedupes by transfer-order-number (per-serial), syncs the kanban
 *     totals, and runs `recheckBomCoverageBySerial` — so the Black Hat
 *     either narrows (note re-stamped with the still-missing list) or
 *     clears outright.
 *   - Non-warehouse-bin acknowledgement is reused from the existing
 *     `NonWarehouseBinNotice`, gated by the same
 *     `useNonWarehouseBinPatterns` org setting (see migration 314 +
 *     [[Non-Warehouse-Bin-Acknowledgment]]).
 *
 * See `memorybank/OmniFrame/Implementations/Add-TO-To-Clear-Black-Hat.md`.
 */
import * as React from 'react'
import { CheckCircle2, ClipboardPaste, Loader2, Package, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  detectNonWarehouseBins,
  type NonWarehouseBinDetection,
} from '@/lib/kitting/non-warehouse-bins'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useNonWarehouseBinPatterns } from '@/hooks/use-kitting-workflow-settings'
import {
  parseClipboardData,
  type TransferOrderRecord,
} from '@/components/ui/add-kit-build-plan-dialog'
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
import { NonWarehouseBinNotice } from '@/components/kitting/non-warehouse-bin-notice'

export interface MissingMaterial {
  /** Material number (or INCORA reference for `incora_component`) used as the match key. */
  partNumber: string
  description: string
  componentType: 'material' | 'incora_component'
}

interface AddTOForBlackHatDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Kit primary key. Required — the dialog cannot operate without it. */
  kitSerialNumber: string | null
  /** Display label for the kit, used in the dialog description and toasts. */
  kitPoNumber: string | null
  /**
   * The current set of materials still driving the Black Hat. Used to
   * label each pasted TO as "covers a missing component" vs "extra".
   * INCORA Sub-Kit rows are intentionally excluded by the caller — a
   * sub-kit row has no material number for TO-coverage matching.
   */
  missingMaterials: MissingMaterial[]
  /**
   * Called after a successful `appendTOsToKit`. The caller is
   * responsible for refetching the kit's details + active flags so the
   * UI reflects whether the Black Hat narrowed or fully cleared.
   */
  onSubmitted: (result: {
    insertedCount: number
    coversCount: number
  }) => void | Promise<void>
}

export function AddTOForBlackHatDialog({
  isOpen,
  onOpenChange,
  kitSerialNumber,
  kitPoNumber,
  missingMaterials,
  onSubmitted,
}: AddTOForBlackHatDialogProps) {
  const nonWarehouseBinPatterns = useNonWarehouseBinPatterns()
  const [isImporting, setIsImporting] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [parsedTOs, setParsedTOs] = React.useState<TransferOrderRecord[]>([])
  const [nonWarehouseBinAck, setNonWarehouseBinAck] = React.useState(false)

  // Set of missing material numbers (uppercased + trimmed) for fast
  // per-TO coverage lookup. INCORA Sub-Kits are not eligible — they
  // have no materialNumber to key off.
  const missingMatchSet = React.useMemo(() => {
    const set = new Set<string>()
    for (const m of missingMaterials) {
      const key = m.partNumber.trim().toUpperCase()
      if (key) set.add(key)
    }
    return set
  }, [missingMaterials])

  // Reseed dialog state every time it opens so a previous aborted
  // session doesn't leak into a fresh paste.
  React.useEffect(() => {
    if (isOpen) {
      setParsedTOs([])
      setNonWarehouseBinAck(false)
    }
  }, [isOpen])

  const nonWarehouseDetection = React.useMemo<
    NonWarehouseBinDetection<TransferOrderRecord>
  >(
    () => detectNonWarehouseBins(parsedTOs, nonWarehouseBinPatterns),
    [parsedTOs, nonWarehouseBinPatterns]
  )

  // Reset the ack whenever the detection fingerprint changes (re-paste
  // counts as a new ack).
  const detectionFingerprint = React.useMemo(
    () =>
      nonWarehouseDetection.matches
        .map(
          (m) =>
            `${m.record.transferOrderNumber}|${m.sourceStorageBin}|${m.record.material}`
        )
        .sort()
        .join('::'),
    [nonWarehouseDetection.matches]
  )
  React.useEffect(() => {
    setNonWarehouseBinAck(false)
  }, [detectionFingerprint])

  // Per-TO coverage flag — does this row's material satisfy one of the
  // currently-missing BOM lines? Drives the green Match badge / row
  // tint in the preview list.
  const enrichedTOs = React.useMemo(
    () =>
      parsedTOs.map((to) => {
        const matKey = (to.material ?? '').trim().toUpperCase()
        const covers = !!matKey && missingMatchSet.has(matKey)
        return { to, covers }
      }),
    [parsedTOs, missingMatchSet]
  )

  const coversCount = React.useMemo(() => {
    const covered = new Set<string>()
    for (const { to, covers } of enrichedTOs) {
      if (!covers) continue
      const key = (to.material ?? '').trim().toUpperCase()
      if (key) covered.add(key)
    }
    return covered.size
  }, [enrichedTOs])

  const handlePasteFromClipboard = async () => {
    setIsImporting(true)
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error('Clipboard is empty', {
          description: 'Copy TO rows from SAP and try again.',
        })
        return
      }

      const records = parseClipboardData(text)
      if (records.length === 0) {
        toast.error('No valid TOs found', {
          description:
            'Ensure rows have at least 11 columns including a Transfer Order Number.',
        })
        return
      }

      setParsedTOs(records)
      toast.success(
        `Parsed ${records.length} Transfer Order${records.length === 1 ? '' : 's'}`,
        {
          description:
            'Review the matches below, then click "Add TOs" to import.',
        }
      )
    } catch (err) {
      logger.error('[AddTOForBlackHatDialog] clipboard error:', err)
      toast.error('Failed to read clipboard', {
        description: 'Please allow clipboard access and try again.',
      })
    } finally {
      setIsImporting(false)
    }
  }

  const handleClearParsed = () => {
    setParsedTOs([])
    setNonWarehouseBinAck(false)
  }

  const canSubmit =
    !!kitSerialNumber &&
    parsedTOs.length > 0 &&
    !isSubmitting &&
    (!nonWarehouseDetection.hasMatches || nonWarehouseBinAck)

  const handleSubmit = async () => {
    if (!canSubmit || !kitSerialNumber) return

    if (nonWarehouseDetection.hasMatches && !nonWarehouseBinAck) {
      toast.error('Acknowledge external plant bins before importing.')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await RRKittingDataService.appendTOsToKit(
        kitSerialNumber,
        parsedTOs
      )

      if (!result.success) {
        toast.error('Failed to add TOs', {
          description: result.error || 'An unexpected error occurred.',
        })
        return
      }

      const baseDescription =
        result.insertedCount === 0
          ? `All ${parsedTOs.length} TO${parsedTOs.length === 1 ? '' : 's'} already exist for this kit — nothing to insert.`
          : `${result.insertedCount} TO${result.insertedCount === 1 ? '' : 's'} added to ${kitPoNumber || kitSerialNumber}.`
      const coverageNote =
        result.bomCoverageComplete === true
          ? ' BOM coverage complete — Black Hat cleared.'
          : result.bomCoverageComplete === false
            ? ' Black Hat still active — some BOM lines are still missing.'
            : ''
      toast.success('Transfer Orders imported', {
        description: baseDescription + coverageNote,
      })

      await onSubmitted({
        insertedCount: result.insertedCount,
        coversCount,
      })

      onOpenChange(false)
    } catch (err) {
      logger.error('[AddTOForBlackHatDialog] submit error:', err)
      toast.error('Failed to add TOs')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (isSubmitting) return
    onOpenChange(open)
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-[760px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Package className='h-5 w-5 text-gray-900 dark:text-gray-100' />
            Add Transfer Orders to Clear Black Hat
          </DialogTitle>
          <DialogDescription>
            {kitPoNumber
              ? `Kit PO ${kitPoNumber}`
              : 'Import TOs to satisfy missing BOM components.'}
            {' — '}
            Paste TO rows from SAP. Any TO whose material matches one of the
            missing components below will count toward clearing the Black Hat
            once the full set is covered (by TOs, INCORA items, or Ship-Short
            authorizations).
          </DialogDescription>
        </DialogHeader>

        {/* Missing-material reference */}
        <div className='space-y-2 rounded-lg border border-gray-900/30 bg-gray-900/3 p-3 dark:border-gray-100/30 dark:bg-gray-100/3'>
          <p className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
            Materials Still Missing ({missingMaterials.length})
          </p>
          {missingMaterials.length === 0 ? (
            <p className='text-muted-foreground text-xs italic'>
              No TO-eligible missing materials — the Black Hat may already be
              cleared, or all remaining lines are INCORA Sub-Kits which must be
              cleared via INCORA Items instead.
            </p>
          ) : (
            <ul className='space-y-1'>
              {missingMaterials.map((m) => (
                <li
                  key={m.partNumber}
                  className='flex flex-wrap items-center gap-2 text-xs'
                >
                  <span className='font-mono font-semibold'>
                    {m.partNumber}
                  </span>
                  {m.componentType === 'incora_component' && (
                    <Badge variant='outline' className='text-[10px]'>
                      INCORA Component
                    </Badge>
                  )}
                  {m.description && (
                    <span className='text-muted-foreground truncate'>
                      — {m.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Clipboard import */}
        <div className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={handlePasteFromClipboard}
              disabled={isImporting || isSubmitting}
              className='flex-1'
            >
              {isImporting ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : (
                <ClipboardPaste className='mr-2 h-4 w-4' />
              )}
              {isImporting
                ? 'Reading clipboard...'
                : 'Paste TOs from Clipboard'}
            </Button>
            {parsedTOs.length > 0 && (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                onClick={handleClearParsed}
                disabled={isSubmitting}
                aria-label='Clear parsed TOs'
              >
                <X className='h-4 w-4' />
              </Button>
            )}
          </div>

          {parsedTOs.length === 0 ? (
            <div className='border-muted-foreground/30 bg-muted/30 rounded-md border border-dashed p-3'>
              <p className='text-muted-foreground text-xs leading-relaxed'>
                Copy TO rows from SAP (same 19-column format as the Add Kit
                Build Plan dialog) and click the button above. Each row's{' '}
                <span className='font-mono'>Material</span> column is checked
                against the Missing list above — TOs whose material matches a
                missing component will count toward clearing the Black Hat.
              </p>
            </div>
          ) : (
            <>
              {/* Summary banner */}
              <div className='rounded-md border border-green-500/30 bg-green-500/10 p-3'>
                <div className='flex flex-wrap items-center justify-between gap-2 text-sm text-green-800 dark:text-green-300'>
                  <div className='flex items-center gap-2'>
                    <CheckCircle2 className='h-4 w-4' />
                    <span className='font-medium'>
                      {parsedTOs.length} TO{parsedTOs.length === 1 ? '' : 's'}{' '}
                      parsed
                    </span>
                  </div>
                  <Badge
                    variant='outline'
                    className={cn(
                      'text-[10px]',
                      coversCount > 0
                        ? 'border-green-500/50 bg-green-500/10 text-green-800 dark:text-green-300'
                        : 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                    )}
                  >
                    Covers {coversCount} of {missingMaterials.length} missing
                  </Badge>
                </div>
              </div>

              {/* Per-TO preview list */}
              <div className='max-h-64 overflow-y-auto rounded-md border'>
                <table className='w-full text-xs'>
                  <thead className='bg-muted/50 sticky top-0'>
                    <tr className='border-b'>
                      <th className='p-2 text-left font-medium'>TO #</th>
                      <th className='p-2 text-left font-medium'>Material</th>
                      <th className='p-2 text-left font-medium'>Description</th>
                      <th className='p-2 text-left font-medium'>From Bin</th>
                      <th className='p-2 text-right font-medium'>Qty</th>
                      <th className='p-2 text-center font-medium'>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedTOs.map(({ to, covers }, idx) => (
                      <tr
                        key={`${to.transferOrderNumber}-${to.material}-${idx}`}
                        className={cn(
                          'border-b last:border-b-0',
                          covers && 'bg-green-500/6'
                        )}
                      >
                        <td className='p-2 font-mono'>
                          {to.transferOrderNumber || '—'}
                        </td>
                        <td className='p-2 font-mono'>{to.material || '—'}</td>
                        <td className='text-muted-foreground max-w-[180px] truncate p-2'>
                          {to.materialDescription || '—'}
                        </td>
                        <td className='p-2 font-mono'>
                          {to.sourceStorageBin || '—'}
                        </td>
                        <td className='p-2 text-right'>
                          {to.sourceTargetQty || '—'}
                        </td>
                        <td className='p-2 text-center'>
                          {covers ? (
                            <Badge
                              variant='outline'
                              className='border-green-500/50 bg-green-500/10 text-[10px] text-green-800 dark:text-green-300'
                            >
                              Covers missing
                            </Badge>
                          ) : (
                            <Badge
                              variant='outline'
                              className='text-muted-foreground text-[10px]'
                            >
                              Extra
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {coversCount === 0 && missingMaterials.length > 0 && (
                <p className='text-xs text-amber-700 italic dark:text-amber-300'>
                  None of the pasted TOs match a currently-missing material.
                  Adding them anyway will still expand the kit, but the Black
                  Hat will remain active.
                </p>
              )}
              {coversCount > 0 && coversCount < missingMaterials.length && (
                <p className='text-muted-foreground text-xs italic'>
                  These TOs cover {coversCount} of {missingMaterials.length}{' '}
                  missing components — the Black Hat will narrow but stay active
                  until the remaining {missingMaterials.length - coversCount}{' '}
                  are also covered (via additional TOs or Ship-Short
                  authorizations).
                </p>
              )}

              {/* External-plant-bin acknowledgement (reused) */}
              <NonWarehouseBinNotice
                detection={nonWarehouseDetection}
                acknowledged={nonWarehouseBinAck}
                onAcknowledgedChange={setNonWarehouseBinAck}
                disabled={isSubmitting}
              />
            </>
          )}
        </div>

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
            onClick={handleSubmit}
            disabled={!canSubmit}
            className='gap-2'
          >
            {isSubmitting ? (
              <>
                <Loader2 className='h-4 w-4 animate-spin' />
                Adding...
              </>
            ) : (
              <>
                <Package className='h-4 w-4' />
                Add {parsedTOs.length || ''} TO
                {parsedTOs.length === 1 ? '' : 's'} & Recheck Coverage
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
