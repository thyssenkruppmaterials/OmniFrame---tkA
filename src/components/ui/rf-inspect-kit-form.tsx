// Created and developed by Jai Singh
'use client'

/**
 * RF Inspect Kit Form
 * Mobile-optimized kit inspection workflow for RF Terminal
 * Created: January 9, 2026
 *
 * Workflow:
 * 1. Scan Kit PO Number
 * 2. Verify Parts: Visually confirm each part is present
 * 3. Complete Kit Inspection
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
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
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScannerInput } from '@/components/ui/scanner-input'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

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

// Step definitions
type InspectStep =
  | 'kit_scan' // Step 1: Scan Kit PO Number
  | 'verify_parts' // Step 2: Verify Parts
  | 'complete' // Step 3: Complete Inspection

interface InspectFormState {
  currentStep: InspectStep
  kitData: KitData | null
  isProcessing: boolean
}

// Main RF Inspect Kit Form Component
interface RFInspectKitFormProps {
  onBack?: () => void
}

const RFInspectKitForm: React.FC<RFInspectKitFormProps> = ({ onBack }) => {
  // State
  const [state, setState] = useState<InspectFormState>({
    currentStep: 'kit_scan',
    kitData: null,
    isProcessing: false,
  })

  const [kitPoNumber, setKitPoNumber] = useState('')

  // Refs
  const kitPoRef = useRef<HTMLInputElement>(null)

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

  // Auto-focus management
  useEffect(() => {
    if (state.currentStep === 'kit_scan') {
      setTimeout(() => kitPoRef.current?.focus(), 100)
    }
  }, [state.currentStep])

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

        // Start the kit inspection if not already in progress
        if (result.kitData.status === 'kit_built') {
          await startInspectionAsync(kitPo)
        }

        // Move to verify parts step
        setState((prev) => ({ ...prev, currentStep: 'verify_parts' }))
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
    startInspectionAsync,
  ])

  const handleVerifyLine = useCallback(
    async (lineId: string, _material: string) => {
      try {
        await markLineInspectedAsync(lineId)

        // Update local state
        setState((prev) => {
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

          const newInspectedCount = updatedLines.filter(
            (l) => l.inspected
          ).length

          // Check if all lines are now inspected
          if (newInspectedCount === prev.kitData.totalLines) {
            setTimeout(() => {
              setState((s) => ({ ...s, currentStep: 'complete' }))
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
    },
    [markLineInspectedAsync]
  )

  const handleUndoInspection = useCallback(
    async (lineId: string, material: string) => {
      try {
        await unmarkLineInspectedAsync(lineId)

        // Update local state
        setState((prev) => {
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
    },
    [unmarkLineInspectedAsync]
  )

  const handleCompleteInspection = useCallback(async () => {
    if (!state.kitData) return

    try {
      const result = await completeInspectionAsync(state.kitData.kitPoNumber)

      if (result.success) {
        setState((prev) => ({
          ...prev,
          kitData: prev.kitData
            ? { ...prev.kitData, status: 'kit_inspected' }
            : null,
        }))
      }
    } catch (error) {
      logger.error('Error completing inspection:', error)
    }
  }, [state.kitData, completeInspectionAsync])

  const handleStartNewInspection = useCallback(() => {
    setState({
      currentStep: 'kit_scan',
      kitData: null,
      isProcessing: false,
    })
    setKitPoNumber('')
  }, [])

  const allLinesInspected =
    state.kitData?.toLines.every((line) => line.inspected) ?? false

  // Animation variants
  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.3 } },
  }

  return (
    <div className='mx-auto w-full max-w-md space-y-4 p-4'>
      {/* Header with back button */}
      <RFScreenHeader
        title='Inspect Kit'
        subtitle={
          state.kitData
            ? `${state.kitData.kitPoNumber} • ${state.kitData.kitNumber}`
            : 'Quality check'
        }
        onBack={onBack}
      />

      {/* Progress indicator */}
      {state.kitData && state.currentStep !== 'complete' && (
        <div className='bg-muted/30 rounded-lg p-3'>
          <div className='mb-1 flex justify-between text-xs'>
            <span>Inspection Progress</span>
            <span>
              {state.kitData.inspectedLines} of {state.kitData.totalLines}
            </span>
          </div>
          <Progress
            value={
              (state.kitData.inspectedLines / state.kitData.totalLines) * 100
            }
            className='h-2'
          />
        </div>
      )}

      <Card className='min-h-[400px]'>
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
                    <Eye className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Scan Kit PO Number
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Enter or scan the Kit PO number to start inspection
                    </p>
                    <p className='text-xs text-amber-600 dark:text-amber-400'>
                      Note: Only kits with "Kit Built" status can be inspected
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
                        state.isProcessing ||
                        isVerifyingKit ||
                        isStartingInspection
                      }
                    />
                  </div>

                  {(state.isProcessing ||
                    isVerifyingKit ||
                    isStartingInspection) && (
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
                      isStartingInspection
                    }
                    className='h-12 w-full'
                  >
                    <Scan className='mr-2 h-4 w-4' />
                    Load Kit
                  </Button>
                </div>
              )}

              {/* Step 2: Verify Parts */}
              {state.currentStep === 'verify_parts' && state.kitData && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <Eye className='text-primary mx-auto h-10 w-10' />
                    <h3 className='text-lg font-semibold'>Verify Parts</h3>
                    <p className='text-muted-foreground text-sm'>
                      Visually confirm each part is in the kit
                    </p>
                  </div>

                  {/* Parts List */}
                  <div className='max-h-[350px] space-y-2 overflow-y-auto'>
                    {state.kitData.toLines.map((line) => (
                      <div
                        key={line.id}
                        className={cn(
                          'rounded-lg border p-3',
                          line.inspected
                            ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30'
                            : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'
                        )}
                      >
                        <div className='flex items-start justify-between gap-2'>
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              {line.inspected ? (
                                <CheckCircle className='h-5 w-5 flex-shrink-0 text-green-500' />
                              ) : (
                                <Package className='h-5 w-5 flex-shrink-0 text-amber-500' />
                              )}
                              <span className='font-mono text-sm font-semibold'>
                                {line.material}
                              </span>
                            </div>
                            {line.materialDescription && (
                              <p className='text-muted-foreground mt-1 ml-7 truncate text-xs'>
                                {line.materialDescription}
                              </p>
                            )}
                            <p className='text-muted-foreground mt-0.5 ml-7 text-xs'>
                              Bin: {line.sourceStorageBin} • Qty:{' '}
                              <span className='font-semibold'>
                                {line.quantity}
                              </span>
                            </p>
                          </div>

                          <div className='flex-shrink-0'>
                            {!line.inspected ? (
                              <Button
                                variant='default'
                                size='sm'
                                onClick={() =>
                                  handleVerifyLine(line.id, line.material)
                                }
                                disabled={isMarkingLine}
                                className='h-10 bg-green-600 px-4 hover:bg-green-700'
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
                                className='text-muted-foreground h-10 hover:text-red-500'
                              >
                                <Undo2 className='h-4 w-4' />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Status indicator */}
                        {line.inspected && (
                          <div className='mt-2 ml-7 text-xs text-green-600 dark:text-green-400'>
                            ✓ Verified by {line.inspectedBy}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {allLinesInspected && (
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
                      All Parts Verified - Continue
                    </Button>
                  )}

                  <Button
                    variant='outline'
                    onClick={handleStartNewInspection}
                    className='w-full'
                  >
                    <ChevronLeft className='mr-2 h-4 w-4' />
                    Different Kit
                  </Button>
                </div>
              )}

              {/* Step 3: Complete Inspection */}
              {state.currentStep === 'complete' && state.kitData && (
                <div className='space-y-4'>
                  {state.kitData.status !== 'kit_inspected' ? (
                    <>
                      <div className='space-y-2 text-center'>
                        <ClipboardCheck className='mx-auto h-12 w-12 text-green-500' />
                        <h3 className='text-lg font-semibold'>
                          Complete Inspection
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Review and finalize the kit inspection
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
                              Parts Verified:
                            </span>
                            <span className='font-medium text-green-600'>
                              {state.kitData.inspectedLines} /{' '}
                              {state.kitData.totalLines}
                            </span>
                          </div>
                        </div>
                      </Card>

                      {allLinesInspected ? (
                        <Button
                          onClick={handleCompleteInspection}
                          disabled={isCompletingInspection}
                          className='h-12 w-full bg-green-600 hover:bg-green-700'
                        >
                          {isCompletingInspection ? (
                            <>
                              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                              Completing...
                            </>
                          ) : (
                            <>
                              <ClipboardCheck className='mr-2 h-4 w-4' />
                              Complete Inspection
                            </>
                          )}
                        </Button>
                      ) : (
                        <div className='rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-center dark:border-yellow-800 dark:bg-yellow-950/30'>
                          <AlertCircle className='mx-auto mb-2 h-6 w-6 text-yellow-500' />
                          <p className='text-sm text-yellow-700 dark:text-yellow-300'>
                            {state.kitData.totalLines -
                              state.kitData.inspectedLines}{' '}
                            parts still need to be verified
                          </p>
                        </div>
                      )}

                      <Button
                        variant='outline'
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            currentStep: 'verify_parts',
                          }))
                        }
                        className='w-full'
                      >
                        <ChevronLeft className='mr-2 h-4 w-4' />
                        Back to Parts
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className='space-y-4 text-center'>
                        <CheckCircle className='mx-auto h-16 w-16 text-green-500' />
                        <h3 className='text-lg font-semibold text-green-600'>
                          Inspection Complete!
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Kit {state.kitData.kitPoNumber} has been marked as
                          inspected
                        </p>
                      </div>

                      <Button
                        onClick={handleStartNewInspection}
                        className='h-12 w-full'
                      >
                        <Eye className='mr-2 h-4 w-4' />
                        Inspect Another Kit
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

export default RFInspectKitForm

// Created and developed by Jai Singh
