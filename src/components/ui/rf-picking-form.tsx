// Created and developed by Jai Singh
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  AlertTriangle,
  Calculator,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Package,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  isPotentialKitPoNumber,
  isPotentialKitSerialNumber,
  rfKittingPickingService,
} from '@/lib/supabase/rf-kitting-picking.service'
import type {
  RFPickingDelivery,
  RFPickingValidation,
} from '@/lib/supabase/rf-picking.service'
import {
  rfPickingService,
  validateDeliveryNumber,
  validateLocation,
} from '@/lib/supabase/rf-picking.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

// Types
interface PickingFormData {
  deliveryNumber: string
  scannedLocation: string
  pickedQuantity: number
  exceptionReason: string
}

interface PickingState {
  currentStep: number // 1=Delivery, 2=Location, 3=Quantity, 4=Exception, 5=Confirm
  formData: PickingFormData
  deliveryData: RFPickingDelivery | null
  pickValidation: RFPickingValidation | null
  isProcessing: boolean
  autoCompleteCountdown: number
  requiresException: boolean
  exceptionType: 'short_pick' | 'over_pick' | 'not_in_location' | null
  currentItemIndex: number // Track which item is currently being picked (0-based)
  pickedItemsCount: number // Count of successfully picked items
}

// Stepper Context (reusing from put-away pattern)
interface StepperContextValue {
  activeStep: number
  setActiveStep: (step: number) => void
  orientation: 'horizontal' | 'vertical'
}

const StepperContext = React.createContext<StepperContextValue | undefined>(
  undefined
)

const useStepper = () => {
  const context = React.useContext(StepperContext)
  if (!context) {
    throw new Error('useStepper must be used within a Stepper')
  }
  return context
}

// Stepper Components
interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: number
  value?: number
  onValueChange?: (value: number) => void
  orientation?: 'horizontal' | 'vertical'
}

const Stepper = React.forwardRef<HTMLDivElement, StepperProps>(
  (
    {
      defaultValue = 0,
      value,
      onValueChange,
      orientation = 'horizontal',
      className,
      ...props
    },
    ref
  ) => {
    const [activeStep, setInternalStep] = React.useState(defaultValue)

    const setActiveStep = React.useCallback(
      (step: number) => {
        if (value === undefined) {
          setInternalStep(step)
        }
        onValueChange?.(step)
      },
      [value, onValueChange]
    )

    const currentStep = value ?? activeStep

    return (
      <StepperContext.Provider
        value={{
          activeStep: currentStep,
          setActiveStep,
          orientation,
        }}
      >
        <div
          ref={ref}
          className={cn(
            'group/stepper inline-flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col',
            className
          )}
          data-orientation={orientation}
          {...props}
        />
      </StepperContext.Provider>
    )
  }
)
Stepper.displayName = 'Stepper'

interface StepperItemProps extends React.HTMLAttributes<HTMLDivElement> {
  step: number
  completed?: boolean
}

const StepperItem = React.forwardRef<HTMLDivElement, StepperItemProps>(
  ({ step, completed, className, children, ...props }, ref) => {
    const { activeStep, orientation } = useStepper()
    const isActive = step === activeStep
    const isCompleted = completed ?? step < activeStep

    return (
      <div
        ref={ref}
        className={cn(
          'group/step relative flex items-center',
          orientation === 'vertical' ? 'flex-col' : 'flex-row',
          className
        )}
        data-step={step}
        data-active={isActive}
        data-completed={isCompleted}
        {...props}
      >
        {children}
      </div>
    )
  }
)
StepperItem.displayName = 'StepperItem'

interface StepperIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {}

const StepperIndicator = React.forwardRef<
  HTMLDivElement,
  StepperIndicatorProps
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-background flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium transition-all',
        'data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground',
        'data-[state=completed]:border-primary data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground',
        'data-[state=inactive]:border-muted-foreground/30 data-[state=inactive]:text-muted-foreground',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})
StepperIndicator.displayName = 'StepperIndicator'

interface StepperSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {}

const StepperSeparator = React.forwardRef<
  HTMLDivElement,
  StepperSeparatorProps
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-muted h-0.5 flex-1 transition-all',
        'data-[state=completed]:bg-primary',
        'data-[state=active]:bg-muted',
        'data-[state=inactive]:bg-muted',
        className
      )}
      {...props}
    />
  )
})
StepperSeparator.displayName = 'StepperSeparator'

// Exception Option Card Component (similar to MCA cards in put-away)
const ExceptionOptionCard = ({
  title,
  description,
  icon: Icon,
  scanValue,
  isSelected,
  onClick,
}: {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  scanValue: string
  isSelected?: boolean
  onClick: () => void
}) => (
  <div
    onClick={onClick}
    className={cn(
      'cursor-pointer rounded-lg border-2 p-4 transition-all duration-200 hover:shadow-md',
      isSelected
        ? 'border-primary bg-primary/5'
        : 'border-muted hover:border-muted-foreground/30'
    )}
  >
    <div className='flex items-center space-x-3'>
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
          isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        <Icon className='h-5 w-5' />
      </div>
      <div className='flex-1'>
        <h4 className='text-sm font-medium'>{title}</h4>
        <p className='text-muted-foreground mt-1 text-xs'>{description}</p>
      </div>
    </div>
    <div className='mt-2 text-xs'>
      <span className='text-muted-foreground'>Scan: </span>
      <code className='bg-muted text-foreground rounded px-1 font-mono'>
        {scanValue}
      </code>
    </div>
  </div>
)

// Quantity Keypad Component
const QuantityKeypad = ({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) => {
  const handleKeypadClick = (key: string) => {
    if (key === 'clear') {
      onChange(0)
    } else if (key === 'backspace') {
      const newValue = Math.floor(value / 10)
      onChange(newValue)
    } else {
      const digit = parseInt(key)
      const newValue = value * 10 + digit
      // Limit to reasonable picking quantities (max 9999)
      if (newValue <= 9999) {
        onChange(newValue)
      }
    }
  }

  return (
    <div className='rf-quantity-keypad space-y-4'>
      <div className='rf-quantity-display'>
        <div className='bg-muted/30 border-muted-foreground/30 rounded-lg border-2 border-dashed p-6 text-center'>
          <div className='text-primary mb-2 text-4xl font-bold'>{value}</div>
          <div className='text-muted-foreground text-sm'>Picked Quantity</div>
        </div>
      </div>

      <div className='rf-keypad-grid grid grid-cols-3 gap-3'>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <Button
            key={num}
            type='button'
            variant='outline'
            size='lg'
            className='hover:bg-primary hover:text-primary-foreground h-16 text-xl font-semibold'
            onClick={() => handleKeypadClick(num.toString())}
          >
            {num}
          </Button>
        ))}
        <Button
          type='button'
          variant='outline'
          size='lg'
          className='hover:bg-destructive hover:text-destructive-foreground h-16 text-base font-medium'
          onClick={() => handleKeypadClick('clear')}
        >
          Clear
        </Button>
        <Button
          type='button'
          variant='outline'
          size='lg'
          className='hover:bg-primary hover:text-primary-foreground h-16 text-xl font-semibold'
          onClick={() => handleKeypadClick('0')}
        >
          0
        </Button>
        <Button
          type='button'
          variant='outline'
          size='lg'
          className='hover:bg-secondary hover:text-secondary-foreground h-16 text-base font-medium'
          onClick={() => handleKeypadClick('backspace')}
        >
          ←
        </Button>
      </div>
    </div>
  )
}

// Main RF Picking Form Component
interface RFPickingFormProps {
  onBack?: () => void
  onSwitchToKitting?: (kitPoNumber: string) => void // Callback to switch to kitting picking mode
}

const RFPickingForm: React.FC<RFPickingFormProps> = ({
  onBack,
  onSwitchToKitting,
}) => {
  // State management
  const [state, setState] = useState<PickingState>({
    currentStep: 1,
    formData: {
      deliveryNumber: '',
      scannedLocation: '',
      pickedQuantity: 0,
      exceptionReason: '',
    },
    deliveryData: null,
    pickValidation: null,
    isProcessing: false,
    autoCompleteCountdown: 0,
    requiresException: false,
    exceptionType: null,
    currentItemIndex: 0, // Start with first item
    pickedItemsCount: 0, // No items picked yet
  })

  // Auto-advance timers
  const [timers, setTimers] = useState(new Map<string, NodeJS.Timeout>())
  const [autoCompleteTimer, setAutoCompleteTimer] =
    useState<NodeJS.Timeout | null>(null)
  const [quantityInputTimer, setQuantityInputTimer] =
    useState<NodeJS.Timeout | null>(null)
  const autoAdvanceDelay = 800 // Match put-away pattern
  const autoCompleteDelay = 3000 // 3 seconds like Django

  // Field refs for focus management
  const deliveryRef = useRef<HTMLInputElement>(null)
  const locationRef = useRef<HTMLInputElement>(null)
  const exceptionRef = useRef<HTMLInputElement>(null)

  // Step configuration
  const baseSteps = [
    { id: 1, title: 'Scan', icon: Truck, description: '' },
    { id: 2, title: 'Confirm', icon: MapPin, description: '' },
    { id: 3, title: 'Quantity', icon: Calculator, description: '' },
    { id: 4, title: 'Complete', icon: CheckCircle, description: '' },
  ]

  const exceptionSteps = [
    { id: 1, title: 'Scan', icon: Truck, description: '' },
    { id: 2, title: 'Confirm', icon: MapPin, description: '' },
    { id: 3, title: 'Quantity', icon: Calculator, description: '' },
    { id: 4, title: 'Exception', icon: AlertTriangle, description: '' },
    { id: 5, title: 'Complete', icon: CheckCircle, description: '' },
  ]

  const steps = state.requiresException ? exceptionSteps : baseSteps

  // Comprehensive auto-focus management with robust retry mechanism
  useEffect(() => {
    const focusCurrentField = () => {
      logger.log(
        `🎯 RF Picking: Attempting auto-focus for step ${state.currentStep}, deliveryData: ${!!state.deliveryData}`
      )

      const attemptFocusWithRetry = (
        fieldRef: React.RefObject<HTMLInputElement | null>,
        fieldName: string,
        maxAttempts: number = 5
      ) => {
        let attempts = 0

        const tryFocus = () => {
          attempts++

          if (fieldRef.current) {
            fieldRef.current.focus()
            logger.log(
              `✅ RF Picking: ${fieldName} field focused (attempt ${attempts})`
            )
            return true
          } else if (attempts < maxAttempts) {
            logger.log(
              `⚠️ RF Picking: ${fieldName} field ref not ready, retrying... (attempt ${attempts}/${maxAttempts})`
            )
            setTimeout(tryFocus, 150 * attempts) // Increasing delay: 150ms, 300ms, 450ms, etc.
            return false
          } else {
            logger.error(
              `❌ RF Picking: Failed to focus ${fieldName} field after ${maxAttempts} attempts`
            )
            return false
          }
        }

        return tryFocus()
      }

      // Focus based on current step
      if (state.currentStep === 1) {
        attemptFocusWithRetry(deliveryRef, 'delivery')
      } else if (state.currentStep === 2 && state.deliveryData) {
        // For location field, try both ref and DOM query approaches
        if (!attemptFocusWithRetry(locationRef, 'location', 3)) {
          // Fallback to DOM query if ref approach fails
          setTimeout(() => {
            logger.log(
              '🔄 RF Picking: Trying location field focus via DOM query fallback'
            )
            const locationInput = document.querySelector(
              'input[placeholder="Scan the location barcode"]'
            ) as HTMLInputElement
            if (locationInput) {
              locationInput.focus()
              logger.log(
                '✅ RF Picking: Location field focused via DOM query fallback'
              )
            } else {
              logger.error(
                '❌ RF Picking: Location field not found even with DOM query'
              )
            }
          }, 500)
        }
      } else if (state.currentStep === 4 && state.requiresException) {
        attemptFocusWithRetry(exceptionRef, 'exception')
      } else {
        logger.log(
          `ℹ️ RF Picking: Auto-focus conditions not met - step: ${state.currentStep}, requiresException: ${state.requiresException}, deliveryData: ${!!state.deliveryData}`
        )
      }
    }

    // Initial delay to ensure DOM is ready, then start focus attempt
    setTimeout(focusCurrentField, 350)
  }, [state.currentStep, state.requiresException, state.deliveryData])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      if (autoCompleteTimer) clearTimeout(autoCompleteTimer)
    }
  }, [timers, autoCompleteTimer])

  // Validation functions
  const handleDeliveryValidation = useCallback(
    async (inputDeliveryNumber?: string) => {
      const rawDeliveryNumber =
        inputDeliveryNumber || state.formData.deliveryNumber
      const deliveryNumber = rawDeliveryNumber.trim()
      logger.log(
        `🔍 RF Picking: Starting delivery validation for: ${deliveryNumber}`
      )

      // Smart-detect: the operator may scan EITHER a kit serial
      // number (`KIT-YYYYMMDD-NNN`) OR a legacy kit PO number into the
      // delivery field. Both should hand off to the Kit Picking form.
      // We probe the serial path first (it's a direct PK lookup with
      // no disambiguation) and fall back to the PO path.
      if (
        isPotentialKitSerialNumber(deliveryNumber) ||
        isPotentialKitPoNumber(deliveryNumber)
      ) {
        logger.log(
          `🔍 RF Picking: Detected potential Kit identifier: ${deliveryNumber}`
        )
        setState((prev) => ({ ...prev, isProcessing: true }))

        try {
          let isKit = false

          if (isPotentialKitSerialNumber(deliveryNumber)) {
            const { data: kitData, error: kitError } =
              await rfKittingPickingService.verifyKitForPickingBySerialNumber(
                deliveryNumber
              )
            isKit = !!(kitData && !kitError)
          } else {
            // PO fallback: `verifyKitForPicking` returns either
            // resolved `data` (single kit) or a `kits[]` array
            // (multi-kit disambiguation). Either confirms this is a
            // Kit PO that should hand off — the Kit Picking form
            // will render the picker for the multi-kit case.
            const {
              data: kitData,
              error: kitError,
              kits: kitOptions,
            } = await rfKittingPickingService.verifyKitForPicking(
              deliveryNumber
            )
            isKit =
              (!!kitData && !kitError) ||
              (!!kitOptions && kitOptions.length > 0 && !kitError)
          }

          if (isKit) {
            logger.log(
              `✅ RF Picking: Valid Kit identifier detected, switching to kitting mode`
            )
            setState((prev) => ({ ...prev, isProcessing: false }))

            if (onSwitchToKitting) {
              toast.info(`Kit detected! Switching to Kit Picking mode...`)
              onSwitchToKitting(deliveryNumber)
              return
            } else {
              toast.info(
                `This is a Kit identifier. Please use Kit Picking tool for kitting operations.`
              )
              return
            }
          }

          // Not a valid Kit identifier, continue with delivery validation
          logger.log(
            `ℹ️ RF Picking: Not a valid Kit identifier, continuing with delivery validation`
          )
          setState((prev) => ({ ...prev, isProcessing: false }))
        } catch (_error) {
          logger.log(
            `ℹ️ RF Picking: Kit identifier check failed, continuing with delivery validation`
          )
          setState((prev) => ({ ...prev, isProcessing: false }))
        }
      }

      const validation = validateDeliveryNumber(deliveryNumber)
      if (!validation.isValid) {
        logger.log(
          `❌ RF Picking: Delivery number validation failed: ${validation.message}`
        )
        toast.error(validation.message)
        return
      }

      logger.log(
        `✅ RF Picking: Delivery number format valid, querying database...`
      )
      setState((prev) => ({ ...prev, isProcessing: true }))

      try {
        const { data: deliveryData, error } =
          await rfPickingService.getDeliveryItems(deliveryNumber)

        if (error) {
          logger.log(`❌ RF Picking: Database error: ${error}`)
          toast.error(error)
          setState((prev) => ({ ...prev, isProcessing: false }))
          return
        }

        if (!deliveryData) {
          logger.log(
            `❌ RF Picking: No delivery data found for: ${deliveryNumber}`
          )
          toast.error('No items found for this delivery')
          setState((prev) => ({ ...prev, isProcessing: false }))
          return
        }

        logger.log(
          `🎉 RF Picking: Delivery validation successful! Found ${deliveryData.items.length} items, advancing to step 2`
        )
        setState((prev) => ({
          ...prev,
          deliveryData,
          currentStep: 2,
          isProcessing: false,
        }))

        toast.success(
          `Found ${deliveryData.items.length} items for delivery ${deliveryNumber}`
        )
      } catch (error: unknown) {
        logger.error(
          '❌ RF Picking: Exception during delivery validation:',
          error
        )
        toast.error('Failed to validate delivery. Please try again.')
        setState((prev) => ({ ...prev, isProcessing: false }))
      }
    },
    [state.formData, state.deliveryData, state.isProcessing, onSwitchToKitting]
  )

  const handleLocationValidation = useCallback(
    (inputLocation?: string) => {
      const rawScannedLocation = inputLocation || state.formData.scannedLocation
      const scannedLocation = rawScannedLocation.trim()
      const { deliveryData, currentItemIndex } = state

      if (!deliveryData) {
        toast.error('No delivery data available')
        return
      }

      // ✅ FIX: Get the CURRENT item being picked, not the first item
      const currentItem = deliveryData.items[currentItemIndex]
      if (!currentItem) {
        toast.error('No item to pick')
        return
      }

      const expectedLocation = currentItem.source_storage_bin
      const validation = validateLocation(scannedLocation, expectedLocation)

      if (!validation.isValid) {
        toast.error(validation.message)
        return
      }

      setState((prev) => ({ ...prev, currentStep: 3 }))
      toast.success(`Location confirmed! Picking ${currentItem.material}`)
    },
    [state.formData, state.deliveryData, state.currentItemIndex]
  )

  const handleQuantityValidation = useCallback(
    (pickedQty: number) => {
      const { deliveryData, currentItemIndex } = state

      if (!deliveryData) {
        toast.error('No delivery data available')
        return
      }

      // ✅ FIX: Get the CURRENT item's expected quantity, not total for all items
      const currentItem = deliveryData.items[currentItemIndex]
      if (!currentItem) {
        toast.error('No item to pick')
        return
      }

      const expectedQty = currentItem.source_target_qty
      logger.log(
        `🔢 RF Picking: Quantity validation for item ${currentItemIndex + 1}/${deliveryData.items.length} - Material: ${currentItem.material}, Expected: ${expectedQty}, Picked: ${pickedQty}`
      )

      const validation = rfPickingService.validatePickedQuantity(
        expectedQty,
        pickedQty
      )
      logger.log(`🔍 RF Picking: Validation result:`, validation)

      // Determine workflow path and set all state updates atomically
      if (validation.isShortPick || validation.isOverPick || pickedQty === 0) {
        // Handle exception cases - determine exception type
        let exceptionType: 'short_pick' | 'over_pick' | 'not_in_location'
        if (pickedQty === 0) {
          exceptionType = 'not_in_location'
        } else if (validation.isShortPick) {
          exceptionType = 'short_pick'
        } else {
          exceptionType = 'over_pick'
        }

        // Set all exception state updates together
        setState((prev) => ({
          ...prev,
          pickValidation: validation,
          requiresException: true,
          exceptionType,
          currentStep: 4,
        }))

        toast.warning(validation.message)
      } else {
        // Perfect pick - proceed directly to completion
        logger.log(
          '\u2705 RF Picking: Perfect pick detected, proceeding to completion'
        )
        setState((prev) => ({
          ...prev,
          pickValidation: validation,
          currentStep: prev.requiresException ? 5 : 4,
        }))
        startAutoComplete()
      }
    },
    [state.deliveryData]
  )

  // Auto-advance handler with validation
  const handleAutoAdvance = useCallback(
    (fieldId: string, value: string) => {
      // Clear existing timer
      const existingTimer = timers.get(fieldId)
      if (existingTimer) {
        clearTimeout(existingTimer)
        setTimers((prev) => {
          const newTimers = new Map(prev)
          newTimers.delete(fieldId)
          return newTimers
        })
      }

      // Field completion validation
      let isComplete = false
      switch (fieldId) {
        case 'deliveryNumber':
          isComplete = validateDeliveryNumber(value).isValid
          break
        case 'scannedLocation':
          isComplete = value.trim().length > 0
          break
        default:
          isComplete = false
      }

      if (isComplete) {
        logger.log(
          `🔄 RF Picking: Setting auto-advance timer for ${fieldId} (${autoAdvanceDelay}ms)`
        )
        const timer = setTimeout(() => {
          logger.log(
            `⏰ RF Picking: Auto-advance timer fired for ${fieldId}, current step: ${state.currentStep}`
          )
          try {
            if (fieldId === 'deliveryNumber' && state.currentStep === 1) {
              logger.log(
                '🚀 RF Picking: Triggering delivery validation via auto-advance'
              )
              handleDeliveryValidation(value)
            } else if (
              fieldId === 'scannedLocation' &&
              state.currentStep === 2
            ) {
              logger.log(
                '🚀 RF Picking: Triggering location validation via auto-advance'
              )
              handleLocationValidation(value)
            } else {
              logger.log(
                `⚠️ RF Picking: Auto-advance timer fired but conditions not met - fieldId: ${fieldId}, currentStep: ${state.currentStep}`
              )
            }
          } catch (error) {
            logger.error(
              '❌ RF Picking: Error in auto-advance timer callback:',
              error
            )
          }
        }, autoAdvanceDelay)

        setTimers((prev) => new Map(prev).set(fieldId, timer))
      } else {
        logger.log(
          `⏸️ RF Picking: Auto-advance not set for ${fieldId} - validation incomplete`
        )
      }
    },
    [
      state.currentStep,
      timers,
      handleDeliveryValidation,
      handleLocationValidation,
      autoAdvanceDelay,
    ]
  )

  const startAutoComplete = useCallback(() => {
    logger.log('🚀 RF Picking: Starting auto-complete countdown for exact pick')

    // Clear any existing auto-complete timer first
    if (autoCompleteTimer) {
      clearInterval(autoCompleteTimer)
      setAutoCompleteTimer(null)
      logger.log('🔄 RF Picking: Cleared existing auto-complete timer')
    }

    // Capture current state values to avoid stale closure
    const currentDeliveryData = state.deliveryData
    const currentFormData = state.formData
    const currentExceptionType = state.exceptionType

    if (!currentDeliveryData) {
      logger.error(
        '❌ RF Picking: Cannot start auto-complete without delivery data'
      )
      return
    }

    let countdown = 3
    setState((prev) => ({ ...prev, autoCompleteCountdown: countdown }))

    const timer = setInterval(() => {
      countdown--
      logger.log(`⏰ RF Picking: Auto-complete countdown: ${countdown}`)
      setState((prev) => ({ ...prev, autoCompleteCountdown: countdown }))

      if (countdown <= 0) {
        logger.log(
          '✅ RF Picking: Auto-complete countdown finished, calling completePick() with captured data'
        )
        clearInterval(timer)
        setAutoCompleteTimer(null)

        // Call completePick with captured values to avoid stale closure
        const currentItemIdx = state.currentItemIndex
        const completionFunction = async () => {
          await completePickWithData(
            currentDeliveryData,
            currentFormData,
            currentExceptionType,
            currentItemIdx
          )
        }
        completionFunction()
      }
    }, 1000)

    setAutoCompleteTimer(timer)
  }, [
    state.deliveryData,
    state.formData,
    state.exceptionType,
    state.currentItemIndex,
    autoCompleteTimer,
  ])

  const cancelAutoComplete = useCallback(() => {
    if (autoCompleteTimer) {
      clearInterval(autoCompleteTimer)
      setAutoCompleteTimer(null)
    }
    setState((prev) => ({ ...prev, autoCompleteCountdown: 0 }))
  }, [autoCompleteTimer])

  // Helper function to complete pick with specific data (avoids stale closure)
  const completePickWithData = useCallback(
    async (
      deliveryData: RFPickingDelivery,
      formData: any,
      exceptionType: any,
      currentItemIndex: number
    ) => {
      logger.log('🚀 RF Picking: Starting completePick with provided data')

      if (!deliveryData) {
        logger.error('❌ RF Picking: No delivery data provided')
        toast.error('No delivery data available')
        return
      }

      // ✅ FIX: Get the CURRENT item being picked
      const currentItem = deliveryData.items[currentItemIndex]
      if (!currentItem) {
        logger.error(
          '❌ RF Picking: No current item found at index',
          currentItemIndex
        )
        toast.error('No item to pick')
        return
      }

      logger.log('📊 RF Picking: Completing pick for item:', {
        itemIndex: currentItemIndex + 1,
        totalItems: deliveryData.items.length,
        material: currentItem.material,
        itemId: currentItem.id,
        pickedQuantity: formData.pickedQuantity,
        exceptionType: exceptionType,
      })

      setState((prev) => ({ ...prev, isProcessing: true }))

      try {
        // Determine pick status
        let pickStatus:
          | 'picked'
          | 'picked_short'
          | 'picked_split'
          | 'not_in_location' = 'picked'

        if (exceptionType === 'not_in_location') {
          pickStatus = 'not_in_location'
        } else if (exceptionType === 'short_pick') {
          pickStatus = 'picked_short'
        } else if (exceptionType === 'over_pick') {
          pickStatus = 'picked_split'
        }

        // ✅ FIX: Pass the specific item ID, not the entire delivery
        const { error } = await rfPickingService.completePick(
          currentItem.id,
          formData.pickedQuantity,
          pickStatus,
          formData.exceptionReason
        )

        if (error) {
          toast.error(error)
          setState((prev) => ({ ...prev, isProcessing: false }))
          return
        }

        const statusMessages = {
          picked: 'Pick completed successfully!',
          picked_short: 'Short pick completed',
          picked_split: 'Over pick completed - sent for bulk split',
          not_in_location: 'Item marked as not in location',
        }

        const nextItemIndex = currentItemIndex + 1
        const remainingItems = deliveryData.items.length - nextItemIndex

        // ✅ FIX: Check if there are more items to pick
        if (nextItemIndex < deliveryData.items.length) {
          // More items to pick - move to next item
          const nextItem = deliveryData.items[nextItemIndex]
          toast.success(
            `${statusMessages[pickStatus]} | ${remainingItems} item${remainingItems > 1 ? 's' : ''} remaining`
          )
          logger.log(
            `📦 RF Picking: Moving to next item (${nextItemIndex + 1}/${deliveryData.items.length}): ${nextItem.material}`
          )

          // Reset to step 2 (location scan) for the next item
          setState((prev) => ({
            ...prev,
            currentStep: 2,
            currentItemIndex: nextItemIndex,
            pickedItemsCount: prev.pickedItemsCount + 1,
            formData: {
              ...prev.formData,
              scannedLocation: '',
              pickedQuantity: 0,
              exceptionReason: '',
            },
            isProcessing: false,
            requiresException: false,
            exceptionType: null,
            pickValidation: null,
            autoCompleteCountdown: 0,
          }))
        } else {
          // All items picked - complete the entire delivery
          toast.success(
            `${statusMessages[pickStatus]} | All ${deliveryData.items.length} items picked!`
          )
          logger.log(
            `✅ RF Picking: All items picked for delivery ${deliveryData.delivery}`
          )

          // Reset form after shorter delay for better UX
          setTimeout(() => {
            logger.log(
              '🔄 RF Picking: Resetting form after successful completion'
            )
            resetForm()
          }, 1000)
        }
      } catch (error: unknown) {
        logger.error('Error completing pick:', error)
        toast.error('Failed to complete pick. Please try again.')
        setState((prev) => ({ ...prev, isProcessing: false }))
      }
    },
    []
  )

  // Legacy completePick function for regular workflow
  const completePick = useCallback(async () => {
    const { deliveryData, formData, exceptionType, currentItemIndex } = state
    if (!deliveryData) {
      logger.error('❌ RF Picking: No delivery data available for completion')
      return
    }
    return completePickWithData(
      deliveryData,
      formData,
      exceptionType,
      currentItemIndex
    )
  }, [
    state.deliveryData,
    state.formData,
    state.exceptionType,
    state.currentItemIndex,
    completePickWithData,
  ])

  const resetForm = useCallback(() => {
    logger.log('🔄 RF Picking: Resetting form to initial state')

    setState({
      currentStep: 1,
      formData: {
        deliveryNumber: '',
        scannedLocation: '',
        pickedQuantity: 0,
        exceptionReason: '',
      },
      deliveryData: null,
      pickValidation: null,
      isProcessing: false,
      autoCompleteCountdown: 0,
      requiresException: false,
      exceptionType: null,
      currentItemIndex: 0,
      pickedItemsCount: 0,
    })

    // Clear all timers
    timers.forEach((timer) => clearTimeout(timer))
    setTimers(new Map())
    if (autoCompleteTimer) {
      clearTimeout(autoCompleteTimer)
      setAutoCompleteTimer(null)
    }
    if (quantityInputTimer) {
      clearTimeout(quantityInputTimer)
      setQuantityInputTimer(null)
    }

    // Focus first field with robust retry mechanism after reset
    const focusAfterReset = () => {
      let attempts = 0
      const maxAttempts = 10

      const tryFocus = () => {
        attempts++

        if (deliveryRef.current) {
          deliveryRef.current.focus()
          logger.log(
            `✅ RF Picking: Form reset complete, delivery field focused (attempt ${attempts})`
          )
          return true
        } else if (attempts < maxAttempts) {
          logger.log(
            `⚠️ RF Picking: Delivery field ref not ready after reset, retrying... (attempt ${attempts}/${maxAttempts})`
          )
          setTimeout(tryFocus, 200 * attempts) // Increasing delay: 200ms, 400ms, 600ms, etc.
          return false
        } else {
          logger.error(
            `❌ RF Picking: Failed to focus delivery field after reset after ${maxAttempts} attempts`
          )
          return false
        }
      }

      tryFocus()
    }

    setTimeout(focusAfterReset, 500) // Longer initial delay for form reset
  }, [timers, autoCompleteTimer, quantityInputTimer])

  // Navigation functions
  const goToPreviousStep = useCallback(() => {
    if (state.currentStep > 1) {
      setState((prev) => ({ ...prev, currentStep: prev.currentStep - 1 }))
    }
  }, [state.currentStep])

  const goToNextStep = useCallback(() => {
    if (state.currentStep === 1) {
      // Step 1: Delivery Scan validation
      const { deliveryNumber } = state.formData

      if (!deliveryNumber.trim()) {
        toast.error('Delivery number is required')
        return
      }

      // Validate delivery number format
      const validation = validateDeliveryNumber(deliveryNumber)
      if (!validation.isValid) {
        toast.error(validation.message)
        return
      }

      // If delivery data already loaded, advance to step 2
      if (state.deliveryData) {
        setState((prev) => ({ ...prev, currentStep: 2 }))
      } else {
        // If delivery data not loaded yet, trigger delivery validation
        // This handles cases where user clicks "Next" before auto-advance completes
        handleDeliveryValidation()
      }
    } else if (state.currentStep === 2) {
      // Step 2: Location Confirm validation
      const { scannedLocation } = state.formData
      const { deliveryData } = state

      if (!scannedLocation.trim()) {
        toast.error('Location scan is required')
        return
      }

      if (!deliveryData) {
        toast.error('No delivery data available')
        return
      }

      // Validate location against expected location
      const expectedLocation = deliveryData.unique_locations[0]
      const locationValidation = validateLocation(
        scannedLocation,
        expectedLocation
      )
      if (!locationValidation.isValid) {
        toast.error(locationValidation.message)
        return
      }

      setState((prev) => ({ ...prev, currentStep: 3 }))
    } else if (state.currentStep === 3) {
      // Step 3: Quantity Pick validation
      const { pickedQuantity } = state.formData
      const { deliveryData } = state

      if (!deliveryData) {
        toast.error('No delivery data available')
        return
      }

      // Validate that quantity has been entered/confirmed
      if (pickedQuantity === undefined || pickedQuantity === null) {
        toast.error('Please enter picked quantity')
        return
      }

      // Run quantity validation to determine next step
      handleQuantityValidation(pickedQuantity)
    }
  }, [
    state.currentStep,
    state.formData,
    state.deliveryData,
    handleQuantityValidation,
    handleDeliveryValidation,
  ])

  // Get current step index for stepper display
  const getCurrentStepIndex = useCallback(() => {
    return state.currentStep - 1
  }, [state.currentStep])

  // Animation variants
  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.3 } },
  }

  return (
    <div className='mx-auto w-full max-w-md space-y-6 p-4'>
      {/* Progress Stepper */}
      <Stepper value={getCurrentStepIndex()} className='w-full'>
        {steps.map((step, index) => (
          <StepperItem
            key={step.id}
            step={index}
            completed={index < getCurrentStepIndex()}
            className='[&:not(:last-child)]:flex-1'
          >
            <div className='flex flex-col items-center space-y-2'>
              <StepperIndicator
                data-state={
                  index < getCurrentStepIndex()
                    ? 'completed'
                    : index === getCurrentStepIndex()
                      ? 'active'
                      : 'inactive'
                }
              >
                {index < getCurrentStepIndex() ? (
                  <CheckCircle className='h-4 w-4' />
                ) : (
                  React.createElement(step.icon, { className: 'h-4 w-4' })
                )}
              </StepperIndicator>
              <div className='text-center'>
                <div className='text-xs font-medium'>{step.title}</div>
                <div className='text-muted-foreground hidden text-xs sm:block'>
                  {step.description}
                </div>
              </div>
            </div>
            {index < steps.length - 1 && (
              <StepperSeparator
                data-state={
                  index < getCurrentStepIndex() ? 'completed' : 'inactive'
                }
                className='mx-2'
              />
            )}
          </StepperItem>
        ))}
      </Stepper>

      {/* Step Content */}
      <Card className='min-h-[400px]'>
        <CardHeader>
          <RFScreenHeader
            title='Picking'
            subtitle='Outbound orders'
            onBack={onBack}
          />
        </CardHeader>
        <CardContent>
          <AnimatePresence mode='wait'>
            <motion.div
              key={state.currentStep}
              initial='hidden'
              animate='visible'
              exit='exit'
              variants={contentVariants}
              className='space-y-4'
            >
              {/* Step 1: Delivery Scan */}
              {state.currentStep === 1 && (
                <div className='space-y-4'>
                  <div className='mb-4 space-y-2 text-center'>
                    <Truck className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Scan Delivery Number
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Enter or scan the delivery number to load picking
                      information
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='delivery-number'>Delivery Number</Label>
                    <ScannerInput
                      ref={deliveryRef}
                      id='delivery-number'
                      type='text'
                      placeholder='Scan or enter delivery number'
                      value={state.formData.deliveryNumber}
                      onChange={(e) => {
                        const value = e.target.value.toUpperCase()
                        setState((prev) => ({
                          ...prev,
                          formData: { ...prev.formData, deliveryNumber: value },
                        }))
                        handleAutoAdvance('deliveryNumber', value)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleDeliveryValidation()
                        }
                      }}
                      className='h-12 text-center font-mono text-lg'
                      disabled={state.isProcessing}
                    />
                  </div>

                  {state.isProcessing && (
                    <div className='flex items-center justify-center py-4'>
                      <Loader2 className='mr-2 h-6 w-6 animate-spin' />
                      <span>Loading delivery...</span>
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Location Confirmation */}
              {state.currentStep === 2 &&
                state.deliveryData &&
                (() => {
                  const currentItem =
                    state.deliveryData.items[state.currentItemIndex]
                  const progress = `${state.currentItemIndex + 1} of ${state.deliveryData.items.length}`
                  return (
                    <div className='space-y-4'>
                      {/* Delivery Info */}
                      <Card className='bg-muted/30'>
                        <CardContent className='p-4'>
                          <h4 className='mb-3 flex items-center justify-between font-semibold'>
                            <span className='flex items-center'>
                              <Package className='mr-2 h-4 w-4' />
                              Delivery Information
                            </span>
                            <span className='bg-primary/10 text-primary rounded px-2 py-1 text-sm'>
                              Item {progress}
                            </span>
                          </h4>
                          <div className='grid grid-cols-2 gap-3 text-sm'>
                            <div>
                              <span className='text-muted-foreground'>
                                Delivery:
                              </span>
                              <div className='font-mono font-medium'>
                                {state.deliveryData.delivery}
                              </div>
                            </div>
                            <div>
                              <span className='text-muted-foreground'>
                                Material:
                              </span>
                              <div className='font-mono font-medium'>
                                {currentItem?.material || 'N/A'}
                              </div>
                            </div>
                            <div>
                              <span className='text-muted-foreground'>
                                Item Qty:
                              </span>
                              <div className='font-medium'>
                                {currentItem?.source_target_qty || 0}
                              </div>
                            </div>
                            <div>
                              <span className='text-muted-foreground'>
                                Location:
                              </span>
                              <div className='font-mono font-medium'>
                                {currentItem?.source_storage_bin || 'N/A'}
                              </div>
                            </div>
                          </div>
                          {currentItem?.material_description && (
                            <div className='mt-3 border-t pt-3'>
                              <span className='text-muted-foreground text-xs'>
                                Description:
                              </span>
                              <div className='text-sm font-medium'>
                                {currentItem.material_description}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      <div className='mb-4 space-y-2 text-center'>
                        <MapPin className='text-primary mx-auto h-12 w-12' />
                        <h3 className='text-lg font-semibold'>
                          Confirm Location
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Expected location:{' '}
                          <span className='font-mono font-medium'>
                            {currentItem?.source_storage_bin || 'N/A'}
                          </span>
                        </p>
                      </div>

                      <div className='space-y-2'>
                        <Label htmlFor='scanned-location'>Scan Location</Label>
                        <ScannerInput
                          ref={locationRef}
                          id='scanned-location'
                          type='text'
                          placeholder='Scan the location barcode'
                          value={state.formData.scannedLocation}
                          onChange={(e) => {
                            const value = e.target.value.toUpperCase()
                            setState((prev) => ({
                              ...prev,
                              formData: {
                                ...prev.formData,
                                scannedLocation: value,
                              },
                            }))
                            handleAutoAdvance('scannedLocation', value)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleLocationValidation()
                            }
                          }}
                          className='h-12 text-center font-mono text-lg'
                        />
                      </div>
                    </div>
                  )
                })()}

              {/* Step 3: Quantity Pick */}
              {state.currentStep === 3 &&
                state.deliveryData &&
                (() => {
                  const currentItem =
                    state.deliveryData.items[state.currentItemIndex]
                  const progress = `${state.currentItemIndex + 1} of ${state.deliveryData.items.length}`
                  return (
                    <div className='space-y-4'>
                      <div className='mb-4 space-y-2 text-center'>
                        <Calculator className='text-primary mx-auto h-12 w-12' />
                        <h3 className='text-lg font-semibold'>
                          Enter Picked Quantity
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Item {progress} - Expected:{' '}
                          <span className='font-semibold'>
                            {currentItem?.source_target_qty || 0}
                          </span>
                        </p>
                        {currentItem && (
                          <p className='text-muted-foreground text-xs'>
                            {currentItem.material} @{' '}
                            {currentItem.source_storage_bin}
                          </p>
                        )}
                      </div>

                      <QuantityKeypad
                        value={state.formData.pickedQuantity}
                        onChange={(value) => {
                          setState((prev) => ({
                            ...prev,
                            formData: {
                              ...prev.formData,
                              pickedQuantity: value,
                            },
                          }))

                          // Clear existing quantity input timer to prevent multiple timers
                          if (quantityInputTimer) {
                            clearTimeout(quantityInputTimer)
                            setQuantityInputTimer(null)
                            logger.log(
                              `🔄 RF Picking: Cleared previous quantity timer`
                            )
                          }

                          // Auto-complete after quantity entry (like Django)
                          if (value > 0) {
                            logger.log(
                              `🔢 RF Picking: Setting auto-complete timer for quantity ${value}`
                            )
                            const timer = setTimeout(() => {
                              logger.log(
                                `⏰ RF Picking: Auto-complete timer fired for quantity ${value}`
                              )
                              handleQuantityValidation(value)
                              setQuantityInputTimer(null)
                            }, autoCompleteDelay)
                            setQuantityInputTimer(timer)
                          } else if (value === 0) {
                            logger.log(
                              '🔢 RF Picking: Setting auto-complete timer for not-in-location (quantity 0)'
                            )
                            const timer = setTimeout(() => {
                              logger.log(
                                '⏰ RF Picking: Auto-complete timer fired for not-in-location'
                              )
                              handleQuantityValidation(0) // Not in location
                              setQuantityInputTimer(null)
                            }, autoCompleteDelay)
                            setQuantityInputTimer(timer)
                          }
                        }}
                      />
                    </div>
                  )
                })()}

              {/* Step 4: Exception Handling */}
              {state.currentStep === 4 &&
                state.requiresException &&
                state.exceptionType && (
                  <div className='space-y-4'>
                    <div className='mb-4 space-y-2 text-center'>
                      <AlertTriangle className='text-warning mx-auto h-12 w-12' />
                      <h3 className='text-warning text-lg font-semibold'>
                        {state.exceptionType === 'short_pick' &&
                          'Short Pick Exception'}
                        {state.exceptionType === 'over_pick' &&
                          'Over Pick Exception'}
                        {state.exceptionType === 'not_in_location' &&
                          'Not In Location'}
                      </h3>
                      <p className='text-muted-foreground text-sm'>
                        {state.pickValidation?.message}
                      </p>
                    </div>

                    <div className='space-y-3'>
                      {state.exceptionType === 'short_pick' && (
                        <>
                          <ExceptionOptionCard
                            title='Confirm Short Pick'
                            description='Proceed with quantity picked'
                            icon={CheckCircle}
                            scanValue='CONFIRM'
                            isSelected={
                              state.formData.exceptionReason === 'confirm_short'
                            }
                            onClick={() => {
                              setState((prev) => ({
                                ...prev,
                                formData: {
                                  ...prev.formData,
                                  exceptionReason: 'confirm_short',
                                },
                              }))
                              setTimeout(() => completePick(), 1000)
                            }}
                          />
                          <ExceptionOptionCard
                            title='Update Quantity'
                            description='Return to quantity step'
                            icon={Calculator}
                            scanValue='UPDATE'
                            isSelected={
                              state.formData.exceptionReason ===
                              'update_quantity'
                            }
                            onClick={() => {
                              setState((prev) => ({
                                ...prev,
                                currentStep: 3,
                                requiresException: false,
                                exceptionType: null,
                                formData: {
                                  ...prev.formData,
                                  exceptionReason: '',
                                  pickedQuantity: 0,
                                },
                              }))
                            }}
                          />
                        </>
                      )}

                      {state.exceptionType === 'over_pick' && (
                        <>
                          <ExceptionOptionCard
                            title='Send to Bulk Split'
                            description='Route excess quantity to bulk split station'
                            icon={Package}
                            scanValue='BULK'
                            isSelected={
                              state.formData.exceptionReason === 'bulk_split'
                            }
                            onClick={() => {
                              setState((prev) => ({
                                ...prev,
                                formData: {
                                  ...prev.formData,
                                  exceptionReason: 'bulk_split',
                                },
                              }))
                              setTimeout(() => completePick(), 1000)
                            }}
                          />
                          <ExceptionOptionCard
                            title='Update Quantity'
                            description='Return to quantity step'
                            icon={Calculator}
                            scanValue='UPDATE'
                            isSelected={
                              state.formData.exceptionReason ===
                              'update_quantity'
                            }
                            onClick={() => {
                              setState((prev) => ({
                                ...prev,
                                currentStep: 3,
                                requiresException: false,
                                exceptionType: null,
                                formData: {
                                  ...prev.formData,
                                  exceptionReason: '',
                                  pickedQuantity: 0,
                                },
                              }))
                            }}
                          />
                        </>
                      )}

                      {state.exceptionType === 'not_in_location' && (
                        <ExceptionOptionCard
                          title='Confirm Not In Location'
                          description='Mark item as not found in expected location'
                          icon={AlertCircle}
                          scanValue='NOTFOUND'
                          isSelected={
                            state.formData.exceptionReason === 'not_in_location'
                          }
                          onClick={() => {
                            setState((prev) => ({
                              ...prev,
                              formData: {
                                ...prev.formData,
                                exceptionReason: 'not_in_location',
                              },
                            }))
                            setTimeout(() => completePick(), 1000)
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}

              {/* Step 4/5: Complete */}
              {((state.currentStep === 4 && !state.requiresException) ||
                state.currentStep === 5) && (
                <div className='space-y-4'>
                  <div className='mb-4 space-y-2 text-center'>
                    <CheckCircle className='mx-auto h-12 w-12 text-green-500' />
                    <h3 className='text-lg font-semibold text-green-600'>
                      Pick Complete!
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Processing pick operation...
                    </p>
                  </div>

                  {state.autoCompleteCountdown > 0 && (
                    <div className='bg-primary/10 rounded-lg p-4 text-center'>
                      <div className='text-primary mb-2 text-2xl font-bold'>
                        {state.autoCompleteCountdown}
                      </div>
                      <p className='text-muted-foreground mb-3 text-sm'>
                        Auto-completing in {state.autoCompleteCountdown} seconds
                      </p>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={cancelAutoComplete}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}

                  {state.isProcessing && (
                    <div className='flex items-center justify-center py-4'>
                      <Loader2 className='mr-2 h-6 w-6 animate-spin' />
                      <span>Updating pick status...</span>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation Buttons */}
          <div className='flex justify-between pt-4'>
            <Button
              variant='outline'
              onClick={goToPreviousStep}
              disabled={state.currentStep === 1 || state.isProcessing}
              className='flex items-center'
            >
              <ChevronLeft className='mr-1 h-4 w-4' />
              Back
            </Button>

            {state.currentStep < (state.requiresException ? 5 : 4) && (
              <Button
                onClick={goToNextStep}
                disabled={state.isProcessing}
                className='flex items-center'
              >
                Next
                <ChevronRight className='ml-1 h-4 w-4' />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default RFPickingForm

// Created and developed by Jai Singh
