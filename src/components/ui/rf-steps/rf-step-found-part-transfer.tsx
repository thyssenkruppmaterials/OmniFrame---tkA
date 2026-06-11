// Created and developed by Jai Singh
/**
 * RFStepFoundPartTransfer
 *
 * Both the SOURCE and DESTINATION are known up-front on the task
 * (admin-set). The operator physically executes the transfer:
 *
 *   1. `source_scan`  — Shows source location (A) + part + expected qty.
 *                       Operator scans (or types) A to confirm arrival.
 *   2. `pick_qty`     — Keypad for the actual qty picked from A. Pre-
 *                       filled to the system qty; can be adjusted down
 *                       if some are missing.
 *   3. `dest_scan`    — Shows destination location (B). Operator scans
 *                       (or types) B to confirm arrival.
 *   4. `final_count`  — Keypad for the FINAL consolidated qty at B.
 *                       Pre-filled to (prior B qty + picked) but the
 *                       operator always enters what they actually see.
 *   5. `review`       — Summary card. Confirm completes the task.
 *
 * The step also supports short-circuiting when the operator can't find
 * the part at the source ("Nothing Here" → 0 picked, task completes with
 * a marker note).
 *
 * Completion payload (to `onComplete`, always with `shouldComplete: true`):
 *   {
 *     sourceLocation: string,         // = taskData.location (A)
 *     destinationLocation: string,    // = transfer_destination_location (B)
 *     pickedQuantity: number,         // actual qty moved from A
 *     destinationFinalQuantity: number, // final qty at B after consolidation
 *     sourceConfirmedAt: string,
 *     destinationConfirmedAt: string,
 *     shouldComplete: true,
 *     nothingFound?: true             // only when the operator found
 *                                      // nothing at the source
 *   }
 */
import { useCallback, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Keyboard,
  MapPin,
  Package,
  PackageX,
  ScanLine,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { QWERTYKeyboard } from '@/components/ui/qwerty-keyboard'
import { ScannerInput } from '@/components/ui/scanner-input'
import type { StepProps } from './types'

type Phase =
  | 'source_scan'
  | 'source_scan_manual'
  | 'pick_qty'
  | 'dest_scan'
  | 'dest_scan_manual'
  | 'final_count'
  | 'review'

/**
 * Canonicalises scanned location values so "k4-04-08-2" == "K4-04-08-2".
 */
function normalize(v: string) {
  return v.trim().toUpperCase()
}

export function RFStepFoundPartTransfer({
  step,
  taskData,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const sourceLocation = taskData.location
  // Destination is admin-configured on task creation and forwarded here
  // by the parent RF shell (see `ExtraStepRenderer` in
  // `rf-cycle-count-unified.tsx`).
  const destinationLocation = taskData.transfer_destination_location ?? ''
  const unit = taskData.unit_of_measure || 'EA'
  const systemQty = Math.max(0, Math.round(taskData.system_quantity ?? 0))

  const [phase, setPhase] = useState<Phase>('source_scan')
  const [sourceScan, setSourceScan] = useState('')
  const [sourceConfirmedAt, setSourceConfirmedAt] = useState<string | null>(
    null
  )
  const [destScan, setDestScan] = useState('')
  const [destConfirmedAt, setDestConfirmedAt] = useState<string | null>(null)
  const [pickedQty, setPickedQty] = useState<number>(systemQty)
  const [finalCount, setFinalCount] = useState<number>(0)

  // ---------------------------------------------------------------
  // Source scan
  // ---------------------------------------------------------------
  const acceptSourceScan = useCallback(
    (value: string) => {
      const scanned = normalize(value)
      if (!scanned) {
        toast.error('Scan or enter the source location')
        return
      }
      if (scanned !== normalize(sourceLocation)) {
        toast.error(
          `Wrong location — expected ${sourceLocation}, scanned ${scanned}`
        )
        return
      }
      setSourceScan(scanned)
      setSourceConfirmedAt(new Date().toISOString())
      setPhase('pick_qty')
    },
    [sourceLocation]
  )

  const handleNothingFound = useCallback(() => {
    const now = new Date().toISOString()
    onComplete({
      sourceLocation,
      destinationLocation,
      pickedQuantity: 0,
      destinationFinalQuantity: 0,
      sourceConfirmedAt: now,
      destinationConfirmedAt: now,
      shouldComplete: true,
      nothingFound: true,
    })
  }, [sourceLocation, destinationLocation, onComplete])

  // ---------------------------------------------------------------
  // Pick qty
  // ---------------------------------------------------------------
  const handleAcceptPick = useCallback(() => {
    if (pickedQty <= 0) {
      toast.error(
        'Enter how many you picked (or use "Nothing Here" on the previous screen)'
      )
      return
    }
    if (pickedQty > systemQty && systemQty > 0) {
      // Not a hard stop — the source might have more than the system
      // thought — but call it out so the operator can double-check.
      toast.warning(
        `You picked ${pickedQty} but system expected only ${systemQty}`
      )
    }
    setPhase('dest_scan')
  }, [pickedQty, systemQty])

  // ---------------------------------------------------------------
  // Destination scan
  // ---------------------------------------------------------------
  const acceptDestScan = useCallback(
    (value: string) => {
      const scanned = normalize(value)
      if (!scanned) {
        toast.error('Scan or enter the destination location')
        return
      }
      if (!destinationLocation) {
        toast.error(
          'This task has no destination configured. Ask your supervisor to set it.'
        )
        return
      }
      if (scanned !== normalize(destinationLocation)) {
        toast.error(
          `Wrong location — expected ${destinationLocation}, scanned ${scanned}`
        )
        return
      }
      setDestScan(scanned)
      setDestConfirmedAt(new Date().toISOString())
      // Default the final count to picked qty (assumes destination was
      // previously empty) — operator adjusts up if there were already
      // units there.
      setFinalCount((prev) => (prev > 0 ? prev : pickedQty))
      setPhase('final_count')
    },
    [destinationLocation, pickedQty]
  )

  // ---------------------------------------------------------------
  // Final count
  // ---------------------------------------------------------------
  const handleAcceptFinalCount = useCallback(() => {
    if (finalCount < 0) {
      toast.error('Final count can’t be negative')
      return
    }
    if (finalCount < pickedQty) {
      toast.error(
        `Final count at destination (${finalCount}) can’t be less than what you delivered (${pickedQty})`
      )
      return
    }
    setPhase('review')
  }, [finalCount, pickedQty])

  const handleComplete = useCallback(() => {
    onComplete({
      sourceLocation,
      destinationLocation,
      pickedQuantity: pickedQty,
      destinationFinalQuantity: finalCount,
      sourceConfirmedAt: sourceConfirmedAt ?? new Date().toISOString(),
      destinationConfirmedAt: destConfirmedAt ?? new Date().toISOString(),
      shouldComplete: true,
    })
  }, [
    onComplete,
    sourceLocation,
    destinationLocation,
    pickedQty,
    finalCount,
    sourceConfirmedAt,
    destConfirmedAt,
  ])

  // ============================================================
  // Guard: missing destination on the task row
  // ============================================================
  if (!destinationLocation) {
    return (
      <div className='space-y-4'>
        <div className='mb-2 space-y-2 text-center'>
          <Truck className='text-primary mx-auto h-12 w-12' />
          <h3 className='text-lg font-semibold'>Found Part Transfer</h3>
        </div>
        <Card className='border-2 border-red-500'>
          <CardContent className='space-y-2 p-4 text-center'>
            <div className='flex items-center justify-center gap-2 text-red-700 dark:text-red-400'>
              <AlertTriangle className='h-5 w-5' />
              <span className='font-semibold'>No destination configured</span>
            </div>
            <p className='text-muted-foreground text-xs'>
              Task{' '}
              <span className='font-mono font-semibold'>
                {taskData.count_number}
              </span>{' '}
              at source{' '}
              <span className='font-mono font-semibold'>
                {taskData.location}
              </span>{' '}
              doesn’t have a{' '}
              <span className='font-mono'>transfer_destination_location</span>{' '}
              value yet.
            </p>
            <p className='text-muted-foreground text-[11px]'>
              {'transfer_destination_location' in taskData
                ? 'The task row has no destination set. Set it via bulk import ("Destination Location" column) or have a supervisor fill it in.'
                : 'The task payload from the work-service does not include the destination field. The Rust work-service may need redeploying (migration 223).'}
            </p>
          </CardContent>
        </Card>
        <Button
          variant='outline'
          onClick={onBack}
          disabled={isProcessing}
          className='h-14 w-full text-lg'
        >
          Back
        </Button>
      </div>
    )
  }

  // ============================================================
  // Always-visible header card (From → To)
  // ============================================================

  const HeaderCard = (
    <Card>
      <CardContent className='p-4'>
        <div className='mb-3 flex items-center justify-center gap-2 text-sm'>
          <Package className='text-primary h-4 w-4' />
          <span className='text-muted-foreground'>Part</span>
          <span className='font-mono font-semibold'>
            {taskData.material_number}
          </span>
          {taskData.material_description && (
            <span className='text-muted-foreground truncate text-xs'>
              · {taskData.material_description}
            </span>
          )}
        </div>
        <div className='grid grid-cols-[1fr_auto_1fr] items-center gap-2'>
          <div
            className={cn(
              'min-w-0 rounded-md border p-2 text-center',
              phase === 'source_scan' || phase === 'source_scan_manual'
                ? 'border-primary bg-primary/5'
                : sourceConfirmedAt
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'bg-muted/40 border-dashed'
            )}
          >
            <p className='text-muted-foreground text-[10px] font-semibold tracking-wider uppercase'>
              Pick From
            </p>
            <p className='font-mono text-sm font-semibold break-all'>
              {sourceLocation}
            </p>
            <p className='text-muted-foreground mt-0.5 text-[10px]'>
              System {systemQty} {unit}
            </p>
          </div>
          <ArrowRight className='text-muted-foreground h-4 w-4 shrink-0' />
          <div
            className={cn(
              'min-w-0 rounded-md border p-2 text-center',
              phase === 'dest_scan' || phase === 'dest_scan_manual'
                ? 'border-primary bg-primary/5'
                : destConfirmedAt
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'bg-muted/40 border-dashed'
            )}
          >
            <p className='text-muted-foreground text-[10px] font-semibold tracking-wider uppercase'>
              Deliver To
            </p>
            <p className='font-mono text-sm font-semibold break-all'>
              {destinationLocation}
            </p>
            {pickedQty > 0 && phase !== 'source_scan' && (
              <p className='text-muted-foreground mt-0.5 text-[10px]'>
                Picked {pickedQty} {unit}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className='space-y-4'>
      <div className='mb-2 space-y-2 text-center'>
        <Truck className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Found Part Transfer</h3>
        <p className='text-muted-foreground text-sm'>
          {step.required
            ? 'Move the part from the source location to the destination (required)'
            : 'Move the part from the source location to the destination'}
        </p>
      </div>

      {HeaderCard}

      {/* Phase 1 — scan source */}
      {phase === 'source_scan' && (
        <Card className='border-primary/40 border-2'>
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-center gap-2'>
              <MapPin className='text-primary h-5 w-5' />
              <span className='text-base font-semibold'>
                Scan Source Location
              </span>
            </div>
            <p className='text-muted-foreground text-center text-xs'>
              Go to{' '}
              <span className='font-mono font-semibold'>{sourceLocation}</span>{' '}
              and scan its barcode to confirm you’re at the right spot.
            </p>
            <ScannerInput
              placeholder='Scan source location'
              value={sourceScan}
              onChange={(e) => setSourceScan(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  acceptSourceScan(sourceScan)
                }
              }}
              disabled={isProcessing}
              className='text-center font-mono text-lg font-semibold'
              autoFocus
            />
            <div className='grid grid-cols-3 gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setPhase('source_scan_manual')}
                disabled={isProcessing}
                className='h-14 text-xs'
              >
                <Keyboard className='mr-1 h-4 w-4' />
                Manual
              </Button>
              <Button
                type='button'
                onClick={() => acceptSourceScan(sourceScan)}
                disabled={isProcessing || !sourceScan.trim()}
                className='h-14 text-xs'
              >
                <ScanLine className='mr-1 h-4 w-4' />
                Confirm
              </Button>
              <Button
                type='button'
                variant='outline'
                onClick={handleNothingFound}
                disabled={isProcessing}
                className='h-14 text-xs'
                title='The part was not at the source'
              >
                <PackageX className='mr-1 h-4 w-4' />
                Nothing Here
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 1b — manual source entry */}
      {phase === 'source_scan_manual' && (
        <div className='space-y-3'>
          <Label className='text-sm font-medium'>
            Type the source location barcode
          </Label>
          <QWERTYKeyboard
            value={sourceScan}
            onChange={(v) => setSourceScan(v.toUpperCase())}
            placeholder={`Type ${sourceLocation}`}
          />
          <div className='grid grid-cols-2 gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setPhase('source_scan')
                setSourceScan('')
              }}
              disabled={isProcessing}
              className='h-12'
            >
              Cancel
            </Button>
            <Button
              type='button'
              onClick={() => acceptSourceScan(sourceScan)}
              disabled={isProcessing || !sourceScan.trim()}
              className='h-12'
            >
              Confirm
            </Button>
          </div>
        </div>
      )}

      {/* Phase 2 — pick qty */}
      {phase === 'pick_qty' && (
        <Card className='border-primary/40 border-2'>
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-center gap-2'>
              <Package className='text-primary h-5 w-5' />
              <span className='text-base font-semibold'>
                How Many Did You Pick?
              </span>
            </div>
            <p className='text-muted-foreground text-center text-xs'>
              System expected <span className='font-semibold'>{systemQty}</span>{' '}
              {unit} at <span className='font-mono'>{sourceLocation}</span>.
            </p>
            <InlineQtyKeypad
              value={pickedQty}
              onChange={setPickedQty}
              unitOfMeasure={unit}
            />
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setPhase('source_scan')}
                disabled={isProcessing}
                className='h-12 flex-1'
              >
                Back
              </Button>
              <Button
                type='button'
                onClick={handleAcceptPick}
                disabled={isProcessing || pickedQty <= 0}
                className='h-12 flex-2'
              >
                Record & Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 3 — scan destination */}
      {phase === 'dest_scan' && (
        <Card className='border-2 border-emerald-500/40'>
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-center gap-2'>
              <MapPin className='h-5 w-5 text-emerald-600' />
              <span className='text-base font-semibold text-emerald-700 dark:text-emerald-400'>
                Scan Destination Location
              </span>
            </div>
            <p className='text-muted-foreground text-center text-xs'>
              Take the {pickedQty} {unit} you picked to{' '}
              <span className='font-mono font-semibold'>
                {destinationLocation}
              </span>{' '}
              and scan its barcode.
            </p>
            <ScannerInput
              placeholder='Scan destination location'
              value={destScan}
              onChange={(e) => setDestScan(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  acceptDestScan(destScan)
                }
              }}
              disabled={isProcessing}
              className='text-center font-mono text-lg font-semibold'
              autoFocus
            />
            <div className='grid grid-cols-2 gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setPhase('dest_scan_manual')}
                disabled={isProcessing}
                className='h-14 text-sm'
              >
                <Keyboard className='mr-2 h-4 w-4' />
                Manual Entry
              </Button>
              <Button
                type='button'
                onClick={() => acceptDestScan(destScan)}
                disabled={isProcessing || !destScan.trim()}
                className='h-14 bg-emerald-600 text-sm text-white hover:bg-emerald-700'
              >
                <ScanLine className='mr-2 h-4 w-4' />
                Confirm
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === 'dest_scan_manual' && (
        <div className='space-y-3'>
          <Label className='text-sm font-medium'>
            Type the destination location barcode
          </Label>
          <QWERTYKeyboard
            value={destScan}
            onChange={(v) => setDestScan(v.toUpperCase())}
            placeholder={`Type ${destinationLocation}`}
          />
          <div className='grid grid-cols-2 gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setPhase('dest_scan')
                setDestScan('')
              }}
              disabled={isProcessing}
              className='h-12'
            >
              Cancel
            </Button>
            <Button
              type='button'
              onClick={() => acceptDestScan(destScan)}
              disabled={isProcessing || !destScan.trim()}
              className='h-12'
            >
              Confirm
            </Button>
          </div>
        </div>
      )}

      {/* Phase 4 — final count at destination */}
      {phase === 'final_count' && (
        <Card className='border-2 border-emerald-500/40'>
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-center gap-2'>
              <CheckCircle className='h-5 w-5 text-emerald-600' />
              <span className='text-base font-semibold text-emerald-700 dark:text-emerald-400'>
                Final Count at {destinationLocation}
              </span>
            </div>
            <p className='text-muted-foreground text-center text-xs'>
              Count EVERYTHING at{' '}
              <span className='font-mono'>{destinationLocation}</span> after
              dropping off the {pickedQty} {unit} you brought.
            </p>
            <InlineQtyKeypad
              value={finalCount}
              onChange={setFinalCount}
              unitOfMeasure={unit}
            />
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setPhase('dest_scan')}
                disabled={isProcessing}
                className='h-12 flex-1'
              >
                Back
              </Button>
              <Button
                type='button'
                onClick={handleAcceptFinalCount}
                disabled={isProcessing || finalCount < pickedQty}
                className='h-12 flex-2 bg-emerald-600 text-white hover:bg-emerald-700'
              >
                Review Transfer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 5 — review */}
      {phase === 'review' && (
        <Card className='border-primary/40 border-2'>
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-center gap-2'>
              <CheckCircle className='text-primary h-5 w-5' />
              <span className='text-base font-semibold'>Review Transfer</span>
            </div>
            <div className='bg-muted/30 grid gap-2 rounded-md p-3 text-sm'>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>Part</span>
                <span className='font-mono font-semibold'>
                  {taskData.material_number}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>Picked from</span>
                <span className='font-mono font-semibold'>
                  {sourceLocation}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>Delivered to</span>
                <span className='font-mono font-semibold'>
                  {destinationLocation}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>Transferred</span>
                <span className='font-semibold'>
                  {pickedQty} {unit}
                </span>
              </div>
              <div className='flex items-center justify-between border-t pt-2'>
                <span className='font-medium'>Final count at destination</span>
                <span className='text-lg font-bold tabular-nums'>
                  {finalCount} {unit}
                </span>
              </div>
            </div>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setPhase('final_count')}
                disabled={isProcessing}
                className='h-12 flex-1'
              >
                Edit
              </Button>
              <Button
                type='button'
                onClick={handleComplete}
                disabled={isProcessing}
                className='bg-primary text-primary-foreground h-12 flex-2'
              >
                Confirm & Complete
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer */}
      <div className='flex gap-2'>
        <Button
          variant='outline'
          onClick={onBack}
          disabled={isProcessing}
          className='h-14 w-full text-lg'
        >
          Back to Previous Step
        </Button>
      </div>
    </div>
  )
}

// ============================================================
// Inline numeric keypad
// ============================================================

function InlineQtyKeypad({
  value,
  onChange,
  unitOfMeasure = 'EA',
}: {
  value: number
  onChange: (v: number) => void
  unitOfMeasure?: string
}) {
  const press = (key: string) => {
    if (key === 'clear') {
      onChange(0)
      return
    }
    if (key === 'backspace') {
      const s = String(value || 0)
      const next = s.length <= 1 ? 0 : parseInt(s.slice(0, -1), 10) || 0
      onChange(next)
      return
    }
    const s = String(value === 0 ? '' : value) + key
    const n = parseInt(s, 10)
    if (!Number.isNaN(n) && n <= 99999) onChange(n)
  }
  const keys = [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    'clear',
    '0',
    'backspace',
  ]
  return (
    <div className='space-y-2'>
      <div className='bg-background flex h-14 items-center justify-center rounded-md border text-2xl font-semibold tabular-nums'>
        {value || 0}{' '}
        <span className='text-muted-foreground ml-2 text-sm'>
          {unitOfMeasure}
        </span>
      </div>
      <div className='grid grid-cols-3 gap-1.5'>
        {keys.map((k) => (
          <Button
            key={k}
            type='button'
            variant='outline'
            className='h-12 text-base font-semibold'
            onClick={() => press(k)}
          >
            {k === 'clear' ? 'C' : k === 'backspace' ? '⌫' : k}
          </Button>
        ))}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
