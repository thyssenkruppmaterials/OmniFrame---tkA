// Created and developed by Jai Singh
/**
 * RFStepPartNumberVerification
 *
 * Operator verifies the material number at a location. Flow:
 *
 *   1. Scan (or manually type) the part barcode, OR tap "Location Empty".
 *   2. If the scan **matches** the expected part → "Part Matches" card.
 *        The operator can:
 *          - Tap "Complete Count" (no quantity required).
 *          - Tap "Re-scan Part" to redo the verification.
 *          - Tap "Find Another Part" to also capture any extras sitting
 *            at the same location (with quantities).
 *   3. If the scan **does NOT match** → "Wrong Part at Location":
 *          - Prompt for the quantity of the wrong part found.
 *          - Option to "Add Another Part" (multiple different parts in
 *            the same location).
 *          - Continue persists ALL found parts + their quantities.
 *   4. If the location has no barcode at all → "Location Empty" →
 *      completes the task with an empty marker.
 *
 * The component is self-contained and always emits `shouldComplete: true`
 * so the parent RF shell short-circuits the remainder of the workflow.
 *
 * When the operator has recorded one or more parts (via "Find Another"
 * or multiple variance captures), the final `match` flag is computed
 * across ALL entries: match=true only when EVERY captured part equals
 * the expected material (so "found the right part + some extras" is
 * correctly reported as a variance).
 *
 * Completion payload shapes:
 *   - Single match (no extras, no qty needed):
 *       { match: true, scannedMaterial, expectedMaterial, method,
 *         verifiedAt, scannedParts: [{ part_number, quantity, method,
 *         captured_at }], shouldComplete: true }
 *   - Multi-part (match + extras OR one or more wrong parts):
 *       { match, scannedMaterial, expectedMaterial, scannedParts: [...],
 *         shouldComplete: true }
 *   - Location empty:
 *       { locationEmpty: true, scannedMaterial: null, match: null,
 *         scannedParts: [], reportedAt, shouldComplete: true }
 */
import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  Keyboard,
  PackageX,
  Plus,
  ScanLine,
  Search,
  Trash2,
  XCircle,
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
  | 'scan' // waiting for first scan / manual / empty choice
  | 'manual' // QWERTY overlay for manual typing
  | 'match' // scanned value equals expected — ready to complete
  | 'qty' // capture qty for the most-recently scanned part (match OR wrong)
  | 'list' // show captured parts list, option to add more
  | 'empty'

interface CapturedPart {
  partNumber: string
  quantity: number
  method: 'scan' | 'manual'
  capturedAt: string
}

export function RFStepPartNumberVerification({
  step,
  taskData,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const expected = (taskData.material_number ?? '').trim()
  const [phase, setPhase] = useState<Phase>('scan')
  // Working values for the "currently being captured" scan
  const [workingValue, setWorkingValue] = useState('')
  const [workingMethod, setWorkingMethod] = useState<'scan' | 'manual'>('scan')
  const [workingQty, setWorkingQty] = useState<number>(0)
  // Accumulated captured parts (any mix of match + wrong parts)
  const [foundParts, setFoundParts] = useState<CapturedPart[]>([])

  const isExpected = useCallback(
    (partNumber: string) =>
      partNumber.trim().toUpperCase() === expected.toUpperCase(),
    [expected]
  )

  const workingIsMatch = workingValue ? isExpected(workingValue) : false
  const allMatch = useMemo(
    () =>
      foundParts.length > 0 &&
      foundParts.every((p) => isExpected(p.partNumber)),
    [foundParts, isExpected]
  )
  const anyWrong = useMemo(
    () => foundParts.some((p) => !isExpected(p.partNumber)),
    [foundParts, isExpected]
  )
  const totalCapturedQty = useMemo(
    () => foundParts.reduce((sum, p) => sum + p.quantity, 0),
    [foundParts]
  )

  /**
   * Called when a scan/manual entry is accepted. Routes to:
   *  - `match` when this is the FIRST capture and it matches (happy
   *    path: no qty required).
   *  - `qty` in every other case (mismatch OR we're already in
   *    multi-part mode so we need qty for this part too).
   */
  const acceptCapture = useCallback(
    (value: string, method: 'scan' | 'manual') => {
      const trimmed = value.trim()
      if (!trimmed) {
        toast.error('Please scan or enter a part number')
        return
      }
      setWorkingValue(trimmed)
      setWorkingMethod(method)
      if (foundParts.length === 0 && isExpected(trimmed)) {
        setPhase('match')
      } else {
        setWorkingQty(0)
        setPhase('qty')
      }
    },
    [foundParts.length, isExpected]
  )

  const handleRecordQty = useCallback(() => {
    if (workingQty <= 0) {
      toast.error('Enter a quantity greater than zero')
      return
    }
    setFoundParts((prev) => [
      ...prev,
      {
        partNumber: workingValue,
        quantity: workingQty,
        method: workingMethod,
        capturedAt: new Date().toISOString(),
      },
    ])
    setWorkingValue('')
    setWorkingQty(0)
    setPhase('list')
  }, [workingValue, workingQty, workingMethod])

  const handleAddAnotherPart = useCallback(() => {
    setWorkingValue('')
    setPhase('scan')
  }, [])

  /**
   * From the "Part Matches" card, operator wants to keep scanning more
   * parts at the same location. We transition to the qty capture phase
   * with the matched value preserved so they can record its quantity
   * first, then add more.
   */
  const handleFindAnotherFromMatch = useCallback(() => {
    // Default the matched part's qty to system_quantity — the operator
    // can override before recording.
    setWorkingQty(taskData.system_quantity || 0)
    setPhase('qty')
  }, [taskData.system_quantity])

  const handleRemoveFoundPart = useCallback((index: number) => {
    setFoundParts((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleContinue = useCallback(() => {
    if (phase === 'empty') {
      onComplete({
        locationEmpty: true,
        scannedMaterial: null,
        match: null,
        scannedParts: [],
        reportedAt: new Date().toISOString(),
        shouldComplete: true,
      })
      return
    }

    if (phase === 'match') {
      // Simple single-match happy path — no qty capture.
      const now = new Date().toISOString()
      onComplete({
        match: true,
        scannedMaterial: workingValue,
        expectedMaterial: expected,
        method: workingMethod,
        verifiedAt: now,
        scannedParts: [
          {
            part_number: workingValue,
            quantity: taskData.system_quantity,
            method: workingMethod,
            captured_at: now,
          },
        ],
        shouldComplete: true,
      })
      return
    }

    if (phase === 'list' && foundParts.length > 0) {
      const overallMatch = allMatch
      onComplete({
        match: overallMatch,
        scannedMaterial: foundParts[0].partNumber,
        expectedMaterial: expected,
        scannedParts: foundParts.map((p) => ({
          part_number: p.partNumber,
          quantity: p.quantity,
          method: p.method,
          captured_at: p.capturedAt,
        })),
        shouldComplete: true,
      })
      return
    }
  }, [
    phase,
    workingValue,
    workingMethod,
    expected,
    taskData.system_quantity,
    foundParts,
    allMatch,
    onComplete,
  ])

  // ============================================================
  // Render helpers
  // ============================================================

  const ExpectedHeaderCard = (
    <Card>
      <CardContent className='p-4'>
        <div className='grid grid-cols-2 gap-3 text-sm'>
          <div>
            <p className='text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase'>
              Expected Part
            </p>
            <p className='text-primary font-mono text-base font-semibold break-all'>
              {expected}
            </p>
          </div>
          <div>
            <p className='text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase'>
              Location
            </p>
            <p className='font-mono text-base font-semibold break-all'>
              {taskData.location}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className='space-y-4'>
      <div className='mb-2 space-y-2 text-center'>
        <ScanLine className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Scan Part In Location</h3>
        <p className='text-muted-foreground text-sm'>
          {step.required
            ? 'Confirm the correct part is at this location (required)'
            : 'Confirm the correct part is at this location'}
        </p>
      </div>

      {ExpectedHeaderCard}

      {/* Phase 1 — scan */}
      {phase === 'scan' && (
        <div className='space-y-3'>
          <div className='space-y-2'>
            <Label className='text-sm font-medium'>
              {foundParts.length > 0
                ? 'Scan Another Part Found'
                : 'Scan Part Barcode'}
            </Label>
            <ScannerInput
              placeholder='Scan part barcode'
              value={workingValue}
              onChange={(e) => setWorkingValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  acceptCapture(workingValue, 'scan')
                }
              }}
              disabled={isProcessing}
              className='text-center font-mono text-lg font-semibold'
              autoFocus
            />
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => setPhase('manual')}
              disabled={isProcessing}
              className='h-14 text-sm'
            >
              <Keyboard className='mr-2 h-4 w-4' />
              Manual Entry
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => setPhase('empty')}
              disabled={isProcessing || foundParts.length > 0}
              className='h-14 text-sm'
            >
              <PackageX className='mr-2 h-4 w-4' />
              Location Empty
            </Button>
          </div>

          {foundParts.length > 0 && (
            <>
              <FoundPartsList
                parts={foundParts}
                onRemove={handleRemoveFoundPart}
                isExpected={isExpected}
              />
              <Button
                type='button'
                variant='secondary'
                className='w-full'
                onClick={() => setPhase('list')}
                disabled={isProcessing}
              >
                Done Adding Parts ({foundParts.length})
              </Button>
            </>
          )}
        </div>
      )}

      {/* Phase 2 — manual entry (QWERTY). */}
      {phase === 'manual' && (
        <div className='space-y-3'>
          <Label className='text-sm font-medium'>
            Type the Part Number Found
          </Label>
          <QWERTYKeyboard
            value={workingValue}
            onChange={setWorkingValue}
            placeholder='Type part number'
          />
          <div className='grid grid-cols-2 gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setPhase('scan')
                setWorkingValue('')
              }}
              disabled={isProcessing}
              className='h-12'
            >
              Cancel
            </Button>
            <Button
              type='button'
              onClick={() => acceptCapture(workingValue, 'manual')}
              disabled={isProcessing || !workingValue.trim()}
              className='h-12'
            >
              Verify
            </Button>
          </div>
        </div>
      )}

      {/* Phase 3 — match (single happy path) */}
      {phase === 'match' && (
        <Card className='border-2 border-green-500'>
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-center gap-2'>
              <CheckCircle className='h-6 w-6 text-green-600' />
              <span className='text-base font-semibold text-green-700 dark:text-green-400'>
                Part Matches ✓
              </span>
            </div>
            <div className='bg-muted/40 space-y-1 rounded-md p-3 text-sm'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Scanned</span>
                <span className='font-mono font-semibold'>{workingValue}</span>
              </div>
              <div className='flex justify-between text-xs'>
                <span className='text-muted-foreground'>Entry Method</span>
                <span className='capitalize'>{workingMethod}</span>
              </div>
            </div>
            <p className='text-muted-foreground text-center text-xs'>
              Press Continue to complete this count.
            </p>
            <div className='space-y-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => {
                  setPhase('scan')
                  setWorkingValue('')
                }}
                disabled={isProcessing}
                className='w-full'
              >
                Re-scan Part
              </Button>
              {/* Also capture any additional parts at the same location
                  (e.g. the right part is here AND some extras are too). */}
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={handleFindAnotherFromMatch}
                disabled={isProcessing}
                className='w-full'
              >
                <Search className='mr-2 h-3.5 w-3.5' />
                Find Another Part
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 4 — capture qty for the most-recent scan (match OR wrong) */}
      {phase === 'qty' && (
        <Card
          className={cn(
            'border-2',
            workingIsMatch ? 'border-green-500' : 'border-red-500'
          )}
        >
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-center gap-2'>
              {workingIsMatch ? (
                <>
                  <CheckCircle className='h-6 w-6 text-green-600' />
                  <span className='text-base font-semibold text-green-700 dark:text-green-400'>
                    Expected Part Found
                  </span>
                </>
              ) : (
                <>
                  <XCircle className='h-6 w-6 text-red-600' />
                  <span className='text-base font-semibold text-red-700 dark:text-red-400'>
                    Wrong Part at Location
                  </span>
                </>
              )}
            </div>
            <div className='bg-muted/40 space-y-1 rounded-md p-3 text-sm'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>
                  {workingIsMatch ? 'Scanned' : 'Found'}
                </span>
                <span
                  className={cn(
                    'font-mono font-semibold',
                    !workingIsMatch && 'text-red-600'
                  )}
                >
                  {workingValue}
                </span>
              </div>
              <div className='flex justify-between text-xs'>
                <span className='text-muted-foreground'>Entry Method</span>
                <span className='capitalize'>{workingMethod}</span>
              </div>
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>
                Quantity of this part
              </Label>
              <InlineQtyKeypad
                value={workingQty}
                onChange={setWorkingQty}
                unitOfMeasure={taskData.unit_of_measure}
              />
            </div>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  setPhase(foundParts.length > 0 ? 'list' : 'scan')
                  setWorkingValue('')
                  setWorkingQty(0)
                }}
                disabled={isProcessing}
                className='h-12 flex-1'
              >
                Cancel
              </Button>
              <Button
                type='button'
                onClick={handleRecordQty}
                disabled={isProcessing || workingQty <= 0}
                className={cn(
                  'h-12 flex-2',
                  !workingIsMatch && 'bg-red-600 text-white hover:bg-red-700'
                )}
              >
                Record This Part
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 5 — review list of captured parts (mixed match + variance) */}
      {phase === 'list' && (
        <Card
          className={cn(
            'border-2',
            anyWrong ? 'border-red-500' : 'border-emerald-500'
          )}
        >
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-center gap-2'>
              {anyWrong ? (
                <>
                  <AlertTriangle className='h-6 w-6 text-red-600' />
                  <span className='text-base font-semibold text-red-700 dark:text-red-400'>
                    Part Variance · {foundParts.length}{' '}
                    {foundParts.length === 1 ? 'part' : 'parts'} found
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle className='h-6 w-6 text-emerald-600' />
                  <span className='text-base font-semibold text-emerald-700 dark:text-emerald-400'>
                    {foundParts.length}{' '}
                    {foundParts.length === 1 ? 'part' : 'parts'} recorded
                  </span>
                </>
              )}
            </div>
            <FoundPartsList
              parts={foundParts}
              onRemove={handleRemoveFoundPart}
              isExpected={isExpected}
            />
            <div className='text-muted-foreground text-xs'>
              Total qty captured:{' '}
              <span className='font-semibold'>{totalCapturedQty}</span>{' '}
              {taskData.unit_of_measure}
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleAddAnotherPart}
              disabled={isProcessing}
              className='w-full'
            >
              <Plus className='mr-2 h-4 w-4' />
              Add Another Part
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Phase 6 — location empty confirmation */}
      {phase === 'empty' && (
        <Card className='border-2 border-amber-500'>
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-center gap-2'>
              <PackageX className='h-6 w-6 text-amber-600' />
              <span className='text-base font-semibold text-amber-700 dark:text-amber-400'>
                Location Reported Empty
              </span>
            </div>
            <p className='text-muted-foreground text-center text-xs'>
              Pressing Continue will mark this location as empty and complete
              the count.
            </p>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setPhase('scan')}
              disabled={isProcessing}
              className='w-full'
            >
              Back to Scan
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Internal footer */}
      <div className='flex gap-2'>
        <Button
          variant='outline'
          onClick={onBack}
          disabled={isProcessing}
          className='h-14 flex-1 text-lg'
        >
          Back
        </Button>
        <Button
          onClick={handleContinue}
          disabled={
            isProcessing ||
            (phase !== 'match' && phase !== 'empty' && phase !== 'list')
          }
          className={cn(
            'h-14 flex-2 text-lg',
            phase === 'list' &&
              anyWrong &&
              'bg-red-600 text-white hover:bg-red-700'
          )}
        >
          {phase === 'empty'
            ? 'Confirm Empty & Complete'
            : phase === 'match'
              ? 'Complete Count'
              : phase === 'list'
                ? anyWrong
                  ? `Complete with Variance (${foundParts.length})`
                  : `Complete Count (${foundParts.length})`
                : 'Continue'}
        </Button>
      </div>
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function FoundPartsList({
  parts,
  onRemove,
  isExpected,
}: {
  parts: CapturedPart[]
  onRemove: (idx: number) => void
  isExpected: (part: string) => boolean
}) {
  if (parts.length === 0) return null
  return (
    <div className='space-y-1.5'>
      {parts.map((p, i) => {
        const isMatch = isExpected(p.partNumber)
        return (
          <div
            key={`${p.partNumber}-${i}`}
            className={cn(
              'flex items-center justify-between gap-2 rounded-md border p-2 text-sm',
              isMatch
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-red-500/30 bg-red-500/5'
            )}
          >
            <div className='min-w-0 flex-1'>
              <p className='font-mono text-sm font-semibold break-all'>
                {p.partNumber}
                {isMatch && (
                  <span className='ml-2 rounded-sm bg-emerald-500/15 px-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400'>
                    EXPECTED
                  </span>
                )}
              </p>
              <p className='text-muted-foreground text-[11px]'>
                Qty {p.quantity} · {p.method}
              </p>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='text-muted-foreground hover:text-destructive h-7 w-7 shrink-0'
              onClick={() => onRemove(i)}
              aria-label={`Remove ${p.partNumber}`}
            >
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Compact numeric keypad (mirrors the style of QuantityKeypad from
 * rf-cycle-count-unified, scaled to fit inside a variance card).
 */
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
