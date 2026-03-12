'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Globe,
  Loader2,
  Package,
  Scan,
  Ship,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { OutboundTOData } from '@/lib/supabase/outbound-to-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useShipperTool } from '@/hooks/use-outbound-to-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type WawfOption = 'ready_for_nefab' | 'staged_to_nefab' | 'complete_tka_process'

interface FormData {
  shipperType: 'domestic' | 'international' | 'wawf' | null
  deliveryId: string
  deliveryData?: OutboundTOData[]
  shipmentComplete: boolean
  wawfOption?: WawfOption | null
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
const ShippersToolForm = () => {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<FormData>({
    shipperType: null,
    deliveryId: '',
    shipmentComplete: false,
  })

  // Use the shipper tool hook for real Supabase operations
  const {
    verifyDeliveryAsync,
    isVerifyingDelivery,
    updateShippingInfoAsync,
    isUpdatingShippingInfo,
    completeShippingAsync,
    isCompletingShipping,
    verifyDeliveryForWAWFAsync,
    isVerifyingWAWF,
    updateWAWFStatusAsync,
    isUpdatingWAWF,
    completeWAWFShippingAsync,
    isCompletingWAWF,
  } = useShipperTool()

  // Auth state management for session refresh
  const { authState } = useUnifiedAuth()
  const { isAuthenticated, isLoading: isAuthLoading } = authState

  // Auto-verification and focus management
  const [autoVerifyTimeout, setAutoVerifyTimeout] =
    useState<NodeJS.Timeout | null>(null)
  const [isAutoVerifyPending, setIsAutoVerifyPending] = useState(false)
  const [hasAutoProceedTriggered, setHasAutoProceedTriggered] = useState(false)

  // 🔒 CONCURRENT OPERATION LOCK - Prevent race conditions (same pattern as Pack Tool)
  const verificationInProgressRef = useRef(false)

  // 🎯 CURRENT VALUE REF - Track latest delivery ID to detect stale timers
  const currentDeliveryIdRef = useRef(formData.deliveryId)

  // Update ref whenever delivery ID changes
  useEffect(() => {
    currentDeliveryIdRef.current = formData.deliveryId
  }, [formData.deliveryId])

  // Auto-focus delivery ID field when on step 1
  useEffect(() => {
    logger.log(`🔄 Shipper Tool: Step changed to ${currentStep}`)

    if (currentStep === 1) {
      logger.log('🎯 Shipper Tool: Auto-focusing delivery ID field')
      setTimeout(() => {
        const deliveryInput = document.getElementById(
          'shipperDeliveryId'
        ) as HTMLInputElement
        if (deliveryInput) {
          deliveryInput.focus()
          logger.log('✅ Shipper Tool: Delivery ID field focused')
        }
      }, 100)
    }
  }, [currentStep])

  // Auto-verify delivery ID after user stops typing (debounced)
  useEffect(() => {
    // 🔒 Check lock at entry - don't set new timer if verification already running
    if (verificationInProgressRef.current) {
      logger.log(
        '🔒 Shipper Tool: Verification lock active, skipping auto-verify timer setup'
      )
      return
    }

    // Clear existing timeout and pending state
    if (autoVerifyTimeout) {
      clearTimeout(autoVerifyTimeout)
      setAutoVerifyTimeout(null)
      setIsAutoVerifyPending(false)
    }

    // Only auto-verify when on step 1 and have a delivery ID that looks complete
    if (
      currentStep === 1 &&
      formData.deliveryId &&
      formData.deliveryId.length >= 6 &&
      !hasAutoProceedTriggered
    ) {
      // Capture the CURRENT delivery ID value that this timer is for
      const capturedDeliveryId = formData.deliveryId
      logger.log(
        `⏱️ Shipper Tool: Starting auto-verify timer for delivery ${capturedDeliveryId}`
      )
      setIsAutoVerifyPending(true)

      const timeoutId = setTimeout(async () => {
        // 🔒 Double-check lock before executing verification
        if (verificationInProgressRef.current) {
          logger.log(
            '🔒 Shipper Tool: Verification already in progress, skipping auto-verify callback'
          )
          setIsAutoVerifyPending(false)
          return
        }

        // 🎯 CRITICAL FIX: Verify the delivery ID hasn't changed since timer was set
        // Use ref to check ACTUAL current value, not closure variable
        if (currentDeliveryIdRef.current !== capturedDeliveryId) {
          logger.log(
            `⏭️ Shipper Tool: Delivery ID changed from ${capturedDeliveryId} to ${currentDeliveryIdRef.current}, skipping stale auto-verify`
          )
          setIsAutoVerifyPending(false)
          return
        }

        logger.log(
          `🤖 Shipper Tool: Auto-verifying delivery ${currentDeliveryIdRef.current} (no button click needed)`
        )
        setIsAutoVerifyPending(false)

        if (!isVerifyingDelivery && !isVerifyingWAWF && !isAuthLoading) {
          await handleDeliveryScan()
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
    isVerifyingWAWF,
    isAuthLoading,
  ])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
        setAutoVerifyTimeout(null)
        setIsAutoVerifyPending(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run on mount only, cleanup on unmount
  }, [])

  // Steps configuration
  const steps = [
    {
      id: 1,
      title: 'Choose Type',
      icon: Ship,
      description: 'Select shipping type',
    },
    {
      id: 2,
      title: 'Scan Delivery',
      icon: Scan,
      description: 'Verify packed delivery',
    },
    {
      id: 3,
      title: formData.shipperType === 'wawf' ? 'WAWF Options' : 'Checklist',
      icon: formData.shipperType === 'wawf' ? ClipboardList : FileText,
      description:
        formData.shipperType === 'domestic'
          ? 'Domestic requirements'
          : formData.shipperType === 'wawf'
            ? 'Select WAWF action'
            : 'International requirements',
    },
    {
      id: 4,
      title: 'Complete',
      icon: CheckCircle,
      description: 'Complete shipment',
    },
  ]

  const handleShipperTypeSelect = (
    type: 'domestic' | 'international' | 'wawf'
  ) => {
    setFormData((prev) => ({ ...prev, shipperType: type, wawfOption: null }))
    logger.log(
      `✅ Shipper Tool: ${type} shipping selected, proceeding to delivery scan`
    )
    setCurrentStep(1)
  }

  const handleDeliveryScan = async () => {
    // 🔒 LOCK: Check if verification already in progress - prevent concurrent verifications
    if (verificationInProgressRef.current) {
      logger.log(
        '🔒 Shipper Tool: Verification already in progress, blocking concurrent attempt'
      )
      return
    }

    try {
      // 🔒 ACQUIRE LOCK
      verificationInProgressRef.current = true
      logger.log('🔓 Shipper Tool: Verification lock acquired')

      // Clear any pending auto-verify timeout when manually triggered
      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
        setAutoVerifyTimeout(null)
        setIsAutoVerifyPending(false)
      }

      logger.log(
        '🔍 Shipper Tool: Validating auth state before delivery verification...'
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

      // Use WAWF-specific verification when WAWF type is selected
      const result =
        formData.shipperType === 'wawf'
          ? await verifyDeliveryForWAWFAsync(formData.deliveryId.trim())
          : await verifyDeliveryAsync(formData.deliveryId.trim())

      if (result.exists && result.deliveryData) {
        setFormData((prev) => ({
          ...prev,
          deliveryData: result.deliveryData,
        }))

        logger.log(
          '✅ Shipper Tool: Delivery verification successful, proceeding to checklist'
        )

        // Only auto-proceed if we haven't already triggered it for this delivery
        if (!hasAutoProceedTriggered) {
          logger.log(
            '🚀 Shipper Tool: Setting auto-proceed flag and advancing to checklist'
          )
          setHasAutoProceedTriggered(true)

          // Use requestAnimationFrame to ensure state update is completed
          requestAnimationFrame(() => {
            setTimeout(() => {
              logger.log(
                `🚀 Shipper Tool: Auto-proceeding to step 2 (${formData.shipperType} Checklist)`
              )
              setCurrentStep(2)
            }, 500) // 500ms delay to show success state
          })
        } else {
          logger.log(
            '⏭️ Shipper Tool: Auto-proceed already triggered for this delivery, skipping'
          )
        }
      } else {
        logger.log(
          '❌ Shipper Tool: Auto-proceed cancelled - delivery not found or not packed'
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
            'shipperDeliveryId'
          ) as HTMLInputElement
          if (deliveryInput) {
            deliveryInput.focus()
            logger.log(
              '🎯 Shipper Tool: Delivery field focused for retry after verification failure'
            )
          }
        }, 100)
      }
    } catch (error) {
      logger.error('Error verifying delivery:', error)
      logger.log('❌ Shipper Tool: Auto-proceed cancelled due to error')

      // Reset states on error
      setHasAutoProceedTriggered(false)
      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
        setAutoVerifyTimeout(null)
        setIsAutoVerifyPending(false)
      }
    } finally {
      // 🔒 RELEASE LOCK - Always release the lock, even if error occurs
      verificationInProgressRef.current = false
      logger.log('🔓 Shipper Tool: Verification lock released')
    }
  }

  const handleCompleteShipment = async () => {
    try {
      // Update shipping information (trim whitespace from barcode scanner input)
      await updateShippingInfoAsync({
        deliveryId: formData.deliveryId.trim(),
        shippingData: {
          shipper_type: formData.shipperType!,
        },
      })

      // Complete shipping (update status to shipped)
      await completeShippingAsync(formData.deliveryId.trim())

      setFormData((prev) => ({ ...prev, shipmentComplete: true }))
      logger.log('🎉 Shipper Tool: Shipment completed successfully')
      setCurrentStep(3)
    } catch (error) {
      logger.error('Error completing shipment:', error)
    }
  }

  const handleWAWFOptionSelect = async (option: WawfOption) => {
    try {
      const trimmedDeliveryId = formData.deliveryId.trim()

      if (option === 'complete_tka_process') {
        await completeWAWFShippingAsync(trimmedDeliveryId)
        setFormData((prev) => ({
          ...prev,
          wawfOption: option,
          shipmentComplete: true,
        }))
        logger.log('🎉 WAWF: TKA process completed, delivery shipped')
      } else {
        await updateWAWFStatusAsync({
          deliveryId: trimmedDeliveryId,
          wawfStatus: option,
        })
        setFormData((prev) => ({
          ...prev,
          wawfOption: option,
          shipmentComplete: true,
        }))
        logger.log(`✅ WAWF: Status set to ${option}`)
      }

      setCurrentStep(3)
    } catch (error) {
      logger.error('Error processing WAWF option:', error)
    }
  }

  const canProceedToNext = () => {
    switch (currentStep) {
      case 0:
        return formData.shipperType !== null
      case 1:
        return formData.deliveryData && formData.deliveryData.length > 0
      case 2:
        return true // Checklist review complete
      case 3:
        return formData.shipmentComplete
      default:
        return false
    }
  }

  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.2 } },
  }

  return (
    <div className='mx-auto w-full max-w-6xl space-y-8 p-6'>
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
      <Card className='min-h-[500px]'>
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
              {/* Step 1: Choose Shipping Type */}
              {currentStep === 0 && (
                <div className='space-y-6'>
                  <div className='space-y-4 text-center'>
                    <Ship className='text-muted-foreground mx-auto h-16 w-16' />
                    <h3 className='text-lg font-semibold'>
                      Select Shipping Type
                    </h3>
                    <p className='text-muted-foreground'>
                      Choose whether this shipment is domestic or international
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='grid grid-cols-1 gap-4'>
                      <Button
                        onClick={() => handleShipperTypeSelect('domestic')}
                        variant='outline'
                        className='flex h-20 flex-col gap-2 border-2 hover:border-blue-200 hover:bg-blue-50'
                        size='lg'
                      >
                        <Truck className='h-8 w-8 text-blue-600' />
                        <div className='text-center'>
                          <div className='font-semibold'>Domestic</div>
                          <div className='text-muted-foreground text-xs'>
                            USA shipping
                          </div>
                        </div>
                      </Button>

                      <Button
                        onClick={() => handleShipperTypeSelect('international')}
                        variant='outline'
                        className='flex h-20 flex-col gap-2 border-2 hover:border-green-200 hover:bg-green-50'
                        size='lg'
                      >
                        <Globe className='h-8 w-8 text-green-600' />
                        <div className='text-center'>
                          <div className='font-semibold'>International</div>
                          <div className='text-muted-foreground text-xs'>
                            Global shipping
                          </div>
                        </div>
                      </Button>

                      <Button
                        onClick={() => handleShipperTypeSelect('wawf')}
                        variant='outline'
                        className='flex h-20 flex-col gap-2 border-2 hover:border-amber-200 hover:bg-amber-50'
                        size='lg'
                      >
                        <Package className='h-8 w-8 text-amber-600' />
                        <div className='text-center'>
                          <div className='font-semibold'>WAWF</div>
                          <div className='text-muted-foreground text-xs'>
                            Wide Area Workflow
                          </div>
                        </div>
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Scan Delivery */}
              {currentStep === 1 && (
                <div className='space-y-4'>
                  <div className='space-y-4 text-center'>
                    <Scan className='text-muted-foreground mx-auto h-16 w-16' />
                    <h3 className='text-lg font-semibold'>
                      Scan Packed Delivery
                    </h3>
                    <p className='text-muted-foreground'>
                      Scan or enter the delivery ID that has been packed and is
                      ready for shipment
                    </p>
                    <div className='flex justify-center'>
                      <Badge variant='secondary' className='text-sm'>
                        {formData.shipperType === 'domestic' ? (
                          <>
                            <Truck className='mr-1 h-4 w-4' />
                            Domestic Shipping
                          </>
                        ) : formData.shipperType === 'wawf' ? (
                          <>
                            <Package className='mr-1 h-4 w-4' />
                            WAWF Shipping
                          </>
                        ) : (
                          <>
                            <Globe className='mr-1 h-4 w-4' />
                            International Shipping
                          </>
                        )}
                      </Badge>
                    </div>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='shipperDeliveryId'>Delivery ID</Label>
                      <Input
                        id='shipperDeliveryId'
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
                            `📝 Shipper Tool: Delivery ID changed to: ${newValue}`
                          )
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === 'Enter' &&
                            formData.deliveryId &&
                            !isVerifyingDelivery &&
                            !isVerifyingWAWF &&
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
                      onClick={() => {
                        // Clear auto-verify timeout when user manually triggers
                        if (autoVerifyTimeout) {
                          clearTimeout(autoVerifyTimeout)
                          setAutoVerifyTimeout(null)
                          setIsAutoVerifyPending(false)
                        }
                        handleDeliveryScan()
                      }}
                      disabled={
                        !formData.deliveryId ||
                        isVerifyingDelivery ||
                        isVerifyingWAWF ||
                        isAuthLoading
                      }
                      className='w-full'
                      size='lg'
                      variant={isAutoVerifyPending ? 'outline' : 'default'}
                    >
                      {isVerifyingDelivery ||
                      isVerifyingWAWF ||
                      isAuthLoading ? (
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
                          Verify Packed Delivery
                        </>
                      )}
                    </Button>

                    {formData.deliveryData &&
                      formData.deliveryData.length > 0 && (
                        <div className='mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30'>
                          <h4 className='mb-2 font-medium text-blue-700 dark:text-blue-300'>
                            Delivery Information
                          </h4>
                          <div className='text-foreground dark:text-foreground space-y-1 text-sm'>
                            <p>
                              <span className='font-medium'>Delivery:</span>{' '}
                              {formData.deliveryData[0].delivery}
                            </p>
                            <p>
                              <span className='font-medium'>Materials:</span>{' '}
                              {
                                new Set(
                                  formData.deliveryData.map(
                                    (item) => item.material
                                  )
                                ).size
                              }{' '}
                              types
                            </p>
                            <p>
                              <span className='font-medium'>Status:</span>{' '}
                              <span className='font-medium text-green-600 dark:text-green-400'>
                                Packed
                              </span>
                            </p>
                            <p>
                              <span className='font-medium'>Tracking:</span>{' '}
                              {formData.deliveryData[0].tracking_number ||
                                'N/A'}
                            </p>
                            {formData.shipperType === 'wawf' &&
                              formData.deliveryData[0].wawf_status && (
                                <p>
                                  <span className='font-medium'>
                                    WAWF Status:
                                  </span>{' '}
                                  <span className='font-medium text-amber-600 dark:text-amber-400'>
                                    {formData.deliveryData[0].wawf_status.replace(
                                      /_/g,
                                      ' '
                                    )}
                                  </span>
                                </p>
                              )}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* Step 3: Shipping Checklist / WAWF Options */}
              {currentStep === 2 && (
                <div className='space-y-6'>
                  {formData.shipperType === 'wawf' ? (
                    // WAWF Options
                    <div className='space-y-6'>
                      <div className='space-y-4 text-center'>
                        <Package className='mx-auto h-16 w-16 text-amber-600' />
                        <div>
                          <h3 className='text-xl font-bold'>
                            WAWF Delivery Options
                          </h3>
                          <p className='text-muted-foreground mt-1'>
                            Delivery:{' '}
                            <span className='font-mono font-medium'>
                              {formData.deliveryId}
                            </span>
                          </p>
                          {formData.deliveryData?.[0]?.wawf_status && (
                            <Badge
                              variant='outline'
                              className='mt-2 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400'
                            >
                              Current status:{' '}
                              {formData.deliveryData[0].wawf_status.replace(
                                /_/g,
                                ' '
                              )}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className='mx-auto max-w-lg space-y-4'>
                        <Button
                          onClick={() =>
                            handleWAWFOptionSelect('ready_for_nefab')
                          }
                          disabled={isUpdatingWAWF || isCompletingWAWF}
                          variant='outline'
                          className='flex h-20 w-full flex-col gap-1 border-2 hover:border-blue-200 hover:bg-blue-50'
                          size='lg'
                        >
                          {isUpdatingWAWF &&
                          formData.wawfOption === 'ready_for_nefab' ? (
                            <Loader2 className='h-6 w-6 animate-spin' />
                          ) : (
                            <Package className='h-6 w-6 text-blue-600' />
                          )}
                          <div className='text-center'>
                            <div className='font-semibold'>Ready for NeFab</div>
                            <div className='text-muted-foreground text-xs'>
                              Mark delivery as ready for NeFab packaging
                            </div>
                          </div>
                        </Button>

                        <Button
                          onClick={() =>
                            handleWAWFOptionSelect('staged_to_nefab')
                          }
                          disabled={isUpdatingWAWF || isCompletingWAWF}
                          variant='outline'
                          className='flex h-20 w-full flex-col gap-1 border-2 hover:border-green-200 hover:bg-green-50'
                          size='lg'
                        >
                          {isUpdatingWAWF &&
                          formData.wawfOption === 'staged_to_nefab' ? (
                            <Loader2 className='h-6 w-6 animate-spin' />
                          ) : (
                            <Ship className='h-6 w-6 text-green-600' />
                          )}
                          <div className='text-center'>
                            <div className='font-semibold'>Staged to NeFab</div>
                            <div className='text-muted-foreground text-xs'>
                              Mark delivery as staged to NeFab
                            </div>
                          </div>
                        </Button>

                        <div className='relative py-2'>
                          <div className='absolute inset-0 flex items-center'>
                            <span className='w-full border-t' />
                          </div>
                          <div className='relative flex justify-center text-xs uppercase'>
                            <span className='bg-card text-muted-foreground px-2'>
                              or complete shipping
                            </span>
                          </div>
                        </div>

                        <Button
                          onClick={() =>
                            handleWAWFOptionSelect('complete_tka_process')
                          }
                          disabled={isUpdatingWAWF || isCompletingWAWF}
                          className='flex h-20 w-full flex-col gap-1 border-2 bg-amber-600 text-white hover:bg-amber-700'
                          size='lg'
                        >
                          {isCompletingWAWF ? (
                            <Loader2 className='h-6 w-6 animate-spin' />
                          ) : (
                            <CheckCircle className='h-6 w-6' />
                          )}
                          <div className='text-center'>
                            <div className='font-semibold'>
                              Complete TKA Process in SAP
                            </div>
                            <div className='text-xs opacity-90'>
                              Finalize and push delivery status to shipped
                            </div>
                          </div>
                        </Button>
                      </div>
                    </div>
                  ) : formData.shipperType === 'domestic' ? (
                    // Domestic Shipper Checklist
                    <div className='space-y-6'>
                      <div className='space-y-4 text-center'>
                        <Truck className='mx-auto h-16 w-16 text-blue-600' />
                        <div>
                          <h3 className='text-xl font-bold'>
                            Domestic Shipper Checklist
                          </h3>
                        </div>
                      </div>

                      <div className='space-y-6'>
                        {/* Label Printing Tasks */}
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>
                              Label Printing Tasks
                            </CardTitle>
                          </CardHeader>
                          <CardContent className='space-y-4'>
                            <div className='space-y-3'>
                              <div className='rounded-lg border p-4'>
                                <div className='flex items-start gap-3'>
                                  <CheckCircle className='mt-0.5 h-5 w-5 text-green-500' />
                                  <div className='flex-1'>
                                    <div className='font-medium'>
                                      PRINT FEDEX LABEL *IF APPLICABLE
                                    </div>
                                    <div className='text-muted-foreground mt-1 text-sm'>
                                      Go into FedEx Ship Manager and create
                                      label
                                      <br />
                                      Adhere shipping label to package
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className='rounded-lg border p-4'>
                                <div className='flex items-start gap-3'>
                                  <CheckCircle className='mt-0.5 h-5 w-5 text-green-500' />
                                  <div className='flex-1'>
                                    <div className='font-medium'>
                                      PRINT UPS LABEL *IF APPLICABLE
                                    </div>
                                    <div className='text-muted-foreground mt-1 text-sm'>
                                      Go into UPS Shipping Software and create
                                      label
                                      <br />
                                      Adhere shipping label to package
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className='rounded-lg border p-4'>
                                <div className='flex items-start gap-3'>
                                  <CheckCircle className='mt-0.5 h-5 w-5 text-green-500' />
                                  <div className='flex-1'>
                                    <div className='font-medium'>
                                      CREATE OUTBOUND DELIVERY
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className='space-y-2 border-t pt-4'>
                              <div className='text-sm font-medium'>
                                Additional Notes:
                              </div>
                              <div className='text-muted-foreground space-y-1 text-sm'>
                                <p>• Log Shipment Member</p>
                                <p>• Case Shipment</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Print Paperwork Requirements */}
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>
                              PRINT PAPERWORK Requirements
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className='overflow-x-auto'>
                              <table className='w-full border-collapse border border-gray-300'>
                                <thead>
                                  <tr className='bg-gray-50'>
                                    <th className='border border-gray-300 px-4 py-2 text-left font-medium'>
                                      Document Type
                                    </th>
                                    <th className='border border-gray-300 px-4 py-2 text-center font-medium'>
                                      Quantity
                                    </th>
                                    <th className='border border-gray-300 px-4 py-2 text-left font-medium'>
                                      Special Instructions
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td className='border border-gray-300 px-4 py-2 font-medium'>
                                      Packing list
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2 text-center'>
                                      3 copies
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2 text-sm'>
                                      1 copy stapled to pick list with CoIC
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-4 py-2 font-medium'>
                                      CoC
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2 text-center'>
                                      2 copies
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2 text-sm'>
                                      1 copy stapled to pick list with packing
                                      list
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-4 py-2 font-medium'>
                                      8130-3
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2 text-center'>
                                      2 copies
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2 text-sm'>
                                      Paperclipped to top of pick list with
                                      packing list and CoIC
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            <div className='mt-4 space-y-2 border-t pt-4'>
                              <div className='text-sm font-medium'>
                                Final Steps:
                              </div>
                              <div className='text-muted-foreground space-y-1 text-sm'>
                                <p>• PGI Delivery</p>
                                <p>• Stage on overcheck rack</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  ) : (
                    // International Shipper Checklist
                    <div className='space-y-6'>
                      <div className='space-y-4 text-center'>
                        <Globe className='mx-auto h-16 w-16 text-green-600' />
                        <h3 className='text-xl font-bold'>
                          International Shipper Checklist
                        </h3>
                      </div>

                      <div className='space-y-6'>
                        {/* Initial Checklist */}
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>
                              Shipping Preparation
                            </CardTitle>
                          </CardHeader>
                          <CardContent className='space-y-3'>
                            <div className='space-y-3'>
                              {[
                                'Create shipment',
                                'Was tracking applicable',
                                'Was shipment cased',
                                'Were the Volume Data entered (Use Inches Unit of Measurement)',
                                'Did you print the correct paperwork for the correct customer',
                              ].map((item, index) => (
                                <div
                                  key={index}
                                  className='flex items-start gap-3'
                                >
                                  <CheckCircle className='mt-0.5 h-5 w-5 text-green-500' />
                                  <span className='text-sm'>{item}</span>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>

                        {/* Paperwork Requirements Table */}
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>
                              Paperwork Requirements by Selection Type
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className='overflow-x-auto'>
                              <table className='w-full border-collapse border border-gray-300 text-sm'>
                                <thead>
                                  <tr className='bg-gray-50'>
                                    <th className='border border-gray-300 px-3 py-2 text-left font-medium'>
                                      Document Type
                                    </th>
                                    <th className='border border-gray-300 px-3 py-2 text-center font-medium'>
                                      OGMA Selection
                                    </th>
                                    <th className='border border-gray-300 px-3 py-2 text-center font-medium'>
                                      Canada Requirements
                                    </th>
                                    <th className='border border-gray-300 px-3 py-2 text-center font-medium'>
                                      GE Avio
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td className='border border-gray-300 px-3 py-2 font-medium'>
                                      Custom Invoices
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      5
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      5
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      5
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-3 py-2 font-medium'>
                                      Canada Customs Invoices
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      -
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      5
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      -
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-3 py-2 font-medium'>
                                      Packing List
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      3
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      3
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      3
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-3 py-2 font-medium'>
                                      CoCs
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      2
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      2
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      2
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-3 py-2 font-medium'>
                                      SLIs
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      4
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      4
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      4
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-3 py-2 font-medium'>
                                      8130-3
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      4 copies
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      2 (paperclip to top)
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      3
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-3 py-2 font-medium'>
                                      BOL
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-xs'>
                                      1 copy stapled to pick ticket
                                      <br />2 copies stapled with SLI
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      -
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      -
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-3 py-2 font-medium'>
                                      SLI
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-xs'>
                                      1 copy stapled to pick ticket
                                      <br />1 copy stapled with BOLs
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      -
                                    </td>
                                    <td className='border border-gray-300 px-3 py-2 text-center'>
                                      -
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Final Processing Steps */}
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>
                              Final Processing Steps
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className='overflow-x-auto'>
                              <table className='w-full border-collapse border border-gray-300'>
                                <thead>
                                  <tr className='bg-gray-50'>
                                    <th className='border border-gray-300 px-4 py-2 text-left font-medium'>
                                      Step
                                    </th>
                                    <th className='border border-gray-300 px-4 py-2 text-left font-medium'>
                                      Description
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td className='border border-gray-300 px-4 py-2 font-medium'>
                                      PGI DELIVERY
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2'>
                                      Process PGI delivery
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-4 py-2 font-medium'>
                                      PRINT Z LABEL
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2'>
                                      Print Z label
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-4 py-2 font-medium'>
                                      ODA STATION
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2'>
                                      Take to ODA station with return to shipper
                                      page
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-4 py-2 font-medium'>
                                      SCAN & EMAIL
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2'>
                                      Once returned, scan and email paperwork
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className='border border-gray-300 px-4 py-2 font-medium'>
                                      FINAL PACK
                                    </td>
                                    <td className='border border-gray-300 px-4 py-2'>
                                      Put on international final pack line
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            <div className='mt-4 space-y-2 border-t pt-4'>
                              <div className='text-sm font-medium'>
                                Bottom Checklist:
                              </div>
                              <div className='text-muted-foreground space-y-1 text-sm'>
                                <p>
                                  • Did you input tracking if wasn't done
                                  already
                                </p>
                                <p>• PGI is block</p>
                                <p>• Print Z label</p>
                                <p>• Take to overcheck Rack</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  )}

                  {/* Complete Shipment Button (domestic/international only) */}
                  {formData.shipperType !== 'wawf' && (
                    <div className='text-center'>
                      <Button
                        onClick={handleCompleteShipment}
                        disabled={
                          isUpdatingShippingInfo || isCompletingShipping
                        }
                        className='w-full max-w-md'
                        size='lg'
                      >
                        {isUpdatingShippingInfo || isCompletingShipping ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            Completing Shipment...
                          </>
                        ) : (
                          <>
                            <Ship className='mr-2 h-4 w-4' />
                            Complete Shipment
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Shipment Complete */}
              {currentStep === 3 && (
                <div className='space-y-4'>
                  <div className='space-y-4 text-center'>
                    <CheckCircle
                      className={cn(
                        'mx-auto h-16 w-16',
                        formData.shipperType === 'wawf' &&
                          formData.wawfOption !== 'complete_tka_process'
                          ? 'text-amber-500'
                          : 'text-green-500'
                      )}
                    />
                    <h3 className='text-lg font-semibold'>
                      {formData.shipperType === 'wawf' &&
                      formData.wawfOption !== 'complete_tka_process'
                        ? 'WAWF Status Updated!'
                        : 'Shipment Complete!'}
                    </h3>
                    <p className='text-muted-foreground'>
                      {formData.shipperType === 'wawf' &&
                      formData.wawfOption !== 'complete_tka_process'
                        ? `Delivery ${formData.deliveryId} WAWF status has been set. Return later to complete TKA process in SAP.`
                        : `Delivery ${formData.deliveryId} has been successfully shipped`}
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-3 rounded-lg border p-4'>
                      <h4 className='font-medium'>
                        {formData.shipperType === 'wawf'
                          ? 'WAWF Summary'
                          : 'Shipment Summary'}
                      </h4>
                      <div className='space-y-2 text-sm'>
                        <div className='flex justify-between'>
                          <span>Delivery ID:</span>
                          <span className='font-mono'>
                            {formData.deliveryId}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Shipping Type:</span>
                          <span className='uppercase'>
                            {formData.shipperType}
                          </span>
                        </div>
                        {formData.shipperType === 'wawf' && (
                          <div className='flex justify-between'>
                            <span>WAWF Action:</span>
                            <span className='font-medium text-amber-600 capitalize'>
                              {formData.wawfOption?.replace(/_/g, ' ')}
                            </span>
                          </div>
                        )}
                        <div className='flex justify-between'>
                          <span>Status:</span>
                          {formData.shipperType === 'wawf' &&
                          formData.wawfOption !== 'complete_tka_process' ? (
                            <span className='font-medium text-amber-600'>
                              Pending TKA Completion
                            </span>
                          ) : (
                            <span className='font-medium text-green-600'>
                              Shipped
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {formData.shipperType === 'wawf' &&
                      formData.wawfOption !== 'complete_tka_process' && (
                        <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'>
                          You will need to return and select{' '}
                          <strong>Complete TKA Process in SAP</strong> for this
                          delivery to finalize shipping.
                        </div>
                      )}

                    <Button
                      onClick={() => {
                        setCurrentStep(0)

                        if (autoVerifyTimeout) {
                          clearTimeout(autoVerifyTimeout)
                          setAutoVerifyTimeout(null)
                        }
                        setIsAutoVerifyPending(false)
                        setHasAutoProceedTriggered(false)

                        setFormData({
                          shipperType: null,
                          deliveryId: '',
                          shipmentComplete: false,
                          wawfOption: null,
                        })
                      }}
                      variant='outline'
                      className='w-full'
                    >
                      Start New Shipment
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Navigation */}
      {currentStep < steps.length - 1 && !formData.shipmentComplete && (
        <div className='flex justify-between'>
          <Button
            variant='outline'
            onClick={() => {
              const newStep = Math.max(0, currentStep - 1)
              setCurrentStep(newStep)

              // When going back to step 0, clear everything for fresh start
              if (newStep === 0) {
                logger.log(
                  '🔄 Shipper Tool: Navigating back to step 0 - clearing form for fresh start'
                )

                // Clear auto-verify timeout
                if (autoVerifyTimeout) {
                  clearTimeout(autoVerifyTimeout)
                  setAutoVerifyTimeout(null)
                }
                setIsAutoVerifyPending(false)
                setHasAutoProceedTriggered(false)

                setFormData((prev) => ({
                  shipperType: prev.shipperType,
                  deliveryId: '',
                  shipmentComplete: false,
                  wawfOption: null,
                }))
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

export default ShippersToolForm
