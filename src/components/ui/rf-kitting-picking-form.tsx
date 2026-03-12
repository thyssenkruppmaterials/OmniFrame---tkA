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

// Step definitions
type PickingStep =
  | 'kit_scan' // Step 1: Scan Kit PO Number
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
  icon: React.ElementType
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
  initialKitPoNumber?: string // Optional: if passed from picking form detection
}

const RFKittingPickingForm: React.FC<RFKittingPickingFormProps> = ({
  onBack,
  initialKitPoNumber,
}) => {
  // State
  const [state, setState] = useState<PickingFormState>({
    currentStep: 'kit_scan',
    kitData: null,
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
  const handleKitPoValidation = useCallback(
    async (inputKitPo?: string) => {
      const kitPo = (inputKitPo || kitPoNumber).trim()

      const validation = validateKitPoNumber(kitPo)
      if (!validation.isValid) {
        toast.error(validation.message)
        return
      }

      setState((prev) => ({ ...prev, isProcessing: true }))

      try {
        const { data, error } =
          await rfKittingPickingService.verifyKitForPicking(kitPo)

        if (error || !data) {
          toast.error(error || 'Kit not found')
          setState((prev) => ({ ...prev, isProcessing: false }))
          return
        }

        setState((prev) => ({
          ...prev,
          kitData: data,
          currentStep: 'pick_type',
          isProcessing: false,
        }))

        toast.success(`Kit ${kitPo} loaded - ${data.total_lines} items`)
      } catch (error: unknown) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to load kit'
        )
        setState((prev) => ({ ...prev, isProcessing: false }))
      }
    },
    [kitPoNumber]
  )

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

      // Update kit status to in_progress if first pick
      await rfKittingPickingService.updateKitStatusToInProgress(
        kitData.kit_po_number
      )

      // Refresh kit data to get updated pick status
      const { data: refreshedData } =
        await rfKittingPickingService.verifyKitForPicking(kitData.kit_po_number)

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

      // Refresh kit data to get updated status
      const { data: refreshedData } =
        await rfKittingPickingService.verifyKitForPicking(kitData.kit_po_number)

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
      <div className='flex items-center'>
        {onBack && (
          <Button variant='ghost' size='sm' onClick={onBack}>
            <ChevronLeft className='mr-1 h-4 w-4' />
            Back
          </Button>
        )}
        <div className='flex-1 text-center'>
          <h2 className='text-lg font-bold'>Kit Picking</h2>
          {state.kitData && (
            <p className='text-muted-foreground text-xs'>
              {state.kitData.kit_po_number} • {state.kitData.kit_number}
            </p>
          )}
        </div>
        {onBack && <div className='w-14 shrink-0' />}
      </div>

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
              {/* Step 1: Scan Kit PO Number */}
              {state.currentStep === 'kit_scan' && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <Package className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Scan Kit PO Number
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Enter or scan the Kit PO number to begin picking
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='kit-po'>Kit PO Number</Label>
                    <ScannerInput
                      ref={kitPoRef}
                      id='kit-po'
                      type='text'
                      placeholder='Scan or enter Kit PO number'
                      value={kitPoNumber}
                      onChange={(e) => {
                        const value = e.target.value.toUpperCase()
                        setKitPoNumber(value)
                        // Trigger auto-advance timer
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
                      <div className='text-sm'>
                        <span className='text-muted-foreground'>Part:</span>
                        <span className='ml-1 font-medium'>
                          {state.currentItem.material}
                        </span>
                      </div>
                      <div className='text-sm'>
                        <span className='text-muted-foreground'>Qty:</span>
                        <span className='ml-1 font-medium'>
                          {state.currentItem.source_target_qty}
                        </span>
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

              {/* Step 4: Scan Location */}
              {state.currentStep === 'scan_location' && state.currentItem && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <MapPin className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>Confirm Location</h3>
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
                          // Trigger auto-advance timer when material matches expected
                          if (
                            value.length > 0 &&
                            value === state.currentItem?.material.toUpperCase()
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
