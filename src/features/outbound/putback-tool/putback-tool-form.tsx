// Created and developed by Jai Singh
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Printer,
  RotateCcw,
  Scan,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { usePutbackTool } from '@/hooks/use-outbound-to-data'
import { Barcode } from '@/components/ui/barcode'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { QRCode } from '@/components/ui/shadcn-io/qr-code'

// Types
interface PutbackMaterial {
  material: string
  material_description: string
  source_storage_bin: string
  batch?: string
  quantity: number
}

interface FormData {
  deliveryId: string
  selectedMaterial?: PutbackMaterial
  quantityToReturn: number
  putbackTicket?: {
    putbackNumber: string
    created: boolean
  }
  deliveryMaterials: PutbackMaterial[]
}

// Stepper Context (reusing from Pack Tool)
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

// Stepper Components (reused from Pack Tool)
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
const PutbackToolForm = () => {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<FormData>({
    deliveryId: '',
    quantityToReturn: 0,
    deliveryMaterials: [],
  })
  const [autoVerifyTimeout, setAutoVerifyTimeout] =
    useState<NodeJS.Timeout | null>(null)
  const [isAutoVerifyPending, setIsAutoVerifyPending] = useState(false)

  // 🔒 CONCURRENT OPERATION LOCK - Prevent race conditions (same pattern as Pack Tool)
  const verificationInProgressRef = useRef(false)

  // 🎯 CURRENT VALUE REF - Track latest delivery ID to detect stale timers
  const currentDeliveryIdRef = useRef(formData.deliveryId)

  // Update ref whenever delivery ID changes
  useEffect(() => {
    currentDeliveryIdRef.current = formData.deliveryId
  }, [formData.deliveryId])

  // Use the putback tool hook
  const {
    validateDeliveryAsync,
    isValidatingDelivery,
    createPutbackTicketAsync,
    isCreatingTicket,
  } = usePutbackTool()

  // Auth state management
  const { authState } = useUnifiedAuth()
  const { isAuthenticated, isLoading: isAuthLoading } = authState

  // 3-step process for putback tool
  const steps = [
    {
      id: 1,
      title: 'Scan Delivery',
      icon: Scan,
      description: 'Verify delivery for putback',
    },
    {
      id: 2,
      title: 'Enter Return Quantity',
      icon: RotateCcw,
      description: 'Select material and quantity',
    },
    {
      id: 3,
      title: 'Generate Putback Ticket',
      icon: Printer,
      description: 'Create and print ticket',
    },
  ]

  // Auto-focus delivery ID field when on step 0
  useEffect(() => {
    logger.log(`🔄 Putback Tool: Step changed to ${currentStep}`)

    if (currentStep === 0) {
      logger.log('🎯 Putback Tool: Auto-focusing delivery ID field')
      setTimeout(() => {
        const deliveryInput = document.getElementById(
          'putbackDeliveryId'
        ) as HTMLInputElement
        if (deliveryInput) {
          deliveryInput.focus()
          logger.log('✅ Putback Tool: Delivery ID field focused')
        }
      }, 100)
    }
  }, [currentStep])

  // Auto-verify delivery ID after user stops typing
  useEffect(() => {
    // 🔒 Check lock at entry - don't set new timer if verification already running
    if (verificationInProgressRef.current) {
      logger.log(
        '🔒 Putback Tool: Verification lock active, skipping auto-verify timer setup'
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
      formData.deliveryId.length >= 6
    ) {
      // Capture the CURRENT delivery ID value that this timer is for
      const capturedDeliveryId = formData.deliveryId
      logger.log(
        `⏱️ Putback Tool: Starting auto-verify timer for delivery ${capturedDeliveryId}`
      )
      setIsAutoVerifyPending(true)

      const timeoutId = setTimeout(async () => {
        // 🔒 Double-check lock before executing verification
        if (verificationInProgressRef.current) {
          logger.log(
            '🔒 Putback Tool: Verification already in progress, skipping auto-verify callback'
          )
          setIsAutoVerifyPending(false)
          return
        }

        // 🎯 CRITICAL FIX: Verify the delivery ID hasn't changed since timer was set
        // Use ref to check ACTUAL current value, not closure variable
        if (currentDeliveryIdRef.current !== capturedDeliveryId) {
          logger.log(
            `⏭️ Putback Tool: Delivery ID changed from ${capturedDeliveryId} to ${currentDeliveryIdRef.current}, skipping stale auto-verify`
          )
          setIsAutoVerifyPending(false)
          return
        }

        logger.log(
          `🤖 Putback Tool: Auto-verifying delivery ${currentDeliveryIdRef.current} (no button click needed)`
        )
        setIsAutoVerifyPending(false)

        if (!isValidatingDelivery && !isAuthLoading) {
          await handleDeliveryValidation()
        }
      }, 1500) // 1.5 second delay

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleDeliveryValidation excluded: would cause effect re-run every render
  }, [formData.deliveryId, currentStep, isValidatingDelivery, isAuthLoading])

  const handleDeliveryValidation = async () => {
    // 🔒 LOCK: Check if verification already in progress - prevent concurrent verifications
    if (verificationInProgressRef.current) {
      logger.log(
        '🔒 Putback Tool: Verification already in progress, blocking concurrent attempt'
      )
      return
    }

    try {
      // 🔒 ACQUIRE LOCK
      verificationInProgressRef.current = true
      logger.log('🔓 Putback Tool: Verification lock acquired')

      // Clear any pending auto-verify timeout
      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
        setAutoVerifyTimeout(null)
        setIsAutoVerifyPending(false)
      }

      // Ensure auth state is fresh
      logger.log('🔍 Putback Tool: Validating auth state...')

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
        '✅ Auth state validated, proceeding with delivery validation...'
      )

      // Validate delivery for putback (trim whitespace from barcode scanner input)
      const result = await validateDeliveryAsync(formData.deliveryId.trim())

      if (result.exists && result.materials) {
        logger.log(
          '✅ Putback Tool: Delivery validation successful, data loaded.'
        )
        logger.log(
          `📋 Delivery has ${result.materials.length} materials available for putback`
        )

        // Update form data with delivery materials
        setFormData((prev) => ({
          ...prev,
          deliveryMaterials: result.materials || [],
        }))

        // Auto-proceed to next step
        logger.log(
          '🚀 Putback Tool: Auto-proceeding to step 1 (Material Selection)'
        )
        setCurrentStep(1)
      } else {
        logger.log(
          '❌ Putback Tool: Delivery not found or no materials available for putback'
        )

        // Clear the delivery field for immediate retry
        setFormData((prev) => ({ ...prev, deliveryId: '' }))

        // Auto-focus back to delivery field
        setTimeout(() => {
          const deliveryInput = document.getElementById(
            'putbackDeliveryId'
          ) as HTMLInputElement
          if (deliveryInput) {
            deliveryInput.focus()
            logger.log('🎯 Putback Tool: Delivery field focused for retry')
          }
        }, 100)
      }
    } catch (error) {
      logger.error('Error validating delivery:', error)
    } finally {
      // 🔒 RELEASE LOCK - Always release the lock, even if error occurs
      verificationInProgressRef.current = false
      logger.log('🔓 Putback Tool: Verification lock released')
    }
  }

  const handleMaterialSelection = (materialKey: string) => {
    const selectedMaterial = formData.deliveryMaterials.find(
      (m, index) =>
        `${m.material}-${m.source_storage_bin}-${m.batch || ''}-${index}` ===
        materialKey
    )

    if (selectedMaterial) {
      setFormData((prev) => ({
        ...prev,
        selectedMaterial,
        quantityToReturn: 0, // Reset to blank when selecting new material
      }))
    }
  }

  const handleCreatePutbackTicket = async () => {
    if (!formData.selectedMaterial || formData.quantityToReturn <= 0) {
      toast.error('Please select a material and enter a valid quantity')
      return
    }

    if (formData.quantityToReturn > 99999) {
      toast.error('Quantity cannot exceed 99,999 pieces')
      return
    }

    try {
      logger.log('🎫 Creating putback ticket with data:', {
        deliveryId: formData.deliveryId,
        materialNumber: formData.selectedMaterial.material,
        quantityReturned: formData.quantityToReturn,
        originalStorageBin: formData.selectedMaterial.source_storage_bin,
      })

      const putbackData = {
        deliveryId: formData.deliveryId.trim(),
        materialNumber: formData.selectedMaterial.material,
        materialDescription: formData.selectedMaterial.material_description,
        quantityReturned: formData.quantityToReturn,
        originalStorageBin: formData.selectedMaterial.source_storage_bin,
        originalDeliveryData: formData.selectedMaterial as unknown as Record<
          string,
          unknown
        >,
      }

      const ticket = await createPutbackTicketAsync(putbackData)

      logger.log(
        '✅ Putback ticket created successfully:',
        ticket.putback_number
      )

      // Capture current form data for print function (to avoid closure issues)
      const ticketDataForPrint = {
        putbackNumber: ticket.putback_number,
        deliveryId: formData.deliveryId,
        selectedMaterial: formData.selectedMaterial,
        quantityToReturn: formData.quantityToReturn,
      }

      // Update form data with ticket info
      setFormData((prev) => ({
        ...prev,
        putbackTicket: {
          putbackNumber: ticket.putback_number,
          created: true,
        },
      }))

      setCurrentStep(2)

      // Automatically print the putback ticket after a brief delay
      // Delay ensures DOM updates and state changes are complete
      // Pass ticket data directly to avoid state closure issues
      setTimeout(() => {
        printPutbackTicketWithData(ticketDataForPrint)
      }, 500)
    } catch (error) {
      logger.error('❌ Error creating putback ticket:', error)

      // Show detailed error information to help debug
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const pgError = error as Error & { details?: string; hint?: string }
      const errorDetails = pgError.details || pgError.hint || ''

      toast.error(
        `Failed to create putback ticket: ${errorMessage}${errorDetails ? ` (${errorDetails})` : ''}`,
        { duration: 5000 }
      )
    }
  }

  const printPutbackTicketWithData = async (ticketData: {
    putbackNumber: string
    deliveryId: string
    selectedMaterial: PutbackMaterial
    quantityToReturn: number
  }) => {
    try {
      // Generate QR code as data URL for printing
      const QRCode = await import('qrcode')
      const qrCodeDataUrl = await QRCode.toDataURL(ticketData.putbackNumber, {
        errorCorrectionLevel: 'M',
        width: 200,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      })

      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        toast.error(
          'Unable to open print window. Please check your browser settings.'
        )
        return
      }

      const currentDateTime = new Date().toLocaleString()
      const { profile } = authState

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OmniFrame - Putback Ticket</title>
            <style>
              @media print {
                body {
                  margin: 0;
                  padding: 0;
                }
                .label-container {
                  width: 4in;
                  height: 6in;
                  padding: 0.25in;
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
                  height: 6in;
                  padding: 0.25in;
                  box-sizing: border-box;
                  border: 1px dashed #ccc;
                  background: white;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
              }
              .label-content {
                display: flex;
                flex-direction: column;
                height: 100%;
                font-family: 'Courier New', monospace;
                color: #000;
              }
              .header {
                text-align: center;
                border-bottom: 2px solid #000;
                padding-bottom: 0.15in;
                margin-bottom: 0.15in;
              }
              .ticket-number {
                font-size: 28pt;
                font-weight: bold;
                margin: 0.1in 0;
                letter-spacing: 0.05in;
              }
              .title {
                font-size: 16pt;
                font-weight: bold;
                margin-bottom: 0.05in;
              }
              .section {
                margin-bottom: 0.15in;
                flex: 1;
              }
              .field-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 0.08in;
                font-size: 11pt;
              }
              .field-label {
                font-weight: bold;
                color: #4a5568;
              }
              .field-value {
                color: #2d3748;
                font-weight: bold;
              }
              .barcode-section {
                text-align: center;
                margin: 0.15in 0;
                padding: 0.1in;
                border: 1px solid #ddd;
                background: #f9f9f9;
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 0.15in;
              }
              .qr-code-image {
                width: 1.5in;
                height: 1.5in;
              }
              .barcode-text {
                font-size: 18pt;
                font-weight: bold;
                letter-spacing: 0.1in;
                font-family: 'Courier New', monospace;
                flex: 1;
              }
              .footer {
                border-top: 2px solid #000;
                padding-top: 0.1in;
                text-align: center;
                font-size: 9pt;
                color: #666;
              }
              .instructions {
                margin-top: 0.1in;
                padding: 0.1in;
                background: #fff3cd;
                border: 1px solid #ffc107;
                font-size: 10pt;
                text-align: center;
              }
            </style>
          </head>
          <body>
            <div class="label-container">
              <div class="label-content">
                <div class="header">
                  <div class="title">PUTBACK TICKET</div>
                  <div class="ticket-number">${ticketData.putbackNumber}</div>
                </div>
                
                <div class="section">
                  <div class="field-row">
                    <span class="field-label">Delivery:</span>
                    <span class="field-value">${ticketData.deliveryId}</span>
                  </div>
                  <div class="field-row">
                    <span class="field-label">Material:</span>
                    <span class="field-value">${ticketData.selectedMaterial.material}</span>
                  </div>
                  <div class="field-row">
                    <span class="field-label">Description:</span>
                    <span class="field-value">${ticketData.selectedMaterial.material_description || 'N/A'}</span>
                  </div>
                  <div class="field-row">
                    <span class="field-label">Quantity:</span>
                    <span class="field-value">${ticketData.quantityToReturn} pieces</span>
                  </div>
                  <div class="field-row">
                    <span class="field-label">Return to Bin:</span>
                    <span class="field-value">${ticketData.selectedMaterial.source_storage_bin}</span>
                  </div>
                  ${
                    ticketData.selectedMaterial.batch
                      ? `
                  <div class="field-row">
                    <span class="field-label">Batch:</span>
                    <span class="field-value">${ticketData.selectedMaterial.batch}</span>
                  </div>
                  `
                      : ''
                  }
                </div>
                
                <div class="barcode-section">
                  <img src="${qrCodeDataUrl}" alt="QR Code" class="qr-code-image" />
                  <div class="barcode-text">${ticketData.putbackNumber}</div>
                </div>
                
                <div class="instructions">
                  <strong>INSTRUCTIONS:</strong> Return materials to specified storage bin
                </div>
                
                <div class="footer">
                  <div>Created by: ${profile?.full_name || profile?.username || profile?.email || 'System'}</div>
                  <div>Date: ${currentDateTime}</div>
                  <div>OmniFrame Logistics - Putback Operations</div>
                </div>
              </div>
            </div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(function() {
                  window.close();
                }, 100);
              };
            </script>
          </body>
        </html>
      `)

      printWindow.document.close()
      logger.log(
        '🖨️ Putback ticket print dialog initiated for:',
        ticketData.putbackNumber
      )
    } catch (error) {
      logger.error('Print error:', error)
      toast.error(
        'Failed to print putback ticket. You can still use the on-screen ticket.',
        {
          duration: 4000,
        }
      )
    }
  }

  const canProceedToNext = () => {
    switch (currentStep) {
      case 0:
        return formData.deliveryMaterials.length > 0 // Delivery validated
      case 1:
        return formData.selectedMaterial && formData.quantityToReturn > 0 // Material selected
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
                      Scan Delivery for Putback
                    </h3>
                    <p className='text-muted-foreground'>
                      Scan or enter the delivery ID to validate materials for
                      putback
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='putbackDeliveryId'>Delivery ID</Label>
                      <Input
                        id='putbackDeliveryId'
                        placeholder='Scan or enter delivery ID'
                        value={formData.deliveryId}
                        onChange={(e) => {
                          const newValue = e.target.value
                          setFormData((prev) => ({
                            ...prev,
                            deliveryId: newValue,
                          }))

                          // Clear any pending auto-verify timeout
                          if (autoVerifyTimeout) {
                            clearTimeout(autoVerifyTimeout)
                            setAutoVerifyTimeout(null)
                          }
                          setIsAutoVerifyPending(false)

                          logger.log(
                            `📝 Putback Tool: Delivery ID changed to: ${newValue}`
                          )
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === 'Enter' &&
                            formData.deliveryId &&
                            !isValidatingDelivery &&
                            !isAuthLoading
                          ) {
                            e.preventDefault()

                            // Clear auto-verify timeout when user manually triggers with Enter
                            if (autoVerifyTimeout) {
                              clearTimeout(autoVerifyTimeout)
                              setAutoVerifyTimeout(null)
                              setIsAutoVerifyPending(false)
                            }

                            handleDeliveryValidation()
                          }
                        }}
                        className='text-center text-lg'
                        autoFocus
                      />
                    </div>

                    <Button
                      onClick={handleDeliveryValidation}
                      disabled={
                        !formData.deliveryId ||
                        isValidatingDelivery ||
                        isAuthLoading
                      }
                      className='w-full'
                      size='lg'
                      variant={isAutoVerifyPending ? 'outline' : 'default'}
                    >
                      {isValidatingDelivery || isAuthLoading ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          {isAuthLoading
                            ? 'Refreshing session...'
                            : 'Validating...'}
                        </>
                      ) : isAutoVerifyPending ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          Validating...
                        </>
                      ) : (
                        <>
                          <Scan className='mr-2 h-4 w-4' />
                          Validate Delivery
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Select Material and Quantity */}
              {currentStep === 1 && (
                <div className='space-y-6'>
                  <div className='space-y-2 text-center'>
                    <RotateCcw className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Select Material and Return Quantity
                    </h3>
                    <p className='text-muted-foreground'>
                      Choose material and enter the{' '}
                      <strong>actual excess quantity</strong> to return to shelf
                    </p>
                  </div>

                  <div className='mx-auto max-w-lg space-y-6'>
                    {/* Material Selection */}
                    <div className='space-y-3'>
                      <Label htmlFor='materialSelect'>Select Material</Label>
                      <Select
                        onValueChange={handleMaterialSelection}
                        value={
                          formData.selectedMaterial
                            ? `${formData.selectedMaterial.material}-${formData.selectedMaterial.source_storage_bin}-${formData.selectedMaterial.batch || ''}-${formData.deliveryMaterials.findIndex((m) => m === formData.selectedMaterial)}`
                            : undefined
                        }
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Choose a material to return' />
                        </SelectTrigger>
                        <SelectContent
                          className='w-full max-w-none'
                          sideOffset={4}
                        >
                          {formData.deliveryMaterials.map((material, index) => {
                            const key = `${material.material}-${material.source_storage_bin}-${material.batch || ''}-${index}`
                            return (
                              <SelectItem
                                key={key}
                                value={key}
                                className='cursor-pointer'
                              >
                                {material.material} -{' '}
                                {material.material_description?.substring(
                                  0,
                                  40
                                )}
                                {material.material_description &&
                                material.material_description.length > 40
                                  ? '...'
                                  : ''}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Quantity Input */}
                    {formData.selectedMaterial && (
                      <div className='space-y-3'>
                        <Label htmlFor='returnQuantity'>
                          Quantity to Return to Shelf
                        </Label>
                        <div className='space-y-2'>
                          <div className='flex items-center space-x-2'>
                            <Input
                              id='returnQuantity'
                              type='number'
                              min='0'
                              max='99999'
                              placeholder='Enter excess quantity to return'
                              value={
                                formData.quantityToReturn === 0
                                  ? ''
                                  : formData.quantityToReturn
                              }
                              onChange={(e) => {
                                const value =
                                  e.target.value === ''
                                    ? 0
                                    : parseInt(e.target.value) || 0
                                setFormData((prev) => ({
                                  ...prev,
                                  quantityToReturn: Math.min(value, 99999),
                                }))
                              }}
                              onWheel={(e) => {
                                // Prevent scroll wheel from changing the number
                                e.currentTarget.blur()
                              }}
                              className='flex-1'
                            />
                            <span className='text-muted-foreground text-xs'>
                              pieces
                            </span>
                          </div>
                          <p className='text-muted-foreground text-xs'>
                            💡 Enter the actual excess quantity you need to
                            return to shelf (can be more than delivery quantity)
                          </p>
                        </div>

                        {/* Material Details */}
                        <div className='space-y-3 rounded-lg border bg-gray-50 p-4 dark:bg-gray-800'>
                          <h4 className='text-foreground font-semibold'>
                            Selected Material Details:
                          </h4>
                          <div className='grid grid-cols-2 gap-3 text-sm'>
                            <div className='space-y-1'>
                              <span className='text-foreground font-medium'>
                                Material:
                              </span>
                              <div className='text-foreground rounded border bg-white px-2 py-1 font-mono dark:bg-gray-700'>
                                {formData.selectedMaterial.material}
                              </div>
                            </div>
                            <div className='space-y-1'>
                              <span className='text-foreground font-medium'>
                                Storage Bin:
                              </span>
                              <div className='text-foreground rounded border bg-white px-2 py-1 font-mono dark:bg-gray-700'>
                                {formData.selectedMaterial.source_storage_bin}
                              </div>
                            </div>
                            {formData.selectedMaterial.batch && (
                              <div className='space-y-1'>
                                <span className='text-foreground font-medium'>
                                  Batch:
                                </span>
                                <div className='text-foreground rounded border bg-white px-2 py-1 font-mono dark:bg-gray-700'>
                                  {formData.selectedMaterial.batch}
                                </div>
                              </div>
                            )}
                            <div className='space-y-1'>
                              <span className='text-foreground font-medium'>
                                Delivery Quantity:
                              </span>
                              <div className='text-foreground rounded border bg-white px-2 py-1 font-semibold dark:bg-gray-700'>
                                {formData.selectedMaterial.quantity} pieces
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Generate Putback Ticket */}
              {currentStep === 2 && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <Printer className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Generate Putback Ticket
                    </h3>
                    <p className='text-muted-foreground'>
                      Review details and generate the putback ticket
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    {!formData.putbackTicket?.created ? (
                      <>
                        {/* Summary before ticket creation */}
                        <div className='space-y-3 rounded-lg border p-4'>
                          <h4 className='font-medium'>Putback Summary</h4>
                          <div className='space-y-2 text-sm'>
                            <div className='flex justify-between'>
                              <span>Delivery ID:</span>
                              <span className='font-mono'>
                                {formData.deliveryId}
                              </span>
                            </div>
                            <div className='flex justify-between'>
                              <span>Material:</span>
                              <span className='font-mono'>
                                {formData.selectedMaterial?.material}
                              </span>
                            </div>
                            <div className='flex justify-between'>
                              <span>Quantity:</span>
                              <span>{formData.quantityToReturn} pieces</span>
                            </div>
                            <div className='flex justify-between'>
                              <span>Storage Bin:</span>
                              <span className='font-mono'>
                                {formData.selectedMaterial?.source_storage_bin}
                              </span>
                            </div>
                          </div>
                        </div>

                        <Button
                          onClick={handleCreatePutbackTicket}
                          disabled={
                            isCreatingTicket || !formData.selectedMaterial
                          }
                          className='w-full'
                          size='lg'
                        >
                          {isCreatingTicket ? (
                            <>
                              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                              Creating Ticket...
                            </>
                          ) : (
                            <>
                              <FileText className='mr-2 h-4 w-4' />
                              Generate Putback Ticket
                            </>
                          )}
                        </Button>
                      </>
                    ) : (
                      /* Ticket created successfully */
                      <div className='rounded-lg border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950/30'>
                        <CheckCircle className='mx-auto mb-4 h-12 w-12 text-green-500 dark:text-green-400' />
                        <h4 className='mb-2 font-medium text-green-700 dark:text-green-300'>
                          Putback Ticket Created Successfully!
                        </h4>

                        {/* Ticket Display */}
                        <div className='bg-card my-4 rounded-lg border-2 border-dashed border-green-300 p-6 shadow-sm dark:border-green-600'>
                          <div className='space-y-4'>
                            <div className='text-card-foreground text-center font-mono text-2xl font-bold'>
                              {formData.putbackTicket.putbackNumber}
                            </div>

                            {/* QR Code and Barcode */}
                            <div className='flex items-center justify-center gap-4 py-2'>
                              {/* QR Code */}
                              <div className='flex flex-col items-center space-y-1'>
                                <div className='bg-background border-border h-24 w-24 rounded border'>
                                  <QRCode
                                    data={formData.putbackTicket.putbackNumber}
                                    className='h-full w-full p-1'
                                    robustness='M'
                                  />
                                </div>
                                <span className='text-card-foreground/70 text-xs font-medium'>
                                  QR Code
                                </span>
                              </div>

                              {/* Separator */}
                              <div className='bg-border h-16 w-px'></div>

                              {/* Barcode */}
                              <div className='flex flex-col items-center space-y-1'>
                                <div className='bg-background border-border rounded border p-2'>
                                  <Barcode
                                    value={formData.putbackTicket.putbackNumber}
                                    width={2}
                                    height={60}
                                    fontSize={12}
                                    displayValue={false}
                                  />
                                </div>
                                <span className='text-card-foreground/70 text-xs font-medium'>
                                  Barcode
                                </span>
                              </div>
                            </div>

                            <div className='text-card-foreground space-y-1 text-sm'>
                              <div>
                                <strong className='text-card-foreground'>
                                  Material:
                                </strong>{' '}
                                <span className='font-mono'>
                                  {formData.selectedMaterial?.material}
                                </span>
                              </div>
                              <div>
                                <strong className='text-card-foreground'>
                                  Quantity:
                                </strong>{' '}
                                <span className='font-mono'>
                                  {formData.quantityToReturn} pieces
                                </span>
                              </div>
                              <div>
                                <strong className='text-card-foreground'>
                                  Return to Bin:
                                </strong>{' '}
                                <span className='font-mono'>
                                  {
                                    formData.selectedMaterial
                                      ?.source_storage_bin
                                  }
                                </span>
                              </div>
                              <div>
                                <strong className='text-card-foreground'>
                                  Date:
                                </strong>{' '}
                                <span className='font-mono'>
                                  {new Date().toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <p className='mb-4 text-sm text-green-600 dark:text-green-400'>
                          The putback ticket has been generated and is ready for
                          printing.
                        </p>

                        <Button
                          onClick={() => {
                            // Reset form for next putback
                            setCurrentStep(0)
                            setFormData({
                              deliveryId: '',
                              quantityToReturn: 0,
                              deliveryMaterials: [],
                            })
                          }}
                          variant='outline'
                          className='w-full'
                        >
                          Create New Putback
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
      {currentStep < steps.length - 1 && !formData.putbackTicket?.created && (
        <div className='flex justify-between'>
          <Button
            variant='outline'
            onClick={() => {
              const newStep = Math.max(0, currentStep - 1)
              setCurrentStep(newStep)

              // Clear form data when going back to delivery step
              if (newStep === 0) {
                setFormData({
                  deliveryId: '',
                  quantityToReturn: 0,
                  deliveryMaterials: [],
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
              if (currentStep === 1) {
                // Handle creation on step 1 -> 2 transition
                handleCreatePutbackTicket()
              } else {
                const maxStep = steps.length - 1
                const newStep = Math.min(maxStep, currentStep + 1)
                setCurrentStep(newStep)
              }
            }}
            disabled={
              !canProceedToNext() || (currentStep === 1 && isCreatingTicket)
            }
          >
            {currentStep === 1 ? (
              isCreatingTicket ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Creating...
                </>
              ) : (
                <>
                  Generate Ticket
                  <ChevronRight className='ml-2 h-4 w-4' />
                </>
              )
            ) : (
              <>
                Next
                <ChevronRight className='ml-2 h-4 w-4' />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

export default PutbackToolForm

// Created and developed by Jai Singh
