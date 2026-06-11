// Created and developed by Jai Singh
/**
 * RF Cycle Count Unified Component
 * Merges both Pull (IN) and Push (OUT) modes into a single workflow
 * Provides 5-step workflow: Confirm → Location → Count → Review → Complete
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Calculator,
  Camera,
  CheckCircle,
  ChevronLeft,
  Clock,
  Loader2,
  MapPin,
  Package,
  Play,
  Users,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
// Hooks and Services
import {
  uploadCycleCountEvidencePhoto,
  uploadCycleCountEvidencePhotos,
} from '@/lib/supabase/cycle-count-photos.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { workServiceClient } from '@/lib/work-service/client'
import type {
  CycleCountPriority,
  CycleCountTask,
} from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'
import { useExtraWorkflowSteps } from '@/hooks/use-extra-workflow-steps'
import {
  useTaskWorkflow,
  hasStepType,
  getStep,
} from '@/hooks/use-task-workflow'
import { useUnifiedCycleCount } from '@/hooks/use-unified-cycle-count'
// Components
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Label } from '@/components/ui/label'
import { QWERTYKeyboard } from '@/components/ui/qwerty-keyboard'
import {
  RFStepBarcodeScan,
  RFStepConditionAssessment,
  RFStepFoundPartTransfer,
  RFStepNotes,
  RFStepPartNumberVerification,
  RFStepPhotoCapture,
  RFStepSerialCapture,
} from '@/components/ui/rf-steps'
import { ScannerInput } from '@/components/ui/scanner-input'
import { Textarea } from '@/components/ui/textarea'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

// ============================================
// Types
// ============================================

export interface RFCycleCountUnifiedProps {
  onBack: () => void
  initialMode?: 'pull' | 'push' | 'auto'
  onTaskChange?: (task: { id: string; location: string } | null) => void
}

type WorkflowStep = 1 | 2 | 3 | 4 | 5

interface FormData {
  countedQuantity: number
  notes: string
  photo: File | null
}

interface LocationState {
  scannedLocation: string
  verified: boolean
  isValidating: boolean
}

interface EmptyLocationState {
  isEmpty: boolean | null
  foundPartNumber: string
  foundQuantity: number
}

// ============================================
// Sub-Components
// ============================================

/**
 * Quantity Keypad - Large touch targets for RF devices
 */
const QuantityKeypad = ({
  value,
  onChange,
  label = 'Counted Quantity',
  unitOfMeasure = 'EA',
}: {
  value: number
  onChange: (value: number) => void
  label?: string
  unitOfMeasure?: string
}) => {
  const handleKeypadClick = (key: string) => {
    if (key === 'clear') {
      onChange(0)
    } else if (key === 'backspace') {
      onChange(Math.floor(value / 10))
    } else {
      const digit = parseInt(key)
      const newValue = value * 10 + digit
      if (newValue <= 99999) {
        onChange(newValue)
      }
    }
  }

  return (
    <div className='space-y-4'>
      <div className='bg-muted/30 border-muted-foreground/30 rounded-lg border-2 border-dashed p-6 text-center'>
        <div className='text-primary mb-2 font-mono text-5xl font-bold'>
          {value}
        </div>
        <div className='text-muted-foreground text-sm'>
          {label} ({unitOfMeasure})
        </div>
      </div>

      <div className='grid grid-cols-3 gap-2'>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <Button
            key={num}
            type='button'
            variant='outline'
            className='hover:bg-primary hover:text-primary-foreground h-14 text-xl font-semibold transition-all active:scale-95'
            onClick={() => handleKeypadClick(num.toString())}
          >
            {num}
          </Button>
        ))}
        <Button
          type='button'
          variant='outline'
          className='hover:bg-destructive hover:text-destructive-foreground h-14 text-sm font-medium'
          onClick={() => handleKeypadClick('clear')}
        >
          Clear
        </Button>
        <Button
          type='button'
          variant='outline'
          className='hover:bg-primary hover:text-primary-foreground h-14 text-xl font-semibold'
          onClick={() => handleKeypadClick('0')}
        >
          0
        </Button>
        <Button
          type='button'
          variant='outline'
          className='hover:bg-secondary hover:text-secondary-foreground h-14 text-lg font-medium'
          onClick={() => handleKeypadClick('backspace')}
        >
          ←
        </Button>
      </div>
    </div>
  )
}

/**
 * Priority Badge with color coding
 */
const PriorityBadge = ({ priority }: { priority: CycleCountPriority }) => {
  const variants: Record<CycleCountPriority, { class: string; label: string }> =
    {
      critical: {
        class: 'bg-red-600 text-white hover:bg-red-700',
        label: 'CRITICAL',
      },
      hot: {
        class: 'bg-orange-500 text-white hover:bg-orange-600',
        label: 'HOT',
      },
      normal: {
        class: 'bg-blue-500 text-white hover:bg-blue-600',
        label: 'NORMAL',
      },
      low: { class: 'bg-gray-500 text-white hover:bg-gray-600', label: 'LOW' },
    }
  const variant = variants[priority] || variants.normal

  return <Badge className={variant.class}>{variant.label}</Badge>
}

/**
 * ExtraStepRenderer — bridges a `WorkflowStepConfig` from the snapshot to
 * the matching reusable `src/components/ui/rf-steps/*` component. The step
 * component manages its own Back / Continue footer; the unified bottom
 * footer is hidden while an extra step is active.
 */
const ExtraStepRenderer = ({
  stepConfig,
  task,
  existingResults,
  onComplete,
  onBack,
  isProcessing,
}: {
  stepConfig: import('@/lib/supabase/workflow-config.service').WorkflowStepConfig
  task: CycleCountTask
  existingResults: Record<string, unknown>
  onComplete: (result: Record<string, unknown>) => void
  onBack: () => void
  isProcessing?: boolean
}) => {
  const taskData = {
    count_number: task.count_number,
    material_number: task.material_number,
    material_description: task.material_description,
    location: task.location,
    warehouse: task.warehouse,
    unit_of_measure: task.unit_of_measure,
    system_quantity: task.system_quantity,
    counted_quantity: task.counted_quantity,
    count_type: task.count_type,
    priority: task.priority,
    // Found Part Transfer columns — forwarded so `RFStepFoundPartTransfer`
    // can render the admin-configured destination without a secondary
    // Supabase query.
    transfer_destination_location: task.transfer_destination_location,
    transfer_source_quantity: task.transfer_source_quantity,
  }
  switch (stepConfig.type) {
    case 'barcode_label_scan':
      return (
        <RFStepBarcodeScan
          step={stepConfig}
          taskData={taskData}
          stepResult={existingResults}
          onComplete={onComplete}
          onBack={onBack}
          isProcessing={isProcessing}
        />
      )
    case 'part_number_verification':
      return (
        <RFStepPartNumberVerification
          step={stepConfig}
          taskData={taskData}
          stepResult={existingResults}
          onComplete={onComplete}
          onBack={onBack}
          isProcessing={isProcessing}
        />
      )
    case 'found_part_transfer':
      return (
        <RFStepFoundPartTransfer
          step={stepConfig}
          taskData={taskData}
          stepResult={existingResults}
          onComplete={onComplete}
          onBack={onBack}
          isProcessing={isProcessing}
        />
      )
    case 'serial_number':
      return (
        <RFStepSerialCapture
          step={stepConfig}
          taskData={taskData}
          stepResult={existingResults}
          onComplete={onComplete}
          onBack={onBack}
          isProcessing={isProcessing}
        />
      )
    case 'condition_assessment':
      return (
        <RFStepConditionAssessment
          step={stepConfig}
          taskData={taskData}
          stepResult={existingResults}
          onComplete={onComplete}
          onBack={onBack}
          isProcessing={isProcessing}
        />
      )
    case 'notes':
      return (
        <RFStepNotes
          step={stepConfig}
          taskData={taskData}
          stepResult={existingResults}
          onComplete={onComplete}
          onBack={onBack}
          isProcessing={isProcessing}
        />
      )
    case 'photo_capture':
      return (
        <RFStepPhotoCapture
          step={stepConfig}
          taskData={taskData}
          stepResult={existingResults}
          onComplete={onComplete}
          onBack={onBack}
          isProcessing={isProcessing}
        />
      )
    default:
      // Unknown/unsupported step type — silently advance so we don't trap
      // the operator. Logs for observability.
      logger.warn('ExtraStepRenderer: unsupported step type', stepConfig.type)
      return null
  }
}

/**
 * Step Progress Indicator
 */
const StepIndicator = ({
  currentStep,
  subStep,
  hasReviewStep,
  hasSupervisorSignoff,
  hasPreSteps,
  hasPostSteps,
}: {
  currentStep: WorkflowStep
  subStep: 'pre_extras' | 'post_extras' | null
  hasReviewStep: boolean
  hasSupervisorSignoff: boolean
  hasPreSteps: boolean
  hasPostSteps: boolean
}) => {
  const steps: { id: number; title: string; icon: typeof Package }[] = [
    { id: 1, title: 'Confirm', icon: Package },
    { id: 2, title: 'Location', icon: MapPin },
  ]
  if (hasPreSteps) {
    steps.push({ id: 25, title: 'Verify', icon: Users })
  }
  steps.push({ id: 3, title: 'Count', icon: Calculator })
  if (hasPostSteps) {
    steps.push({ id: 35, title: 'Capture', icon: Users })
  }
  if (hasReviewStep) {
    steps.push({ id: 4, title: 'Review', icon: AlertTriangle })
  }
  if (hasSupervisorSignoff) {
    steps.push({ id: 5, title: 'Sign-off', icon: Users })
  } else if (!hasReviewStep) {
    steps.push({ id: 4, title: 'Complete', icon: CheckCircle })
  } else {
    steps.push({ id: 5, title: 'Complete', icon: CheckCircle })
  }

  // Synthetic "active id" so the indicator highlights the sub-step while
  // extras render.
  const effectiveActive: number =
    subStep === 'pre_extras' ? 25 : subStep === 'post_extras' ? 35 : currentStep

  return (
    <div className='px-4 py-2'>
      <div className='flex items-center justify-between'>
        {steps.map((step, index) => {
          const StepIcon = step.icon
          const isActive = effectiveActive === step.id
          const isCompleted = effectiveActive > step.id

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
  )
}

/**
 * Connection Status Indicator with retry for unavailable state
 */
const ConnectionIndicator = ({
  isConnected,
  onRetry,
}: {
  isConnected: boolean
  onRetry?: () => void
}) => (
  <div className='flex items-center gap-1 text-xs'>
    {isConnected ? (
      <>
        <Wifi className='h-3 w-3 text-green-500' />
        <span className='text-green-500'>Live</span>
      </>
    ) : (
      <>
        <WifiOff className='text-muted-foreground h-3 w-3' />
        {onRetry ? (
          <button
            onClick={onRetry}
            className='text-primary cursor-pointer underline'
          >
            Reconnect
          </button>
        ) : (
          <span className='text-muted-foreground'>Offline</span>
        )}
      </>
    )}
  </div>
)

// ============================================
// Main Component
// ============================================

export function RFCycleCountUnified({
  onBack,
  initialMode = 'auto',
  onTaskChange,
}: RFCycleCountUnifiedProps) {
  // ============================================
  // Mode Detection (auto resolves based on pushed work)
  // ============================================

  const [mode, setMode] = useState<'pull' | 'push'>(() => {
    if (initialMode === 'auto') return 'pull'
    return initialMode
  })

  // ============================================
  // Hook Integration
  // ============================================

  const {
    currentTask,
    pushedTasks,
    isLoading,
    isInitialized,
    isClaiming,
    isCompleting,
    isStarting,
    isReleasing,
    claimNext,
    startTask,
    completeTask,
    releaseTask,
    skipTask,
    acknowledgeTask,
    setCurrentTask,
    saveDraft,
    loadDraft,
    clearDraft,
    hasDraft,
    isConnected,
    taskDurationMinutes,
    isNearingAbandonment,
  } = useUnifiedCycleCount({
    mode,
    autoClaimOnMount: false,
    enableRealtime: true,
    onTaskReceived: () => {
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200])
      }
    },
    onError: (err) => {
      logger.error('[RFCycleCountUnified] Hook error:', err.message)
    },
  })

  // T-7 (2026-05-18) — Pull-Next landing self-recovery affordance.
  //
  // When the operator opens RF Cycle Count cold (or after sign-out → sign-in)
  // and they DO have a held row (status='pending' AND assigned_to=them,
  // or status='in_progress'), tapping Pull Next today silently routes them
  // back via Phase 0. They have no way to release that held row without
  // first resuming it, and an admin has no signal to release on their
  // behalf without surfacing in Stuck Assignments. This pre-fetch surfaces
  // the held row directly on the landing with Resume / Release affordances.
  //
  // Reads `rr_cyclecount_data` via the supabase client (RLS scopes the
  // result to the caller's org). The query is gated on Pull mode + no
  // currentTask, so it only runs during the cold-open window and stops
  // once Phase 0 routes the operator into the row.
  const { authState: heldRowAuthState } = useUnifiedAuth()
  const heldRowUserId = heldRowAuthState.user?.id
  const queryClient = useQueryClient()
  const heldRowQueryKey = ['rf-cycle-count', 'held-row', heldRowUserId] as const
  const { data: heldRow, isLoading: heldRowLoading } = useQuery({
    queryKey: heldRowQueryKey,
    queryFn: async () => {
      if (!heldRowUserId) return null
      const { data, error } = await supabase
        .from('rr_cyclecount_data')
        .select('id, count_number, location, status, priority')
        .eq('assigned_to', heldRowUserId)
        .in('status', ['pending', 'in_progress', 'recount'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) {
        logger.warn(
          '[RFCycleCountUnified] held-row probe error:',
          error.message
        )
        return null
      }
      return data
    },
    enabled: !!heldRowUserId && mode === 'pull' && !currentTask,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })

  const [releasingHeldRowId, setReleasingHeldRowId] = useState<string | null>(
    null
  )
  const handleReleaseHeldRow = useCallback(
    async (taskId: string, countNumber: string) => {
      try {
        setReleasingHeldRowId(taskId)
        await workServiceClient.releaseTask(taskId)
        toast.success(`Released ${countNumber}`)
        await queryClient.invalidateQueries({ queryKey: heldRowQueryKey })
      } catch (err) {
        logger.error('[RFCycleCountUnified] release held row failed:', err)
        toast.error(
          err instanceof Error
            ? `Release failed: ${err.message}`
            : 'Release failed'
        )
      } finally {
        setReleasingHeldRowId(null)
      }
    },
    [queryClient, heldRowQueryKey]
  )

  // Auto-detect mode: if pushed tasks exist and mode is still undecided, switch to push
  useEffect(() => {
    if (initialMode === 'auto' && pushedTasks.length > 0 && !currentTask) {
      setMode('push')
    }
  }, [initialMode, pushedTasks.length, currentTask])

  // Notify parent shell of active task changes for heartbeat
  useEffect(() => {
    if (onTaskChange) {
      onTaskChange(
        currentTask
          ? { id: currentTask.id, location: currentTask.location }
          : null
      )
    }
  }, [currentTask, onTaskChange])

  // E2E (non-prod): navigate to /rf-interface#e2e_cycle_count_throw then open Cycle Count to hit error boundary
  useEffect(() => {
    if (import.meta.env.PROD) return
    if (typeof window === 'undefined') return
    if (window.location.hash === '#e2e_cycle_count_throw') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      )
      throw new Error('E2E_CYCLE_COUNT_THROW')
    }
  }, [])

  // ============================================
  // Local State
  // ============================================

  const [currentStep, setCurrentStep] = useState<WorkflowStep>(1)
  const [formData, setFormData] = useState<FormData>({
    countedQuantity: 0,
    notes: '',
    photo: null,
  })
  const [locationState, setLocationState] = useState<LocationState>({
    scannedLocation: '',
    verified: false,
    isValidating: false,
  })
  const [emptyLocationState, setEmptyLocationState] =
    useState<EmptyLocationState>({
      isEmpty: null,
      foundPartNumber: '',
      foundQuantity: 0,
    })
  const [requiresReview, setRequiresReview] = useState(false)
  const [varianceInfo, setVarianceInfo] = useState<{
    variance: number
    percentage: number
  } | null>(null)
  const [useKeyboardForNotes, setUseKeyboardForNotes] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [newPushAlert, setNewPushAlert] = useState<CycleCountTask | null>(null)
  const [autoAdvanceCountdown, setAutoAdvanceCountdown] = useState(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false)
  const [supervisorPin, setSupervisorPin] = useState('')
  const [isVerifyingSignoff, setIsVerifyingSignoff] = useState(false)
  // When non-null, the unified footer is hidden and an `rf-steps/*` component
  // renders its own in-content navigation (Back / Continue / Skip). This
  // lets us intercalate configured extra steps between the core 1..5 flow.
  const [subStep, setSubStep] = useState<'pre_extras' | 'post_extras' | null>(
    null
  )

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null)
  const locationInputRef = useRef<HTMLInputElement>(null)

  const handleWsRetry = useCallback(() => {
    workServiceWs.retryAfterUnavailable()
  }, [])

  // ============================================
  // Workflow Snapshot (drives which steps the operator sees)
  // ============================================

  const { workflow } = useTaskWorkflow({ task: currentTask ?? null })
  // Seed the extras hook with any results already stamped on the task
  // row (from a previously-abandoned attempt). Returning operators skip
  // the extras they already completed.
  const initialExtraResults = useMemo(() => {
    const wr = currentTask?.workflow_result
    if (wr && typeof wr === 'object' && !Array.isArray(wr)) {
      return wr as Record<string, unknown>
    }
    return {}
  }, [currentTask?.workflow_result])

  const {
    currentPreStep,
    currentPostStep,
    hasPreSteps,
    hasPostSteps,
    allPreDone,
    allPostDone,
    preCountIndex,
    postCountIndex,
    advancePreStep,
    advancePostStep,
    retreatPreStep,
    retreatPostStep,
    recordResult,
    resetExtraSteps,
  } = useExtraWorkflowSteps(workflow, initialExtraResults)

  const resetWorkflowState = useCallback(() => {
    setCurrentStep(1)
    setFormData({ countedQuantity: 0, notes: '', photo: null })
    setLocationState({
      scannedLocation: '',
      verified: false,
      isValidating: false,
    })
    setEmptyLocationState({
      isEmpty: null,
      foundPartNumber: '',
      foundQuantity: 0,
    })
    setRequiresReview(false)
    setVarianceInfo(null)
    setPhotoPreview(null)
    setUseKeyboardForNotes(false)
    setAutoAdvanceCountdown(0)
    setSupervisorPin('')
    setIsVerifyingSignoff(false)
    setSubStep(null)
    resetExtraSteps()
  }, [resetExtraSteps])

  // ============================================
  // Derived State
  // ============================================

  const isProcessing =
    isClaiming || isCompleting || isStarting || isReleasing || isLoading

  // Step-type detection drives per-count behavior. Historically this was
  // `count_type === 'empty_location_check'` but admins can now configure any
  // workflow to include (or omit) the empty-location verification step.
  const isEmptyLocationCheck =
    hasStepType(workflow, 'empty_location_verification') ||
    currentTask?.count_type === 'empty_location_check'

  const hasReviewStep = hasStepType(workflow, 'review')
  const hasPhotoStep = hasStepType(workflow, 'photo_capture')
  const hasSupervisorSignoff = hasStepType(workflow, 'supervisor_signoff')
  const photoStepConfig = getStep(workflow, 'photo_capture')
  const photoStepRequired = !!photoStepConfig?.required

  const isBlindCount =
    currentTask?.counted_quantity === null ||
    currentTask?.counted_quantity === undefined

  // ============================================
  // Animation Variants
  // ============================================

  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.3 } },
  }

  // ============================================
  // Effects
  // ============================================

  // Watch for new pushed tasks
  useEffect(() => {
    if (mode === 'push' && pushedTasks.length > 0) {
      const latestPush = pushedTasks[pushedTasks.length - 1]
      if (!latestPush.push_acknowledged) {
        setNewPushAlert(latestPush)
      }
    }
  }, [mode, pushedTasks])

  // Auto-advance countdown. The `claimNext()` call is fire-and-forget
  // from inside the interval — historically this surfaced as an
  // `Uncaught (in promise) Error: No tasks available` on quiet shifts.
  // The empty-queue branch no longer throws (see 2026-05-07 noise fix in
  // `workServiceClient.claimNext` + `useUnifiedCycleCount.claimMutation`),
  // but we keep the `.catch` as a defensive guard so any future genuine
  // failure (network, 5xx) is logged at warn instead of escaping as an
  // unhandled rejection. `Promise.resolve(...)` normalises sync mock
  // returns from tests so the chain is always thenable. The hook's
  // `onError` already toasts genuine errors — this catch only prevents
  // the uncaught-rejection escape.
  useEffect(() => {
    if (autoAdvanceCountdown <= 0) return

    const timer = setInterval(() => {
      setAutoAdvanceCountdown((prev) => {
        if (prev <= 1) {
          if (mode === 'pull') {
            Promise.resolve(claimNext()).catch((err) => {
              logger.warn(
                '[RFCycleCountUnified] auto-advance claim failed:',
                err instanceof Error ? err.message : err
              )
            })
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [autoAdvanceCountdown, mode, claimNext])

  // Restore or reset state when task changes
  useEffect(() => {
    if (!currentTask) return

    const draft = hasDraft ? loadDraft() : null
    const isResume =
      draft &&
      draft.taskId === currentTask.id &&
      (draft.step > 1 || !!draft.subStep)

    if (isResume) {
      setCurrentStep(draft.step as WorkflowStep)
      setFormData({
        countedQuantity: draft.countedQuantity ?? 0,
        notes: draft.notes ?? '',
        photo: null,
      })
      setLocationState({
        scannedLocation: draft.scannedLocation ?? '',
        verified: draft.locationVerified ?? false,
        isValidating: false,
      })
      setEmptyLocationState(
        draft.emptyLocationState ?? {
          isEmpty: null,
          foundPartNumber: '',
          foundQuantity: 0,
        }
      )
      // Extras position — the extras hook hydrates its results from the
      // task row's `workflow_result` separately; here we just restore
      // which sub-slot the operator was in, so the correct screen renders
      // right away.
      setSubStep(draft.subStep ?? null)
      toast.info('Resumed in-progress count', {
        description: draft.subStep
          ? `Restored at ${draft.subStep === 'pre_extras' ? 'pre-count check' : 'post-count capture'}`
          : `Restored to step ${draft.step}`,
      })
    } else {
      resetWorkflowState()
    }

    if (isResume) {
      setRequiresReview(false)
      setVarianceInfo(null)
      setPhotoPreview(null)
      setAutoAdvanceCountdown(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run when the task identity changes
  }, [currentTask?.id, hasDraft, loadDraft, resetWorkflowState])

  // Draft auto-save (persists full workflow position, including extras)
  useEffect(() => {
    if (currentTask && (currentStep > 1 || subStep !== null)) {
      saveDraft({
        countedQuantity: formData.countedQuantity,
        notes: formData.notes,
        step: currentStep,
        locationVerified: locationState.verified,
        scannedLocation: locationState.scannedLocation,
        emptyLocationState,
        subStep,
        preCountIndex,
        postCountIndex,
      })
    }
  }, [
    currentTask,
    currentStep,
    subStep,
    preCountIndex,
    postCountIndex,
    formData.countedQuantity,
    formData.notes,
    locationState.verified,
    locationState.scannedLocation,
    emptyLocationState,
    saveDraft,
  ])

  // ============================================
  // Handlers
  // ============================================

  const handleStartTask = useCallback(
    async (task: CycleCountTask) => {
      try {
        await acknowledgeTask(task.id)
        setCurrentTask(task)
        setNewPushAlert(null)
        toast.success(`Starting count: ${task.count_number}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        toast.error(`Failed to start task: ${message}`)
      }
    },
    [acknowledgeTask, setCurrentTask]
  )

  const handleConfirmItem = useCallback(async () => {
    if (!currentTask) return
    try {
      await startTask(currentTask.id)
    } catch {
      // Start may fail transiently — the complete query also accepts
      // pending status, so we still allow the user to proceed.
    }
    setCurrentStep(2)
    toast.success('Task confirmed, scan location')
  }, [currentTask, startTask])

  const validateLocation = useCallback(
    (scanned: string, expected: string): boolean => {
      return scanned.trim().toUpperCase() === expected.trim().toUpperCase()
    },
    []
  )

  const handleLocationScan = useCallback(
    async (scannedLocation?: string) => {
      const liveValue =
        scannedLocation ??
        locationInputRef.current?.value ??
        locationState.scannedLocation
      if (!currentTask || !liveValue.trim()) {
        toast.error('Please scan a location')
        return
      }

      setLocationState((prev) => ({ ...prev, isValidating: true }))

      const isValid = validateLocation(liveValue, currentTask.location)

      if (isValid) {
        setLocationState({
          scannedLocation: liveValue,
          verified: true,
          isValidating: false,
        })
        // Route to pre-count extra steps (barcode_label_scan) if the
        // workflow has any configured; otherwise proceed directly to count.
        if (hasPreSteps && !allPreDone) {
          setSubStep('pre_extras')
        } else {
          setCurrentStep(3)
        }
        toast.success(`Location verified: ${currentTask.location}`)
      } else {
        setLocationState((prev) => ({
          ...prev,
          scannedLocation: liveValue,
          verified: false,
          isValidating: false,
        }))
        toast.error(`Location mismatch! Expected: ${currentTask.location}`)
      }
    },
    [
      currentTask,
      locationState.scannedLocation,
      validateLocation,
      hasPreSteps,
      allPreDone,
    ]
  )

  const calculateVariance = useCallback(
    (counted: number) => {
      if (!currentTask) return null

      const systemQty = currentTask.system_quantity
      const variance = counted - systemQty
      const percentage =
        systemQty > 0
          ? Math.abs((variance / systemQty) * 100)
          : variance !== 0
            ? Infinity
            : 0

      return { variance, percentage }
    },
    [currentTask]
  )

  const handleQuantitySubmit = useCallback(async () => {
    if (!currentTask) return

    // Handle empty location check
    if (isEmptyLocationCheck) {
      if (emptyLocationState.isEmpty === null) {
        toast.error('Please confirm if location is empty')
        return
      }

      // Build notes for empty location check
      let notes = formData.notes
      if (emptyLocationState.isEmpty) {
        notes =
          (notes ? notes + '\n\n' : '') +
          '[Empty Location Verified] ✓ Location confirmed as empty.'
      } else if (
        emptyLocationState.foundPartNumber &&
        emptyLocationState.foundQuantity > 0
      ) {
        notes =
          (notes ? notes + '\n\n' : '') +
          `[Material Found] Part: ${emptyLocationState.foundPartNumber}, Qty: ${emptyLocationState.foundQuantity} EA`
      }

      setFormData((prev) => ({ ...prev, notes }))

      // Complete the task
      await completeTask(
        emptyLocationState.isEmpty ? 0 : emptyLocationState.foundQuantity,
        notes
      )
      handleTaskComplete()
      return
    }

    // Standard count validation
    const variance = calculateVariance(formData.countedQuantity)
    setVarianceInfo(variance)

    // Review thresholds come from the per-row workflow snapshot (stamped at
    // insert by migration 218) — NOT hardcoded. Admins tune these in Count
    // Settings and they ride along with every count.
    const hasVariance =
      !!variance &&
      (Math.abs(variance.percentage) > workflow.reviewThresholdPct ||
        Math.abs(variance.variance) > workflow.reviewThresholdAbs)

    // Review step only fires when:
    //   (a) the workflow actually contains a `review` step, AND
    //   (b) this is a recount (blind first counts skip review), AND
    //   (c) the variance exceeds the configured threshold.
    const needsReview = hasReviewStep && !isBlindCount && hasVariance

    // Post-count extras (serial_number, condition_assessment, notes,
    // photo_capture) must run before review/signoff/complete when
    // configured.
    if (hasPostSteps && !allPostDone) {
      setSubStep('post_extras')
      return
    }

    if (needsReview) {
      setRequiresReview(true)
      setCurrentStep(4)
      return
    }

    if (hasSupervisorSignoff) {
      setCurrentStep(5)
      return
    }

    await completeTask(formData.countedQuantity, formData.notes || undefined)
    handleTaskComplete()
  }, [
    currentTask,
    isEmptyLocationCheck,
    emptyLocationState,
    formData,
    isBlindCount,
    calculateVariance,
    completeTask,
    workflow.reviewThresholdPct,
    workflow.reviewThresholdAbs,
    hasReviewStep,
    hasSupervisorSignoff,
    hasPostSteps,
    allPostDone,
  ])

  // Persists the in-memory photo (if any) to the cycle-count-photos bucket
  // and appends the public URL to the task row's `evidence_photo_urls`.
  // Silent no-op when no photo was captured.
  const persistEvidencePhotoIfAny = useCallback(async () => {
    if (!currentTask || !formData.photo) return
    const result = await uploadCycleCountEvidencePhoto({
      file: formData.photo,
      taskId: currentTask.id,
      organizationId: currentTask.organization_id,
    })
    if (!result.success) {
      // Surface but don't block completion — evidence photos are best effort.
      toast.error(
        `Photo upload failed: ${result.error?.message ?? 'Unknown error'}`
      )
      logger.error('Evidence photo upload failed', result.error)
      return
    }
    toast.success('Variance photo uploaded')
  }, [currentTask, formData.photo])

  const handleReviewComplete = useCallback(async () => {
    if (!currentTask) return

    // When the workflow has a dedicated photo_capture step, photos are
    // captured in the post-count extras pipeline — nothing to enforce here.
    // The legacy inline photo (only rendered when no photo_capture step
    // exists in the workflow) is optional evidence; upload if provided.
    await persistEvidencePhotoIfAny()

    // If a supervisor_signoff step is configured, hold at step 5 until a
    // supervisor acknowledges. We keep the draft in place so the operator
    // can walk over and hand the device to a supervisor.
    if (hasSupervisorSignoff) {
      setCurrentStep(5)
      return
    }

    await completeTask(formData.countedQuantity, formData.notes || undefined)
    handleTaskComplete()
  }, [
    currentTask,
    formData,
    completeTask,
    hasSupervisorSignoff,
    persistEvidencePhotoIfAny,
  ])

  // ===== Extra-step routing =====

  const handlePreExtraComplete = useCallback(
    async (result: Record<string, unknown>) => {
      if (!currentTask || !currentPreStep) return
      const stepType = currentPreStep.stepConfig.type

      // Found Part Transfer — both source (task.location = A) and
      // destination (task.transfer_destination_location = B) are set by
      // the admin when the task is created. The operator physically
      // picks from A, delivers to B, and records the final consolidated
      // count at B. Always short-circuits.
      if (stepType === 'found_part_transfer') {
        const sourceLocation =
          typeof result['sourceLocation'] === 'string'
            ? (result['sourceLocation'] as string)
            : currentTask.location
        const destinationLocation =
          typeof result['destinationLocation'] === 'string'
            ? (result['destinationLocation'] as string)
            : (currentTask.transfer_destination_location ?? '')
        const pickedQty =
          typeof result['pickedQuantity'] === 'number'
            ? (result['pickedQuantity'] as number)
            : 0
        const finalQty =
          typeof result['destinationFinalQuantity'] === 'number'
            ? (result['destinationFinalQuantity'] as number)
            : 0
        const nothingFound = result['nothingFound'] === true

        try {
          await supabase
            .from('rr_cyclecount_data')
            .update({
              transfer_source_quantity: pickedQty,
            })
            .eq('id', currentTask.id)
        } catch (err) {
          logger.error('Failed to persist found_part_transfer result', err)
        }

        recordResult(currentPreStep.stepConfig.id, result, currentTask.id)

        const marker = nothingFound
          ? `[Found Part Transfer] Nothing found at ${sourceLocation}; no parts moved to ${destinationLocation}.`
          : `[Found Part Transfer] Picked ${pickedQty} ${currentTask.unit_of_measure || 'EA'} from ${sourceLocation} → delivered to ${destinationLocation}; final count at destination: ${finalQty}.`
        const mergedNotes = formData.notes
          ? `${formData.notes}\n\n${marker}`
          : marker

        await completeTask(finalQty, mergedNotes)
        handleTaskComplete()
        return
      }

      // Part number verification — always short-circuits the rest of the
      // workflow: match, variance, or empty, the operator has verified
      // the location and the task is done. The step captures its own
      // multi-part list + per-part quantities so `quantity_entry` is not
      // required afterwards.
      if (stepType === 'part_number_verification') {
        const locationEmpty = result['locationEmpty'] === true
        const isMatch = result['match'] === true
        const scanned =
          typeof result['scannedMaterial'] === 'string'
            ? (result['scannedMaterial'] as string)
            : null
        const scannedParts = Array.isArray(result['scannedParts'])
          ? (result['scannedParts'] as Array<{
              part_number: string
              quantity: number
              method: 'scan' | 'manual'
              captured_at: string
            }>)
          : []

        // Total qty of the *expected* part that the operator actually found
        // at the location. For a clean match this equals the system qty
        // (no counted variance). For a variance it's the sum of any
        // matching entries (usually zero — they're all wrong parts).
        const expectedUpper = (currentTask.material_number ?? '').toUpperCase()
        const matchedQty = scannedParts
          .filter((p) => p.part_number.toUpperCase() === expectedUpper)
          .reduce((s, p) => s + (Number(p.quantity) || 0), 0)

        try {
          await supabase
            .from('rr_cyclecount_data')
            .update({
              scanned_material_number: scanned,
              location_reported_empty: locationEmpty,
              scanned_parts: scannedParts as never,
            })
            .eq('id', currentTask.id)
        } catch (err) {
          logger.error('Failed to persist part verification result', err)
        }

        // Record in workflow_result (audit / resume).
        recordResult(currentPreStep.stepConfig.id, result, currentTask.id)

        // Build a concise marker for the completion notes so anyone
        // reading the count row sees the operator's intent.
        let marker = ''
        if (locationEmpty) {
          marker =
            '[Location Reported Empty] No barcode found during part verification.'
        } else if (isMatch) {
          marker = `[Part Verified] ${scanned} confirmed at location.`
        } else if (scannedParts.length > 0) {
          const summary = scannedParts
            .map((p) => `${p.part_number} × ${p.quantity}`)
            .join(', ')
          marker = `[Part Variance] Expected ${currentTask.material_number} — found: ${summary}`
        }
        const mergedNotes = formData.notes
          ? `${formData.notes}\n\n${marker}`
          : marker

        // Complete the task. counted_quantity rules:
        //   - empty  → 0
        //   - match  → system_quantity (the operator verified it's there)
        //   - variance → matchedQty (could be 0 if only wrong parts found)
        const countedQty = locationEmpty
          ? 0
          : isMatch
            ? currentTask.system_quantity
            : matchedQty
        await completeTask(countedQty, mergedNotes)
        handleTaskComplete()
        return
      }

      recordResult(currentPreStep.stepConfig.id, result, currentTask.id)
      // If the step produced notes, merge into formData so they flow through
      // to the final complete call.
      const stepNotes = result['notes']
      if (typeof stepNotes === 'string' && stepNotes.trim()) {
        setFormData((prev) => ({
          ...prev,
          notes: prev.notes
            ? `${prev.notes}\n\n${stepNotes.trim()}`
            : stepNotes.trim(),
        }))
      }
      advancePreStep()
    },
    [
      currentTask,
      currentPreStep,
      formData.notes,
      recordResult,
      advancePreStep,
      completeTask,
    ]
  )

  // Exit pre-extras sub-state once the queue is drained.
  useEffect(() => {
    if (subStep === 'pre_extras' && !currentPreStep) {
      setSubStep(null)
      setCurrentStep(3)
    }
  }, [subStep, currentPreStep])

  const handlePreExtraBack = useCallback(() => {
    // If we're on the first pre-step, go back to location; otherwise
    // retreat one pre-step.
    if (currentPreStep && currentPreStep.stepConfig.order > 0) {
      retreatPreStep()
    }
    setSubStep(null)
    setCurrentStep(2)
  }, [currentPreStep, retreatPreStep])

  const handlePostExtraComplete = useCallback(
    async (result: Record<string, unknown>) => {
      if (!currentTask || !currentPostStep) return
      const stepType = currentPostStep.stepConfig.type

      // Photo capture step: upload files immediately, then persist the
      // resulting public URLs (not File objects) into workflow_result.
      if (stepType === 'photo_capture') {
        const files = Array.isArray(result['photos'])
          ? (result['photos'] as File[])
          : []
        let photoUrls: string[] = []
        if (files.length > 0) {
          const upload = await uploadCycleCountEvidencePhotos({
            files,
            taskId: currentTask.id,
            organizationId: currentTask.organization_id,
          })
          photoUrls = upload.uploaded
            .map((u) => u.publicUrl)
            .filter((u): u is string => !!u)
          if (upload.failed.length > 0) {
            toast.error(
              `${upload.failed.length} of ${files.length} photos failed to upload`
            )
            logger.error(
              'Batch photo upload had failures',
              upload.failed.map((f) => f.error)
            )
          } else if (upload.uploaded.length > 0) {
            toast.success(
              `${upload.uploaded.length} photo${upload.uploaded.length !== 1 ? 's' : ''} uploaded`
            )
          }
        }
        recordResult(
          currentPostStep.stepConfig.id,
          { photoUrls, capturedAt: new Date().toISOString() },
          currentTask.id
        )
        advancePostStep()
        return
      }

      // Serial number step: also mirror captured serials to the existing
      // `rr_cyclecount_data.serial_numbers` column for easy querying.
      if (stepType === 'serial_number') {
        const serials = Array.isArray(result['serialNumbers'])
          ? (result['serialNumbers'] as string[])
          : []
        if (serials.length > 0) {
          try {
            await supabase
              .from('rr_cyclecount_data')
              .update({ serial_numbers: serials })
              .eq('id', currentTask.id)
          } catch (err) {
            logger.error('Failed to mirror serial_numbers column', err)
          }
        }
      }

      recordResult(currentPostStep.stepConfig.id, result, currentTask.id)
      const stepNotes = result['notes']
      if (typeof stepNotes === 'string' && stepNotes.trim()) {
        setFormData((prev) => ({
          ...prev,
          notes: prev.notes
            ? `${prev.notes}\n\n${stepNotes.trim()}`
            : stepNotes.trim(),
        }))
      }
      advancePostStep()
    },
    [currentTask, currentPostStep, recordResult, advancePostStep]
  )

  // Exit post-extras sub-state once the queue is drained; route to review,
  // signoff, or complete as the workflow dictates.
  useEffect(() => {
    if (subStep !== 'post_extras' || currentPostStep) return
    // Recompute the "after quantity" landing step now that extras are done.
    const hasVariance =
      !!varianceInfo &&
      (Math.abs(varianceInfo.percentage) > workflow.reviewThresholdPct ||
        Math.abs(varianceInfo.variance) > workflow.reviewThresholdAbs)
    const needsReview = hasReviewStep && !isBlindCount && hasVariance
    setSubStep(null)
    if (needsReview) {
      setRequiresReview(true)
      setCurrentStep(4)
    } else if (hasSupervisorSignoff) {
      setCurrentStep(5)
    } else {
      void (async () => {
        await completeTask(
          formData.countedQuantity,
          formData.notes || undefined
        )
        handleTaskComplete()
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on sub-state transition
  }, [subStep, currentPostStep])

  const handlePostExtraBack = useCallback(() => {
    if (currentPostStep && currentPostStep.stepConfig.order > 0) {
      retreatPostStep()
    }
    setSubStep(null)
    setCurrentStep(3)
  }, [currentPostStep, retreatPostStep])

  const handleSupervisorSignoff = useCallback(async () => {
    if (!currentTask) return
    if (!supervisorPin.trim()) {
      toast.error('Enter supervisor PIN to continue')
      return
    }
    setIsVerifyingSignoff(true)
    try {
      // Phase 7.1 — server-enforced supervisor PIN verification + atomic
      // completion. The SECURITY DEFINER RPC
      // `complete_task_with_supervisor_pin` (migration 259) verifies the PIN
      // (role + same-org + bcrypt hash + rate-limit) AND flips the task to
      // `completed` AND writes the `pin_verified` + `completed` work_events
      // in one transaction. This closes the bypass window where a client
      // could call the legacy `verify_supervisor_pin` and then skip the
      // completion. We never log or persist the raw PIN.
      //
      // Falls back to the split flow only when the work_tasks projection
      // is not yet populated for this row (per-org `work_tasks_shadow_write`
      // off). The legacy verify + completeTask path then runs.
      const supervisorUserId = currentTask.assigned_to ?? currentTask.pushed_by
      if (!supervisorUserId) {
        toast.error('No supervisor associated with this task')
        return
      }

      // Cast through `any` until database.types.ts is regenerated post 259.
      const sbRpc = supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ data: unknown; error: unknown }>
      }

      const resultPayload = {
        counted_quantity: formData.countedQuantity,
        notes: formData.notes ?? null,
      }
      const { data: atomicResult, error: atomicError } = await sbRpc.rpc(
        'complete_task_with_supervisor_pin',
        {
          p_task_id: currentTask.id,
          p_supervisor_user_id: supervisorUserId,
          p_pin: supervisorPin,
          p_result_payload: resultPayload,
          p_notes: formData.notes ?? null,
        }
      )

      // Distinguish "task not in work_tasks yet" (shadow_write off) from
      // "PIN rejected" so we don't toast "rejected" when the real reason is
      // missing projection.
      const taskNotFound =
        !!atomicError &&
        typeof (atomicError as { message?: unknown }).message === 'string' &&
        /task not found/i.test(
          (atomicError as { message: string }).message ?? ''
        )

      if (atomicError && !taskNotFound) {
        toast.error('Supervisor PIN rejected')
        logger.error('complete_task_with_supervisor_pin failed:', atomicError)
        return
      }

      if (!atomicError) {
        const success =
          !!atomicResult &&
          typeof atomicResult === 'object' &&
          (atomicResult as { success?: unknown }).success === true
        if (!success) {
          toast.error('Supervisor PIN rejected')
          return
        }
        // Persist the legacy completion so the rr_cyclecount_data row picks
        // up counted_quantity, completed_at, notes — the projection trigger
        // already cascades work_tasks → rr_cyclecount_data when shadow_write
        // is on, but `complete_task_with_supervisor_pin` writes only
        // status/result_payload, not the legacy-specific count fields.
        await completeTask(
          formData.countedQuantity,
          formData.notes ?? undefined
        )
        handleTaskComplete()
        return
      }

      // Fallback: work_tasks row not yet present (shadow_write off). Use the
      // pre-Phase-7.1 split flow. Server-side PIN verification is still
      // enforced by `verify_supervisor_pin` (SECURITY DEFINER, same-org,
      // bcrypt, rate-limited).
      const { data: ok, error: verifyErr } = await sbRpc.rpc(
        'verify_supervisor_pin',
        { p_user_id: supervisorUserId, p_pin: supervisorPin }
      )
      if (verifyErr || ok !== true) {
        toast.error('Supervisor PIN rejected')
        return
      }
      await completeTask(formData.countedQuantity, formData.notes ?? undefined)
      handleTaskComplete()
    } finally {
      setIsVerifyingSignoff(false)
      setSupervisorPin('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleTaskComplete is declared below; closure captures it correctly at call time.
  }, [currentTask, supervisorPin, formData, completeTask])

  const handleTaskComplete = useCallback(() => {
    clearDraft()

    if (isEmptyLocationCheck) {
      if (emptyLocationState.isEmpty) {
        toast.success('✓ Empty location confirmed!')
      } else {
        toast.success(
          `Material found: ${emptyLocationState.foundPartNumber} (${emptyLocationState.foundQuantity} EA)`
        )
      }
    } else if (isBlindCount) {
      toast.success('Count completed successfully!')
    } else if (varianceInfo) {
      const varianceText =
        varianceInfo.variance > 0
          ? `+${varianceInfo.variance}`
          : `${varianceInfo.variance}`
      if (varianceInfo.variance !== 0) {
        toast.success(`Recount completed with variance: ${varianceText} units`)
      } else {
        toast.success('Recount completed - Perfect match!')
      }
    }

    setCompletedCount((prev) => prev + 1)
    resetWorkflowState()

    // Auto-advance to next task in pull mode
    if (mode === 'pull') {
      setCurrentTask(null)
      setAutoAdvanceCountdown(3)
    } else {
      setCurrentTask(null)
    }
  }, [
    clearDraft,
    isEmptyLocationCheck,
    emptyLocationState,
    isBlindCount,
    varianceInfo,
    mode,
    resetWorkflowState,
    setCurrentTask,
  ])

  const handleReleaseConfirmed = useCallback(async () => {
    setShowReleaseConfirm(false)
    // releaseTask() (in useUnifiedCycleCount) toasts on success and clears
    // the draft via its onSuccess handler. We also call clearDraft() here
    // for redundancy because the hook can be mocked or its draft state can
    // diverge from the component's local clearDraft. No additional toast.
    await releaseTask()
    clearDraft()
  }, [releaseTask, clearDraft])

  const handleReleaseTask = useCallback(() => {
    setShowReleaseConfirm(true)
  }, [])

  const [showSkipConfirm, setShowSkipConfirm] = useState(false)

  const handleSkipTask = useCallback(() => {
    setShowSkipConfirm(true)
  }, [])

  const handleSkipConfirmed = useCallback(
    async (reason?: string) => {
      setShowSkipConfirm(false)
      await skipTask(reason)
      clearDraft()
    },
    [skipTask, clearDraft]
  )

  const handleBack = useCallback(() => {
    if (currentStep > 1 && currentTask) {
      setCurrentStep((prev) => (prev - 1) as WorkflowStep)
    } else if (currentTask && mode === 'push') {
      // In push mode, go back to list
      setCurrentTask(null)
    } else {
      onBack()
    }
  }, [currentStep, currentTask, mode, setCurrentTask, onBack])

  const handleFieldChange = useCallback(
    (field: keyof FormData, value: number | string | File | null) => {
      setFormData((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const handlePhotoCapture = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file')
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image must be less than 5MB')
        return
      }

      handleFieldChange('photo', file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
      toast.success('Photo captured')
    },
    [handleFieldChange]
  )

  // ============================================
  // Render: Push Mode - Task List
  // ============================================

  if (mode === 'push' && !currentTask) {
    return (
      <div className='bg-background flex h-full flex-col'>
        {/* Header */}
        <div className='border-b p-4'>
          <RFScreenHeader
            title='Cycle Count'
            subtitle='Count tasks'
            onBack={onBack}
            right={
              <div className='flex items-center gap-2'>
                <ConnectionIndicator
                  isConnected={isConnected}
                  onRetry={!isConnected ? handleWsRetry : undefined}
                />
                <Badge
                  variant={pushedTasks.length > 0 ? 'destructive' : 'secondary'}
                  className='min-w-8 justify-center'
                >
                  {pushedTasks.length}
                </Badge>
              </div>
            }
          />
        </div>

        {/* New Push Alert Banner */}
        {newPushAlert && (
          <div className='px-4 pt-4'>
            <Alert variant='destructive' className='animate-pulse border-2'>
              <Bell className='h-4 w-4' />
              <AlertTitle className='font-semibold'>
                New Work Pushed!
              </AlertTitle>
              <AlertDescription className='mt-2 flex items-center justify-between'>
                <span className='text-sm'>
                  {newPushAlert.material_number} at {newPushAlert.location}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  className='bg-background text-foreground hover:bg-accent ml-2'
                  onClick={() => handleStartTask(newPushAlert)}
                >
                  Start Now
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Task List */}
        <div className='flex-1 space-y-3 overflow-auto p-4'>
          {isLoading ? (
            <div className='text-muted-foreground py-8 text-center'>
              <Loader2 className='mx-auto mb-2 h-8 w-8 animate-spin' />
              Loading...
            </div>
          ) : pushedTasks.length === 0 ? (
            <div className='text-muted-foreground py-12 text-center'>
              <Package className='mx-auto mb-4 h-16 w-16 opacity-50' />
              <p className='font-medium'>No pushed work available</p>
              <p className='mt-2 text-sm'>
                Work will appear here when pushed by supervisor
              </p>
            </div>
          ) : (
            pushedTasks.map((task) => (
              <Card
                key={task.id}
                className={cn(
                  'hover:bg-accent cursor-pointer transition-all active:scale-[0.98]',
                  task.priority === 'critical' &&
                    'border-2 border-red-500 shadow-md shadow-red-500/20'
                )}
                onClick={() => handleStartTask(task)}
              >
                <CardContent className='p-4'>
                  <div className='flex items-start justify-between'>
                    <div className='flex-1 space-y-2'>
                      <div className='flex items-center gap-2'>
                        <PriorityBadge priority={task.priority} />
                        {task.priority === 'critical' && (
                          <AlertTriangle className='h-4 w-4 text-red-500' />
                        )}
                      </div>
                      <p className='font-mono text-lg font-semibold'>
                        {task.count_number}
                      </p>
                      <p className='font-medium'>{task.material_number}</p>
                      <p className='text-muted-foreground flex items-center gap-1 text-sm'>
                        <MapPin className='h-3 w-3' />
                        {task.location}
                      </p>
                    </div>
                    <Button
                      size='default'
                      disabled={isProcessing}
                      className='h-12 px-4'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleStartTask(task)
                      }}
                    >
                      <Play className='mr-2 h-4 w-4' />
                      Start
                    </Button>
                  </div>
                  <p className='text-muted-foreground mt-3 border-t pt-2 text-xs'>
                    Pushed{' '}
                    {task.pushed_at
                      ? formatDistanceToNow(new Date(task.pushed_at), {
                          addSuffix: true,
                        })
                      : 'recently'}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    )
  }

  // ============================================
  // Render: Loading State
  // ============================================

  if (isClaiming && !currentTask) {
    return (
      <div className='flex min-h-[400px] flex-col items-center justify-center p-8'>
        <div className='space-y-4 text-center'>
          <div className='relative'>
            <Loader2 className='text-primary mx-auto h-12 w-12 animate-spin' />
            <Clock className='text-muted-foreground absolute -right-2 -bottom-2 h-6 w-6' />
          </div>
          <h3 className='text-lg font-semibold'>Claiming Next Count</h3>
          <p className='text-muted-foreground'>
            Finding your next cycle count to perform...
          </p>
        </div>
      </div>
    )
  }

  // ============================================
  // Render: Loading / Initializing
  // ============================================

  if (!isInitialized) {
    return (
      <div className='flex min-h-[400px] flex-col items-center justify-center p-8'>
        <Loader2 className='text-primary h-12 w-12 animate-spin' />
        <p className='text-muted-foreground mt-4 text-sm'>
          Checking for assigned counts...
        </p>
      </div>
    )
  }

  // ============================================
  // Render: Between Counts (auto-advancing) or Claiming
  // ============================================

  if (
    !currentTask &&
    mode === 'pull' &&
    (autoAdvanceCountdown > 0 || isClaiming)
  ) {
    return (
      <div className='flex min-h-[400px] flex-col items-center justify-center p-8'>
        <div className='space-y-5 text-center'>
          <div className='relative mx-auto flex h-20 w-20 items-center justify-center'>
            <div className='absolute inset-0 animate-ping rounded-full bg-green-400/30' />
            <div className='relative flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40'>
              <CheckCircle className='h-9 w-9 text-green-600 dark:text-green-400' />
            </div>
          </div>

          <div>
            <h3 className='text-lg font-semibold text-green-700 dark:text-green-300'>
              Count Completed!
            </h3>
            {completedCount > 0 && (
              <p className='text-muted-foreground mt-1 text-xs'>
                {completedCount} count{completedCount !== 1 ? 's' : ''}{' '}
                completed this session
              </p>
            )}
          </div>

          <div className='flex flex-col items-center gap-3'>
            <Loader2 className='text-primary h-5 w-5 animate-spin' />
            <p className='text-muted-foreground text-sm'>
              {autoAdvanceCountdown > 0
                ? `Next count in ${autoAdvanceCountdown}s...`
                : 'Loading next count...'}
            </p>
            {autoAdvanceCountdown > 0 && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => setAutoAdvanceCountdown(0)}
              >
                Pause
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ============================================
  // Render: Pull Mode Landing / No Tasks Available
  // ============================================

  if (!currentTask && mode === 'pull') {
    return (
      <div className='flex min-h-[400px] flex-col items-center justify-center p-8'>
        <div className='space-y-6 text-center'>
          {completedCount > 0 ? (
            <div className='mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40'>
              <CheckCircle className='h-10 w-10 text-green-600 dark:text-green-400' />
            </div>
          ) : (
            <div className='mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40'>
              <Package className='h-10 w-10 text-blue-600 dark:text-blue-400' />
            </div>
          )}

          <div>
            <h3 className='text-xl font-bold'>
              {completedCount > 0 ? 'Ready for Next Count' : 'Cycle Count'}
            </h3>
            <p className='text-muted-foreground mt-2 text-sm'>
              {completedCount > 0
                ? `${completedCount} count${completedCount !== 1 ? 's' : ''} completed this session`
                : 'Tap below when you are ready to start counting'}
            </p>
          </div>

          {/*
           * T-7 (2026-05-18) — held-row self-recovery affordance.
           * Renders only when the pre-fetch found a row this operator
           * already holds. Resume → Phase 0 routes the operator back
           * to the row; Release → workServiceClient.releaseTask hands
           * it back to the queue. Both close the operator-side gap
           * documented in
           * `Decisions/ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18.md`
           * F38.
           */}
          {!heldRowLoading && heldRow && (
            <Alert className='border-orange-300 bg-orange-50 text-left dark:bg-orange-950/30'>
              <AlertTriangle className='h-4 w-4 text-orange-600' />
              <AlertTitle className='text-orange-900 dark:text-orange-200'>
                You have a count in progress
              </AlertTitle>
              <AlertDescription className='text-orange-800 dark:text-orange-200/90'>
                <div className='mt-1 text-sm'>
                  <strong>{heldRow.count_number}</strong> at{' '}
                  <strong>{heldRow.location}</strong>
                </div>
                <div className='mt-3 flex gap-2'>
                  <Button
                    size='sm'
                    onClick={() => {
                      Promise.resolve(claimNext()).catch((err) => {
                        logger.warn(
                          '[RFCycleCountUnified] resume held row failed:',
                          err instanceof Error ? err.message : err
                        )
                      })
                    }}
                    disabled={isClaiming}
                  >
                    {isClaiming ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : (
                      <Play className='mr-2 h-4 w-4' />
                    )}
                    Resume
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() =>
                      handleReleaseHeldRow(heldRow.id, heldRow.count_number)
                    }
                    disabled={releasingHeldRowId === heldRow.id}
                    className='border-orange-300 text-orange-700 hover:bg-orange-100'
                  >
                    {releasingHeldRowId === heldRow.id ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : null}
                    Release
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className='flex flex-col gap-2'>
            <Button
              onClick={() => {
                // Wrap in Promise.resolve so test mocks that return
                // undefined still produce a thenable chain. See the
                // identical guard on the auto-advance interval above.
                Promise.resolve(claimNext()).catch((err) => {
                  logger.warn(
                    '[RFCycleCountUnified] manual claim failed:',
                    err instanceof Error ? err.message : err
                  )
                })
              }}
              disabled={isClaiming}
              className='w-full'
              size='lg'
            >
              {isClaiming ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : (
                <Play className='mr-2 h-4 w-4' />
              )}
              Pull Next Count
            </Button>
            <Button onClick={onBack} variant='ghost' className='w-full'>
              <ChevronLeft className='mr-2 h-4 w-4' />
              Return to RF Menu
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ============================================
  // Render: Main Workflow
  // ============================================

  return (
    <>
      <div className='mx-auto flex h-full max-w-md flex-col'>
        {/* Header */}
        <div className='bg-card flex items-center justify-between border-b p-4'>
          <div className='flex items-center space-x-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={handleBack}
              disabled={isProcessing}
            >
              <ChevronLeft className='h-4 w-4' />
            </Button>
            <div>
              <h1 className='text-lg font-semibold'>Cycle Count</h1>
              <p className='text-muted-foreground text-xs'>
                {currentTask?.count_number || 'Loading...'}
              </p>
            </div>
          </div>
          <div className='flex items-center space-x-2'>
            <ConnectionIndicator
              isConnected={isConnected}
              onRetry={!isConnected ? handleWsRetry : undefined}
            />
            {currentTask && (
              <>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={handleSkipTask}
                  disabled={isProcessing}
                  className='text-blue-600 hover:text-blue-700'
                >
                  Skip
                </Button>
                {/*
                 * T-7 (2026-05-18) — promote the Release chip from a
                 * subtle ghost link to a visible outlined button so
                 * operators on the Confirm review surface have a
                 * discoverable self-recovery path. See
                 * `Decisions/ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18.md`
                 * F38 (reframed).
                 */}
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handleReleaseTask}
                  disabled={isProcessing}
                  className='border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800 dark:border-orange-700/60 dark:text-orange-300 dark:hover:bg-orange-950/40'
                >
                  {isReleasing ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    'Release'
                  )}
                </Button>
              </>
            )}
            <Users className='text-muted-foreground h-5 w-5' />
          </div>
        </div>

        {/* Abandonment Warning */}
        {isNearingAbandonment && (
          <div className='p-4 pb-0'>
            <Alert
              variant='destructive'
              className='border-orange-200 bg-orange-50'
            >
              <AlertTriangle className='h-4 w-4 text-orange-600' />
              <AlertTitle className='text-orange-800'>
                Task Running Long
              </AlertTitle>
              <AlertDescription className='text-orange-700'>
                You've been working on this count for {taskDurationMinutes}{' '}
                minutes. It may be released soon if not completed.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Step Indicator — driven by the workflow snapshot so admins'
            configured step sequence is reflected visually. */}
        {currentTask && (
          <StepIndicator
            currentStep={currentStep}
            subStep={subStep}
            hasReviewStep={hasReviewStep}
            hasSupervisorSignoff={hasSupervisorSignoff}
            hasPreSteps={hasPreSteps}
            hasPostSteps={hasPostSteps}
          />
        )}

        {/* Main Content */}
        <div className='flex-1 overflow-y-auto p-4'>
          <AnimatePresence mode='wait'>
            <motion.div
              key={currentStep}
              variants={contentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              className='space-y-4'
            >
              {/* Step 1: Confirm */}
              {subStep === null && currentStep === 1 && currentTask && (
                <div className='space-y-4'>
                  <div className='mb-6 space-y-2 text-center'>
                    <Package className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>
                      Confirm Item Details
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Verify the assigned count information before starting
                    </p>
                  </div>

                  <Card>
                    <CardContent className='p-4'>
                      <h4 className='mb-3 flex items-center font-semibold'>
                        <Package className='mr-2 h-4 w-4' />
                        Assigned Count Information
                      </h4>
                      <div className='grid grid-cols-2 gap-3 text-sm'>
                        <div>
                          <span className='text-muted-foreground'>
                            Count Number:
                          </span>
                          <div className='font-mono font-medium'>
                            {currentTask.count_number}
                          </div>
                        </div>
                        <div>
                          <span className='text-muted-foreground'>
                            Material:
                          </span>
                          <div className='font-medium'>
                            {currentTask.material_number}
                          </div>
                        </div>
                        <div className='col-span-2'>
                          <span className='text-muted-foreground'>
                            Description:
                          </span>
                          <div className='font-medium'>
                            {currentTask.material_description || 'N/A'}
                          </div>
                        </div>
                        <div>
                          <span className='text-muted-foreground'>
                            Location:
                          </span>
                          <div className='font-mono font-medium'>
                            {currentTask.location}
                          </div>
                        </div>
                        <div>
                          <span className='text-muted-foreground'>Unit:</span>
                          <div className='text-primary font-medium'>
                            {currentTask.unit_of_measure || 'EA'}
                          </div>
                        </div>
                        {!isBlindCount && (
                          <div className='col-span-2 border-t pt-2'>
                            <span className='text-muted-foreground'>
                              System Quantity:
                            </span>
                            <div className='text-primary text-lg font-bold'>
                              {currentTask.system_quantity.toLocaleString()}{' '}
                              {currentTask.unit_of_measure || 'EA'}
                            </div>
                            <p className='text-muted-foreground mt-1 text-xs'>
                              Previous count:{' '}
                              {currentTask.counted_quantity?.toLocaleString()}
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <div className='text-center'>
                    <PriorityBadge priority={currentTask.priority} />
                  </div>
                </div>
              )}

              {/* Step 2: Location Scan */}
              {subStep === null && currentStep === 2 && currentTask && (
                <div className='space-y-4'>
                  <div className='mb-6 space-y-2 text-center'>
                    <MapPin className='text-primary mx-auto h-12 w-12' />
                    <h3 className='text-lg font-semibold'>Scan Location</h3>
                    <p className='text-muted-foreground text-sm'>
                      Scan the location barcode to confirm you're at the correct
                      spot
                    </p>
                  </div>

                  <Card className='mb-4'>
                    <CardContent className='p-4'>
                      <div className='text-center'>
                        <p className='text-muted-foreground mb-1 text-sm'>
                          Expected Location
                        </p>
                        <p className='text-primary font-mono text-xl font-bold'>
                          {currentTask.location}
                        </p>
                        <p className='text-muted-foreground mt-1 text-xs'>
                          Material: {currentTask.material_number}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>
                      Scan Location Barcode
                    </Label>
                    <ScannerInput
                      type='text'
                      placeholder='Scan location barcode'
                      value={locationState.scannedLocation}
                      ref={locationInputRef}
                      onChange={(e) =>
                        setLocationState((prev) => ({
                          ...prev,
                          scannedLocation: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleLocationScan()
                        }
                      }}
                      disabled={locationState.isValidating}
                      className='text-center font-mono text-lg font-semibold'
                      autoFocus
                    />
                  </div>

                  {locationState.scannedLocation && !locationState.verified && (
                    <Card className='border-dashed border-orange-500'>
                      <CardContent className='p-3'>
                        <div className='flex items-center justify-center text-sm'>
                          <div className='flex items-center space-x-2 text-orange-600'>
                            <AlertCircle className='h-4 w-4' />
                            <span className='font-medium'>
                              Scanned: {locationState.scannedLocation}
                            </span>
                          </div>
                        </div>
                        <p className='text-muted-foreground mt-1 text-center text-xs'>
                          Press Enter to verify location
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {locationState.verified && (
                    <Card className='border-dashed border-green-500'>
                      <CardContent className='p-3'>
                        <div className='flex items-center justify-center text-sm'>
                          <div className='flex items-center space-x-2 text-green-600'>
                            <CheckCircle className='h-4 w-4' />
                            <span className='font-medium'>
                              Location Verified: {locationState.scannedLocation}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Pre-count extras (barcode_label_scan) — sandwich between
                  step 2 (Location) and step 3 (Count). The step component
                  provides its own Back / Continue footer; the unified
                  footer hides while `subStep === 'pre_extras'`. */}
              {subStep === 'pre_extras' && currentPreStep && currentTask && (
                <div className='space-y-4'>
                  <ExtraStepRenderer
                    stepConfig={currentPreStep.stepConfig}
                    task={currentTask}
                    existingResults={{}}
                    onComplete={handlePreExtraComplete}
                    onBack={handlePreExtraBack}
                    isProcessing={isProcessing}
                  />
                </div>
              )}

              {/* Step 3: Count */}
              {subStep === null && currentStep === 3 && currentTask && (
                <div className='space-y-4'>
                  {/* Empty Location Check Workflow */}
                  {isEmptyLocationCheck ? (
                    <>
                      <div className='mb-6 space-y-2 text-center'>
                        <Package className='text-primary mx-auto h-12 w-12' />
                        <h3 className='text-lg font-semibold'>
                          Empty Location Verification
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          Verify if this location is actually empty
                        </p>
                      </div>

                      <Card className='mb-4'>
                        <CardContent className='p-4'>
                          <div className='text-center'>
                            <p className='text-muted-foreground mb-1 text-sm'>
                              Expected Condition
                            </p>
                            <p className='text-primary text-lg font-bold'>
                              {currentTask.material_number}
                            </p>
                            <p className='text-muted-foreground mt-1 text-xs'>
                              Location: {currentTask.location} ✓
                            </p>
                            <p className='mt-2 text-xs font-medium text-orange-600'>
                              📦 Should be EMPTY
                            </p>
                          </div>
                        </CardContent>
                      </Card>

                      {emptyLocationState.isEmpty === null && (
                        <Card className='border-primary border-2'>
                          <CardContent className='p-4'>
                            <p className='mb-4 text-center font-medium'>
                              Is this location empty?
                            </p>
                            <div className='grid grid-cols-2 gap-3'>
                              <Button
                                size='lg'
                                variant='default'
                                className='h-16'
                                onClick={() =>
                                  setEmptyLocationState((prev) => ({
                                    ...prev,
                                    isEmpty: true,
                                  }))
                                }
                              >
                                <CheckCircle className='mr-2 h-5 w-5' />
                                Yes, Empty
                              </Button>
                              <Button
                                size='lg'
                                variant='outline'
                                className='h-16'
                                onClick={() =>
                                  setEmptyLocationState((prev) => ({
                                    ...prev,
                                    isEmpty: false,
                                  }))
                                }
                              >
                                <XCircle className='mr-2 h-5 w-5' />
                                No, Has Material
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {emptyLocationState.isEmpty === true && (
                        <Card className='border-2 border-green-500'>
                          <CardContent className='p-4'>
                            <div className='flex items-center justify-center text-green-600'>
                              <CheckCircle className='mr-2 h-5 w-5' />
                              <span className='font-semibold'>
                                Location Confirmed Empty ✓
                              </span>
                            </div>
                            <p className='text-muted-foreground mt-2 text-center text-xs'>
                              Press Submit to complete this empty location check
                            </p>
                          </CardContent>
                        </Card>
                      )}

                      {emptyLocationState.isEmpty === false && (
                        <div className='space-y-4'>
                          <Card className='border-2 border-orange-500'>
                            <CardContent className='p-4'>
                              <div className='mb-4 flex items-center justify-center text-orange-600'>
                                <AlertTriangle className='mr-2 h-5 w-5' />
                                <span className='font-semibold'>
                                  Material Found in Location
                                </span>
                              </div>

                              <div className='space-y-3'>
                                <div className='space-y-2'>
                                  <Label>Part Number</Label>
                                  <ScannerInput
                                    placeholder='Scan or enter part number'
                                    value={emptyLocationState.foundPartNumber}
                                    onChange={(e) =>
                                      setEmptyLocationState((prev) => ({
                                        ...prev,
                                        foundPartNumber: e.target.value,
                                      }))
                                    }
                                    className='font-mono'
                                  />
                                </div>

                                <div className='space-y-2'>
                                  <Label>Quantity Found</Label>
                                  <QuantityKeypad
                                    value={emptyLocationState.foundQuantity}
                                    onChange={(value) =>
                                      setEmptyLocationState((prev) => ({
                                        ...prev,
                                        foundQuantity: value,
                                      }))
                                    }
                                    label='Quantity Found'
                                  />
                                </div>
                              </div>
                            </CardContent>
                          </Card>

                          <Button
                            variant='outline'
                            size='sm'
                            className='w-full'
                            onClick={() =>
                              setEmptyLocationState({
                                isEmpty: null,
                                foundPartNumber: '',
                                foundQuantity: 0,
                              })
                            }
                          >
                            ← Back to Verification
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    /* Standard Count Workflow */
                    <>
                      <div className='mb-6 space-y-2 text-center'>
                        <Calculator className='text-primary mx-auto h-12 w-12' />
                        <h3 className='text-lg font-semibold'>
                          {isBlindCount ? 'Blind Count' : 'Recount'}
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          {isBlindCount
                            ? 'Perform a blind count - system quantity is hidden for accuracy'
                            : 'Perform a recount - verify the quantity'}
                        </p>
                      </div>

                      <Card className='mb-4'>
                        <CardContent className='p-4'>
                          <div className='text-center'>
                            <p className='text-muted-foreground mb-1 text-sm'>
                              Count Item
                            </p>
                            <p className='text-primary text-lg font-bold'>
                              {currentTask.material_number}
                              <span className='text-muted-foreground ml-2 text-sm font-normal'>
                                ({currentTask.unit_of_measure || 'EA'})
                              </span>
                            </p>
                            <p className='text-muted-foreground mt-1 text-xs'>
                              Location: {currentTask.location} ✓
                            </p>
                            {isBlindCount ? (
                              <p className='mt-2 text-xs font-medium text-orange-600'>
                                🔒 Blind Count - System quantity hidden
                              </p>
                            ) : (
                              <p className='mt-2 text-xs font-medium text-blue-600'>
                                🔄 Recount Required
                              </p>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <QuantityKeypad
                        value={formData.countedQuantity}
                        onChange={(value) =>
                          handleFieldChange('countedQuantity', value)
                        }
                        label='Counted Quantity'
                        unitOfMeasure={currentTask.unit_of_measure || 'EA'}
                      />

                      {formData.countedQuantity > 0 && (
                        <Card className='border-primary border-dashed'>
                          <CardContent className='p-3'>
                            <div className='flex items-center justify-center text-sm'>
                              <div className='text-primary flex items-center space-x-2'>
                                <CheckCircle className='h-4 w-4' />
                                <span className='font-medium'>
                                  Counted: {formData.countedQuantity}{' '}
                                  {currentTask.unit_of_measure || 'EA'}
                                </span>
                              </div>
                            </div>
                            <p className='text-muted-foreground mt-1 text-center text-xs'>
                              {isBlindCount
                                ? 'Variance will be calculated after submission'
                                : 'Press Submit to complete'}
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Post-count extras (serial_number, condition_assessment,
                  notes) — sandwich between step 3 (Count) and step 4
                  (Review / Evidence). */}
              {subStep === 'post_extras' && currentPostStep && currentTask && (
                <div className='space-y-4'>
                  <ExtraStepRenderer
                    stepConfig={currentPostStep.stepConfig}
                    task={currentTask}
                    existingResults={{
                      countedQuantity: formData.countedQuantity,
                    }}
                    onComplete={handlePostExtraComplete}
                    onBack={handlePostExtraBack}
                    isProcessing={isProcessing}
                  />
                </div>
              )}

              {/* Step 4: Review / Photo / Notes — rendered when the
                  workflow hits variance review OR any post-count capture is
                  required (e.g. required photo, required notes). */}
              {subStep === null && currentStep === 4 && currentTask && (
                <div className='space-y-4'>
                  <div className='mb-6 space-y-2 text-center'>
                    {requiresReview && varianceInfo ? (
                      <>
                        <AlertTriangle className='mx-auto h-12 w-12 text-orange-500' />
                        <h3 className='text-lg font-semibold'>
                          Variance Review Required
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          This count has a significant variance that requires
                          review
                        </p>
                      </>
                    ) : (
                      <>
                        <Camera className='text-primary mx-auto h-12 w-12' />
                        <h3 className='text-lg font-semibold'>
                          Evidence Capture
                        </h3>
                        <p className='text-muted-foreground text-sm'>
                          {photoStepRequired
                            ? 'Capture a photo to document this count.'
                            : 'Add any supporting notes or photos.'}
                        </p>
                      </>
                    )}
                  </div>

                  {requiresReview && varianceInfo && (
                    <Card className='border-orange-200'>
                      <CardContent className='p-4'>
                        <h4 className='mb-3 flex items-center font-semibold text-orange-600'>
                          <AlertTriangle className='mr-2 h-4 w-4' />
                          Variance Detected
                        </h4>

                        <div className='space-y-3 text-sm'>
                          <div className='mb-3 rounded-lg bg-orange-50 p-3 dark:bg-orange-950/20'>
                            <p className='text-center font-medium text-orange-800 dark:text-orange-200'>
                              Your count differs from the system quantity
                            </p>
                            <p className='mt-1 text-center text-xs text-orange-600 dark:text-orange-400'>
                              Please add notes explaining the variance below
                            </p>
                          </div>

                          <div className='flex justify-between'>
                            <span className='text-muted-foreground'>
                              Your Counted Quantity:
                            </span>
                            <span className='font-medium'>
                              {formData.countedQuantity}{' '}
                              {currentTask?.unit_of_measure || 'EA'}
                            </span>
                          </div>
                          <div className='flex justify-between border-t pt-2'>
                            <span className='text-muted-foreground'>
                              Variance Amount:
                            </span>
                            <span
                              className={cn(
                                'font-semibold',
                                varianceInfo.variance > 0
                                  ? 'text-orange-600'
                                  : 'text-red-600'
                              )}
                            >
                              {varianceInfo.variance > 0 ? '+' : ''}
                              {varianceInfo.variance} units
                            </span>
                          </div>
                          <div className='flex justify-between'>
                            <span className='text-muted-foreground'>
                              Variance Significance:
                            </span>
                            <span className='font-semibold text-orange-600'>
                              {varianceInfo.percentage === Infinity
                                ? 'High (Zero base)'
                                : varianceInfo.percentage >
                                    workflow.reviewThresholdPct
                                  ? `High (${varianceInfo.percentage.toFixed(1)}% / threshold ${workflow.reviewThresholdPct}%)`
                                  : `Within threshold (${varianceInfo.percentage.toFixed(1)}% / ${workflow.reviewThresholdPct}%)`}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <div className='space-y-2'>
                    <Label htmlFor='notes' className='text-sm font-medium'>
                      Notes {!useKeyboardForNotes && '(Type or use keyboard)'}
                    </Label>

                    {!useKeyboardForNotes ? (
                      <>
                        <Textarea
                          id='notes'
                          placeholder='Add any notes about the variance...'
                          value={formData.notes}
                          onChange={(e) =>
                            handleFieldChange('notes', e.target.value)
                          }
                          disabled={isProcessing}
                          className='min-h-[80px]'
                        />
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='w-full'
                          onClick={() => setUseKeyboardForNotes(true)}
                        >
                          Use On-Screen Keyboard
                        </Button>
                      </>
                    ) : (
                      <>
                        <QWERTYKeyboard
                          value={formData.notes}
                          onChange={(value) =>
                            handleFieldChange('notes', value)
                          }
                          placeholder='Type notes about variance'
                        />
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='w-full'
                          onClick={() => setUseKeyboardForNotes(false)}
                        >
                          Use Text Input
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Legacy inline photo capture — only rendered when the
                      workflow does NOT have a dedicated photo_capture step
                      (in which case photos are captured by
                      `RFStepPhotoCapture` as a post-count extra instead).
                      Kept as an escape hatch for optional variance photos. */}
                  {!hasPhotoStep && requiresReview && (
                    <div className='space-y-2'>
                      <Label className='text-sm font-medium'>
                        Variance Photo (Optional)
                      </Label>
                      <p className='text-muted-foreground text-xs'>
                        Take a photo to document the variance
                      </p>

                      {photoPreview ? (
                        <div className='space-y-2'>
                          <div className='relative overflow-hidden rounded-lg border-2 border-green-500'>
                            <img
                              src={photoPreview}
                              alt='Variance photo'
                              className='h-32 w-full object-cover'
                            />
                            <Badge className='absolute top-2 right-2 bg-green-600'>
                              <CheckCircle className='mr-1 h-3 w-3' />
                              Photo Captured
                            </Badge>
                          </div>
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            className='w-full'
                            onClick={() => {
                              setPhotoPreview(null)
                              handleFieldChange('photo', null)
                              if (fileInputRef.current) {
                                fileInputRef.current.value = ''
                              }
                            }}
                          >
                            Retake Photo
                          </Button>
                        </div>
                      ) : (
                        <div className='relative'>
                          <input
                            ref={fileInputRef}
                            id='variance-photo'
                            type='file'
                            accept='image/*'
                            capture='environment'
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) handlePhotoCapture(file)
                            }}
                            className='absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0'
                            title='Tap to capture photo'
                          />
                          <div className='hover:bg-accent hover:border-accent-foreground/20 pointer-events-none flex h-24 w-full items-center justify-center rounded-lg border-2 border-dashed transition-colors'>
                            <div className='flex flex-col items-center space-y-1'>
                              <Camera className='text-muted-foreground h-6 w-6' />
                              <span className='text-xs font-medium'>
                                Tap to Capture Photo
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 5: Supervisor Sign-off (only when configured) */}
              {subStep === null &&
                currentStep === 5 &&
                hasSupervisorSignoff &&
                currentTask && (
                  <div className='space-y-4'>
                    <div className='mb-6 space-y-2 text-center'>
                      <Users className='text-primary mx-auto h-12 w-12' />
                      <h3 className='text-lg font-semibold'>
                        Supervisor Sign-off Required
                      </h3>
                      <p className='text-muted-foreground text-sm'>
                        A supervisor must acknowledge this count before it can
                        be completed.
                      </p>
                    </div>

                    <Card className='border-primary/40'>
                      <CardContent className='space-y-3 p-4'>
                        <div className='bg-muted/40 rounded-lg p-3 text-sm'>
                          <div className='flex justify-between'>
                            <span className='text-muted-foreground'>Count</span>
                            <span className='font-mono font-medium'>
                              {currentTask.count_number}
                            </span>
                          </div>
                          <div className='mt-1 flex justify-between'>
                            <span className='text-muted-foreground'>
                              Counted
                            </span>
                            <span className='font-semibold'>
                              {formData.countedQuantity}{' '}
                              {currentTask.unit_of_measure || 'EA'}
                            </span>
                          </div>
                          {varianceInfo && varianceInfo.variance !== 0 && (
                            <div className='mt-1 flex justify-between'>
                              <span className='text-muted-foreground'>
                                Variance
                              </span>
                              <span
                                className={cn(
                                  'font-semibold',
                                  varianceInfo.variance > 0
                                    ? 'text-orange-600'
                                    : 'text-red-600'
                                )}
                              >
                                {varianceInfo.variance > 0 ? '+' : ''}
                                {varianceInfo.variance}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className='space-y-1.5'>
                          <Label
                            htmlFor='supervisor-pin'
                            className='text-sm font-medium'
                          >
                            Supervisor PIN
                          </Label>
                          <input
                            id='supervisor-pin'
                            type='password'
                            inputMode='numeric'
                            autoComplete='one-time-code'
                            value={supervisorPin}
                            onChange={(e) => setSupervisorPin(e.target.value)}
                            placeholder='••••'
                            className='border-input bg-background focus:ring-ring h-14 w-full rounded-lg border text-center font-mono text-2xl tracking-[0.5em] shadow-sm focus:ring-2 focus:outline-none'
                          />
                          <p className='text-muted-foreground text-xs'>
                            Have the supervisor enter their PIN to approve the
                            count.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

              {/* Auto-advance countdown (inline fallback if task hasn't been nulled yet) */}
              {autoAdvanceCountdown > 0 && (
                <Card className='border-green-500/30 bg-green-500/10 dark:bg-green-500/20'>
                  <CardContent className='p-4'>
                    <div className='flex items-center justify-center gap-3'>
                      <Loader2 className='h-5 w-5 animate-spin text-green-600 dark:text-green-400' />
                      <p className='text-sm font-medium text-green-800 dark:text-green-200'>
                        Next count in {autoAdvanceCountdown}s...
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer Actions — hidden while extra steps render their own */}
        {autoAdvanceCountdown === 0 && currentTask && subStep === null && (
          <div className='bg-card border-t p-4'>
            <Button
              onClick={() => {
                switch (currentStep) {
                  case 1:
                    handleConfirmItem()
                    break
                  case 2:
                    handleLocationScan()
                    break
                  case 3:
                    handleQuantitySubmit()
                    break
                  case 4:
                    handleReviewComplete()
                    break
                  case 5:
                    handleSupervisorSignoff()
                    break
                }
              }}
              disabled={
                isProcessing ||
                isVerifyingSignoff ||
                locationState.isValidating ||
                (() => {
                  switch (currentStep) {
                    case 1:
                      return !currentTask
                    case 2:
                      return !locationState.scannedLocation.trim()
                    case 3:
                      if (isEmptyLocationCheck) {
                        return (
                          emptyLocationState.isEmpty === null ||
                          (emptyLocationState.isEmpty === false &&
                            (!emptyLocationState.foundPartNumber.trim() ||
                              emptyLocationState.foundQuantity <= 0))
                        )
                      }
                      return formData.countedQuantity < 0
                    case 4:
                      // Review step: no gating needed here (legacy inline
                      // photo is optional; configured photo_capture runs in
                      // the post-count extras pipeline before we arrive).
                      return false
                    case 5:
                      return supervisorPin.trim().length < 4
                    default:
                      return true
                  }
                })()
              }
              className='h-14 w-full text-lg'
            >
              {(isProcessing || isVerifyingSignoff) && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              {(() => {
                switch (currentStep) {
                  case 1:
                    return 'Start Counting'
                  case 2:
                    return locationState.isValidating
                      ? 'Validating Location...'
                      : 'Verify Location'
                  case 3:
                    return 'Submit Count'
                  case 4:
                    return hasSupervisorSignoff
                      ? 'Continue to Sign-off'
                      : 'Complete Count'
                  case 5:
                    return isVerifyingSignoff
                      ? 'Verifying...'
                      : 'Approve & Complete'
                  default:
                    return 'Continue'
                }
              })()}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showReleaseConfirm}
        title='Release Task'
        message='Are you sure you want to release this task? Any unsaved progress will be lost and the count will return to the queue.'
        variant='warning'
        confirmText='Release'
        cancelText='Keep Working'
        onConfirm={handleReleaseConfirmed}
        onCancel={() => setShowReleaseConfirm(false)}
        isProcessing={isReleasing}
      />

      <ConfirmDialog
        isOpen={showSkipConfirm}
        title='Skip Count'
        message='Skip this count? It will move to the end of your personal queue and come back after you finish your other counts.'
        variant='warning'
        confirmText='Skip'
        cancelText='Keep Working'
        onConfirm={() => handleSkipConfirmed()}
        onCancel={() => setShowSkipConfirm(false)}
        isProcessing={isProcessing}
      />
    </>
  )
}

export default RFCycleCountUnified

// Created and developed by Jai Singh
