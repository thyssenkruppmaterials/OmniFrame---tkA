// Created and developed by Jai Singh
/**
 * Overtime Management Service
 * Service for managing overtime requests and approvals
 * Created: January 3, 2026
 * Updated: January 3, 2026 - Aligned with existing database schema
 *
 * Uses existing tables:
 * - overtime_requests: Main overtime request records
 * - overtime_signups: Individual employee sign-ups for overtime
 *
 * Provides functionality for:
 * - Creating overtime requests (individual and batch)
 * - Approving/rejecting requests
 * - Fetching overtime data for display
 * - Timeline marker integration
 */
import { format } from 'date-fns'
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// Type assertion helper for tables not yet in generated types
const db = supabase as any

// ===== ERROR CODES AND MESSAGES (Issue 2.11) =====

export const OVERTIME_ERROR_CODES = {
  DUPLICATE_REQUEST: 'OVERTIME_DUPLICATE_REQUEST',
  INVALID_TIME_RANGE: 'OVERTIME_INVALID_TIME_RANGE',
  PAST_DATE: 'OVERTIME_PAST_DATE',
  USER_NOT_FOUND: 'OVERTIME_USER_NOT_FOUND',
  ALREADY_APPROVED: 'OVERTIME_ALREADY_APPROVED',
  ALREADY_REJECTED: 'OVERTIME_ALREADY_REJECTED',
  INVALID_TRANSITION: 'OVERTIME_INVALID_TRANSITION',
  CONFLICT_EXISTS: 'OVERTIME_CONFLICT_EXISTS',
  MAX_DURATION_EXCEEDED: 'OVERTIME_MAX_DURATION_EXCEEDED',
  UNAUTHORIZED: 'OVERTIME_UNAUTHORIZED',
  DATABASE_ERROR: 'OVERTIME_DATABASE_ERROR',
} as const

export type OvertimeErrorCode =
  (typeof OVERTIME_ERROR_CODES)[keyof typeof OVERTIME_ERROR_CODES]

const ERROR_MESSAGES: Record<OvertimeErrorCode, string> = {
  [OVERTIME_ERROR_CODES.DUPLICATE_REQUEST]:
    'An overtime request already exists for this employee on this date.',
  [OVERTIME_ERROR_CODES.INVALID_TIME_RANGE]:
    'The extended time must be after the original shift end time.',
  [OVERTIME_ERROR_CODES.PAST_DATE]:
    'Cannot create overtime requests for past dates.',
  [OVERTIME_ERROR_CODES.USER_NOT_FOUND]:
    'One or more selected employees could not be found.',
  [OVERTIME_ERROR_CODES.ALREADY_APPROVED]:
    'This overtime request has already been approved.',
  [OVERTIME_ERROR_CODES.ALREADY_REJECTED]:
    'This overtime request has already been rejected.',
  [OVERTIME_ERROR_CODES.INVALID_TRANSITION]:
    'This status change is not allowed.',
  [OVERTIME_ERROR_CODES.CONFLICT_EXISTS]:
    'There is a scheduling conflict with an existing overtime request.',
  [OVERTIME_ERROR_CODES.MAX_DURATION_EXCEEDED]:
    'Overtime duration exceeds the maximum allowed (8 hours).',
  [OVERTIME_ERROR_CODES.UNAUTHORIZED]:
    'You do not have permission to perform this action.',
  [OVERTIME_ERROR_CODES.DATABASE_ERROR]:
    'A database error occurred. Please try again.',
}

/**
 * Custom error class for overtime-related errors
 * Issue 2.11: Provides error codes and user-friendly messages
 */
export class OvertimeError extends Error {
  code: OvertimeErrorCode
  userMessage: string

  constructor(code: OvertimeErrorCode, details?: string) {
    const userMessage = ERROR_MESSAGES[code]
    super(details || userMessage)
    this.code = code
    this.userMessage = userMessage
    this.name = 'OvertimeError'
  }
}

/**
 * Helper function to get user-friendly error message
 * Issue 2.11: Maps error codes to user-friendly messages
 */
export function getOvertimeErrorMessage(error: unknown): string {
  if (error instanceof OvertimeError) {
    return error.userMessage
  }
  if (error instanceof Error) {
    // Check if the error message contains known patterns
    const msg = error.message.toLowerCase()
    if (msg.includes('duplicate') || msg.includes('already exists')) {
      return ERROR_MESSAGES[OVERTIME_ERROR_CODES.DUPLICATE_REQUEST]
    }
    if (msg.includes('conflict')) {
      return ERROR_MESSAGES[OVERTIME_ERROR_CODES.CONFLICT_EXISTS]
    }
    if (msg.includes('unauthorized') || msg.includes('permission')) {
      return ERROR_MESSAGES[OVERTIME_ERROR_CODES.UNAUTHORIZED]
    }
    // Return the original message if it's descriptive enough
    if (error.message.length > 10 && error.message.length < 200) {
      return error.message
    }
  }
  return 'An unexpected error occurred. Please try again.'
}

// ===== TYPESCRIPT INTERFACES =====

export type OvertimeStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'completed'

export interface OvertimeRequest {
  id: string
  organization_id: string
  request_number: string
  request_date: string
  original_shift_end: string
  extended_shift_end: string
  overtime_duration_minutes: number
  scope_type: 'individual' | 'team' | 'area' | 'all'
  assigned_user_ids: string[]
  working_area_id?: string
  reason?: string
  notes?: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: OvertimeStatus
  requested_by?: string
  approved_by?: string
  approved_at?: string
  rejection_reason?: string
  completed_at?: string
  actual_end_time?: string
  actual_duration_minutes?: number
  is_voluntary: boolean
  is_paid: boolean
  pay_multiplier: number
  signup_cutoff_time?: string | null
  min_signups_required: number
  created_by?: string
  created_at: string
  updated_at: string
}

export interface OvertimeRequestWithDetails extends OvertimeRequest {
  working_area?: {
    area_name: string
    area_code: string
  }
  working_area_name?: string // Computed convenience field
  requested_by_profile?: {
    full_name: string
    avatar_url?: string
  }
  approved_by_profile?: {
    full_name: string
  }
  assigned_users?: Array<{
    id: string
    full_name: string
    avatar_url?: string
    email: string
  }>
  // Computed fields for UI compatibility
  user_profile?: {
    full_name: string
    email: string
    avatar_url?: string
  }
  batch_name?: string // For batch overtime requests
}

export interface OvertimeStatistics {
  total_requests: number
  pending_count: number
  approved_count: number
  rejected_count: number
  completed_count: number
  cancelled_count: number
  total_overtime_minutes: number
  approved_overtime_minutes: number
  unique_employees: number
}

export interface OvertimeSignup {
  id: string
  organization_id: string
  overtime_request_id?: string
  user_id: string
  signup_date: string
  response: 'pending' | 'accepted' | 'declined'
  response_time?: string
  decline_reason?: string
  status: OvertimeStatus
  checked_in_at?: string
  checked_out_at?: string
  created_at: string
  updated_at: string
}

export interface OvertimeSignupWithDetails extends OvertimeSignup {
  user?: {
    id: string
    full_name: string
    email: string
    avatar_url?: string
  }
  overtime_request?: OvertimeRequest
}

export interface CreateOvertimeRequestInput {
  request_date: string
  original_shift_end: string
  extended_shift_end: string
  user_ids: string[]
  scope_type?: 'individual' | 'team' | 'area' | 'all'
  working_area_id?: string
  reason?: string
  notes?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  is_voluntary?: boolean
  auto_approve?: boolean // Issue 2.12: Auto-approve for individual overtime
  is_paid?: boolean
  pay_multiplier?: number
}

export interface ApprovedOvertimeForTimeline {
  user_id: string
  original_shift_end: string
  extended_shift_end: string
  overtime_duration_minutes: number
  overtime_minutes: number // Alias for compatibility
}

// ===== REQUEST NUMBER GENERATION =====

/**
 * Generate a unique overtime request number
 * Format: OT-YYYYMMDD-XXXX where XXXX is a random number
 */
function generateRequestNumber(date: string): string {
  const dateStr = date.replace(/-/g, '')
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')
  return `OT-${dateStr}-${random}`
}

/**
 * Calculate overtime duration in minutes
 * Handles overnight shifts where extended end may be past midnight
 * e.g., original end 23:00, extended end 02:00 (next day) = 180 minutes
 *
 * Maximum overtime capped at 8 hours (480 minutes) for safety
 */
export function calculateOvertimeMinutes(
  originalEnd: string,
  extendedEnd: string
): number {
  const [origHours, origMins] = originalEnd.split(':').map(Number)
  const [extHours, extMins] = extendedEnd.split(':').map(Number)

  const origTotalMins = origHours * 60 + origMins
  let extTotalMins = extHours * 60 + extMins

  // Handle overnight shift: if extended time appears earlier than original,
  // it means the shift extends past midnight
  if (extTotalMins < origTotalMins) {
    // Add 24 hours (1440 minutes) to extended time
    extTotalMins += 1440
  }

  const overtimeMinutes = extTotalMins - origTotalMins

  // Cap at 8 hours (480 minutes) maximum for safety
  const MAX_OVERTIME_MINUTES = 480
  return Math.min(Math.max(0, overtimeMinutes), MAX_OVERTIME_MINUTES)
}

// ===== OVERTIME REQUESTS =====

/**
 * Get all overtime requests with date range and filters (for Dashboard)
 */
export async function getAllOvertimeRequests(
  organizationId: string,
  options?: {
    startDate?: string
    endDate?: string
    status?: OvertimeStatus | 'all'
    searchQuery?: string
    workingAreaId?: string
    limit?: number
    offset?: number
  }
): Promise<{ data: OvertimeRequestWithDetails[]; totalCount: number }> {
  try {
    let query = db
      .from('overtime_requests')
      .select(
        `
        *,
        working_area:working_areas(area_name, area_code),
        requested_by_profile:requested_by(full_name, avatar_url),
        approved_by_profile:approved_by(full_name)
      `,
        { count: 'exact' }
      )
      .eq('organization_id', organizationId)
      .order('request_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (options?.startDate) {
      query = query.gte('request_date', options.startDate)
    }
    if (options?.endDate) {
      query = query.lte('request_date', options.endDate)
    }
    if (options?.status && options.status !== 'all') {
      query = query.eq('status', options.status)
    }
    if (options?.workingAreaId && options.workingAreaId !== '__any__') {
      query = query.eq('working_area_id', options.workingAreaId)
    }
    if (options?.limit) {
      query = query.limit(options.limit)
    }
    if (options?.offset) {
      query = query.range(
        options.offset,
        options.offset + (options.limit || 50) - 1
      )
    }

    const { data, error, count } = await query

    if (error) throw error

    // Fetch assigned user details for each request
    const requests = data || []
    const requestsWithUsers = await Promise.all(
      requests.map(
        async (
          request: OvertimeRequest & { working_area?: { area_name: string } }
        ) => {
          let assignedUsers: Array<{
            id: string
            full_name: string
            email: string
            avatar_url?: string
          }> = []

          if (
            request.assigned_user_ids &&
            request.assigned_user_ids.length > 0
          ) {
            const { data: users } = await db
              .from('user_profiles')
              .select('id, full_name, email, avatar_url')
              .in('id', request.assigned_user_ids)
            assignedUsers = users || []
          }

          const firstUser = assignedUsers[0]

          return {
            ...request,
            assigned_users: assignedUsers,
            user_profile: firstUser
              ? {
                  full_name: firstUser.full_name,
                  email: firstUser.email,
                  avatar_url: firstUser.avatar_url,
                }
              : undefined,
            working_area_name: request.working_area?.area_name,
            batch_name:
              request.scope_type !== 'individual' ? request.reason : undefined,
          }
        }
      )
    )

    // Filter by search query (client-side for user names)
    let filteredResults = requestsWithUsers as OvertimeRequestWithDetails[]
    if (options?.searchQuery) {
      const query = options.searchQuery.toLowerCase()
      filteredResults = filteredResults.filter(
        (request) =>
          request.user_profile?.full_name?.toLowerCase().includes(query) ||
          request.user_profile?.email?.toLowerCase().includes(query) ||
          request.working_area_name?.toLowerCase().includes(query) ||
          request.batch_name?.toLowerCase().includes(query) ||
          request.request_number?.toLowerCase().includes(query)
      )
    }

    return {
      data: filteredResults,
      totalCount: count || filteredResults.length,
    }
  } catch (error) {
    logger.error('Error fetching all overtime requests:', error)
    throw error
  }
}

/**
 * Get current week's open/active overtime requests (for Requests tab)
 */
export async function getCurrentWeekOvertimeRequests(
  organizationId: string,
  referenceDate: Date = new Date()
): Promise<OvertimeRequestWithDetails[]> {
  try {
    // Calculate week boundaries (Sunday to Saturday)
    const dayOfWeek = referenceDate.getDay()
    const startOfWeek = new Date(referenceDate)
    startOfWeek.setDate(referenceDate.getDate() - dayOfWeek)
    startOfWeek.setHours(0, 0, 0, 0)

    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    endOfWeek.setHours(23, 59, 59, 999)

    const startDateStr = format(startOfWeek, 'yyyy-MM-dd')
    const endDateStr = format(endOfWeek, 'yyyy-MM-dd')

    const { data, error } = await db
      .from('overtime_requests')
      .select(
        `
        *,
        working_area:working_areas(area_name, area_code),
        requested_by_profile:requested_by(full_name, avatar_url),
        approved_by_profile:approved_by(full_name)
      `
      )
      .eq('organization_id', organizationId)
      .gte('request_date', startDateStr)
      .lte('request_date', endDateStr)
      .in('status', ['pending', 'approved']) // Only open and active
      .order('request_date', { ascending: true })
      .order('created_at', { ascending: false })

    if (error) throw error

    // Fetch assigned user details for each request
    const requests = data || []
    const requestsWithUsers = await Promise.all(
      requests.map(
        async (
          request: OvertimeRequest & { working_area?: { area_name: string } }
        ) => {
          let assignedUsers: Array<{
            id: string
            full_name: string
            email: string
            avatar_url?: string
          }> = []

          if (
            request.assigned_user_ids &&
            request.assigned_user_ids.length > 0
          ) {
            const { data: users } = await db
              .from('user_profiles')
              .select('id, full_name, email, avatar_url')
              .in('id', request.assigned_user_ids)
            assignedUsers = users || []
          }

          const firstUser = assignedUsers[0]

          return {
            ...request,
            assigned_users: assignedUsers,
            user_profile: firstUser
              ? {
                  full_name: firstUser.full_name,
                  email: firstUser.email,
                  avatar_url: firstUser.avatar_url,
                }
              : undefined,
            working_area_name: request.working_area?.area_name,
            batch_name:
              request.scope_type !== 'individual' ? request.reason : undefined,
          }
        }
      )
    )

    return requestsWithUsers as OvertimeRequestWithDetails[]
  } catch (error) {
    logger.error('Error fetching current week overtime requests:', error)
    throw error
  }
}

/**
 * Update an existing overtime request
 */
export async function updateOvertimeRequest(
  requestId: string,
  updates: {
    request_date?: string
    original_shift_end?: string
    extended_shift_end?: string
    working_area_id?: string | null
    reason?: string
    notes?: string
    priority?: 'low' | 'normal' | 'high' | 'urgent'
  }
): Promise<OvertimeRequest> {
  try {
    // Recalculate overtime minutes if times changed
    let overtimeMinutes: number | undefined
    if (updates.original_shift_end && updates.extended_shift_end) {
      overtimeMinutes = calculateOvertimeMinutes(
        updates.original_shift_end,
        updates.extended_shift_end
      )
    }

    const updateData: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    }

    if (overtimeMinutes !== undefined) {
      updateData.overtime_duration_minutes = overtimeMinutes
    }

    const { data, error } = await db
      .from('overtime_requests')
      .update(updateData)
      .eq('id', requestId)
      .select()
      .single()

    if (error) throw error
    return data as OvertimeRequest
  } catch (error) {
    logger.error('Error updating overtime request:', error)
    throw error
  }
}

/**
 * Get overtime requests for a specific date
 */
export async function getOvertimeRequestsForDate(
  organizationId: string,
  date: string,
  status?: OvertimeStatus | 'all'
): Promise<OvertimeRequestWithDetails[]> {
  try {
    let query = db
      .from('overtime_requests')
      .select(
        `
        *,
        working_area:working_areas(area_name, area_code),
        requested_by_profile:requested_by(full_name, avatar_url),
        approved_by_profile:approved_by(full_name)
      `
      )
      .eq('organization_id', organizationId)
      .eq('request_date', date)
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) throw error

    // Fetch assigned user details for each request
    const requests = data || []
    const requestsWithUsers = await Promise.all(
      requests.map(
        async (
          request: OvertimeRequest & { working_area?: { area_name: string } }
        ) => {
          let assignedUsers: Array<{
            id: string
            full_name: string
            email: string
            avatar_url?: string
          }> = []

          if (
            request.assigned_user_ids &&
            request.assigned_user_ids.length > 0
          ) {
            const { data: users } = await db
              .from('user_profiles')
              .select('id, full_name, email, avatar_url')
              .in('id', request.assigned_user_ids)
            assignedUsers = users || []
          }

          // Compute user_profile from first assigned user for UI compatibility
          const firstUser = assignedUsers[0]

          return {
            ...request,
            assigned_users: assignedUsers,
            // Computed fields for UI compatibility
            user_profile: firstUser
              ? {
                  full_name: firstUser.full_name,
                  email: firstUser.email,
                  avatar_url: firstUser.avatar_url,
                }
              : undefined,
            working_area_name: request.working_area?.area_name,
            batch_name:
              request.scope_type !== 'individual' ? request.reason : undefined,
          }
        }
      )
    )

    return requestsWithUsers as OvertimeRequestWithDetails[]
  } catch (error) {
    logger.error('Error fetching overtime requests:', error)
    throw error
  }
}

/**
 * Get approved overtime for timeline display
 * Returns list of user_ids with their extended shift times
 */
export async function getApprovedOvertimeForDate(
  organizationId: string,
  date: string
): Promise<ApprovedOvertimeForTimeline[]> {
  try {
    const { data, error } = await db
      .from('overtime_requests')
      .select(
        'assigned_user_ids, original_shift_end, extended_shift_end, overtime_duration_minutes'
      )
      .eq('organization_id', organizationId)
      .eq('request_date', date)
      .eq('status', 'approved')

    if (error) throw error

    // Flatten the results - each user gets their overtime info
    const result: ApprovedOvertimeForTimeline[] = []
    for (const request of data || []) {
      for (const userId of request.assigned_user_ids || []) {
        result.push({
          user_id: userId,
          original_shift_end: request.original_shift_end,
          extended_shift_end: request.extended_shift_end,
          overtime_duration_minutes: request.overtime_duration_minutes,
          overtime_minutes: request.overtime_duration_minutes, // Alias for compatibility
        })
      }
    }

    return result
  } catch (error) {
    logger.error('Error fetching approved overtime:', error)
    throw error
  }
}

/**
 * Get a single overtime request by ID
 */
export async function getOvertimeRequest(
  requestId: string
): Promise<OvertimeRequestWithDetails | null> {
  try {
    const { data, error } = await db
      .from('overtime_requests')
      .select(
        `
        *,
        working_area:working_areas(area_name, area_code),
        requested_by_profile:requested_by(full_name, avatar_url),
        approved_by_profile:approved_by(full_name)
      `
      )
      .eq('id', requestId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }

    // Fetch assigned user details
    if (data.assigned_user_ids && data.assigned_user_ids.length > 0) {
      const { data: users } = await db
        .from('user_profiles')
        .select('id, full_name, email, avatar_url')
        .in('id', data.assigned_user_ids)

      return {
        ...data,
        assigned_users: users || [],
      } as OvertimeRequestWithDetails
    }

    return {
      ...data,
      assigned_users: [],
    } as OvertimeRequestWithDetails
  } catch (error) {
    logger.error('Error fetching overtime request:', error)
    throw error
  }
}

/**
 * Create a new overtime request
 */
/**
 * Maximum length for notes field
 */
const MAX_NOTES_LENGTH = 1000

/**
 * Sanitize text input by trimming whitespace and limiting length
 */
function sanitizeTextInput(
  text: string | undefined | null,
  maxLength: number = MAX_NOTES_LENGTH
): string | null {
  if (!text) return null
  return text.trim().slice(0, maxLength) || null
}

/**
 * Check for duplicate overtime requests
 * Prevents creating overlapping requests for the same user on the same date/time
 */
async function checkDuplicateOvertimeRequest(
  organizationId: string,
  requestDate: string,
  userIds: string[],
  originalShiftEnd: string,
  extendedShiftEnd: string,
  excludeRequestId?: string
): Promise<{ isDuplicate: boolean; existingRequest?: OvertimeRequest }> {
  try {
    let query = db
      .from('overtime_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('request_date', requestDate)
      .overlaps('assigned_user_ids', userIds)
      .in('status', ['pending', 'approved'])

    // Exclude current request when updating
    if (excludeRequestId) {
      query = query.neq('id', excludeRequestId)
    }

    const { data, error } = await query

    if (error) throw error

    // Check for time overlap
    if (data && data.length > 0) {
      for (const existing of data) {
        // Check if time ranges overlap
        const existingStart = existing.original_shift_end
        const existingEnd = existing.extended_shift_end

        // Simple overlap check - if any part of the time range overlaps
        if (
          originalShiftEnd < existingEnd &&
          extendedShiftEnd > existingStart
        ) {
          return {
            isDuplicate: true,
            existingRequest: existing as OvertimeRequest,
          }
        }
      }
    }

    return { isDuplicate: false }
  } catch (error) {
    logger.error('Error checking for duplicate overtime request:', error)
    // Don't block creation if duplicate check fails, just log the error
    return { isDuplicate: false }
  }
}

export async function createOvertimeRequest(
  organizationId: string,
  createdByUserId: string,
  input: CreateOvertimeRequestInput
): Promise<OvertimeRequest> {
  try {
    // Issue 2.6: Check for duplicate requests
    const { isDuplicate, existingRequest } =
      await checkDuplicateOvertimeRequest(
        organizationId,
        input.request_date,
        input.user_ids,
        input.original_shift_end,
        input.extended_shift_end
      )

    if (isDuplicate && existingRequest) {
      throw new Error(
        `Duplicate overtime request detected. An existing ${existingRequest.status} request (${existingRequest.request_number}) already covers this time period.`
      )
    }

    const overtimeMinutes = calculateOvertimeMinutes(
      input.original_shift_end,
      input.extended_shift_end
    )

    // Issue 2.9 & 2.10: Sanitize and limit notes/reason length
    const sanitizedNotes = sanitizeTextInput(input.notes)
    const sanitizedReason = sanitizeTextInput(input.reason, 500)

    // Issue 2.12: Support auto-approve for individual overtime
    const shouldAutoApprove = input.auto_approve === true

    const { data, error } = await db
      .from('overtime_requests')
      .insert({
        organization_id: organizationId,
        request_number: generateRequestNumber(input.request_date),
        request_date: input.request_date,
        original_shift_end: input.original_shift_end,
        extended_shift_end: input.extended_shift_end,
        overtime_duration_minutes: overtimeMinutes,
        scope_type: input.scope_type || 'individual',
        assigned_user_ids: input.user_ids,
        working_area_id: input.working_area_id || null,
        reason: sanitizedReason,
        notes: sanitizedNotes,
        priority: input.priority || 'normal',
        status: shouldAutoApprove ? 'approved' : 'pending',
        is_voluntary: input.is_voluntary ?? true,
        is_paid: input.is_paid ?? true,
        pay_multiplier: input.pay_multiplier ?? 1.5,
        requested_by: createdByUserId,
        created_by: createdByUserId,
        approved_by: shouldAutoApprove ? createdByUserId : null,
        approved_at: shouldAutoApprove ? new Date().toISOString() : null,
      })
      .select()
      .single()

    if (error) throw error
    return data as OvertimeRequest
  } catch (error) {
    logger.error('Error creating overtime request:', error)
    throw error
  }
}

export interface CreateBatchOvertimeInput {
  batch_name: string
  request_date: string
  original_shift_end: string
  extended_shift_end: string
  user_ids: string[]
  working_area_id?: string
  auto_approve?: boolean
}

/**
 * Check for conflicts in batch overtime creation
 * Returns users who already have overlapping approved/pending overtime
 * Issue 2.7: Batch Operation Has No Conflict Detection
 */
export interface BatchConflictInfo {
  userId: string
  existingRequestNumber: string
  existingDate: string
  existingTimeRange: string
}

async function checkBatchOvertimeConflicts(
  organizationId: string,
  requestDate: string,
  userIds: string[],
  originalShiftEnd: string,
  extendedShiftEnd: string
): Promise<BatchConflictInfo[]> {
  try {
    // Find any existing pending/approved overtime for these users on this date
    const { data, error } = await db
      .from('overtime_requests')
      .select(
        'id, request_number, request_date, original_shift_end, extended_shift_end, assigned_user_ids'
      )
      .eq('organization_id', organizationId)
      .eq('request_date', requestDate)
      .in('status', ['pending', 'approved'])
      .overlaps('assigned_user_ids', userIds)

    if (error) throw error

    const conflicts: BatchConflictInfo[] = []

    for (const request of data || []) {
      // Check for time overlap
      const existingStart = request.original_shift_end
      const existingEnd = request.extended_shift_end

      // Simple overlap check
      if (originalShiftEnd < existingEnd && extendedShiftEnd > existingStart) {
        // Find which users from our batch are in this conflicting request
        const conflictingUsers = userIds.filter((uid) =>
          request.assigned_user_ids?.includes(uid)
        )
        for (const userId of conflictingUsers) {
          conflicts.push({
            userId,
            existingRequestNumber: request.request_number,
            existingDate: request.request_date,
            existingTimeRange: `${existingStart} - ${existingEnd}`,
          })
        }
      }
    }

    return conflicts
  } catch (error) {
    logger.error('Error checking batch overtime conflicts:', error)
    return []
  }
}

/**
 * Remove duplicate user IDs from array
 */
function deduplicateUserIds(userIds: string[]): string[] {
  return [...new Set(userIds)]
}

/**
 * Create batch overtime for multiple employees
 * Issue 2.7: Added conflict detection and duplicate user removal
 */
export async function createBatchOvertime(
  organizationId: string,
  createdByUserId: string,
  input: CreateBatchOvertimeInput
): Promise<OvertimeRequest> {
  try {
    // Remove duplicate user IDs
    const uniqueUserIds = deduplicateUserIds(input.user_ids)

    // Check for conflicts before creating
    const conflicts = await checkBatchOvertimeConflicts(
      organizationId,
      input.request_date,
      uniqueUserIds,
      input.original_shift_end,
      input.extended_shift_end
    )

    if (conflicts.length > 0) {
      // Build a descriptive error message
      const conflictDetails = conflicts
        .slice(0, 3) // Limit to first 3 conflicts in message
        .map((c) => `${c.existingRequestNumber} (${c.existingTimeRange})`)
        .join(', ')
      const moreCount =
        conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ''

      throw new Error(
        `Overtime conflict detected: ${conflicts.length} user(s) already have overlapping overtime requests (${conflictDetails}${moreCount}). Please remove conflicting users or adjust the time range.`
      )
    }

    const overtimeMinutes = calculateOvertimeMinutes(
      input.original_shift_end,
      input.extended_shift_end
    )

    const { data, error } = await db
      .from('overtime_requests')
      .insert({
        organization_id: organizationId,
        request_number: generateRequestNumber(input.request_date),
        request_date: input.request_date,
        original_shift_end: input.original_shift_end,
        extended_shift_end: input.extended_shift_end,
        overtime_duration_minutes: overtimeMinutes,
        scope_type: 'team',
        assigned_user_ids: uniqueUserIds, // Use deduplicated list
        working_area_id: input.working_area_id || null,
        reason: input.batch_name, // Use batch_name as reason for identification
        notes: `Batch overtime for ${uniqueUserIds.length} employees`,
        priority: 'normal',
        status: input.auto_approve ? 'approved' : 'pending',
        is_voluntary: true,
        is_paid: true,
        pay_multiplier: 1.5,
        requested_by: createdByUserId,
        created_by: createdByUserId,
        approved_by: input.auto_approve ? createdByUserId : null,
        approved_at: input.auto_approve ? new Date().toISOString() : null,
      })
      .select()
      .single()

    if (error) throw error
    return data as OvertimeRequest
  } catch (error) {
    logger.error('Error creating batch overtime:', error)
    throw error
  }
}

/**
 * Valid status transitions for overtime requests
 * Only allows logical state changes to prevent invalid data
 */
const VALID_STATUS_TRANSITIONS: Record<OvertimeStatus, OvertimeStatus[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['completed', 'cancelled'],
  rejected: [], // Terminal state
  cancelled: [], // Terminal state
  completed: [], // Terminal state
}

/**
 * Validate that a status transition is allowed
 */
function isValidStatusTransition(
  currentStatus: OvertimeStatus,
  newStatus: OvertimeStatus
): boolean {
  const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus]
  return allowedTransitions?.includes(newStatus) ?? false
}

/**
 * Approve an overtime request
 * Only allows approval of pending requests
 */
export async function approveOvertimeRequest(
  requestId: string,
  approvedByUserId: string,
  notes?: string
): Promise<OvertimeRequest> {
  try {
    // First, verify current status allows approval
    const { data: existing, error: fetchError } = await db
      .from('overtime_requests')
      .select('status')
      .eq('id', requestId)
      .single()

    if (fetchError) throw fetchError

    if (
      !existing ||
      !isValidStatusTransition(existing.status as OvertimeStatus, 'approved')
    ) {
      throw new Error(
        `Cannot approve request with status '${existing?.status}'. Only pending requests can be approved.`
      )
    }

    const updateData: Record<string, unknown> = {
      status: 'approved',
      approved_by: approvedByUserId,
      approved_at: new Date().toISOString(),
    }

    if (notes) {
      updateData.notes = notes
    }

    const { data, error } = await db
      .from('overtime_requests')
      .update(updateData)
      .eq('id', requestId)
      .select()
      .single()

    if (error) throw error
    return data as OvertimeRequest
  } catch (error) {
    logger.error('Error approving overtime request:', error)
    throw error
  }
}

/**
 * Reject an overtime request
 * Only allows rejection of pending requests
 */
export async function rejectOvertimeRequest(
  requestId: string,
  rejectedByUserId: string,
  rejectionReason?: string
): Promise<OvertimeRequest> {
  try {
    // First, verify current status allows rejection
    const { data: existing, error: fetchError } = await db
      .from('overtime_requests')
      .select('status')
      .eq('id', requestId)
      .single()

    if (fetchError) throw fetchError

    if (
      !existing ||
      !isValidStatusTransition(existing.status as OvertimeStatus, 'rejected')
    ) {
      throw new Error(
        `Cannot reject request with status '${existing?.status}'. Only pending requests can be rejected.`
      )
    }

    const { data, error } = await db
      .from('overtime_requests')
      .update({
        status: 'rejected',
        approved_by: rejectedByUserId,
        approved_at: new Date().toISOString(),
        rejection_reason: rejectionReason || null,
      })
      .eq('id', requestId)
      .select()
      .single()

    if (error) throw error
    return data as OvertimeRequest
  } catch (error) {
    logger.error('Error rejecting overtime request:', error)
    throw error
  }
}

/**
 * Deny an overtime request (alias for rejectOvertimeRequest)
 */
export const denyOvertimeRequest = rejectOvertimeRequest

/**
 * Cancel an overtime request
 * Only allows cancellation of pending or approved requests
 */
export async function cancelOvertimeRequest(
  requestId: string
): Promise<OvertimeRequest> {
  try {
    // First, verify current status allows cancellation
    const { data: existing, error: fetchError } = await db
      .from('overtime_requests')
      .select('status')
      .eq('id', requestId)
      .single()

    if (fetchError) throw fetchError

    if (
      !existing ||
      !isValidStatusTransition(existing.status as OvertimeStatus, 'cancelled')
    ) {
      throw new Error(
        `Cannot cancel request with status '${existing?.status}'. Only pending or approved requests can be cancelled.`
      )
    }

    const { data, error } = await db
      .from('overtime_requests')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single()

    if (error) throw error
    return data as OvertimeRequest
  } catch (error) {
    logger.error('Error cancelling overtime request:', error)
    throw error
  }
}

/**
 * Complete an overtime request (mark as finished)
 * Only allows completion of approved requests
 */
export async function completeOvertimeRequest(
  requestId: string,
  actualEndTime?: string,
  actualDurationMinutes?: number
): Promise<OvertimeRequest> {
  try {
    // First, verify current status allows completion
    const { data: existing, error: fetchError } = await db
      .from('overtime_requests')
      .select('status')
      .eq('id', requestId)
      .single()

    if (fetchError) throw fetchError

    if (
      !existing ||
      !isValidStatusTransition(existing.status as OvertimeStatus, 'completed')
    ) {
      throw new Error(
        `Cannot complete request with status '${existing?.status}'. Only approved requests can be completed.`
      )
    }

    const { data, error } = await db
      .from('overtime_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        actual_end_time: actualEndTime || null,
        actual_duration_minutes: actualDurationMinutes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single()

    if (error) throw error
    return data as OvertimeRequest
  } catch (error) {
    logger.error('Error completing overtime request:', error)
    throw error
  }
}

/**
 * Delete an overtime request (hard delete)
 */
export async function deleteOvertimeRequest(requestId: string): Promise<void> {
  try {
    // First delete any related signups
    await db
      .from('overtime_signups')
      .delete()
      .eq('overtime_request_id', requestId)

    // Then delete the request
    const { error } = await db
      .from('overtime_requests')
      .delete()
      .eq('id', requestId)

    if (error) throw error
  } catch (error) {
    logger.error('Error deleting overtime request:', error)
    throw error
  }
}

/**
 * Update overtime request notes
 */
export async function updateOvertimeNotes(
  requestId: string,
  notes: string
): Promise<void> {
  try {
    const { error } = await db
      .from('overtime_requests')
      .update({ notes })
      .eq('id', requestId)

    if (error) throw error
  } catch (error) {
    logger.error('Error updating overtime notes:', error)
    throw error
  }
}

// ===== OVERTIME SIGNUPS =====

/**
 * Get overtime signups for a date
 */
export async function getOvertimeSignupsForDate(
  organizationId: string,
  date: string
): Promise<OvertimeSignupWithDetails[]> {
  try {
    const { data, error } = await db
      .from('overtime_signups')
      .select(
        `
        *,
        user:user_profiles(id, full_name, email, avatar_url),
        overtime_request:overtime_requests(*)
      `
      )
      .eq('organization_id', organizationId)
      .eq('signup_date', date)
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []) as OvertimeSignupWithDetails[]
  } catch (error) {
    logger.error('Error fetching overtime signups:', error)
    throw error
  }
}

/**
 * Create an overtime signup (employee volunteering)
 */
export async function createOvertimeSignup(
  organizationId: string,
  userId: string,
  signupDate: string,
  overtimeRequestId?: string
): Promise<OvertimeSignup> {
  try {
    // Validate the target overtime request if provided
    if (overtimeRequestId) {
      const { data: rawRequest, error: reqError } = await db
        .from('overtime_requests')
        .select('*')
        .eq('id', overtimeRequestId)
        .single()

      if (reqError || !rawRequest) {
        throw new Error('Overtime position not found')
      }
      const request = rawRequest as unknown as OvertimeRequest
      if (request.organization_id !== organizationId) {
        throw new Error('Overtime position belongs to a different organization')
      }
      if (request.status !== 'approved') {
        throw new Error('Overtime position is not open for signups')
      }
      if (request.assigned_user_ids && request.assigned_user_ids.length > 0) {
        throw new Error('Overtime position has already been filled')
      }
      if (
        request.signup_cutoff_time &&
        new Date(request.signup_cutoff_time) <= new Date()
      ) {
        throw new Error('Signup period has closed for this position')
      }

      // Check for existing declined signup to reactivate
      const { data: existing } = await db
        .from('overtime_signups')
        .select('id, response')
        .eq('overtime_request_id', overtimeRequestId)
        .eq('user_id', userId)
        .single()

      if (existing) {
        if (existing.response === 'declined') {
          const { data: reactivated, error: reactivateError } = await db
            .from('overtime_signups')
            .update({
              response: 'pending',
              status: 'pending' as OvertimeStatus,
              response_time: null,
              decline_reason: null,
            })
            .eq('id', existing.id)
            .select()
            .single()
          if (reactivateError) throw reactivateError
          return reactivated as OvertimeSignup
        }
        throw new Error('You have already signed up for this position')
      }
    }

    const { data, error } = await db
      .from('overtime_signups')
      .insert({
        organization_id: organizationId,
        user_id: userId,
        signup_date: signupDate,
        overtime_request_id: overtimeRequestId || null,
        response: 'pending',
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        throw new Error('You have already signed up for this position')
      }
      throw error
    }
    return data as OvertimeSignup
  } catch (error) {
    logger.error('Error creating overtime signup:', error)
    throw error
  }
}

/**
 * Update signup response (accept/decline)
 */
export async function updateSignupResponse(
  signupId: string,
  response: 'accepted' | 'declined',
  declineReason?: string
): Promise<OvertimeSignup> {
  try {
    const { data, error } = await db
      .from('overtime_signups')
      .update({
        response,
        response_time: new Date().toISOString(),
        decline_reason: response === 'declined' ? declineReason : null,
        status: response === 'accepted' ? 'approved' : 'rejected',
      })
      .eq('id', signupId)
      .select()
      .single()

    if (error) throw error
    return data as OvertimeSignup
  } catch (error) {
    logger.error('Error updating signup response:', error)
    throw error
  }
}

/**
 * Batch-fetch active signups for multiple overtime request IDs
 */
export async function getSignupsForRequests(
  requestIds: string[]
): Promise<OvertimeSignupWithDetails[]> {
  if (requestIds.length === 0) return []
  try {
    const { data, error } = await db
      .from('overtime_signups')
      .select(
        `
        *,
        user:user_profiles(id, full_name, email, avatar_url),
        overtime_request:overtime_requests(*)
      `
      )
      .in('overtime_request_id', requestIds)
      .neq('response', 'declined')
      .order('created_at', { ascending: true })

    if (error) throw error
    return (data || []) as OvertimeSignupWithDetails[]
  } catch (error) {
    logger.error('Error fetching signups for requests:', error)
    throw error
  }
}

/**
 * Withdraw (soft-decline) an overtime signup
 */
export async function withdrawOvertimeSignup(signupId: string): Promise<void> {
  try {
    const { error } = await db
      .from('overtime_signups')
      .update({
        response: 'declined',
        status: 'rejected' as OvertimeStatus,
        response_time: new Date().toISOString(),
      })
      .eq('id', signupId)

    if (error) throw error
  } catch (error) {
    logger.error('Error withdrawing overtime signup:', error)
    throw error
  }
}

// ===== STATISTICS =====

/**
 * Get overtime statistics for a date range
 */
export async function getOvertimeStatistics(
  organizationId: string,
  startDate: string,
  endDate: string
): Promise<OvertimeStatistics> {
  try {
    const { data, error } = await db
      .from('overtime_requests')
      .select('status, overtime_duration_minutes, assigned_user_ids')
      .eq('organization_id', organizationId)
      .gte('request_date', startDate)
      .lte('request_date', endDate)

    if (error) throw error

    const requests = data || []

    // Calculate statistics
    const stats: OvertimeStatistics = {
      total_requests: requests.length,
      pending_count: 0,
      approved_count: 0,
      rejected_count: 0,
      completed_count: 0,
      cancelled_count: 0,
      total_overtime_minutes: 0,
      approved_overtime_minutes: 0,
      unique_employees: new Set<string>(),
    } as unknown as OvertimeStatistics

    const uniqueEmployees = new Set<string>()

    for (const request of requests) {
      // Count by status
      switch (request.status) {
        case 'pending':
          stats.pending_count++
          break
        case 'approved':
          stats.approved_count++
          stats.approved_overtime_minutes +=
            request.overtime_duration_minutes || 0
          break
        case 'rejected':
          stats.rejected_count++
          break
        case 'completed':
          stats.completed_count++
          stats.approved_overtime_minutes +=
            request.overtime_duration_minutes || 0
          break
        case 'cancelled':
          stats.cancelled_count++
          break
      }

      // Sum total overtime
      stats.total_overtime_minutes += request.overtime_duration_minutes || 0

      // Track unique employees
      for (const userId of request.assigned_user_ids || []) {
        uniqueEmployees.add(userId)
      }
    }

    stats.unique_employees = uniqueEmployees.size

    return stats
  } catch (error) {
    logger.error('Error fetching overtime statistics:', error)
    throw error
  }
}

// ===== SHIFT CHANGE VALIDATION =====

/**
 * Check if there are approved overtime requests that would be affected by a shift time change
 * Returns affected overtime requests that would become invalid if the shift end time changes
 *
 * Issue 2.3: Shift Time Changes After Overtime Approved
 * This function should be called before modifying shift end times to warn users
 */
export interface AffectedOvertimeInfo {
  requestId: string
  requestNumber: string
  requestDate: string
  originalShiftEnd: string
  extendedShiftEnd: string
  affectedUsers: string[]
}

export async function checkOvertimeAffectedByShiftChange(
  organizationId: string,
  userIds: string[],
  newShiftEndTime: string,
  startDate?: string,
  endDate?: string
): Promise<AffectedOvertimeInfo[]> {
  try {
    if (!userIds || userIds.length === 0) {
      return []
    }

    // Default to checking the next 30 days if no date range specified
    const today = new Date()
    const start = startDate || today.toISOString().split('T')[0]
    const end =
      endDate ||
      new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0]

    const { data, error } = await db
      .from('overtime_requests')
      .select(
        'id, request_number, request_date, original_shift_end, extended_shift_end, assigned_user_ids'
      )
      .eq('organization_id', organizationId)
      .eq('status', 'approved')
      .gte('request_date', start)
      .lte('request_date', end)
      .overlaps('assigned_user_ids', userIds)

    if (error) throw error

    // Filter to requests where the original_shift_end doesn't match the new shift end time
    // or where the overtime would no longer make sense with the new shift end
    const affected: AffectedOvertimeInfo[] = []

    for (const request of data || []) {
      // Check if the original shift end in the overtime request differs significantly from new shift end
      // This indicates the overtime was based on a different shift schedule
      if (request.original_shift_end !== newShiftEndTime) {
        // Calculate if overtime would become negative (new shift end is later than overtime end)
        const [newEndHours, newEndMins] = newShiftEndTime.split(':').map(Number)
        const [otEndHours, otEndMins] = request.extended_shift_end
          .split(':')
          .map(Number)
        const newEndMinutes = newEndHours * 60 + newEndMins
        const otEndMinutes = otEndHours * 60 + otEndMins

        // If new shift end is at or after the overtime extended end, the overtime is invalid
        if (newEndMinutes >= otEndMinutes) {
          affected.push({
            requestId: request.id,
            requestNumber: request.request_number,
            requestDate: request.request_date,
            originalShiftEnd: request.original_shift_end,
            extendedShiftEnd: request.extended_shift_end,
            affectedUsers: request.assigned_user_ids || [],
          })
        }
      }
    }

    return affected
  } catch (error) {
    logger.error('Error checking overtime affected by shift change:', error)
    return []
  }
}

/**
 * Auto-update overtime requests when shift end time changes
 * Updates the original_shift_end and recalculates overtime duration
 * Only updates requests that haven't been completed yet
 */
export async function updateOvertimeForShiftChange(
  organizationId: string,
  userIds: string[],
  oldShiftEndTime: string,
  newShiftEndTime: string
): Promise<number> {
  try {
    if (!userIds || userIds.length === 0) {
      return 0
    }

    // Find approved/pending overtime that matches the old shift end time
    const { data: requests, error: fetchError } = await db
      .from('overtime_requests')
      .select('id, original_shift_end, extended_shift_end, assigned_user_ids')
      .eq('organization_id', organizationId)
      .in('status', ['pending', 'approved'])
      .eq('original_shift_end', oldShiftEndTime)
      .overlaps('assigned_user_ids', userIds)

    if (fetchError) throw fetchError

    let updatedCount = 0

    for (const request of requests || []) {
      // Recalculate overtime duration with new shift end
      const newOvertimeMinutes = calculateOvertimeMinutes(
        newShiftEndTime,
        request.extended_shift_end
      )

      // Only update if overtime is still positive
      if (newOvertimeMinutes > 0) {
        const { error: updateError } = await db
          .from('overtime_requests')
          .update({
            original_shift_end: newShiftEndTime,
            overtime_duration_minutes: newOvertimeMinutes,
            notes:
              `${request.notes || ''}\n[Auto-updated: Shift end changed from ${oldShiftEndTime} to ${newShiftEndTime}]`.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', request.id)

        if (!updateError) {
          updatedCount++
        }
      } else {
        // Overtime would be negative/zero - cancel the request
        await db
          .from('overtime_requests')
          .update({
            status: 'cancelled',
            notes:
              `${request.notes || ''}\n[Auto-cancelled: Shift end changed to ${newShiftEndTime}, making overtime invalid]`.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', request.id)
      }
    }

    return updatedCount
  } catch (error) {
    logger.error('Error updating overtime for shift change:', error)
    return 0
  }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Format overtime minutes to human readable string
 */
export function formatOvertimeDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

/**
 * Get status badge variant
 */
export function getOvertimeStatusVariant(
  status: OvertimeStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'approved':
    case 'completed':
      return 'default'
    case 'pending':
      return 'secondary'
    case 'rejected':
    case 'cancelled':
      return 'destructive'
    default:
      return 'outline'
  }
}

/**
 * Get status display text
 */
export function getOvertimeStatusText(status: OvertimeStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending Approval'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status
  }
}

/**
 * Get status badge color class
 */
export function getOvertimeStatusColor(status: OvertimeStatus): string {
  switch (status) {
    case 'approved':
      return 'bg-green-500 hover:bg-green-600'
    case 'completed':
      return 'bg-blue-500 hover:bg-blue-600'
    case 'pending':
      return 'bg-amber-500 hover:bg-amber-600'
    case 'rejected':
      return 'bg-red-500 hover:bg-red-600'
    case 'cancelled':
      return 'bg-gray-500 hover:bg-gray-600'
    default:
      return 'bg-gray-500'
  }
}

export default {
  // Requests
  getAllOvertimeRequests,
  getCurrentWeekOvertimeRequests,
  getOvertimeRequestsForDate,
  getApprovedOvertimeForDate,
  getOvertimeRequest,
  createOvertimeRequest,
  createBatchOvertime,
  approveOvertimeRequest,
  rejectOvertimeRequest,
  denyOvertimeRequest, // Alias for rejectOvertimeRequest
  cancelOvertimeRequest,
  completeOvertimeRequest,
  deleteOvertimeRequest,
  updateOvertimeRequest,
  updateOvertimeNotes,
  // Signups
  getOvertimeSignupsForDate,
  createOvertimeSignup,
  updateSignupResponse,
  // Statistics
  getOvertimeStatistics,
  // Shift change validation
  checkOvertimeAffectedByShiftChange,
  updateOvertimeForShiftChange,
  // Utilities
  formatOvertimeDuration,
  calculateOvertimeMinutes,
  getOvertimeStatusVariant,
  getOvertimeStatusText,
  getOvertimeStatusColor,
}

// Created and developed by Jai Singh
