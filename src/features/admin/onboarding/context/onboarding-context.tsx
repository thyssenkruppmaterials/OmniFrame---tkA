/**
 * Employee Onboarding Context
 * Created: December 22, 2025
 * Updated: February 1, 2026
 * Purpose: Wizard state management with draft persistence
 *
 * Accessibility Features:
 * - Focus management on step transitions
 * - Step focus ref export for screen reader support
 *
 * Auto-Save Optimization (February 1, 2026):
 * - Change detection to prevent unnecessary saves
 * - Debounced saves (2s) on state changes
 * - Fallback interval saves (60s) for safety
 * - requestIdleCallback for non-blocking saves
 * - Visual status indicator for save state
 */
import React, {
  RefObject,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { z } from 'zod'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import {
  OnboardingService,
  getNetworkErrorMessage,
} from '../services/onboarding.service'
import {
  CertificationData,
  DeviceData,
  GeneratedCredentials,
  ONBOARDING_STEPS,
  OnboardingContextValue,
  OnboardingSubmitResult,
  OnboardingWizardState,
  ValidationError,
  ValidationResult,
  authenticationSetupSchema,
  getDefaultWizardState,
  personalInfoSchema,
  positionAssignmentSchema,
  roleAssignmentSchema,
  shiftScheduleSchema,
  workingAreaSchema,
} from '../types/onboarding.types'

// Action types
type OnboardingAction =
  | { type: 'SET_STEP'; step: number }
  | { type: 'UPDATE_DATA'; key: keyof OnboardingWizardState; data: unknown }
  | { type: 'ADD_CERTIFICATION'; certification: CertificationData }
  | {
      type: 'UPDATE_CERTIFICATION'
      index: number
      certification: CertificationData
    }
  | { type: 'REMOVE_CERTIFICATION'; index: number }
  | { type: 'ADD_DEVICE'; device: DeviceData }
  | { type: 'UPDATE_DEVICE'; index: number; device: DeviceData }
  | { type: 'REMOVE_DEVICE'; index: number }
  | { type: 'SET_VALIDATION'; step: number; isValid: boolean }
  | { type: 'SET_SUBMITTING'; isSubmitting: boolean }
  | { type: 'SET_DRAFT_SAVED'; savedAt: string }
  | { type: 'SET_SESSION_ID'; sessionId: string }
  | { type: 'SET_CREDENTIALS'; credentials: GeneratedCredentials }
  | { type: 'LOAD_STATE'; state: OnboardingWizardState }
  | { type: 'RESET' }

// Reducer
function onboardingReducer(
  state: OnboardingWizardState,
  action: OnboardingAction
): OnboardingWizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, currentStep: action.step }

    case 'UPDATE_DATA':
      return { ...state, [action.key]: action.data }

    case 'ADD_CERTIFICATION':
      return {
        ...state,
        certifications: [
          ...state.certifications,
          { ...action.certification, id: crypto.randomUUID() },
        ],
      }

    case 'UPDATE_CERTIFICATION':
      return {
        ...state,
        certifications: state.certifications.map((cert, i) =>
          i === action.index ? action.certification : cert
        ),
      }

    case 'REMOVE_CERTIFICATION':
      return {
        ...state,
        certifications: state.certifications.filter(
          (_, i) => i !== action.index
        ),
      }

    case 'ADD_DEVICE':
      return {
        ...state,
        devices: [
          ...state.devices,
          { ...action.device, id: crypto.randomUUID() },
        ],
      }

    case 'UPDATE_DEVICE':
      return {
        ...state,
        devices: state.devices.map((device, i) =>
          i === action.index ? action.device : device
        ),
      }

    case 'REMOVE_DEVICE':
      return {
        ...state,
        devices: state.devices.filter((_, i) => i !== action.index),
      }

    case 'SET_VALIDATION':
      return {
        ...state,
        stepsValidation: {
          ...state.stepsValidation,
          [action.step]: action.isValid,
        },
      }

    case 'SET_SUBMITTING':
      return { ...state, isSubmitting: action.isSubmitting }

    case 'SET_DRAFT_SAVED':
      return { ...state, isDraftSaved: true, lastSavedAt: action.savedAt }

    case 'SET_SESSION_ID':
      return { ...state, sessionId: action.sessionId }

    case 'SET_CREDENTIALS':
      return {
        ...state,
        generatedCredentials: action.credentials,
        createdUserId: action.credentials?.userId,
      }

    case 'LOAD_STATE':
      return { ...action.state }

    case 'RESET':
      return getDefaultWizardState()

    default:
      return state
  }
}

// Extended context type with accessibility features
interface ExtendedOnboardingContextValue extends OnboardingContextValue {
  /** Ref to focus when step changes - should be attached to step heading or first focusable element */
  stepFocusRef: RefObject<HTMLElement | null>
  /** Flag indicating a step transition just occurred - useful for triggering focus */
  shouldFocusStep: boolean
  /** Clear the focus flag after handling */
  clearFocusFlag: () => void
  /** Get the current step title for announcements */
  getCurrentStepTitle: () => string
  /** Current auto-save status for UI feedback */
  autoSaveStatus: AutoSaveStatus
  /** Timestamp of last successful auto-save */
  lastAutoSaveAt: string | null
}

// Context
const OnboardingContext = createContext<ExtendedOnboardingContextValue | null>(
  null
)

// Local storage key
const DRAFT_STORAGE_KEY = 'onboarding_wizard_draft'
const DRAFT_TTL_HOURS = 24

// Auto-save timing constants
const DEBOUNCE_DELAY_MS = 2000 // 2 seconds after last change
const FALLBACK_INTERVAL_MS = 60000 // 60 seconds fallback interval

// Auto-save status type for UI feedback
export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

// ===== NETWORK STATUS UTILITIES =====

/**
 * Check if the browser is online before making network requests
 * Shows a toast message if offline
 * @returns true if online, false if offline
 */
function checkOnlineStatus(): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    toast.error(
      'You appear to be offline. Please check your internet connection.'
    )
    return false
  }
  return true
}

// Provider
interface OnboardingProviderProps {
  children: React.ReactNode
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const { authState } = useUnifiedAuth()
  const user = authState.user
  const profile = authState.profile
  const [state, dispatch] = useReducer(
    onboardingReducer,
    getDefaultWizardState()
  )
  const isInitializedRef = useRef(false)

  // ===== AUTO-SAVE OPTIMIZATION =====
  // Change detection - track last saved state to prevent unnecessary saves
  const lastSavedStateRef = useRef<string | null>(null)

  // Debounced save timer
  const debouncedSaveRef = useRef<NodeJS.Timeout | null>(null)

  // Fallback interval save timer
  const intervalSaveRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-save status for UI feedback
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle')
  const [lastAutoSaveAt, setLastAutoSaveAt] = useState<string | null>(null)

  // Accessibility: Focus management for step transitions
  const stepFocusRef = useRef<HTMLElement>(null)
  const [shouldFocusStep, setShouldFocusStep] = useState(false)

  /** Clear the focus flag after the wizard component handles it */
  const clearFocusFlag = useCallback(() => {
    setShouldFocusStep(false)
  }, [])

  /** Get current step title for screen reader announcements */
  const getCurrentStepTitle = useCallback((): string => {
    const step = ONBOARDING_STEPS.find((s) => s.id === state.currentStep)
    return step?.title || `Step ${state.currentStep}`
  }, [state.currentStep])

  // Get organization ID
  const organizationId = profile?.organization_id

  // ===== OPTIMIZED AUTO-SAVE HELPER FUNCTIONS =====

  /**
   * Check if there's meaningful data worth saving
   */
  const hasDataToSave = useCallback(
    (stateToCheck: OnboardingWizardState): boolean => {
      return stateToCheck.currentStep > 1 || !!stateToCheck.personalInfo
    },
    []
  )

  /**
   * Generate a serialized state string for comparison (only saveable fields)
   */
  const getSerializableState = useCallback(
    (stateToSerialize: OnboardingWizardState): string => {
      return JSON.stringify({
        currentStep: stateToSerialize.currentStep,
        personalInfo: stateToSerialize.personalInfo,
        authenticationSetup: stateToSerialize.authenticationSetup,
        roleAssignment: stateToSerialize.roleAssignment,
        positionAssignment: stateToSerialize.positionAssignment,
        shiftSchedule: stateToSerialize.shiftSchedule,
        workingArea: stateToSerialize.workingArea,
        certifications: stateToSerialize.certifications,
        devices: stateToSerialize.devices,
      })
    },
    []
  )

  // Initialize - check for existing draft in localStorage
  useEffect(() => {
    if (isInitializedRef.current) return
    isInitializedRef.current = true

    const storedDraft = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (storedDraft) {
      try {
        const parsed = JSON.parse(storedDraft)
        const savedAt = new Date(parsed.savedAt)
        const now = new Date()
        const hoursOld = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60)

        if (hoursOld < DRAFT_TTL_HOURS && parsed.state) {
          dispatch({ type: 'LOAD_STATE', state: parsed.state })

          // Initialize change detection with loaded state to prevent immediate re-save
          lastSavedStateRef.current = getSerializableState(parsed.state)
          setLastAutoSaveAt(parsed.savedAt)

          toast.info('Recovered unsaved onboarding draft')
        } else {
          localStorage.removeItem(DRAFT_STORAGE_KEY)
        }
      } catch (error) {
        logger.error('Failed to parse stored draft:', error)
        localStorage.removeItem(DRAFT_STORAGE_KEY)
      }
    }
  }, [getSerializableState])

  // ===== OPTIMIZED AUTO-SAVE IMPLEMENTATION =====

  /**
   * Non-blocking save to localStorage using requestIdleCallback
   * Falls back to setTimeout for browsers without requestIdleCallback support
   */
  const saveToLocalStorage = useCallback(
    (stateToSave: OnboardingWizardState) => {
      const performSave = () => {
        const currentStateString = getSerializableState(stateToSave)

        // Skip if no changes detected
        if (currentStateString === lastSavedStateRef.current) {
          setAutoSaveStatus('idle')
          return
        }

        setAutoSaveStatus('saving')

        try {
          const savedAt = new Date().toISOString()
          const draftData = {
            savedAt,
            state: stateToSave,
          }
          localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData))

          // Update tracking refs
          lastSavedStateRef.current = currentStateString
          setLastAutoSaveAt(savedAt)
          setAutoSaveStatus('saved')

          // Reset status to idle after a brief display period
          setTimeout(() => {
            setAutoSaveStatus((prev) => (prev === 'saved' ? 'idle' : prev))
          }, 2000)
        } catch (error) {
          logger.error('Failed to save to localStorage:', error)
          setAutoSaveStatus('error')

          // Reset error status after a brief display period
          setTimeout(() => {
            setAutoSaveStatus((prev) => (prev === 'error' ? 'idle' : prev))
          }, 3000)
        }
      }

      // Use requestIdleCallback if available for non-blocking saves
      if ('requestIdleCallback' in window) {
        ;(
          window as typeof window & {
            requestIdleCallback: (
              cb: IdleRequestCallback,
              opts?: IdleRequestOptions
            ) => number
          }
        ).requestIdleCallback(performSave, { timeout: 1000 })
      } else {
        // Fallback to setTimeout for browsers without requestIdleCallback
        setTimeout(performSave, 0)
      }
    },
    [getSerializableState]
  )

  /**
   * Debounced auto-save effect - triggers 2 seconds after user stops making changes
   */
  useEffect(() => {
    // Skip if no data worth saving
    if (!hasDataToSave(state)) {
      return
    }

    // Indicate pending save
    setAutoSaveStatus('pending')

    // Clear previous debounced timer
    if (debouncedSaveRef.current) {
      clearTimeout(debouncedSaveRef.current)
    }

    // Set new debounced save
    debouncedSaveRef.current = setTimeout(() => {
      saveToLocalStorage(state)
    }, DEBOUNCE_DELAY_MS)

    return () => {
      if (debouncedSaveRef.current) {
        clearTimeout(debouncedSaveRef.current)
      }
    }
  }, [state, hasDataToSave, saveToLocalStorage])

  /**
   * Fallback interval save effect - saves every 60 seconds as safety net
   * This catches any edge cases where debounced save might miss changes
   */
  useEffect(() => {
    // Clear existing interval
    if (intervalSaveRef.current) {
      clearInterval(intervalSaveRef.current)
    }

    intervalSaveRef.current = setInterval(() => {
      if (hasDataToSave(state)) {
        // Only save if there are actual changes
        const currentStateString = getSerializableState(state)
        if (currentStateString !== lastSavedStateRef.current) {
          saveToLocalStorage(state)
        }
      }
    }, FALLBACK_INTERVAL_MS)

    return () => {
      if (intervalSaveRef.current) {
        clearInterval(intervalSaveRef.current)
      }
    }
  }, [state, hasDataToSave, getSerializableState, saveToLocalStorage])

  // Navigation with accessibility focus management
  const goToStep = useCallback(
    (step: number) => {
      if (step >= 1 && step <= state.totalSteps && step !== state.currentStep) {
        dispatch({ type: 'SET_STEP', step })
        // Trigger focus management on step change
        setShouldFocusStep(true)
      }
    },
    [state.totalSteps, state.currentStep]
  )

  const nextStep = useCallback(() => {
    if (state.currentStep < state.totalSteps) {
      dispatch({ type: 'SET_STEP', step: state.currentStep + 1 })
      // Trigger focus management on step change
      setShouldFocusStep(true)
    }
  }, [state.currentStep, state.totalSteps])

  const prevStep = useCallback(() => {
    if (state.currentStep > 1) {
      dispatch({ type: 'SET_STEP', step: state.currentStep - 1 })
      // Trigger focus management on step change
      setShouldFocusStep(true)
    }
  }, [state.currentStep])

  // Data management
  const updateStepData = useCallback(
    <K extends keyof OnboardingWizardState>(
      key: K,
      data: OnboardingWizardState[K]
    ) => {
      dispatch({ type: 'UPDATE_DATA', key, data })
    },
    []
  )

  // Certifications
  const addCertification = useCallback((cert: CertificationData) => {
    dispatch({ type: 'ADD_CERTIFICATION', certification: cert })
  }, [])

  const updateCertification = useCallback(
    (index: number, cert: CertificationData) => {
      dispatch({ type: 'UPDATE_CERTIFICATION', index, certification: cert })
    },
    []
  )

  const removeCertification = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_CERTIFICATION', index })
  }, [])

  // Devices
  const addDevice = useCallback((device: DeviceData) => {
    dispatch({ type: 'ADD_DEVICE', device })
  }, [])

  const updateDevice = useCallback((index: number, device: DeviceData) => {
    dispatch({ type: 'UPDATE_DEVICE', index, device })
  }, [])

  const removeDevice = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_DEVICE', index })
  }, [])

  // Draft management
  const saveDraft = useCallback(async () => {
    if (!organizationId || !user?.id) {
      toast.error('Organization not found')
      return
    }

    // Check network status before attempting save
    if (!checkOnlineStatus()) {
      // Still save to localStorage as fallback when offline
      const savedAt = new Date().toISOString()
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          savedAt,
          state,
          offlineSave: true,
        })
      )
      toast.warning('Saved locally. Will sync when back online.')
      return
    }

    try {
      let sessionId = state.sessionId

      // Create session if it doesn't exist
      if (!sessionId) {
        const session = await OnboardingService.createSession(
          organizationId,
          user.id
        )
        sessionId = session.id
        dispatch({ type: 'SET_SESSION_ID', sessionId })
      }

      // Save to database
      await OnboardingService.saveDraft(sessionId, state)

      const savedAt = new Date().toISOString()
      dispatch({ type: 'SET_DRAFT_SAVED', savedAt })

      // Also save to localStorage as backup
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          savedAt,
          state: { ...state, sessionId },
        })
      )

      toast.success('Draft saved successfully')
    } catch (error) {
      logger.error('Failed to save draft:', error)

      // Get user-friendly error message
      const errorMessage = getNetworkErrorMessage(error)
      toast.error(`Failed to save draft: ${errorMessage}`)

      // Save to localStorage as fallback on network errors
      const savedAt = new Date().toISOString()
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          savedAt,
          state,
          offlineSave: true,
        })
      )
      toast.info('Draft saved locally as backup')
    }
  }, [state, organizationId, user?.id])

  const loadDraft = useCallback(async (sessionId: string) => {
    // Check network status before attempting load
    if (!checkOnlineStatus()) {
      // Try to load from localStorage as fallback
      const storedDraft = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (storedDraft) {
        try {
          const parsed = JSON.parse(storedDraft)
          if (parsed.state && parsed.state.sessionId === sessionId) {
            dispatch({ type: 'LOAD_STATE', state: parsed.state })
            toast.info('Loaded cached version (offline mode)')
            return
          }
        } catch {
          // Ignore parse errors
        }
      }
      toast.error('Cannot load draft while offline')
      return
    }

    try {
      const loadedState = await OnboardingService.loadDraft(sessionId)
      if (loadedState) {
        dispatch({ type: 'LOAD_STATE', state: loadedState })
        toast.success('Draft loaded successfully')
      } else {
        toast.error('Draft not found')
      }
    } catch (error) {
      logger.error('Failed to load draft:', error)
      // Use user-friendly error message
      const errorMessage = getNetworkErrorMessage(error)
      toast.error(`Failed to load draft: ${errorMessage}`)
    }
  }, [])

  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    lastSavedStateRef.current = null
    setAutoSaveStatus('idle')
    setLastAutoSaveAt(null)
    dispatch({ type: 'RESET' })
  }, [])

  // Validation - returns detailed error information
  const validateStep = useCallback(
    (step: number): ValidationResult => {
      const errors: ValidationError[] = []

      try {
        switch (step) {
          case 1:
            if (!state.personalInfo) {
              return {
                isValid: false,
                errors: [
                  {
                    field: 'form',
                    message: 'Please fill out the personal information form',
                  },
                ],
              }
            }
            personalInfoSchema.parse(state.personalInfo)
            break

          case 2:
            if (!state.authenticationSetup) {
              return {
                isValid: false,
                errors: [
                  {
                    field: 'form',
                    message: 'Please configure authentication settings',
                  },
                ],
              }
            }
            authenticationSetupSchema.parse(state.authenticationSetup)
            break

          case 3:
            if (!state.roleAssignment) {
              return {
                isValid: false,
                errors: [
                  {
                    field: 'form',
                    message: 'Please select a role for the employee',
                  },
                ],
              }
            }
            roleAssignmentSchema.parse(state.roleAssignment)
            break

          case 4:
            if (!state.positionAssignment) {
              return {
                isValid: false,
                errors: [
                  {
                    field: 'form',
                    message: 'Please assign a position to the employee',
                  },
                ],
              }
            }
            positionAssignmentSchema.parse(state.positionAssignment)
            break

          case 5:
            if (!state.shiftSchedule) {
              return {
                isValid: false,
                errors: [
                  {
                    field: 'form',
                    message: 'Please configure the shift schedule',
                  },
                ],
              }
            }
            shiftScheduleSchema.parse(state.shiftSchedule)
            break

          case 6:
            if (!state.workingArea) {
              return {
                isValid: false,
                errors: [
                  { field: 'form', message: 'Please select a working area' },
                ],
              }
            }
            workingAreaSchema.parse(state.workingArea)
            break

          case 7:
            // Certifications are optional - always valid
            return { isValid: true, errors: [] }

          case 8:
            // Devices are optional - always valid
            return { isValid: true, errors: [] }

          case 9: {
            // Review step - validate all required steps and collect all errors
            const allErrors: ValidationError[] = []
            for (let i = 1; i <= 6; i++) {
              const result = validateStep(i)
              if (!result.isValid) {
                const stepName =
                  ONBOARDING_STEPS.find((s) => s.id === i)?.title || `Step ${i}`
                result.errors.forEach((e) => {
                  allErrors.push({
                    field: `step${i}.${e.field}`,
                    message: `${stepName}: ${e.message}`,
                  })
                })
              }
            }
            if (allErrors.length > 0) {
              return { isValid: false, errors: allErrors }
            }
            return { isValid: true, errors: [] }
          }

          default:
            return {
              isValid: false,
              errors: [{ field: 'step', message: 'Invalid step number' }],
            }
        }

        // If we reach here, validation passed
        return { isValid: true, errors: [] }
      } catch (error) {
        // Extract detailed errors from Zod validation
        if (error instanceof z.ZodError) {
          const zodError = error as z.ZodError
          zodError.issues.forEach((e) => {
            errors.push({
              field: e.path.join('.') || 'form',
              message: e.message,
            })
          })
        } else {
          errors.push({
            field: 'form',
            message: 'Validation failed. Please check your input.',
          })
        }
        return { isValid: false, errors }
      }
    },
    [state]
  )

  // Convenience method for boolean validation checks (backward compatibility)
  const isStepValid = useCallback(
    (step: number): boolean => {
      return validateStep(step).isValid
    },
    [validateStep]
  )

  // Get error messages for a specific step
  const getStepErrors = useCallback(
    (step: number): string[] => {
      const result = validateStep(step)
      return result.errors.map((e) => e.message)
    },
    [validateStep]
  )

  const validateAll = useCallback((): boolean => {
    for (let step = 1; step <= 6; step++) {
      if (!isStepValid(step)) {
        return false
      }
    }
    return true
  }, [isStepValid])

  // Submission
  const submitOnboarding =
    useCallback(async (): Promise<OnboardingSubmitResult> => {
      // Check network status first - submission requires network
      if (!checkOnlineStatus()) {
        return {
          success: false,
          userId: '',
          profileId: '',
          credentials: {
            userId: '',
            email: '',
            password: '',
            badgeNumber: '',
            loginUrl: '',
          },
          errors: [
            'You appear to be offline. Please check your connection and try again.',
          ],
        }
      }

      if (!organizationId) {
        return {
          success: false,
          userId: '',
          profileId: '',
          credentials: {
            userId: '',
            email: '',
            password: '',
            badgeNumber: '',
            loginUrl: '',
          },
          errors: ['Organization not found'],
        }
      }

      if (!validateAll()) {
        return {
          success: false,
          userId: '',
          profileId: '',
          credentials: {
            userId: '',
            email: '',
            password: '',
            badgeNumber: '',
            loginUrl: '',
          },
          errors: ['Please complete all required fields'],
        }
      }

      dispatch({ type: 'SET_SUBMITTING', isSubmitting: true })

      try {
        let sessionId = state.sessionId

        // Create session if needed
        if (!sessionId && user?.id) {
          const session = await OnboardingService.createSession(
            organizationId,
            user.id
          )
          sessionId = session.id
          dispatch({ type: 'SET_SESSION_ID', sessionId })
        }

        if (!sessionId) {
          throw new Error('Failed to create onboarding session')
        }

        const result = await OnboardingService.submitOnboarding(
          sessionId,
          state,
          organizationId
        )

        if (result.success) {
          dispatch({ type: 'SET_CREDENTIALS', credentials: result.credentials })
          localStorage.removeItem(DRAFT_STORAGE_KEY)
          toast.success('Employee onboarded successfully!')
        } else {
          // Use network error message utility for better error messages
          const errorMessage = result.errors?.[0] || 'Onboarding failed'
          toast.error(errorMessage)
        }

        return result
      } catch (error) {
        logger.error('Submission error:', error)
        // Use getNetworkErrorMessage for user-friendly error messages
        const errorMessage = getNetworkErrorMessage(error)
        toast.error(`Onboarding failed: ${errorMessage}`)
        return {
          success: false,
          userId: '',
          profileId: '',
          credentials: {
            userId: '',
            email: '',
            password: '',
            badgeNumber: '',
            loginUrl: '',
          },
          errors: [errorMessage],
        }
      } finally {
        dispatch({ type: 'SET_SUBMITTING', isSubmitting: false })
      }
    }, [state, organizationId, user?.id, validateAll])

  // Reset
  const resetWizard = useCallback(() => {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    lastSavedStateRef.current = null
    setAutoSaveStatus('idle')
    setLastAutoSaveAt(null)
    dispatch({ type: 'RESET' })
  }, [])

  const contextValue = useMemo<ExtendedOnboardingContextValue>(
    () => ({
      // State values
      state,
      autoSaveStatus,
      lastAutoSaveAt,
      stepFocusRef,
      shouldFocusStep,

      // Navigation (all useCallback already)
      goToStep,
      nextStep,
      prevStep,

      // Data management (all useCallback already)
      updateStepData,
      addCertification,
      updateCertification,
      removeCertification,
      addDevice,
      updateDevice,
      removeDevice,

      // Draft management (all useCallback already)
      saveDraft,
      loadDraft,
      clearDraft,

      // Validation (all useCallback already)
      validateStep,
      validateAll,
      isStepValid,
      getStepErrors,

      // Submission (all useCallback already)
      submitOnboarding,

      // Reset (all useCallback already)
      resetWizard,

      // Focus management
      clearFocusFlag,
      getCurrentStepTitle,
    }),
    [
      state,
      autoSaveStatus,
      lastAutoSaveAt,
      stepFocusRef,
      shouldFocusStep,
      goToStep,
      nextStep,
      prevStep,
      updateStepData,
      addCertification,
      updateCertification,
      removeCertification,
      addDevice,
      updateDevice,
      removeDevice,
      saveDraft,
      loadDraft,
      clearDraft,
      validateStep,
      validateAll,
      isStepValid,
      getStepErrors,
      submitOnboarding,
      resetWizard,
      clearFocusFlag,
      getCurrentStepTitle,
    ]
  )

  return (
    <OnboardingContext.Provider value={contextValue}>
      {children}
    </OnboardingContext.Provider>
  )
}

// Hook with extended accessibility features
export function useOnboarding(): ExtendedOnboardingContextValue {
  const context = useContext(OnboardingContext)
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider')
  }
  return context
}

export default OnboardingProvider
