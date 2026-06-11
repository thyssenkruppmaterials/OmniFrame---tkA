// Created and developed by Jai Singh
/**
 * RF GRS Cycle Count Form Component
 *
 * Implements location-based batch scanning workflow for GRS cycle counts
 * Design matches the Inventory Cycle Count app pattern
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  MapPin,
  Package,
  Scan,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  rfGRSCycleCountService,
  type GRSBatchItem,
  type GRSUnknownBatch,
} from '@/lib/supabase/rf-grs-cycle-count.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Label } from '@/components/ui/label'
import { RFUnknownBatchDialog } from '@/components/ui/rf-unknown-batch-dialog'
import { ScannerInput } from '@/components/ui/scanner-input'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

// Enhanced state management for GRS cycle count
interface GRSCycleCountState {
  currentStep: number
  scannedLocation: string
  locationVerified: boolean
  isValidatingLocation: boolean
  batches: GRSBatchItem[]
  scannedBatchIds: Set<string>
  currentBatchScan: string
  isProcessing: boolean
  sessionStartedAt: string | null
  completionCountdown: number
  // Unknown batch workflow
  showUnknownBatchDialog: boolean
  unknownBatchNumber: string
  // Confirmation dialog
  showBackConfirmDialog: boolean
}

// Main RF GRS Cycle Count Form Component
interface RFGRSCycleCountFormProps {
  onBack?: () => void
}

const RFGRSCycleCountForm: React.FC<RFGRSCycleCountFormProps> = ({
  onBack,
}) => {
  // Enhanced state management
  const [state, setState] = useState<GRSCycleCountState>({
    currentStep: 1, // 1: Location scan, 2: Batch scanning, 3: Complete
    showBackConfirmDialog: false,
    scannedLocation: '',
    locationVerified: false,
    isValidatingLocation: false,
    batches: [],
    scannedBatchIds: new Set<string>(),
    currentBatchScan: '',
    isProcessing: false,
    sessionStartedAt: null,
    completionCountdown: 0,
    showUnknownBatchDialog: false,
    unknownBatchNumber: '',
  })

  // Field refs for focus management
  const locationRef = useRef<HTMLInputElement>(null)
  const batchRef = useRef<HTMLInputElement>(null)

  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  // Enhanced step configuration
  const steps = [
    {
      id: 1,
      title: 'Location',
      icon: MapPin,
      description: 'Scan location barcode',
    },
    { id: 2, title: 'Batches', icon: Package, description: 'Scan all batches' },
    { id: 3, title: 'Complete', icon: CheckCircle, description: 'Finish scan' },
  ]

  // Animation variants
  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.3 } },
  }

  // Auto-focus management
  useEffect(() => {
    const focusField = () => {
      try {
        const currentRef = state.currentStep === 1 ? locationRef : batchRef

        if (
          currentRef?.current &&
          !state.isProcessing &&
          !state.isValidatingLocation
        ) {
          requestAnimationFrame(() => {
            try {
              currentRef.current?.focus()
              if (currentRef.current && 'select' in currentRef.current) {
                ;(currentRef.current as HTMLInputElement).select()
              }
            } catch (error) {
              logger.warn('Focus attempt failed:', error)
            }
          })
        }
      } catch (error) {
        logger.warn('Focus field error:', error)
      }
    }

    focusField()
    const focusTimer = setTimeout(focusField, 100)
    return () => clearTimeout(focusTimer)
  }, [state.currentStep, state.isProcessing, state.isValidatingLocation])

  // Completion countdown management
  useEffect(() => {
    if (state.completionCountdown === 0) return

    const countdownInterval = setInterval(() => {
      setState((prev) => {
        if (prev.completionCountdown <= 1) {
          // Reset to start new location scan
          return {
            currentStep: 1,
            scannedLocation: '',
            locationVerified: false,
            isValidatingLocation: false,
            batches: [],
            scannedBatchIds: new Set<string>(),
            currentBatchScan: '',
            isProcessing: false,
            sessionStartedAt: null,
            completionCountdown: 0,
            showUnknownBatchDialog: false,
            unknownBatchNumber: '',
            showBackConfirmDialog: false,
          }
        }
        return { ...prev, completionCountdown: prev.completionCountdown - 1 }
      })
    }, 1000)

    return () => {
      clearInterval(countdownInterval)
    }
  }, [state.completionCountdown])

  // Handle location scan
  const handleLocationScan = useCallback(async (scannedLocation: string) => {
    if (!scannedLocation.trim()) {
      toast.error('Please scan a location')
      return
    }

    setState((prev) => ({ ...prev, isValidatingLocation: true }))

    try {
      logger.log('🔍 Scanning location:', scannedLocation)

      // Fetch batches for this location
      const { data: batches, error } =
        await rfGRSCycleCountService.fetchBatchesForLocation(scannedLocation)

      if (error) {
        toast.error(`Error: ${error}`)
        setState((prev) => ({
          ...prev,
          scannedLocation,
          locationVerified: false,
          isValidatingLocation: false,
        }))
        return
      }

      if (!batches || batches.length === 0) {
        toast.error('No batches found for this location')
        setState((prev) => ({
          ...prev,
          scannedLocation,
          locationVerified: false,
          isValidatingLocation: false,
        }))
        return
      }

      // Location verified, move to batch scanning
      setState((prev) => ({
        ...prev,
        scannedLocation,
        locationVerified: true,
        batches: batches,
        currentStep: 2,
        isValidatingLocation: false,
        sessionStartedAt: new Date().toISOString(),
      }))

      toast.success(
        `Location verified: ${scannedLocation} - ${batches.length} batches found`
      )
    } catch (error: unknown) {
      logger.error('❌ Error validating location:', error)
      toast.error('Error validating location')
      setState((prev) => ({ ...prev, isValidatingLocation: false }))
    }
  }, [])

  // Handle batch scan
  const handleBatchScan = useCallback(
    async (scannedBatch: string) => {
      if (!scannedBatch.trim()) {
        toast.error('Please scan a batch')
        return
      }

      // Find matching batch in current location
      const matchingBatch = state.batches.find(
        (b) =>
          b.batch.trim().toUpperCase() === scannedBatch.trim().toUpperCase()
      )

      if (!matchingBatch) {
        // Batch not in current location - check if it exists elsewhere
        setState((prev) => ({ ...prev, isProcessing: true }))

        try {
          const { data: batchInOtherLocation, error: searchError } =
            await rfGRSCycleCountService.findBatchByNumber(scannedBatch)

          if (searchError || !batchInOtherLocation) {
            // Batch not found in system at all - trigger unknown batch workflow
            logger.log('⚠️ Unknown batch scanned:', scannedBatch)
            toast.info(
              `Batch ${scannedBatch} not in system - Please provide details`
            )

            setState((prev) => ({
              ...prev,
              isProcessing: false,
              currentBatchScan: '',
              showUnknownBatchDialog: true,
              unknownBatchNumber: scannedBatch,
            }))
            return
          }

          // Batch exists but in a different location
          const actualLocation = batchInOtherLocation.conf_cert_ref

          // Mark it as "Found in Different Location"
          const { error: markError } =
            await rfGRSCycleCountService.markBatchFoundInDifferentLocation(
              batchInOtherLocation.id,
              state.scannedLocation,
              user?.id || '',
              profile?.full_name || 'RF User'
            )

          if (markError) {
            toast.error(`Error marking batch: ${markError}`)
            setState((prev) => ({
              ...prev,
              isProcessing: false,
              currentBatchScan: '',
            }))
            return
          }

          toast.warning(
            `⚠️ Batch ${scannedBatch} found but expected at ${actualLocation}`,
            { duration: 5000 }
          )

          setState((prev) => ({
            ...prev,
            isProcessing: false,
            currentBatchScan: '',
          }))

          // Auto-focus on batch input for next scan
          setTimeout(() => {
            batchRef.current?.focus()
          }, 100)

          return
        } catch (error: unknown) {
          logger.error('❌ Error searching for batch:', error)
          toast.error('Error searching for batch')
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            currentBatchScan: '',
          }))
          return
        }
      }

      // Check if already scanned
      if (state.scannedBatchIds.has(matchingBatch.id)) {
        toast.warning(`Batch ${scannedBatch} already scanned`)
        setState((prev) => ({ ...prev, currentBatchScan: '' }))
        return
      }

      setState((prev) => ({ ...prev, isProcessing: true }))

      try {
        // Mark batch as scanned in database
        const { error } = await rfGRSCycleCountService.markBatchAsScanned(
          matchingBatch.id,
          user?.id || '',
          profile?.full_name || 'RF User'
        )

        if (error) {
          toast.error(`Error marking batch: ${error}`)
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            currentBatchScan: '',
          }))
          return
        }

        // Add to scanned set
        const newScannedBatchIds = new Set(state.scannedBatchIds)
        newScannedBatchIds.add(matchingBatch.id)

        setState((prev) => ({
          ...prev,
          scannedBatchIds: newScannedBatchIds,
          currentBatchScan: '',
          isProcessing: false,
        }))

        toast.success(
          `✓ Batch ${scannedBatch} scanned (${newScannedBatchIds.size}/${state.batches.length})`
        )

        // Auto-focus on batch input for next scan
        setTimeout(() => {
          batchRef.current?.focus()
        }, 100)
      } catch (error: unknown) {
        logger.error('❌ Error scanning batch:', error)
        toast.error('Error scanning batch')
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          currentBatchScan: '',
        }))
      }
    },
    [
      state.batches,
      state.scannedBatchIds,
      state.scannedLocation,
      user?.id,
      profile?.full_name,
    ]
  )

  // Complete location scan
  const handleCompleteLocation = useCallback(async () => {
    if (state.batches.length === 0) {
      toast.error('No batches to complete')
      return
    }

    setState((prev) => ({ ...prev, isProcessing: true }))

    try {
      const scannedBatchIdsArray = Array.from(state.scannedBatchIds)

      const { data, error } = await rfGRSCycleCountService.completeLocationScan(
        state.scannedLocation,
        scannedBatchIdsArray
      )

      if (error) {
        toast.error(`Error completing location: ${error}`)
        setState((prev) => ({ ...prev, isProcessing: false }))
        return
      }

      if (data) {
        logger.log('✅ Location scan completed:', data)

        // Show completion summary
        const summaryMessage =
          `Location ${state.scannedLocation} completed!\n` +
          `Scanned: ${data.scannedCount} | Not Scanned: ${data.unscannedCount} | Total: ${data.totalCount}`

        toast.success(summaryMessage)

        // Start countdown to next location
        setState((prev) => ({
          ...prev,
          currentStep: 3,
          completionCountdown: 5,
          isProcessing: false,
        }))
      }
    } catch (error: unknown) {
      logger.error('❌ Error completing location scan:', error)
      toast.error(
        `Completion error: ${error instanceof Error ? error.message : String(error)}`
      )
      setState((prev) => ({ ...prev, isProcessing: false }))
    }
  }, [
    state.batches,
    state.scannedBatchIds,
    state.scannedLocation,
    user?.id,
    profile?.full_name,
  ])

  // Handle unknown batch completion
  const handleUnknownBatchComplete = useCallback(
    async (data: {
      batchNumber: string
      materialNumber: string
      serialNumber: string
      notes: string
      photo: File | null
    }) => {
      try {
        logger.log('📝 Processing unknown batch:', data)

        let photoUrl: string | undefined = undefined

        // Upload photo if provided
        if (data.photo) {
          const { data: uploadResult, error: uploadError } =
            await rfGRSCycleCountService.uploadPhoto(
              data.photo,
              data.batchNumber
            )

          if (uploadError) {
            toast.error(`Photo upload failed: ${uploadError}`)
            // Continue without photo
          } else if (uploadResult) {
            photoUrl = uploadResult.url
            logger.log('✅ Photo uploaded:', photoUrl)
          }
        }

        // Create unknown batch record
        const unknownBatch: GRSUnknownBatch = {
          found_at_location: state.scannedLocation,
          batch_number: data.batchNumber,
          material_number: data.materialNumber,
          serial_number: data.serialNumber || undefined,
          grs_notes: data.notes || undefined,
          photo_url: photoUrl,
        }

        const { error: createError } =
          await rfGRSCycleCountService.createUnknownBatch(
            unknownBatch,
            user?.id || '',
            profile?.full_name || 'RF User',
            profile?.organization_id || ''
          )

        if (createError) {
          toast.error(`Error saving unknown batch: ${createError}`)
          return
        }

        toast.success(
          `✓ Unknown batch ${data.batchNumber} recorded successfully`
        )

        // Close dialog and refocus
        setState((prev) => ({
          ...prev,
          showUnknownBatchDialog: false,
          unknownBatchNumber: '',
        }))

        setTimeout(() => {
          batchRef.current?.focus()
        }, 500)
      } catch (error: unknown) {
        logger.error('❌ Error handling unknown batch:', error)
        toast.error(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    },
    [
      state.scannedLocation,
      user?.id,
      profile?.full_name,
      profile?.organization_id,
    ]
  )

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (state.currentStep > 1) {
      if (state.currentStep === 2 && state.scannedBatchIds.size > 0) {
        // Show confirmation dialog before going back if batches have been scanned
        setState((prev) => ({ ...prev, showBackConfirmDialog: true }))
      } else {
        setState((prev) => ({ ...prev, currentStep: prev.currentStep - 1 }))
      }
    } else if (onBack) {
      onBack()
    }
  }, [state.currentStep, state.scannedBatchIds.size, onBack])

  // Handle confirmed back navigation
  const handleConfirmBack = useCallback(() => {
    setState((prev) => ({
      ...prev,
      showBackConfirmDialog: false,
      currentStep: prev.currentStep - 1,
    }))
  }, [])

  // Handle cancelled back navigation
  const handleCancelBack = useCallback(() => {
    setState((prev) => ({ ...prev, showBackConfirmDialog: false }))
  }, [])

  return (
    <div className='mx-auto flex h-full max-w-md flex-col'>
      {/* Header */}
      <div className='border-b p-4'>
        <RFScreenHeader
          title='GRS Cycle Count'
          subtitle={state.scannedLocation || 'Goods receipt'}
          onBack={handleBack}
          right={<Scan className='text-muted-foreground h-5 w-5' />}
        />
      </div>

      {/* Stepper */}
      <div className='px-4 py-2'>
        <div className='flex items-center justify-between'>
          {steps.map((step, index) => {
            const StepIcon = step.icon
            const isActive = state.currentStep === step.id
            const isCompleted = state.currentStep > step.id

            return (
              <div key={step.id} className='flex items-center'>
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors',
                    isActive &&
                      'bg-primary border-primary text-primary-foreground',
                    isCompleted &&
                      'bg-primary border-primary text-primary-foreground',
                    !isActive && !isCompleted && 'border-muted bg-background'
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle className='h-4 w-4' />
                  ) : (
                    <StepIcon className='h-4 w-4' />
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      'mx-1 h-0.5 w-8 transition-colors',
                      isCompleted ? 'bg-primary' : 'bg-muted'
                    )}
                  />
                )}
              </div>
            )
          })}
        </div>
        <div className='mt-1 flex justify-between'>
          {steps.map((step) => (
            <span key={step.id} className='text-muted-foreground text-xs'>
              {step.title}
            </span>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className='flex-1 overflow-y-auto p-4'>
        <AnimatePresence mode='wait'>
          <motion.div
            key={state.currentStep}
            variants={contentVariants}
            initial='hidden'
            animate='visible'
            exit='exit'
            className='space-y-4'
          >
            {/* Step 1: Location Scan */}
            {state.currentStep === 1 && (
              <div className='space-y-4'>
                <div className='mb-6 space-y-2 text-center'>
                  <MapPin className='text-primary mx-auto h-12 w-12' />
                  <h3 className='text-lg font-semibold'>Scan Location</h3>
                  <p className='text-muted-foreground text-sm'>
                    Scan the location barcode to begin batch counting
                  </p>
                </div>

                <div className='space-y-4'>
                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>
                      Location Barcode
                    </Label>
                    <ScannerInput
                      ref={locationRef}
                      type='text'
                      placeholder='Scan location barcode'
                      value={state.scannedLocation}
                      onChange={(e) =>
                        setState((prev) => ({
                          ...prev,
                          scannedLocation: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleLocationScan(state.scannedLocation)
                        }
                      }}
                      disabled={state.isValidatingLocation}
                      className='text-center font-mono text-lg font-semibold'
                      autoFocus
                    />
                  </div>
                </div>

                {state.scannedLocation && !state.locationVerified && (
                  <Card className='border-dashed border-orange-500'>
                    <CardContent className='p-3'>
                      <div className='flex items-center justify-center text-sm'>
                        <div className='flex items-center space-x-2 text-orange-600'>
                          <AlertCircle className='h-4 w-4' />
                          <span className='font-medium'>
                            Scanned: {state.scannedLocation}
                          </span>
                        </div>
                      </div>
                      <p className='text-muted-foreground mt-1 text-center text-xs'>
                        Press Enter to verify location
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Step 2: Batch Scanning */}
            {state.currentStep === 2 && (
              <div className='space-y-4'>
                <div className='mb-6 space-y-2 text-center'>
                  <Package className='text-primary mx-auto h-12 w-12' />
                  <h3 className='text-lg font-semibold'>Scan Batches</h3>
                  <p className='text-muted-foreground text-sm'>
                    Scan all batches found at location {state.scannedLocation}
                  </p>
                </div>

                {/* Progress Card */}
                <Card className='bg-primary/5'>
                  <CardContent className='p-4'>
                    <div className='mb-2 flex items-center justify-between'>
                      <span className='text-sm font-medium'>Scan Progress</span>
                      <Badge
                        variant={
                          state.scannedBatchIds.size === state.batches.length
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {state.scannedBatchIds.size} / {state.batches.length}
                      </Badge>
                    </div>
                    <div className='bg-muted h-2 w-full rounded-full'>
                      <div
                        className='bg-primary h-2 rounded-full transition-all duration-300'
                        style={{
                          width: `${state.batches.length > 0 ? (state.scannedBatchIds.size / state.batches.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Batch Scan Input */}
                <div className='space-y-2'>
                  <Label className='text-sm font-medium'>Batch Number</Label>
                  <ScannerInput
                    ref={batchRef}
                    type='text'
                    placeholder='Scan batch number'
                    value={state.currentBatchScan}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        currentBatchScan: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleBatchScan(state.currentBatchScan)
                      }
                    }}
                    disabled={state.isProcessing}
                    className='text-center font-mono text-lg font-semibold'
                    autoFocus
                  />
                </div>

                {/* Batch List */}
                <Card>
                  <CardContent className='p-4'>
                    <h4 className='mb-3 text-sm font-semibold'>
                      Batches at this location
                    </h4>
                    <div className='max-h-64 space-y-2 overflow-y-auto'>
                      {state.batches.map((batch) => {
                        const isScanned = state.scannedBatchIds.has(batch.id)
                        const unrestrictedQty = batch.unrestricted || 0
                        const blockedQty = batch.blocked || 0
                        const isBlocked =
                          unrestrictedQty === 0 && blockedQty > 0
                        const displayQty = isBlocked
                          ? blockedQty
                          : unrestrictedQty

                        return (
                          <div
                            key={batch.id}
                            className={cn(
                              'flex items-center justify-between rounded-lg border p-2 transition-colors',
                              isScanned
                                ? 'border-green-500/30 bg-green-500/10 dark:border-green-500/40 dark:bg-green-500/20'
                                : 'bg-muted/30 border-border'
                            )}
                          >
                            <div className='flex-1'>
                              <div className='mb-1 flex items-center space-x-2'>
                                <p className='font-mono text-sm font-semibold'>
                                  {batch.batch}
                                </p>
                                {isBlocked && (
                                  <Badge
                                    variant='destructive'
                                    className='text-xs'
                                  >
                                    Blocked
                                  </Badge>
                                )}
                              </div>
                              <p className='text-muted-foreground text-xs'>
                                {batch.material} - {batch.material_description}
                              </p>
                              <p className='mt-1 text-xs font-medium'>
                                Qty: {displayQty.toLocaleString()}
                              </p>
                            </div>
                            {isScanned && (
                              <CheckCircle className='h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400' />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Step 3: Complete */}
            {state.currentStep === 3 && state.completionCountdown > 0 && (
              <Card className='border-green-200 bg-green-50'>
                <CardContent className='p-4'>
                  <div className='text-center'>
                    <CheckCircle className='mx-auto mb-4 h-16 w-16 text-green-500' />
                    <h3 className='mb-2 text-lg font-semibold text-green-800'>
                      Location Scan Complete!
                    </h3>
                    <p className='mb-1 text-sm text-green-700'>
                      Location: {state.scannedLocation}
                    </p>
                    <p className='mb-4 text-sm text-green-700'>
                      Scanned: {state.scannedBatchIds.size} /{' '}
                      {state.batches.length} batches
                    </p>
                    <p className='text-xs text-green-600'>
                      Starting new location in {state.completionCountdown}s...
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer actions */}
      {state.completionCountdown === 0 && (
        <div className='bg-card border-t p-4'>
          <div className='flex space-x-2'>
            {state.currentStep === 1 && (
              <Button
                onClick={() => handleLocationScan(state.scannedLocation)}
                disabled={
                  state.isValidatingLocation || !state.scannedLocation.trim()
                }
                className='flex-1'
              >
                {state.isValidatingLocation && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                Verify Location
              </Button>
            )}

            {state.currentStep === 2 && (
              <Button
                onClick={handleCompleteLocation}
                disabled={state.isProcessing}
                className='ml-auto'
                variant='default'
              >
                {state.isProcessing && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                Complete Location
                {state.scannedBatchIds.size > 0 && (
                  <Badge variant='secondary' className='ml-2'>
                    {state.scannedBatchIds.size}/{state.batches.length}
                  </Badge>
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Unknown Batch Dialog */}
      <RFUnknownBatchDialog
        isOpen={state.showUnknownBatchDialog}
        onClose={() =>
          setState((prev) => ({
            ...prev,
            showUnknownBatchDialog: false,
            unknownBatchNumber: '',
          }))
        }
        batchNumber={state.unknownBatchNumber}
        location={state.scannedLocation}
        onComplete={handleUnknownBatchComplete}
      />

      {/* Back Navigation Confirmation Dialog */}
      <ConfirmDialog
        isOpen={state.showBackConfirmDialog}
        title='Confirm Navigation'
        message='Scanned batches will remain marked as scanned in the system.'
        variant='warning'
        confirmText='Go Back'
        cancelText='Stay Here'
        onConfirm={handleConfirmBack}
        onCancel={handleCancelBack}
        details={[
          `You have scanned ${state.scannedBatchIds.size} batch${state.scannedBatchIds.size !== 1 ? 'es' : ''}`,
          'Your progress will be saved',
          'You can return to this location later',
        ]}
      />
    </div>
  )
}

export default RFGRSCycleCountForm

// Created and developed by Jai Singh
