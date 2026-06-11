// Created and developed by Jai Singh
/**
 * Employee Onboarding Feature
 * Export all components and types
 */

// Components
export { OnboardingWizard } from './components/onboarding-wizard'
export {
  StepIndicator,
  StepIndicatorCompact,
} from './components/shared/step-indicator'
export { WizardNavigation } from './components/shared/wizard-navigation'

// Steps — NOT statically exported. They are lazy-loaded via React.lazy()
// in onboarding-wizard.tsx. Static re-exports here defeat code splitting
// because Rollup must include them in the same chunk as the barrel.

// Context
export { OnboardingProvider, useOnboarding } from './context/onboarding-context'

// Services
export { OnboardingService } from './services/onboarding.service'

// Types
export * from './types/onboarding.types'

// Created and developed by Jai Singh
