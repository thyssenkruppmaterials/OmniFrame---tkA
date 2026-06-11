// Created and developed by Jai Singh
/**
 * Employee Onboarding System Types
 * Created: December 22, 2025
 * Purpose: TypeScript types for the employee onboarding wizard
 */
import { z } from 'zod'

// ===== ENUMS =====

export const OnboardingStatus = {
  DRAFT: 'draft',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const

export type OnboardingStatusType =
  (typeof OnboardingStatus)[keyof typeof OnboardingStatus]

export const CertificationType = {
  GENERAL: 'general',
  SAFETY: 'safety',
  EQUIPMENT: 'equipment',
  COMPLIANCE: 'compliance',
  TRAINING: 'training',
  FORKLIFT: 'forklift',
  HAZMAT: 'hazmat',
  FIRST_AID: 'first_aid',
  OSHA: 'osha',
} as const

export type CertificationTypeValue =
  (typeof CertificationType)[keyof typeof CertificationType]

export const DeviceType = {
  RF_TERMINAL: 'rf_terminal',
  BARCODE_SCANNER: 'barcode_scanner',
  TABLET: 'tablet',
  MOBILE: 'mobile',
  FORKLIFT: 'forklift',
  PALLET_JACK: 'pallet_jack',
  REACH_TRUCK: 'reach_truck',
  ORDER_PICKER: 'order_picker',
} as const

export type DeviceTypeValue = (typeof DeviceType)[keyof typeof DeviceType]

export const ShiftPattern = {
  FIXED: 'fixed',
  ROTATING: 'rotating',
  FLEXIBLE: 'flexible',
  ON_CALL: 'on_call',
} as const

export type ShiftPatternType = (typeof ShiftPattern)[keyof typeof ShiftPattern]

export const AssignmentType = {
  PERMANENT: 'permanent',
  TEMPORARY: 'temporary',
  SEASONAL: 'seasonal',
  CONTRACTOR: 'contractor',
} as const

export type AssignmentTypeValue =
  (typeof AssignmentType)[keyof typeof AssignmentType]

// ===== STEP DATA SCHEMAS =====

// Step 1: Personal Information
export const personalInfoSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone_number: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  employee_id: z.string().optional(), // Auto-generated or manual
  start_date: z.string().min(1, 'Start date is required'),
  department: z.string().optional(),
  avatar_url: z.string().url().optional().nullable(),
})

export type PersonalInfoData = z.infer<typeof personalInfoSchema>

// Step 2: Authentication Setup
export const authenticationSetupSchema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .optional(),
  auto_generate_password: z.boolean().default(true),
  generated_password: z.string().optional(), // Stored temporarily for display
  auto_activate: z.boolean().default(true),
  send_welcome_email: z.boolean().default(false),
})

export type AuthenticationSetupData = z.infer<typeof authenticationSetupSchema>

// Step 3: Role Assignment
export const roleAssignmentSchema = z.object({
  role_id: z.string().uuid('Please select a valid role'),
  role_name: z.string().optional(), // For display purposes
  customize_permissions: z.boolean().default(false),
  custom_permissions: z.array(z.string()).optional(),
})

export type RoleAssignmentData = z.infer<typeof roleAssignmentSchema>

// Step 4: Position Assignment
export const positionAssignmentSchema = z.object({
  position_id: z.string().uuid('Please select a valid position'),
  position_title: z.string().optional(), // For display
  // supervisor_id: Allow empty string or "__none__" for "not selected" state, transform to null for backend
  supervisor_id: z
    .string()
    .transform((val) => (val === '' || val === '__none__' ? null : val))
    .pipe(z.string().uuid('Invalid supervisor selection').nullable()),
  supervisor_name: z.string().optional(), // For display
  // team_lead_id: Allow empty string or "__none__" for "not selected" state
  team_lead_id: z
    .string()
    .transform((val) => (val === '' || val === '__none__' ? null : val))
    .pipe(z.string().uuid().nullable())
    .optional(),
  team_lead_name: z.string().optional(), // For display
  is_primary_position: z.boolean().default(true),
  assignment_type: z
    .enum(['permanent', 'temporary', 'seasonal', 'contractor'])
    .default('permanent'),
})

export type PositionAssignmentData = z.infer<typeof positionAssignmentSchema>

// Step 5: Shift Schedule
export const shiftScheduleSchema = z.object({
  shift_pattern: z
    .enum(['fixed', 'rotating', 'flexible', 'on_call'])
    .default('fixed'),
  shift_start_time: z.string().default('08:00'),
  shift_end_time: z.string().default('17:00'),
  working_days: z.array(z.number().min(1).max(7)).default([1, 2, 3, 4, 5]), // 1=Monday, 7=Sunday
  shift_schedule_id: z.string().uuid().optional().nullable(), // Link to shift template
  productivity_target: z.number().min(0).max(200).optional(),
  quality_target: z.number().min(0).max(100).optional(),
})

export type ShiftScheduleData = z.infer<typeof shiftScheduleSchema>

// Step 6: Working Area
export const workingAreaSchema = z.object({
  primary_area_id: z.string().uuid('Please select a working area'),
  primary_area_name: z.string().optional(), // For display
  secondary_areas: z
    .array(
      z.object({
        area_id: z.string().uuid(),
        area_name: z.string().optional(),
      })
    )
    .optional(),
})

export type WorkingAreaData = z.infer<typeof workingAreaSchema>

// Step 7: Certifications
export const certificationSchema = z.object({
  id: z.string().uuid().optional(), // For existing certifications
  certification_name: z.string().min(1, 'Certification name is required'),
  certification_type: z.string().default('general'),
  issuing_authority: z.string().optional(),
  certification_number: z.string().optional(),
  issue_date: z.string().optional(),
  expiration_date: z.string().optional(),
  document_url: z.string().url().optional().nullable(),
  is_required: z.boolean().default(false),
  notes: z.string().optional(),
})

export type CertificationData = z.infer<typeof certificationSchema>

export const certificationsStepSchema = z.object({
  certifications: z.array(certificationSchema).default([]),
})

export type CertificationsStepData = z.infer<typeof certificationsStepSchema>

// Step 8: Device Registration
export const deviceSchema = z.object({
  id: z.string().uuid().optional(), // For existing devices
  device_type: z.string().min(1, 'Device type is required'),
  device_name: z.string().optional(),
  device_id: z.string().optional(),
  serial_number: z.string().optional(),
  asset_tag: z.string().optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  condition: z.enum(['new', 'good', 'fair', 'poor']).default('good'),
  notes: z.string().optional(),
})

export type DeviceData = z.infer<typeof deviceSchema>

export const deviceRegistrationSchema = z.object({
  devices: z.array(deviceSchema).default([]),
})

export type DeviceRegistrationData = z.infer<typeof deviceRegistrationSchema>

// ===== COMPLETE WIZARD STATE =====

export interface OnboardingWizardState {
  // Session tracking
  sessionId: string | null
  currentStep: number
  totalSteps: number

  // Step data
  personalInfo: PersonalInfoData | null
  authenticationSetup: AuthenticationSetupData | null
  roleAssignment: RoleAssignmentData | null
  positionAssignment: PositionAssignmentData | null
  shiftSchedule: ShiftScheduleData | null
  workingArea: WorkingAreaData | null
  certifications: CertificationData[]
  devices: DeviceData[]

  // Validation state
  stepsValidation: Record<number, boolean>

  // UI state
  isSubmitting: boolean
  isDraftSaved: boolean
  lastSavedAt: string | null

  // Result
  createdUserId: string | null
  generatedCredentials: GeneratedCredentials | null
}

// ===== API TYPES =====

export interface OnboardingSession {
  id: string
  organization_id: string
  session_status: OnboardingStatusType
  current_step: number
  total_steps: number
  personal_info: PersonalInfoData | null
  authentication_setup: AuthenticationSetupData | null
  role_assignment: RoleAssignmentData | null
  position_assignment: PositionAssignmentData | null
  shift_schedule: ShiftScheduleData | null
  working_area: WorkingAreaData | null
  certifications: CertificationData[]
  device_registration: DeviceData[]
  created_user_id: string | null
  expires_at: string
  created_by: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface GeneratedCredentials {
  userId: string
  email: string
  password: string
  badgeNumber: string
  loginUrl: string
}

export interface OnboardingSubmitResult {
  success: boolean
  userId: string
  profileId: string
  credentials: GeneratedCredentials
  badgePdfUrl?: string
  errors?: string[]
}

export interface EmployeeCertification {
  id: string
  organization_id: string
  user_id: string
  certification_name: string
  certification_type: CertificationTypeValue
  issuing_authority: string | null
  certification_number: string | null
  issue_date: string | null
  expiration_date: string | null
  status: 'active' | 'expired' | 'revoked' | 'pending_renewal'
  is_required: boolean
  document_url: string | null
  notes: string | null
  verified_by: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

export interface EmployeeDevice {
  id: string
  organization_id: string
  user_id: string
  device_type: DeviceTypeValue
  device_name: string | null
  device_id: string | null
  serial_number: string | null
  asset_tag: string | null
  assignment_status:
    | 'assigned'
    | 'returned'
    | 'lost'
    | 'damaged'
    | 'maintenance'
  assigned_date: string
  return_date: string | null
  manufacturer: string | null
  model: string | null
  condition: 'new' | 'good' | 'fair' | 'poor'
  notes: string | null
  assigned_by: string | null
  created_at: string
  updated_at: string
}

export interface OnboardingChecklistItem {
  id: string
  organization_id: string
  user_id: string
  onboarding_session_id: string | null
  task_name: string
  task_category: string
  task_description: string | null
  is_completed: boolean
  is_required: boolean
  due_date: string | null
  completed_at: string | null
  assigned_to: string | null
  completed_by: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface OnboardingStatistics {
  total_onboardings: number
  completed: number
  in_progress: number
  this_month: number
  this_week: number
  average_completion_time: number | null
  by_status: Record<string, number>
  recent_onboardings: Array<{
    id: string
    employee_name: string
    status: string
    created_at: string
    completed_at: string | null
  }>
}

// ===== VALIDATION TYPES =====

/** Detailed validation error for a specific field */
export interface ValidationError {
  /** Field path (e.g., 'first_name', 'email', 'roleAssignment.role_id') */
  field: string
  /** Human-readable error message */
  message: string
}

/** Result of step validation with detailed error information */
export interface ValidationResult {
  /** Whether the step passed validation */
  isValid: boolean
  /** Array of validation errors (empty if valid) */
  errors: ValidationError[]
}

// ===== CONTEXT TYPES =====

export interface OnboardingContextValue {
  // State
  state: OnboardingWizardState

  // Navigation
  goToStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void

  // Data management
  updateStepData: <K extends keyof OnboardingWizardState>(
    key: K,
    data: OnboardingWizardState[K]
  ) => void

  // Certifications & Devices
  addCertification: (cert: CertificationData) => void
  updateCertification: (index: number, cert: CertificationData) => void
  removeCertification: (index: number) => void
  addDevice: (device: DeviceData) => void
  updateDevice: (index: number, device: DeviceData) => void
  removeDevice: (index: number) => void

  // Draft management
  saveDraft: () => Promise<void>
  loadDraft: (sessionId: string) => Promise<void>
  clearDraft: () => void

  // Validation
  /** Validate a step and return detailed error information */
  validateStep: (step: number) => ValidationResult
  /** Convenience method to check if a step is valid (boolean) */
  isStepValid: (step: number) => boolean
  /** Get error messages for a specific step */
  getStepErrors: (step: number) => string[]
  /** Validate all required steps */
  validateAll: () => boolean

  // Submission
  submitOnboarding: () => Promise<OnboardingSubmitResult>

  // Reset
  resetWizard: () => void
}

// ===== FORM REFS =====

export interface StepFormRef {
  validate: () => boolean
  getData: () => Record<string, unknown>
}

// ===== LOOKUP TYPES =====

export interface RoleOption {
  id: string
  name: string
  display_name: string
  description: string | null
  is_system: boolean
}

export interface PositionOption {
  id: string
  position_code: string
  position_title: string
  position_type: string
  position_level: number
  department: string | null
  is_supervisory: boolean
  headcount_budget: number
  current_headcount: number
}

export interface WorkingAreaOption {
  id: string
  area_code: string
  area_name: string
  area_type: string
  capacity: number | null
  requires_certification: boolean
  is_active: boolean
  primary_supervisor_id: string | null
  backup_supervisor_id: string | null
  primary_supervisor_name?: string | null
  backup_supervisor_name?: string | null
}

export interface AvailableUserOption {
  id: string
  full_name: string
  email: string
  position_title?: string | null
}

export interface SupervisorOption {
  id: string
  full_name: string
  email: string
  position_title: string | null
  department: string | null
}

export interface ShiftScheduleOption {
  id: string
  schedule_name: string
  schedule_code: string | null
  schedule_type: string
  shift_start_time: string
  shift_end_time: string
  operating_days: number[]
}

// ===== STEP DEFINITIONS =====

export interface StepDefinition {
  id: number
  title: string
  description: string
  icon: string
  isOptional: boolean
}

export const ONBOARDING_STEPS: StepDefinition[] = [
  {
    id: 1,
    title: 'Personal Information',
    description: 'Basic employee details',
    icon: 'User',
    isOptional: false,
  },
  {
    id: 2,
    title: 'Authentication',
    description: 'Login credentials setup',
    icon: 'Key',
    isOptional: false,
  },
  {
    id: 3,
    title: 'Role & Permissions',
    description: 'System access level',
    icon: 'Shield',
    isOptional: false,
  },
  {
    id: 4,
    title: 'Position',
    description: 'Job assignment',
    icon: 'Briefcase',
    isOptional: false,
  },
  {
    id: 5,
    title: 'Schedule',
    description: 'Shift configuration',
    icon: 'Clock',
    isOptional: false,
  },
  {
    id: 6,
    title: 'Working Area',
    description: 'Location assignment',
    icon: 'MapPin',
    isOptional: false,
  },
  {
    id: 7,
    title: 'Certifications',
    description: 'Training & licenses',
    icon: 'Award',
    isOptional: true,
  },
  {
    id: 8,
    title: 'Devices',
    description: 'Equipment assignment',
    icon: 'Smartphone',
    isOptional: true,
  },
  {
    id: 9,
    title: 'Review & Submit',
    description: 'Confirm and create',
    icon: 'CheckCircle',
    isOptional: false,
  },
]

// ===== EXPORT DEFAULT EMPTY STATE =====

export const getDefaultWizardState = (): OnboardingWizardState => ({
  sessionId: null,
  currentStep: 1,
  totalSteps: 9,
  personalInfo: null,
  authenticationSetup: {
    auto_generate_password: true,
    auto_activate: true,
    send_welcome_email: false,
  },
  roleAssignment: null,
  positionAssignment: null,
  shiftSchedule: {
    shift_pattern: 'fixed',
    shift_start_time: '08:00',
    shift_end_time: '17:00',
    working_days: [1, 2, 3, 4, 5],
  },
  workingArea: null,
  certifications: [],
  devices: [],
  stepsValidation: {},
  isSubmitting: false,
  isDraftSaved: false,
  lastSavedAt: null,
  createdUserId: null,
  generatedCredentials: null,
})

// Created and developed by Jai Singh
