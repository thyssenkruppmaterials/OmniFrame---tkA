// Created and developed by Jai Singh
'use client'

/**
 * RF Dock Staging Form
 *
 * Mobile-optimised dock-staging workflow for the RF Terminal. Lets an
 * operator scan (or type) a kit identifier, verify the kit is dock-ready
 * (build complete + inspected — or build complete only, depending on the
 * org's `kit_inspection_required` setting), then scan the dock location
 * barcode to stamp `kit_ready_on_dock_*` + `kit_dock_location` on
 * `RR_Kitting_DATA`.
 *
 * Created: 2026-05-17 — sibling to `RFBuildKitForm` and the
 * just-shipped Optional-Kit-Inspection-Toggle. The on-dock stamp moved
 * out of `completeKitBuild` into this flow so the dock-location
 * persistence is captured on every kit, regardless of inspection mode.
 *
 * Workflow:
 *   1. `kit_scan`        — Scan Kit Serial (`KIT-…`) or Kit PO. Smart
 *                          detect via `isPotentialKitSerialNumber`.
 *   2. `kit_select`      — Optional disambiguation when a PO covers
 *                          more than one dock-ready kit.
 *   3. `kit_summary`     — Confirm the loaded kit's identity (serial
 *                          is the hero label).
 *   4. `dock_scan`       — Scan a configured dock location barcode.
 *                          "Tap to select" fallback list rendered
 *                          below the input for damaged barcodes.
 *   5. `confirm`         — Big primary button stages the kit.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronLeft,
  Loader2,
  MapPin,
  PackageCheck,
  Scan,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { isPotentialKitSerialNumber } from '@/lib/supabase/rf-kitting-picking.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useDockStaging } from '@/hooks/use-dock-staging'
import { useKittingOptions } from '@/hooks/use-kitting-options'
import { useKitInspectionRequired } from '@/hooks/use-kitting-workflow-settings'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

interface DockStagingKitData {
  kitPoNumber: string
  kitSerialNumber: string
  kitBuildNumber: string
  kitNumber: string
  engineProgram: string
  deliverToPlant: string
  dueDate: string | null
  status: string
}

interface DisambiguationOption {
  kit_serial_number: string
  kit_number: string
  kit_build_status: string
  kit_build_number: string | null
}

type DockStagingStep =
  | 'kit_scan'
  | 'kit_select'
  | 'kit_summary'
  | 'dock_scan'
  | 'confirm'

interface FormState {
  currentStep: DockStagingStep
  kitData: DockStagingKitData | null
  kitOptions: DisambiguationOption[] | null
  scannedKitInput: string
  scannedDock: string
  isProcessing: boolean
}

interface RFDockStagingFormProps {
  onBack?: () => void
}

const RFDockStagingForm: React.FC<RFDockStagingFormProps> = ({ onBack }) => {
  const [state, setState] = useState<FormState>({
    currentStep: 'kit_scan',
    kitData: null,
    kitOptions: null,
    scannedKitInput: '',
    scannedDock: '',
    isProcessing: false,
  })
  const [kitInput, setKitInput] = useState('')
  const [dockInput, setDockInput] = useState('')

  const kitInputRef = useRef<HTMLInputElement>(null)
  const dockInputRef = useRef<HTMLInputElement>(null)

  const { authState } = useUnifiedAuth()
  const { isAuthenticated, isLoading: isAuthLoading } = authState

  const kitInspectionRequired = useKitInspectionRequired()

  const { activeOptionsByGroup, isLoading: isLoadingOptions } =
    useKittingOptions(['dock_location'])
  const dockOptions = activeOptionsByGroup.dock_location ?? []

  const { verifyKitAsync, isVerifyingKit, stageKitAsync, isStagingKit } =
    useDockStaging()

  // Auto-focus the active input on each step transition.
  useEffect(() => {
    const focus = () => {
      switch (state.currentStep) {
        case 'kit_scan':
          setTimeout(() => kitInputRef.current?.focus(), 100)
          break
        case 'dock_scan':
          setTimeout(() => dockInputRef.current?.focus(), 100)
          break
      }
    }
    focus()
  }, [state.currentStep])

  const dockOptionByValue = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>()
    for (const o of dockOptions) {
      map.set(o.option_value.toUpperCase(), {
        value: o.option_value,
        label: o.option_label,
      })
    }
    return map
  }, [dockOptions])

  const handleKitScan = useCallback(async () => {
    const scanned = kitInput.trim()
    if (!scanned) {
      toast.error('Please enter a Kit Serial Number or PO')
      return
    }

    if (!isAuthenticated || isAuthLoading) {
      toast.error('Authentication required. Please refresh the page.')
      return
    }

    setState((prev) => ({ ...prev, isProcessing: true }))

    try {
      const isSerial = isPotentialKitSerialNumber(scanned)
      const result = await verifyKitAsync({
        kitSerialNumber: isSerial ? scanned : null,
        kitPoNumber: isSerial ? null : scanned,
        kitInspectionRequired,
      })

      if (result.success && result.kitData) {
        setState((prev) => ({
          ...prev,
          kitData: result.kitData!,
          kitOptions: null,
          scannedKitInput: scanned,
          isProcessing: false,
          currentStep: 'kit_summary',
        }))
        return
      }

      if (result.kits && result.kits.length > 0) {
        setState((prev) => ({
          ...prev,
          kitOptions: result.kits!,
          scannedKitInput: scanned,
          isProcessing: false,
          currentStep: 'kit_select',
        }))
        return
      }

      toast.error(result.error || 'Kit could not be loaded for dock staging')
      setState((prev) => ({ ...prev, isProcessing: false }))
      setKitInput('')
      setTimeout(() => kitInputRef.current?.focus(), 100)
    } catch (error: unknown) {
      logger.error('[DockStaging] kit scan failed:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to load kit')
      setState((prev) => ({ ...prev, isProcessing: false }))
    }
  }, [
    kitInput,
    isAuthenticated,
    isAuthLoading,
    verifyKitAsync,
    kitInspectionRequired,
  ])

  const handleKitSerialSelect = useCallback(
    async (option: DisambiguationOption) => {
      setState((prev) => ({ ...prev, isProcessing: true }))
      try {
        const result = await verifyKitAsync({
          kitSerialNumber: option.kit_serial_number,
          kitInspectionRequired,
        })
        if (result.success && result.kitData) {
          setState((prev) => ({
            ...prev,
            kitData: result.kitData!,
            kitOptions: null,
            isProcessing: false,
            currentStep: 'kit_summary',
          }))
        } else {
          toast.error(result.error || 'Kit not ready for dock staging')
          setState((prev) => ({ ...prev, isProcessing: false }))
        }
      } catch (error: unknown) {
        logger.error('[DockStaging] kit-select verify failed:', error)
        toast.error(
          error instanceof Error ? error.message : 'Failed to load kit'
        )
        setState((prev) => ({ ...prev, isProcessing: false }))
      }
    },
    [verifyKitAsync, kitInspectionRequired]
  )

  const handleCancelKitSelect = useCallback(() => {
    setKitInput('')
    setState((prev) => ({
      ...prev,
      kitOptions: null,
      scannedKitInput: '',
      currentStep: 'kit_scan',
    }))
    setTimeout(() => kitInputRef.current?.focus(), 100)
  }, [])

  const handleDockScanSubmit = useCallback(() => {
    const scanned = dockInput.trim()
    if (!scanned) {
      toast.error('Please scan a dock location')
      return
    }

    const matched = dockOptionByValue.get(scanned.toUpperCase())
    if (!matched) {
      toast.error(
        `Unknown dock location "${scanned}". Configure it in Kitting Apps Settings → Dropdowns → Dock Locations.`
      )
      setDockInput('')
      setTimeout(() => dockInputRef.current?.focus(), 100)
      return
    }

    setState((prev) => ({
      ...prev,
      scannedDock: matched.value,
      currentStep: 'confirm',
    }))
  }, [dockInput, dockOptionByValue])

  const handleDockOptionTap = useCallback(
    (option: { value: string; label: string }) => {
      setDockInput(option.value)
      setState((prev) => ({
        ...prev,
        scannedDock: option.value,
        currentStep: 'confirm',
      }))
    },
    []
  )

  const handleConfirm = useCallback(async () => {
    if (!state.kitData || !state.scannedDock) return
    try {
      const result = await stageKitAsync({
        kitSerialNumber: state.kitData.kitSerialNumber,
        dockLocation: state.scannedDock,
      })
      if (result.success) {
        // Reset for next kit.
        setKitInput('')
        setDockInput('')
        setState({
          currentStep: 'kit_scan',
          kitData: null,
          kitOptions: null,
          scannedKitInput: '',
          scannedDock: '',
          isProcessing: false,
        })
        setTimeout(() => kitInputRef.current?.focus(), 100)
      }
    } catch (error: unknown) {
      logger.error('[DockStaging] stage failed:', error)
    }
  }, [state.kitData, state.scannedDock, stageKitAsync])

  const handleStartOver = useCallback(() => {
    setKitInput('')
    setDockInput('')
    setState({
      currentStep: 'kit_scan',
      kitData: null,
      kitOptions: null,
      scannedKitInput: '',
      scannedDock: '',
      isProcessing: false,
    })
  }, [])

  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.3 } },
  }

  return (
    <div className='mx-auto w-full max-w-md space-y-4 p-4'>
      <RFScreenHeader
        title='Dock Staging'
        subtitle={
          state.kitData && state.currentStep !== 'kit_scan'
            ? `${state.kitData.kitSerialNumber} • ${state.kitData.kitNumber}`
            : 'Stage to dock'
        }
        onBack={onBack}
      />

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
              {state.currentStep === 'kit_scan' && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <Truck className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Scan Kit Serial Number
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Scan the kit serial number (
                      <span className='font-mono'>KIT-…</span>) to stage it on a
                      dock. Legacy Kit PO numbers are still accepted.
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='dock-staging-kit'>
                      Kit Serial Number or PO
                    </Label>
                    <ScannerInput
                      ref={kitInputRef}
                      id='dock-staging-kit'
                      type='text'
                      placeholder='Scan KIT-YYYYMMDD-NNN or Kit PO'
                      value={kitInput}
                      onChange={(e) =>
                        setKitInput(e.target.value.toUpperCase())
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleKitScan()
                        }
                      }}
                      className='h-12 text-center font-mono text-lg'
                      disabled={state.isProcessing || isVerifyingKit}
                    />
                  </div>

                  {(state.isProcessing || isVerifyingKit) && (
                    <div className='flex items-center justify-center py-4'>
                      <Loader2 className='mr-2 h-6 w-6 animate-spin' />
                      <span>Loading kit…</span>
                    </div>
                  )}

                  <Button
                    onClick={handleKitScan}
                    disabled={
                      !kitInput.trim() || state.isProcessing || isVerifyingKit
                    }
                    className='h-12 w-full'
                  >
                    <Scan className='mr-2 h-4 w-4' />
                    Load Kit
                  </Button>
                </div>
              )}

              {state.currentStep === 'kit_select' &&
                state.kitOptions &&
                state.kitOptions.length > 0 && (
                  <div className='space-y-4'>
                    <div className='space-y-2 text-center'>
                      <PackageCheck className='text-primary mx-auto h-12 w-12' />
                      <h3 className='text-lg font-semibold'>Select a Kit</h3>
                      <p className='text-muted-foreground text-sm'>
                        Kit PO{' '}
                        <span className='font-mono'>
                          {state.scannedKitInput}
                        </span>{' '}
                        covers {state.kitOptions.length} kits. Pick the one you
                        are staging.
                      </p>
                    </div>

                    <div className='space-y-2'>
                      {state.kitOptions.map((option) => (
                        <button
                          key={option.kit_serial_number}
                          type='button'
                          onClick={() => handleKitSerialSelect(option)}
                          disabled={state.isProcessing || isVerifyingKit}
                          className={cn(
                            'border-border hover:bg-accent/40 w-full rounded-lg border p-3 text-left transition-colors disabled:opacity-50'
                          )}
                        >
                          <div className='font-mono text-sm font-semibold'>
                            {option.kit_serial_number}
                          </div>
                          <div className='text-xs'>
                            {option.kit_number || 'Unnamed kit'}
                          </div>
                          <div className='text-muted-foreground text-[11px] capitalize'>
                            {option.kit_build_status}
                            {option.kit_build_number
                              ? ` • Build ${option.kit_build_number}`
                              : ''}
                          </div>
                        </button>
                      ))}
                    </div>

                    <Button
                      variant='outline'
                      onClick={handleCancelKitSelect}
                      disabled={state.isProcessing || isVerifyingKit}
                      className='h-11 w-full'
                    >
                      <ChevronLeft className='mr-2 h-4 w-4' />
                      Cancel / Re-scan
                    </Button>
                  </div>
                )}

              {state.currentStep === 'kit_summary' && state.kitData && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <PackageCheck className='mx-auto h-12 w-12 text-green-500' />
                    <h3 className='text-lg font-semibold'>
                      Kit Ready to Stage
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Confirm this is the kit you are placing on the dock.
                    </p>
                  </div>

                  <div className='bg-muted/30 rounded-lg border-2 border-dashed p-4 text-center'>
                    <div className='text-muted-foreground mb-1 text-xs uppercase'>
                      Kit Serial
                    </div>
                    <div className='text-primary font-mono text-2xl font-bold break-all'>
                      {state.kitData.kitSerialNumber}
                    </div>
                  </div>

                  <Card className='bg-muted/20 p-3'>
                    <div className='space-y-2 text-xs'>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>Kit PO:</span>
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
                          Engine Program:
                        </span>
                        <span>{state.kitData.engineProgram}</span>
                      </div>
                      {state.kitData.deliverToPlant && (
                        <div className='flex justify-between'>
                          <span className='text-muted-foreground'>
                            Deliver To:
                          </span>
                          <span>{state.kitData.deliverToPlant}</span>
                        </div>
                      )}
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>Status:</span>
                        <span className='capitalize'>
                          {state.kitData.status}
                        </span>
                      </div>
                    </div>
                  </Card>

                  <Button
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        currentStep: 'dock_scan',
                      }))
                    }
                    className='h-12 w-full'
                  >
                    <MapPin className='mr-2 h-4 w-4' />
                    Continue to Dock Scan
                  </Button>

                  <Button
                    variant='outline'
                    onClick={handleStartOver}
                    className='w-full'
                  >
                    <ChevronLeft className='mr-2 h-4 w-4' />
                    Different Kit
                  </Button>
                </div>
              )}

              {state.currentStep === 'dock_scan' && state.kitData && (
                <div className='space-y-4'>
                  <div className='space-y-2 text-center'>
                    <MapPin className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Scan Dock Location
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Scan the dock barcode where the kit is staged. If the
                      barcode is damaged, tap a location below.
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='dock-scan'>Dock Location</Label>
                    <ScannerInput
                      ref={dockInputRef}
                      id='dock-scan'
                      type='text'
                      placeholder='Scan dock barcode'
                      value={dockInput}
                      onChange={(e) =>
                        setDockInput(e.target.value.toUpperCase())
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleDockScanSubmit()
                        }
                      }}
                      className='h-12 text-center font-mono text-lg'
                    />
                  </div>

                  <Button
                    onClick={handleDockScanSubmit}
                    disabled={!dockInput.trim()}
                    className='h-12 w-full'
                  >
                    <Scan className='mr-2 h-4 w-4' />
                    Validate Dock
                  </Button>

                  <div className='space-y-2'>
                    <p className='text-muted-foreground text-center text-xs tracking-wide uppercase'>
                      Or tap to select
                    </p>
                    {isLoadingOptions ? (
                      <div className='flex items-center justify-center py-2'>
                        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
                        <span className='text-sm'>Loading dock locations…</span>
                      </div>
                    ) : dockOptions.length === 0 ? (
                      <p className='text-muted-foreground rounded border border-dashed p-3 text-center text-xs'>
                        No dock locations configured for this org. Add some in
                        Kitting Apps Settings → Dropdowns → Dock Locations.
                      </p>
                    ) : (
                      <div className='grid grid-cols-2 gap-2'>
                        {dockOptions.map((option) => (
                          <button
                            key={option.id}
                            type='button'
                            onClick={() =>
                              handleDockOptionTap({
                                value: option.option_value,
                                label: option.option_label,
                              })
                            }
                            className='border-border hover:bg-accent/40 rounded-md border p-3 text-center transition-colors'
                          >
                            <div className='font-mono text-sm font-semibold'>
                              {option.option_value}
                            </div>
                            <div className='text-muted-foreground text-[11px]'>
                              {option.option_label}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    variant='outline'
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        currentStep: 'kit_summary',
                        scannedDock: '',
                      }))
                    }
                    className='w-full'
                  >
                    <ChevronLeft className='mr-2 h-4 w-4' />
                    Back to Kit Summary
                  </Button>
                </div>
              )}

              {state.currentStep === 'confirm' &&
                state.kitData &&
                state.scannedDock && (
                  <div className='space-y-4'>
                    <div className='space-y-2 text-center'>
                      <PackageCheck className='mx-auto h-12 w-12 text-green-500' />
                      <h3 className='text-lg font-semibold'>Confirm Staging</h3>
                      <p className='text-muted-foreground text-sm'>
                        Confirm the kit is at the dock and ready for shipping.
                      </p>
                    </div>

                    <Card className='bg-muted/20 p-3'>
                      <div className='space-y-2 text-sm'>
                        <div className='flex justify-between'>
                          <span className='text-muted-foreground'>Kit:</span>
                          <span className='font-mono font-semibold'>
                            {state.kitData.kitSerialNumber}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span className='text-muted-foreground'>Kit PO:</span>
                          <span className='font-mono'>
                            {state.kitData.kitPoNumber}
                          </span>
                        </div>
                        <div className='flex justify-between'>
                          <span className='text-muted-foreground'>Dock:</span>
                          <span className='font-mono font-semibold text-green-700 dark:text-green-300'>
                            {state.scannedDock}
                          </span>
                        </div>
                      </div>
                    </Card>

                    <Button
                      onClick={handleConfirm}
                      disabled={isStagingKit}
                      className='h-14 w-full bg-green-600 text-base hover:bg-green-700'
                    >
                      {isStagingKit ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          Staging…
                        </>
                      ) : (
                        <>
                          <PackageCheck className='mr-2 h-5 w-5' />
                          Stage to Dock — {state.scannedDock}
                        </>
                      )}
                    </Button>

                    <Button
                      variant='outline'
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          currentStep: 'dock_scan',
                          scannedDock: '',
                        }))
                      }
                      disabled={isStagingKit}
                      className='w-full'
                    >
                      <ChevronLeft className='mr-2 h-4 w-4' />
                      Change Dock
                    </Button>
                  </div>
                )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  )
}

export default RFDockStagingForm

// Created and developed by Jai Singh
