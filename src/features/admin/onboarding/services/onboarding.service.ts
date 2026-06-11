// Created and developed by Jai Singh
/**
 * Employee Onboarding Service
 * Created: December 22, 2025
 * Purpose: API service layer for employee onboarding wizard workflow
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import type {
  AvailableUserOption,
  EmployeeCertification,
  EmployeeDevice,
  OnboardingChecklistItem,
  OnboardingSession,
  OnboardingStatistics,
  OnboardingSubmitResult,
  OnboardingWizardState,
  PositionOption,
  RoleOption,
  ShiftScheduleOption,
  SupervisorOption,
  WorkingAreaOption,
} from '../types/onboarding.types'

// ===== NETWORK ERROR HANDLING UTILITIES =====

/** Request timeout in milliseconds (30 seconds) */
const REQUEST_TIMEOUT_MS = 30000

/**
 * Fetch wrapper with timeout support using AbortController
 * @param url - The URL to fetch
 * @param options - Standard fetch options
 * @param timeoutMs - Timeout in milliseconds (default 30s)
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        'Request timed out. Please check your connection and try again.'
      )
    }
    throw error
  }
}

/**
 * Fetch with automatic retry and exponential backoff
 * Only retries on 5xx server errors, not on 4xx client errors
 * @param url - The URL to fetch
 * @param options - Standard fetch options
 * @param maxRetries - Maximum number of retry attempts (default 3)
 * @param baseDelayMs - Base delay between retries in ms (default 1000)
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options)

      // Don't retry on success or 4xx client errors
      if (response.ok || response.status < 500) {
        return response
      }

      // Server error - throw to trigger retry
      throw new Error(`Server error: ${response.status}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error')

      // Don't retry on timeout or abort errors - just throw immediately
      if (
        lastError.message.includes('timed out') ||
        lastError.name === 'AbortError'
      ) {
        throw lastError
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = baseDelayMs * Math.pow(2, attempt)
        logger.warn(
          `[OnboardingService] Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`,
          lastError.message
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Request failed after retries')
}

/**
 * Get user-friendly error message based on error type
 * Translates technical errors into actionable messages for users
 */
export function getNetworkErrorMessage(error: unknown): string {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return 'Unable to connect to the server. Please check your internet connection.'
  }

  if (error instanceof Error) {
    // Timeout error
    if (error.name === 'AbortError' || error.message.includes('timed out')) {
      return 'Request timed out. Please check your connection and try again.'
    }

    // Server error
    if (error.message.includes('Server error:')) {
      return 'The server is temporarily unavailable. Please try again in a few moments.'
    }

    // Network offline
    if (
      error.message.includes('offline') ||
      error.message.includes('network')
    ) {
      return 'You appear to be offline. Please check your internet connection.'
    }

    return error.message
  }

  return 'An unexpected error occurred. Please try again.'
}

// Password generation utilities (exported for potential use in password preview/generation)
export const generateSecurePassword = (length: number = 12): string => {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lowercase = 'abcdefghjkmnpqrstuvwxyz'
  const numbers = '23456789'
  const special = '!@#$%^&*'

  const all = uppercase + lowercase + numbers + special
  let password = ''

  // Ensure at least one of each type
  password += uppercase[Math.floor(Math.random() * uppercase.length)]
  password += lowercase[Math.floor(Math.random() * lowercase.length)]
  password += numbers[Math.floor(Math.random() * numbers.length)]
  password += special[Math.floor(Math.random() * special.length)]

  // Fill rest with random characters
  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)]
  }

  // Shuffle password
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('')
}

export class OnboardingService {
  // ===== SESSION MANAGEMENT =====

  /**
   * Create a new onboarding session
   */
  static async createSession(
    organizationId: string,
    createdBy: string
  ): Promise<OnboardingSession> {
    const { data, error } = await (supabase as any)
      .from('onboarding_sessions')
      .insert({
        organization_id: organizationId,
        created_by: createdBy,
        session_status: 'draft',
        current_step: 1,
      })
      .select()
      .single()

    if (error)
      throw new Error(`Failed to create onboarding session: ${error.message}`)
    return data as OnboardingSession
  }

  /**
   * Get an onboarding session by ID
   */
  static async getSession(
    sessionId: string
  ): Promise<OnboardingSession | null> {
    const { data, error } = await (supabase as any)
      .from('onboarding_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`Failed to get onboarding session: ${error.message}`)
    }
    return data as OnboardingSession
  }

  /**
   * Save wizard draft progress
   */
  static async saveDraft(
    sessionId: string,
    state: Partial<OnboardingWizardState>
  ): Promise<OnboardingSession> {
    const updateData: Record<string, unknown> = {
      current_step: state.currentStep,
      session_status: 'in_progress',
      updated_at: new Date().toISOString(),
    }

    if (state.personalInfo) updateData.personal_info = state.personalInfo
    if (state.authenticationSetup)
      updateData.authentication_setup = state.authenticationSetup
    if (state.roleAssignment) updateData.role_assignment = state.roleAssignment
    if (state.positionAssignment)
      updateData.position_assignment = state.positionAssignment
    if (state.shiftSchedule) updateData.shift_schedule = state.shiftSchedule
    if (state.workingArea) updateData.working_area = state.workingArea
    if (state.certifications) updateData.certifications = state.certifications
    if (state.devices) updateData.device_registration = state.devices

    const { data, error } = await (supabase as any)
      .from('onboarding_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select()
      .single()

    if (error) throw new Error(`Failed to save draft: ${error.message}`)
    return data as OnboardingSession
  }

  /**
   * Load a draft session into wizard state
   */
  static async loadDraft(
    sessionId: string
  ): Promise<OnboardingWizardState | null> {
    const session = await this.getSession(sessionId)
    if (!session) return null

    return {
      sessionId: session.id,
      currentStep: session.current_step,
      totalSteps: session.total_steps,
      personalInfo: session.personal_info,
      authenticationSetup: session.authentication_setup,
      roleAssignment: session.role_assignment,
      positionAssignment: session.position_assignment,
      shiftSchedule: session.shift_schedule,
      workingArea: session.working_area,
      certifications: session.certifications || [],
      devices: session.device_registration || [],
      stepsValidation: {},
      isSubmitting: false,
      isDraftSaved: true,
      lastSavedAt: session.updated_at,
      createdUserId: session.created_user_id,
      generatedCredentials: null,
    }
  }

  /**
   * Get all draft sessions for current user
   */
  static async getDraftSessions(
    organizationId: string
  ): Promise<OnboardingSession[]> {
    const { data, error } = await (supabase as any)
      .from('onboarding_sessions')
      .select('*')
      .eq('organization_id', organizationId)
      .in('session_status', ['draft', 'in_progress'])
      .gt('expires_at', new Date().toISOString())
      .order('updated_at', { ascending: false })

    if (error) throw new Error(`Failed to get draft sessions: ${error.message}`)
    return (data || []) as OnboardingSession[]
  }

  /**
   * Delete an onboarding session
   */
  static async deleteSession(sessionId: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('onboarding_sessions')
      .delete()
      .eq('id', sessionId)

    if (error) throw new Error(`Failed to delete session: ${error.message}`)
  }

  // ===== COMPLETE ONBOARDING SUBMISSION =====

  /**
   * Submit the complete onboarding wizard and create the employee
   */
  static async submitOnboarding(
    sessionId: string,
    state: OnboardingWizardState,
    organizationId: string
  ): Promise<OnboardingSubmitResult> {
    try {
      // Validate required data
      if (!state.personalInfo)
        throw new Error('Personal information is required')
      if (!state.roleAssignment) throw new Error('Role assignment is required')
      if (!state.positionAssignment)
        throw new Error('Position assignment is required')
      if (!state.workingArea)
        throw new Error('Working area assignment is required')

      // Call backend API endpoint to handle user creation and all related operations
      const token = (await supabase.auth.getSession()).data.session
        ?.access_token
      if (!token) throw new Error('No authentication token found')

      // Auto-detect API URL: development (localhost:5173) uses localhost:8000, production uses same origin
      const API_BASE_URL = (() => {
        if (typeof window !== 'undefined') {
          // In development (localhost:5173), use separate backend
          if (window.location.origin === 'http://localhost:5173') {
            return 'http://localhost:8000'
          }
          // In production (Railway or any other deployment), use same origin (unified deployment)
          return window.location.origin
        }
        // Fallback for SSR
        return import.meta.env.VITE_API_URL || 'http://localhost:8000'
      })()

      // Use fetchWithRetry for resilient network handling
      const response = await fetchWithRetry(
        `${API_BASE_URL}/api/admin/onboarding/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            session_id: sessionId,
            organization_id: organizationId,
            personal_info: state.personalInfo,
            authentication_setup: state.authenticationSetup,
            role_assignment: state.roleAssignment,
            position_assignment: state.positionAssignment,
            shift_schedule: state.shiftSchedule,
            working_area: state.workingArea,
            certifications: state.certifications,
            device_registration: state.devices,
          }),
        },
        3, // maxRetries
        1000 // baseDelayMs
      )

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: 'Unknown error' }))
        throw new Error(errorData.detail || 'Failed to submit onboarding')
      }

      const result = await response.json()

      // Return result from backend API
      return {
        success: true,
        userId: result.user_id,
        profileId: result.user_id,
        credentials: result.credentials || {
          userId: result.user_id,
          email: state.personalInfo.email,
          password: result.password || '',
          badgeNumber: result.badge_number || '',
          loginUrl: `${window.location.origin}/sign-in`,
        },
        errors: result.errors || undefined,
      }
    } catch (error) {
      logger.error('Onboarding submission failed:', error)
      const errorMessage = getNetworkErrorMessage(error)
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
    }
  }

  // ===== LOOKUP DATA =====

  /**
   * Get available roles for dropdown
   */
  static async getAvailableRoles(): Promise<RoleOption[]> {
    const { data, error } = await supabase
      .from('roles')
      .select('id, name, display_name, description, is_system')
      .eq('is_active', true)
      .order('display_name')

    if (error) throw new Error(`Failed to get roles: ${error.message}`)
    return (data || []) as RoleOption[]
  }

  /**
   * Get available positions for dropdown
   */
  static async getAvailablePositions(
    organizationId: string
  ): Promise<PositionOption[]> {
    const { data, error } = await (supabase as any)
      .from('shift_positions')
      .select(
        'id, position_code, position_title, position_type, position_level, department, is_supervisory, headcount_budget'
      )
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('position_title')

    if (error) throw new Error(`Failed to get positions: ${error.message}`)

    const positions = (data || []) as PositionOption[]
    if (positions.length === 0) return positions

    // Get all headcounts in ONE query (batch approach - fixes N+1 pattern)
    const positionIds = positions.map((p) => p.id)
    const { data: assignments, error: assignError } = await (supabase as any)
      .from('shift_assignments')
      .select('position_id')
      .in('position_id', positionIds)
      .eq('status', 'active')

    if (assignError) {
      logger.error('Failed to get headcounts:', assignError)
      // Set default counts to 0 if query fails
      positions.forEach((pos) => (pos.current_headcount = 0))
      return positions
    }

    // Count assignments per position in memory
    const headcountMap = new Map<string, number>()
    for (const assignment of assignments || []) {
      const count = headcountMap.get(assignment.position_id) || 0
      headcountMap.set(assignment.position_id, count + 1)
    }

    // Apply counts to positions
    for (const pos of positions) {
      pos.current_headcount = headcountMap.get(pos.id) || 0
    }

    return positions
  }

  /**
   * Get available working areas for dropdown (with supervisor info for auto-population)
   */
  static async getAvailableWorkingAreas(
    organizationId: string
  ): Promise<WorkingAreaOption[]> {
    const { data, error } = await (supabase as any)
      .from('working_areas')
      .select(
        `
        id, 
        area_code, 
        area_name, 
        area_type, 
        capacity, 
        requires_certification, 
        is_active,
        primary_supervisor_id,
        backup_supervisor_id,
        primary_supervisor:user_profiles!working_areas_primary_supervisor_id_fkey(id, full_name),
        backup_supervisor:user_profiles!working_areas_backup_supervisor_id_fkey(id, full_name)
      `
      )
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('area_name')

    if (error) throw new Error(`Failed to get working areas: ${error.message}`)

    // Transform the data to flatten supervisor names
    return (data || []).map((area: any) => ({
      id: area.id,
      area_code: area.area_code,
      area_name: area.area_name,
      area_type: area.area_type,
      capacity: area.capacity,
      requires_certification: area.requires_certification,
      is_active: area.is_active,
      primary_supervisor_id: area.primary_supervisor_id,
      backup_supervisor_id: area.backup_supervisor_id,
      primary_supervisor_name: area.primary_supervisor?.full_name || null,
      backup_supervisor_name: area.backup_supervisor?.full_name || null,
    })) as WorkingAreaOption[]
  }

  /**
   * Get all available users for supervisor/team lead selection
   */
  static async getAvailableUsers(
    organizationId: string
  ): Promise<AvailableUserOption[]> {
    const { data, error } = await (supabase as any)
      .from('user_profiles')
      .select(
        `
        id,
        full_name,
        email,
        status
      `
      )
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('full_name')

    if (error)
      throw new Error(`Failed to get available users: ${error.message}`)

    return (data || []).map((user: any) => ({
      id: user.id,
      full_name: user.full_name || user.email,
      email: user.email,
    })) as AvailableUserOption[]
  }

  /**
   * Get available supervisors for dropdown
   */
  static async getAvailableSupervisors(
    organizationId: string
  ): Promise<SupervisorOption[]> {
    const { data, error } = await (supabase as any)
      .from('shift_assignments')
      .select(
        `
        user_id,
        user_profiles!shift_assignments_user_id_fkey(id, full_name, email),
        shift_positions!shift_assignments_position_id_fkey(position_title, is_supervisory, department)
      `
      )
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .eq('shift_positions.is_supervisory', true)

    if (error) throw new Error(`Failed to get supervisors: ${error.message}`)

    return (data || [])
      .filter((item: any) => item.user_profiles && item.shift_positions) // Filter out null joins
      .map((item: any) => ({
        id: item.user_profiles.id,
        full_name: item.user_profiles.full_name || item.user_profiles.email,
        email: item.user_profiles.email,
        position_title: item.shift_positions.position_title,
        department: item.shift_positions.department,
      }))
  }

  /**
   * Get shift schedule templates
   */
  static async getShiftSchedules(
    organizationId: string
  ): Promise<ShiftScheduleOption[]> {
    const { data, error } = await (supabase as any)
      .from('shift_schedules')
      .select(
        'id, schedule_name, schedule_code, schedule_type, shift_start_time, shift_end_time, operating_days'
      )
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('schedule_name')

    if (error)
      throw new Error(`Failed to get shift schedules: ${error.message}`)
    return (data || []) as ShiftScheduleOption[]
  }

  // ===== STATISTICS =====

  /**
   * Get onboarding statistics for dashboard
   */
  static async getStatistics(
    organizationId: string
  ): Promise<OnboardingStatistics> {
    const { data, error } = await (supabase as any).rpc(
      'get_onboarding_statistics',
      {
        p_organization_id: organizationId,
      }
    )

    if (error) throw new Error(`Failed to get statistics: ${error.message}`)
    return data as OnboardingStatistics
  }

  // ===== COMPLETED ONBOARDINGS =====

  /**
   * Get list of completed onboardings
   */
  static async getCompletedOnboardings(
    organizationId: string
  ): Promise<OnboardingSession[]> {
    const { data, error } = await (supabase as any)
      .from('onboarding_sessions')
      .select(
        `
        *,
        created_user:user_profiles!created_user_id(id, full_name, email, avatar_url)
      `
      )
      .eq('organization_id', organizationId)
      .eq('session_status', 'completed')
      .order('completed_at', { ascending: false })

    if (error)
      throw new Error(`Failed to get completed onboardings: ${error.message}`)
    return (data || []) as OnboardingSession[]
  }

  // ===== EMPLOYEE DATA =====

  /**
   * Get employee certifications
   */
  static async getEmployeeCertifications(
    userId: string
  ): Promise<EmployeeCertification[]> {
    const { data, error } = await (supabase as any)
      .from('employee_certifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw new Error(`Failed to get certifications: ${error.message}`)
    return (data || []) as EmployeeCertification[]
  }

  /**
   * Get employee devices
   */
  static async getEmployeeDevices(userId: string): Promise<EmployeeDevice[]> {
    const { data, error } = await (supabase as any)
      .from('employee_devices')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw new Error(`Failed to get devices: ${error.message}`)
    return (data || []) as EmployeeDevice[]
  }

  /**
   * Get onboarding checklist for employee
   */
  static async getOnboardingChecklist(
    userId: string
  ): Promise<OnboardingChecklistItem[]> {
    const { data, error } = await (supabase as any)
      .from('onboarding_checklists')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order')

    if (error) throw new Error(`Failed to get checklist: ${error.message}`)
    return (data || []) as OnboardingChecklistItem[]
  }

  /**
   * Update checklist item completion status
   */
  static async updateChecklistItem(
    itemId: string,
    isCompleted: boolean,
    completedBy: string
  ): Promise<void> {
    const { error } = await (supabase as any)
      .from('onboarding_checklists')
      .update({
        is_completed: isCompleted,
        completed_at: isCompleted ? new Date().toISOString() : null,
        completed_by: isCompleted ? completedBy : null,
      })
      .eq('id', itemId)

    if (error)
      throw new Error(`Failed to update checklist item: ${error.message}`)
  }
}

export default OnboardingService

// Created and developed by Jai Singh
