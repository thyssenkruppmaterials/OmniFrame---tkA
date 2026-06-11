// Created and developed by Jai Singh
'use client'

/**
 * Build Kit Form Component
 * A step-by-step workflow for building/kitting materials
 * Design follows Pack Tool pattern for consistency
 * Created: December 14, 2025
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  PackageCheck,
  Scan,
  Target,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useBuildKitTool } from '@/hooks/use-build-kit'
import { useKitInspectionRequired } from '@/hooks/use-kitting-workflow-settings'
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
}

interface KitData {
  kitPoNumber: string
  // Globally unique kit identity (`KIT-YYYYMMDD-NNN`). Surfaced here so
  // the downstream Build Kit mutations can scope by serial when this
  // PO covers more than one kit — see
  // `memorybank/OmniFrame/Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md`.
  // May be null on legacy rows that predate `createKitBuildPlan`.
  kitSerialNumber: string | null
  kitBuildNumber: string
  kitNumber: string
  engineProgram: string
  deliverToPlant: string
  dueDate: string | null
  status: string
  totalLines: number
  kittedLines: number
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
const BuildKitForm = () => {
  const [currentStep, setCurrentStep] = useState(0)
  const [currentMaterialScan, setCurrentMaterialScan] = useState('')
  const [currentQuantity, setCurrentQuantity] = useState('')
  const [scanError, setScanError] = useState('')
  const [formData, setFormData] = useState<FormData>({
    kitPoNumber: '',
    kitData: null,
  })

  // Use the build kit hook
  const {
    verifyKitAsync,
    isVerifyingKit,
    startBuildAsync,
    isStartingBuild,
    kitMaterialAsync,
    isKittingMaterial,
    unmarkLineKittedAsync,
    isUnmarkingLine,
    completeKitAsync,
    isCompletingKit,
  } = useBuildKitTool()

  // Auth state management
  const { authState } = useUnifiedAuth()
  const { isAuthenticated, isLoading: isAuthLoading } = authState

  // Workflow flag — when off, completeKit jumps straight to On Dock
  // and the per-line inspection stage is bypassed.
  const kitInspectionRequired = useKitInspectionRequired()

  // Auto-proceed flag
  const [hasAutoProceedTriggered, setHasAutoProceedTriggered] = useState(false)

  // Auto-verify trigger
  const [autoVerifyTimeout, setAutoVerifyTimeout] =
    useState<NodeJS.Timeout | null>(null)
  const [isAutoVerifyPending, setIsAutoVerifyPending] = useState(false)

  // Auto-scan trigger
  const [autoScanTimeout, setAutoScanTimeout] = useState<NodeJS.Timeout | null>(
    null
  )
  const [isAutoScanPending, setIsAutoScanPending] = useState(false)

  // Concurrent operation locks
  const verificationInProgressRef = useRef(false)
  const materialScanInProgressRef = useRef(false)

  // Current value refs
  const currentKitPoRef = useRef(formData.kitPoNumber)
  const currentMaterialScanRef = useRef(currentMaterialScan)
  const currentQuantityRef = useRef(currentQuantity)

  // Update refs when values change
  useEffect(() => {
    currentKitPoRef.current = formData.kitPoNumber
  }, [formData.kitPoNumber])

  useEffect(() => {
    currentMaterialScanRef.current = currentMaterialScan
  }, [currentMaterialScan])

  useEffect(() => {
    currentQuantityRef.current = currentQuantity
  }, [currentQuantity])

  // Auto-focus kit PO field when on step 0
  useEffect(() => {
    if (currentStep === 0) {
      setTimeout(() => {
        const kitPoInput = document.getElementById(
          'kitPoNumber'
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

  // Auto-scan for material/quantity workflow
  useEffect(() => {
    if (materialScanInProgressRef.current) return

    if (autoScanTimeout) {
      clearTimeout(autoScanTimeout)
      setAutoScanTimeout(null)
      setIsAutoScanPending(false)
    }

    if (currentStep === 1 && formData.kitData) {
      // Auto-scan material when field has enough characters
      if (currentMaterialScan.trim().length >= 3 && !currentQuantity.trim()) {
        const capturedMaterialScan = currentMaterialScan
        setIsAutoScanPending(true)

        const timeoutId = setTimeout(async () => {
          if (materialScanInProgressRef.current) {
            setIsAutoScanPending(false)
            return
          }

          if (currentMaterialScanRef.current !== capturedMaterialScan) {
            setIsAutoScanPending(false)
            return
          }

          setIsAutoScanPending(false)
          handleMaterialScan()
        }, 1000)

        setAutoScanTimeout(timeoutId)
      }
      // Auto-scan quantity when quantity field has valid number
      else if (currentMaterialScan.trim() && currentQuantity.trim()) {
        const parsedQuantity = parseFloat(currentQuantity.trim())
        const isValidQuantity = !isNaN(parsedQuantity) && parsedQuantity > 0

        if (isValidQuantity) {
          const capturedQuantity = currentQuantity
          const capturedMaterial = currentMaterialScan
          setIsAutoScanPending(true)

          const timeoutId = setTimeout(async () => {
            if (materialScanInProgressRef.current) {
              setIsAutoScanPending(false)
              return
            }

            if (
              currentMaterialScanRef.current !== capturedMaterial ||
              currentQuantityRef.current !== capturedQuantity
            ) {
              setIsAutoScanPending(false)
              return
            }

            setIsAutoScanPending(false)
            handleQuantityScan()
          }, 800)

          setAutoScanTimeout(timeoutId)
        } else {
          setIsAutoScanPending(false)
        }
      } else {
        setIsAutoScanPending(false)
      }
    }

    return () => {
      if (autoScanTimeout) {
        clearTimeout(autoScanTimeout)
        setAutoScanTimeout(null)
        setIsAutoScanPending(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Timer state and handlers excluded to prevent set/re-run loops
  }, [currentMaterialScan, currentQuantity, currentStep, formData.kitData])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (autoVerifyTimeout) clearTimeout(autoVerifyTimeout)
      if (autoScanTimeout) clearTimeout(autoScanTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Unmount-only cleanup
  }, [])

  // Steps definition
  const steps = [
    {
      id: 1,
      title: 'Scan Kit PO',
      icon: Scan,
      description: 'Verify kit exists',
    },
    {
      id: 2,
      title: 'Kit Materials',
      icon: Package,
      description: 'Scan materials and quantities',
    },
    {
      id: 3,
      title: 'Complete Kit',
      icon: PackageCheck,
      description: 'Finalize kit build',
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

        // Start the kit build if not already in progress. Pass the
        // serial when we have one so multi-kit POs don't drag a
        // sibling kit into `in_progress` — see
        // `memorybank/OmniFrame/Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md`.
        if (
          result.kitData.status === 'printed' ||
          result.kitData.status === 'pending'
        ) {
          await startBuildAsync({
            kitPoNumber: formData.kitPoNumber.trim(),
            kitSerialNumber: result.kitData.kitSerialNumber,
          })
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
            'kitPoNumber'
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

  const handleMaterialScan = () => {
    if (materialScanInProgressRef.current) return

    try {
      materialScanInProgressRef.current = true
      setScanError('')

      if (!currentMaterialScan.trim()) {
        setScanError('Please scan or enter a material number')
        toast.error('Please scan a material number first')
        return
      }

      // Find the material in the TO lines
      const matchingLine = formData.kitData?.toLines.find(
        (line) => line.material === currentMaterialScan.trim() && !line.kitted
      )

      if (!matchingLine) {
        const materialExists = formData.kitData?.toLines.some(
          (line) => line.material === currentMaterialScan.trim()
        )

        if (materialExists) {
          setScanError(`Material ${currentMaterialScan} is already kitted`)
          toast.warning(
            `Material ${currentMaterialScan.trim()} already kitted. Scan a different material.`
          )
        } else {
          const expectedMaterials = formData.kitData?.toLines
            .map((line) => line.material)
            .join(', ')
          setScanError(
            `Material ${currentMaterialScan} not found in this kit. Expected: ${expectedMaterials}`
          )
          toast.error(`Material not found. Expected: ${expectedMaterials}`)
        }

        setCurrentMaterialScan('')

        setTimeout(() => {
          const scanInput = document.getElementById(
            'materialScan'
          ) as HTMLInputElement
          if (scanInput) scanInput.focus()
        }, 100)

        return
      }

      // Material validated - jump to quantity field
      setCurrentQuantity('')

      setTimeout(() => {
        const quantityInput = document.getElementById(
          'quantityScan'
        ) as HTMLInputElement
        if (quantityInput) {
          quantityInput.focus()
          quantityInput.select()
        }
      }, 100)

      toast.success(
        `Material ${currentMaterialScan.trim()} found! Expected qty: ${matchingLine.quantity}`
      )
    } finally {
      materialScanInProgressRef.current = false
    }
  }

  const handleQuantityScan = async () => {
    setScanError('')

    if (!currentMaterialScan.trim()) {
      setScanError('Please scan a material first')
      toast.error('Please scan a material first')
      return
    }

    const quantityToVerify = parseFloat(currentQuantity)
    if (isNaN(quantityToVerify) || quantityToVerify <= 0) {
      setScanError('Quantity must be a valid number greater than 0')
      setCurrentQuantity('')

      setTimeout(() => {
        const quantityInput = document.getElementById(
          'quantityScan'
        ) as HTMLInputElement
        if (quantityInput) {
          quantityInput.focus()
          quantityInput.select()
        }
      }, 100)

      toast.error('Invalid quantity. Please scan a valid number.')
      return
    }

    // Kit the material
    try {
      const result = await kitMaterialAsync({
        kitPoNumber: formData.kitPoNumber,
        kitSerialNumber: formData.kitData?.kitSerialNumber ?? null,
        material: currentMaterialScan.trim(),
        quantity: quantityToVerify,
      })

      if (result.success && result.kittedLine) {
        // Update local state with kitted line
        setFormData((prev) => {
          if (!prev.kitData) return prev

          const updatedLines = prev.kitData.toLines.map((line) =>
            line.id === result.kittedLine!.id
              ? {
                  ...line,
                  kitted: true,
                  kittedBy: 'You',
                  kittedAt: new Date().toISOString(),
                }
              : line
          )

          return {
            ...prev,
            kitData: {
              ...prev.kitData,
              kittedLines: prev.kitData.kittedLines + 1,
              toLines: updatedLines,
            },
          }
        })

        // Clear fields for next scan
        setCurrentMaterialScan('')
        setCurrentQuantity('')

        // Check if all lines are kitted
        if (result.allLinesKitted) {
          // Auto-advance to complete step
          setTimeout(() => {
            setCurrentStep(2)
          }, 1000)
        } else {
          // Focus back to material field
          setTimeout(() => {
            const scanInput = document.getElementById(
              'materialScan'
            ) as HTMLInputElement
            if (scanInput) scanInput.focus()
          }, 100)
        }
      } else {
        setScanError(result.error || 'Failed to kit material')
        setCurrentQuantity('')

        setTimeout(() => {
          const quantityInput = document.getElementById(
            'quantityScan'
          ) as HTMLInputElement
          if (quantityInput) {
            quantityInput.focus()
            quantityInput.select()
          }
        }, 100)
      }
    } catch (error) {
      logger.error('Error kitting material:', error)
      setScanError('Failed to kit material')
    }
  }

  const handleUndoKitting = async (lineId: string, material: string) => {
    try {
      await unmarkLineKittedAsync(lineId)

      // Update local state
      setFormData((prev) => {
        if (!prev.kitData) return prev

        const updatedLines = prev.kitData.toLines.map((line) =>
          line.id === lineId
            ? { ...line, kitted: false, kittedBy: null, kittedAt: null }
            : line
        )

        return {
          ...prev,
          kitData: {
            ...prev.kitData,
            kittedLines: prev.kitData.kittedLines - 1,
            toLines: updatedLines,
          },
        }
      })

      toast.success(`Material ${material} unmarked`)
    } catch (error) {
      logger.error('Error undoing kitting:', error)
    }
  }

  const handleCompleteKit = async () => {
    try {
      const result = await completeKitAsync({
        kitPoNumber: formData.kitPoNumber,
        kitSerialNumber: formData.kitData?.kitSerialNumber ?? null,
        skipInspection: !kitInspectionRequired,
      })

      if (result.success) {
        setFormData((prev) => ({
          ...prev,
          kitData: prev.kitData
            ? {
                ...prev.kitData,
                status: result.skippedInspection
                  ? 'kit_inspected'
                  : 'kit_built',
              }
            : null,
        }))
      }
    } catch (error) {
      logger.error('Error completing kit:', error)
    }
  }

  const handleStartNewKit = useCallback(() => {
    setCurrentStep(0)
    setCurrentMaterialScan('')
    setCurrentQuantity('')
    setScanError('')
    setHasAutoProceedTriggered(false)

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
      kitPoNumber: '',
      kitData: null,
    })
  }, [autoVerifyTimeout, autoScanTimeout])

  const allLinesKitted =
    formData.kitData?.toLines.every((line) => line.kitted) ?? false

  const canProceedToNext = () => {
    switch (currentStep) {
      case 0:
        return formData.kitData !== null
      case 1:
        return allLinesKitted
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
                      Scan or enter the Kit PO Number to start building
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='kitPoNumber'>Kit PO Number</Label>
                      <Input
                        id='kitPoNumber'
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
                        isStartingBuild
                      }
                      className='w-full'
                      size='lg'
                      variant={isAutoVerifyPending ? 'outline' : 'default'}
                    >
                      {isVerifyingKit || isAuthLoading || isStartingBuild ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          {isAuthLoading
                            ? 'Refreshing session...'
                            : isStartingBuild
                              ? 'Starting build...'
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

              {/* Step 2: Kit Materials */}
              {currentStep === 1 && formData.kitData && (
                <div className='space-y-6'>
                  <div className='space-y-2 text-center'>
                    <Package className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>Kit Materials</h3>
                    <p className='text-muted-foreground'>
                      Scan material barcode → then scan quantity barcode
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
                          {formData.kitData.kittedLines}/
                          {formData.kitData.totalLines} kitted
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
                              if (autoScanTimeout) {
                                clearTimeout(autoScanTimeout)
                                setAutoScanTimeout(null)
                                setIsAutoScanPending(false)
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
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
                              }
                            }}
                            className='text-center font-mono text-lg'
                            autoFocus
                          />
                        </div>

                        {/* Quantity Input */}
                        <div className='space-y-2'>
                          <Label htmlFor='quantityScan'>Quantity</Label>
                          <Input
                            id='quantityScan'
                            type='number'
                            min='0.01'
                            step='any'
                            placeholder='Scan quantity'
                            value={currentQuantity}
                            onChange={(e) => {
                              setCurrentQuantity(e.target.value)
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

                      {/* Scan Button */}
                      <Button
                        onClick={() => {
                          if (!currentMaterialScan.trim()) {
                            setScanError('Please scan material first')
                          } else if (!currentQuantity.trim()) {
                            setScanError('Please scan quantity')
                          } else {
                            handleQuantityScan()
                          }
                        }}
                        disabled={
                          !currentMaterialScan.trim() ||
                          !currentQuantity.trim() ||
                          isKittingMaterial
                        }
                        className='w-full'
                        size='lg'
                        variant={isAutoScanPending ? 'outline' : 'default'}
                      >
                        {isKittingMaterial ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            Kitting material...
                          </>
                        ) : isAutoScanPending ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            {currentMaterialScan.trim() &&
                            !currentQuantity.trim()
                              ? 'Validating material...'
                              : 'Kitting...'}
                          </>
                        ) : (
                          <>
                            <Package className='mr-2 h-4 w-4' />
                            {!currentMaterialScan.trim()
                              ? 'Scan Material First'
                              : !currentQuantity.trim()
                                ? 'Scan Quantity'
                                : `Kit Material (${currentQuantity} pcs)`}
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
                    <h4 className='text-center font-medium'>
                      Materials to Kit
                    </h4>
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
                              {line.kitted ? (
                                <CheckCircle className='h-5 w-5 text-green-500' />
                              ) : (
                                <Target className='h-5 w-5 text-gray-400' />
                              )}
                            </div>
                            <p className='text-muted-foreground text-sm'>
                              {line.materialDescription}
                            </p>
                            <p className='text-muted-foreground text-xs'>
                              TO: {line.transferOrderNumber} | From:{' '}
                              {line.sourceStorageBin}
                            </p>
                          </div>

                          <div className='flex items-center gap-2 text-right'>
                            <div>
                              <div
                                className={cn(
                                  'text-lg font-bold',
                                  line.kitted
                                    ? 'text-green-600'
                                    : 'text-gray-400'
                                )}
                              >
                                {line.quantity}
                              </div>
                              <p className='text-muted-foreground text-xs'>
                                qty
                              </p>
                            </div>

                            {line.kitted && (
                              <Button
                                variant='ghost'
                                size='sm'
                                onClick={() =>
                                  handleUndoKitting(line.id, line.material)
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
                        {line.kitted ? (
                          <div className='rounded border border-green-200 bg-green-50 p-2 text-center dark:border-green-800 dark:bg-green-950/30'>
                            <p className='text-sm font-medium text-green-700 dark:text-green-300'>
                              ✅ Kitted by {line.kittedBy}
                            </p>
                          </div>
                        ) : (
                          <div className='rounded border border-yellow-200 bg-yellow-50 p-2 text-center dark:border-yellow-800 dark:bg-yellow-950/30'>
                            <p className='text-sm text-yellow-700 dark:text-yellow-300'>
                              <Scan className='mr-1 inline h-4 w-4' />
                              Scan{' '}
                              <span className='font-mono font-bold'>
                                {line.material}
                              </span>{' '}
                              with qty{' '}
                              <span className='font-bold'>{line.quantity}</span>
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
                        Overall Progress
                      </span>
                      <span className='text-sm text-blue-600 dark:text-blue-400'>
                        {formData.kitData.kittedLines} /{' '}
                        {formData.kitData.totalLines} lines kitted
                      </span>
                    </div>
                    <div className='h-3 w-full rounded-full bg-blue-200 dark:bg-blue-900'>
                      <div
                        className='h-3 rounded-full bg-blue-500 transition-all duration-300 dark:bg-blue-400'
                        style={{
                          width: `${(formData.kitData.kittedLines / formData.kitData.totalLines) * 100}%`,
                        }}
                      />
                    </div>
                    {allLinesKitted && (
                      <p className='mt-2 text-sm font-medium text-blue-700 dark:text-blue-300'>
                        ✅ All materials kitted! Ready to complete kit build.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Complete Kit */}
              {currentStep === 2 && formData.kitData && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <PackageCheck className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Complete Kit Build
                    </h3>
                    <p className='text-muted-foreground'>
                      Review the kit summary and finalize the build
                    </p>
                  </div>

                  <div className='mx-auto max-w-md space-y-4'>
                    {/* Kit Summary */}
                    <div className='space-y-3 rounded-lg border p-4'>
                      <h4 className='font-medium'>Kit Summary</h4>
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
                          <span>Materials Kitted:</span>
                          <span className='font-medium text-green-600'>
                            {formData.kitData.kittedLines} /{' '}
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

                    {formData.kitData.status !== 'kit_built' ? (
                      <Button
                        onClick={handleCompleteKit}
                        disabled={!allLinesKitted || isCompletingKit}
                        className='w-full'
                        size='lg'
                      >
                        {isCompletingKit ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            Completing Kit Build...
                          </>
                        ) : (
                          <>
                            <PackageCheck className='mr-2 h-4 w-4' />
                            Complete Kit Build
                          </>
                        )}
                      </Button>
                    ) : (
                      <div className='rounded-lg border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950/30'>
                        <CheckCircle className='mx-auto mb-4 h-12 w-12 text-green-500 dark:text-green-400' />
                        <h4 className='mb-2 font-medium text-green-700 dark:text-green-300'>
                          Kit Build Completed Successfully!
                        </h4>
                        <p className='mb-4 text-sm text-green-600 dark:text-green-400'>
                          Kit {formData.kitData.kitPoNumber} has been marked as
                          "Kit Built"
                        </p>
                        <Button
                          onClick={handleStartNewKit}
                          variant='outline'
                          className='w-full'
                        >
                          Start New Kit Build
                        </Button>
                      </div>
                    )}

                    {!allLinesKitted && (
                      <div className='rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-center dark:border-yellow-800 dark:bg-yellow-950/30'>
                        <AlertCircle className='mx-auto mb-2 h-8 w-8 text-yellow-500' />
                        <p className='text-sm text-yellow-700 dark:text-yellow-300'>
                          Cannot complete kit build.{' '}
                          {formData.kitData.totalLines -
                            formData.kitData.kittedLines}{' '}
                          materials still need to be kitted.
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
        formData.kitData?.status !== 'kit_built' && (
          <div className='flex justify-between'>
            <Button
              variant='outline'
              onClick={() => {
                const newStep = Math.max(0, currentStep - 1)
                setCurrentStep(newStep)
                setCurrentMaterialScan('')
                setCurrentQuantity('')
                setScanError('')

                if (autoScanTimeout) {
                  clearTimeout(autoScanTimeout)
                  setAutoScanTimeout(null)
                  setIsAutoScanPending(false)
                }

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
                setCurrentMaterialScan('')
                setCurrentQuantity('')
                setScanError('')
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

export default BuildKitForm

// Created and developed by Jai Singh
