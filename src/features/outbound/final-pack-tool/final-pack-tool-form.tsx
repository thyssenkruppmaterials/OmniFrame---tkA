// Created and developed by Jai Singh
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileCheck,
  Loader2,
  Scan,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { OutboundTOData } from '@/lib/supabase/outbound-to-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useFinalPackTool } from '@/hooks/use-outbound-to-data'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Types
interface FormData {
  deliveryId: string
  trackingNumber: string
  requires8130_3: boolean
  has8130_3: boolean
  is8130_3Signed: boolean
  deliveryData?: OutboundTOData[]
  finalPackComplete: boolean
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
const FinalPackToolForm = () => {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<FormData>({
    deliveryId: '',
    trackingNumber: '',
    requires8130_3: false,
    has8130_3: false,
    is8130_3Signed: false,
    finalPackComplete: false,
  })

  // Use the final pack tool hook for real Supabase operations
  const {
    verifyDeliveryAsync,
    isVerifyingDelivery,
    updateFinalPackInfoAsync,
    isUpdatingFinalPackInfo,
    completeFinalPackingAsync,
    isCompletingFinalPacking,
  } = useFinalPackTool()

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

  // Auto-focus delivery ID field when on step 0
  useEffect(() => {
    logger.log(`🔄 Final Pack Tool: Step changed to ${currentStep}`)

    if (currentStep === 0) {
      logger.log('🎯 Final Pack Tool: Auto-focusing delivery ID field')
      setTimeout(() => {
        const deliveryInput = document.getElementById(
          'finalPackDeliveryId'
        ) as HTMLInputElement
        if (deliveryInput) {
          deliveryInput.focus()
          logger.log('✅ Final Pack Tool: Delivery ID field focused')
        }
      }, 100)
    }
  }, [currentStep])

  // Auto-verify delivery ID after user stops typing (debounced)
  useEffect(() => {
    // 🔒 Check lock at entry - don't set new timer if verification already running
    if (verificationInProgressRef.current) {
      logger.log(
        '🔒 Final Pack Tool: Verification lock active, skipping auto-verify timer setup'
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
        `⏱️ Final Pack Tool: Starting auto-verify timer for delivery ${capturedDeliveryId}`
      )
      setIsAutoVerifyPending(true)

      const timeoutId = setTimeout(async () => {
        // 🔒 Double-check lock before executing verification
        if (verificationInProgressRef.current) {
          logger.log(
            '🔒 Final Pack Tool: Verification already in progress, skipping auto-verify callback'
          )
          setIsAutoVerifyPending(false)
          return
        }

        // 🎯 CRITICAL FIX: Verify the delivery ID hasn't changed since timer was set
        // Use ref to check ACTUAL current value, not closure variable
        if (currentDeliveryIdRef.current !== capturedDeliveryId) {
          logger.log(
            `⏭️ Final Pack Tool: Delivery ID changed from ${capturedDeliveryId} to ${currentDeliveryIdRef.current}, skipping stale auto-verify`
          )
          setIsAutoVerifyPending(false)
          return
        }

        logger.log(
          `🤖 Final Pack Tool: Auto-verifying delivery ${currentDeliveryIdRef.current} (no button click needed)`
        )
        setIsAutoVerifyPending(false)

        if (!isVerifyingDelivery && !isAuthLoading) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleDeliveryScan/autoVerifyTimeout excluded: would cause effect re-run every render
  }, [
    formData.deliveryId,
    currentStep,
    hasAutoProceedTriggered,
    isVerifyingDelivery,
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
      title: 'Scan Delivery',
      icon: Scan,
      description: 'Verify delivery for final pack',
    },
    {
      id: 2,
      title: 'Scan Tracking',
      icon: Truck,
      description: 'Enter tracking number',
    },
    {
      id: 3,
      title: '8130-3 Questions',
      icon: FileCheck,
      description: 'Answer compliance questions',
    },
    {
      id: 4,
      title: 'Complete',
      icon: ClipboardCheck,
      description: 'Final pack complete',
    },
  ]

  const handleDeliveryScan = async () => {
    // 🔒 LOCK: Check if verification already in progress - prevent concurrent verifications
    if (verificationInProgressRef.current) {
      logger.log(
        '🔒 Final Pack Tool: Verification already in progress, blocking concurrent attempt'
      )
      return
    }

    try {
      // 🔒 ACQUIRE LOCK
      verificationInProgressRef.current = true
      logger.log('🔓 Final Pack Tool: Verification lock acquired')

      // Clear any pending auto-verify timeout when manually triggered
      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
        setAutoVerifyTimeout(null)
        setIsAutoVerifyPending(false)
      }

      logger.log(
        '🔍 Final Pack Tool: Validating auth state before delivery verification...'
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

      // Verify delivery exists and is packed (trim whitespace from barcode scanner input)
      const result = await verifyDeliveryAsync(formData.deliveryId.trim())

      if (result.exists && result.deliveryData) {
        setFormData((prev) => ({
          ...prev,
          deliveryData: result.deliveryData,
        }))

        logger.log(
          '✅ Final Pack Tool: Delivery verification successful, data loaded. Auto-proceeding...'
        )

        // Only auto-proceed if we haven't already triggered it for this delivery
        if (!hasAutoProceedTriggered) {
          logger.log(
            '🚀 Final Pack Tool: Setting auto-proceed flag and advancing to next step'
          )
          setHasAutoProceedTriggered(true)

          // Use requestAnimationFrame to ensure state update is completed, then setTimeout for user feedback
          requestAnimationFrame(() => {
            setTimeout(() => {
              logger.log(
                `🚀 Final Pack Tool: Auto-proceeding to step 1 (Tracking Number)`
              )
              setCurrentStep(1)

              // Auto-focus tracking number field
              setTimeout(() => {
                const trackingInput = document.getElementById(
                  'trackingNumber'
                ) as HTMLInputElement
                if (trackingInput) {
                  trackingInput.focus()
                  logger.log(
                    '🎯 Final Pack Tool: Tracking number field focused'
                  )
                }
              }, 100)
            }, 500) // 500ms delay to show success state
          })
        } else {
          logger.log(
            '⏭️ Final Pack Tool: Auto-proceed already triggered for this delivery, skipping'
          )
        }
      } else {
        logger.log(
          '❌ Final Pack Tool: Auto-proceed cancelled - delivery not found or not packed'
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
            'finalPackDeliveryId'
          ) as HTMLInputElement
          if (deliveryInput) {
            deliveryInput.focus()
            logger.log(
              '🎯 Final Pack Tool: Delivery field focused for retry after verification failure'
            )
          }
        }, 100)
      }
    } catch (error) {
      logger.error('Error verifying delivery:', error)
      logger.log('❌ Final Pack Tool: Auto-proceed cancelled due to error')

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
      logger.log('🔓 Final Pack Tool: Verification lock released')
    }
  }

  const handleTrackingSubmit = () => {
    if (!formData.trackingNumber.trim()) {
      toast.error('Please enter a tracking number')
      return
    }

    logger.log(
      '✅ Final Pack Tool: Tracking number captured, proceeding to questions'
    )
    setCurrentStep(2)
  }

  const handleQuestionsSubmit = () => {
    logger.log(
      '✅ Final Pack Tool: 8130-3 questions answered, proceeding to completion'
    )
    setCurrentStep(3)
  }

  const handleFinalPackComplete = async () => {
    try {
      // Update final pack information (trim whitespace from barcode scanner inputs)
      await updateFinalPackInfoAsync({
        deliveryId: formData.deliveryId.trim(),
        finalPackData: {
          tracking_number: formData.trackingNumber.trim(),
          requires_8130_3: formData.requires8130_3,
          has_8130_3: formData.has8130_3,
          is_8130_3_signed: formData.is8130_3Signed,
        },
      })

      // Complete final packing (update status to final_packed)
      await completeFinalPackingAsync(formData.deliveryId.trim())

      setFormData((prev) => ({ ...prev, finalPackComplete: true }))
      logger.log('🎉 Final Pack Tool: Process completed successfully')
    } catch (error) {
      logger.error('Error completing final pack:', error)
    }
  }

  const canProceedToNext = () => {
    switch (currentStep) {
      case 0:
        return formData.deliveryData && formData.deliveryData.length > 0
      case 1:
        return formData.trackingNumber.trim() !== ''
      case 2:
        return true // Questions are optional/can be false
      case 3:
        return formData.finalPackComplete
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
                      Scan Delivery for Final Pack
                    </h3>
                    <p className='text-muted-foreground'>
                      Scan or enter the delivery ID that has been packed or
                      shipped and is ready for final packing
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='finalPackDeliveryId'>Delivery ID</Label>
                      <Input
                        id='finalPackDeliveryId'
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
                            `📝 Final Pack Tool: Delivery ID changed to: ${newValue}`
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

              {/* Step 2: Scan Tracking Number */}
              {currentStep === 1 && (
                <div className='space-y-4'>
                  <div className='space-y-4 text-center'>
                    <Truck className='text-muted-foreground mx-auto h-16 w-16' />
                    <h3 className='text-lg font-semibold'>
                      Enter Tracking Number
                    </h3>
                    <p className='text-muted-foreground'>
                      Scan or enter the tracking number for this shipment
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='trackingNumber'>Tracking Number</Label>
                      <Input
                        id='trackingNumber'
                        placeholder='Scan or enter tracking number'
                        value={formData.trackingNumber}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            trackingNumber: e.target.value,
                          }))
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === 'Enter' &&
                            formData.trackingNumber.trim()
                          ) {
                            e.preventDefault()
                            handleTrackingSubmit()
                          }
                        }}
                        className='text-center text-lg'
                        autoFocus
                      />
                    </div>

                    <Button
                      onClick={handleTrackingSubmit}
                      disabled={!formData.trackingNumber.trim()}
                      className='w-full'
                      size='lg'
                    >
                      <Truck className='mr-2 h-4 w-4' />
                      Continue to Questions
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
                              <span className='font-medium text-green-600 capitalize dark:text-green-400'>
                                {formData.deliveryData[0].status}
                              </span>
                            </p>
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* Step 3: 8130-3 Questions */}
              {currentStep === 2 && (
                <div className='space-y-4'>
                  <div className='space-y-4 text-center'>
                    <FileCheck className='text-muted-foreground mx-auto h-16 w-16' />
                    <h3 className='text-lg font-semibold'>
                      8130-3 Compliance Questions
                    </h3>
                    <p className='text-muted-foreground'>
                      Please answer the following questions about 8130-3
                      documentation
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-6'>
                    <div className='space-y-4'>
                      <div className='flex items-start space-x-3'>
                        <Checkbox
                          id='requires8130_3'
                          checked={formData.requires8130_3}
                          onCheckedChange={(checked) => {
                            setFormData((prev) => ({
                              ...prev,
                              requires8130_3: checked === true,
                            }))
                          }}
                        />
                        <div className='grid gap-1.5 leading-none'>
                          <label
                            htmlFor='requires8130_3'
                            className='text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                          >
                            Does this delivery require 8130-3?
                          </label>
                          <p className='text-muted-foreground text-xs'>
                            Check if 8130-3 documentation is required for this
                            shipment
                          </p>
                        </div>
                      </div>

                      <div className='flex items-start space-x-3'>
                        <Checkbox
                          id='has8130_3'
                          checked={formData.has8130_3}
                          onCheckedChange={(checked) => {
                            setFormData((prev) => ({
                              ...prev,
                              has8130_3: checked === true,
                            }))
                          }}
                        />
                        <div className='grid gap-1.5 leading-none'>
                          <label
                            htmlFor='has8130_3'
                            className='text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                          >
                            Is 8130-3 included?
                          </label>
                          <p className='text-muted-foreground text-xs'>
                            Check if 8130-3 documentation is included with this
                            shipment
                          </p>
                        </div>
                      </div>

                      <div className='flex items-start space-x-3'>
                        <Checkbox
                          id='is8130_3Signed'
                          checked={formData.is8130_3Signed}
                          onCheckedChange={(checked) => {
                            setFormData((prev) => ({
                              ...prev,
                              is8130_3Signed: checked === true,
                            }))
                          }}
                        />
                        <div className='grid gap-1.5 leading-none'>
                          <label
                            htmlFor='is8130_3Signed'
                            className='text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                          >
                            Is 8130-3 signed by ODA?
                          </label>
                          <p className='text-muted-foreground text-xs'>
                            Check if 8130-3 documentation is properly signed by
                            ODA
                          </p>
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={handleQuestionsSubmit}
                      className='w-full'
                      size='lg'
                    >
                      <FileCheck className='mr-2 h-4 w-4' />
                      Continue to Final Pack
                    </Button>

                    <div className='border-border mt-4 rounded-lg border bg-gray-50 p-4 dark:bg-gray-800'>
                      <h4 className='text-foreground mb-2 font-medium'>
                        Summary
                      </h4>
                      <div className='text-foreground space-y-1 text-sm'>
                        <p>
                          <span className='font-medium'>Delivery:</span>{' '}
                          {formData.deliveryId}
                        </p>
                        <p>
                          <span className='font-medium'>Tracking:</span>{' '}
                          {formData.trackingNumber}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Complete Final Pack */}
              {currentStep === 3 && (
                <div className='space-y-4'>
                  <div className='space-y-4 text-center'>
                    <ClipboardCheck className='text-muted-foreground mx-auto h-16 w-16' />
                    <h3 className='text-lg font-semibold'>
                      Complete Final Packing
                    </h3>
                    <p className='text-muted-foreground'>
                      Review all information and complete the final packing
                      process
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-3 rounded-lg border p-4'>
                      <h4 className='font-medium'>Final Pack Summary</h4>
                      <div className='space-y-2 text-sm'>
                        <div className='flex justify-between'>
                          <span>Delivery ID:</span>
                          <span className='font-mono'>
                            {formData.deliveryId}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Tracking Number:</span>
                          <span className='font-mono'>
                            {formData.trackingNumber}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Requires 8130-3:</span>
                          <span
                            className={
                              formData.requires8130_3
                                ? 'text-orange-600'
                                : 'text-gray-600'
                            }
                          >
                            {formData.requires8130_3 ? 'Yes' : 'No'}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span>8130-3 Included:</span>
                          <span
                            className={
                              formData.has8130_3
                                ? 'text-green-600'
                                : 'text-red-600'
                            }
                          >
                            {formData.has8130_3 ? 'Yes' : 'No'}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span>8130-3 Signed:</span>
                          <span
                            className={
                              formData.is8130_3Signed
                                ? 'text-green-600'
                                : 'text-red-600'
                            }
                          >
                            {formData.is8130_3Signed ? 'Yes' : 'No'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {!formData.finalPackComplete ? (
                      <Button
                        onClick={handleFinalPackComplete}
                        disabled={
                          isUpdatingFinalPackInfo || isCompletingFinalPacking
                        }
                        className='w-full'
                        size='lg'
                      >
                        {isUpdatingFinalPackInfo || isCompletingFinalPacking ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            Completing Final Pack...
                          </>
                        ) : (
                          <>
                            <ClipboardCheck className='mr-2 h-4 w-4' />
                            Complete Final Packing
                          </>
                        )}
                      </Button>
                    ) : (
                      <div className='rounded-lg border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950/30'>
                        <CheckCircle className='mx-auto mb-4 h-12 w-12 text-green-500 dark:text-green-400' />
                        <h4 className='mb-2 font-medium text-green-700 dark:text-green-300'>
                          Final Packing Complete!
                        </h4>
                        <p className='mb-4 text-sm text-green-600 dark:text-green-400'>
                          Delivery {formData.deliveryId} has been successfully
                          final packed and is ready for shipment.
                        </p>
                        <Button
                          onClick={() => {
                            setCurrentStep(0)

                            // Clear all timeouts for fresh start
                            if (autoVerifyTimeout) {
                              clearTimeout(autoVerifyTimeout)
                              setAutoVerifyTimeout(null)
                            }
                            setIsAutoVerifyPending(false)
                            setHasAutoProceedTriggered(false)

                            setFormData({
                              deliveryId: '',
                              trackingNumber: '',
                              requires8130_3: false,
                              has8130_3: false,
                              is8130_3Signed: false,
                              finalPackComplete: false,
                            })
                          }}
                          variant='outline'
                          className='w-full'
                        >
                          Start New Final Pack
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
      {currentStep < steps.length - 1 && !formData.finalPackComplete && (
        <div className='flex justify-between'>
          <Button
            variant='outline'
            onClick={() => {
              const newStep = Math.max(0, currentStep - 1)
              setCurrentStep(newStep)

              // When going back to step 0, clear everything for fresh start
              if (newStep === 0) {
                logger.log(
                  '🔄 Final Pack Tool: Navigating back to step 0 - clearing delivery field for fresh start'
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
                  trackingNumber: '',
                  requires8130_3: false,
                  has8130_3: false,
                  is8130_3Signed: false,
                  finalPackComplete: false,
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

export default FinalPackToolForm

// Created and developed by Jai Singh
