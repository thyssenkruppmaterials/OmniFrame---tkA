// Created and developed by Jai Singh
'use client'

/**
 * RF Kitting Picking Form
 * Handles the picking workflow for Kit PO items in the RF Terminal
 * Created: December 14, 2025
 *
 * Workflow:
 * 1. Scan Kit PO Number
 * 2. Select Pick Type (Floor: K/S bins, Rack: R bins)
 * 3. Pick items: Go to bin → Scan location → Scan part → Confirm quantity
 * 4. Repeat until all items picked for selected type
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Calculator,
  Camera,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Eye,
  Layers,
  Loader2,
  MapPin,
  Package,
  Scan,
  Search,
  Truck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  rfKittingPickingService,
  validateKitPoNumber,
  cleanScannedPartNumber,
  isPotentialKitSerialNumber,
  type KitDisambiguationOption,
  type KittingPickData,
  type KittingPickItem,
} from '@/lib/supabase/rf-kitting-picking.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScannerInput } from '@/components/ui/scanner-input'
import { Textarea } from '@/components/ui/textarea'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

// Step definitions
type PickingStep =
  | 'kit_scan' // Step 1: Scan Kit PO Number
  | 'kit_select' // Step 1b: Disambiguation picker when PO maps to multiple kits
  | 'pick_type' // Step 2: Select Floor or Rack
  | 'go_to_bin' // Step 3: Navigate to next bin
  | 'scan_location' // Step 4: Confirm bin location
  | 'scan_part' // Step 5: Confirm part number
  | 'confirm_quantity' // Step 6: Confirm quantity
  | 'verify_adjacent_bins' // Step 6a: Verify adjacent bins (missing part workflow)
  | 'capture_missing_photo' // Step 6b: Capture photo of empty location
  | 'pick_complete' // Step 7: Individual pick complete
  | 'type_complete' // Step 8: All picks for type complete

interface PickingFormState {
  currentStep: PickingStep
  kitData: KittingPickData | null
  /**
   * Populated when the scanned Kit PO maps to two or more active kits.
   * Drives the in-app `kit_select` picker step. Once the operator
   * commits to one, this is cleared and we proceed straight to
   * `pick_type` with the chosen kit's data loaded.
   */
  kitOptions: KitDisambiguationOption[] | null
  /**
   * Last Kit PO that the operator scanned. Retained so the picker can
   * call verifyKitForPicking again with the chosen serial.
   */
  lastScannedKitPo: string
  pickType: 'floor' | 'rack' | null
  currentItem: KittingPickItem | null
  currentItemIndex: number
  scannedLocation: string
  scannedMaterial: string
  pickedQuantity: number
  isProcessing: boolean
  totalItemsForType: number
  pickedCountForType: number
  visuallyVerifiedPart: boolean
  // Missing part workflow state
  verifiedAboveBin: boolean
  verifiedBelowBin: boolean
  missingPartPhoto: string | null // Base64 or blob URL
  missingPartNotes: string
}

// Quantity Keypad Component
const QuantityKeypad = ({
  value,
  onChange,
  expectedQty,
}: {
  value: number
  onChange: (value: number) => void
  expectedQty: number
}) => {
  const handleKeypadClick = (key: string) => {
    if (key === 'clear') {
      onChange(0)
    } else if (key === 'backspace') {
      const newValue = Math.floor(value / 10)
      onChange(newValue)
    } else if (key === 'expected') {
      onChange(expectedQty)
    } else {
      const digit = parseInt(key)
      const newValue = value * 10 + digit
      if (newValue <= 9999) {
        onChange(newValue)
      }
    }
  }

  return (
    <div className='space-y-4'>
      <div className='bg-muted/30 border-muted-foreground/30 rounded-lg border-2 border-dashed p-4 text-center'>
        <div className='text-primary mb-1 text-3xl font-bold'>{value}</div>
        <div className='text-muted-foreground text-xs'>
          Expected: {expectedQty}
        </div>
      </div>

      <div className='grid grid-cols-3 gap-2'>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <Button
            key={num}
            type='button'
            variant='outline'
            size='lg'
            className='hover:bg-primary hover:text-primary-foreground h-14 text-lg font-semibold'
            onClick={() => handleKeypadClick(num.toString())}
          >
            {num}
          </Button>
        ))}
        <Button
          type='button'
          variant='outline'
          size='lg'
          className='hover:bg-destructive hover:text-destructive-foreground h-14 text-sm font-medium'
          onClick={() => handleKeypadClick('clear')}
        >
          Clear
        </Button>
        <Button
          type='button'
          variant='outline'
          size='lg'
          className='hover:bg-primary hover:text-primary-foreground h-14 text-lg font-semibold'
          onClick={() => handleKeypadClick('0')}
        >
          0
        </Button>
        <Button
          type='button'
          variant='outline'
          size='lg'
          className='hover:bg-secondary hover:text-secondary-foreground h-14 text-sm font-medium'
          onClick={() => handleKeypadClick('backspace')}
        >
          ←
        </Button>
      </div>

      {/* Quick fill expected quantity button */}
      <Button
        type='button'
        variant='secondary'
        size='lg'
        className='h-12 w-full'
        onClick={() => handleKeypadClick('expected')}
      >
        <Check className='mr-2 h-4 w-4' />
        Use Expected: {expectedQty}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Floor-pick visual confirmation helpers
// ---------------------------------------------------------------------------
//
// Floor bins (K/S prefix) have NO printed barcode — the operator cannot scan
// to confirm they're at the right pick location. Rack bins (R prefix) DO have
// barcodes. The service classifies bins identically (see
// `rf-kitting-picking.service.ts` ~line 478). We mirror the same single-char
// prefix check here so the UI branches consistently. An empty / non-K/S/R
// prefix falls through to the existing scan UI (defensive — the service today
// would have dropped such rows from both `floor_pick_items` and
// `rack_pick_items`, so the form should never see them).
const FLOOR_BIN_PREFIXES = new Set(['K', 'S'])
const isFloorBin = (sourceStorageBin: string | null | undefined): boolean => {
  if (!sourceStorageBin) return false
  return FLOOR_BIN_PREFIXES.has(sourceStorageBin.charAt(0).toUpperCase())
}

// Press-and-hold duration for the floor-pick visual confirmation gesture.
// Same value as `autoAdvanceDelay` (800ms) — kept in lockstep so the
// "deliberate confirmation" timing across this form stays consistent.
const HOLD_TO_CONFIRM_MS = 800

/**
 * Hold-to-confirm button. The operator must press AND HOLD for
 * `HOLD_TO_CONFIRM_MS` (~800ms) before `onConfirm` fires. A progress bar
 * fills the button surface during the hold so the gesture feedback is
 * obvious. Releasing early (mouseup, touchend, pointerleave) cancels.
 *
 * Used by the floor-pick `Confirm Location` step where no barcode exists
 * and a single tap is too easy to misfire on a glove-knock or accidental
 * scanner trigger. The intentional `~1s` press is the safeguard.
 */
const HoldToConfirmButton = ({
  onConfirm,
  disabled,
  label = 'Hold to Confirm',
  holdingLabel = 'Hold…',
  doneLabel = 'Confirmed',
  className,
}: {
  onConfirm: () => void
  disabled?: boolean
  label?: string
  holdingLabel?: string
  doneLabel?: string
  className?: string
}) => {
  const [progress, setProgress] = useState(0)
  const [isHolding, setIsHolding] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  const cancelHold = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    startRef.current = null
    setIsHolding(false)
    setProgress(0)
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const tick = useCallback(
    (now: number) => {
      if (startRef.current === null) return
      const elapsed = now - startRef.current
      const pct = Math.min(100, (elapsed / HOLD_TO_CONFIRM_MS) * 100)
      setProgress(pct)
      if (elapsed >= HOLD_TO_CONFIRM_MS) {
        rafRef.current = null
        startRef.current = null
        setIsHolding(false)
        setIsDone(true)
        // Defer the confirm so the filled bar paints once before the parent
        // swaps to the next step.
        setTimeout(() => onConfirm(), 30)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [onConfirm]
  )

  const startHold = useCallback(() => {
    if (disabled || isDone) return
    if (startRef.current !== null) return
    setIsHolding(true)
    startRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
  }, [disabled, isDone, tick])

  const buttonLabel = isDone ? doneLabel : isHolding ? holdingLabel : label

  return (
    <button
      type='button'
      disabled={disabled || isDone}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          startHold()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          cancelHold()
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'relative h-16 w-full overflow-hidden rounded-md border-2 font-semibold transition-colors',
        'touch-none select-none',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        disabled || isDone
          ? 'cursor-not-allowed border-green-500 bg-green-500 text-white'
          : 'border-primary bg-primary text-primary-foreground active:scale-[0.99]',
        className
      )}
      aria-label={label}
    >
      {/* Fill bar grows left-to-right while held */}
      <span
        className='bg-primary-foreground/20 pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-75 ease-linear'
        style={{ width: `${progress}%` }}
        aria-hidden='true'
      />
      <span className='relative z-10 flex items-center justify-center gap-2'>
        {isDone ? (
          <CheckCircle className='h-5 w-5' />
        ) : (
          <Eye className='h-5 w-5' />
        )}
        <span className='text-base'>{buttonLabel}</span>
      </span>
    </button>
  )
}

// Pick Type Selection Card
const PickTypeCard = ({
  type: _type,
  title,
  description,
  icon: Icon,
  count,
  pickedCount,
  onClick,
  disabled,
}: {
  type: 'floor' | 'rack'
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  count: number
  pickedCount: number
  onClick: () => void
  disabled?: boolean
}) => {
  // _type is kept for API consistency but not used in render
  const isComplete = count > 0 && pickedCount === count
  const isEmpty = count === 0

  return (
    <Card
      className={cn(
        'cursor-pointer border-2 p-4 transition-all duration-200',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:border-primary hover:shadow-md',
        isComplete && 'border-green-500 bg-green-50 dark:bg-green-900/20',
        isEmpty && 'border-muted-foreground/30 border-dashed'
      )}
      onClick={() => !disabled && !isEmpty && onClick()}
    >
      <div className='flex items-center gap-3'>
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full transition-colors',
            isComplete ? 'bg-green-500 text-white' : 'bg-muted'
          )}
        >
          {isComplete ? (
            <CheckCircle className='h-6 w-6' />
          ) : (
            <Icon className='h-6 w-6' />
          )}
        </div>
        <div className='flex-1'>
          <h4 className='text-base font-semibold'>{title}</h4>
          <p className='text-muted-foreground text-xs'>{description}</p>
          {!isEmpty && (
            <div className='mt-2'>
              <div className='mb-1 flex justify-between text-xs'>
                <span>
                  {pickedCount} of {count} picked
                </span>
                <span>{Math.round((pickedCount / count) * 100)}%</span>
              </div>
              <Progress value={(pickedCount / count) * 100} className='h-1.5' />
            </div>
          )}
          {isEmpty && (
            <p className='text-muted-foreground mt-1 text-xs italic'>
              No items in this category
            </p>
          )}
        </div>
        {!isEmpty && !isComplete && (
          <ArrowRight className='text-muted-foreground h-5 w-5' />
        )}
      </div>
    </Card>
  )
}

// Main RF Kitting Picking Form Component
interface RFKittingPickingFormProps {
  onBack?: () => void
  /**
   * Pre-fill the Scan step. Accepts EITHER a `kit_serial_number`
   * (`KIT-YYYYMMDD-NNN`) OR a `kit_po_number`; the form's
   * `handleKitPoValidation` smart-detects which path to take. The
   * prop name is kept for backward compatibility with the existing
   * RF Picking handoff in `rf-picking-form.tsx`.
   */
  initialKitPoNumber?: string
}

const RFKittingPickingForm: React.FC<RFKittingPickingFormProps> = ({
  onBack,
  initialKitPoNumber,
}) => {
  // State
  const [state, setState] = useState<PickingFormState>({
    currentStep: 'kit_scan',
    kitData: null,
    kitOptions: null,
    lastScannedKitPo: '',
    pickType: null,
    currentItem: null,
    currentItemIndex: 0,
    scannedLocation: '',
    scannedMaterial: '',
    pickedQuantity: 0,
    isProcessing: false,
    totalItemsForType: 0,
    pickedCountForType: 0,
    visuallyVerifiedPart: false,
    // Missing part workflow
    verifiedAboveBin: false,
    verifiedBelowBin: false,
    missingPartPhoto: null,
    missingPartNotes: '',
  })

  const [kitPoNumber, setKitPoNumber] = useState(initialKitPoNumber || '')
  const autoAdvanceDelay = 800

  // Auto-advance timers
  const [autoAdvanceTimers, setAutoAdvanceTimers] = useState(
    new Map<string, NodeJS.Timeout>()
  )

  // Refs
  const kitPoRef = useRef<HTMLInputElement>(null)
  const locationRef = useRef<HTMLInputElement>(null)
  const materialRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      autoAdvanceTimers.forEach((timer) => clearTimeout(timer))
    }
  }, [autoAdvanceTimers])

  // Auto-focus management
  useEffect(() => {
    const focusField = () => {
      switch (state.currentStep) {
        case 'kit_scan':
          setTimeout(() => kitPoRef.current?.focus(), 100)
          break
        case 'scan_location':
          setTimeout(() => locationRef.current?.focus(), 100)
          break
        case 'scan_part':
          setTimeout(() => materialRef.current?.focus(), 100)
          break
      }
    }
    focusField()
  }, [state.currentStep])

  // If initial Kit PO provided, validate immediately
  useEffect(() => {
    if (initialKitPoNumber && !state.kitData) {
      handleKitPoValidation(initialKitPoNumber)
    }
  }, [initialKitPoNumber])

  // Auto-advance handler with validation
  const handleAutoAdvance = useCallback(
    (fieldId: string, value: string) => {
      // Clear existing timer for this field
      const existingTimer = autoAdvanceTimers.get(fieldId)
      if (existingTimer) {
        clearTimeout(existingTimer)
        setAutoAdvanceTimers((prev) => {
          const newTimers = new Map(prev)
          newTimers.delete(fieldId)
          return newTimers
        })
      }

      // Check if field value is complete enough to trigger auto-advance
      let isComplete = false
      switch (fieldId) {
        case 'kitPoNumber':
          // Kit PO numbers are typically at least 6 characters
          isComplete =
            value.trim().length >= 6 &&
            validateKitPoNumber(value.trim()).isValid
          break
        case 'scannedLocation':
          isComplete = value.trim().length > 0
          break
        case 'scannedMaterial':
          isComplete = value.trim().length > 0
          break
        default:
          isComplete = false
      }

      if (isComplete) {
        logger.log(
          `🔄 RF Kit Picking: Setting auto-advance timer for ${fieldId} (${autoAdvanceDelay}ms)`
        )
        const timer = setTimeout(() => {
          logger.log(
            `⏰ RF Kit Picking: Auto-advance timer fired for ${fieldId}`
          )
          try {
            if (fieldId === 'kitPoNumber' && state.currentStep === 'kit_scan') {
              logger.log(
                '🚀 RF Kit Picking: Triggering Kit PO validation via auto-advance'
              )
              handleKitPoValidation(value)
            } else if (
              fieldId === 'scannedLocation' &&
              state.currentStep === 'scan_location'
            ) {
              logger.log(
                '🚀 RF Kit Picking: Triggering location validation via auto-advance'
              )
              handleLocationScan()
            } else if (
              fieldId === 'scannedMaterial' &&
              state.currentStep === 'scan_part'
            ) {
              logger.log(
                '🚀 RF Kit Picking: Triggering material validation via auto-advance'
              )
              handleMaterialScan()
            }
          } catch (error) {
            logger.error(
              '❌ RF Kit Picking: Error in auto-advance timer callback:',
              error
            )
          }
        }, autoAdvanceDelay)

        setAutoAdvanceTimers((prev) => new Map(prev).set(fieldId, timer))
      }
    },
    [state.currentStep, autoAdvanceTimers, autoAdvanceDelay]
  )

  // Handlers
  //
  // The Scan step now accepts BOTH a `kit_serial_number`
  // (`KIT-YYYYMMDD-NNN`, the canonical PK on `RR_Kitting_DATA`) and
  // the legacy `kit_po_number`. Smart-detect:
  //   - Input starts with `KIT-` (case-insensitive) → serial path
  //     (`verifyKitForPickingBySerialNumber`). Drops the operator
  //     straight into `pick_type` because the serial is globally
  //     unique — no Select-a-Kit disambiguation.
  //   - Otherwise → existing PO path (`verifyKitForPicking`). Still
  //     renders the `kit_select` disambiguation step when the scanned
  //     PO maps to multiple active kits.
  // The optional `kitSerialNumber` arg is only used by the
  // disambiguation picker — never by the new serial-first scan flow.
  const handleKitPoValidation = useCallback(
    async (inputKitIdentifier?: string, kitSerialNumber?: string) => {
      const scanned = (inputKitIdentifier || kitPoNumber).trim()

      const validation = validateKitPoNumber(scanned)
      if (!validation.isValid) {
        toast.error(validation.message)
        return
      }

      // Disambiguation picker callback path — we always know the PO
      // here and the operator has chosen a serial; stay on the
      // PO-with-serial entry point so PO sanity-check logic runs.
      if (kitSerialNumber) {
        await runPoPathValidation(scanned, kitSerialNumber)
        return
      }

      if (isPotentialKitSerialNumber(scanned)) {
        await runSerialPathValidation(scanned)
      } else {
        await runPoPathValidation(scanned)
      }
    },
    // runSerialPathValidation / runPoPathValidation are defined below
    // with their own dep arrays and are stable for our purposes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kitPoNumber]
  )

  const runSerialPathValidation = useCallback(async (kitSerial: string) => {
    setState((prev) => ({ ...prev, isProcessing: true }))
    try {
      const { data, error } =
        await rfKittingPickingService.verifyKitForPickingBySerialNumber(
          kitSerial
        )

      if (error || !data) {
        toast.error(error || 'Kit not found')
        setState((prev) => ({ ...prev, isProcessing: false }))
        return
      }

      setState((prev) => ({
        ...prev,
        kitData: data,
        kitOptions: null,
        // Keep the PO around for downstream callers that still take a
        // `kitPoNumber` arg (e.g. `reportMissingPart`).
        lastScannedKitPo: data.kit_po_number,
        currentStep: 'pick_type',
        isProcessing: false,
      }))

      toast.success(
        `Kit ${data.kit_serial_number} loaded — ${data.total_lines} items`
      )
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to load kit')
      setState((prev) => ({ ...prev, isProcessing: false }))
    }
  }, [])

  const runPoPathValidation = useCallback(
    async (kitPo: string, kitSerialNumber?: string) => {
      setState((prev) => ({ ...prev, isProcessing: true }))

      try {
        const { data, error, kits } =
          await rfKittingPickingService.verifyKitForPicking(
            kitPo,
            kitSerialNumber
          )

        // Multi-kit case (legacy PO fallback only): present the picker.
        if (!kitSerialNumber && kits && kits.length > 1) {
          setState((prev) => ({
            ...prev,
            kitData: null,
            kitOptions: kits,
            lastScannedKitPo: kitPo,
            currentStep: 'kit_select',
            isProcessing: false,
          }))
          return
        }

        if (error || !data) {
          toast.error(error || 'Kit not found')
          setState((prev) => ({ ...prev, isProcessing: false }))
          return
        }

        setState((prev) => ({
          ...prev,
          kitData: data,
          kitOptions: null,
          lastScannedKitPo: kitPo,
          currentStep: 'pick_type',
          isProcessing: false,
        }))

        toast.success(
          `Kit ${data.kit_serial_number || kitPo} loaded — ${data.total_lines} items`
        )
      } catch (error: unknown) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to load kit'
        )
        setState((prev) => ({ ...prev, isProcessing: false }))
      }
    },
    []
  )

  const handleKitSerialSelect = useCallback(
    (option: KitDisambiguationOption) => {
      handleKitPoValidation(state.lastScannedKitPo, option.kit_serial_number)
    },
    [handleKitPoValidation, state.lastScannedKitPo]
  )

  const handleCancelKitSelect = useCallback(() => {
    setKitPoNumber('')
    setState((prev) => ({
      ...prev,
      currentStep: 'kit_scan',
      kitData: null,
      kitOptions: null,
      lastScannedKitPo: '',
    }))
  }, [])

  const handlePickTypeSelect = useCallback(
    (type: 'floor' | 'rack') => {
      const { kitData } = state
      if (!kitData) return

      const items =
        type === 'floor' ? kitData.floor_pick_items : kitData.rack_pick_items
      const unpickedItems = items.filter((item) => !item.picked)

      if (unpickedItems.length === 0) {
        toast.info(`All ${type} picks are already complete`)
        return
      }

      const pickedCount =
        type === 'floor'
          ? kitData.floor_picked_count
          : kitData.rack_picked_count

      setState((prev) => ({
        ...prev,
        pickType: type,
        currentItem: unpickedItems[0],
        currentItemIndex: 0,
        totalItemsForType: items.length,
        pickedCountForType: pickedCount,
        currentStep: 'go_to_bin',
      }))
    },
    [state.kitData]
  )

  const handleLocationScan = useCallback(() => {
    const { currentItem, scannedLocation } = state
    if (!currentItem) return

    const validation = rfKittingPickingService.validateLocation(
      scannedLocation,
      currentItem.source_storage_bin
    )

    if (!validation.isValid) {
      toast.error(validation.message)
      return
    }

    setState((prev) => ({ ...prev, currentStep: 'scan_part' }))
    toast.success('Location confirmed!')
  }, [state.currentItem, state.scannedLocation])

  const handleMaterialScan = useCallback(() => {
    const { currentItem, scannedMaterial, visuallyVerifiedPart } = state
    if (!currentItem) return

    // If visually verified, skip the scan validation
    if (visuallyVerifiedPart) {
      setState((prev) => ({
        ...prev,
        currentStep: 'confirm_quantity',
        pickedQuantity: 0, // Start at 0, let user input or use "Use Expected" button
      }))
      toast.success('Part visually verified!')
      return
    }

    const validation = rfKittingPickingService.validateMaterial(
      scannedMaterial,
      currentItem.material
    )

    if (!validation.isValid) {
      toast.error(validation.message)
      return
    }

    // Start at 0, let user input quantity or use "Use Expected" button
    setState((prev) => ({
      ...prev,
      currentStep: 'confirm_quantity',
      pickedQuantity: 0,
    }))
    toast.success('Part confirmed!')
  }, [state.currentItem, state.scannedMaterial, state.visuallyVerifiedPart])

  const handleQuantityConfirm = useCallback(async () => {
    const {
      currentItem,
      pickedQuantity,
      kitData,
      pickType,
      visuallyVerifiedPart,
    } = state
    if (!currentItem || !kitData || !pickType) return

    // If quantity is 0, start the missing part verification workflow
    if (pickedQuantity === 0) {
      setState((prev) => ({ ...prev, currentStep: 'verify_adjacent_bins' }))
      toast.warning('Zero quantity entered - verify adjacent bins')
      return
    }

    setState((prev) => ({ ...prev, isProcessing: true }))

    try {
      // Mark the line as picked (with visual verification flag if applicable)
      const { success, error } = await rfKittingPickingService.markLinePicked(
        currentItem.id,
        pickedQuantity,
        visuallyVerifiedPart
      )

      if (!success) {
        toast.error(error || 'Failed to record pick')
        setState((prev) => ({ ...prev, isProcessing: false }))
        return
      }

      // Update kit status to in_progress if first pick. Per-kit-serial
      // so a sibling kit on the same PO is not flipped along with us.
      await rfKittingPickingService.updateKitStatusToInProgress(
        kitData.kit_serial_number
      )

      // Refresh kit data to get updated pick status (per-serial).
      const { data: refreshedData } =
        await rfKittingPickingService.verifyKitForPicking(
          kitData.kit_po_number,
          kitData.kit_serial_number
        )

      if (!refreshedData) {
        toast.error('Failed to refresh kit data')
        setState((prev) => ({ ...prev, isProcessing: false }))
        return
      }

      // Get next unpicked item for this pick type
      const items =
        pickType === 'floor'
          ? refreshedData.floor_pick_items
          : refreshedData.rack_pick_items
      const unpickedItems = items.filter((item) => !item.picked)
      const newPickedCount =
        pickType === 'floor'
          ? refreshedData.floor_picked_count
          : refreshedData.rack_picked_count

      if (unpickedItems.length === 0) {
        // All items of this type are picked
        toast.success(`All ${pickType} picks complete!`)
        setState((prev) => ({
          ...prev,
          kitData: refreshedData,
          currentStep: 'type_complete',
          pickedCountForType: newPickedCount,
          isProcessing: false,
        }))
      } else {
        // Move to next item
        toast.success(`Pick recorded! ${unpickedItems.length} remaining`)
        setState((prev) => ({
          ...prev,
          kitData: refreshedData,
          currentItem: unpickedItems[0],
          currentItemIndex: prev.currentItemIndex + 1,
          scannedLocation: '',
          scannedMaterial: '',
          pickedQuantity: 0,
          pickedCountForType: newPickedCount,
          currentStep: 'go_to_bin',
          isProcessing: false,
          visuallyVerifiedPart: false,
          // Reset missing part state
          verifiedAboveBin: false,
          verifiedBelowBin: false,
          missingPartPhoto: null,
          missingPartNotes: '',
        }))
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to record pick'
      )
      setState((prev) => ({ ...prev, isProcessing: false }))
    }
  }, [state])

  // Handle adjacent bins verification confirmation
  const handleAdjacentBinsVerified = useCallback(() => {
    const { verifiedAboveBin, verifiedBelowBin } = state

    if (!verifiedAboveBin || !verifiedBelowBin) {
      toast.error('Please verify both bins above and below')
      return
    }

    // Move to photo capture step
    setState((prev) => ({ ...prev, currentStep: 'capture_missing_photo' }))
    toast.info('Take a photo of the empty bin location')
  }, [state.verifiedAboveBin, state.verifiedBelowBin])

  // Handle photo capture
  const handlePhotoCapture = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      // Convert to base64 for preview and upload
      const reader = new FileReader()
      reader.onloadend = () => {
        setState((prev) => ({
          ...prev,
          missingPartPhoto: reader.result as string,
        }))
        toast.success('Photo captured!')
      }
      reader.readAsDataURL(file)
    },
    []
  )

  // Handle missing part report submission
  const handleMissingPartSubmit = useCallback(async () => {
    const {
      currentItem,
      kitData,
      pickType,
      missingPartPhoto,
      missingPartNotes,
    } = state
    if (!currentItem || !kitData || !pickType) return

    if (!missingPartPhoto) {
      toast.error('Please capture a photo of the empty location')
      return
    }

    setState((prev) => ({ ...prev, isProcessing: true }))

    try {
      // Report the missing part (this will upload photo, set flags, and add purple hat)
      const { success, error } =
        await rfKittingPickingService.reportMissingPart(
          currentItem.id,
          kitData.kit_po_number,
          missingPartPhoto,
          missingPartNotes || undefined
        )

      if (!success) {
        toast.error(error || 'Failed to report missing part')
        setState((prev) => ({ ...prev, isProcessing: false }))
        return
      }

      // Refresh kit data to get updated status (per-serial).
      const { data: refreshedData } =
        await rfKittingPickingService.verifyKitForPicking(
          kitData.kit_po_number,
          kitData.kit_serial_number
        )

      if (!refreshedData) {
        toast.error('Failed to refresh kit data')
        setState((prev) => ({ ...prev, isProcessing: false }))
        return
      }

      // Get next unpicked item for this pick type
      const items =
        pickType === 'floor'
          ? refreshedData.floor_pick_items
          : refreshedData.rack_pick_items
      const unpickedItems = items.filter((item) => !item.picked)
      const newPickedCount =
        pickType === 'floor'
          ? refreshedData.floor_picked_count
          : refreshedData.rack_picked_count

      toast.success('Missing part reported - Purple Hat flag added')

      if (unpickedItems.length === 0) {
        // All items of this type are picked/reported
        setState((prev) => ({
          ...prev,
          kitData: refreshedData,
          currentStep: 'type_complete',
          pickedCountForType: newPickedCount,
          isProcessing: false,
        }))
      } else {
        // Move to next item
        setState((prev) => ({
          ...prev,
          kitData: refreshedData,
          currentItem: unpickedItems[0],
          currentItemIndex: prev.currentItemIndex + 1,
          scannedLocation: '',
          scannedMaterial: '',
          pickedQuantity: 0,
          pickedCountForType: newPickedCount,
          currentStep: 'go_to_bin',
          isProcessing: false,
          visuallyVerifiedPart: false,
          // Reset missing part state
          verifiedAboveBin: false,
          verifiedBelowBin: false,
          missingPartPhoto: null,
          missingPartNotes: '',
        }))
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to report missing part'
      )
      setState((prev) => ({ ...prev, isProcessing: false }))
    }
  }, [state])

  const handleBackToPickType = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: 'pick_type',
      pickType: null,
      currentItem: null,
      currentItemIndex: 0,
      scannedLocation: '',
      scannedMaterial: '',
      pickedQuantity: 0,
      visuallyVerifiedPart: false,
      // Reset missing part state
      verifiedAboveBin: false,
      verifiedBelowBin: false,
      missingPartPhoto: null,
      missingPartNotes: '',
    }))
  }, [])

  const resetForm = useCallback(() => {
    // Clear all auto-advance timers
    autoAdvanceTimers.forEach((timer) => clearTimeout(timer))
    setAutoAdvanceTimers(new Map())

    setState({
      currentStep: 'kit_scan',
      kitData: null,
      kitOptions: null,
      lastScannedKitPo: '',
      pickType: null,
      currentItem: null,
      currentItemIndex: 0,
      scannedLocation: '',
      scannedMaterial: '',
      pickedQuantity: 0,
      isProcessing: false,
      totalItemsForType: 0,
      pickedCountForType: 0,
      visuallyVerifiedPart: false,
      // Missing part workflow
      verifiedAboveBin: false,
      verifiedBelowBin: false,
      missingPartPhoto: null,
      missingPartNotes: '',
    })
    setKitPoNumber('')
  }, [autoAdvanceTimers])

  // Animation variants
  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.3 } },
  }

  return (
    <div className='mx-auto w-full max-w-md space-y-4 p-4'>
      {/* Header with back button */}
      <RFScreenHeader
        title='Kit Picking'
        subtitle={
          state.kitData
            ? `${state.kitData.kit_po_number} • ${state.kitData.kit_number}`
            : 'Pick kit lines'
        }
        onBack={onBack}
      />

      {/* Progress indicator */}
      {state.kitData &&
        state.pickType &&
        state.currentStep !== 'type_complete' && (
          <div className='bg-muted/30 rounded-lg p-3'>
            <div className='mb-1 flex justify-between text-xs'>
              <span className='capitalize'>{state.pickType} Picks</span>
              <span>
                {state.pickedCountForType} of {state.totalItemsForType}
              </span>
            </div>
            <Progress
              value={(state.pickedCountForType / state.totalItemsForType) * 100}
              className='h-2'
            />
          </div>
        )}

      <Card className='min-h-[350px]'>
        <CardContent className='p-4'>
          <AnimatePresence mode='wait'>
            <motion.div
              key={state.currentStep}
              initial='hidden'
              animate='visible'
              exit='exit'
              variants={contentVariants}
              className='space-y-4'
            >
              {/* Step 1: Scan Kit Serial Number or PO */}
              {state.currentStep === 'kit_scan' && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <Package className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Scan Kit Serial Number
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Scan the kit serial number (
                      <span className='font-mono'>KIT-…</span>) to drop straight
                      into picking. Legacy Kit PO numbers are still accepted.
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='kit-po'>Kit Serial Number or PO</Label>
                    <ScannerInput
                      ref={kitPoRef}
                      id='kit-po'
                      type='text'
                      placeholder='Scan KIT-YYYYMMDD-NNN or Kit PO'
                      value={kitPoNumber}
                      onChange={(e) => {
                        const value = e.target.value.toUpperCase()
                        setKitPoNumber(value)
                        handleAutoAdvance('kitPoNumber', value)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleKitPoValidation()
                        }
                      }}
                      className='h-12 text-center font-mono text-lg'
                      disabled={state.isProcessing}
                    />
                  </div>

                  {state.isProcessing && (
                    <div className='flex items-center justify-center py-4'>
                      <Loader2 className='mr-2 h-6 w-6 animate-spin' />
                      <span>Loading kit...</span>
                    </div>
                  )}

                  <Button
                    onClick={() => handleKitPoValidation()}
                    disabled={!kitPoNumber.trim() || state.isProcessing}
                    className='h-12 w-full'
                  >
                    <Scan className='mr-2 h-4 w-4' />
                    Load Kit
                  </Button>
                </div>
              )}

              {/* Step 1b: Disambiguate when scanned PO maps to multiple kits */}
              {state.currentStep === 'kit_select' &&
                state.kitOptions &&
                state.kitOptions.length > 0 && (
                  <div className='space-y-4'>
                    <div className='space-y-2 text-center'>
                      <Layers className='text-primary mx-auto h-12 w-12' />
                      <h3 className='text-lg font-semibold'>Select a Kit</h3>
                      <p className='text-muted-foreground text-sm'>
                        Kit PO{' '}
                        <span className='font-mono'>
                          {state.lastScannedKitPo}
                        </span>{' '}
                        covers {state.kitOptions.length} active kits. Pick the
                        one you are working on.
                      </p>
                    </div>

                    <div className='space-y-2'>
                      {state.kitOptions.map((option) => {
                        const total = option.total_lines || 0
                        const picked = option.picked_count || 0
                        const pct = total > 0 ? (picked / total) * 100 : 0
                        return (
                          <button
                            key={option.kit_serial_number}
                            type='button'
                            onClick={() => handleKitSerialSelect(option)}
                            disabled={state.isProcessing}
                            className={cn(
                              'border-border hover:bg-accent/40 w-full rounded-lg border p-3 text-left transition-colors disabled:opacity-50'
                            )}
                          >
                            <div className='flex items-center justify-between'>
                              <div className='space-y-0.5'>
                                <div className='font-mono text-sm font-semibold'>
                                  {option.kit_serial_number}
                                </div>
                                <div className='text-xs'>
                                  {option.kit_number || 'Unnamed kit'}
                                </div>
                                <div className='text-muted-foreground text-[11px] capitalize'>
                                  {option.kit_build_status}
                                  {option.kit_build_number
                                    ? ` • Build ${option.kit_build_number}`
                                    : ''}
                                </div>
                              </div>
                              <div className='text-right'>
                                <div className='text-sm font-semibold'>
                                  {picked} / {total}
                                </div>
                                <div className='text-muted-foreground text-[11px]'>
                                  picked
                                </div>
                              </div>
                            </div>
                            <Progress value={pct} className='mt-2 h-1.5' />
                          </button>
                        )
                      })}
                    </div>

                    <Button
                      variant='outline'
                      onClick={handleCancelKitSelect}
                      disabled={state.isProcessing}
                      className='h-11 w-full'
                    >
                      <ChevronLeft className='mr-2 h-4 w-4' />
                      Cancel / Re-scan
                    </Button>

                    {state.isProcessing && (
                      <div className='flex items-center justify-center py-2'>
                        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
                        <span className='text-sm'>Loading kit…</span>
                      </div>
                    )}
                  </div>
                )}

              {/* Step 2: Select Pick Type */}
              {state.currentStep === 'pick_type' && state.kitData && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <Layers className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>Select Pick Type</h3>
                    <p className='text-muted-foreground text-sm'>
                      Choose floor picks or rack picks
                    </p>
                  </div>

                  <div className='space-y-3'>
                    <PickTypeCard
                      type='floor'
                      title='Floor Picks'
                      description='Bins starting with K or S'
                      icon={Box}
                      count={state.kitData.floor_pick_items.length}
                      pickedCount={state.kitData.floor_picked_count}
                      onClick={() => handlePickTypeSelect('floor')}
                    />

                    <PickTypeCard
                      type='rack'
                      title='Rack Picks'
                      description='Bins starting with R'
                      icon={Truck}
                      count={state.kitData.rack_pick_items.length}
                      pickedCount={state.kitData.rack_picked_count}
                      onClick={() => handlePickTypeSelect('rack')}
                    />
                  </div>

                  {/* Kit Summary */}
                  <Card className='bg-muted/20 p-3'>
                    <div className='grid grid-cols-2 gap-2 text-xs'>
                      <div>
                        <span className='text-muted-foreground'>Kit:</span>
                        <span className='ml-1 font-medium'>
                          {state.kitData.kit_number}
                        </span>
                      </div>
                      <div>
                        <span className='text-muted-foreground'>Program:</span>
                        <span className='ml-1 font-medium'>
                          {state.kitData.engine_program}
                        </span>
                      </div>
                      <div>
                        <span className='text-muted-foreground'>Status:</span>
                        <span className='ml-1 font-medium capitalize'>
                          {state.kitData.kit_build_status}
                        </span>
                      </div>
                      {state.kitData.due_date && (
                        <div>
                          <span className='text-muted-foreground'>Due:</span>
                          <span className='ml-1 font-medium'>
                            {new Date(
                              state.kitData.due_date
                            ).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </Card>

                  <Button
                    variant='outline'
                    onClick={resetForm}
                    className='w-full'
                  >
                    <ChevronLeft className='mr-2 h-4 w-4' />
                    Different Kit
                  </Button>
                </div>
              )}

              {/* Step 3: Go to Bin */}
              {state.currentStep === 'go_to_bin' && state.currentItem && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <MapPin className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>Go To Location</h3>
                    <p className='text-muted-foreground text-sm'>
                      Navigate to the bin location below
                    </p>
                  </div>

                  <Card className='bg-primary/5 border-primary/20 p-4'>
                    <div className='space-y-3 text-center'>
                      <div className='text-primary font-mono text-3xl font-bold'>
                        {state.currentItem.source_storage_bin}
                      </div>
                      <div className='border-border/60 grid grid-cols-2 gap-4 border-t pt-3'>
                        <div>
                          <span className='text-muted-foreground block text-xs tracking-wide uppercase'>
                            Part
                          </span>
                          <span className='text-foreground mt-1 block font-mono text-2xl font-bold break-all sm:text-3xl'>
                            {state.currentItem.material}
                          </span>
                        </div>
                        <div>
                          <span className='text-muted-foreground block text-xs tracking-wide uppercase'>
                            Qty
                          </span>
                          <span className='text-foreground mt-1 block text-2xl font-bold sm:text-3xl'>
                            {state.currentItem.source_target_qty}
                          </span>
                        </div>
                      </div>
                      {state.currentItem.material_description && (
                        <div className='text-muted-foreground mt-2 border-t pt-2 text-xs'>
                          {state.currentItem.material_description}
                        </div>
                      )}
                    </div>
                  </Card>

                  <Button
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        currentStep: 'scan_location',
                      }))
                    }
                    className='h-12 w-full'
                  >
                    <ArrowRight className='mr-2 h-4 w-4' />
                    At Location - Continue
                  </Button>

                  <Button
                    variant='outline'
                    onClick={handleBackToPickType}
                    className='w-full'
                  >
                    <ChevronLeft className='mr-2 h-4 w-4' />
                    Back to Pick Type
                  </Button>
                </div>
              )}

              {/* Step 4: Confirm Location
                  ---------------------------------------------------------
                  Floor bins (K/S) have NO printed barcode — the operator
                  cannot scan to confirm. Render a visual-confirm UI with a
                  press-and-hold (~800ms) gesture as the deliberate
                  safeguard (mirrors the existing no-barcode `visuallyVerified`
                  pattern from the part step, scaled up to the bin step where
                  visual recognition is the only correctness gate).

                  Rack bins (R) DO have barcodes — keep the scan-to-confirm
                  flow verbatim.

                  Internal `currentStep` value is kept as `'scan_location'`
                  for both branches so any downstream telemetry that ever
                  ends up reading the step value sees no regression. */}
              {state.currentStep === 'scan_location' && state.currentItem && (
                <div className='space-y-4'>
                  {isFloorBin(state.currentItem.source_storage_bin) ? (
                    <>
                      <div className='space-y-2 text-center'>
                        <MapPin className='text-primary mx-auto h-12 w-12' />
                        <h3 className='text-lg font-semibold'>
                          Confirm Location
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Floor bin — no barcode. Visually confirm you are at
                          this bin.
                        </p>
                      </div>

                      {/* Giant bin label — visual recognition is the only
                          safeguard, so this is the most prominent thing on
                          the screen. */}
                      <Card className='bg-primary/5 border-primary/30 border-2 p-5'>
                        <div className='space-y-3 text-center'>
                          <p className='text-muted-foreground text-xs font-medium tracking-widest uppercase'>
                            You should be at
                          </p>
                          <p className='text-primary font-mono text-5xl leading-tight font-extrabold tracking-tight break-all sm:text-6xl'>
                            {state.currentItem.source_storage_bin}
                          </p>
                          <div className='text-muted-foreground border-border/60 grid grid-cols-2 gap-4 border-t pt-3'>
                            <div>
                              <span className='block text-xs tracking-wide uppercase'>
                                Part
                              </span>
                              <span className='text-foreground mt-1 block font-mono text-2xl font-bold break-all sm:text-3xl'>
                                {state.currentItem.material}
                              </span>
                            </div>
                            <div>
                              <span className='block text-xs tracking-wide uppercase'>
                                Qty
                              </span>
                              <span className='text-foreground mt-1 block text-2xl font-bold sm:text-3xl'>
                                {state.currentItem.source_target_qty}
                              </span>
                            </div>
                          </div>
                        </div>
                      </Card>

                      <HoldToConfirmButton
                        label={`Hold to Confirm — ${state.currentItem.source_storage_bin}`}
                        holdingLabel='Keep Holding…'
                        doneLabel='Location Confirmed'
                        onConfirm={() => {
                          // Floor bins have no barcode, so we bypass the
                          // scan-validation path entirely and advance straight
                          // to the part-scan step. The press-and-hold gesture
                          // IS the verification — `validateLocation` would
                          // fail without a scanned value here.
                          setState((prev) => ({
                            ...prev,
                            currentStep: 'scan_part',
                            scannedLocation: '',
                          }))
                          toast.success('Location confirmed (visual)')
                        }}
                      />

                      <Button
                        variant='outline'
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            currentStep: 'go_to_bin',
                            scannedLocation: '',
                          }))
                        }
                        className='w-full'
                      >
                        <ChevronLeft className='mr-2 h-4 w-4' />
                        Back
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className='space-y-2 text-center'>
                        <MapPin className='text-primary mx-auto h-12 w-12' />
                        <h3 className='text-lg font-semibold'>
                          Confirm Location
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Scan the bin barcode to confirm
                        </p>
                        <p className='text-primary font-mono text-lg font-semibold'>
                          {state.currentItem.source_storage_bin}
                        </p>
                      </div>

                      <div className='space-y-2'>
                        <Label htmlFor='location'>Scan Location</Label>
                        <ScannerInput
                          ref={locationRef}
                          id='location'
                          type='text'
                          placeholder='Scan bin location'
                          value={state.scannedLocation}
                          onChange={(e) => {
                            const value = e.target.value.toUpperCase()
                            setState((prev) => ({
                              ...prev,
                              scannedLocation: value,
                            }))
                            // Trigger auto-advance timer when location matches expected
                            if (
                              value.length > 0 &&
                              value ===
                                state.currentItem?.source_storage_bin.toUpperCase()
                            ) {
                              handleAutoAdvance('scannedLocation', value)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleLocationScan()
                            }
                          }}
                          className='h-12 text-center font-mono text-lg'
                        />
                      </div>

                      <Button
                        onClick={handleLocationScan}
                        disabled={!state.scannedLocation.trim()}
                        className='h-12 w-full'
                      >
                        <Check className='mr-2 h-4 w-4' />
                        Confirm Location
                      </Button>

                      <Button
                        variant='outline'
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            currentStep: 'go_to_bin',
                            scannedLocation: '',
                          }))
                        }
                        className='w-full'
                      >
                        <ChevronLeft className='mr-2 h-4 w-4' />
                        Back
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Step 5: Scan Part */}
              {state.currentStep === 'scan_part' && state.currentItem && (
                <div className='space-y-4'>
                  {/* Visual Verification Checkbox - Top Left */}
                  <div className='border-muted-foreground/30 bg-muted/20 flex items-start gap-3 rounded-lg border-2 border-dashed p-3'>
                    <Checkbox
                      id='visual-verify'
                      checked={state.visuallyVerifiedPart}
                      onCheckedChange={(checked) =>
                        setState((prev) => ({
                          ...prev,
                          visuallyVerifiedPart: checked === true,
                        }))
                      }
                      className='mt-0.5 h-6 w-6'
                    />
                    <div className='flex-1'>
                      <Label
                        htmlFor='visual-verify'
                        className='flex cursor-pointer items-center gap-2 text-sm font-medium'
                      >
                        <Eye className='h-4 w-4' />
                        No Label - Visual Verify
                      </Label>
                      <p className='text-muted-foreground mt-1 text-xs'>
                        Check this box if there is no barcode to scan. Visually
                        confirm the part number below matches.
                      </p>
                    </div>
                  </div>

                  <div className='space-y-2 text-center'>
                    <Scan className='text-primary mx-auto h-10 w-10' />
                    <h3 className='text-lg font-semibold'>Confirm Part</h3>
                    <p className='text-muted-foreground text-sm'>
                      {state.visuallyVerifiedPart
                        ? 'Visually verify the part number below'
                        : 'Scan the part number to confirm'}
                    </p>
                  </div>

                  {/* Large Part Number Display for Visual Verification */}
                  <Card
                    className={cn(
                      'border-2 p-4 transition-all',
                      state.visuallyVerifiedPart
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                        : 'border-primary/20 bg-primary/5'
                    )}
                  >
                    <div className='space-y-2 text-center'>
                      <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                        Part Number
                      </p>
                      <p
                        className={cn(
                          'font-mono font-bold tracking-wider',
                          state.visuallyVerifiedPart
                            ? 'text-3xl text-amber-700 dark:text-amber-400'
                            : 'text-primary text-2xl'
                        )}
                      >
                        {state.currentItem.material}
                      </p>
                      {state.currentItem.material_description && (
                        <p className='text-muted-foreground mt-2 border-t pt-2 text-sm'>
                          {state.currentItem.material_description}
                        </p>
                      )}
                    </div>
                  </Card>

                  {/* Scanner Input - Hidden when visual verify is checked */}
                  {!state.visuallyVerifiedPart && (
                    <div className='space-y-2'>
                      <Label htmlFor='material'>Scan Part Number</Label>
                      <ScannerInput
                        ref={materialRef}
                        id='material'
                        type='text'
                        placeholder='Scan part number'
                        value={state.scannedMaterial}
                        onChange={(e) => {
                          const value = e.target.value.toUpperCase()
                          setState((prev) => ({
                            ...prev,
                            scannedMaterial: value,
                          }))
                          // Clean barcode prefixes before comparing for auto-advance
                          const cleaned =
                            cleanScannedPartNumber(value).toUpperCase()
                          if (
                            cleaned.length > 0 &&
                            cleaned ===
                              state.currentItem?.material.toUpperCase()
                          ) {
                            handleAutoAdvance('scannedMaterial', value)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleMaterialScan()
                          }
                        }}
                        className='h-12 text-center font-mono text-lg'
                      />
                    </div>
                  )}

                  <Button
                    onClick={handleMaterialScan}
                    disabled={
                      !state.visuallyVerifiedPart &&
                      !state.scannedMaterial.trim()
                    }
                    className={cn(
                      'h-12 w-full',
                      state.visuallyVerifiedPart &&
                        'bg-amber-600 hover:bg-amber-700'
                    )}
                  >
                    {state.visuallyVerifiedPart ? (
                      <>
                        <Eye className='mr-2 h-4 w-4' />
                        Confirm Visual Verification
                      </>
                    ) : (
                      <>
                        <Check className='mr-2 h-4 w-4' />
                        Confirm Part
                      </>
                    )}
                  </Button>

                  <Button
                    variant='outline'
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        currentStep: 'scan_location',
                        scannedMaterial: '',
                        visuallyVerifiedPart: false,
                      }))
                    }
                    className='w-full'
                  >
                    <ChevronLeft className='mr-2 h-4 w-4' />
                    Back
                  </Button>
                </div>
              )}

              {/* Step 6: Confirm Quantity */}
              {state.currentStep === 'confirm_quantity' &&
                state.currentItem && (
                  <div className='space-y-4'>
                    <div className='space-y-2 text-center'>
                      <Calculator className='text-primary mx-auto h-12 w-12' />
                      <h3 className='text-lg font-semibold'>
                        Confirm Quantity
                      </h3>
                      <p className='text-muted-foreground text-xs'>
                        {state.currentItem.material} @{' '}
                        {state.currentItem.source_storage_bin}
                      </p>
                    </div>

                    <QuantityKeypad
                      value={state.pickedQuantity}
                      onChange={(value) =>
                        setState((prev) => ({ ...prev, pickedQuantity: value }))
                      }
                      expectedQty={state.currentItem.source_target_qty}
                    />

                    <Button
                      onClick={handleQuantityConfirm}
                      disabled={state.isProcessing}
                      className='h-12 w-full'
                    >
                      {state.isProcessing ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          Recording...
                        </>
                      ) : (
                        <>
                          <Check className='mr-2 h-4 w-4' />
                          Confirm Pick
                        </>
                      )}
                    </Button>

                    <Button
                      variant='outline'
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          currentStep: 'scan_part',
                          pickedQuantity: 0,
                        }))
                      }
                      disabled={state.isProcessing}
                      className='w-full'
                    >
                      <ChevronLeft className='mr-2 h-4 w-4' />
                      Back
                    </Button>
                  </div>
                )}

              {/* Step 6a: Verify Adjacent Bins (Missing Part Workflow) */}
              {state.currentStep === 'verify_adjacent_bins' &&
                state.currentItem && (
                  <div className='space-y-4'>
                    <div className='space-y-2 text-center'>
                      <AlertTriangle className='mx-auto h-12 w-12 text-amber-500' />
                      <h3 className='text-lg font-semibold text-amber-600'>
                        Part Not Found
                      </h3>
                      <p className='text-muted-foreground text-sm'>
                        Please verify you checked adjacent bins
                      </p>
                    </div>

                    {/* Part Info Card */}
                    <Card className='border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20'>
                      <div className='space-y-2 text-center'>
                        <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                          Missing Part
                        </p>
                        <p className='font-mono text-2xl font-bold text-amber-700 dark:text-amber-400'>
                          {state.currentItem.material}
                        </p>
                        <p className='font-mono text-lg font-semibold text-amber-600 dark:text-amber-500'>
                          Bin: {state.currentItem.source_storage_bin}
                        </p>
                        {state.currentItem.material_description && (
                          <p className='text-muted-foreground text-sm'>
                            {state.currentItem.material_description}
                          </p>
                        )}
                      </div>
                    </Card>

                    {/* Adjacent Bins Verification */}
                    <div className='space-y-3'>
                      <p className='text-center text-sm font-medium'>
                        Verify you checked the following locations:
                      </p>

                      {/* Above Bin Checkbox */}
                      <div
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border-2 p-4 transition-all',
                          state.verifiedAboveBin
                            ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                            : 'border-muted-foreground/30 border-dashed hover:border-amber-400'
                        )}
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            verifiedAboveBin: !prev.verifiedAboveBin,
                          }))
                        }
                      >
                        <Checkbox
                          id='verify-above'
                          checked={state.verifiedAboveBin}
                          onCheckedChange={(checked) =>
                            setState((prev) => ({
                              ...prev,
                              verifiedAboveBin: checked === true,
                            }))
                          }
                          className='h-6 w-6'
                        />
                        <div className='flex-1'>
                          <Label
                            htmlFor='verify-above'
                            className='flex cursor-pointer items-center gap-2 text-base font-medium'
                          >
                            <ChevronUp className='h-5 w-5 text-amber-600' />
                            Checked Bin ABOVE
                          </Label>
                          <p className='text-muted-foreground mt-1 text-xs'>
                            I verified the bin directly above{' '}
                            {state.currentItem.source_storage_bin}
                          </p>
                        </div>
                        {state.verifiedAboveBin && (
                          <Check className='h-5 w-5 text-green-500' />
                        )}
                      </div>

                      {/* Below Bin Checkbox */}
                      <div
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border-2 p-4 transition-all',
                          state.verifiedBelowBin
                            ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                            : 'border-muted-foreground/30 border-dashed hover:border-amber-400'
                        )}
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            verifiedBelowBin: !prev.verifiedBelowBin,
                          }))
                        }
                      >
                        <Checkbox
                          id='verify-below'
                          checked={state.verifiedBelowBin}
                          onCheckedChange={(checked) =>
                            setState((prev) => ({
                              ...prev,
                              verifiedBelowBin: checked === true,
                            }))
                          }
                          className='h-6 w-6'
                        />
                        <div className='flex-1'>
                          <Label
                            htmlFor='verify-below'
                            className='flex cursor-pointer items-center gap-2 text-base font-medium'
                          >
                            <ChevronDown className='h-5 w-5 text-amber-600' />
                            Checked Bin BELOW
                          </Label>
                          <p className='text-muted-foreground mt-1 text-xs'>
                            I verified the bin directly below{' '}
                            {state.currentItem.source_storage_bin}
                          </p>
                        </div>
                        {state.verifiedBelowBin && (
                          <Check className='h-5 w-5 text-green-500' />
                        )}
                      </div>
                    </div>

                    <Button
                      onClick={handleAdjacentBinsVerified}
                      disabled={
                        !state.verifiedAboveBin || !state.verifiedBelowBin
                      }
                      className={cn(
                        'h-12 w-full',
                        state.verifiedAboveBin && state.verifiedBelowBin
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : ''
                      )}
                    >
                      <Search className='mr-2 h-4 w-4' />
                      Continue - Part Not Found
                    </Button>

                    <Button
                      variant='outline'
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          currentStep: 'confirm_quantity',
                          verifiedAboveBin: false,
                          verifiedBelowBin: false,
                        }))
                      }
                      className='w-full'
                    >
                      <ChevronLeft className='mr-2 h-4 w-4' />
                      Back - Enter Different Quantity
                    </Button>
                  </div>
                )}

              {/* Step 6b: Capture Missing Part Photo */}
              {state.currentStep === 'capture_missing_photo' &&
                state.currentItem && (
                  <div className='space-y-4'>
                    <div className='space-y-2 text-center'>
                      <Camera className='mx-auto h-12 w-12 text-amber-500' />
                      <h3 className='text-lg font-semibold text-amber-600'>
                        Photo Required
                      </h3>
                      <p className='text-muted-foreground text-sm'>
                        Take a photo of the empty bin location
                      </p>
                    </div>

                    {/* Part Info Card */}
                    <Card className='border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20'>
                      <div className='space-y-1 text-center'>
                        <p className='font-mono text-lg font-bold text-amber-700 dark:text-amber-400'>
                          {state.currentItem.material}
                        </p>
                        <p className='font-mono text-sm text-amber-600 dark:text-amber-500'>
                          Bin: {state.currentItem.source_storage_bin}
                        </p>
                      </div>
                    </Card>

                    {/* Photo Capture Area */}
                    <div className='space-y-3'>
                      {state.missingPartPhoto ? (
                        <div className='relative'>
                          <img
                            src={state.missingPartPhoto}
                            alt='Empty bin location'
                            className='h-48 w-full rounded-lg border-2 border-green-500 object-cover'
                          />
                          <Button
                            variant='destructive'
                            size='sm'
                            className='absolute top-2 right-2'
                            onClick={() =>
                              setState((prev) => ({
                                ...prev,
                                missingPartPhoto: null,
                              }))
                            }
                          >
                            <X className='h-4 w-4' />
                          </Button>
                          <div className='absolute bottom-2 left-2 rounded bg-green-500 px-2 py-1 text-xs font-medium text-white'>
                            Photo captured ✓
                          </div>
                        </div>
                      ) : (
                        <div
                          className='flex h-48 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50/50 transition-colors hover:bg-amber-100/50 dark:bg-amber-900/10 dark:hover:bg-amber-900/20'
                          onClick={() => photoInputRef.current?.click()}
                        >
                          <Camera className='h-12 w-12 text-amber-400' />
                          <p className='text-sm font-medium text-amber-600'>
                            Tap to take photo
                          </p>
                          <p className='text-muted-foreground text-xs'>
                            of empty bin location
                          </p>
                        </div>
                      )}

                      {/* Hidden file input */}
                      <input
                        ref={photoInputRef}
                        type='file'
                        accept='image/*'
                        capture='environment'
                        className='hidden'
                        onChange={handlePhotoCapture}
                      />

                      {!state.missingPartPhoto && (
                        <Button
                          variant='outline'
                          onClick={() => photoInputRef.current?.click()}
                          className='w-full'
                        >
                          <Camera className='mr-2 h-4 w-4' />
                          Open Camera
                        </Button>
                      )}
                    </div>

                    {/* Optional Notes */}
                    <div className='space-y-2'>
                      <Label htmlFor='missing-notes' className='text-sm'>
                        Notes (optional)
                      </Label>
                      <Textarea
                        id='missing-notes'
                        placeholder='Any additional details about the missing part...'
                        value={state.missingPartNotes}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            missingPartNotes: e.target.value,
                          }))
                        }
                        className='h-20 resize-none'
                      />
                    </div>

                    <Button
                      onClick={handleMissingPartSubmit}
                      disabled={!state.missingPartPhoto || state.isProcessing}
                      className='h-12 w-full bg-amber-600 hover:bg-amber-700'
                    >
                      {state.isProcessing ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          Reporting Missing Part...
                        </>
                      ) : (
                        <>
                          <AlertTriangle className='mr-2 h-4 w-4' />
                          Report Missing Part
                        </>
                      )}
                    </Button>

                    <Button
                      variant='outline'
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          currentStep: 'verify_adjacent_bins',
                          missingPartPhoto: null,
                        }))
                      }
                      disabled={state.isProcessing}
                      className='w-full'
                    >
                      <ChevronLeft className='mr-2 h-4 w-4' />
                      Back
                    </Button>
                  </div>
                )}

              {/* Step 7: Type Complete */}
              {state.currentStep === 'type_complete' && state.kitData && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <CheckCircle className='mx-auto h-16 w-16 text-green-500' />
                    <h3 className='text-lg font-semibold text-green-600'>
                      {state.pickType === 'floor' ? 'Floor' : 'Rack'} Picks
                      Complete!
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      All {state.totalItemsForType} items have been picked
                    </p>
                  </div>

                  {/* Check if other type still needs picking */}
                  {state.pickType === 'floor' &&
                    state.kitData.rack_pick_items.some((i) => !i.picked) && (
                      <Button
                        onClick={() => handlePickTypeSelect('rack')}
                        className='h-12 w-full'
                      >
                        <Truck className='mr-2 h-4 w-4' />
                        Continue to Rack Picks
                      </Button>
                    )}

                  {state.pickType === 'rack' &&
                    state.kitData.floor_pick_items.some((i) => !i.picked) && (
                      <Button
                        onClick={() => handlePickTypeSelect('floor')}
                        className='h-12 w-full'
                      >
                        <Box className='mr-2 h-4 w-4' />
                        Continue to Floor Picks
                      </Button>
                    )}

                  <Button
                    variant='outline'
                    onClick={handleBackToPickType}
                    className='w-full'
                  >
                    Back to Pick Type
                  </Button>

                  <Button
                    variant='secondary'
                    onClick={resetForm}
                    className='w-full'
                  >
                    <Package className='mr-2 h-4 w-4' />
                    Pick Another Kit
                  </Button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  )
}

export default RFKittingPickingForm

// Created and developed by Jai Singh
