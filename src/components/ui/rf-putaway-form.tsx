// Created and developed by Jai Singh
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Scan,
  Target,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { PutbackTicket } from '@/lib/supabase/database.types'
import type { RFPutawayCreateData } from '@/lib/supabase/rf-putaway.service'
import {
  completePutbackTicket,
  fetchPutbackTicket,
  isPutbackNumber,
  parseTONumber,
  rfPutawayService,
  validateTOLocation,
  validateTOLocationMatching,
  validateTONumber,
} from '@/lib/supabase/rf-putaway.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useWarehouseCodes } from '@/hooks/use-warehouses'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

// Types
interface PutawayFormData {
  materialNumber: string
  toLocation: string
  toNumber: string
  shelfLocation: string
  mcaReason: string
  mcaDropLocation: string
}

interface PutawayState {
  currentStep: number // 1=Material, 2=Location, 3=MCA-Reason, 4=MCA-Location, 5=Confirm
  formData: PutawayFormData
  requiresMCA: boolean
  selectedMcaReason: string | null
  isProcessing: boolean
  autoCompleteCountdown: number
  shouldSubmit: boolean
  // Parsed T.O. data
  parsedTONumber: string
  parsedWarehouse: string
  // Putback ticket integration
  isPutbackWorkflow: boolean
  putbackTicketData: PutbackTicket | null
  putbackTicketId: string | null
  isLoadingPutback: boolean
}

// Stepper Context (reusing from pack-tool pattern)
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
  disabled?: boolean
  loading?: boolean
}

const StepperItem = React.forwardRef<HTMLDivElement, StepperItemProps>(
  (
    {
      step,
      completed = false,
      disabled = false,
      loading = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const { activeStep } = useStepper()
    const state =
      completed || step < activeStep
        ? 'completed'
        : activeStep === step
          ? 'active'
          : 'inactive'
    const isLoading = loading && step === activeStep

    return (
      <div
        ref={ref}
        className={cn(
          'group/step flex items-center group-data-[orientation=horizontal]/stepper:flex-row group-data-[orientation=vertical]/stepper:flex-col',
          className
        )}
        data-state={state}
        {...(isLoading ? { 'data-loading': true } : {})}
        {...props}
      >
        {children}
      </div>
    )
  }
)
StepperItem.displayName = 'StepperItem'

const StepperIndicator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-muted text-muted-foreground data-[state=active]:bg-primary data-[state=completed]:bg-primary data-[state=active]:text-primary-foreground data-[state=completed]:text-primary-foreground relative flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-medium',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})
StepperIndicator.displayName = 'StepperIndicator'

const StepperSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-muted group-data-[state=completed]/step:bg-primary m-0.5 group-data-[orientation=horizontal]/stepper:h-0.5 group-data-[orientation=horizontal]/stepper:w-full group-data-[orientation=horizontal]/stepper:flex-1 group-data-[orientation=vertical]/stepper:h-12 group-data-[orientation=vertical]/stepper:w-0.5',
        className
      )}
      {...props}
    />
  )
})
StepperSeparator.displayName = 'StepperSeparator'

// MCA Reason Card Component
const MCAReasonCard = ({
  reason,
  title,
  description,
  selected,
  onClick,
}: {
  reason: string
  title: string
  description: string
  selected: boolean
  onClick: () => void
}) => (
  <div
    className={cn(
      'hover:border-primary hover:bg-primary/5 cursor-pointer rounded-lg border p-4 transition-all duration-200',
      selected ? 'border-primary bg-primary/10' : 'border-border'
    )}
    onClick={onClick}
  >
    <div className='mb-2 flex items-center justify-between'>
      <h4 className='text-sm font-medium'>{title}</h4>
      <AlertTriangle
        className={cn(
          'h-4 w-4',
          selected ? 'text-primary' : 'text-muted-foreground'
        )}
      />
    </div>
    <p className='text-muted-foreground mb-2 text-xs'>{description}</p>
    <div className='text-xs'>
      <span className='text-muted-foreground'>Scan: </span>
      <code className='bg-muted text-foreground rounded px-1 font-mono'>
        {reason}
      </code>
    </div>
  </div>
)

// Main RF Put-Away Form Component
interface RFPutawayFormProps {
  onBack?: () => void
}

const RFPutawayForm: React.FC<RFPutawayFormProps> = ({ onBack }) => {
  const [state, setState] = useState<PutawayState>({
    currentStep: 1,
    formData: {
      materialNumber: '',
      toLocation: '',
      toNumber: '',
      shelfLocation: '',
      mcaReason: '',
      mcaDropLocation: '',
    },
    requiresMCA: false,
    selectedMcaReason: null,
    isProcessing: false,
    autoCompleteCountdown: 0,
    shouldSubmit: false,
    // Parsed T.O. data
    parsedTONumber: '',
    parsedWarehouse: '',
    // Putback ticket integration
    isPutbackWorkflow: false,
    putbackTicketData: null,
    putbackTicketId: null,
    isLoadingPutback: false,
  })

  // Auto-advance timers
  const [timers, setTimers] = useState(new Map<string, NodeJS.Timeout>())

  const [autoCompleteTimer, setAutoCompleteTimer] =
    useState<NodeJS.Timeout | null>(null)
  const autoAdvanceDelay = 800 // Match Django pattern

  // Field refs for focus management
  const materialRef = useRef<HTMLInputElement>(null)
  const toLocationRef = useRef<HTMLInputElement>(null)
  const toNumberRef = useRef<HTMLInputElement>(null)
  const shelfLocationRef = useRef<HTMLInputElement>(null)
  const mcaReasonRef = useRef<HTMLInputElement>(null)
  const mcaDropLocationRef = useRef<HTMLInputElement>(null)

  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  // Warehouse allowlist for the scan path (fix #1). Held in a ref so the
  // memoized field/submit handlers read the latest set without re-binding.
  // Enforcement is gated on `isLoaded` — while the list is loading or after a
  // fetch error the ref stays `undefined`, so the scan fails open and never
  // hard-blocks the floor on a transient outage.
  const { codes: warehouseCodes, isLoaded: warehouseCodesLoaded } =
    useWarehouseCodes()
  const warehouseAllowlistRef = useRef<ReadonlySet<string> | undefined>(
    undefined
  )
  useEffect(() => {
    warehouseAllowlistRef.current =
      warehouseCodesLoaded && warehouseCodes.size > 0
        ? warehouseCodes
        : undefined
  }, [warehouseCodes, warehouseCodesLoaded])

  // Define steps (including conditional MCA steps)
  const baseSteps = [
    { id: 1, title: 'Material Scan', icon: Scan, description: '' },
    { id: 2, title: 'Location Scan', icon: MapPin, description: '' },
    { id: 3, title: 'Confirm', icon: CheckCircle, description: '' },
  ]

  const mcaSteps = [
    { id: 1, title: 'Material Scan', icon: Scan, description: '' },
    { id: 2, title: 'Location Scan', icon: MapPin, description: '' },
    { id: 3, title: 'MCA Reason', icon: AlertTriangle, description: '' },
    { id: 4, title: 'MCA Drop', icon: Target, description: '' },
    { id: 5, title: 'Confirm', icon: CheckCircle, description: '' },
  ]

  const steps = state.requiresMCA ? mcaSteps : baseSteps

  // Enhanced auto-focus management with robust retry mechanism
  useEffect(() => {
    const focusCurrentField = () => {
      logger.log(
        `🎯 RF Put-Away: Attempting auto-focus for step ${state.currentStep}`
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
              `✅ RF Put-Away: ${fieldName} field focused (attempt ${attempts})`
            )
            return true
          } else if (attempts < maxAttempts) {
            logger.log(
              `⚠️ RF Put-Away: ${fieldName} field ref not ready, retrying... (attempt ${attempts}/${maxAttempts})`
            )
            setTimeout(tryFocus, 150 * attempts) // Increasing delay: 150ms, 300ms, 450ms, etc.
            return false
          } else {
            logger.error(
              `❌ RF Put-Away: Failed to focus ${fieldName} field after ${maxAttempts} attempts`
            )
            return false
          }
        }

        return tryFocus()
      }

      // Focus based on current step with enhanced retry logic
      if (state.currentStep === 1) {
        attemptFocusWithRetry(materialRef, 'material')
      } else if (state.currentStep === 2) {
        // For Step 2 shelf location field, try both ref and DOM query approaches
        if (!attemptFocusWithRetry(shelfLocationRef, 'shelfLocation', 3)) {
          // Fallback to DOM query if ref approach fails
          setTimeout(() => {
            logger.log(
              '🔄 RF Put-Away: Trying shelf location field focus via DOM query fallback'
            )
            const shelfLocationInput = document.querySelector(
              'input[placeholder="Scan shelf location to verify"]'
            ) as HTMLInputElement
            if (shelfLocationInput) {
              shelfLocationInput.focus()
              logger.log(
                '✅ RF Put-Away: Shelf location field focused via DOM query fallback'
              )
            } else {
              logger.error(
                '❌ RF Put-Away: Shelf location field not found even with DOM query'
              )
            }
          }, 500)
        }
      } else if (state.currentStep === 3) {
        attemptFocusWithRetry(mcaReasonRef, 'mcaReason')
      } else if (state.currentStep === 4) {
        attemptFocusWithRetry(mcaDropLocationRef, 'mcaDropLocation')
      } else {
        logger.log(
          `ℹ️ RF Put-Away: Auto-focus conditions not met - step: ${state.currentStep}`
        )
      }
    }

    // Enhanced delay to ensure DOM is ready, then start focus attempt
    setTimeout(focusCurrentField, 350)
  }, [state.currentStep])

  // Auto-complete countdown trigger for step 5 (both MCA and non-MCA confirmation)
  useEffect(() => {
    if (
      state.currentStep === 5 &&
      !state.isProcessing &&
      state.autoCompleteCountdown === 0
    ) {
      logger.log(
        '🔄 RF Put-Away: Step 5 reached - starting auto-complete countdown'
      )
      // Inline auto-complete logic to avoid dependency issues
      logger.log(
        '🔍 RF Put-Away: Current form data at auto-complete start:',
        JSON.stringify(state.formData, null, 2)
      )
      toast.success('✅ Auto-completing putaway in 1.5 seconds...')

      setState((prev) => ({ ...prev, autoCompleteCountdown: 2 }))

      const countdown = setInterval(() => {
        setState((prev) => {
          if (prev.autoCompleteCountdown <= 1) {
            clearInterval(countdown)
            return prev
          }
          return {
            ...prev,
            autoCompleteCountdown: prev.autoCompleteCountdown - 1,
          }
        })
      }, 500)

      const timer = setTimeout(() => {
        // Trigger submission by setting a flag that handleSubmit can watch
        setState((prev) => ({ ...prev, shouldSubmit: true }))
      }, 1500)

      setAutoCompleteTimer(timer)
    }
  }, [state.currentStep, state.isProcessing, state.autoCompleteCountdown])

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      if (autoCompleteTimer) {
        clearTimeout(autoCompleteTimer)
      }
    }
  }, [timers, autoCompleteTimer])

  // Field validation functions
  const isFieldComplete = useCallback(
    (value: string, field: string): boolean => {
      const trimmed = value.trim()

      switch (field) {
        case 'materialNumber':
        case 'toLocation':
        case 'shelfLocation':
        case 'mcaDropLocation':
          return trimmed.length > 0
        case 'toNumber':
          return trimmed.length > 0
        case 'mcaReason':
          const validCodes = [
            'LOCATION_FULL',
            'BINBLOCK_NEEDBIN',
            'DIFFERENT_PART',
          ]
          return validCodes.includes(trimmed.toUpperCase())
        default:
          return false
      }
    },
    []
  )

  // Auto-advance logic
  const handleFieldChange = useCallback(
    (field: string, value: string) => {
      logger.log(`📝 RF Put-Away: Field change - ${field}: "${value}"`)

      // Clear existing timer
      const currentTimer = timers.get(field)
      if (currentTimer) {
        clearTimeout(currentTimer)
        setTimers((prev) => {
          const newTimers = new Map(prev)
          newTimers.delete(field)
          return newTimers
        })
      }

      // Update form data
      setState((prev) => {
        const updatedFormData = { ...prev.formData, [field]: value }
        logger.log(
          `📝 RF Put-Away: Updated form data for ${field}:`,
          JSON.stringify(updatedFormData, null, 2)
        )

        // Parse T.O. Number if toNumber field is being updated
        if (field === 'toNumber') {
          const parseResult = parseTONumber(
            value,
            warehouseAllowlistRef.current
          )
          return {
            ...prev,
            formData: updatedFormData,
            parsedTONumber: parseResult.toNumber,
            parsedWarehouse: parseResult.warehouse,
          }
        }

        return {
          ...prev,
          formData: updatedFormData,
        }
      })

      // PUTBACK TICKET DETECTION - October 20, 2025
      // Check if material number is a putback ticket
      if (field === 'materialNumber' && value.trim()) {
        const isPutback = isPutbackNumber(value)

        if (isPutback) {
          logger.log('🎫 RF Put-Away: Putback number detected!', value)

          // Set loading state
          setState((prev) => ({ ...prev, isLoadingPutback: true }))

          // Fetch putback ticket asynchronously
          fetchPutbackTicket(value)
            .then((ticket) => {
              if (ticket) {
                logger.log('✅ RF Put-Away: Putback ticket loaded:', ticket)

                // Pre-fill form with putback data - simplified workflow
                setState((prev) => ({
                  ...prev,
                  isPutbackWorkflow: true,
                  putbackTicketData: ticket,
                  putbackTicketId: ticket.id,
                  isLoadingPutback: false,
                  formData: {
                    ...prev.formData,
                    materialNumber: ticket.material_number, // Use actual material number
                    toNumber: 'PUTBACK', // Dummy T.O. number for putback workflow
                    // T.O. Location will be scanned by user (where they're putting it)
                  },
                }))

                toast.success(
                  `🎫 Putback Ticket: ${ticket.material_number} | Return to: ${ticket.original_storage_bin || 'Location TBD'}`
                )
              } else {
                logger.log(
                  '⚠️ RF Put-Away: Putback ticket not found or already completed'
                )
                setState((prev) => ({ ...prev, isLoadingPutback: false }))
                toast.error('Putback ticket not found or already completed')
              }
            })
            .catch((err) => {
              logger.error('❌ RF Put-Away: Error loading putback ticket:', err)
              setState((prev) => ({ ...prev, isLoadingPutback: false }))
              toast.error('Failed to load putback ticket')
            })
        }
      }

      // Set auto-advance timer if field is complete
      if (isFieldComplete(value, field)) {
        logger.log(
          `⏱️ RF Put-Away: Field ${field} is complete, setting auto-advance timer`
        )
        const timer = setTimeout(() => {
          logger.log(`🚀 RF Put-Away: Auto-advancing from field ${field}`)

          if (state.currentStep === 1) {
            if (field === 'materialNumber' && toLocationRef.current) {
              toLocationRef.current.focus()
            } else if (field === 'toLocation') {
              // PUTBACK WORKFLOW FIX - October 21, 2025
              // If putback workflow, skip T.O. Number field and directly validate Step 1
              if (state.isPutbackWorkflow) {
                // Trigger Step 1 validation immediately for putback workflow
                setTimeout(() => {
                  logger.log(
                    '🔍 RF Put-Away: Putback workflow - validating Step 1 without T.O. Number field'
                  )
                  setState((currentState) => {
                    const { materialNumber, toLocation, toNumber } =
                      currentState.formData

                    if (
                      !materialNumber.trim() ||
                      !toLocation.trim() ||
                      !toNumber.trim()
                    ) {
                      toast.error(
                        'Material Number and T.O. Location are required'
                      )
                      return currentState
                    }

                    // Validate T.O. Location format
                    const toLocationValidation = validateTOLocation(toLocation)
                    if (!toLocationValidation.isValid) {
                      toast.error(toLocationValidation.message)
                      return currentState
                    }

                    logger.log(
                      '✅ RF Put-Away: Putback workflow Step 1 validation passed - advancing to step 2'
                    )
                    return { ...currentState, currentStep: 2 }
                  })
                }, 50)
              } else if (toNumberRef.current) {
                // Normal workflow - focus T.O. Number field
                toNumberRef.current.focus()
              }
            } else if (field === 'toNumber') {
              // Inline Step 1 validation with current state access
              setTimeout(() => {
                logger.log('🔍 RF Put-Away: Auto-advance Step 1 validation')
                setState((currentState) => {
                  logger.log(
                    '🔍 RF Put-Away: State during auto-advance validation:',
                    JSON.stringify(currentState.formData, null, 2)
                  )
                  const { materialNumber, toLocation, toNumber } =
                    currentState.formData

                  if (
                    !materialNumber.trim() ||
                    !toLocation.trim() ||
                    !toNumber.trim()
                  ) {
                    toast.error('All fields in Step 1 are required')
                    return currentState
                  }

                  // Validate T.O. Location format
                  const toLocationValidation = validateTOLocation(toLocation)
                  if (!toLocationValidation.isValid) {
                    toast.error(toLocationValidation.message)
                    return currentState
                  }

                  // Validate T.O. Number format
                  const toNumberValidation = validateTONumber(
                    toNumber,
                    warehouseAllowlistRef.current
                  )
                  if (!toNumberValidation.isValid) {
                    toast.error(toNumberValidation.message)
                    return currentState
                  }

                  logger.log(
                    '✅ RF Put-Away: Auto-advance Step 1 validation passed - advancing to step 2'
                  )
                  return { ...currentState, currentStep: 2 }
                })
              }, 50)
            }
          } else if (state.currentStep === 2 && field === 'shelfLocation') {
            // Inline Step 2 validation with TO location matching
            setTimeout(() => {
              setState((currentState) => {
                const { toLocation, shelfLocation } = currentState.formData
                logger.log(
                  '🔍 RF Put-Away: validateStep2 - Current form data:',
                  JSON.stringify(currentState.formData, null, 2)
                )

                if (!shelfLocation.trim()) {
                  toast.error('Shelf Location is required')
                  return currentState
                }

                // Validate TO location matching and check for MCA requirement
                const locationValidation = validateTOLocationMatching(
                  toLocation,
                  shelfLocation
                )

                if (!locationValidation.isValid) {
                  toast.error(
                    locationValidation.message || 'Location validation failed'
                  )
                  return currentState
                }

                if (locationValidation.shouldTriggerMCA) {
                  // TO location mismatch with RO-R3L0C4T0R detected - trigger MCA workflow
                  toast.warning(
                    '⚠️ TO location mismatch with relocator detected! MCA workflow required.'
                  )
                  return {
                    ...currentState,
                    requiresMCA: true,
                    currentStep: 3,
                  }
                }

                // Normal workflow - locations match, advance to confirmation (step 5)
                return { ...currentState, currentStep: 5 }
              })
            }, 50)
          } else if (state.currentStep === 3 && field === 'mcaReason') {
            // Inline MCA reason validation
            setTimeout(() => {
              setState((currentState) => {
                const { mcaReason } = currentState.formData
                if (!mcaReason || mcaReason.trim().length === 0) {
                  toast.error('MCA Reason is required')
                  return currentState
                }
                // Valid MCA reason - advance to step 4 and set selected reason
                return {
                  ...currentState,
                  currentStep: 4,
                  selectedMcaReason: mcaReason.trim().toUpperCase(),
                }
              })
            }, 50)
          } else if (state.currentStep === 4 && field === 'mcaDropLocation') {
            // Inline MCA location validation
            setTimeout(() => {
              setState((currentState) => {
                const { mcaDropLocation } = currentState.formData
                if (!mcaDropLocation.trim()) {
                  toast.error('MCA Drop Location is required')
                  return currentState
                }
                // Valid MCA drop location - advance to step 5 for confirmation
                return { ...currentState, currentStep: 5 }
              })
            }, 50)
          }
        }, autoAdvanceDelay)

        setTimers((prev) => new Map(prev).set(field, timer))
      }
    },
    [timers, isFieldComplete, state.currentStep]
  )

  // Validation functions - now inlined in auto-advance logic

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (state.isProcessing) return

    setState((prev) => ({ ...prev, isProcessing: true }))

    try {
      // CRITICAL FIX - October 22, 2025: Separate putback and putaway workflows to prevent double-logging
      // Putback workflows should ONLY update putback_tickets table
      // Normal putaway workflows should ONLY create in rf_putaway_operations table

      if (state.isPutbackWorkflow && state.putbackTicketId && user?.id) {
        // ========== PUTBACK WORKFLOW ONLY ==========
        logger.log(
          '🎫 RF Put-Away: Processing PUTBACK workflow - updating putback_tickets ONLY'
        )
        logger.log('🎫 RF Put-Away: Putback ticket ID:', state.putbackTicketId)

        const putbackResult = await completePutbackTicket(
          state.putbackTicketId,
          user.id
        )

        if (!putbackResult.success) {
          logger.error(
            '❌ RF Put-Away: Failed to complete putback ticket:',
            putbackResult.error
          )
          toast.error(`Failed to complete putback: ${putbackResult.error}`)
          setState((prev) => ({ ...prev, isProcessing: false }))
          return
        }

        logger.log(
          '✅ RF Put-Away: Putback ticket marked as completed (putback_tickets table ONLY)'
        )
        toast.success(
          `✅ Putback completed! Ticket ${state.putbackTicketData?.putback_number} processed.`
        )

        // Reset form
        setTimeout(() => {
          resetForm()
        }, 1000)
      } else {
        // ========== NORMAL PUTAWAY WORKFLOW ==========
        logger.log(
          '📦 RF Put-Away: Processing NORMAL putaway workflow - creating rf_putaway_operations record'
        )

        const { formData } = state
        // Use parsed T.O. Number and warehouse from state
        const toNumber = state.parsedTONumber || formData.toNumber.trim()
        const warehouse = state.parsedWarehouse || null

        // Belt-and-suspenders allowlist re-check (fix #1). Step 1 already
        // blocks unknown warehouses, but re-validate here in case the value
        // reached submit via a path that bypassed the gate. Fails open when the
        // allowlist hasn't loaded (ref is undefined).
        const allowlist = warehouseAllowlistRef.current
        if (allowlist && warehouse && !allowlist.has(warehouse.toUpperCase())) {
          toast.error(
            `Unrecognized warehouse "${warehouse}". Re-scan the T.O. label.`
          )
          setState((prev) => ({ ...prev, isProcessing: false }))
          return
        }

        // Early duplicate T.O. Number check - give user immediate feedback
        const duplicateCheck = await rfPutawayService.checkDuplicateTONumber(
          toNumber,
          formData.toNumber.trim(),
          formData.materialNumber.trim()
        )

        if (duplicateCheck.isDuplicate) {
          const existing = duplicateCheck.existingRecord
          const when = existing?.created_at
            ? new Date(existing.created_at).toLocaleString('en-US', {
                timeZone: 'America/New_York',
              })
            : 'unknown time'
          const who = existing?.putaway_driver || 'unknown user'
          toast.error(
            `⚠️ Duplicate T.O.! Already scanned by ${who} on ${when}`,
            {
              duration: 6000,
              description: `T.O. ${toNumber} with material ${formData.materialNumber.trim()} already exists in the system.`,
            }
          )
          setState((prev) => ({ ...prev, isProcessing: false }))
          return
        }

        // Determine final shelf location (use MCA drop location if MCA workflow)
        const finalShelfLocation =
          state.requiresMCA && formData.mcaDropLocation
            ? formData.mcaDropLocation
            : formData.shelfLocation

        const putawayData: RFPutawayCreateData = {
          material_number: formData.materialNumber.trim(),
          to_location: formData.toLocation.trim(),
          to_number: toNumber,
          raw_to_number: formData.toNumber.trim(),
          warehouse: warehouse || undefined,
          shelf_location: finalShelfLocation.trim(),
          scanned_shelf_location: formData.shelfLocation.trim(),
          putaway_driver: profile?.full_name || user?.email || 'Unknown User',
          is_mca_workflow: state.requiresMCA,
          mca_reason: state.requiresMCA
            ? state.selectedMcaReason || undefined
            : undefined,
          mca_reason_code: state.requiresMCA
            ? formData.mcaReason.trim()
            : undefined,
          mca_drop_location: state.requiresMCA
            ? formData.mcaDropLocation.trim()
            : undefined,
          scanner_type: 'RF_TERMINAL',
        }

        logger.log(
          '🔍 RF Put-Away Form: Form data before submission:',
          JSON.stringify(
            {
              formData,
              parsedTONumber: state.parsedTONumber,
              parsedWarehouse: state.parsedWarehouse,
              putawayData,
            },
            null,
            2
          )
        )

        const { data, error } =
          await rfPutawayService.createPutaway(putawayData)

        if (error) {
          toast.error(`Failed to save putaway: ${error}`)
          setState((prev) => ({ ...prev, isProcessing: false }))
          return
        }

        // Success
        logger.log(
          '✅ RF Put-Away: Putaway saved successfully to rf_putaway_operations:',
          data?.id
        )
        toast.success('✅ Putaway completed successfully!')

        // Reset form
        setTimeout(() => {
          resetForm()
        }, 1000)
      }
    } catch (error: unknown) {
      logger.error('❌ RF Put-Away: Error submitting putaway:', error)
      toast.error(
        `Failed to complete putaway: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      setState((prev) => ({ ...prev, isProcessing: false }))
    }
  }, [state, profile, user])

  // Handle submission trigger
  useEffect(() => {
    if (state.shouldSubmit && !state.isProcessing) {
      logger.log(
        '🚀 RF Put-Away: shouldSubmit flag triggered - calling handleSubmit'
      )
      setState((prev) => ({ ...prev, shouldSubmit: false })) // Reset flag
      handleSubmit()
    }
  }, [state.shouldSubmit, state.isProcessing, handleSubmit])

  // Reset form to initial state
  const resetForm = useCallback(() => {
    // Prevent reset if currently processing
    if (state.isProcessing) {
      logger.log('⚠️ RF Put-Away: Preventing form reset while processing')
      return
    }

    logger.log('🔄 RF Put-Away: Resetting form to initial state')

    // Clear all timers
    timers.forEach((timer) => clearTimeout(timer))
    setTimers(new Map())

    if (autoCompleteTimer) {
      clearTimeout(autoCompleteTimer)
      setAutoCompleteTimer(null)
    }

    // Reset state
    setState({
      currentStep: 1,
      formData: {
        materialNumber: '',
        toLocation: '',
        toNumber: '',
        shelfLocation: '',
        mcaReason: '',
        mcaDropLocation: '',
      },
      requiresMCA: false,
      selectedMcaReason: null,
      isProcessing: false,
      autoCompleteCountdown: 0,
      shouldSubmit: false,
      // Reset parsed T.O. data
      parsedTONumber: '',
      parsedWarehouse: '',
      // Reset putback fields
      isPutbackWorkflow: false,
      putbackTicketData: null,
      putbackTicketId: null,
      isLoadingPutback: false,
    })

    // Focus first field
    setTimeout(() => {
      if (materialRef.current) {
        materialRef.current.focus()
      }
    }, 100)
  }, [timers, autoCompleteTimer, state.isProcessing])

  // Handle MCA reason selection
  const selectMCAReasonCard = useCallback((reason: string) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, mcaReason: reason },
      selectedMcaReason: reason,
    }))

    // Auto-advance after selection - inline validation
    setTimeout(() => {
      logger.log(
        `🚀 RF Put-Away: Auto-advancing from MCA card selection: ${reason}`
      )
      setState((currentState) => {
        // MCA reason is already validated by card selection - advance to step 4
        logger.log('✅ RF Put-Away: MCA reason validated - advancing to step 4')
        return { ...currentState, currentStep: 4 }
      })
    }, autoAdvanceDelay)
  }, [])

  // Navigation functions
  const goToPreviousStep = useCallback(() => {
    if (state.currentStep === 3 && state.requiresMCA) {
      // Go back from MCA Reason to Location
      setState((prev) => ({ ...prev, currentStep: 2 }))
    } else if (state.currentStep === 4) {
      // Go back from MCA Location to MCA Reason
      setState((prev) => ({ ...prev, currentStep: 3 }))
    } else if (state.currentStep === 5) {
      // Go back from Confirm to either MCA Location (4) or Location (2)
      if (state.requiresMCA) {
        setState((prev) => ({ ...prev, currentStep: 4 }))
      } else {
        setState((prev) => ({ ...prev, currentStep: 2 }))
      }
    } else if (state.currentStep > 1) {
      setState((prev) => ({ ...prev, currentStep: prev.currentStep - 1 }))
    }
  }, [state.currentStep, state.requiresMCA])

  const goToNextStep = useCallback(() => {
    if (state.currentStep === 1) {
      // Inline Step 1 validation to avoid stale closure
      const { materialNumber, toLocation, toNumber } = state.formData
      logger.log(
        '🔍 RF Put-Away: Manual Step 1 validation - Form data:',
        JSON.stringify(state.formData, null, 2)
      )

      if (!materialNumber.trim() || !toLocation.trim() || !toNumber.trim()) {
        toast.error('All fields in Step 1 are required')
        return
      }

      // Validate T.O. Location format
      const toLocationValidation = validateTOLocation(toLocation)
      if (!toLocationValidation.isValid) {
        toast.error(toLocationValidation.message)
        return
      }

      // Validate T.O. Number format
      const toNumberValidation = validateTONumber(
        toNumber,
        warehouseAllowlistRef.current
      )
      if (!toNumberValidation.isValid) {
        toast.error(toNumberValidation.message)
        return
      }

      setState((prev) => ({ ...prev, currentStep: 2 }))
    } else if (state.currentStep === 2) {
      // Inline Step 2 validation for manual next button with TO location matching
      const { toLocation, shelfLocation } = state.formData

      if (!shelfLocation.trim()) {
        toast.error('Shelf Location is required')
        return
      }

      // Validate TO location matching and check for MCA requirement
      const locationValidation = validateTOLocationMatching(
        toLocation,
        shelfLocation
      )

      if (!locationValidation.isValid) {
        toast.error(locationValidation.message || 'Location validation failed')
        return
      }

      if (locationValidation.shouldTriggerMCA) {
        // TO location mismatch with RO-R3L0C4T0R detected - trigger MCA workflow
        setState((prev) => ({
          ...prev,
          requiresMCA: true,
          currentStep: 3,
        }))
        toast.warning(
          '⚠️ TO location mismatch with relocator detected! MCA workflow required.'
        )
      } else {
        // Normal workflow - locations match, advance to confirmation (step 5)
        setState((prev) => ({ ...prev, currentStep: 5 }))
      }
    } else if (state.currentStep === 3) {
      // Inline MCA reason validation for manual next button
      const { mcaReason } = state.formData
      if (!mcaReason || mcaReason.trim().length === 0) {
        toast.error('MCA Reason is required')
        return
      }
      setState((prev) => ({
        ...prev,
        currentStep: 4,
        selectedMcaReason: mcaReason.trim().toUpperCase(),
      }))
    } else if (state.currentStep === 4) {
      // Inline MCA location validation for manual next button
      const { mcaDropLocation } = state.formData
      if (!mcaDropLocation.trim()) {
        toast.error('MCA Drop Location is required')
        return
      }
      setState((prev) => ({ ...prev, currentStep: 5 }))
    }
  }, [state.currentStep, state.formData])

  // Get current step index for stepper display
  const getCurrentStepIndex = useCallback(() => {
    if (state.currentStep <= 2) return state.currentStep - 1
    if (state.currentStep === 3) return 2 // MCA Reason
    if (state.currentStep === 4) return 3 // MCA Location
    if (state.currentStep === 5) return state.requiresMCA ? 4 : 2 // Confirm
    return 0
  }, [state.currentStep, state.requiresMCA])

  // Animation variants
  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.2 } },
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
            title='Put Away'
            subtitle='Stock locations'
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
              {/* Step 1: Material Scan */}
              {state.currentStep === 1 && (
                <div className='space-y-4'>
                  <div className='mb-6 space-y-2 text-center'>
                    <Scan className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>Put Away Scanner</h3>
                    <p className='text-muted-foreground text-sm'>
                      Scan or enter the transfer order details
                    </p>
                  </div>

                  <div className='space-y-4'>
                    <div className='space-y-2'>
                      <Label
                        htmlFor='materialNumber'
                        className='text-sm font-medium'
                      >
                        Material Number *
                      </Label>
                      <ScannerInput
                        ref={materialRef}
                        id='materialNumber'
                        placeholder='Scan or enter material number'
                        value={state.formData.materialNumber}
                        onChange={(e) =>
                          handleFieldChange('materialNumber', e.target.value)
                        }
                        className='text-center font-mono'
                        autoComplete='off'
                      />
                      {/* PUTBACK WORKFLOW INDICATOR */}
                      {state.isPutbackWorkflow && state.putbackTicketData && (
                        <div className='space-y-2 rounded border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950/20'>
                          <div className='flex items-center justify-between'>
                            <span className='text-xs font-semibold text-purple-700 dark:text-purple-300'>
                              🎫 Putback Workflow
                            </span>
                            <span className='text-xs text-purple-600 dark:text-purple-400'>
                              {state.putbackTicketData.putback_number}
                            </span>
                          </div>
                          <div className='flex justify-between text-xs'>
                            <span className='text-muted-foreground'>
                              Delivery:
                            </span>
                            <code className='bg-muted rounded px-1 font-mono'>
                              {state.putbackTicketData.delivery_id}
                            </code>
                          </div>
                          <div className='flex justify-between text-xs'>
                            <span className='text-muted-foreground'>
                              Quantity:
                            </span>
                            <code className='bg-muted rounded px-1 font-mono'>
                              {state.putbackTicketData.quantity_returned}
                            </code>
                          </div>
                          {state.putbackTicketData.original_storage_bin && (
                            <div className='flex justify-between text-xs'>
                              <span className='text-muted-foreground'>
                                Return Location:
                              </span>
                              <code className='rounded bg-green-100 px-2 py-1 font-mono font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300'>
                                {state.putbackTicketData.original_storage_bin}
                              </code>
                            </div>
                          )}
                        </div>
                      )}
                      {state.isLoadingPutback && (
                        <div className='text-muted-foreground flex items-center justify-center py-2 text-sm'>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          Loading putback ticket...
                        </div>
                      )}
                    </div>

                    <div className='space-y-2'>
                      <Label
                        htmlFor='toLocation'
                        className='text-sm font-medium'
                      >
                        T.O. Location *
                      </Label>
                      <ScannerInput
                        ref={toLocationRef}
                        id='toLocation'
                        placeholder='Format: K3-01-01-1 or RD-20-E-01'
                        value={state.formData.toLocation}
                        onChange={(e) =>
                          handleFieldChange(
                            'toLocation',
                            e.target.value.toUpperCase()
                          )
                        }
                        className='text-center font-mono'
                        autoComplete='off'
                      />
                      <p className='text-muted-foreground text-xs'></p>
                    </div>

                    {/* T.O. Number field - HIDDEN for putback workflow */}
                    {!state.isPutbackWorkflow && (
                      <div className='space-y-2'>
                        <Label
                          htmlFor='toNumber'
                          className='text-sm font-medium'
                        >
                          T.O. Number *
                        </Label>
                        <ScannerInput
                          ref={toNumberRef}
                          id='toNumber'
                          placeholder='Format: 3597367'
                          value={state.formData.toNumber}
                          onChange={(e) =>
                            handleFieldChange('toNumber', e.target.value)
                          }
                          className='text-center font-mono'
                          autoComplete='off'
                        />
                        {/* Display parsed T.O. data */}
                        {state.parsedTONumber && (
                          <div className='space-y-1 rounded border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-950/20'>
                            <div className='flex justify-between text-xs'>
                              <span className='text-muted-foreground'>
                                TO Number:
                              </span>
                              <code className='bg-muted rounded px-1 font-mono'>
                                {state.parsedTONumber}
                              </code>
                            </div>
                            {state.parsedWarehouse && (
                              <div className='flex justify-between text-xs'>
                                <span className='text-muted-foreground'>
                                  Warehouse:
                                </span>
                                <code className='bg-muted rounded px-1 font-mono'>
                                  {state.parsedWarehouse}
                                </code>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Location Scan */}
              {state.currentStep === 2 && (
                <div className='space-y-4'>
                  <div className='mb-6 space-y-2 text-center'>
                    <MapPin className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Scan Shelf Location
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Scan the shelf location to verify against T.O. location
                    </p>
                  </div>

                  <div className='space-y-4'>
                    <div className='space-y-2'>
                      <Label
                        htmlFor='shelfLocation'
                        className='text-sm font-medium'
                      >
                        Shelf Location *
                      </Label>
                      <ScannerInput
                        ref={shelfLocationRef}
                        id='shelfLocation'
                        placeholder='Scan shelf location to verify'
                        value={state.formData.shelfLocation}
                        onChange={(e) =>
                          handleFieldChange(
                            'shelfLocation',
                            e.target.value.toUpperCase()
                          )
                        }
                        className='text-center font-mono text-lg'
                        autoComplete='off'
                      />
                      <p className='text-muted-foreground text-xs'>
                        Must match T.O. location:{' '}
                        <code className='bg-muted rounded px-1'>
                          {state.formData.toLocation || 'N/A'}
                        </code>
                      </p>
                    </div>

                    {/* T.O. Location Reference */}
                    <div className='bg-muted rounded-lg p-3'>
                      <p className='mb-1 text-sm font-medium'>
                        T.O. Location from Step 1:
                      </p>
                      <p className='bg-background rounded border p-2 text-center font-mono text-lg'>
                        {state.formData.toLocation || 'Not set'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step MCA: Reason Selection */}
              {state.currentStep === 3 && (
                <div className='space-y-4'>
                  <div className='mb-6 space-y-2 text-center'>
                    <AlertTriangle className='text-warning mx-auto h-12 w-12' />
                    <h3 className='text-warning text-lg font-semibold'>
                      MCA Action Required
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Relocator detected. Select the reason why putaway cannot
                      be completed.
                    </p>
                  </div>

                  <div className='space-y-4'>
                    {/* MCA Reason Cards */}
                    <div className='space-y-3'>
                      {[
                        {
                          code: 'LOCATION_FULL',
                          title: 'Location Full',
                          description: 'No space available in target location',
                        },
                        {
                          code: 'BINBLOCK_NEEDBIN',
                          title: 'Binblock',
                          description: 'Need alternative bin location',
                        },
                        {
                          code: 'DIFFERENT_PART',
                          title: 'Different Part',
                          description: 'Different part number in location',
                        },
                        {
                          code: 'REJECT_DAMAGED',
                          title: 'Reject - Damaged',
                          description: 'Material is damaged',
                        },
                        {
                          code: 'REJECT_EXPIRED',
                          title: 'Reject - Expired',
                          description: 'Material is expired',
                        },
                        {
                          code: 'MIXED_INVENTORY',
                          title: 'Mixed Inventory',
                          description: 'Mixed inventory conflict',
                        },
                      ].map((option) => (
                        <MCAReasonCard
                          key={option.code}
                          reason={option.code}
                          title={option.title}
                          description={option.description}
                          selected={state.selectedMcaReason === option.code}
                          onClick={() => selectMCAReasonCard(option.code)}
                        />
                      ))}
                    </div>

                    <div className='space-y-2'>
                      <Label
                        htmlFor='mcaReason'
                        className='text-sm font-medium'
                      >
                        MCA Reason Code *
                      </Label>
                      <ScannerInput
                        ref={mcaReasonRef}
                        id='mcaReason'
                        placeholder='Scan MCA reason code'
                        value={state.formData.mcaReason}
                        onChange={(e) =>
                          handleFieldChange(
                            'mcaReason',
                            e.target.value.toUpperCase()
                          )
                        }
                        className='text-center font-mono'
                        autoComplete='off'
                      />
                      <p className='text-muted-foreground text-xs'>
                        Scan one of the reason codes above to continue
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step MCA Location: Drop Location */}
              {state.currentStep === 4 && (
                <div className='space-y-4'>
                  <div className='mb-6 space-y-2 text-center'>
                    <Target className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Scan MCA Drop Location
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Scan the location where the item will be placed for MCA
                      processing.
                    </p>
                  </div>

                  <div className='space-y-4'>
                    <div className='space-y-2'>
                      <Label
                        htmlFor='mcaDropLocation'
                        className='text-sm font-medium'
                      >
                        MCA Drop Off Location *
                      </Label>
                      <ScannerInput
                        ref={mcaDropLocationRef}
                        id='mcaDropLocation'
                        placeholder='Scan drop off location'
                        value={state.formData.mcaDropLocation}
                        onChange={(e) =>
                          handleFieldChange(
                            'mcaDropLocation',
                            e.target.value.toUpperCase()
                          )
                        }
                        className='text-center font-mono text-lg'
                        autoComplete='off'
                      />
                      <p className='text-muted-foreground text-xs'>
                        This location will replace the original shelf location
                      </p>
                    </div>

                    {/* MCA Summary */}
                    <div className='bg-warning/10 border-warning/20 rounded-lg border p-3'>
                      <p className='text-warning mb-2 text-sm font-medium'>
                        MCA Summary:
                      </p>
                      <div className='space-y-1 text-xs'>
                        <p>
                          <span className='text-muted-foreground'>Reason:</span>{' '}
                          {state.selectedMcaReason}
                        </p>
                        <p>
                          <span className='text-muted-foreground'>
                            Original Location:
                          </span>{' '}
                          {state.formData.shelfLocation}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5: Confirmation */}
              {state.currentStep === 5 && (
                <div className='space-y-4'>
                  <div className='mb-6 space-y-2 text-center'>
                    <CheckCircle className='mx-auto h-12 w-12 text-green-600' />
                    <h3 className='text-lg font-semibold'>Putaway Summary</h3>
                    <p className='text-muted-foreground text-sm'>
                      Review the details and complete the putaway operation
                    </p>
                  </div>

                  {/* Auto-complete countdown */}
                  {state.autoCompleteCountdown > 0 && (
                    <div className='rounded-lg border border-green-200 bg-green-50 p-3 text-center'>
                      <div className='flex items-center justify-center space-x-2 text-green-700'>
                        <Clock className='h-4 w-4' />
                        <span className='text-sm font-medium'>
                          Auto-completing in{' '}
                          <span className='text-lg font-bold'>
                            {state.autoCompleteCountdown}
                          </span>{' '}
                          seconds...
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Summary details */}
                  <div className='space-y-3'>
                    <div className='grid grid-cols-1 gap-3'>
                      <div className='bg-muted rounded p-3'>
                        <p className='text-muted-foreground mb-1 text-xs'>
                          Material Number
                        </p>
                        <p className='font-mono font-medium'>
                          {state.formData.materialNumber}
                        </p>
                      </div>

                      <div className='bg-muted rounded p-3'>
                        <p className='text-muted-foreground mb-1 text-xs'>
                          T.O. Location
                        </p>
                        <p className='font-mono font-medium'>
                          {state.formData.toLocation}
                        </p>
                      </div>

                      <div className='bg-muted rounded p-3'>
                        <p className='text-muted-foreground mb-1 text-xs'>
                          T.O. Number
                        </p>
                        <p className='font-mono font-medium'>
                          {state.parsedTONumber || state.formData.toNumber}
                        </p>
                        {state.parsedWarehouse && (
                          <p className='mt-1 text-xs text-green-600'>
                            Warehouse: {state.parsedWarehouse}
                          </p>
                        )}
                      </div>

                      <div className='bg-muted rounded p-3'>
                        <p className='text-muted-foreground mb-1 text-xs'>
                          Final Location
                        </p>
                        <p className='font-mono font-medium'>
                          {state.requiresMCA && state.formData.mcaDropLocation
                            ? state.formData.mcaDropLocation
                            : state.formData.shelfLocation}
                        </p>
                      </div>

                      <div className='bg-muted rounded p-3'>
                        <p className='text-muted-foreground mb-1 text-xs'>
                          Operator
                        </p>
                        <p className='font-medium'>
                          {profile?.full_name || user?.email || 'Unknown User'}
                        </p>
                      </div>

                      {state.requiresMCA && (
                        <div className='bg-warning/10 border-warning/20 rounded border p-3'>
                          <p className='text-muted-foreground mb-1 text-xs'>
                            MCA Reason
                          </p>
                          <p className='text-warning font-mono font-medium'>
                            {state.selectedMcaReason}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {state.isProcessing && (
                    <div className='py-4 text-center'>
                      <Loader2 className='mx-auto mb-2 h-8 w-8 animate-spin' />
                      <p className='text-muted-foreground text-sm'>
                        Processing putaway...
                      </p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      {state.currentStep !== 5 && (
        <div className='flex justify-between space-x-3'>
          <Button
            variant='outline'
            onClick={goToPreviousStep}
            disabled={state.currentStep === 1}
            className='flex-1'
          >
            <ChevronLeft className='mr-1 h-4 w-4' />
            Back
          </Button>

          <Button
            onClick={goToNextStep}
            disabled={state.isProcessing}
            className='flex-1'
          >
            Next
            <ChevronRight className='ml-1 h-4 w-4' />
          </Button>
        </div>
      )}

      {/* Complete Button for final step */}
      {state.currentStep === 5 &&
        !state.isProcessing &&
        state.autoCompleteCountdown === 0 && (
          <Button
            onClick={handleSubmit}
            disabled={state.isProcessing}
            size='lg'
            className='w-full'
          >
            {state.isProcessing ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle className='mr-2 h-4 w-4' />
                Complete Putaway
              </>
            )}
          </Button>
        )}

      {/* New Putaway Button (shown after completion) */}
      {state.currentStep === 5 &&
        state.isProcessing === false &&
        state.autoCompleteCountdown === 0 && (
          <Button
            variant='outline'
            onClick={resetForm}
            size='lg'
            className='mt-2 w-full'
          >
            Start New Putaway
          </Button>
        )}
    </div>
  )
}

export default RFPutawayForm

// Created and developed by Jai Singh
