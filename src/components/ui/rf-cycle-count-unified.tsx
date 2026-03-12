/**
 * RF Cycle Count Unified Component
 * Merges both Pull (IN) and Push (OUT) modes into a single workflow
 * Provides 5-step workflow: Confirm → Location → Count → Review → Complete
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
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
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import type {
  CycleCountPriority,
  CycleCountTask,
} from '@/lib/work-service/types'
// Hooks and Services
import { useUnifiedCycleCount } from '@/hooks/use-unified-cycle-count'
// Components
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { QWERTYKeyboard } from '@/components/ui/qwerty-keyboard'
import { ScannerInput } from '@/components/ui/scanner-input'
import { Textarea } from '@/components/ui/textarea'

// ============================================
// Types
// ============================================

export interface RFCycleCountUnifiedProps {
  onBack: () => void
  initialMode?: 'pull' | 'push' | 'auto'
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
 * Step Progress Indicator
 */
const StepIndicator = ({
  currentStep,
  hasReviewStep,
}: {
  currentStep: WorkflowStep
  hasReviewStep: boolean
}) => {
  const baseSteps = [
    { id: 1, title: 'Confirm', icon: Package },
    { id: 2, title: 'Location', icon: MapPin },
    { id: 3, title: 'Count', icon: Calculator },
    { id: 4, title: 'Complete', icon: CheckCircle },
  ]

  const reviewSteps = [
    { id: 1, title: 'Confirm', icon: Package },
    { id: 2, title: 'Location', icon: MapPin },
    { id: 3, title: 'Count', icon: Calculator },
    { id: 4, title: 'Review', icon: AlertTriangle },
    { id: 5, title: 'Complete', icon: CheckCircle },
  ]

  const steps = hasReviewStep ? reviewSteps : baseSteps

  return (
    <div className='px-4 py-2'>
      <div className='flex items-center justify-between'>
        {steps.map((step, index) => {
          const StepIcon = step.icon
          const isActive = currentStep === step.id
          const isCompleted = currentStep > step.id

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
 * Connection Status Indicator
 */
const ConnectionIndicator = ({ isConnected }: { isConnected: boolean }) => (
  <div className='flex items-center gap-1 text-xs'>
    {isConnected ? (
      <>
        <Wifi className='h-3 w-3 text-green-500' />
        <span className='text-green-500'>Live</span>
      </>
    ) : (
      <>
        <WifiOff className='text-muted-foreground h-3 w-3' />
        <span className='text-muted-foreground'>Offline</span>
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
}: RFCycleCountUnifiedProps) {
  // ============================================
  // Mode Detection
  // ============================================

  const [mode] = useState<'pull' | 'push'>(() => {
    if (initialMode === 'auto') {
      // Could check for pushed tasks here, default to pull
      return 'pull'
    }
    return initialMode
  })

  // ============================================
  // Hook Integration
  // ============================================

  const {
    currentTask,
    pushedTasks,
    isLoading,
    isClaiming,
    isCompleting,
    isStarting,
    isReleasing,
    claimNext,
    startTask,
    completeTask,
    releaseTask,
    acknowledgeTask,
    setCurrentTask,
    saveDraft,
    clearDraft,
    isConnected,
    taskDurationMinutes,
    isNearingAbandonment,
  } = useUnifiedCycleCount({
    mode,
    autoClaimOnMount: mode === 'pull',
    enableRealtime: true,
    onTaskReceived: () => {
      // Vibrate on new push (mobile devices)
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200])
      }
    },
    onError: (err) => {
      logger.error('[RFCycleCountUnified] Hook error:', err.message)
    },
  })

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

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ============================================
  // Derived State
  // ============================================

  const isProcessing =
    isClaiming || isCompleting || isStarting || isReleasing || isLoading
  const isEmptyLocationCheck =
    currentTask?.count_type === 'empty_location_check'
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

  // Auto-advance countdown
  useEffect(() => {
    if (autoAdvanceCountdown <= 0) return

    const timer = setInterval(() => {
      setAutoAdvanceCountdown((prev) => {
        if (prev <= 1) {
          // Claim next task
          if (mode === 'pull') {
            claimNext()
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [autoAdvanceCountdown, mode, claimNext])

  // Reset state when task changes
  useEffect(() => {
    if (currentTask) {
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
      setAutoAdvanceCountdown(0)
    }
  }, [currentTask?.id])

  // Draft auto-save
  useEffect(() => {
    if (currentTask && currentStep > 1) {
      saveDraft({
        countedQuantity: formData.countedQuantity,
        notes: formData.notes,
        step: currentStep,
      })
    }
  }, [
    currentTask,
    currentStep,
    formData.countedQuantity,
    formData.notes,
    saveDraft,
  ])

  // ============================================
  // Handlers
  // ============================================

  const handleStartTask = useCallback(
    async (task: CycleCountTask) => {
      try {
        await acknowledgeTask(task.id)
        await startTask(task.id)
        setCurrentTask(task)
        setNewPushAlert(null)
        toast.success(`Starting count: ${task.count_number}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        toast.error(`Failed to start task: ${message}`)
      }
    },
    [acknowledgeTask, startTask, setCurrentTask]
  )

  const handleConfirmItem = useCallback(async () => {
    if (!currentTask) return
    await startTask(currentTask.id)
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
    async (scannedLocation: string) => {
      if (!currentTask || !scannedLocation.trim()) {
        toast.error('Please scan a location')
        return
      }

      setLocationState((prev) => ({ ...prev, isValidating: true }))

      const isValid = validateLocation(scannedLocation, currentTask.location)

      if (isValid) {
        setLocationState({
          scannedLocation,
          verified: true,
          isValidating: false,
        })
        setCurrentStep(3)
        toast.success(`Location verified: ${currentTask.location}`)
      } else {
        setLocationState((prev) => ({
          ...prev,
          scannedLocation,
          verified: false,
          isValidating: false,
        }))
        toast.error(`Location mismatch! Expected: ${currentTask.location}`)
      }
    },
    [currentTask, validateLocation]
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

    // Check if review is needed (only on recounts, not first count)
    const needsReview =
      !isBlindCount &&
      variance &&
      (Math.abs(variance.percentage) > 10 || Math.abs(variance.variance) > 5)

    if (needsReview) {
      setRequiresReview(true)
      setCurrentStep(4)
    } else {
      // Auto-complete
      await completeTask(formData.countedQuantity, formData.notes || undefined)
      handleTaskComplete()
    }
  }, [
    currentTask,
    isEmptyLocationCheck,
    emptyLocationState,
    formData,
    isBlindCount,
    calculateVariance,
    completeTask,
  ])

  const handleReviewComplete = useCallback(async () => {
    if (!currentTask) return
    await completeTask(formData.countedQuantity, formData.notes || undefined)
    handleTaskComplete()
  }, [currentTask, formData, completeTask])

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

    // Auto-advance to next task in pull mode
    if (mode === 'pull') {
      setAutoAdvanceCountdown(3)
    } else {
      // In push mode, go back to list
      setCurrentTask(null)
    }
  }, [
    clearDraft,
    isEmptyLocationCheck,
    emptyLocationState,
    isBlindCount,
    varianceInfo,
    mode,
    setCurrentTask,
  ])

  const handleReleaseTask = useCallback(async () => {
    await releaseTask()
    clearDraft()
    toast.info('Task released back to queue')

    if (mode === 'pull') {
      // Try to claim next
      await claimNext()
    }
  }, [releaseTask, clearDraft, mode, claimNext])

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
        <div className='bg-card flex items-center justify-between border-b p-4'>
          <Button variant='ghost' size='sm' onClick={onBack} className='h-10'>
            <ArrowLeft className='mr-2 h-4 w-4' />
            Back
          </Button>
          <div className='text-center'>
            <h1 className='text-lg font-semibold'>Cycle Count</h1>
            <span className='text-muted-foreground text-xs'>Push Mode</span>
          </div>
          <div className='flex items-center gap-2'>
            <ConnectionIndicator isConnected={isConnected} />
            <Badge
              variant={pushedTasks.length > 0 ? 'destructive' : 'secondary'}
              className='min-w-8 justify-center'
            >
              {pushedTasks.length}
            </Badge>
          </div>
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
  // Render: No Tasks Available
  // ============================================

  if (!currentTask && mode === 'pull' && !isClaiming) {
    return (
      <div className='flex min-h-[400px] flex-col items-center justify-center p-8'>
        <div className='space-y-4 text-center'>
          <CheckCircle className='mx-auto h-16 w-16 text-green-500' />
          <h3 className='text-xl font-semibold text-green-700'>
            All Counts Complete!
          </h3>
          <p className='text-muted-foreground'>
            All pending cycle counts have been completed.
          </p>
          <Button onClick={onBack} className='mt-4'>
            <ChevronLeft className='mr-2 h-4 w-4' />
            Return to RF Menu
          </Button>
        </div>
      </div>
    )
  }

  // ============================================
  // Render: Main Workflow
  // ============================================

  return (
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
          <ConnectionIndicator isConnected={isConnected} />
          {currentTask && (
            <Button
              variant='ghost'
              size='sm'
              onClick={handleReleaseTask}
              disabled={isProcessing}
              className='text-orange-600 hover:text-orange-700'
            >
              {isReleasing ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                'Release'
              )}
            </Button>
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

      {/* Step Indicator */}
      {currentTask && (
        <StepIndicator
          currentStep={currentStep}
          hasReviewStep={requiresReview}
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
            {currentStep === 1 && currentTask && (
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
                        <span className='text-muted-foreground'>Material:</span>
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
                        <span className='text-muted-foreground'>Location:</span>
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
            {currentStep === 2 && currentTask && (
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
                    onChange={(e) =>
                      setLocationState((prev) => ({
                        ...prev,
                        scannedLocation: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleLocationScan(locationState.scannedLocation)
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

            {/* Step 3: Count */}
            {currentStep === 3 && currentTask && (
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

            {/* Step 4: Review (if variance requires review) */}
            {currentStep === 4 && requiresReview && varianceInfo && (
              <div className='space-y-4'>
                <div className='mb-6 space-y-2 text-center'>
                  <AlertTriangle className='mx-auto h-12 w-12 text-orange-500' />
                  <h3 className='text-lg font-semibold'>
                    Variance Review Required
                  </h3>
                  <p className='text-muted-foreground text-sm'>
                    This count has a significant variance that requires review
                  </p>
                </div>

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
                            : varianceInfo.percentage > 10
                              ? `High (${varianceInfo.percentage.toFixed(1)}%)`
                              : 'Moderate'}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

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
                        onChange={(value) => handleFieldChange('notes', value)}
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

                {/* Photo Capture */}
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
              </div>
            )}

            {/* Auto-advance countdown */}
            {autoAdvanceCountdown > 0 && (
              <Card className='border-green-500/30 bg-green-500/10 dark:bg-green-500/20'>
                <CardContent className='p-4'>
                  <div className='text-center'>
                    <CheckCircle className='mx-auto mb-2 h-8 w-8 text-green-600 dark:text-green-400' />
                    <p className='mb-1 text-sm font-medium text-green-800 dark:text-green-200'>
                      Count completed successfully!
                    </p>
                    <p className='text-xs text-green-700 dark:text-green-300'>
                      Moving to next count in {autoAdvanceCountdown}s...
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer Actions */}
      {autoAdvanceCountdown === 0 && currentTask && (
        <div className='bg-card border-t p-4'>
          <Button
            onClick={() => {
              switch (currentStep) {
                case 1:
                  handleConfirmItem()
                  break
                case 2:
                  handleLocationScan(locationState.scannedLocation)
                  break
                case 3:
                  handleQuantitySubmit()
                  break
                case 4:
                  handleReviewComplete()
                  break
              }
            }}
            disabled={
              isProcessing ||
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
                    return false
                  default:
                    return true
                }
              })()
            }
            className='h-14 w-full text-lg'
          >
            {isProcessing && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
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
                  return 'Complete Count'
                default:
                  return 'Continue'
              }
            })()}
          </Button>
        </div>
      )}
    </div>
  )
}

export default RFCycleCountUnified
