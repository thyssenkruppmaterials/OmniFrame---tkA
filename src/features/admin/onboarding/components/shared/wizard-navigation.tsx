// Created and developed by Jai Singh
/**
 * Wizard Navigation Component
 * Provides navigation buttons for the onboarding wizard
 * Updated: February 1, 2026
 *
 * Accessibility Features:
 * - Descriptive ARIA labels for all navigation buttons
 * - Loading state announcements
 * - Keyboard navigation support
 * - Clear action descriptions for screen readers
 * - Skip button for optional steps (7 & 8)
 */
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Save,
  Send,
  SkipForward,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface WizardNavigationProps {
  currentStep: number
  totalSteps: number
  onPrevious: () => void
  onNext: () => void
  onSaveDraft: () => void
  onSubmit: () => void
  isSubmitting?: boolean
  isFirstStep?: boolean
  isLastStep?: boolean
  canProceed?: boolean
  showSaveDraft?: boolean
  /** Whether the current step is optional (enables Skip button) */
  isOptionalStep?: boolean
  /** Callback when Skip button is clicked */
  onSkip?: () => void
}

export function WizardNavigation({
  currentStep,
  totalSteps,
  onPrevious,
  onNext,
  onSaveDraft,
  onSubmit,
  isSubmitting = false,
  isFirstStep = currentStep === 1,
  isLastStep = currentStep === totalSteps,
  canProceed = true,
  showSaveDraft = true,
  isOptionalStep = false,
  onSkip,
}: WizardNavigationProps) {
  return (
    <TooltipProvider>
      <div
        className='mt-6 flex items-center justify-between border-t pt-4'
        role='group'
        aria-label='Wizard navigation controls'
      >
        {/* Left side - Previous button */}
        <div className='flex items-center gap-2'>
          {!isFirstStep && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type='button'
                  variant='outline'
                  onClick={onPrevious}
                  disabled={isSubmitting}
                  aria-label={`Go to previous step (Step ${currentStep - 1} of ${totalSteps})`}
                  aria-keyshortcuts='Alt+Left'
                >
                  <ChevronLeft className='mr-2 h-4 w-4' aria-hidden='true' />
                  Previous
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top' className='text-xs'>
                <p>Alt + Left Arrow</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Placeholder for layout when on first step */}
          {isFirstStep && (
            <span className='sr-only'>
              First step, no previous navigation available
            </span>
          )}
        </div>

        {/* Right side - Save Draft + Skip + Next/Submit */}
        <div
          className='flex items-center gap-2'
          role='group'
          aria-label='Primary actions'
        >
          {showSaveDraft && !isLastStep && (
            <Button
              type='button'
              variant='ghost'
              onClick={onSaveDraft}
              disabled={isSubmitting}
              aria-label='Save current progress as draft'
              aria-describedby='save-draft-hint'
            >
              <Save className='mr-2 h-4 w-4' aria-hidden='true' />
              Save Draft
            </Button>
          )}
          {/* Hidden hint for save draft */}
          {showSaveDraft && !isLastStep && (
            <span id='save-draft-hint' className='sr-only'>
              Your progress will be saved and you can continue later
            </span>
          )}

          {/* Skip button for optional steps */}
          {isOptionalStep && !isLastStep && onSkip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={onSkip}
                  disabled={isSubmitting}
                  aria-label='Skip this optional step and continue to the next step'
                  className='text-muted-foreground hover:text-foreground'
                >
                  <SkipForward className='mr-2 h-4 w-4' aria-hidden='true' />
                  Skip this step
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top' className='max-w-[200px] text-xs'>
                <p>
                  This step is optional. You can complete it later from the
                  employee's profile.
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {isLastStep ? (
            <>
              <Button
                type='button'
                onClick={onSubmit}
                disabled={isSubmitting || !canProceed}
                className='min-w-[140px]'
                aria-label={
                  isSubmitting
                    ? 'Creating employee account, please wait'
                    : canProceed
                      ? 'Complete employee onboarding and create account'
                      : 'Cannot complete onboarding, please fill all required fields'
                }
                aria-busy={isSubmitting}
                aria-disabled={!canProceed}
              >
                {isSubmitting ? (
                  <>
                    <Loader2
                      className='mr-2 h-4 w-4 animate-spin'
                      aria-hidden='true'
                    />
                    <span aria-live='polite'>Creating...</span>
                  </>
                ) : (
                  <>
                    <Send className='mr-2 h-4 w-4' aria-hidden='true' />
                    Complete Onboarding
                  </>
                )}
              </Button>
              {/* Screen reader announcement for submission status */}
              {isSubmitting && (
                <span className='sr-only' role='status' aria-live='assertive'>
                  Creating employee account. Please wait.
                </span>
              )}
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type='button'
                  onClick={onNext}
                  disabled={isSubmitting || !canProceed}
                  aria-label={`Go to next step (Step ${currentStep + 1} of ${totalSteps})`}
                  aria-keyshortcuts='Alt+Right'
                  aria-disabled={!canProceed}
                >
                  Next
                  <ChevronRight className='ml-2 h-4 w-4' aria-hidden='true' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top' className='text-xs'>
                <p>Alt + Right Arrow</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

export default WizardNavigation

// Created and developed by Jai Singh
