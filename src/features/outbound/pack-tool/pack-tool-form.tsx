'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FileEdit,
  Loader2,
  Package,
  Plus,
  Printer,
  Scale,
  Scan,
  Target,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { OutboundTOData } from '@/lib/supabase/outbound-to-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { usePackTool } from '@/hooks/use-outbound-to-data'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShippingLabel } from '@/components/ui/shipping-label'

// Types
interface DeliveryItem {
  id: string
  material: string
  material_description: string
  expectedQuantity: number
  scannedQuantity: number
  verified: boolean
  batch?: string
}

interface PackageData {
  length: string
  width: string
  height: string
  weight: string
}

interface TOScanState {
  toNumbers: string[]
  scannedTOs: string[]
  requiresTOScanning: boolean
  allTOsScanned: boolean
}

interface FormData {
  deliveryId: string
  items: DeliveryItem[]
  packageData: PackageData
  labelGenerated: boolean
  deliveryData?: OutboundTOData[]
  toScanState: TOScanState
}

// Stepper Context
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// Main Component
const PackToolForm = () => {
  const [currentStep, setCurrentStep] = useState(0)
  const [currentMaterialScan, setCurrentMaterialScan] = useState('')
  const [currentQuantity, setCurrentQuantity] = useState('')
  const [scanError, setScanError] = useState('')
  const [formData, setFormData] = useState<FormData>({
    deliveryId: '',
    items: [],
    packageData: {
      length: '',
      width: '',
      height: '',
      weight: '',
    },
    labelGenerated: false,
    toScanState: {
      toNumbers: [],
      scannedTOs: [],
      requiresTOScanning: false,
      allTOsScanned: false,
    },
  })

  // Use the pack tool hook for real Supabase operations
  const {
    verifyDeliveryAsync,
    isVerifyingDelivery,
    validateTOAsync,
    isValidatingTO,
    updatePackingInfoAsync,
    completePackingAsync,
    isCompletingPacking,
  } = usePackTool()

  // Auth state management for session refresh
  const { authState } = useUnifiedAuth()
  const { isAuthenticated, isLoading: isAuthLoading } = authState

  // Add TO scanning state
  const [currentTOScan, setCurrentTOScan] = useState('')
  const [toScanError, setTOScanError] = useState('')

  // Auto-proceed flag to prevent multiple triggers
  const [hasAutoProceedTriggered, setHasAutoProceedTriggered] = useState(false)

  // Auto-verify trigger - debounced delivery verification
  const [autoVerifyTimeout, setAutoVerifyTimeout] =
    useState<NodeJS.Timeout | null>(null)
  const [isAutoVerifyPending, setIsAutoVerifyPending] = useState(false)

  // Auto-scan trigger for material/quantity workflow
  const [autoScanTimeout, setAutoScanTimeout] = useState<NodeJS.Timeout | null>(
    null
  )
  const [isAutoScanPending, setIsAutoScanPending] = useState(false)

  // 🔒 CONCURRENT OPERATION LOCKS - Prevent race conditions
  const verificationInProgressRef = useRef(false)
  const materialScanInProgressRef = useRef(false)

  // 🎯 CURRENT VALUE REFS - Track latest values to detect stale timers
  const currentDeliveryIdRef = useRef(formData.deliveryId)
  const currentMaterialScanRef = useRef(currentMaterialScan)
  const currentQuantityRef = useRef(currentQuantity)

  // Update refs whenever values change
  useEffect(() => {
    currentDeliveryIdRef.current = formData.deliveryId
  }, [formData.deliveryId])

  useEffect(() => {
    currentMaterialScanRef.current = currentMaterialScan
  }, [currentMaterialScan])

  useEffect(() => {
    currentQuantityRef.current = currentQuantity
  }, [currentQuantity])

  // Auto-focus delivery ID field when on step 0
  useEffect(() => {
    logger.log(`🔄 Pack Tool: Step changed to ${currentStep}`)

    if (currentStep === 0) {
      logger.log('🎯 Pack Tool: Auto-focusing delivery ID field')
      setTimeout(() => {
        const deliveryInput = document.getElementById(
          'deliveryId'
        ) as HTMLInputElement
        if (deliveryInput) {
          deliveryInput.focus()
          logger.log('✅ Pack Tool: Delivery ID field focused')
        }
      }, 100)
    }
  }, [currentStep])

  // Auto-verify delivery ID after user stops typing (debounced)
  useEffect(() => {
    // 🔒 Check lock at entry - don't set new timer if verification already running
    if (verificationInProgressRef.current) {
      logger.log(
        '🔒 Pack Tool: Verification lock active, skipping auto-verify timer setup'
      )
      return
    }

    // Clear existing timeout and pending state
    if (autoVerifyTimeout) {
      clearTimeout(autoVerifyTimeout)
      setAutoVerifyTimeout(null)
      setIsAutoVerifyPending(false)
    }

    // Only auto-verify when on step 0 and have a delivery ID that looks complete
    if (
      currentStep === 0 &&
      formData.deliveryId &&
      formData.deliveryId.length >= 6 &&
      !hasAutoProceedTriggered
    ) {
      // Capture the CURRENT delivery ID value that this timer is for
      const capturedDeliveryId = formData.deliveryId
      logger.log(
        `⏱️ Pack Tool: Starting auto-verify timer for delivery ${capturedDeliveryId}`
      )
      setIsAutoVerifyPending(true)

      const timeoutId = setTimeout(async () => {
        // 🔒 Double-check lock before executing verification
        if (verificationInProgressRef.current) {
          logger.log(
            '🔒 Pack Tool: Verification already in progress, skipping auto-verify callback'
          )
          setIsAutoVerifyPending(false)
          return
        }

        // 🎯 CRITICAL FIX: Verify the delivery ID hasn't changed since timer was set
        // Use ref to check ACTUAL current value, not closure variable
        if (currentDeliveryIdRef.current !== capturedDeliveryId) {
          logger.log(
            `⏭️ Pack Tool: Delivery ID changed from ${capturedDeliveryId} to ${currentDeliveryIdRef.current}, skipping stale auto-verify`
          )
          setIsAutoVerifyPending(false)
          return
        }

        logger.log(
          `🤖 Pack Tool: Auto-verifying delivery ${currentDeliveryIdRef.current} (no button click needed)`
        )
        setIsAutoVerifyPending(false)

        if (!isVerifyingDelivery && !isAuthLoading) {
          // Trigger verification with current delivery ID
          handleDeliveryScan()
        }
      }, 1500) // 1.5 second delay after user stops typing

      setAutoVerifyTimeout(timeoutId)
    } else {
      setIsAutoVerifyPending(false)
    }

    // Cleanup function
    return () => {
      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
        setAutoVerifyTimeout(null)
        setIsAutoVerifyPending(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleDeliveryScan excluded: would cause effect re-run every render
  }, [
    formData.deliveryId,
    currentStep,
    hasAutoProceedTriggered,
    isVerifyingDelivery,
    isAuthLoading,
  ])

  // Auto-scan for material/quantity workflow
  useEffect(() => {
    // 🔒 Check lock at entry - don't set new timer if material scan already running
    if (materialScanInProgressRef.current) {
      logger.log(
        '🔒 Pack Tool: Material scan lock active, skipping auto-scan timer setup'
      )
      return
    }

    // Clear existing timeout
    if (autoScanTimeout) {
      clearTimeout(autoScanTimeout)
      setAutoScanTimeout(null)
      setIsAutoScanPending(false)
    }

    // Only auto-scan when on parts scanning step
    const isPartsStep =
      (currentStep === 1 && !formData.toScanState.requiresTOScanning) ||
      (currentStep === 2 && formData.toScanState.requiresTOScanning)

    if (isPartsStep) {
      // Auto-scan material when material field has enough characters
      if (currentMaterialScan.trim().length >= 3 && !currentQuantity.trim()) {
        // Capture CURRENT material scan value that this timer is for
        const capturedMaterialScan = currentMaterialScan
        logger.log(
          `⏱️ Pack Tool: Starting auto-material-scan timer for ${capturedMaterialScan}`
        )
        setIsAutoScanPending(true)

        const timeoutId = setTimeout(async () => {
          // 🔒 Double-check lock before executing material scan
          if (materialScanInProgressRef.current) {
            logger.log(
              '🔒 Pack Tool: Material scan already in progress, skipping auto-scan callback'
            )
            setIsAutoScanPending(false)
            return
          }

          // 🎯 CRITICAL FIX: Verify the material scan hasn't changed since timer was set
          // Use ref to check ACTUAL current value, not closure variable
          if (currentMaterialScanRef.current !== capturedMaterialScan) {
            logger.log(
              `⏭️ Pack Tool: Material changed from ${capturedMaterialScan} to ${currentMaterialScanRef.current}, skipping stale auto-scan`
            )
            setIsAutoScanPending(false)
            return
          }

          logger.log(
            `🤖 Pack Tool: Auto-validating material ${currentMaterialScan}`
          )
          setIsAutoScanPending(false)

          try {
            handleMaterialScan()
          } catch (error) {
            logger.error('Auto-material scan error:', error)
            setIsAutoScanPending(false)
          }
        }, 1000) // 1 second delay for material validation

        setAutoScanTimeout(timeoutId)
      }
      // Auto-scan quantity when quantity field has VALID POSITIVE NUMBER and material was scanned
      else if (currentMaterialScan.trim() && currentQuantity.trim()) {
        // 🎯 ENHANCED VALIDATION: Only trigger auto-scan for valid positive numbers
        const parsedQuantity = parseInt(currentQuantity.trim())
        const isValidQuantity = !isNaN(parsedQuantity) && parsedQuantity > 0

        if (isValidQuantity) {
          // Capture CURRENT quantity value that this timer is for
          const capturedQuantity = currentQuantity
          const capturedMaterial = currentMaterialScan
          logger.log(
            `⏱️ Pack Tool: Starting auto-quantity-scan timer for material ${capturedMaterial} quantity ${capturedQuantity}`
          )
          setIsAutoScanPending(true)

          const timeoutId = setTimeout(async () => {
            // 🔒 Double-check lock before executing quantity scan
            if (materialScanInProgressRef.current) {
              logger.log(
                '🔒 Pack Tool: Material scan already in progress, skipping auto-quantity callback'
              )
              setIsAutoScanPending(false)
              return
            }

            // 🎯 CRITICAL FIX: Verify neither material nor quantity has changed since timer was set
            // Use refs to check ACTUAL current values, not closure variables
            if (
              currentMaterialScanRef.current !== capturedMaterial ||
              currentQuantityRef.current !== capturedQuantity
            ) {
              logger.log(
                `⏭️ Pack Tool: Values changed (material: ${capturedMaterial}→${currentMaterialScanRef.current}, quantity: ${capturedQuantity}→${currentQuantityRef.current}), skipping stale auto-scan`
              )
              setIsAutoScanPending(false)
              return
            }

            logger.log(`🤖 Pack Tool: Auto-adding quantity ${currentQuantity}`)
            setIsAutoScanPending(false)

            try {
              handleQuantityScan()
            } catch (error) {
              logger.error('Auto-quantity scan error:', error)
              setIsAutoScanPending(false)
            }
          }, 800) // 0.8 second delay for quantity addition

          setAutoScanTimeout(timeoutId)
        } else {
          // Invalid quantity - don't set timer
          setIsAutoScanPending(false)
        }
      } else {
        setIsAutoScanPending(false)
      }
    }

    // Cleanup function
    return () => {
      if (autoScanTimeout) {
        clearTimeout(autoScanTimeout)
        setAutoScanTimeout(null)
        setIsAutoScanPending(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleMaterialScan/handleQuantityScan/autoScanTimeout excluded: would cause effect re-run every render
  }, [
    currentMaterialScan,
    currentQuantity,
    currentStep,
    formData.toScanState.requiresTOScanning,
  ])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
      }
      if (autoScanTimeout) {
        clearTimeout(autoScanTimeout)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run on mount only, cleanup on unmount
  }, [])

  // Removed problematic useEffect that was triggering auto-proceed on back navigation
  // Auto-proceed is now handled directly in handleDeliveryScan function

  // Dynamic steps based on whether TO scanning is required
  const baseSteps = [
    {
      id: 1,
      title: 'Scan Delivery',
      icon: Scan,
      description: 'Verify delivery exists',
    },
    {
      id: 2,
      title: 'Scan Parts',
      icon: Package,
      description: 'Scan all parts and quantities',
    },
    {
      id: 3,
      title: 'Package Info',
      icon: Scale,
      description: 'Enter dimensions and weight',
    },
    {
      id: 4,
      title: 'Print Label',
      icon: Printer,
      description: 'Generate shipping label',
    },
  ]

  const stepsWithTO = [
    {
      id: 1,
      title: 'Scan Delivery',
      icon: Scan,
      description: 'Verify delivery exists',
    },
    {
      id: 2,
      title: 'Scan Transfer Orders',
      icon: FileEdit,
      description: 'Scan all TO numbers',
    },
    {
      id: 3,
      title: 'Scan Parts',
      icon: Package,
      description: 'Scan all parts and quantities',
    },
    {
      id: 4,
      title: 'Package Info',
      icon: Scale,
      description: 'Enter dimensions and weight',
    },
    {
      id: 5,
      title: 'Print Label',
      icon: Printer,
      description: 'Generate shipping label',
    },
  ]

  const steps = formData.toScanState.requiresTOScanning
    ? stepsWithTO
    : baseSteps

  const handleDeliveryScan = async () => {
    // 🔒 LOCK: Check if verification already in progress - prevent concurrent verifications
    if (verificationInProgressRef.current) {
      logger.log(
        '🔒 Pack Tool: Verification already in progress, blocking concurrent attempt'
      )
      return
    }

    try {
      // 🔒 ACQUIRE LOCK
      verificationInProgressRef.current = true
      logger.log('🔓 Pack Tool: Verification lock acquired')

      // Clear any pending auto-verify timeout when manually triggered
      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
        setAutoVerifyTimeout(null)
        setIsAutoVerifyPending(false)
      }
      // 🔒 CRITICAL: Ensure auth state is fresh before database operations
      // This prevents the idle session issue where stale auth causes empty query results
      logger.log(
        '🔍 Pack Tool: Validating auth state before delivery verification...'
      )

      if (!isAuthenticated || isAuthLoading) {
        logger.log(
          '❌ Auth state invalid, cannot proceed with delivery verification'
        )
        toast.error(
          'Authentication required. Please refresh the page and try again.'
        )
        return
      }
      // Authentication validation passed

      logger.log(
        '✅ Auth state validated, proceeding with delivery verification...'
      )

      // Verify delivery exists in Supabase (trim whitespace from barcode scanner input)
      const result = await verifyDeliveryAsync(formData.deliveryId.trim())

      if (result.exists && result.deliveryData) {
        // Transform Supabase data to form items
        const transformedItems: DeliveryItem[] = result.deliveryData.map(
          (item) => ({
            id: item.id,
            material: item.material || '',
            material_description: item.material_description || '',
            expectedQuantity: item.source_target_qty || 0,
            scannedQuantity: 0,
            verified: false,
            batch: item.batch || undefined,
          })
        )

        // Update form data with TO scanning information
        setFormData((prev) => ({
          ...prev,
          items: transformedItems,
          deliveryData: result.deliveryData,
          toScanState: {
            toNumbers: result.toNumbers || [],
            scannedTOs: [],
            requiresTOScanning: result.requiresTOScanning || false,
            allTOsScanned: !result.requiresTOScanning, // If no TO scanning needed, consider it complete
          },
        }))

        // Auto-proceed to next step immediately after successful state update
        logger.log(
          '✅ Pack Tool: Delivery verification successful, data loaded. Auto-proceeding...'
        )
        logger.log(
          `📋 Delivery has ${result.toNumbers?.length || 0} TO numbers, requiresTOScanning: ${result.requiresTOScanning || false}`
        )

        // Only auto-proceed if we haven't already triggered it for this delivery
        if (!hasAutoProceedTriggered) {
          logger.log(
            '🚀 Pack Tool: Setting auto-proceed flag and advancing to next step'
          )
          setHasAutoProceedTriggered(true)

          // Use requestAnimationFrame to ensure state update is completed, then setTimeout for user feedback
          requestAnimationFrame(() => {
            setTimeout(() => {
              const nextStepName = result.requiresTOScanning
                ? 'TO Scanning'
                : 'Parts Scanning'
              logger.log(
                `🚀 Pack Tool: Auto-proceeding to step 1 (${nextStepName})`
              )

              setCurrentStep(1)
              logger.log(
                '🎯 Pack Tool: Step progression completed after verification'
              )
            }, 500) // 500ms delay to show success state
          })
        } else {
          logger.log(
            '⏭️ Pack Tool: Auto-proceed already triggered for this delivery, skipping'
          )
        }
      } else {
        logger.log(
          '❌ Pack Tool: Auto-proceed cancelled - delivery not found or verification failed'
        )
        logger.log(
          '🔄 Clearing delivery field and staying on current step for retry'
        )

        // Clear the delivery field for immediate retry
        setFormData((prev) => ({ ...prev, deliveryId: '' }))

        // Reset auto-proceed flag to allow fresh verification attempts
        setHasAutoProceedTriggered(false)

        // Clear any pending timeouts
        if (autoVerifyTimeout) {
          clearTimeout(autoVerifyTimeout)
          setAutoVerifyTimeout(null)
          setIsAutoVerifyPending(false)
        }

        // Auto-focus back to delivery field for immediate retry
        setTimeout(() => {
          const deliveryInput = document.getElementById(
            'deliveryId'
          ) as HTMLInputElement
          if (deliveryInput) {
            deliveryInput.focus()
            logger.log(
              '🎯 Pack Tool: Delivery field focused for retry after verification failure'
            )
          }
        }, 100)
      }
    } catch (error) {
      logger.error('Error verifying delivery:', error)
      logger.log('❌ Pack Tool: Auto-proceed cancelled due to error')
      // Error handling is done in the hook via toast
    } finally {
      // 🔒 RELEASE LOCK - Always release lock in finally block
      verificationInProgressRef.current = false
      logger.log('🔓 Pack Tool: Verification lock released')
    }
  }

  const handleTOScan = async () => {
    setTOScanError('')

    if (!currentTOScan.trim()) {
      setTOScanError('Please scan or enter a TO number')
      return
    }

    try {
      // Validate TO number against delivery
      const result = await validateTOAsync({
        deliveryId: formData.deliveryId,
        toNumber: currentTOScan.trim(),
      })

      if (result.isValid) {
        // Check if TO already scanned
        if (formData.toScanState.scannedTOs.includes(currentTOScan.trim())) {
          setTOScanError(
            `TO number ${currentTOScan.trim()} has already been scanned`
          )
          return
        }

        // Add TO to scanned list
        const newScannedTOs = [
          ...formData.toScanState.scannedTOs,
          currentTOScan.trim(),
        ]
        const allTOsScanned =
          newScannedTOs.length === formData.toScanState.toNumbers.length

        setFormData((prev) => ({
          ...prev,
          toScanState: {
            ...prev.toScanState,
            scannedTOs: newScannedTOs,
            allTOsScanned,
          },
        }))

        // Clear input for next scan
        setCurrentTOScan('')

        // Show completion status
        if (allTOsScanned) {
          toast.success(
            `✅ All ${formData.toScanState.toNumbers.length} TO numbers verified! Ready to scan parts.`
          )
        } else {
          toast.success(
            `✅ TO ${currentTOScan.trim()} verified! ${newScannedTOs.length}/${formData.toScanState.toNumbers.length} complete`
          )
        }

        // Auto-focus for next scan
        setTimeout(() => {
          const toInput = document.getElementById('toScan') as HTMLInputElement
          if (toInput && !allTOsScanned) {
            toInput.focus()
          }
        }, 100)
      }
    } catch (error) {
      logger.error('Error validating TO:', error)
      // Error handling is done in the hook via toast
    }
  }

  const handleMaterialScan = () => {
    // 🔒 LOCK: Check if material scan already in progress - prevent concurrent scans
    if (materialScanInProgressRef.current) {
      logger.log(
        '🔒 Pack Tool: Material scan already in progress, blocking concurrent attempt'
      )
      return
    }

    try {
      // 🔒 ACQUIRE LOCK
      materialScanInProgressRef.current = true
      logger.log('🔓 Pack Tool: Material scan lock acquired')

      setScanError('')

      if (!currentMaterialScan.trim()) {
        setScanError('Please scan or enter a material number')

        // Auto-focus back to material field
        setTimeout(() => {
          const scanInput = document.getElementById(
            'materialScan'
          ) as HTMLInputElement
          if (scanInput) {
            scanInput.focus()
            logger.log('🎯 Pack Tool: Material field focused - was empty')
          }
        }, 100)

        toast.error('❌ Please scan a material number first')
        return
      }

      // Find the FIRST INCOMPLETE material that matches the scanned material number
      // This ensures we handle materials split across multiple line items/locations correctly
      const matchingItem = formData.items.find(
        (item) => item.material === currentMaterialScan.trim() && !item.verified
      )

      if (!matchingItem) {
        // Check if this material exists but all line items are already complete
        const materialExists = formData.items.some(
          (item) => item.material === currentMaterialScan.trim()
        )
        const expectedMaterials = formData.items
          .map((item) => item.material)
          .join(', ')

        if (materialExists) {
          setScanError(
            `All line items for material ${currentMaterialScan} are already complete`
          )
          toast.warning(
            `⚠️ Material ${currentMaterialScan.trim()} already complete. Scan a different material.`
          )
        } else {
          setScanError(
            `Material ${currentMaterialScan} not found in this delivery. Expected materials: ${expectedMaterials}`
          )
          toast.error(`❌ Material not found. Expected: ${expectedMaterials}`)
        }

        // Auto-clear the material field for immediate re-scanning
        logger.log(
          `❌ Pack Tool: Material ${currentMaterialScan} not found or already complete, clearing field for re-scan`
        )
        setCurrentMaterialScan('')

        // Clear any pending auto-scan timeouts
        if (autoScanTimeout) {
          clearTimeout(autoScanTimeout)
          setAutoScanTimeout(null)
          setIsAutoScanPending(false)
        }

        // Auto-focus back to material field for immediate correction
        setTimeout(() => {
          const scanInput = document.getElementById(
            'materialScan'
          ) as HTMLInputElement
          if (scanInput) {
            scanInput.focus()
            logger.log('🎯 Pack Tool: Material field focused for correction')
          }
        }, 100)

        // Show helpful toast with expected materials
        toast.error(`❌ Material not found. Expected: ${expectedMaterials}`)
        return
      }

      // Material validated successfully - now jump to quantity field
      logger.log(
        `✅ Pack Tool: Material ${currentMaterialScan.trim()} validated successfully`
      )
      logger.log(
        `📊 Current progress: ${matchingItem.scannedQuantity}/${matchingItem.expectedQuantity} pieces`
      )

      // Jump to quantity field and clear it for barcode scanning
      // NOTE: Do NOT clear material field yet - keep it for quantity addition
      logger.log('🎯 Pack Tool: Jumping to quantity field for barcode scanning')
      setCurrentQuantity('') // Clear quantity for fresh scanning

      // Auto-focus quantity field after material validation
      setTimeout(() => {
        const quantityInput = document.getElementById(
          'quantityScan'
        ) as HTMLInputElement
        if (quantityInput) {
          quantityInput.focus()
          quantityInput.select() // Select all text for easy replacement
          logger.log(
            '✅ Pack Tool: Quantity field focused and ready for scanning'
          )
        }
      }, 100)

      // Show material validation feedback
      toast.success(
        `✅ Material ${currentMaterialScan.trim()} ready! Scan quantity now.`
      )
    } finally {
      // 🔒 RELEASE LOCK - Always release lock in finally block
      materialScanInProgressRef.current = false
      logger.log('🔓 Pack Tool: Material scan lock released')
    }
  }

  const handleQuantityScan = () => {
    setScanError('')

    if (!currentMaterialScan.trim()) {
      setScanError('Please scan a material first')

      // Auto-clear quantity field and return to material scanning
      logger.log(
        '❌ Pack Tool: No material scanned, clearing quantity and returning to material field'
      )
      setCurrentQuantity('')

      // Clear any pending auto-scan timeouts
      if (autoScanTimeout) {
        clearTimeout(autoScanTimeout)
        setAutoScanTimeout(null)
        setIsAutoScanPending(false)
      }

      // Auto-focus back to material field
      setTimeout(() => {
        const scanInput = document.getElementById(
          'materialScan'
        ) as HTMLInputElement
        if (scanInput) {
          scanInput.focus()
          logger.log(
            '🎯 Pack Tool: Material field focused - no material was scanned'
          )
        }
      }, 100)

      toast.error('❌ Please scan a material first')
      return
    }

    const quantityToAdd = parseInt(currentQuantity)
    if (isNaN(quantityToAdd) || quantityToAdd <= 0) {
      setScanError('Quantity must be a valid number greater than 0')

      // Auto-clear the quantity field for immediate re-scanning
      logger.log(
        `❌ Pack Tool: Invalid quantity ${currentQuantity}, clearing field for re-scan`
      )
      setCurrentQuantity('')

      // Clear any pending auto-scan timeouts
      if (autoScanTimeout) {
        clearTimeout(autoScanTimeout)
        setAutoScanTimeout(null)
        setIsAutoScanPending(false)
      }

      // Auto-focus back to quantity field for immediate correction
      setTimeout(() => {
        const quantityInput = document.getElementById(
          'quantityScan'
        ) as HTMLInputElement
        if (quantityInput) {
          quantityInput.focus()
          quantityInput.select()
          logger.log(
            '🎯 Pack Tool: Quantity field focused for correction after invalid input'
          )
        }
      }, 100)

      toast.error('❌ Invalid quantity. Please scan a valid number.')
      return
    }

    // Find the FIRST INCOMPLETE line item for the scanned material
    // This handles materials split across multiple line items/locations correctly
    const matchingItem = formData.items.find(
      (item) => item.material === currentMaterialScan.trim() && !item.verified
    )

    if (!matchingItem) {
      setScanError(
        'Material validation lost or already complete. Please scan material again.'
      )

      // Auto-clear both fields and return to material scanning
      logger.log(
        '❌ Pack Tool: Material validation lost or already complete, clearing fields for fresh start'
      )
      setCurrentMaterialScan('')
      setCurrentQuantity('')

      // Auto-focus back to material field
      setTimeout(() => {
        const scanInput = document.getElementById(
          'materialScan'
        ) as HTMLInputElement
        if (scanInput) {
          scanInput.focus()
          logger.log(
            '🎯 Pack Tool: Material field focused after validation loss'
          )
        }
      }, 100)

      toast.error(
        '❌ Material validation lost or already complete. Scan material again.'
      )
      return
    }

    // Check if adding this quantity would exceed THIS line item's expected quantity
    const newTotal = matchingItem.scannedQuantity + quantityToAdd
    const remainingQuantity =
      matchingItem.expectedQuantity - matchingItem.scannedQuantity

    if (newTotal > matchingItem.expectedQuantity) {
      setScanError(
        `Cannot add ${quantityToAdd} pieces. Only ${remainingQuantity} pieces remaining for this line item of ${currentMaterialScan}`
      )

      // Auto-clear the quantity field for immediate re-scanning
      logger.log(
        `❌ Pack Tool: Quantity ${quantityToAdd} too large for line item ${matchingItem.id}, clearing quantity field for re-scan`
      )
      setCurrentQuantity('')

      // Clear any pending auto-scan timeouts
      if (autoScanTimeout) {
        clearTimeout(autoScanTimeout)
        setAutoScanTimeout(null)
        setIsAutoScanPending(false)
      }

      // Auto-focus back to quantity field for immediate correction
      setTimeout(() => {
        const quantityInput = document.getElementById(
          'quantityScan'
        ) as HTMLInputElement
        if (quantityInput) {
          quantityInput.focus()
          quantityInput.select()
          logger.log('🎯 Pack Tool: Quantity field focused for correction')
        }
      }, 100)

      // Show helpful toast with remaining quantity
      toast.error(
        `❌ Quantity too large. Only ${remainingQuantity} pieces remaining for this line item`
      )
      return
    }

    // ✅ FIX: Update ONLY the specific line item by ID (not all items with same material)
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === matchingItem.id // Match by ID, not material number
          ? {
              ...item,
              scannedQuantity: newTotal,
              verified: newTotal === item.expectedQuantity,
            }
          : item
      ),
    }))

    // Store material number before clearing for feedback
    const materialNumber = currentMaterialScan.trim()
    const isCurrentMaterialComplete = newTotal === matchingItem.expectedQuantity

    // Clear quantity field always
    setCurrentQuantity('')

    // Show success feedback
    if (isCurrentMaterialComplete) {
      toast.success(
        `✅ Material ${materialNumber} completed! Added ${quantityToAdd} pieces (${newTotal}/${matchingItem.expectedQuantity})`
      )
    } else {
      toast.success(
        `📦 Material ${materialNumber} scanned! Added ${quantityToAdd} pieces (${newTotal}/${matchingItem.expectedQuantity}) - scan any material next`
      )
    }

    // Check if all items are now verified after this scan
    const updatedItems = formData.items.map((item) =>
      item.id === matchingItem.id
        ? {
            ...item,
            scannedQuantity: newTotal,
            verified: newTotal === item.expectedQuantity,
          }
        : item
    )
    const allItemsNowVerified = updatedItems.every((item) => item.verified)

    if (allItemsNowVerified) {
      // All materials completed - clear material field and ready for next step
      logger.log('🎉 Pack Tool: All materials completed! Ready for next step.')
      setCurrentMaterialScan('')
    } else {
      // More materials to scan OR current material needs more quantity
      // Always clear material field to give user flexibility to scan any material
      logger.log(
        '📦 Pack Tool: More scanning needed - clearing material field for user choice'
      )
      setCurrentMaterialScan('')

      if (isCurrentMaterialComplete) {
        logger.log(
          `✅ Material ${materialNumber} completed! User can now scan any material.`
        )
      } else {
        logger.log(
          `📦 Material ${materialNumber} incomplete (${newTotal}/${matchingItem.expectedQuantity}) - user can scan same material again or switch to different material.`
        )
      }

      // Always jump back to material field for maximum flexibility
      setTimeout(() => {
        const scanInput = document.getElementById(
          'materialScan'
        ) as HTMLInputElement
        if (scanInput) {
          scanInput.focus()
          logger.log(
            '✅ Pack Tool: Material field focused - user can scan any material'
          )
        }
      }, 100)
    }
  }

  const handlePackageDataChange = (field: keyof PackageData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      packageData: { ...prev.packageData, [field]: value },
    }))
  }

  // Print label functionality extracted from ShippingLabel component
  const printShippingLabel = useCallback(() => {
    const printWindow = window.open('', '_blank', 'width=400,height=100')
    if (printWindow) {
      const currentUser = authState.profile?.username || 'System'
      const currentTime = new Date().toLocaleString()

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OmniFrame - Shipping Label</title>
            <style>
              @media print {
                body {
                  margin: 0;
                  padding: 0;
                }
                .label-container {
                  width: 4in;
                  height: 1in;
                  padding: 0.075in;
                  box-sizing: border-box;
                  page-break-after: always;
                }
              }
              @media screen {
                body {
                  margin: 20px;
                  background: #f5f5f5;
                }
                .label-container {
                  width: 4in;
                  height: 1in;
                  padding: 0.075in;
                  box-sizing: border-box;
                  border: 1px dashed #ccc;
                  background: white;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
              }
              .label-content {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 0.08in;
                height: 100%;
                font-family: 'Courier New', monospace;
                font-size: 12pt;
                font-weight: bold;
                line-height: 1.1;
              }
              .delivery-row {
                margin-top: 0.1in;
                font-size: 18pt;
                margin-bottom: 0.05in;
              }
              .left-section {
                display: flex;
                flex-direction: column;
                justify-content: space-between;
              }
              .right-section {
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                text-align: right;
              }
              .label-row {
                margin-bottom: 0.015in;
              }
              .label-field {
                font-weight: bold;
                color: #4a5568;
              }
              .label-value {
                color: #2d3748;
              }
            </style>
          </head>
          <body>
            <div class="label-container">
              <div class="label-content">
                <div class="left-section">
                  <div class="delivery-row">
                    <span class="label-field">Delivery:</span>
                    <span class="label-value">${formData.deliveryId}</span>
                  </div>
                  <div class="label-row">
                    <span class="label-field">Weight:</span>
                    <span class="label-value">${formData.packageData.weight} lbs</span>
                  </div>
                </div>
                <div class="right-section">
                  <div class="label-row">
                    <span class="label-field">Dimensions:</span>
                  </div>
                  <div class="label-row">
                    <span class="label-value">L:${formData.packageData.length} W:${formData.packageData.width} H:${formData.packageData.height} cm</span>
                  </div>
                  <div class="label-row">
                    <span class="label-field">By:</span>
                    <span class="label-value">${currentUser}</span>
                  </div>
                  <div class="label-row">
                    <span class="label-field">Time:</span>
                    <span class="label-value">${currentTime}</span>
                  </div>
                </div>
              </div>
            </div>

            <script>
              window.onload = function() {
                // Auto-print after a short delay
                setTimeout(function() {
                  if (window.print) {
                    window.print();
                  }
                }, 500);
              };
            </script>
          </body>
        </html>
      `)
      printWindow.document.close()
    }
  }, [formData.deliveryId, formData.packageData, authState.profile?.username])

  const handlePrintLabel = async () => {
    try {
      // First update packing information
      await updatePackingInfoAsync({
        deliveryId: formData.deliveryId,
        packingData: {
          package_length: parseFloat(formData.packageData.length),
          package_width: parseFloat(formData.packageData.width),
          package_height: parseFloat(formData.packageData.height),
          package_weight: parseFloat(formData.packageData.weight),
        },
      })

      // Then complete the packing process (sets status to 'packed' and label_printed_at)
      await completePackingAsync(formData.deliveryId)

      // Update form state
      setFormData((prev) => ({ ...prev, labelGenerated: true }))
      setCurrentStep(3)

      // Now print the label after successful database operations
      printShippingLabel()

      logger.log('✅ Pack Tool: Label generated and printing initiated')
    } catch (error) {
      logger.error('Error printing label:', error)
      // Error handling is done in the hook via toast
    }
  }

  const allItemsVerified =
    formData.items.length > 0 && formData.items.every((item) => item.verified)
  const packageDataComplete = Object.values(formData.packageData).every(
    (value) => value.trim() !== ''
  )

  const canProceedToNext = () => {
    if (formData.toScanState.requiresTOScanning) {
      // With TO scanning workflow
      switch (currentStep) {
        case 0:
          return formData.items.length > 0 // Delivery verified
        case 1:
          return formData.toScanState.allTOsScanned // All TOs scanned
        case 2:
          return allItemsVerified // All materials scanned
        case 3:
          return packageDataComplete // Package info complete
        default:
          return false
      }
    } else {
      // Original workflow without TO scanning
      switch (currentStep) {
        case 0:
          return formData.items.length > 0 // Delivery verified
        case 1:
          return allItemsVerified // All materials scanned
        case 2:
          return packageDataComplete // Package info complete
        default:
          return false
      }
    }
  }

  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.2 } },
  }

  return (
    <div className='mx-auto w-full max-w-4xl space-y-8 p-6'>
      {/* Progress Stepper */}
      <Stepper value={currentStep} className='w-full'>
        {steps.map((step, index) => (
          <StepperItem
            key={step.id}
            step={index}
            completed={index < currentStep}
            className='[&:not(:last-child)]:flex-1'
          >
            <div className='flex flex-col items-center space-y-2'>
              <StepperIndicator
                data-state={
                  index < currentStep
                    ? 'completed'
                    : index === currentStep
                      ? 'active'
                      : 'inactive'
                }
              >
                {index < currentStep ? (
                  <CheckCircle className='h-5 w-5' />
                ) : (
                  <step.icon className='h-5 w-5' />
                )}
              </StepperIndicator>
              <div className='text-center'>
                <div className='text-sm font-medium'>{step.title}</div>
                <div className='text-muted-foreground text-xs'>
                  {step.description}
                </div>
              </div>
            </div>
            {index < steps.length - 1 && (
              <StepperSeparator
                data-state={index < currentStep ? 'completed' : 'inactive'}
                className='mx-4'
              />
            )}
          </StepperItem>
        ))}
      </Stepper>

      {/* Step Content */}
      <Card className='min-h-[400px]'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            {React.createElement(steps[currentStep].icon, {
              className: 'h-6 w-6',
            })}
            {steps[currentStep].title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode='wait'>
            <motion.div
              key={currentStep}
              initial='hidden'
              animate='visible'
              exit='exit'
              variants={contentVariants}
              className='space-y-6'
            >
              {/* Step 1: Scan Delivery */}
              {currentStep === 0 && (
                <div className='space-y-4'>
                  <div className='space-y-4 text-center'>
                    <Scan className='text-muted-foreground mx-auto h-16 w-16' />
                    <h3 className='text-lg font-semibold'>
                      Scan Delivery Barcode
                    </h3>
                    <p className='text-muted-foreground'>
                      Scan or enter the delivery ID to verify delivery exists
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='deliveryId'>Delivery ID</Label>
                      <Input
                        id='deliveryId'
                        placeholder='Scan or enter delivery ID'
                        value={formData.deliveryId}
                        onChange={(e) => {
                          const newValue = e.target.value
                          setFormData((prev) => ({
                            ...prev,
                            deliveryId: newValue,
                          }))

                          // Reset auto-proceed flag when user changes delivery ID
                          setHasAutoProceedTriggered(false)

                          // Clear any pending auto-verify timeout
                          if (autoVerifyTimeout) {
                            clearTimeout(autoVerifyTimeout)
                            setAutoVerifyTimeout(null)
                          }
                          setIsAutoVerifyPending(false)

                          logger.log(
                            `📝 Pack Tool: Delivery ID changed to: ${newValue}`
                          )
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === 'Enter' &&
                            formData.deliveryId &&
                            !isVerifyingDelivery &&
                            !isAuthLoading
                          ) {
                            e.preventDefault()

                            // Clear auto-verify timeout when user manually triggers with Enter
                            if (autoVerifyTimeout) {
                              clearTimeout(autoVerifyTimeout)
                              setAutoVerifyTimeout(null)
                              setIsAutoVerifyPending(false)
                            }

                            handleDeliveryScan()
                          }
                        }}
                        className='text-center text-lg'
                        autoFocus
                      />
                    </div>

                    <Button
                      onClick={handleDeliveryScan}
                      disabled={
                        !formData.deliveryId ||
                        isVerifyingDelivery ||
                        isAuthLoading
                      }
                      className='w-full'
                      size='lg'
                      variant={isAutoVerifyPending ? 'outline' : 'default'}
                    >
                      {isVerifyingDelivery || isAuthLoading ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          {isAuthLoading
                            ? 'Refreshing session...'
                            : 'Verifying...'}
                        </>
                      ) : isAutoVerifyPending ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          Verifying...
                        </>
                      ) : (
                        <>
                          <Scan className='mr-2 h-4 w-4' />
                          Verify Delivery
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Scan Transfer Orders (conditional) */}
              {currentStep === 1 && formData.toScanState.requiresTOScanning && (
                <div className='space-y-4'>
                  <div className='space-y-4 text-center'>
                    <FileEdit className='text-muted-foreground mx-auto h-16 w-16' />
                    <h3 className='text-lg font-semibold'>
                      Scan Transfer Order Numbers
                    </h3>
                    <p className='text-muted-foreground'>
                      This delivery has {formData.toScanState.toNumbers.length}{' '}
                      TO numbers. Scan each TO number to continue.
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='toScan'>Transfer Order Number</Label>
                      <Input
                        id='toScan'
                        placeholder='Scan or enter TO number'
                        value={currentTOScan}
                        onChange={(e) => setCurrentTOScan(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleTOScan()
                          } else if (e.key === 'Escape') {
                            setCurrentTOScan('')
                            setTOScanError('')
                          }
                        }}
                        className='text-center font-mono text-lg'
                        autoFocus
                        disabled={isValidatingTO}
                      />
                    </div>

                    <Button
                      onClick={handleTOScan}
                      disabled={!currentTOScan.trim() || isValidatingTO}
                      className='w-full'
                      size='lg'
                    >
                      {isValidatingTO ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          Verifying TO...
                        </>
                      ) : (
                        <>
                          <FileEdit className='mr-2 h-4 w-4' />
                          Verify TO Number
                        </>
                      )}
                    </Button>

                    {toScanError && (
                      <p className='rounded border border-red-200 bg-red-50 p-2 text-sm text-red-600'>
                        {toScanError}
                      </p>
                    )}
                  </div>

                  {/* TO Progress Display */}
                  <div className='space-y-4'>
                    <h4 className='text-center font-medium'>
                      Transfer Orders Progress
                    </h4>
                    <div className='space-y-3'>
                      {formData.toScanState.toNumbers.map((toNumber) => {
                        const isScanned =
                          formData.toScanState.scannedTOs.includes(toNumber)
                        return (
                          <div key={toNumber} className='rounded-lg border p-4'>
                            <div className='flex items-center justify-between'>
                              <div className='flex items-center gap-3'>
                                {isScanned ? (
                                  <CheckCircle className='h-6 w-6 text-green-500' />
                                ) : (
                                  <AlertCircle className='h-6 w-6 text-gray-400' />
                                )}
                                <div>
                                  <div className='font-mono text-lg font-medium'>
                                    {toNumber}
                                  </div>
                                  <div className='text-muted-foreground text-sm'>
                                    Transfer Order Number
                                  </div>
                                </div>
                              </div>
                              <div
                                className={cn(
                                  'rounded px-3 py-1 text-sm font-medium',
                                  isScanned
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-500'
                                )}
                              >
                                {isScanned ? 'Verified' : 'Pending'}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Overall Progress */}
                    <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30'>
                      <div className='mb-2 flex items-center justify-between'>
                        <span className='text-sm font-medium text-blue-700 dark:text-blue-300'>
                          Overall Progress
                        </span>
                        <span className='text-sm text-blue-600 dark:text-blue-400'>
                          {formData.toScanState.scannedTOs.length} /{' '}
                          {formData.toScanState.toNumbers.length} TOs verified
                        </span>
                      </div>
                      <div className='h-3 w-full rounded-full bg-blue-200 dark:bg-blue-900'>
                        <div
                          className='h-3 rounded-full bg-blue-500 transition-all duration-300 dark:bg-blue-400'
                          style={{
                            width: `${(formData.toScanState.scannedTOs.length / formData.toScanState.toNumbers.length) * 100}%`,
                          }}
                        />
                      </div>
                      {formData.toScanState.allTOsScanned && (
                        <p className='mt-2 text-sm font-medium text-blue-700 dark:text-blue-300'>
                          ✅ All TO numbers verified! Ready to proceed to parts
                          scanning.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2/3: Scan Parts (depends on TO scanning) */}
              {((currentStep === 1 &&
                !formData.toScanState.requiresTOScanning) ||
                (currentStep === 2 &&
                  formData.toScanState.requiresTOScanning)) && (
                <div className='space-y-6'>
                  <div className='space-y-2 text-center'>
                    <Package className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>Scan All Parts</h3>
                    <p className='text-muted-foreground'>
                      Scan material barcode → then scan quantity barcode.
                    </p>

                    {/* Overall Progress Summary */}
                    <div className='mt-4 rounded-lg border bg-gray-50 p-3 dark:bg-gray-800'>
                      <div className='flex items-center justify-center gap-4 text-sm'>
                        <div className='flex items-center gap-1'>
                          <CheckCircle className='h-4 w-4 text-green-500' />
                          <span className='text-gray-900 dark:text-gray-100'>
                            Verified:{' '}
                            {
                              formData.items.filter((item) => item.verified)
                                .length
                            }
                          </span>
                        </div>
                        <div className='flex items-center gap-1'>
                          <Package className='h-4 w-4 text-gray-500' />
                          <span className='text-gray-900 dark:text-gray-100'>
                            Total Materials: {formData.items.length}
                          </span>
                        </div>
                        <div className='flex items-center gap-1'>
                          <Plus className='h-4 w-4 text-blue-500' />
                          <span className='text-gray-900 dark:text-gray-100'>
                            Total Scanned:{' '}
                            {formData.items.reduce(
                              (sum, item) => sum + item.scannedQuantity,
                              0
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Material Scanning Interface */}
                  <div className='mx-auto max-w-lg space-y-4'>
                    <div className='space-y-4'>
                      <div className='grid grid-cols-1 gap-4'>
                        {/* Material Number Input */}
                        <div className='space-y-2'>
                          <Label htmlFor='materialScan'>Material Number</Label>
                          <Input
                            id='materialScan'
                            placeholder='Scan material barcode'
                            value={currentMaterialScan}
                            onChange={(e) => {
                              setCurrentMaterialScan(e.target.value)
                              // Clear auto-scan timeout when user types
                              if (autoScanTimeout) {
                                clearTimeout(autoScanTimeout)
                                setAutoScanTimeout(null)
                                setIsAutoScanPending(false)
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                // Clear auto-scan timeout when manually triggered
                                if (autoScanTimeout) {
                                  clearTimeout(autoScanTimeout)
                                  setAutoScanTimeout(null)
                                  setIsAutoScanPending(false)
                                }
                                handleMaterialScan()
                              } else if (e.key === 'Escape') {
                                setCurrentMaterialScan('')
                                setCurrentQuantity('')
                                setScanError('')
                                // Clear timeouts on escape
                                if (autoScanTimeout) {
                                  clearTimeout(autoScanTimeout)
                                  setAutoScanTimeout(null)
                                  setIsAutoScanPending(false)
                                }
                              }
                            }}
                            className='text-center font-mono text-lg'
                            autoFocus
                          />
                        </div>

                        {/* Quantity Input */}
                        <div className='space-y-2'>
                          <Label htmlFor='quantityScan'>
                            Quantity in this Box
                          </Label>
                          <Input
                            id='quantityScan'
                            type='number'
                            min='1'
                            placeholder='Scan quantity'
                            value={currentQuantity}
                            onChange={(e) => {
                              setCurrentQuantity(e.target.value)
                              // Clear auto-scan timeout when user types
                              if (autoScanTimeout) {
                                clearTimeout(autoScanTimeout)
                                setAutoScanTimeout(null)
                                setIsAutoScanPending(false)
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                if (currentMaterialScan.trim()) {
                                  // Clear auto-scan timeout when manually triggered
                                  if (autoScanTimeout) {
                                    clearTimeout(autoScanTimeout)
                                    setAutoScanTimeout(null)
                                    setIsAutoScanPending(false)
                                  }
                                  handleQuantityScan()
                                } else {
                                  setScanError('Please scan material first')
                                }
                              }
                            }}
                            className='text-center text-lg'
                          />
                        </div>
                      </div>

                      {/* Dynamic Scan Button */}
                      <Button
                        onClick={() => {
                          if (!currentMaterialScan.trim()) {
                            setScanError('Please scan material first')
                          } else if (!currentQuantity.trim()) {
                            setScanError('Please scan quantity')
                          } else {
                            // Clear auto-scan timeout when manually triggered
                            if (autoScanTimeout) {
                              clearTimeout(autoScanTimeout)
                              setAutoScanTimeout(null)
                              setIsAutoScanPending(false)
                            }
                            handleQuantityScan()
                          }
                        }}
                        disabled={
                          !currentMaterialScan.trim() || !currentQuantity.trim()
                        }
                        className='w-full'
                        size='lg'
                        variant={isAutoScanPending ? 'outline' : 'default'}
                      >
                        {isAutoScanPending ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            {currentMaterialScan.trim() &&
                            !currentQuantity.trim()
                              ? 'Validating material...'
                              : 'Adding quantity...'}
                          </>
                        ) : (
                          <>
                            <Scan className='mr-2 h-4 w-4' />
                            {!currentMaterialScan.trim()
                              ? 'Scan Material First'
                              : !currentQuantity.trim()
                                ? 'Scan Quantity'
                                : `Add ${currentQuantity} piece${(parseInt(currentQuantity) || 1) !== 1 ? 's' : ''}`}
                          </>
                        )}
                      </Button>

                      {scanError && (
                        <p className='rounded border border-red-200 bg-red-50 p-2 text-sm text-red-600'>
                          {scanError}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Materials Progress Display */}
                  <div className='space-y-4'>
                    {formData.items.map((item) => (
                      <div
                        key={item.id}
                        className='space-y-3 rounded-lg border p-4'
                      >
                        <div className='flex items-center justify-between'>
                          <div className='flex-1'>
                            <div className='flex items-center gap-2'>
                              <h4 className='text-base font-medium'>
                                {item.material}
                              </h4>
                              {item.verified ? (
                                <CheckCircle className='h-5 w-5 text-green-500' />
                              ) : item.scannedQuantity > 0 ? (
                                <Target className='h-5 w-5 text-yellow-500' />
                              ) : (
                                <AlertCircle className='h-5 w-5 text-gray-400' />
                              )}
                            </div>
                            <p className='text-muted-foreground text-sm'>
                              {item.material_description}
                            </p>
                            {item.batch && (
                              <p className='text-muted-foreground text-xs'>
                                Batch: {item.batch}
                              </p>
                            )}
                          </div>

                          <div className='text-right'>
                            <div
                              className={cn(
                                'text-lg font-bold',
                                item.verified
                                  ? 'text-green-600'
                                  : item.scannedQuantity > 0
                                    ? 'text-yellow-600'
                                    : 'text-gray-400'
                              )}
                            >
                              {item.scannedQuantity} / {item.expectedQuantity}
                            </div>
                            <p className='text-muted-foreground text-xs'>
                              {item.expectedQuantity - item.scannedQuantity}{' '}
                              remaining
                            </p>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className='h-2 w-full rounded-full bg-gray-200'>
                          <div
                            className={cn(
                              'h-2 rounded-full transition-all duration-300',
                              item.verified
                                ? 'bg-green-500'
                                : item.scannedQuantity > 0
                                  ? 'bg-yellow-500'
                                  : 'bg-gray-300'
                            )}
                            style={{
                              width: `${Math.min((item.scannedQuantity / item.expectedQuantity) * 100, 100)}%`,
                            }}
                          />
                        </div>

                        {/* Scanning Status */}
                        {item.verified ? (
                          <div className='rounded border border-green-200 bg-green-50 p-2 text-center dark:border-green-800 dark:bg-green-950/30'>
                            <p className='text-sm font-medium text-green-700 dark:text-green-300'>
                              ✅ Complete - All {item.expectedQuantity} pieces
                              verified
                            </p>
                          </div>
                        ) : (
                          <div className='rounded border border-blue-200 bg-blue-50 p-3 text-center dark:border-blue-800 dark:bg-blue-950/30'>
                            <p className='text-sm text-blue-700 dark:text-blue-300'>
                              <Scan className='mr-1 inline h-4 w-4' />
                              Scan material{' '}
                              <span className='font-mono font-bold'>
                                {item.material}
                              </span>
                            </p>
                            <p className='mt-1 text-xs text-blue-600 dark:text-blue-400'>
                              Need{' '}
                              {item.expectedQuantity - item.scannedQuantity}{' '}
                              more piece
                              {item.expectedQuantity - item.scannedQuantity !==
                              1
                                ? 's'
                                : ''}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3/4: Package Dimensions (depends on TO scanning) */}
              {((currentStep === 2 &&
                !formData.toScanState.requiresTOScanning) ||
                (currentStep === 3 &&
                  formData.toScanState.requiresTOScanning)) && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <Scale className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Package Information
                    </h3>
                    <p className='text-muted-foreground'>
                      Enter the dimensions and weight of the packed item
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='grid grid-cols-3 gap-4'>
                      <div className='space-y-2'>
                        <Label htmlFor='length'>Length (cm)</Label>
                        <Input
                          id='length'
                          type='number'
                          placeholder='0'
                          value={formData.packageData.length}
                          onChange={(e) =>
                            handlePackageDataChange('length', e.target.value)
                          }
                        />
                      </div>
                      <div className='space-y-2'>
                        <Label htmlFor='width'>Width (cm)</Label>
                        <Input
                          id='width'
                          type='number'
                          placeholder='0'
                          value={formData.packageData.width}
                          onChange={(e) =>
                            handlePackageDataChange('width', e.target.value)
                          }
                        />
                      </div>
                      <div className='space-y-2'>
                        <Label htmlFor='height'>Height (cm)</Label>
                        <Input
                          id='height'
                          type='number'
                          placeholder='0'
                          value={formData.packageData.height}
                          onChange={(e) =>
                            handlePackageDataChange('height', e.target.value)
                          }
                        />
                      </div>
                    </div>

                    <div className='space-y-2'>
                      <Label htmlFor='weight'>Weight (lbs)</Label>
                      <Input
                        id='weight'
                        type='number'
                        step='0.1'
                        placeholder='0.0'
                        value={formData.packageData.weight}
                        onChange={(e) =>
                          handlePackageDataChange('weight', e.target.value)
                        }
                      />
                    </div>

                    {packageDataComplete && (
                      <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 text-center dark:border-blue-800 dark:bg-blue-950/30'>
                        <p className='font-medium text-blue-700 dark:text-blue-300'>
                          Package information complete!
                        </p>
                        <p className='mt-1 text-sm text-blue-600 dark:text-blue-400'>
                          {formData.packageData.length} ×{' '}
                          {formData.packageData.width} ×{' '}
                          {formData.packageData.height} cm,{' '}
                          {formData.packageData.weight} lbs
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 4/5: Print Label (depends on TO scanning) */}
              {((currentStep === 3 &&
                !formData.toScanState.requiresTOScanning) ||
                (currentStep === 4 &&
                  formData.toScanState.requiresTOScanning)) && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <Printer className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Generate Shipping Label
                    </h3>
                    <p className='text-muted-foreground'>
                      Review the package details and generate the shipping label
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    {/* Package Summary */}
                    <div className='space-y-3 rounded-lg border p-4'>
                      <h4 className='font-medium'>Package Summary</h4>
                      <div className='space-y-2 text-sm'>
                        <div className='flex justify-between'>
                          <span>Delivery ID:</span>
                          <span className='font-mono'>
                            {formData.deliveryId}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Items:</span>
                          <span>{formData.items.length} types</span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Dimensions:</span>
                          <span>
                            {formData.packageData.length}×
                            {formData.packageData.width}×
                            {formData.packageData.height} cm
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Weight:</span>
                          <span>{formData.packageData.weight} lbs</span>
                        </div>
                      </div>
                    </div>

                    {/* 4x1 Shipping Label */}
                    <ShippingLabel
                      deliveryId={formData.deliveryId}
                      dimensions={{
                        length: formData.packageData.length,
                        width: formData.packageData.width,
                        height: formData.packageData.height,
                      }}
                      weight={formData.packageData.weight}
                      printedBy={authState.profile?.username || undefined}
                      printedAt={new Date().toISOString()}
                    />

                    {!formData.labelGenerated ? (
                      <Button
                        onClick={handlePrintLabel}
                        disabled={isCompletingPacking}
                        className='w-full'
                        size='lg'
                      >
                        {isCompletingPacking ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            Generating 4×1 Label...
                          </>
                        ) : (
                          <>
                            <Printer className='mr-2 h-4 w-4' />
                            Generate & Print 4×1 Label
                          </>
                        )}
                      </Button>
                    ) : (
                      <div className='rounded-lg border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950/30'>
                        <CheckCircle className='mx-auto mb-4 h-12 w-12 text-green-500 dark:text-green-400' />
                        <h4 className='mb-2 font-medium text-green-700 dark:text-green-300'>
                          4×1 Label Generated Successfully!
                        </h4>
                        <p className='mb-4 text-sm text-green-600 dark:text-green-400'>
                          The shipping label has been generated and is ready for
                          printing.
                        </p>
                        <Button
                          onClick={() => {
                            setCurrentStep(0)
                            setCurrentMaterialScan('')
                            setCurrentQuantity('')
                            setScanError('')
                            setCurrentTOScan('')
                            setTOScanError('')
                            setHasAutoProceedTriggered(false) // Reset auto-proceed flag for new package

                            // Clear all timeouts for fresh start
                            if (autoVerifyTimeout) {
                              clearTimeout(autoVerifyTimeout)
                              setAutoVerifyTimeout(null)
                            }
                            if (autoScanTimeout) {
                              clearTimeout(autoScanTimeout)
                              setAutoScanTimeout(null)
                            }
                            setIsAutoVerifyPending(false)
                            setIsAutoScanPending(false)
                            setFormData({
                              deliveryId: '',
                              items: [],
                              packageData: {
                                length: '',
                                width: '',
                                height: '',
                                weight: '',
                              },
                              labelGenerated: false,
                              toScanState: {
                                toNumbers: [],
                                scannedTOs: [],
                                requiresTOScanning: false,
                                allTOsScanned: false,
                              },
                            })
                          }}
                          variant='outline'
                          className='w-full'
                        >
                          Start New Package
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Navigation */}
      {currentStep < steps.length - 1 && !formData.labelGenerated && (
        <div className='flex justify-between'>
          <Button
            variant='outline'
            onClick={() => {
              const newStep = Math.max(0, currentStep - 1)
              setCurrentStep(newStep)
              // Clear scan state when navigating
              setCurrentMaterialScan('')
              setCurrentQuantity('')
              setScanError('')
              setCurrentTOScan('')
              setTOScanError('')

              // Clear auto-scan timeouts
              if (autoScanTimeout) {
                clearTimeout(autoScanTimeout)
                setAutoScanTimeout(null)
                setIsAutoScanPending(false)
              }

              // When going back to step 0, clear everything for fresh start
              if (newStep === 0) {
                logger.log(
                  '🔄 Pack Tool: Navigating back to step 0 - clearing delivery field for fresh start'
                )

                // Clear auto-verify timeout
                if (autoVerifyTimeout) {
                  clearTimeout(autoVerifyTimeout)
                  setAutoVerifyTimeout(null)
                }
                setIsAutoVerifyPending(false)
                setHasAutoProceedTriggered(false)

                // Clear the entire form data to prevent auto-verification with old delivery ID
                setFormData({
                  deliveryId: '',
                  items: [],
                  packageData: {
                    length: '',
                    width: '',
                    height: '',
                    weight: '',
                  },
                  labelGenerated: false,
                  toScanState: {
                    toNumbers: [],
                    scannedTOs: [],
                    requiresTOScanning: false,
                    allTOsScanned: false,
                  },
                })
              }
            }}
            disabled={currentStep === 0}
          >
            <ChevronLeft className='mr-2 h-4 w-4' />
            Back
          </Button>

          <Button
            onClick={() => {
              const maxStep = steps.length - 1
              const newStep = Math.min(maxStep, currentStep + 1)
              setCurrentStep(newStep)
              // Clear scan state when navigating
              setCurrentMaterialScan('')
              setCurrentQuantity('')
              setScanError('')
              setCurrentTOScan('')
              setTOScanError('')

              // Clear auto-scan timeouts
              if (autoScanTimeout) {
                clearTimeout(autoScanTimeout)
                setAutoScanTimeout(null)
                setIsAutoScanPending(false)
              }

              // When going back to step 0 via Next button, clear everything for fresh start
              if (newStep === 0) {
                logger.log(
                  '🔄 Pack Tool: Manually navigating back to step 0 - clearing delivery field'
                )

                // Clear auto-verify timeout
                if (autoVerifyTimeout) {
                  clearTimeout(autoVerifyTimeout)
                  setAutoVerifyTimeout(null)
                }
                setIsAutoVerifyPending(false)
                setHasAutoProceedTriggered(false)

                // Clear the entire form data
                setFormData({
                  deliveryId: '',
                  items: [],
                  packageData: {
                    length: '',
                    width: '',
                    height: '',
                    weight: '',
                  },
                  labelGenerated: false,
                  toScanState: {
                    toNumbers: [],
                    scannedTOs: [],
                    requiresTOScanning: false,
                    allTOsScanned: false,
                  },
                })
              }
            }}
            disabled={!canProceedToNext()}
          >
            Next
            <ChevronRight className='ml-2 h-4 w-4' />
          </Button>
        </div>
      )}
    </div>
  )
}

export default PackToolForm
