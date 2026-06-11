// Created and developed by Jai Singh
/**
 * Main Onboarding Wizard Component
 * Modern sidebar layout with vertical step indicator
 * Updated: February 1, 2026
 *
 * Performance: All 9 step components are lazy-loaded to reduce initial bundle size
 *
 * Accessibility Features:
 * - Live region announcements for step changes (aria-live="polite")
 * - Focus management on step transitions
 * - ARIA landmarks for main sections
 * - Progress announcements for validation status changes
 * - Keyboard navigation support
 *
 * UX Enhancements:
 * - Auto-save status indicator with visual feedback
 * - Draft recovery banner when resuming sessions
 * - Skip button for optional steps (7 & 8)
 * - Step completion celebration animation
 * - Keyboard shortcut hints (tooltips)
 * - Progress percentage in page title
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  Check,
  Keyboard,
  Loader2,
  PartyPopper,
  Save,
  UserPlus,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useOnboarding,
  type AutoSaveStatus,
} from '../context/onboarding-context'
import { ONBOARDING_STEPS } from '../types/onboarding.types'
import {
  MobileStepHeader,
  StepProgressSummary,
  VerticalStepIndicator,
} from './shared/step-indicator'
import { WizardNavigation } from './shared/wizard-navigation'

// Badge is available in shadcn/ui if needed for future enhancements

// Lazy load all step components for code splitting
const Step1PersonalInfo = lazy(() =>
  import('./steps/step1-personal-info').then((m) => ({
    default: m.Step1PersonalInfo,
  }))
)
const Step2Authentication = lazy(() =>
  import('./steps/step2-authentication').then((m) => ({
    default: m.Step2Authentication,
  }))
)
const Step3RoleAssignment = lazy(() =>
  import('./steps/step3-role-assignment').then((m) => ({
    default: m.Step3RoleAssignment,
  }))
)
const Step4PositionAssignment = lazy(() =>
  import('./steps/step4-position-assignment').then((m) => ({
    default: m.Step4PositionAssignment,
  }))
)
const Step5ShiftSchedule = lazy(() =>
  import('./steps/step5-shift-schedule').then((m) => ({
    default: m.Step5ShiftSchedule,
  }))
)
const Step6WorkingArea = lazy(() =>
  import('./steps/step6-working-area').then((m) => ({
    default: m.Step6WorkingArea,
  }))
)
const Step7Certifications = lazy(() =>
  import('./steps/step7-certifications').then((m) => ({
    default: m.Step7Certifications,
  }))
)
const Step8DeviceRegistration = lazy(() =>
  import('./steps/step8-device-registration').then((m) => ({
    default: m.Step8DeviceRegistration,
  }))
)
const Step9ReviewSubmit = lazy(() =>
  import('./steps/step9-review-submit').then((m) => ({
    default: m.Step9ReviewSubmit,
  }))
)

/**
 * Loading fallback component for lazy-loaded steps
 * Displays a skeleton UI matching the typical step layout
 */
function StepLoadingFallback() {
  return (
    <Card className='animate-pulse'>
      <CardHeader className='space-y-2'>
        <Skeleton className='h-7 w-48' />
        <Skeleton className='h-4 w-72' />
      </CardHeader>
      <CardContent className='space-y-6'>
        {/* Two-column form fields */}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div className='space-y-2'>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-10 w-full' />
          </div>
          <div className='space-y-2'>
            <Skeleton className='h-4 w-24' />
            <Skeleton className='h-10 w-full' />
          </div>
        </div>
        {/* Single-column field */}
        <div className='space-y-2'>
          <Skeleton className='h-4 w-28' />
          <Skeleton className='h-10 w-full' />
        </div>
        {/* Larger textarea-like field */}
        <div className='space-y-2'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-24 w-full' />
        </div>
        {/* Additional form elements */}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div className='space-y-2'>
            <Skeleton className='h-4 w-16' />
            <Skeleton className='h-10 w-full' />
          </div>
          <div className='space-y-2'>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-10 w-full' />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Validation Error Summary Component
 * Displays a list of validation errors at the bottom of the step content
 * Accessible with ARIA attributes for screen readers
 */
function ValidationErrorSummary({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null

  return (
    <Alert
      variant='destructive'
      className='mt-6'
      role='alert'
      aria-live='assertive'
      aria-atomic='true'
    >
      <AlertCircle className='h-4 w-4' aria-hidden='true' />
      <AlertTitle>Please fix the following errors</AlertTitle>
      <AlertDescription>
        <ul
          className='mt-2 list-disc space-y-1 pl-4'
          aria-label='Validation errors'
        >
          {errors.map((error, index) => (
            <li key={index} className='text-sm'>
              {error}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Format a timestamp as relative time (e.g., "just now", "2 minutes ago")
 */
function formatRelativeTime(timestamp: string): string {
  const now = new Date()
  const saved = new Date(timestamp)
  const diffMs = now.getTime() - saved.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)

  if (diffSecs < 10) return 'just now'
  if (diffSecs < 60) return `${diffSecs}s ago`
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return saved.toLocaleDateString()
}

/**
 * Auto-Save Status Indicator Component
 * Shows the current auto-save status with visual feedback
 */
function AutoSaveIndicator({
  status,
  lastSavedAt,
}: {
  status: AutoSaveStatus
  lastSavedAt: string | null
}) {
  return (
    <div
      className='text-muted-foreground flex items-center gap-2 text-xs'
      role='status'
      aria-live='polite'
    >
      {status === 'pending' && (
        <>
          <div
            className='h-2 w-2 animate-pulse rounded-full bg-yellow-500'
            aria-hidden='true'
          />
          <span>Unsaved changes</span>
        </>
      )}
      {status === 'saving' && (
        <>
          <Loader2 className='h-3 w-3 animate-spin' aria-hidden='true' />
          <span>Saving...</span>
        </>
      )}
      {status === 'saved' && lastSavedAt && (
        <>
          <Check className='h-3 w-3 text-green-500' aria-hidden='true' />
          <span>Saved {formatRelativeTime(lastSavedAt)}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle
            className='text-destructive h-3 w-3'
            aria-hidden='true'
          />
          <span>Failed to save</span>
        </>
      )}
      {status === 'idle' && lastSavedAt && (
        <>
          <Check
            className='text-muted-foreground/50 h-3 w-3'
            aria-hidden='true'
          />
          <span className='text-muted-foreground/70'>
            Saved {formatRelativeTime(lastSavedAt)}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * Draft Recovery Banner Component
 * Shown when a draft is recovered from a previous session
 */
function DraftRecoveryBanner({
  onDismiss,
  lastSavedAt,
}: {
  onDismiss: () => void
  lastSavedAt: string | null
}) {
  return (
    <Alert className='border-primary/20 bg-primary/5 mb-4'>
      <PartyPopper className='text-primary h-4 w-4' aria-hidden='true' />
      <AlertTitle className='text-primary'>Draft Recovered</AlertTitle>
      <AlertDescription className='flex items-center justify-between'>
        <span className='text-sm'>
          We found unsaved progress from your last session
          {lastSavedAt && ` (saved ${formatRelativeTime(lastSavedAt)})`}.
        </span>
        <Button
          variant='ghost'
          size='sm'
          onClick={onDismiss}
          className='ml-2 h-7 px-2 text-xs'
        >
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Step Completion Celebration Component
 * Shows a subtle animation when completing a step
 */
function StepCompletionCelebration({
  show,
  stepTitle,
}: {
  show: boolean
  stepTitle: string
}) {
  if (!show) return null

  return (
    <div
      className='animate-in slide-in-from-top-2 fade-in fixed top-4 right-4 z-50 duration-300'
      role='alert'
      aria-live='polite'
    >
      <div className='flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-2 shadow-lg'>
        <Check className='h-4 w-4 text-green-500' aria-hidden='true' />
        <span className='text-sm font-medium text-green-700 dark:text-green-400'>
          {stepTitle} completed!
        </span>
      </div>
    </div>
  )
}

/**
 * Keyboard Shortcuts Help Component
 * Shows available keyboard shortcuts
 */
function KeyboardShortcutsHelp() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground/70 hover:text-foreground h-8 w-8'
            aria-label='Keyboard shortcuts'
          >
            <Keyboard className='h-4 w-4' />
          </Button>
        </TooltipTrigger>
        <TooltipContent side='bottom' align='end' className='text-xs'>
          <div className='space-y-1'>
            <p className='mb-1 font-medium'>Keyboard Shortcuts</p>
            <p>
              <kbd className='bg-muted rounded px-1 py-0.5 text-[10px]'>
                Alt
              </kbd>{' '}
              +{' '}
              <kbd className='bg-muted rounded px-1 py-0.5 text-[10px]'>←</kbd>{' '}
              Previous step
            </p>
            <p>
              <kbd className='bg-muted rounded px-1 py-0.5 text-[10px]'>
                Alt
              </kbd>{' '}
              +{' '}
              <kbd className='bg-muted rounded px-1 py-0.5 text-[10px]'>→</kbd>{' '}
              Next step
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function OnboardingWizard() {
  const navigate = useNavigate()
  const {
    state,
    goToStep,
    nextStep,
    prevStep,
    saveDraft,
    submitOnboarding,
    validateStep,
    validateAll,
    resetWizard,
    // Accessibility features from context
    shouldFocusStep,
    clearFocusFlag,
    // Auto-save status for UX indicator
    autoSaveStatus,
    lastAutoSaveAt,
  } = useOnboarding()

  const {
    currentStep,
    totalSteps,
    stepsValidation,
    isSubmitting,
    generatedCredentials,
    lastSavedAt,
  } = state

  // Accessibility: Track previous step for announcements
  const prevStepRef = useRef(currentStep)
  const [announcement, setAnnouncement] = useState('')
  const [validationAnnouncement, setValidationAnnouncement] = useState('')
  const stepContentRef = useRef<HTMLDivElement>(null)

  // Validation error state for displaying errors in the UI
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  // UX Enhancement: Draft recovery banner visibility
  const [showDraftRecoveredBanner, setShowDraftRecoveredBanner] =
    useState(false)
  const draftRecoveryCheckedRef = useRef(false)

  // UX Enhancement: Step completion celebration
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationStepTitle, setCelebrationStepTitle] = useState('')

  // Get current step data for announcements
  const currentStepData = ONBOARDING_STEPS.find((s) => s.id === currentStep)
  const currentStepTitle = currentStepData?.title || `Step ${currentStep}`

  // Clear validation errors when step changes
  useEffect(() => {
    setValidationErrors([])
  }, [currentStep])

  // Accessibility: Announce step changes to screen readers
  useEffect(() => {
    if (prevStepRef.current !== currentStep) {
      const direction =
        currentStep > prevStepRef.current
          ? 'Navigated forward to'
          : 'Navigated back to'
      const optionalText = currentStepData?.isOptional ? ' (optional step)' : ''
      setAnnouncement(
        `${direction} step ${currentStep} of ${totalSteps}: ${currentStepTitle}${optionalText}`
      )
      prevStepRef.current = currentStep
    }
  }, [currentStep, totalSteps, currentStepTitle, currentStepData?.isOptional])

  // Accessibility: Focus management on step transitions
  useEffect(() => {
    if (shouldFocusStep) {
      // Small delay to allow the new step content to render
      const timeoutId = setTimeout(() => {
        // Try to focus the step heading first, then the content container
        const stepHeading = stepContentRef.current?.querySelector(
          'h2, h3, [role="heading"]'
        ) as HTMLElement
        if (stepHeading) {
          stepHeading.setAttribute('tabindex', '-1')
          stepHeading.focus()
        } else if (stepContentRef.current) {
          stepContentRef.current.setAttribute('tabindex', '-1')
          stepContentRef.current.focus()
        }
        clearFocusFlag()
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [shouldFocusStep, clearFocusFlag])

  // Accessibility: Announce validation status changes
  useEffect(() => {
    const requiredSteps = ONBOARDING_STEPS.filter((s) => !s.isOptional).length
    const completedRequiredSteps = ONBOARDING_STEPS.filter(
      (s) => !s.isOptional && stepsValidation[s.id]
    ).length

    if (completedRequiredSteps > 0) {
      setValidationAnnouncement(
        `Progress: ${completedRequiredSteps} of ${requiredSteps} required steps completed`
      )
    }
  }, [stepsValidation])

  // UX Enhancement: Show draft recovery banner if draft was loaded
  useEffect(() => {
    if (!draftRecoveryCheckedRef.current && lastSavedAt && currentStep > 1) {
      draftRecoveryCheckedRef.current = true
      setShowDraftRecoveredBanner(true)
      // Auto-dismiss after 10 seconds
      const timeout = setTimeout(() => {
        setShowDraftRecoveredBanner(false)
      }, 10000)
      return () => clearTimeout(timeout)
    }
  }, [lastSavedAt, currentStep])

  // UX Enhancement: Progress percentage in page title
  useEffect(() => {
    const requiredSteps = ONBOARDING_STEPS.filter((s) => !s.isOptional).length
    const completedRequiredSteps = ONBOARDING_STEPS.filter(
      (s) => !s.isOptional && stepsValidation[s.id]
    ).length
    const percentage = Math.round(
      (completedRequiredSteps / requiredSteps) * 100
    )
    document.title = `Employee Onboarding (${percentage}% complete) | OmniFrame`

    return () => {
      document.title = 'OmniFrame'
    }
  }, [stepsValidation, totalSteps])

  // UX Enhancement: Step completion celebration
  const triggerCelebration = useCallback((stepTitle: string) => {
    setCelebrationStepTitle(stepTitle)
    setShowCelebration(true)
    // Auto-hide after 2 seconds
    setTimeout(() => {
      setShowCelebration(false)
    }, 2000)
  }, [])

  // UX Enhancement: Keyboard shortcuts for navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt + Left Arrow = Previous step
      if (
        e.altKey &&
        e.key === 'ArrowLeft' &&
        currentStep > 1 &&
        !isSubmitting
      ) {
        e.preventDefault()
        prevStep()
      }
      // Alt + Right Arrow = Next step
      if (
        e.altKey &&
        e.key === 'ArrowRight' &&
        currentStep < totalSteps &&
        !isSubmitting
      ) {
        e.preventDefault()
        if (currentStepData?.isOptional || validateStep(currentStep).isValid) {
          handleNext()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleNext and validateStep are defined later in the component
  }, [
    currentStep,
    totalSteps,
    isSubmitting,
    prevStep,
    currentStepData?.isOptional,
  ])

  // Check if current step is optional
  const isOptionalStep = currentStepData?.isOptional ?? false

  // Handle skip for optional steps
  const handleSkip = useCallback(() => {
    if (isOptionalStep && currentStep < totalSteps) {
      nextStep()
    }
  }, [isOptionalStep, currentStep, totalSteps, nextStep])

  // Get current step component
  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1PersonalInfo />
      case 2:
        return <Step2Authentication />
      case 3:
        return <Step3RoleAssignment />
      case 4:
        return <Step4PositionAssignment />
      case 5:
        return <Step5ShiftSchedule />
      case 6:
        return <Step6WorkingArea />
      case 7:
        return <Step7Certifications />
      case 8:
        return <Step8DeviceRegistration />
      case 9:
        return <Step9ReviewSubmit />
      default:
        return <Step1PersonalInfo />
    }
  }

  const handleNext = useCallback(() => {
    const result = validateStep(currentStep)
    if (result.isValid) {
      setValidationErrors([])
      // UX Enhancement: Trigger celebration for required steps
      if (!currentStepData?.isOptional) {
        triggerCelebration(currentStepTitle)
      }
      nextStep()
    } else {
      const errorMessages = result.errors.map((e) => e.message)
      setValidationErrors(errorMessages)
      toast.error('Please fix the errors before continuing')

      // Scroll to the error summary for better visibility
      setTimeout(() => {
        const errorSummary = document.querySelector('[role="alert"]')
        if (errorSummary) {
          errorSummary.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      }, 100)
    }
  }, [
    currentStep,
    currentStepData?.isOptional,
    currentStepTitle,
    validateStep,
    nextStep,
    triggerCelebration,
  ])

  const handleSubmit = async () => {
    // Validate all steps and collect errors
    const reviewResult = validateStep(9) // Step 9 validates all required steps
    if (!reviewResult.isValid) {
      const errorMessages = reviewResult.errors.map((e) => e.message)
      setValidationErrors(errorMessages)
      toast.error('Please complete all required fields before submitting')

      // Scroll to error summary
      setTimeout(() => {
        const errorSummary = document.querySelector('[role="alert"]')
        if (errorSummary) {
          errorSummary.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      }, 100)
      return
    }

    setValidationErrors([])
    const result = await submitOnboarding()
    if (result.success) {
      // Stay on the page to show credentials
    } else if (result.errors && result.errors.length > 0) {
      // Show submission errors
      setValidationErrors(result.errors)
    }
  }

  const handleCancel = () => {
    resetWizard()
    navigate({ to: '/admin/roles' })
  }

  const handleSaveDraft = async () => {
    await saveDraft()
  }

  const handleStartNew = () => {
    resetWizard()
  }

  // If onboarding is complete, show success state
  if (generatedCredentials) {
    return (
      <div
        className='flex min-h-[calc(100vh-200px)]'
        role='main'
        aria-label='Onboarding completed'
      >
        {/* Accessibility: Success announcement for screen readers */}
        <div role='alert' aria-live='assertive' className='sr-only'>
          Employee onboarding completed successfully. Credentials have been
          generated.
        </div>

        {/* Sidebar - Hidden on complete state for cleaner display */}
        <aside
          className='bg-muted/30 hidden w-[280px] shrink-0 flex-col border-r p-6 xl:flex'
          aria-label='Completion status'
        >
          <div className='mb-6'>
            <div className='text-primary flex items-center gap-2'>
              <UserPlus className='h-5 w-5' aria-hidden='true' />
              <h3 className='font-semibold'>Employee Added</h3>
            </div>
            <p className='text-muted-foreground mt-1 text-xs'>
              Onboarding completed successfully
            </p>
          </div>
          <VerticalStepIndicator
            currentStep={totalSteps}
            stepsValidation={Object.fromEntries(
              Array.from({ length: totalSteps }, (_, i) => [i + 1, true])
            )}
          />
        </aside>

        {/* Main Content */}
        <main className='flex flex-1 flex-col'>
          <div className='flex-1 p-6 lg:p-8'>
            <Suspense fallback={<StepLoadingFallback />}>
              {renderStep()}
            </Suspense>
          </div>

          {/* Actions */}
          <div className='bg-background border-t px-6 py-4'>
            <div className='flex justify-center gap-4'>
              <Button variant='outline' onClick={handleStartNew}>
                <UserPlus className='mr-2 h-4 w-4' />
                Start New Onboarding
              </Button>
              <Button
                onClick={() => navigate({ to: '/admin/user-management' })}
              >
                View All Users
              </Button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className='bg-background flex min-h-[calc(100vh-200px)]'>
      {/* UX Enhancement: Step completion celebration */}
      <StepCompletionCelebration
        show={showCelebration}
        stepTitle={celebrationStepTitle}
      />

      {/* Accessibility: Screen reader announcements for step changes */}
      <div
        role='status'
        aria-live='polite'
        aria-atomic='true'
        className='sr-only'
      >
        {announcement}
      </div>

      {/* Accessibility: Screen reader announcements for validation progress */}
      <div
        role='status'
        aria-live='polite'
        aria-atomic='true'
        className='sr-only'
      >
        {validationAnnouncement}
      </div>

      {/* Vertical Step Sidebar - Desktop Only */}
      <aside
        className='bg-muted/30 hidden w-[280px] shrink-0 flex-col border-r lg:flex'
        aria-label='Onboarding progress sidebar'
      >
        <ScrollArea className='flex-1'>
          <div className='p-6'>
            {/* Sidebar Header */}
            <div className='mb-6'>
              <div className='flex items-center gap-2'>
                <UserPlus className='text-primary h-5 w-5' />
                <h3 className='text-sm font-semibold'>New Employee</h3>
              </div>
              <p className='text-muted-foreground mt-1 text-xs'>
                Complete all required steps to add a new team member
              </p>
            </div>

            {/* Step Indicator */}
            <VerticalStepIndicator
              currentStep={currentStep}
              stepsValidation={stepsValidation}
              onStepClick={goToStep}
            />

            {/* Progress Summary */}
            <StepProgressSummary
              stepsValidation={stepsValidation}
              totalSteps={totalSteps}
            />
          </div>
        </ScrollArea>

        {/* Sidebar Footer Actions */}
        <div className='bg-background/50 border-t p-4'>
          <div className='flex flex-col gap-2'>
            {/* UX Enhancement: Auto-save status indicator */}
            <div className='flex items-center justify-center'>
              <AutoSaveIndicator
                status={autoSaveStatus}
                lastSavedAt={lastAutoSaveAt}
              />
            </div>
            <div className='flex gap-2'>
              <Button
                variant='ghost'
                size='sm'
                className='flex-1 text-xs'
                onClick={handleSaveDraft}
              >
                <Save className='mr-1 h-3 w-3' />
                Save Draft
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='text-muted-foreground text-xs'
                  >
                    <X className='mr-1 h-3 w-3' />
                    Cancel
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel Onboarding?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to cancel? Any unsaved progress will
                      be lost. You can save as draft to continue later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Continue Editing</AlertDialogCancel>
                    <Button variant='outline' onClick={handleSaveDraft}>
                      Save & Exit
                    </Button>
                    <AlertDialogAction onClick={handleCancel}>
                      Discard & Exit
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className='flex min-w-0 flex-1 flex-col'>
        {/* Mobile Step Header */}
        <div className='sticky top-0 z-10 lg:hidden'>
          <MobileStepHeader
            currentStep={currentStep}
            totalSteps={totalSteps}
            stepsValidation={stepsValidation}
            onStepClick={goToStep}
          />
        </div>

        {/* Mobile Header Actions */}
        <div className='bg-background flex items-center justify-between border-b px-4 py-2 lg:hidden'>
          <div className='flex items-center gap-2'>
            {/* UX Enhancement: Auto-save status on mobile */}
            <AutoSaveIndicator
              status={autoSaveStatus}
              lastSavedAt={lastAutoSaveAt}
            />
          </div>
          <div className='flex items-center gap-1'>
            <KeyboardShortcutsHelp />
            <Button variant='ghost' size='sm' onClick={handleSaveDraft}>
              <Save className='h-4 w-4' />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant='ghost' size='sm'>
                  <X className='h-4 w-4' />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel Onboarding?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to cancel? Any unsaved progress will
                    be lost. You can save as draft to continue later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Continue Editing</AlertDialogCancel>
                  <Button variant='outline' onClick={handleSaveDraft}>
                    Save & Exit
                  </Button>
                  <AlertDialogAction onClick={handleCancel}>
                    Discard & Exit
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Step Content */}
        <main
          className='flex-1 overflow-y-auto'
          role='main'
          aria-label={`Step ${currentStep}: ${currentStepTitle}`}
        >
          <div
            ref={stepContentRef}
            className={cn(
              'mx-auto w-full max-w-4xl p-4 lg:p-8',
              'min-h-[400px]'
            )}
            role='region'
            aria-labelledby='step-content-heading'
          >
            {/* UX Enhancement: Draft recovery banner */}
            {showDraftRecoveredBanner && (
              <DraftRecoveryBanner
                onDismiss={() => setShowDraftRecoveredBanner(false)}
                lastSavedAt={lastSavedAt}
              />
            )}

            {/* Accessibility: Hidden heading for screen readers */}
            <h2 id='step-content-heading' className='sr-only'>
              {currentStepTitle} - Step {currentStep} of {totalSteps}
              {currentStepData?.isOptional ? ' (Optional)' : ' (Required)'}
            </h2>
            <Suspense fallback={<StepLoadingFallback />}>
              {renderStep()}
            </Suspense>

            {/* Validation Error Summary - shown when there are errors */}
            <ValidationErrorSummary errors={validationErrors} />
          </div>
        </main>

        {/* Navigation Footer */}
        <footer
          className='bg-background sticky bottom-0 border-t px-4 py-4 lg:px-8'
          role='navigation'
          aria-label='Wizard navigation'
        >
          <div className='mx-auto flex max-w-4xl items-center justify-between'>
            {/* Desktop: Keyboard shortcuts help */}
            <div className='hidden lg:block'>
              <KeyboardShortcutsHelp />
            </div>
            <div className='flex-1'>
              <WizardNavigation
                currentStep={currentStep}
                totalSteps={totalSteps}
                onPrevious={prevStep}
                onNext={handleNext}
                onSaveDraft={handleSaveDraft}
                onSubmit={handleSubmit}
                isSubmitting={isSubmitting}
                isFirstStep={currentStep === 1}
                isLastStep={currentStep === totalSteps}
                canProceed={currentStep === totalSteps ? validateAll() : true}
                isOptionalStep={isOptionalStep}
                onSkip={handleSkip}
              />
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default OnboardingWizard

// Created and developed by Jai Singh
