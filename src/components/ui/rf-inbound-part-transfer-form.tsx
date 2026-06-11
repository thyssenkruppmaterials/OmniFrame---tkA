// Created and developed by Jai Singh
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRightLeft,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  MapPin,
  Scan,
  UserCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type {
  DropOffArea,
  DropOffAreaAssociateWithUser,
} from '@/lib/supabase/drop-off-area.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useInboundPartTransfer } from '@/hooks/use-inbound-part-transfer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

// ─── Types ────────────────────────────────────────────────────────────────
interface PartTransferFormData {
  tkaBatchNumber: string
  areaBarcode: string
  associateEmail: string
}

interface ScanPreview {
  materialNumber: string | null
  trackingNumber: string | null
  soLineRmaAfa: string | null
  quantity: number | null
  hotTruck: boolean | null
}

interface PartTransferState {
  currentStep: number // 1=TKA batch, 2=Area, 3=Associate email, 4=Confirm
  formData: PartTransferFormData
  scanPreview: ScanPreview | null
  area: DropOffArea | null
  associate: DropOffAreaAssociateWithUser | null
  isProcessing: boolean
  autoCompleteCountdown: number
  shouldSubmit: boolean
}

const INITIAL_STATE: PartTransferState = {
  currentStep: 1,
  formData: {
    tkaBatchNumber: '',
    areaBarcode: '',
    associateEmail: '',
  },
  scanPreview: null,
  area: null,
  associate: null,
  isProcessing: false,
  autoCompleteCountdown: 0,
  shouldSubmit: false,
}

// ─── Stepper primitives (mirroring rf-putaway-form.tsx) ───────────────────
interface StepperContextValue {
  activeStep: number
  orientation: 'horizontal' | 'vertical'
}

const StepperContext = React.createContext<StepperContextValue | undefined>(
  undefined
)

const Stepper = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    value: number
    orientation?: 'horizontal' | 'vertical'
  }
>(({ value, orientation = 'horizontal', className, ...props }, ref) => (
  <StepperContext.Provider value={{ activeStep: value, orientation }}>
    <div
      ref={ref}
      data-orientation={orientation}
      className={cn(
        'group/stepper inline-flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col',
        className
      )}
      {...props}
    />
  </StepperContext.Provider>
))
Stepper.displayName = 'Stepper'

const StepperItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { step: number; completed?: boolean }
>(({ step, completed, className, children, ...props }, ref) => {
  const ctx = React.useContext(StepperContext)
  const state =
    completed || (ctx && step < ctx.activeStep)
      ? 'completed'
      : ctx?.activeStep === step
        ? 'active'
        : 'inactive'
  return (
    <div
      ref={ref}
      data-state={state}
      className={cn(
        'group/step flex items-center group-data-[orientation=horizontal]/stepper:flex-row group-data-[orientation=vertical]/stepper:flex-col',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})
StepperItem.displayName = 'StepperItem'

const StepperIndicator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
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
))
StepperIndicator.displayName = 'StepperIndicator'

const StepperSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'bg-muted group-data-[state=completed]/step:bg-primary m-0.5 group-data-[orientation=horizontal]/stepper:h-0.5 group-data-[orientation=horizontal]/stepper:w-full group-data-[orientation=horizontal]/stepper:flex-1 group-data-[orientation=vertical]/stepper:h-12 group-data-[orientation=vertical]/stepper:w-0.5',
      className
    )}
    {...props}
  />
))
StepperSeparator.displayName = 'StepperSeparator'

// ─── Main component ───────────────────────────────────────────────────────
interface RFInboundPartTransferFormProps {
  onBack?: () => void
}

const AUTO_ADVANCE_DELAY = 800
const AUTO_COMPLETE_DELAY = 1500

const STEPS = [
  { id: 1, title: 'TKA Batch', icon: Scan },
  { id: 2, title: 'Drop-off Area', icon: MapPin },
  { id: 3, title: 'Accepting Associate', icon: UserCheck },
  { id: 4, title: 'Confirm', icon: CheckCircle },
]

const contentVariants = {
  hidden: { opacity: 0, x: 50 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, x: -50, transition: { duration: 0.2 } },
}

export const RFInboundPartTransferForm: React.FC<
  RFInboundPartTransferFormProps
> = ({ onBack }) => {
  const [state, setState] = useState<PartTransferState>(INITIAL_STATE)
  const [validatingStep, setValidatingStep] = useState<number | null>(null)

  const tkaBatchRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLInputElement>(null)
  const associateEmailRef = useRef<HTMLInputElement>(null)

  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const autoCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const isSubmittingRef = useRef(false)

  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  const {
    validateBatch,
    validateAreaBarcode,
    validateAssociateEmail,
    submitTransfer,
  } = useInboundPartTransfer()

  // Clear all timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
      if (autoCompleteTimerRef.current) {
        clearTimeout(autoCompleteTimerRef.current)
      }
    }
  }, [])

  // Focus management — re-run whenever the step changes
  useEffect(() => {
    const focusDelay = setTimeout(() => {
      if (state.currentStep === 1) tkaBatchRef.current?.focus()
      else if (state.currentStep === 2) areaRef.current?.focus()
      else if (state.currentStep === 3) associateEmailRef.current?.focus()
    }, 350)
    return () => clearTimeout(focusDelay)
  }, [state.currentStep])

  const resetForm = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer))
    timersRef.current.clear()
    if (autoCompleteTimerRef.current) {
      clearTimeout(autoCompleteTimerRef.current)
      autoCompleteTimerRef.current = null
    }
    isSubmittingRef.current = false
    setState(INITIAL_STATE)
    setValidatingStep(null)
  }, [])

  // ─── Step validators ────────────────────────────────────────────────────
  const validateStep1 = useCallback(
    async (rawBatch: string) => {
      const batch = rawBatch.trim()
      if (!batch) {
        toast.error('TKA Batch Number is required')
        return false
      }

      setValidatingStep(1)
      try {
        const result = await validateBatch(batch)
        if (!result.ok) {
          if (result.reason === 'not_found') {
            toast.error('No inbound scan found for this TKA batch')
          } else if (result.reason === 'error') {
            toast.error(result.errorMessage || 'Lookup failed')
          }
          return false
        }

        setState((prev) => ({
          ...prev,
          currentStep: 2,
          scanPreview: {
            materialNumber: result.data?.material_number ?? null,
            trackingNumber: result.data?.tracking_number ?? null,
            soLineRmaAfa: result.data?.so_line_rma_afa ?? null,
            quantity: result.data?.quantity ?? null,
            hotTruck: result.data?.hot_truck ?? null,
          },
        }))
        return true
      } finally {
        setValidatingStep(null)
      }
    },
    [validateBatch]
  )

  const validateStep2 = useCallback(
    async (rawBarcode: string) => {
      const barcode = rawBarcode.trim()
      if (!barcode) {
        toast.error('Drop-off area barcode is required')
        return false
      }

      setValidatingStep(2)
      try {
        const result = await validateAreaBarcode(barcode)
        if (!result.ok || !result.data) {
          if (result.reason === 'not_found') {
            toast.error('Drop-off area not found. Check the barcode.')
          } else if (result.reason === 'error') {
            toast.error(result.errorMessage || 'Lookup failed')
          }
          return false
        }

        setState((prev) => ({
          ...prev,
          currentStep: 3,
          area: result.data ?? null,
          associate: null,
          formData: { ...prev.formData, associateEmail: '' },
        }))
        return true
      } finally {
        setValidatingStep(null)
      }
    },
    [validateAreaBarcode]
  )

  const validateStep3 = useCallback(
    async (rawEmail: string) => {
      const email = rawEmail.trim()
      if (!email) {
        toast.error("Associate's login email is required")
        return false
      }
      if (!state.area) {
        toast.error('Scan a drop-off area first')
        return false
      }

      setValidatingStep(3)
      try {
        const result = await validateAssociateEmail(state.area.id, email)
        if (!result.ok || !result.data) {
          if (result.reason === 'unknown_user') {
            toast.error('No user found with that login email.')
          } else if (result.reason === 'not_authorized') {
            toast.error(
              `That associate isn't authorized to accept drop-offs at ${state.area.name}.`
            )
          } else if (result.reason === 'error') {
            toast.error(result.errorMessage || 'Lookup failed')
          }
          return false
        }

        setState((prev) => ({
          ...prev,
          currentStep: 4,
          associate: result.data ?? null,
        }))
        return true
      } finally {
        setValidatingStep(null)
      }
    },
    [state.area, validateAssociateEmail]
  )

  // ─── Field change with trailing auto-advance ────────────────────────────
  const handleFieldChange = useCallback(
    (
      field: keyof PartTransferFormData,
      value: string,
      opts: { autoAdvance?: boolean } = { autoAdvance: true }
    ) => {
      const existing = timersRef.current.get(field)
      if (existing) {
        clearTimeout(existing)
        timersRef.current.delete(field)
      }

      setState((prev) => ({
        ...prev,
        formData: { ...prev.formData, [field]: value },
      }))

      if (!opts.autoAdvance) return
      if (!value.trim()) return

      const timer = setTimeout(async () => {
        timersRef.current.delete(field)
        if (field === 'tkaBatchNumber') {
          await validateStep1(value)
        } else if (field === 'areaBarcode') {
          await validateStep2(value)
        } else if (field === 'associateEmail') {
          await validateStep3(value)
        }
      }, AUTO_ADVANCE_DELAY)

      timersRef.current.set(field, timer)
    },
    [validateStep1, validateStep2, validateStep3]
  )

  // ─── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (isSubmittingRef.current) return
    if (!state.area || !state.associate) {
      toast.error('Missing drop-off area or associate')
      return
    }

    isSubmittingRef.current = true
    setState((prev) => ({ ...prev, isProcessing: true }))

    try {
      await submitTransfer({
        tka_batch_number: state.formData.tkaBatchNumber.trim(),
        drop_off_area_id: state.area.id,
        accepted_by_associate_id: state.associate.id,
      })

      toast.success(
        `Transfer recorded: ${state.formData.tkaBatchNumber.trim()} → ${state.area.name}`
      )

      setTimeout(() => {
        resetForm()
      }, 800)
    } catch (error) {
      logger.error('Error submitting inbound part transfer:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to record transfer'
      )
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        shouldSubmit: false,
        autoCompleteCountdown: 0,
      }))
      isSubmittingRef.current = false
    }
  }, [
    state.area,
    state.associate,
    state.formData.tkaBatchNumber,
    submitTransfer,
    resetForm,
  ])

  // Auto-complete countdown on confirm step
  useEffect(() => {
    if (state.currentStep !== 4 || state.isProcessing) return
    if (state.autoCompleteCountdown > 0 || state.shouldSubmit) return
    if (autoCompleteTimerRef.current) return

    toast.info(`Completing in ${AUTO_COMPLETE_DELAY / 1000}s — review below`)
    setState((prev) => ({
      ...prev,
      autoCompleteCountdown: AUTO_COMPLETE_DELAY,
    }))

    autoCompleteTimerRef.current = setTimeout(() => {
      autoCompleteTimerRef.current = null
      setState((prev) => ({ ...prev, shouldSubmit: true }))
    }, AUTO_COMPLETE_DELAY)
  }, [
    state.currentStep,
    state.isProcessing,
    state.autoCompleteCountdown,
    state.shouldSubmit,
  ])

  // Fire the actual submit once shouldSubmit toggles
  useEffect(() => {
    if (state.shouldSubmit) {
      handleSubmit()
    }
  }, [state.shouldSubmit, handleSubmit])

  // Cancel auto-complete if the user navigates back
  useEffect(() => {
    if (state.currentStep !== 4 && autoCompleteTimerRef.current) {
      clearTimeout(autoCompleteTimerRef.current)
      autoCompleteTimerRef.current = null
      setState((prev) => ({
        ...prev,
        autoCompleteCountdown: 0,
        shouldSubmit: false,
      }))
    }
  }, [state.currentStep])

  // ─── Navigation ─────────────────────────────────────────────────────────
  const goToPreviousStep = useCallback(() => {
    if (state.currentStep <= 1) return
    const prevStep = state.currentStep - 1
    setState((prev) => ({
      ...prev,
      currentStep: prevStep,
      ...(prevStep <= 1
        ? { scanPreview: null, area: null, associate: null }
        : prevStep === 2
          ? { area: null, associate: null }
          : prevStep === 3
            ? { associate: null }
            : {}),
    }))
  }, [state.currentStep])

  const goToNextStep = useCallback(async () => {
    if (state.currentStep === 1) {
      await validateStep1(state.formData.tkaBatchNumber)
    } else if (state.currentStep === 2) {
      await validateStep2(state.formData.areaBarcode)
    } else if (state.currentStep === 3) {
      await validateStep3(state.formData.associateEmail)
    }
  }, [
    state.currentStep,
    state.formData,
    validateStep1,
    validateStep2,
    validateStep3,
  ])

  const getCurrentStepIndex = useCallback(
    () => state.currentStep - 1,
    [state.currentStep]
  )

  return (
    <div className='mx-auto w-full max-w-md space-y-6 p-4'>
      <Stepper value={getCurrentStepIndex()} className='w-full'>
        {STEPS.map((step, index) => (
          <StepperItem
            key={step.id}
            step={index}
            completed={index < getCurrentStepIndex()}
            className='not-last:flex-1'
          >
            <div className='flex flex-col items-center space-y-2'>
              <StepperIndicator
                data-state={
                  index < getCurrentStepIndex()
                    ? 'completed'
                    : index === getCurrentStepIndex()
                      ? 'active'
                      : 'inactive'
                }
              >
                {index < getCurrentStepIndex() ? (
                  <CheckCircle className='h-4 w-4' />
                ) : (
                  React.createElement(step.icon, { className: 'h-4 w-4' })
                )}
              </StepperIndicator>
              <div className='text-center text-xs font-medium'>
                {step.title}
              </div>
            </div>
            {index < STEPS.length - 1 && (
              <StepperSeparator
                data-state={
                  index < getCurrentStepIndex() ? 'completed' : 'inactive'
                }
                className='mx-2'
              />
            )}
          </StepperItem>
        ))}
      </Stepper>

      <Card className='min-h-[400px]'>
        <CardHeader>
          <RFScreenHeader
            title='Part Transfer'
            subtitle='Move material'
            onBack={onBack}
          />
        </CardHeader>
        <CardContent>
          <AnimatePresence mode='wait'>
            <motion.div
              key={state.currentStep}
              initial='hidden'
              animate='visible'
              exit='exit'
              variants={contentVariants}
              className='space-y-4'
            >
              {state.currentStep === 1 && (
                <div className='space-y-4'>
                  <div className='mb-6 space-y-2 text-center'>
                    <ArrowRightLeft className='text-muted-foreground mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Inbound Part Transfer
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Scan the TKA batch you're moving out of inbound.
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <Label
                      htmlFor='tkaBatchNumber'
                      className='text-sm font-medium'
                    >
                      TKA Batch Number *
                    </Label>
                    <ScannerInput
                      ref={tkaBatchRef}
                      id='tkaBatchNumber'
                      placeholder='Scan TKA batch from inbound label'
                      value={state.formData.tkaBatchNumber}
                      onChange={(e) =>
                        handleFieldChange(
                          'tkaBatchNumber',
                          e.target.value.toUpperCase()
                        )
                      }
                      className='text-center font-mono'
                      autoComplete='off'
                    />
                    {validatingStep === 1 && (
                      <div className='text-muted-foreground flex items-center justify-center py-1 text-xs'>
                        <Loader2 className='mr-2 h-3 w-3 animate-spin' />
                        Looking up batch...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {state.currentStep === 2 && (
                <div className='space-y-4'>
                  <div className='mb-4 space-y-2 text-center'>
                    <MapPin className='text-muted-foreground mx-auto h-10 w-10' />
                    <h3 className='text-lg font-semibold'>Drop-off Area</h3>
                    <p className='text-muted-foreground text-sm'>
                      Walk to the drop-off area and scan its barcode.
                    </p>
                  </div>

                  {state.scanPreview && (
                    <div className='bg-muted/40 space-y-1 rounded border p-3 text-xs'>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>TKA Batch</span>
                        <code className='font-mono font-semibold'>
                          {state.formData.tkaBatchNumber}
                        </code>
                      </div>
                      {state.scanPreview.materialNumber && (
                        <div className='flex justify-between'>
                          <span className='text-muted-foreground'>
                            Material
                          </span>
                          <span className='font-medium'>
                            {state.scanPreview.materialNumber}
                          </span>
                        </div>
                      )}
                      {state.scanPreview.trackingNumber && (
                        <div className='flex justify-between'>
                          <span className='text-muted-foreground'>
                            Tracking
                          </span>
                          <span>{state.scanPreview.trackingNumber}</span>
                        </div>
                      )}
                      {state.scanPreview.quantity != null && (
                        <div className='flex justify-between'>
                          <span className='text-muted-foreground'>Qty</span>
                          <span>{state.scanPreview.quantity}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className='space-y-2'>
                    <Label
                      htmlFor='areaBarcode'
                      className='text-sm font-medium'
                    >
                      Drop-off Area Barcode *
                    </Label>
                    <ScannerInput
                      ref={areaRef}
                      id='areaBarcode'
                      placeholder='Scan area barcode'
                      value={state.formData.areaBarcode}
                      onChange={(e) =>
                        handleFieldChange(
                          'areaBarcode',
                          e.target.value.toUpperCase()
                        )
                      }
                      className='text-center font-mono'
                      autoComplete='off'
                    />
                    {validatingStep === 2 && (
                      <div className='text-muted-foreground flex items-center justify-center py-1 text-xs'>
                        <Loader2 className='mr-2 h-3 w-3 animate-spin' />
                        Validating area...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {state.currentStep === 3 && (
                <div className='space-y-4'>
                  <div className='mb-4 space-y-2 text-center'>
                    <UserCheck className='text-muted-foreground mx-auto h-10 w-10' />
                    <h3 className='text-lg font-semibold'>
                      Accepting Associate
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Ask the receiving associate to scan their login-email QR
                      code from their lanyard.
                    </p>
                  </div>

                  {state.area && (
                    <div className='rounded border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-800 dark:bg-blue-950/20'>
                      <p className='text-muted-foreground'>Dropping off at</p>
                      <p className='text-base font-semibold text-blue-700 dark:text-blue-300'>
                        {state.area.name}
                      </p>
                      <code className='bg-background/60 mt-1 inline-block rounded px-2 py-0.5 font-mono text-[10px]'>
                        {state.area.barcode}
                      </code>
                    </div>
                  )}

                  <div className='space-y-2'>
                    <Label
                      htmlFor='associateEmail'
                      className='flex items-center gap-1 text-sm font-medium'
                    >
                      <Mail className='h-3.5 w-3.5' />
                      Associate Login Email (QR) *
                    </Label>
                    <ScannerInput
                      ref={associateEmailRef}
                      id='associateEmail'
                      type='email'
                      inputMode='email'
                      placeholder='Scan lanyard QR or type email'
                      value={state.formData.associateEmail}
                      onChange={(e) =>
                        handleFieldChange(
                          'associateEmail',
                          e.target.value.toLowerCase()
                        )
                      }
                      className='text-center font-mono'
                      autoComplete='off'
                    />
                    {validatingStep === 3 && (
                      <div className='text-muted-foreground flex items-center justify-center py-1 text-xs'>
                        <Loader2 className='mr-2 h-3 w-3 animate-spin' />
                        Validating associate...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {state.currentStep === 4 && (
                <div className='space-y-4'>
                  <div className='mb-4 space-y-2 text-center'>
                    <CheckCircle className='mx-auto h-10 w-10 text-green-500' />
                    <h3 className='text-lg font-semibold'>Confirm Transfer</h3>
                    <p className='text-muted-foreground text-sm'>
                      Recording automatically in a moment.
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <div className='bg-muted rounded p-3'>
                      <p className='text-muted-foreground mb-1 text-xs'>
                        TKA Batch
                      </p>
                      <p className='font-mono font-semibold'>
                        {state.formData.tkaBatchNumber}
                      </p>
                      {state.scanPreview?.materialNumber && (
                        <p className='text-muted-foreground text-xs'>
                          Material: {state.scanPreview.materialNumber}
                        </p>
                      )}
                    </div>

                    <div className='bg-muted rounded p-3'>
                      <p className='text-muted-foreground mb-1 text-xs'>
                        Drop-off Area
                      </p>
                      <p className='font-medium'>{state.area?.name}</p>
                      <code className='text-muted-foreground text-xs'>
                        {state.area?.barcode}
                      </code>
                    </div>

                    <div className='bg-muted rounded p-3'>
                      <p className='text-muted-foreground mb-1 text-xs'>
                        Accepted by
                      </p>
                      <p className='font-medium'>
                        {state.associate?.user_profile?.full_name ||
                          state.associate?.full_name ||
                          state.associate?.user_profile?.email ||
                          'Associate'}
                      </p>
                      {state.associate?.user_profile?.email && (
                        <code className='text-muted-foreground text-xs'>
                          <Mail className='mr-1 inline h-3 w-3' />
                          {state.associate.user_profile.email}
                        </code>
                      )}
                    </div>

                    <div className='bg-muted rounded p-3'>
                      <p className='text-muted-foreground mb-1 text-xs'>
                        Dropped off by
                      </p>
                      <p className='font-medium'>
                        {profile?.full_name || user?.email || 'Unknown user'}
                      </p>
                    </div>
                  </div>

                  {state.isProcessing && (
                    <div className='py-4 text-center'>
                      <Loader2 className='mx-auto mb-2 h-8 w-8 animate-spin' />
                      <p className='text-muted-foreground text-sm'>
                        Recording transfer...
                      </p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      {state.currentStep !== 4 && (
        <div className='flex justify-between space-x-3'>
          <Button
            variant='outline'
            onClick={goToPreviousStep}
            disabled={state.currentStep === 1}
            className='flex-1'
          >
            <ChevronLeft className='mr-1 h-4 w-4' />
            Back
          </Button>
          <Button
            onClick={goToNextStep}
            disabled={validatingStep !== null}
            className='flex-1'
          >
            {validatingStep !== null ? (
              <>
                <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                Checking...
              </>
            ) : (
              <>
                Next
                <ChevronRight className='ml-1 h-4 w-4' />
              </>
            )}
          </Button>
        </div>
      )}

      {state.currentStep === 4 &&
        !state.isProcessing &&
        state.autoCompleteCountdown === 0 && (
          <Button
            onClick={handleSubmit}
            disabled={state.isProcessing}
            size='lg'
            className='w-full'
          >
            <CheckCircle className='mr-2 h-4 w-4' />
            Complete Transfer
          </Button>
        )}

      {state.currentStep === 4 && state.autoCompleteCountdown > 0 && (
        <Button
          variant='outline'
          onClick={() => {
            if (autoCompleteTimerRef.current) {
              clearTimeout(autoCompleteTimerRef.current)
              autoCompleteTimerRef.current = null
            }
            setState((prev) => ({
              ...prev,
              autoCompleteCountdown: 0,
            }))
          }}
          className='w-full'
        >
          Cancel auto-complete
        </Button>
      )}
    </div>
  )
}

RFInboundPartTransferForm.displayName = 'RFInboundPartTransferForm'

export default RFInboundPartTransferForm

// Created and developed by Jai Singh
