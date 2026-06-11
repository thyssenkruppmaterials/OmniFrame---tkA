// Created and developed by Jai Singh
import { useState, useCallback, useRef, useEffect } from 'react'
import { format, subDays } from 'date-fns'
import {
  IconArrowLeft,
  IconCheck,
  IconLoader2,
  IconPlus,
  IconTrash,
  IconExchange,
  IconCoffee,
  IconBeach,
  IconSnowflake,
  IconFirstAidKit,
  IconDots,
  IconLogin,
  IconLogout,
  IconBuilding,
} from '@tabler/icons-react'
import SignatureCanvas from 'react-signature-canvas'
import { supabase } from '@/lib/supabase/client'
import { createTimeAdjustmentRequest } from '@/lib/supabase/time-adjustment.service'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { Calendar } from '@/components/ui/calendar'
import { QWERTYKeyboard } from '@/components/ui/qwerty-keyboard'
import {
  lookupEmployeeByBadge,
  type EmployeeLookupResult,
} from '../services/time-clock.service'
import { KioskNumericKeypad } from './kiosk-numeric-keypad'
import KioskTimeDial from './kiosk-time-dial'

const PUNCH_TIME_CODES = new Set([
  'clock_in',
  'clock_out',
  'meal_in',
  'meal_out',
])

interface WorkingAreaOption {
  id: string
  area_name: string
  area_code: string
  primary_supervisor_name: string | null
}

interface WorkingAreaQueryRow {
  id: string
  area_name: string
  area_code: string
  primary_supervisor: { full_name: string | null } | null
}

type AdjustmentStep =
  | 'badge_scan'
  | 'department_select'
  | 'date_select'
  | 'correction_type'
  | 'clock_code'
  | 'reason'
  | 'hours'
  | 'signature'
  | 'review'
  | 'submitting'
  | 'success'
  | 'error'

interface KioskTimeAdjustmentProps {
  onBack: () => void
}

const CORRECTION_TYPES = [
  { id: 'add' as const, label: 'Add', icon: IconPlus, color: 'text-green-500' },
  {
    id: 'delete' as const,
    label: 'Delete',
    icon: IconTrash,
    color: 'text-red-500',
  },
  {
    id: 'change' as const,
    label: 'Change',
    icon: IconExchange,
    color: 'text-blue-500',
  },
]

const CLOCK_CODES = [
  { id: 'clock_in', label: 'Clock In', icon: IconLogin },
  { id: 'clock_out', label: 'Clock Out', icon: IconLogout },
  { id: 'meal_in', label: 'Meal In', icon: IconCoffee },
  { id: 'meal_out', label: 'Meal Out', icon: IconCoffee },
  { id: 'vacation', label: 'Vacation', icon: IconBeach },
  { id: 'floating_holiday', label: 'Floating Holiday', icon: IconSnowflake },
  { id: 'sick', label: 'Sick', icon: IconFirstAidKit },
  { id: 'other', label: 'Other', icon: IconDots },
]

const REASON_OPTIONS = [
  'Forgot to punch',
  'System error',
  'Schedule change',
  'Manager approved absence',
  'Incorrect punch type',
  'Other',
]

const CLOCK_CODE_LABELS: Record<string, string> = Object.fromEntries(
  CLOCK_CODES.map((c) => [c.id, c.label])
)

function getWizardFlow(skipHours: boolean): AdjustmentStep[] {
  return skipHours
    ? [
        'badge_scan',
        'department_select',
        'date_select',
        'correction_type',
        'clock_code',
        'reason',
        'signature',
        'review',
      ]
    : [
        'badge_scan',
        'department_select',
        'date_select',
        'correction_type',
        'clock_code',
        'reason',
        'hours',
        'signature',
        'review',
      ]
}

function getStepNumber(step: AdjustmentStep, skipHours: boolean): number {
  const idx = getWizardFlow(skipHours).indexOf(step)
  return idx >= 0 ? idx + 1 : 0
}

function getTotalSteps(skipHours: boolean): number {
  return getWizardFlow(skipHours).length
}

export default function KioskTimeAdjustment({
  onBack,
}: KioskTimeAdjustmentProps) {
  const [step, setStep] = useState<AdjustmentStep>('badge_scan')
  const [employee, setEmployee] = useState<EmployeeLookupResult | null>(null)
  const [badgeValue, setBadgeValue] = useState('')
  const [workingAreas, setWorkingAreas] = useState<WorkingAreaOption[]>([])
  const [areasLoading, setAreasLoading] = useState(false)
  const [selectedArea, setSelectedArea] = useState<WorkingAreaOption | null>(
    null
  )
  const [requestDate, setRequestDate] = useState(
    format(new Date(), 'yyyy-MM-dd')
  )
  const [correctionType, setCorrectionType] = useState<
    'add' | 'delete' | 'change' | null
  >(null)
  const [clockCode, setClockCode] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState<string | null>(null)
  const [reasonOther, setReasonOther] = useState('')
  const [hoursRequested, setHoursRequested] = useState<string>('')
  const [requestedTime, setRequestedTime] = useState<{
    hour: number
    minute: number
    period: 'AM' | 'PM'
  }>({ hour: 12, minute: 0, period: 'PM' })
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showOtherInput, setShowOtherInput] = useState(false)
  const [showCertification, setShowCertification] = useState(false)
  const [certificationAccepted, setCertificationAccepted] = useState(false)

  const sigCanvasRef = useRef<SignatureCanvas | null>(null)

  const skipHours = correctionType === 'delete'
  const isPunchTime = clockCode != null && PUNCH_TIME_CODES.has(clockCode)

  const formatTimeValue = (t: {
    hour: number
    minute: number
    period: 'AM' | 'PM'
  }) => `${t.hour}:${String(t.minute).padStart(2, '0')} ${t.period}`

  const goBack = useCallback(() => {
    const flow = getWizardFlow(skipHours)
    const idx = flow.indexOf(step)
    if (idx <= 0) {
      onBack()
    } else {
      setStep(flow[idx - 1])
    }
  }, [step, skipHours, onBack])

  const loadWorkingAreas = useCallback(async (orgId: string) => {
    setAreasLoading(true)
    try {
      const { data } = await supabase
        .from('working_areas')
        .select(
          `
          id,
          area_name,
          area_code,
          primary_supervisor:user_profiles!working_areas_primary_supervisor_id_fkey(full_name)
        `
        )
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('area_code', { ascending: true })

      if (data) {
        const rows = data as unknown as WorkingAreaQueryRow[]
        setWorkingAreas(
          rows.map((a) => ({
            id: a.id,
            area_name: a.area_name,
            area_code: a.area_code,
            primary_supervisor_name: a.primary_supervisor?.full_name || null,
          }))
        )
      }
    } catch {
      setWorkingAreas([])
    } finally {
      setAreasLoading(false)
    }
  }, [])

  const handleBadgeScan = useCallback(async () => {
    if (!badgeValue.trim()) return
    setIsSubmitting(true)
    setError(null)

    try {
      const emp = await lookupEmployeeByBadge(badgeValue.trim())
      if (!emp) {
        setError('Badge number not found. Please try again.')
        setIsSubmitting(false)
        return
      }
      setEmployee(emp)
      loadWorkingAreas(emp.organization_id)
      setCertificationAccepted(false)
      setShowCertification(true)
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }, [badgeValue, loadWorkingAreas])

  const handleCertificationAccept = useCallback(() => {
    setShowCertification(false)
    setStep('department_select')
  }, [])

  const handleSelectCorrectionType = (type: 'add' | 'delete' | 'change') => {
    setCorrectionType(type)
    setStep('clock_code')
  }

  const handleSelectClockCode = (code: string) => {
    setClockCode(code)
    setStep('reason')
  }

  const handleSelectReason = (reason: string) => {
    if (reason === 'Other') {
      setShowOtherInput(true)
      setReasonCode('other')
      return
    }
    setReasonCode(reason)
    setShowOtherInput(false)
    if (skipHours) {
      setStep('signature')
    } else {
      setStep('hours')
    }
  }

  const handleOtherReasonSubmit = () => {
    if (!reasonOther.trim()) return
    if (skipHours) {
      setStep('signature')
    } else {
      setStep('hours')
    }
  }

  const handleHoursSubmit = () => {
    if (isPunchTime) {
      setStep('signature')
      return
    }
    const val = parseFloat(hoursRequested)
    if (isNaN(val) || val <= 0 || val > 24) return
    setStep('signature')
  }

  const handleSignatureContinue = () => {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return
    const dataUrl = sigCanvasRef.current
      .getTrimmedCanvas()
      .toDataURL('image/png')
    setSignatureDataUrl(dataUrl)
    setStep('review')
  }

  const handleClearSignature = () => {
    sigCanvasRef.current?.clear()
    setSignatureDataUrl(null)
  }

  const handleSubmit = useCallback(async () => {
    if (
      !employee ||
      !correctionType ||
      !clockCode ||
      !reasonCode ||
      !signatureDataUrl
    )
      return
    setStep('submitting')
    setError(null)

    try {
      const { error: submitError } = await createTimeAdjustmentRequest({
        organization_id: employee.organization_id,
        requester_user_id: employee.user_id,
        requester_name: employee.full_name,
        requester_badge: employee.badge_number,
        request_date: requestDate,
        correction_type: correctionType,
        clock_code: clockCode,
        reason_code: reasonCode,
        reason_other: reasonCode === 'other' ? reasonOther : null,
        hours_requested: skipHours
          ? null
          : isPunchTime
            ? (() => {
                let h24 = requestedTime.hour % 12
                if (requestedTime.period === 'PM') h24 += 12
                return h24 + requestedTime.minute / 60
              })()
            : parseFloat(hoursRequested) || null,
        signature_data_url: signatureDataUrl,
        department_area: selectedArea
          ? `${selectedArea.area_name} (${selectedArea.area_code})`
          : null,
        supervisor_name: selectedArea?.primary_supervisor_name || null,
      })

      if (submitError) {
        setError(submitError)
        setStep('error')
      } else {
        setStep('success')
      }
    } catch {
      setError('An unexpected error occurred.')
      setStep('error')
    }
  }, [
    employee,
    correctionType,
    clockCode,
    reasonCode,
    reasonOther,
    requestDate,
    hoursRequested,
    signatureDataUrl,
    skipHours,
    isPunchTime,
    requestedTime,
    selectedArea,
  ])

  // Auto-return to home after success
  useEffect(() => {
    if (step !== 'success') return
    const timer = setTimeout(onBack, 5000)
    return () => clearTimeout(timer)
  }, [step, onBack])

  const stepNum = getStepNumber(step, skipHours)
  const totalSteps = getTotalSteps(skipHours)

  // ── Badge Scan ──
  if (step === 'badge_scan') {
    return (
      <div className='flex flex-col items-center gap-6'>
        <div className='flex w-full max-w-sm items-center gap-3'>
          <button
            onClick={onBack}
            className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition'
          >
            <IconArrowLeft className='h-4 w-4' />
            Back
          </button>
          <div className='flex-1 text-center'>
            <h2 className='text-foreground text-xl font-bold tracking-tight'>
              Time Adjustment
            </h2>
            <p className='text-muted-foreground text-xs'>
              Step 1 of {totalSteps} &mdash; Scan your badge
            </p>
          </div>
          <div className='w-14' />
        </div>

        <div className='w-full max-w-sm'>
          <div
            className='bg-card border-border text-foreground w-full rounded-xl border px-4 py-4 text-center font-mono text-xl tracking-widest'
            aria-live='polite'
          >
            {badgeValue || (
              <span className='text-muted-foreground/40'>Badge number...</span>
            )}
          </div>
        </div>

        <KioskNumericKeypad
          value={badgeValue}
          onChange={setBadgeValue}
          disabled={isSubmitting}
        />

        {error && (
          <div className='text-destructive bg-destructive/10 border-destructive/20 w-full max-w-sm rounded-lg border px-4 py-2.5 text-center text-sm'>
            {error}
          </div>
        )}

        <button
          onClick={handleBadgeScan}
          disabled={!badgeValue.trim() || isSubmitting}
          className='bg-primary hover:bg-primary/90 text-primary-foreground flex w-full max-w-sm items-center justify-center gap-2 rounded-xl py-4 text-base font-semibold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'
        >
          {isSubmitting ? (
            <IconLoader2 className='h-5 w-5 animate-spin' />
          ) : (
            'Continue'
          )}
        </button>

        <AlertDialog
          open={showCertification}
          onOpenChange={setShowCertification}
        >
          <AlertDialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-md'>
            <AlertDialogHeader>
              <AlertDialogTitle className='text-center text-lg font-bold'>
                Certification & Attestation
              </AlertDialogTitle>
              <AlertDialogDescription className='text-foreground/80 text-left text-sm leading-relaxed'>
                By checking the box below and submitting this form, I certify
                that all information provided above is true and accurate. I
                understand that falsifying time records violates company policy
                and is considered fraud or theft. Such actions may result in
                disciplinary measures, up to and including termination, as well
                as potential legal consequences. I acknowledge that typing my
                name below serves as my electronic signature and constitutes my
                formal attestation to the accuracy of this submission.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <label className='border-border bg-muted/50 mt-2 flex cursor-pointer items-start gap-3 rounded-lg border p-3'>
              <input
                type='checkbox'
                checked={certificationAccepted}
                onChange={(e) => setCertificationAccepted(e.target.checked)}
                className='accent-primary mt-0.5 h-5 w-5 shrink-0'
              />
              <span className='text-foreground text-sm font-medium'>
                I have read and agree to the above certification statement
              </span>
            </label>

            <AlertDialogFooter className='mt-2'>
              <AlertDialogCancel onClick={() => setShowCertification(false)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCertificationAccept}
                disabled={!certificationAccepted}
                className='disabled:cursor-not-allowed disabled:opacity-40'
              >
                I Agree &amp; Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  // ── Department / Area Select ──
  if (step === 'department_select') {
    return (
      <div className='flex flex-col items-center gap-6'>
        <StepHeader
          stepNum={stepNum}
          totalSteps={totalSteps}
          label='Select your department area'
          onBack={goBack}
          employee={employee}
        />

        {areasLoading ? (
          <div className='flex flex-col items-center gap-3 py-8'>
            <IconLoader2 className='text-muted-foreground h-8 w-8 animate-spin' />
            <p className='text-muted-foreground text-sm'>Loading areas...</p>
          </div>
        ) : workingAreas.length === 0 ? (
          <div className='w-full max-w-sm space-y-4'>
            <p className='text-muted-foreground text-center text-sm'>
              No department areas found.
            </p>
            <button
              onClick={() => {
                setSelectedArea(null)
                setStep('date_select')
              }}
              className='bg-primary hover:bg-primary/90 text-primary-foreground w-full rounded-xl py-4 text-base font-semibold shadow-sm transition active:scale-[0.98]'
            >
              Continue without area
            </button>
          </div>
        ) : (
          <div
            className='w-full max-w-sm space-y-2 overflow-y-auto'
            style={{ maxHeight: '400px' }}
          >
            {workingAreas.map((area) => (
              <button
                key={area.id}
                onClick={() => {
                  setSelectedArea(area)
                  setStep('date_select')
                }}
                className='border-border bg-card hover:border-primary/40 hover:bg-accent/50 flex w-full items-center gap-4 rounded-xl border p-4 text-left transition active:scale-[0.99]'
              >
                <div className='bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg'>
                  <IconBuilding className='text-muted-foreground h-5 w-5' />
                </div>
                <div className='min-w-0 flex-1'>
                  <p className='text-foreground truncate font-semibold'>
                    {area.area_name}
                  </p>
                  <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                    <span>{area.area_code}</span>
                    {area.primary_supervisor_name && (
                      <>
                        <span>&middot;</span>
                        <span>Supervisor: {area.primary_supervisor_name}</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Date Select ──
  if (step === 'date_select') {
    const selectedDate = requestDate
      ? new Date(requestDate + 'T12:00:00')
      : undefined

    return (
      <div className='flex flex-col items-center gap-4'>
        <StepHeader
          stepNum={stepNum}
          totalSteps={totalSteps}
          label='Date needed for adjustment'
          onBack={goBack}
          employee={employee}
        />

        <div className='bg-card border-border rounded-xl border p-2'>
          <Calendar
            mode='single'
            selected={selectedDate}
            onSelect={(date) => {
              if (date) setRequestDate(format(date, 'yyyy-MM-dd'))
            }}
            disabled={(date) =>
              date > new Date() || date < subDays(new Date(), 30)
            }
            defaultMonth={selectedDate}
            className='[--cell-size:--spacing(10)]'
          />
        </div>

        {requestDate && (
          <p className='text-foreground text-sm font-semibold'>
            Selected:{' '}
            {format(new Date(requestDate + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
          </p>
        )}

        <button
          onClick={() => setStep('correction_type')}
          disabled={!requestDate}
          className='bg-primary hover:bg-primary/90 text-primary-foreground w-full max-w-sm rounded-xl py-4 text-base font-semibold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'
        >
          Continue
        </button>
      </div>
    )
  }

  // ── Correction Type ──
  if (step === 'correction_type') {
    return (
      <div className='flex flex-col items-center gap-6'>
        <StepHeader
          stepNum={stepNum}
          totalSteps={totalSteps}
          label='Type of correction needed'
          onBack={goBack}
          employee={employee}
        />

        <div className='w-full max-w-sm space-y-3'>
          {CORRECTION_TYPES.map((ct) => {
            const Icon = ct.icon
            return (
              <button
                key={ct.id}
                onClick={() => handleSelectCorrectionType(ct.id)}
                className='border-border bg-card hover:border-primary/40 hover:bg-accent/50 flex w-full items-center gap-4 rounded-xl border p-4 text-left transition active:scale-[0.99]'
              >
                <div className='bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-lg'>
                  <Icon className={`h-6 w-6 ${ct.color}`} />
                </div>
                <span className='text-foreground text-lg font-semibold'>
                  {ct.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Clock Code ──
  if (step === 'clock_code') {
    return (
      <div className='flex flex-col items-center gap-6'>
        <StepHeader
          stepNum={stepNum}
          totalSteps={totalSteps}
          label='Clock code needed'
          onBack={goBack}
          employee={employee}
        />

        <div className='grid w-full max-w-sm grid-cols-2 gap-3'>
          {CLOCK_CODES.map((cc) => {
            const Icon = cc.icon
            return (
              <button
                key={cc.id}
                onClick={() => handleSelectClockCode(cc.id)}
                className='border-border bg-card hover:border-primary/40 hover:bg-accent/50 flex flex-col items-center gap-2 rounded-xl border p-4 transition active:scale-[0.98]'
              >
                <Icon className='text-muted-foreground h-6 w-6' />
                <span className='text-foreground text-sm font-semibold'>
                  {cc.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Reason ──
  if (step === 'reason') {
    return (
      <div className='flex flex-col items-center gap-6'>
        <StepHeader
          stepNum={stepNum}
          totalSteps={totalSteps}
          label='Reason for correction'
          onBack={goBack}
          employee={employee}
        />

        {showOtherInput ? (
          <div className='w-full max-w-sm space-y-4'>
            <QWERTYKeyboard
              value={reasonOther}
              onChange={setReasonOther}
              placeholder='Please describe the reason...'
            />
            <div className='flex gap-3'>
              <button
                onClick={() => {
                  setShowOtherInput(false)
                  setReasonCode(null)
                }}
                className='bg-secondary hover:bg-secondary/80 text-secondary-foreground border-border flex-1 rounded-xl border py-3 text-sm font-medium transition'
              >
                Back
              </button>
              <button
                onClick={handleOtherReasonSubmit}
                disabled={!reasonOther.trim()}
                className='bg-primary hover:bg-primary/90 text-primary-foreground flex-1 rounded-xl py-3 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <div className='w-full max-w-sm space-y-2'>
            {REASON_OPTIONS.map((reason) => (
              <button
                key={reason}
                onClick={() => handleSelectReason(reason)}
                className='border-border bg-card hover:border-primary/40 hover:bg-accent/50 w-full rounded-xl border px-4 py-3.5 text-left text-sm font-semibold transition active:scale-[0.99]'
              >
                {reason}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Hours / Time ──
  if (step === 'hours') {
    if (isPunchTime) {
      return (
        <div className='flex flex-col items-center gap-5'>
          <StepHeader
            stepNum={stepNum}
            totalSteps={totalSteps}
            label={`Select ${CLOCK_CODE_LABELS[clockCode!] || 'punch'} time`}
            onBack={goBack}
            employee={employee}
          />

          <KioskTimeDial value={requestedTime} onChange={setRequestedTime} />

          <p className='text-foreground text-lg font-bold'>
            {formatTimeValue(requestedTime)}
          </p>

          <button
            onClick={handleHoursSubmit}
            className='bg-primary hover:bg-primary/90 text-primary-foreground w-full max-w-sm rounded-xl py-4 text-base font-semibold shadow-sm transition active:scale-[0.98]'
          >
            Continue
          </button>
        </div>
      )
    }

    const parsedHours = parseFloat(hoursRequested)
    const isValid = !isNaN(parsedHours) && parsedHours > 0 && parsedHours <= 24

    return (
      <div className='flex flex-col items-center gap-6'>
        <StepHeader
          stepNum={stepNum}
          totalSteps={totalSteps}
          label='Number of hours requested'
          onBack={goBack}
          employee={employee}
        />

        <div className='flex w-full max-w-sm items-center gap-3'>
          <button
            type='button'
            onClick={() => {
              const v = Math.max(0.5, (parseFloat(hoursRequested) || 0) - 0.5)
              setHoursRequested(v.toString())
            }}
            className='bg-card border-border hover:bg-accent text-foreground flex h-14 w-14 items-center justify-center rounded-xl border text-2xl font-bold transition'
          >
            &minus;
          </button>
          <div
            className='bg-card border-border text-foreground flex flex-1 items-center justify-center rounded-xl border px-4 py-4 font-mono text-2xl font-bold'
            aria-live='polite'
          >
            {hoursRequested || (
              <span className='text-muted-foreground/40'>0</span>
            )}
          </div>
          <button
            type='button'
            onClick={() => {
              const v = Math.min(24, (parseFloat(hoursRequested) || 0) + 0.5)
              setHoursRequested(v.toString())
            }}
            className='bg-card border-border hover:bg-accent text-foreground flex h-14 w-14 items-center justify-center rounded-xl border text-2xl font-bold transition'
          >
            +
          </button>
        </div>
        <KioskNumericKeypad
          value={hoursRequested}
          onChange={setHoursRequested}
          allowDecimal
          maxLength={5}
        />
        <p className='text-muted-foreground text-xs'>
          Between 0.5 and 24 hours
        </p>

        <button
          onClick={handleHoursSubmit}
          disabled={!isValid}
          className='bg-primary hover:bg-primary/90 text-primary-foreground w-full max-w-sm rounded-xl py-4 text-base font-semibold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'
        >
          Continue
        </button>
      </div>
    )
  }

  // ── Signature ──
  if (step === 'signature') {
    return (
      <div className='flex flex-col items-center gap-6'>
        <StepHeader
          stepNum={stepNum}
          totalSteps={totalSteps}
          label='Signature'
          onBack={goBack}
          employee={employee}
        />

        <div className='border-border w-full max-w-lg overflow-hidden rounded-xl border'>
          <SignatureCanvas
            ref={sigCanvasRef}
            penColor='#1e293b'
            backgroundColor='#ffffff'
            canvasProps={{
              className: 'w-full h-[360px] touch-none',
              style: { width: '100%', height: '360px' },
            }}
          />
        </div>
        <p className='text-muted-foreground text-xs'>
          Sign above using your finger or stylus
        </p>

        <div className='flex w-full max-w-sm gap-3'>
          <button
            onClick={handleClearSignature}
            className='bg-secondary hover:bg-secondary/80 text-secondary-foreground border-border flex-1 rounded-xl border py-3 text-sm font-medium transition'
          >
            Clear
          </button>
          <button
            onClick={handleSignatureContinue}
            className='bg-primary hover:bg-primary/90 text-primary-foreground flex-1 rounded-xl py-3 text-sm font-semibold transition active:scale-[0.98]'
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  // ── Review ──
  if (step === 'review') {
    return (
      <div className='flex flex-col items-center gap-6'>
        <StepHeader
          stepNum={stepNum}
          totalSteps={totalSteps}
          label='Review & Submit'
          onBack={goBack}
          employee={employee}
        />

        <div className='border-border bg-card w-full max-w-sm divide-y rounded-xl border'>
          <ReviewRow
            label='Employee'
            value={`${employee?.full_name} (${employee?.badge_number})`}
          />
          {selectedArea && (
            <ReviewRow
              label='Department'
              value={`${selectedArea.area_name} (${selectedArea.area_code})`}
            />
          )}
          {selectedArea?.primary_supervisor_name && (
            <ReviewRow
              label='Supervisor'
              value={selectedArea.primary_supervisor_name}
            />
          )}
          <ReviewRow
            label='Date'
            value={
              requestDate
                ? format(new Date(requestDate + 'T12:00:00'), 'MMM d, yyyy')
                : ''
            }
          />
          <ReviewRow
            label='Correction'
            value={
              correctionType
                ? correctionType.charAt(0).toUpperCase() +
                  correctionType.slice(1)
                : ''
            }
          />
          <ReviewRow
            label='Clock Code'
            value={clockCode ? CLOCK_CODE_LABELS[clockCode] || clockCode : ''}
          />
          <ReviewRow
            label='Reason'
            value={reasonCode === 'other' ? reasonOther : reasonCode || ''}
          />
          {!skipHours &&
            (isPunchTime ? (
              <ReviewRow label='Time' value={formatTimeValue(requestedTime)} />
            ) : (
              <ReviewRow label='Hours' value={hoursRequested} />
            ))}
          <div className='p-3'>
            <p className='text-muted-foreground mb-1 text-[11px] font-medium uppercase'>
              Signature
            </p>
            {signatureDataUrl && (
              <img
                src={signatureDataUrl}
                alt='Signature'
                className='h-16 rounded border bg-white dark:bg-zinc-900'
              />
            )}
          </div>
        </div>

        <button
          onClick={handleSubmit}
          className='w-full max-w-sm rounded-xl bg-green-600 py-4 text-base font-bold text-white shadow-sm transition hover:bg-green-700 active:scale-[0.98]'
        >
          Submit Request
        </button>

        <button
          onClick={onBack}
          className='text-muted-foreground hover:text-foreground text-sm transition'
        >
          Cancel
        </button>
      </div>
    )
  }

  // ── Submitting ──
  if (step === 'submitting') {
    return (
      <div className='flex flex-col items-center gap-5 py-12'>
        <div className='border-muted border-t-primary h-14 w-14 animate-spin rounded-full border-[3px]' />
        <p className='text-muted-foreground text-lg'>
          Submitting your request...
        </p>
      </div>
    )
  }

  // ── Success ──
  if (step === 'success') {
    return (
      <div className='flex flex-col items-center gap-6 py-8'>
        <div className='flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30'>
          <IconCheck className='h-10 w-10 text-green-600 dark:text-green-400' />
        </div>
        <div className='text-center'>
          <h2 className='text-foreground text-2xl font-bold'>
            Request Submitted!
          </h2>
          <p className='text-muted-foreground mt-2 text-sm'>
            Your time adjustment request has been submitted for supervisor
            review.
          </p>
        </div>
        <button
          onClick={onBack}
          className='bg-primary hover:bg-primary/90 text-primary-foreground w-full max-w-xs rounded-xl py-4 text-base font-semibold shadow-sm transition active:scale-[0.98]'
        >
          Done
        </button>
      </div>
    )
  }

  // ── Error ──
  return (
    <div className='flex flex-col items-center gap-6 py-8'>
      <div className='text-center'>
        <h2 className='text-foreground text-xl font-bold'>
          Something went wrong
        </h2>
        {error && <p className='text-destructive mt-2 text-sm'>{error}</p>}
      </div>
      <button
        onClick={() => setStep('review')}
        className='bg-primary hover:bg-primary/90 text-primary-foreground w-full max-w-xs rounded-xl py-4 text-base font-semibold transition'
      >
        Try Again
      </button>
      <button
        onClick={onBack}
        className='text-muted-foreground hover:text-foreground text-sm transition'
      >
        Cancel
      </button>
    </div>
  )
}

function StepHeader({
  stepNum,
  totalSteps,
  label,
  onBack,
  employee,
}: {
  stepNum: number
  totalSteps: number
  label: string
  onBack: () => void
  employee: EmployeeLookupResult | null
}) {
  return (
    <div className='w-full max-w-sm'>
      <div className='flex items-center gap-3'>
        <button
          onClick={onBack}
          className='text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-sm transition'
        >
          <IconArrowLeft className='h-4 w-4' />
          Back
        </button>
        <div className='flex-1 text-center'>
          <h2 className='text-foreground text-lg font-bold tracking-tight'>
            {label}
          </h2>
          <p className='text-muted-foreground text-xs'>
            Step {stepNum} of {totalSteps}
            {employee && <> &mdash; {employee.full_name}</>}
          </p>
        </div>
        <div className='w-14' />
      </div>
      <div className='bg-muted mt-3 h-1.5 w-full overflow-hidden rounded-full'>
        <div
          className='bg-primary h-full rounded-full transition-all duration-300'
          style={{ width: `${(stepNum / totalSteps) * 100}%` }}
        />
      </div>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between px-4 py-3'>
      <span className='text-muted-foreground text-sm'>{label}</span>
      <span className='text-foreground text-sm font-semibold'>{value}</span>
    </div>
  )
}

// Created and developed by Jai Singh
