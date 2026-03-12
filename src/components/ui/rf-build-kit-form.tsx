'use client'

/**
 * RF Build Kit Form
 * Mobile-optimized kit building workflow for RF Terminal
 * Created: January 9, 2026
 *
 * Workflow:
 * 1. Scan Kit PO Number
 * 2. Kit Materials: Scan material → Confirm quantity
 * 3. Complete Kit Build
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  CheckCircle,
  ChevronLeft,
  Eye,
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
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScannerInput } from '@/components/ui/scanner-input'

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

// Step definitions
type BuildStep =
  | 'kit_scan' // Step 1: Scan Kit PO Number
  | 'kit_materials' // Step 2: Kit Materials
  | 'complete' // Step 3: Complete Kit Build

interface BuildFormState {
  currentStep: BuildStep
  kitData: KitData | null
  currentMaterialScan: string
  currentQuantity: string
  scanError: string
  isProcessing: boolean
}

// Quantity Keypad Component
const QuantityKeypad = ({
  value,
  onChange,
  expectedQty,
  onConfirm,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  expectedQty: number
  onConfirm: () => void
  disabled?: boolean
}) => {
  const handleKeypadClick = (key: string) => {
    if (disabled) return

    if (key === 'clear') {
      onChange('')
    } else if (key === 'backspace') {
      onChange(value.slice(0, -1))
    } else if (key === 'expected') {
      onChange(expectedQty.toString())
    } else {
      onChange(value + key)
    }
  }

  return (
    <div className='space-y-3'>
      <div className='bg-muted/30 border-muted-foreground/30 rounded-lg border-2 border-dashed p-3 text-center'>
        <div className='text-primary mb-1 font-mono text-3xl font-bold'>
          {value || '0'}
        </div>
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
            className='hover:bg-primary hover:text-primary-foreground h-12 text-lg font-semibold'
            onClick={() => handleKeypadClick(num.toString())}
            disabled={disabled}
          >
            {num}
          </Button>
        ))}
        <Button
          type='button'
          variant='outline'
          size='lg'
          className='hover:bg-destructive hover:text-destructive-foreground h-12 text-xs font-medium'
          onClick={() => handleKeypadClick('clear')}
          disabled={disabled}
        >
          Clear
        </Button>
        <Button
          type='button'
          variant='outline'
          size='lg'
          className='hover:bg-primary hover:text-primary-foreground h-12 text-lg font-semibold'
          onClick={() => handleKeypadClick('0')}
          disabled={disabled}
        >
          0
        </Button>
        <Button
          type='button'
          variant='outline'
          size='lg'
          className='hover:bg-secondary hover:text-secondary-foreground h-12 text-sm font-medium'
          onClick={() => handleKeypadClick('backspace')}
          disabled={disabled}
        >
          ←
        </Button>
      </div>

      {/* Quick fill expected quantity button */}
      <Button
        type='button'
        variant='secondary'
        size='lg'
        className='h-10 w-full'
        onClick={() => handleKeypadClick('expected')}
        disabled={disabled}
      >
        <Check className='mr-2 h-4 w-4' />
        Use Expected: {expectedQty}
      </Button>

      {/* Confirm button */}
      <Button
        type='button'
        size='lg'
        className='h-12 w-full'
        onClick={onConfirm}
        disabled={disabled || !value}
      >
        {disabled ? (
          <>
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            Kitting...
          </>
        ) : (
          <>
            <PackageCheck className='mr-2 h-4 w-4' />
            Confirm Kit ({value || 0} pcs)
          </>
        )}
      </Button>
    </div>
  )
}

// Main RF Build Kit Form Component
interface RFBuildKitFormProps {
  onBack?: () => void
}

const RFBuildKitForm: React.FC<RFBuildKitFormProps> = ({ onBack }) => {
  // State
  const [state, setState] = useState<BuildFormState>({
    currentStep: 'kit_scan',
    kitData: null,
    currentMaterialScan: '',
    currentQuantity: '',
    scanError: '',
    isProcessing: false,
  })

  const [kitPoNumber, setKitPoNumber] = useState('')
  const [selectedMaterial, setSelectedMaterial] = useState<TOLine | null>(null)

  // Refs
  const kitPoRef = useRef<HTMLInputElement>(null)
  const materialRef = useRef<HTMLInputElement>(null)

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

  // Auto-focus management
  useEffect(() => {
    const focusField = () => {
      switch (state.currentStep) {
        case 'kit_scan':
          setTimeout(() => kitPoRef.current?.focus(), 100)
          break
        case 'kit_materials':
          if (!selectedMaterial) {
            setTimeout(() => materialRef.current?.focus(), 100)
          }
          break
      }
    }
    focusField()
  }, [state.currentStep, selectedMaterial])

  // Handlers
  const handleKitPoValidation = useCallback(async () => {
    const kitPo = kitPoNumber.trim()

    if (!kitPo) {
      toast.error('Please enter a Kit PO Number')
      return
    }

    if (!isAuthenticated || isAuthLoading) {
      toast.error('Authentication required. Please refresh the page.')
      return
    }

    setState((prev) => ({ ...prev, isProcessing: true }))

    try {
      const result = await verifyKitAsync(kitPo)

      if (result.exists && result.kitData) {
        setState((prev) => ({
          ...prev,
          kitData: result.kitData!,
          isProcessing: false,
        }))

        // Start the kit build if not already in progress
        if (
          result.kitData.status === 'printed' ||
          result.kitData.status === 'pending'
        ) {
          await startBuildAsync(kitPo)
        }

        // Move to materials step
        setState((prev) => ({ ...prev, currentStep: 'kit_materials' }))
      } else {
        setState((prev) => ({ ...prev, isProcessing: false }))
        setKitPoNumber('')
        setTimeout(() => kitPoRef.current?.focus(), 100)
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to load kit')
      setState((prev) => ({ ...prev, isProcessing: false }))
    }
  }, [
    kitPoNumber,
    isAuthenticated,
    isAuthLoading,
    verifyKitAsync,
    startBuildAsync,
  ])

  const handleMaterialScan = useCallback(() => {
    const { currentMaterialScan, kitData } = state
    if (!kitData) return

    const scannedMaterial = currentMaterialScan.trim()
    if (!scannedMaterial) {
      setState((prev) => ({
        ...prev,
        scanError: 'Please scan or enter a material number',
      }))
      return
    }

    // Find the material in the TO lines
    const matchingLine = kitData.toLines.find(
      (line) => line.material === scannedMaterial && !line.kitted
    )

    if (!matchingLine) {
      const materialExists = kitData.toLines.some(
        (line) => line.material === scannedMaterial
      )

      if (materialExists) {
        setState((prev) => ({
          ...prev,
          scanError: `Material ${scannedMaterial} is already kitted`,
          currentMaterialScan: '',
        }))
        toast.warning(
          `Material ${scannedMaterial} already kitted. Scan a different material.`
        )
      } else {
        setState((prev) => ({
          ...prev,
          scanError: `Material ${scannedMaterial} not found in this kit`,
          currentMaterialScan: '',
        }))
        toast.error(`Material not found in this kit`)
      }

      setTimeout(() => materialRef.current?.focus(), 100)
      return
    }

    // Material validated - show quantity entry
    setSelectedMaterial(matchingLine)
    setState((prev) => ({
      ...prev,
      scanError: '',
      currentQuantity: matchingLine.quantity.toString(),
    }))
    toast.success(
      `Material ${scannedMaterial} found! Qty: ${matchingLine.quantity}`
    )
  }, [state.currentMaterialScan, state.kitData])

  const handleQuantityConfirm = useCallback(async () => {
    if (!selectedMaterial || !state.kitData) return

    const quantity = parseFloat(state.currentQuantity)
    if (isNaN(quantity) || quantity <= 0) {
      setState((prev) => ({
        ...prev,
        scanError: 'Please enter a valid quantity',
      }))
      return
    }

    setState((prev) => ({ ...prev, isProcessing: true, scanError: '' }))

    try {
      const result = await kitMaterialAsync({
        kitPoNumber: state.kitData.kitPoNumber,
        material: selectedMaterial.material,
        quantity,
      })

      if (result.success && result.kittedLine) {
        // Update local state with kitted line
        setState((prev) => {
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

          const newKittedCount = prev.kitData.kittedLines + 1

          // Check if all lines are kitted
          if (result.allLinesKitted) {
            setTimeout(() => {
              setState((s) => ({ ...s, currentStep: 'complete' }))
            }, 1000)
          }

          return {
            ...prev,
            kitData: {
              ...prev.kitData,
              kittedLines: newKittedCount,
              toLines: updatedLines,
            },
            currentMaterialScan: '',
            currentQuantity: '',
            isProcessing: false,
          }
        })

        setSelectedMaterial(null)
        setTimeout(() => materialRef.current?.focus(), 100)
      } else {
        setState((prev) => ({
          ...prev,
          scanError: result.error || 'Failed to kit material',
          isProcessing: false,
        }))
      }
    } catch (error: unknown) {
      setState((prev) => ({
        ...prev,
        scanError:
          error instanceof Error ? error.message : 'Failed to kit material',
        isProcessing: false,
      }))
    }
  }, [selectedMaterial, state.kitData, state.currentQuantity, kitMaterialAsync])

  const handleUndoKitting = useCallback(
    async (lineId: string, material: string) => {
      try {
        await unmarkLineKittedAsync(lineId)

        // Update local state
        setState((prev) => {
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
    },
    [unmarkLineKittedAsync]
  )

  // Handler for visual inspection confirmation (when no barcode is available)
  const handleVisualInspection = useCallback((line: TOLine) => {
    // Set the material as selected and pre-fill with expected quantity
    setSelectedMaterial(line)
    setState((prev) => ({
      ...prev,
      currentMaterialScan: line.material,
      currentQuantity: line.quantity.toString(),
      scanError: '',
    }))
    toast.info(`Visual inspection for ${line.material}. Confirm quantity.`)
  }, [])

  const handleCompleteKit = useCallback(async () => {
    if (!state.kitData) return

    try {
      const result = await completeKitAsync(state.kitData.kitPoNumber)

      if (result.success) {
        setState((prev) => ({
          ...prev,
          kitData: prev.kitData
            ? { ...prev.kitData, status: 'kit_built' }
            : null,
        }))
      }
    } catch (error) {
      logger.error('Error completing kit:', error)
    }
  }, [state.kitData, completeKitAsync])

  const handleStartNewKit = useCallback(() => {
    setState({
      currentStep: 'kit_scan',
      kitData: null,
      currentMaterialScan: '',
      currentQuantity: '',
      scanError: '',
      isProcessing: false,
    })
    setKitPoNumber('')
    setSelectedMaterial(null)
  }, [])

  const allLinesKitted =
    state.kitData?.toLines.every((line) => line.kitted) ?? false

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
          <h2 className='text-lg font-bold'>Build Kit</h2>
          {state.kitData && (
            <p className='text-muted-foreground text-xs'>
              {state.kitData.kitPoNumber} • {state.kitData.kitNumber}
            </p>
          )}
        </div>
        {onBack && <div className='w-14 shrink-0' />}
      </div>

      {/* Progress indicator */}
      {state.kitData && state.currentStep !== 'complete' && (
        <div className='bg-muted/30 rounded-lg p-3'>
          <div className='mb-1 flex justify-between text-xs'>
            <span>Kitting Progress</span>
            <span>
              {state.kitData.kittedLines} of {state.kitData.totalLines}
            </span>
          </div>
          <Progress
            value={(state.kitData.kittedLines / state.kitData.totalLines) * 100}
            className='h-2'
          />
        </div>
      )}

      <Card className='min-h-[400px]'>
        <CardContent className='p-4'>
          <AnimatePresence mode='wait'>
            <motion.div
              key={state.currentStep + (selectedMaterial?.id || '')}
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
                      Enter or scan the Kit PO number to start building
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
                      onChange={(e) =>
                        setKitPoNumber(e.target.value.toUpperCase())
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleKitPoValidation()
                        }
                      }}
                      className='h-12 text-center font-mono text-lg'
                      disabled={
                        state.isProcessing || isVerifyingKit || isStartingBuild
                      }
                    />
                  </div>

                  {(state.isProcessing ||
                    isVerifyingKit ||
                    isStartingBuild) && (
                    <div className='flex items-center justify-center py-4'>
                      <Loader2 className='mr-2 h-6 w-6 animate-spin' />
                      <span>Loading kit...</span>
                    </div>
                  )}

                  <Button
                    onClick={handleKitPoValidation}
                    disabled={
                      !kitPoNumber.trim() ||
                      state.isProcessing ||
                      isVerifyingKit ||
                      isStartingBuild
                    }
                    className='h-12 w-full'
                  >
                    <Scan className='mr-2 h-4 w-4' />
                    Load Kit
                  </Button>
                </div>
              )}

              {/* Step 2: Kit Materials */}
              {state.currentStep === 'kit_materials' &&
                state.kitData &&
                !selectedMaterial && (
                  <div className='space-y-4'>
                    <div className='space-y-2 text-center'>
                      <Scan className='text-primary mx-auto h-10 w-10' />
                      <h3 className='text-lg font-semibold'>Scan Material</h3>
                      <p className='text-muted-foreground text-sm'>
                        Scan the material barcode to kit it
                      </p>
                    </div>

                    <div className='space-y-2'>
                      <Label htmlFor='material'>Material Number</Label>
                      <ScannerInput
                        ref={materialRef}
                        id='material'
                        type='text'
                        placeholder='Scan material barcode'
                        value={state.currentMaterialScan}
                        onChange={(e) => {
                          const value = e.target.value.toUpperCase()
                          setState((prev) => ({
                            ...prev,
                            currentMaterialScan: value,
                            scanError: '',
                          }))
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

                    {state.scanError && (
                      <div className='rounded border border-red-200 bg-red-50 p-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400'>
                        <AlertCircle className='mr-1 inline h-4 w-4' />
                        {state.scanError}
                      </div>
                    )}

                    <Button
                      onClick={handleMaterialScan}
                      disabled={!state.currentMaterialScan.trim()}
                      className='h-12 w-full'
                    >
                      <Package className='mr-2 h-4 w-4' />
                      Validate Material
                    </Button>

                    {/* Materials List */}
                    <div className='max-h-48 space-y-2 overflow-y-auto'>
                      <h4 className='text-muted-foreground text-sm font-medium'>
                        Materials to Kit:
                      </h4>
                      {state.kitData.toLines.map((line) => (
                        <div
                          key={line.id}
                          className={cn(
                            'rounded border p-2 text-xs',
                            line.kitted
                              ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30'
                              : 'bg-muted/30 border-muted'
                          )}
                        >
                          <div className='flex items-center justify-between'>
                            <div className='flex items-center gap-2'>
                              {line.kitted ? (
                                <CheckCircle className='h-4 w-4 flex-shrink-0 text-green-500' />
                              ) : (
                                <Target className='text-muted-foreground h-4 w-4 flex-shrink-0' />
                              )}
                              <div>
                                <span className='font-mono font-medium'>
                                  {line.material}
                                </span>
                                <span className='text-muted-foreground ml-2'>
                                  × {line.quantity}
                                </span>
                              </div>
                            </div>
                            <div className='flex items-center gap-1'>
                              {/* Visual Inspection Button - for materials without barcodes */}
                              {!line.kitted && (
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  className='h-6 px-2 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30'
                                  onClick={() => handleVisualInspection(line)}
                                  title='Visual inspection - confirm without scanning'
                                >
                                  <Eye className='h-3 w-3' />
                                </Button>
                              )}
                              {line.kitted && (
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  className='h-6 px-2'
                                  onClick={() =>
                                    handleUndoKitting(line.id, line.material)
                                  }
                                  disabled={isUnmarkingLine}
                                >
                                  <Undo2 className='h-3 w-3' />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {allLinesKitted && (
                      <Button
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            currentStep: 'complete',
                          }))
                        }
                        className='h-12 w-full bg-green-600 hover:bg-green-700'
                      >
                        <CheckCircle className='mr-2 h-4 w-4' />
                        All Materials Kitted - Continue
                      </Button>
                    )}

                    <Button
                      variant='outline'
                      onClick={handleStartNewKit}
                      className='w-full'
                    >
                      <ChevronLeft className='mr-2 h-4 w-4' />
                      Different Kit
                    </Button>
                  </div>
                )}

              {/* Step 2b: Quantity Entry for Selected Material */}
              {state.currentStep === 'kit_materials' &&
                state.kitData &&
                selectedMaterial && (
                  <div className='space-y-4'>
                    <div className='space-y-2 text-center'>
                      <Package className='text-primary mx-auto h-10 w-10' />
                      <h3 className='text-lg font-semibold'>
                        Confirm Quantity
                      </h3>
                      <p className='text-primary font-mono text-sm'>
                        {selectedMaterial.material}
                      </p>
                      {selectedMaterial.materialDescription && (
                        <p className='text-muted-foreground text-xs'>
                          {selectedMaterial.materialDescription}
                        </p>
                      )}
                    </div>

                    <QuantityKeypad
                      value={state.currentQuantity}
                      onChange={(value) =>
                        setState((prev) => ({
                          ...prev,
                          currentQuantity: value,
                        }))
                      }
                      expectedQty={selectedMaterial.quantity}
                      onConfirm={handleQuantityConfirm}
                      disabled={state.isProcessing || isKittingMaterial}
                    />

                    {state.scanError && (
                      <div className='rounded border border-red-200 bg-red-50 p-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400'>
                        <AlertCircle className='mr-1 inline h-4 w-4' />
                        {state.scanError}
                      </div>
                    )}

                    <Button
                      variant='outline'
                      onClick={() => {
                        setSelectedMaterial(null)
                        setState((prev) => ({
                          ...prev,
                          currentMaterialScan: '',
                          currentQuantity: '',
                          scanError: '',
                        }))
                      }}
                      disabled={state.isProcessing || isKittingMaterial}
                      className='w-full'
                    >
                      <ChevronLeft className='mr-2 h-4 w-4' />
                      Cancel / Different Material
                    </Button>
                  </div>
                )}

              {/* Step 3: Complete Kit Build */}
              {state.currentStep === 'complete' && state.kitData && (
                <div className='space-y-4'>
                  {state.kitData.status !== 'kit_built' ? (
                    <>
                      <div className='space-y-2 text-center'>
                        <PackageCheck className='mx-auto h-12 w-12 text-green-500' />
                        <h3 className='text-lg font-semibold'>
                          Complete Kit Build
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Review and finalize the kit build
                        </p>
                      </div>

                      {/* Kit Summary */}
                      <Card className='bg-muted/20 p-3'>
                        <div className='space-y-2 text-xs'>
                          <div className='flex justify-between'>
                            <span className='text-muted-foreground'>
                              Kit PO:
                            </span>
                            <span className='font-mono'>
                              {state.kitData.kitPoNumber}
                            </span>
                          </div>
                          <div className='flex justify-between'>
                            <span className='text-muted-foreground'>
                              Kit Number:
                            </span>
                            <span className='font-mono'>
                              {state.kitData.kitNumber}
                            </span>
                          </div>
                          <div className='flex justify-between'>
                            <span className='text-muted-foreground'>
                              Program:
                            </span>
                            <span>{state.kitData.engineProgram}</span>
                          </div>
                          <div className='flex justify-between'>
                            <span className='text-muted-foreground'>
                              Materials Kitted:
                            </span>
                            <span className='font-medium text-green-600'>
                              {state.kitData.kittedLines} /{' '}
                              {state.kitData.totalLines}
                            </span>
                          </div>
                        </div>
                      </Card>

                      {allLinesKitted ? (
                        <Button
                          onClick={handleCompleteKit}
                          disabled={isCompletingKit}
                          className='h-12 w-full bg-green-600 hover:bg-green-700'
                        >
                          {isCompletingKit ? (
                            <>
                              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                              Completing...
                            </>
                          ) : (
                            <>
                              <PackageCheck className='mr-2 h-4 w-4' />
                              Complete Kit Build
                            </>
                          )}
                        </Button>
                      ) : (
                        <div className='rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-center dark:border-yellow-800 dark:bg-yellow-950/30'>
                          <AlertCircle className='mx-auto mb-2 h-6 w-6 text-yellow-500' />
                          <p className='text-sm text-yellow-700 dark:text-yellow-300'>
                            {state.kitData.totalLines -
                              state.kitData.kittedLines}{' '}
                            materials still need to be kitted
                          </p>
                        </div>
                      )}

                      <Button
                        variant='outline'
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            currentStep: 'kit_materials',
                          }))
                        }
                        className='w-full'
                      >
                        <ChevronLeft className='mr-2 h-4 w-4' />
                        Back to Materials
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className='space-y-4 text-center'>
                        <CheckCircle className='mx-auto h-16 w-16 text-green-500' />
                        <h3 className='text-lg font-semibold text-green-600'>
                          Kit Build Complete!
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Kit {state.kitData.kitPoNumber} has been marked as
                          built
                        </p>
                      </div>

                      <Button
                        onClick={handleStartNewKit}
                        className='h-12 w-full'
                      >
                        <Package className='mr-2 h-4 w-4' />
                        Build Another Kit
                      </Button>
                    </>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  )
}

export default RFBuildKitForm
