// Created and developed by Jai Singh
/**
 * Step Indicator Components
 * Modern vertical sidebar design inspired by Stripe checkout
 * Updated: February 1, 2026
 *
 * Accessibility Features:
 * - Comprehensive ARIA labels with step status (completed, current, optional)
 * - aria-current="step" for current step
 * - aria-disabled for non-clickable steps
 * - Keyboard navigation hints via aria-keyshortcuts
 * - Screen reader instructions for navigation
 */
import {
  Award,
  Briefcase,
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  Key,
  MapPin,
  Shield,
  Smartphone,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ONBOARDING_STEPS } from '../../types/onboarding.types'

// Icon mapping
const STEP_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  User,
  Key,
  Shield,
  Briefcase,
  Clock,
  MapPin,
  Award,
  Smartphone,
  CheckCircle,
}

interface StepIndicatorProps {
  currentStep: number
  stepsValidation: Record<number, boolean>
  onStepClick?: (step: number) => void
}

/**
 * Vertical Step Indicator for Desktop Sidebar
 * Stripe-style vertical progress with connecting lines
 */
export function VerticalStepIndicator({
  currentStep,
  stepsValidation,
  onStepClick,
}: StepIndicatorProps) {
  // Calculate completion status for announcements
  const completedStepsCount =
    Object.values(stepsValidation).filter(Boolean).length
  const requiredSteps = ONBOARDING_STEPS.filter((s) => !s.isOptional).length

  return (
    <nav
      className='flex w-full flex-col'
      aria-label='Onboarding progress'
      role='navigation'
    >
      {/* Screen reader instructions */}
      <div className='sr-only'>
        Navigate between steps using the step buttons below.
        {onStepClick ? 'Click completed or current steps to navigate. ' : ''}
        {completedStepsCount} of {requiredSteps} required steps completed.
      </div>
      <div className='relative'>
        {ONBOARDING_STEPS.map((step, index) => {
          const isCompleted =
            stepsValidation[step.id] === true && currentStep > step.id
          const isCurrent = currentStep === step.id
          const isUpcoming = currentStep < step.id
          const isClickable =
            onStepClick && (isCompleted || step.id <= currentStep)
          const Icon = STEP_ICONS[step.icon] || CheckCircle
          const isLastStep = index === ONBOARDING_STEPS.length - 1

          return (
            <div key={step.id} className='relative'>
              {/* Connecting Line */}
              {!isLastStep && (
                <div
                  className={cn(
                    'absolute top-12 left-5 h-[calc(100%-12px)] w-0.5',
                    isCompleted ? 'bg-primary' : 'bg-border'
                  )}
                  aria-hidden='true'
                />
              )}

              {/* Step Item */}
              <button
                type='button'
                onClick={() => isClickable && onStepClick?.(step.id)}
                disabled={!isClickable}
                className={cn(
                  'group relative -mx-2 flex w-full items-start gap-4 rounded-lg px-2 py-3 text-left transition-all duration-200',
                  isClickable && 'hover:bg-accent/50 cursor-pointer',
                  !isClickable && 'cursor-default',
                  isCurrent && 'bg-accent/30'
                )}
                aria-label={`${step.title}${step.isOptional ? ', optional step' : ', required step'}${isCompleted ? ', completed' : ''}${isCurrent ? ', current step' : ''}${isUpcoming ? ', not yet available' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
                aria-disabled={!isClickable}
                aria-describedby={`step-${step.id}-description`}
              >
                {/* Step Circle with Icon */}
                <div
                  className={cn(
                    'relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200',
                    isCompleted &&
                      'border-primary bg-primary text-primary-foreground',
                    isCurrent &&
                      'border-primary bg-primary/10 text-primary ring-primary/20 ring-4',
                    isUpcoming &&
                      'border-muted-foreground/30 bg-background text-muted-foreground/50',
                    isClickable &&
                      !isCurrent &&
                      'group-hover:border-primary/70 group-hover:bg-primary/5'
                  )}
                >
                  {isCompleted ? (
                    <Check className='h-5 w-5' strokeWidth={2.5} />
                  ) : (
                    <Icon className='h-5 w-5' />
                  )}
                </div>

                {/* Step Content */}
                <div className='min-w-0 flex-1 pt-0.5'>
                  <div className='flex items-center gap-2'>
                    <span
                      className={cn(
                        'text-sm leading-tight font-medium transition-colors',
                        isCurrent && 'text-primary font-semibold',
                        isCompleted && 'text-foreground',
                        isUpcoming && 'text-muted-foreground'
                      )}
                    >
                      {step.title}
                    </span>
                    {step.isOptional && (
                      <Badge
                        variant='secondary'
                        className={cn(
                          'h-4 px-1.5 py-0 text-[10px] font-normal',
                          isUpcoming && 'opacity-50'
                        )}
                        aria-label='Optional step'
                      >
                        Optional
                      </Badge>
                    )}
                  </div>
                  <p
                    id={`step-${step.id}-description`}
                    className={cn(
                      'mt-0.5 text-xs leading-tight',
                      isCurrent && 'text-muted-foreground',
                      isCompleted && 'text-muted-foreground/80',
                      isUpcoming && 'text-muted-foreground/50'
                    )}
                  >
                    {step.description}
                  </p>
                </div>

                {/* Chevron for clickable completed steps */}
                {isCompleted && isClickable && (
                  <ChevronRight
                    className='text-muted-foreground/50 mt-1 h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100'
                    aria-hidden='true'
                  />
                )}
              </button>
            </div>
          )
        })}
      </div>
    </nav>
  )
}

/**
 * Mobile Step Header
 * Compact horizontal progress indicator for mobile devices
 *
 * Accessibility: Enhanced with proper ARIA labels and progress announcements
 */
export function MobileStepHeader({
  currentStep,
  totalSteps,
  stepsValidation,
  onStepClick,
}: StepIndicatorProps & { totalSteps: number }) {
  const currentStepData = ONBOARDING_STEPS.find((s) => s.id === currentStep)
  const Icon = currentStepData
    ? STEP_ICONS[currentStepData.icon] || CheckCircle
    : CheckCircle
  const completedSteps = Object.values(stepsValidation).filter(Boolean).length
  const progressPercentage = Math.round(
    ((currentStep - 1) / (totalSteps - 1)) * 100
  )

  return (
    <div
      className='bg-background border-b'
      role='navigation'
      aria-label='Onboarding progress'
    >
      <div className='px-4 py-3'>
        {/* Current Step Info */}
        <div className='mb-3 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <div className='border-primary bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-full border-2'>
              <Icon className='h-5 w-5' />
            </div>
            <div>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-semibold'>
                  {currentStepData?.title}
                </span>
                {currentStepData?.isOptional && (
                  <Badge
                    variant='secondary'
                    className='h-4 px-1.5 py-0 text-[10px]'
                  >
                    Optional
                  </Badge>
                )}
              </div>
              <p className='text-muted-foreground text-xs'>
                Step {currentStep} of {totalSteps}
              </p>
            </div>
          </div>
          <span className='text-muted-foreground text-xs'>
            {completedSteps}/{totalSteps - 1} done
          </span>
        </div>

        {/* Progress Bar */}
        <div
          className='relative'
          role='progressbar'
          aria-valuenow={progressPercentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Onboarding progress: ${progressPercentage}% complete`}
        >
          {/* Background track */}
          <div
            className='bg-muted h-1.5 overflow-hidden rounded-full'
            aria-hidden='true'
          >
            {/* Completed progress */}
            <div
              className='bg-primary h-full rounded-full transition-all duration-300 ease-out'
              style={{
                width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%`,
              }}
            />
          </div>

          {/* Step dots */}
          <div className='absolute inset-0 flex items-center justify-between px-0.5'>
            {ONBOARDING_STEPS.map((step) => {
              const isCompleted =
                stepsValidation[step.id] === true && currentStep > step.id
              const isCurrent = currentStep === step.id
              const isUpcoming = currentStep < step.id
              const isClickable =
                onStepClick && (isCompleted || step.id <= currentStep)

              return (
                <button
                  key={step.id}
                  type='button'
                  onClick={() => isClickable && onStepClick?.(step.id)}
                  disabled={!isClickable}
                  className={cn(
                    'h-2.5 w-2.5 rounded-full transition-all duration-200',
                    isCompleted && 'bg-primary',
                    isCurrent &&
                      'bg-primary ring-primary/30 ring-offset-background ring-2 ring-offset-1',
                    !isCompleted && !isCurrent && 'bg-muted-foreground/30',
                    isClickable && 'cursor-pointer hover:scale-125',
                    !isClickable && 'cursor-default'
                  )}
                  aria-label={`${step.title}${step.isOptional ? ', optional' : ''}${isCompleted ? ', completed' : ''}${isCurrent ? ', current step' : ''}${isUpcoming ? ', upcoming' : ''}`}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-disabled={!isClickable}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Progress Summary for sidebar footer
 * Shows completion percentage and status
 *
 * Accessibility: Includes proper ARIA progressbar semantics
 */
export function StepProgressSummary({
  stepsValidation,
  totalSteps,
}: {
  stepsValidation: Record<number, boolean>
  totalSteps: number
}) {
  const completedCount = Object.values(stepsValidation).filter(Boolean).length
  const requiredSteps = ONBOARDING_STEPS.filter((s) => !s.isOptional).length
  const completedRequiredSteps = ONBOARDING_STEPS.filter(
    (s) => !s.isOptional && stepsValidation[s.id]
  ).length
  const percentage = Math.round((completedRequiredSteps / requiredSteps) * 100)
  const remainingRequired = requiredSteps - completedRequiredSteps

  return (
    <div
      className='mt-auto border-t pt-4'
      role='region'
      aria-label='Onboarding progress summary'
    >
      <div className='text-muted-foreground mb-2 flex items-center justify-between text-xs'>
        <span id='progress-label'>Progress</span>
        <span className='font-medium' aria-live='polite'>
          {percentage}% complete
        </span>
      </div>
      <div
        className='bg-muted h-1.5 overflow-hidden rounded-full'
        role='progressbar'
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-labelledby='progress-label'
        aria-describedby='progress-description'
      >
        <div
          className='bg-primary h-full rounded-full transition-all duration-500 ease-out'
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p
        id='progress-description'
        className='text-muted-foreground mt-2 text-[10px]'
      >
        {completedCount} of {totalSteps} steps completed ({remainingRequired}{' '}
        required remaining)
      </p>
      {/* Screen reader friendly summary */}
      <span className='sr-only' aria-live='polite'>
        {completedRequiredSteps} of {requiredSteps} required steps completed.
        {remainingRequired > 0
          ? `${remainingRequired} required steps remaining.`
          : 'All required steps completed.'}
      </span>
    </div>
  )
}

// Legacy exports for backward compatibility
export const StepIndicator = VerticalStepIndicator
export const StepIndicatorCompact = MobileStepHeader

export default VerticalStepIndicator

// Created and developed by Jai Singh
