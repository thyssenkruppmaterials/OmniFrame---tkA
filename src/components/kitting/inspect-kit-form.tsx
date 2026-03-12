'use client'

/**
 * Inspect Kit Form Component
 * A step-by-step workflow for inspecting kitted materials
 * Verifies that each part was put into the kit correctly
 * Design follows Build Kit / Pack Tool pattern for consistency
 * Created: December 14, 2025
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Eye,
  Loader2,
  Package,
  Scan,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useInspectKitTool } from '@/hooks/use-inspect-kit'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Types
interface TOLine {
  id: string
  transferOrderNumber: string
  material: string
  materialDescription: string
  sourceStorageBin: string
  destStorageBin: string
  quantity: number
  kitted: boolean
  kittedBy: string | null
  kittedAt: string | null
  inspected: boolean
  inspectedBy: string | null
  inspectedAt: string | null
}

interface KitData {
  kitPoNumber: string
  kitBuildNumber: string
  kitNumber: string
  engineProgram: string
  deliverToPlant: string
  dueDate: string | null
  status: string
  totalLines: number
  inspectedLines: number
  toLines: TOLine[]
}

interface FormData {
  kitPoNumber: string
  kitData: KitData | null
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
  ({ step, completed = false, className, children, ...props }, ref) => {
    const { activeStep } = useStepper()
    const state =
      completed || step < activeStep
        ? 'completed'
        : activeStep === step
          ? 'active'
          : 'inactive'

    return (
      <div
        ref={ref}
        className={cn(
          'group/step flex items-center group-data-[orientation=horizontal]/stepper:flex-row group-data-[orientation=vertical]/stepper:flex-col',
          className
        )}
        data-state={state}
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
const InspectKitForm = () => {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<FormData>({
    kitPoNumber: '',
    kitData: null,
  })

  // Use the inspect kit hook
  const {
    verifyKitAsync,
    isVerifyingKit,
    startInspectionAsync,
    isStartingInspection,
    markLineInspectedAsync,
    isMarkingLine,
    unmarkLineInspectedAsync,
    isUnmarkingLine,
    completeInspectionAsync,
    isCompletingInspection,
  } = useInspectKitTool()

  // Auth state management
  const { authState } = useUnifiedAuth()
  const { isAuthenticated, isLoading: isAuthLoading } = authState

  // Auto-proceed flag
  const [hasAutoProceedTriggered, setHasAutoProceedTriggered] = useState(false)

  // Auto-verify trigger
  const [autoVerifyTimeout, setAutoVerifyTimeout] =
    useState<NodeJS.Timeout | null>(null)
  const [isAutoVerifyPending, setIsAutoVerifyPending] = useState(false)

  // Concurrent operation locks
  const verificationInProgressRef = useRef(false)

  // Current value refs
  const currentKitPoRef = useRef(formData.kitPoNumber)

  // Update refs when values change
  useEffect(() => {
    currentKitPoRef.current = formData.kitPoNumber
  }, [formData.kitPoNumber])

  // Auto-focus kit PO field when on step 0
  useEffect(() => {
    if (currentStep === 0) {
      setTimeout(() => {
        const kitPoInput = document.getElementById(
          'inspectKitPoNumber'
        ) as HTMLInputElement
        if (kitPoInput) {
          kitPoInput.focus()
        }
      }, 100)
    }
  }, [currentStep])

  // Auto-verify kit PO after user stops typing
  useEffect(() => {
    if (verificationInProgressRef.current) return

    if (autoVerifyTimeout) {
      clearTimeout(autoVerifyTimeout)
      setAutoVerifyTimeout(null)
      setIsAutoVerifyPending(false)
    }

    if (
      currentStep === 0 &&
      formData.kitPoNumber &&
      formData.kitPoNumber.length >= 4 &&
      !hasAutoProceedTriggered
    ) {
      const capturedKitPo = formData.kitPoNumber
      setIsAutoVerifyPending(true)

      const timeoutId = setTimeout(async () => {
        if (verificationInProgressRef.current) {
          setIsAutoVerifyPending(false)
          return
        }

        if (currentKitPoRef.current !== capturedKitPo) {
          setIsAutoVerifyPending(false)
          return
        }

        setIsAutoVerifyPending(false)

        if (!isVerifyingKit && !isAuthLoading) {
          handleKitPoScan()
        }
      }, 1500)

      setAutoVerifyTimeout(timeoutId)
    } else {
      setIsAutoVerifyPending(false)
    }

    return () => {
      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
        setAutoVerifyTimeout(null)
        setIsAutoVerifyPending(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Timer state and handler excluded to prevent set/re-run loops
  }, [
    formData.kitPoNumber,
    currentStep,
    hasAutoProceedTriggered,
    isVerifyingKit,
    isAuthLoading,
  ])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (autoVerifyTimeout) clearTimeout(autoVerifyTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Unmount-only cleanup
  }, [])

  // Steps definition
  const steps = [
    {
      id: 1,
      title: 'Scan Kit PO',
      icon: Scan,
      description: 'Select kit to inspect',
    },
    {
      id: 2,
      title: 'Verify Parts',
      icon: Eye,
      description: 'Confirm each part is present',
    },
    {
      id: 3,
      title: 'Complete Inspection',
      icon: ClipboardCheck,
      description: 'Finalize inspection',
    },
  ]

  const handleKitPoScan = async () => {
    if (verificationInProgressRef.current) return

    try {
      verificationInProgressRef.current = true

      if (autoVerifyTimeout) {
        clearTimeout(autoVerifyTimeout)
        setAutoVerifyTimeout(null)
        setIsAutoVerifyPending(false)
      }

      if (!isAuthenticated || isAuthLoading) {
        toast.error('Authentication required. Please refresh the page.')
        return
      }

      const result = await verifyKitAsync(formData.kitPoNumber.trim())

      if (result.exists && result.kitData) {
        setFormData((prev) => ({
          ...prev,
          kitData: result.kitData!,
        }))

        // Start the kit inspection if not already in progress
        if (result.kitData.status === 'kit_built') {
          await startInspectionAsync(formData.kitPoNumber.trim())
        }

        if (!hasAutoProceedTriggered) {
          setHasAutoProceedTriggered(true)
          requestAnimationFrame(() => {
            setTimeout(() => {
              setCurrentStep(1)
            }, 500)
          })
        }
      } else {
        setFormData((prev) => ({ ...prev, kitPoNumber: '' }))
        setHasAutoProceedTriggered(false)

        setTimeout(() => {
          const kitPoInput = document.getElementById(
            'inspectKitPoNumber'
          ) as HTMLInputElement
          if (kitPoInput) kitPoInput.focus()
        }, 100)
      }
    } catch (error) {
      logger.error('Error verifying kit:', error)
    } finally {
      verificationInProgressRef.current = false
    }
  }

  const handleVerifyLine = async (lineId: string, _material: string) => {
    try {
      await markLineInspectedAsync(lineId)

      // Update local state
      setFormData((prev) => {
        if (!prev.kitData) return prev

        const updatedLines = prev.kitData.toLines.map((line) =>
          line.id === lineId
            ? {
                ...line,
                inspected: true,
                inspectedBy: 'You',
                inspectedAt: new Date().toISOString(),
              }
            : line
        )

        const newInspectedCount = updatedLines.filter((l) => l.inspected).length

        // Check if all lines are now inspected
        if (newInspectedCount === prev.kitData.totalLines) {
          // Auto-advance to complete step
          setTimeout(() => {
            setCurrentStep(2)
          }, 1000)
        }

        return {
          ...prev,
          kitData: {
            ...prev.kitData,
            inspectedLines: newInspectedCount,
            toLines: updatedLines,
          },
        }
      })
    } catch (error) {
      logger.error('Error verifying line:', error)
    }
  }

  const handleUndoInspection = async (lineId: string, material: string) => {
    try {
      await unmarkLineInspectedAsync(lineId)

      // Update local state
      setFormData((prev) => {
        if (!prev.kitData) return prev

        const updatedLines = prev.kitData.toLines.map((line) =>
          line.id === lineId
            ? {
                ...line,
                inspected: false,
                inspectedBy: null,
                inspectedAt: null,
              }
            : line
        )

        return {
          ...prev,
          kitData: {
            ...prev.kitData,
            inspectedLines: prev.kitData.inspectedLines - 1,
            toLines: updatedLines,
          },
        }
      })

      toast.success(`Verification removed for ${material}`)
    } catch (error) {
      logger.error('Error undoing inspection:', error)
    }
  }

  const handleCompleteInspection = async () => {
    try {
      const result = await completeInspectionAsync(formData.kitPoNumber)

      if (result.success) {
        setFormData((prev) => ({
          ...prev,
          kitData: prev.kitData
            ? { ...prev.kitData, status: 'kit_inspected' }
            : null,
        }))
      }
    } catch (error) {
      logger.error('Error completing inspection:', error)
    }
  }

  const handleStartNewInspection = useCallback(() => {
    setCurrentStep(0)
    setHasAutoProceedTriggered(false)

    if (autoVerifyTimeout) {
      clearTimeout(autoVerifyTimeout)
      setAutoVerifyTimeout(null)
    }
    setIsAutoVerifyPending(false)

    setFormData({
      kitPoNumber: '',
      kitData: null,
    })
  }, [autoVerifyTimeout])

  const allLinesInspected =
    formData.kitData?.toLines.every((line) => line.inspected) ?? false

  const canProceedToNext = () => {
    switch (currentStep) {
      case 0:
        return formData.kitData !== null
      case 1:
        return allLinesInspected
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
              {/* Step 1: Scan Kit PO */}
              {currentStep === 0 && (
                <div className='space-y-4'>
                  <div className='space-y-4 text-center'>
                    <Scan className='text-muted-foreground mx-auto h-16 w-16' />
                    <h3 className='text-lg font-semibold'>
                      Scan Kit PO Number
                    </h3>
                    <p className='text-muted-foreground'>
                      Scan or enter the Kit PO Number to start inspection
                    </p>
                    <p className='text-sm text-amber-600 dark:text-amber-400'>
                      Note: Only kits with "Kit Built" status can be inspected
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='inspectKitPoNumber'>Kit PO Number</Label>
                      <Input
                        id='inspectKitPoNumber'
                        placeholder='Scan or enter Kit PO Number'
                        value={formData.kitPoNumber}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            kitPoNumber: e.target.value,
                          }))
                          setHasAutoProceedTriggered(false)

                          if (autoVerifyTimeout) {
                            clearTimeout(autoVerifyTimeout)
                            setAutoVerifyTimeout(null)
                          }
                          setIsAutoVerifyPending(false)
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === 'Enter' &&
                            formData.kitPoNumber &&
                            !isVerifyingKit &&
                            !isAuthLoading
                          ) {
                            e.preventDefault()

                            if (autoVerifyTimeout) {
                              clearTimeout(autoVerifyTimeout)
                              setAutoVerifyTimeout(null)
                              setIsAutoVerifyPending(false)
                            }

                            handleKitPoScan()
                          }
                        }}
                        className='text-center text-lg'
                        autoFocus
                      />
                    </div>

                    <Button
                      onClick={handleKitPoScan}
                      disabled={
                        !formData.kitPoNumber ||
                        isVerifyingKit ||
                        isAuthLoading ||
                        isStartingInspection
                      }
                      className='w-full'
                      size='lg'
                      variant={isAutoVerifyPending ? 'outline' : 'default'}
                    >
                      {isVerifyingKit ||
                      isAuthLoading ||
                      isStartingInspection ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          {isAuthLoading
                            ? 'Refreshing session...'
                            : isStartingInspection
                              ? 'Starting inspection...'
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
                          Verify Kit
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Verify Parts */}
              {currentStep === 1 && formData.kitData && (
                <div className='space-y-6'>
                  <div className='space-y-2 text-center'>
                    <Eye className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Verify Parts in Kit
                    </h3>
                    <p className='text-muted-foreground'>
                      Visually confirm each part is present in the kit, then
                      click to verify
                    </p>

                    {/* Kit Info Banner */}
                    <div className='mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30'>
                      <div className='flex items-center justify-center gap-4 text-sm'>
                        <div className='text-blue-700 dark:text-blue-300'>
                          <span className='font-medium'>Kit PO:</span>{' '}
                          {formData.kitData.kitPoNumber}
                        </div>
                        <div className='text-blue-700 dark:text-blue-300'>
                          <span className='font-medium'>Progress:</span>{' '}
                          {formData.kitData.inspectedLines}/
                          {formData.kitData.totalLines} verified
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Parts Verification List */}
                  <div className='space-y-4'>
                    <h4 className='text-center font-medium'>Parts to Verify</h4>
                    {formData.kitData.toLines.map((line) => (
                      <div
                        key={line.id}
                        className='space-y-3 rounded-lg border p-4'
                      >
                        <div className='flex items-center justify-between'>
                          <div className='flex-1'>
                            <div className='flex items-center gap-2'>
                              <h5 className='font-mono text-base font-medium'>
                                {line.material}
                              </h5>
                              {line.inspected ? (
                                <CheckCircle className='h-5 w-5 text-green-500' />
                              ) : (
                                <Package className='h-5 w-5 text-gray-400' />
                              )}
                            </div>
                            <p className='text-muted-foreground text-sm'>
                              {line.materialDescription}
                            </p>
                            <p className='text-muted-foreground text-xs'>
                              TO: {line.transferOrderNumber} | Bin:{' '}
                              {line.sourceStorageBin}
                            </p>
                          </div>

                          <div className='flex items-center gap-3 text-right'>
                            <div>
                              <div
                                className={cn(
                                  'text-lg font-bold',
                                  line.inspected
                                    ? 'text-green-600'
                                    : 'text-gray-600'
                                )}
                              >
                                {line.quantity}
                              </div>
                              <p className='text-muted-foreground text-xs'>
                                qty
                              </p>
                            </div>

                            {!line.inspected ? (
                              <Button
                                variant='default'
                                size='sm'
                                onClick={() =>
                                  handleVerifyLine(line.id, line.material)
                                }
                                disabled={isMarkingLine}
                                className='bg-green-600 hover:bg-green-700'
                              >
                                {isMarkingLine ? (
                                  <Loader2 className='h-4 w-4 animate-spin' />
                                ) : (
                                  <>
                                    <CheckCircle className='mr-1 h-4 w-4' />
                                    Verify
                                  </>
                                )}
                              </Button>
                            ) : (
                              <Button
                                variant='ghost'
                                size='sm'
                                onClick={() =>
                                  handleUndoInspection(line.id, line.material)
                                }
                                disabled={isUnmarkingLine}
                                className='text-gray-500 hover:text-red-500'
                              >
                                <Undo2 className='h-4 w-4' />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Status Badge */}
                        {line.inspected ? (
                          <div className='rounded border border-green-200 bg-green-50 p-2 text-center dark:border-green-800 dark:bg-green-950/30'>
                            <p className='text-sm font-medium text-green-700 dark:text-green-300'>
                              ✅ Verified by {line.inspectedBy}
                            </p>
                          </div>
                        ) : (
                          <div className='rounded border border-amber-200 bg-amber-50 p-2 text-center dark:border-amber-800 dark:bg-amber-950/30'>
                            <p className='text-sm text-amber-700 dark:text-amber-300'>
                              <Eye className='mr-1 inline h-4 w-4' />
                              Visually confirm{' '}
                              <span className='font-mono font-bold'>
                                {line.material}
                              </span>{' '}
                              ({line.quantity} pcs) is in the kit
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Progress Bar */}
                  <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30'>
                    <div className='mb-2 flex items-center justify-between'>
                      <span className='text-sm font-medium text-blue-700 dark:text-blue-300'>
                        Verification Progress
                      </span>
                      <span className='text-sm text-blue-600 dark:text-blue-400'>
                        {formData.kitData.inspectedLines} /{' '}
                        {formData.kitData.totalLines} parts verified
                      </span>
                    </div>
                    <div className='h-3 w-full rounded-full bg-blue-200 dark:bg-blue-900'>
                      <div
                        className='h-3 rounded-full bg-blue-500 transition-all duration-300 dark:bg-blue-400'
                        style={{
                          width: `${(formData.kitData.inspectedLines / formData.kitData.totalLines) * 100}%`,
                        }}
                      />
                    </div>
                    {allLinesInspected && (
                      <p className='mt-2 text-sm font-medium text-blue-700 dark:text-blue-300'>
                        ✅ All parts verified! Ready to complete inspection.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Complete Inspection */}
              {currentStep === 2 && formData.kitData && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <ClipboardCheck className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Complete Kit Inspection
                    </h3>
                    <p className='text-muted-foreground'>
                      Review the inspection summary and finalize
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    {/* Kit Summary */}
                    <div className='space-y-3 rounded-lg border p-4'>
                      <h4 className='font-medium'>Inspection Summary</h4>
                      <div className='space-y-2 text-sm'>
                        <div className='flex justify-between'>
                          <span>Kit PO Number:</span>
                          <span className='font-mono'>
                            {formData.kitData.kitPoNumber}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Kit Build Number:</span>
                          <span className='font-mono'>
                            {formData.kitData.kitBuildNumber}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Engine Program:</span>
                          <span>{formData.kitData.engineProgram}</span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Deliver To:</span>
                          <span>{formData.kitData.deliverToPlant}</span>
                        </div>
                        <div className='flex justify-between'>
                          <span>Parts Verified:</span>
                          <span className='font-medium text-green-600'>
                            {formData.kitData.inspectedLines} /{' '}
                            {formData.kitData.totalLines}
                          </span>
                        </div>
                        {formData.kitData.dueDate && (
                          <div className='flex justify-between'>
                            <span>Due Date:</span>
                            <span>
                              {new Date(
                                formData.kitData.dueDate
                              ).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {formData.kitData.status !== 'kit_inspected' ? (
                      <Button
                        onClick={handleCompleteInspection}
                        disabled={!allLinesInspected || isCompletingInspection}
                        className='w-full'
                        size='lg'
                      >
                        {isCompletingInspection ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            Completing Inspection...
                          </>
                        ) : (
                          <>
                            <ClipboardCheck className='mr-2 h-4 w-4' />
                            Complete Inspection
                          </>
                        )}
                      </Button>
                    ) : (
                      <div className='rounded-lg border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950/30'>
                        <CheckCircle className='mx-auto mb-4 h-12 w-12 text-green-500 dark:text-green-400' />
                        <h4 className='mb-2 font-medium text-green-700 dark:text-green-300'>
                          Kit Inspection Completed Successfully!
                        </h4>
                        <p className='mb-4 text-sm text-green-600 dark:text-green-400'>
                          Kit {formData.kitData.kitPoNumber} has been marked as
                          "Kit Inspected"
                        </p>
                        <Button
                          onClick={handleStartNewInspection}
                          variant='outline'
                          className='w-full'
                        >
                          Start New Inspection
                        </Button>
                      </div>
                    )}

                    {!allLinesInspected && (
                      <div className='rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-center dark:border-yellow-800 dark:bg-yellow-950/30'>
                        <AlertCircle className='mx-auto mb-2 h-8 w-8 text-yellow-500' />
                        <p className='text-sm text-yellow-700 dark:text-yellow-300'>
                          Cannot complete inspection.{' '}
                          {formData.kitData.totalLines -
                            formData.kitData.inspectedLines}{' '}
                          parts still need to be verified.
                        </p>
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
      {currentStep < steps.length - 1 &&
        formData.kitData?.status !== 'kit_inspected' && (
          <div className='flex justify-between'>
            <Button
              variant='outline'
              onClick={() => {
                const newStep = Math.max(0, currentStep - 1)
                setCurrentStep(newStep)

                if (newStep === 0) {
                  if (autoVerifyTimeout) {
                    clearTimeout(autoVerifyTimeout)
                    setAutoVerifyTimeout(null)
                  }
                  setIsAutoVerifyPending(false)
                  setHasAutoProceedTriggered(false)
                  setFormData({
                    kitPoNumber: '',
                    kitData: null,
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

export default InspectKitForm
