/**
 * Timeline Events Service
 * Service for managing timeline events (meetings, planned downtime, etc.)
 * Created: January 2, 2026
 *
 * Note: This service uses type assertions because the timeline_events tables
 * are new and not yet in the generated Supabase types. After running the
 * migration and regenerating types, remove the type assertions.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// Type assertion helper for tables not yet in generated types
const db = supabase as any

// ===== SECURITY HELPERS =====

/**
 * Validate UUID format to prevent SQL injection
 * Returns true if the string is a valid UUID v4 format
 */
function isValidUUID(id: string | undefined | null): boolean {
  if (!id) return false
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

/**
 * Sanitize search term for use in ilike queries
 * Escapes special characters that could affect the pattern matching
 */
function sanitizeSearchTerm(term: string | undefined | null): string {
  if (!term) return ''
  // Escape special PostgreSQL pattern matching characters
  return term.replace(/[%_\\]/g, '\\$&')
}

// ===== TYPESCRIPT INTERFACES =====

export interface TimelineEventCategory {
  id: string
  organization_id: string
  category_name: string
  category_code: string
  color: string
  icon: string
  description?: string
  is_paid_time: boolean
  is_productive_time: boolean
  is_recurring_allowed: boolean
  default_duration_minutes: number
  is_active: boolean
  is_system: boolean
  display_order: number
  created_by?: string
  created_at: string
  updated_at: string
}

export interface TimelineEvent {
  id: string
  organization_id: string
  event_name: string
  category_id: string
  event_date: string
  start_time: string
  end_time: string
  duration_minutes: number
  scope_type: 'all' | 'area' | 'shift' | 'user'
  working_area_id?: string
  shift_schedule_id?: string
  assigned_user_ids?: string[]
  description?: string
  location?: string
  notes?: string
  is_recurring: boolean
  recurrence_pattern?: 'daily' | 'weekly' | 'monthly' | 'custom'
  recurrence_days?: number[]
  recurrence_end_date?: string
  parent_event_id?: string
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  is_mandatory: boolean
  requires_acknowledgment: boolean
  custom_attributes?: Record<string, unknown>
  created_by?: string
  created_at: string
  updated_at: string
  // Joined fields
  category?: TimelineEventCategory
}

export interface TimelineEventWithCategory extends TimelineEvent {
  category: TimelineEventCategory
}

export interface CreateTimelineEventInput {
  event_name: string
  category_id: string
  event_date: string
  start_time: string
  end_time: string
  scope_type?: 'all' | 'area' | 'shift' | 'user'
  working_area_id?: string
  shift_schedule_id?: string
  assigned_user_ids?: string[]
  description?: string
  location?: string
  notes?: string
  is_recurring?: boolean
  recurrence_pattern?: 'daily' | 'weekly' | 'monthly' | 'custom'
  recurrence_days?: number[]
  recurrence_end_date?: string
  is_mandatory?: boolean
  requires_acknowledgment?: boolean
}

export interface UpdateTimelineEventInput {
  event_name?: string
  category_id?: string
  event_date?: string
  start_time?: string
  end_time?: string
  scope_type?: 'all' | 'area' | 'shift' | 'user'
  working_area_id?: string | null
  shift_schedule_id?: string | null
  assigned_user_ids?: string[] | null
  description?: string | null
  location?: string | null
  notes?: string | null
  status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  is_mandatory?: boolean
  requires_acknowledgment?: boolean
}

export interface CreateEventCategoryInput {
  category_name: string
  category_code: string
  color?: string
  icon?: string
  description?: string
  is_paid_time?: boolean
  is_productive_time?: boolean
  is_recurring_allowed?: boolean
  default_duration_minutes?: number
}

// ===== EVENT CATEGORIES =====

/**
 * Get all event categories for the organization
 */
export async function getEventCategories(
  organizationId: string,
  activeOnly: boolean = true
): Promise<TimelineEventCategory[]> {
  try {
    let query = db
      .from('timeline_event_categories')
      .select('*')
      .eq('organization_id', organizationId)
      .order('display_order', { ascending: true })

    if (activeOnly) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as TimelineEventCategory[]
  } catch (error) {
    logger.error('Error fetching event categories:', error)
    throw error
  }
}

/**
 * Initialize default event categories for an organization
 */
export async function initializeEventCategories(
  organizationId: string
): Promise<void> {
  try {
    const { error } = await db.rpc('initialize_timeline_event_categories', {
      p_organization_id: organizationId,
    })

    if (error) throw error
  } catch (error) {
    logger.error('Error initializing event categories:', error)
    throw error
  }
}

/**
 * Create a custom event category
 */
export async function createEventCategory(
  organizationId: string,
  input: CreateEventCategoryInput
): Promise<TimelineEventCategory> {
  try {
    const { data, error } = await db
      .from('timeline_event_categories')
      .insert({
        organization_id: organizationId,
        ...input,
      })
      .select()
      .single()

    if (error) throw error
    return data as TimelineEventCategory
  } catch (error) {
    logger.error('Error creating event category:', error)
    throw error
  }
}

/**
 * Update an event category
 */
export async function updateEventCategory(
  categoryId: string,
  updates: Partial<CreateEventCategoryInput>
): Promise<TimelineEventCategory> {
  try {
    const { data, error } = await db
      .from('timeline_event_categories')
      .update(updates)
      .eq('id', categoryId)
      .select()
      .single()

    if (error) throw error
    return data as TimelineEventCategory
  } catch (error) {
    logger.error('Error updating event category:', error)
    throw error
  }
}

/**
 * Delete an event category (only if not system and not in use)
 */
export async function deleteEventCategory(categoryId: string): Promise<void> {
  try {
    const { error } = await db
      .from('timeline_event_categories')
      .delete()
      .eq('id', categoryId)
      .eq('is_system', false)

    if (error) throw error
  } catch (error) {
    logger.error('Error deleting event category:', error)
    throw error
  }
}

// ===== TIMELINE EVENTS =====

/**
 * Get timeline events for a specific date
 * Supports filtering by all scope types: all, area, shift, user
 *
 * @param includeAllScopes - When true (default), returns ALL events for the date
 *   regardless of scope, allowing client-side filtering per-associate. When false,
 *   applies server-side scope filtering based on provided options.
 */
export async function getEventsForDate(
  organizationId: string,
  date: string,
  options?: {
    areaId?: string
    userId?: string
    shiftScheduleId?: string
    includeCategories?: boolean
    /** When true (default), fetch all events regardless of scope for client-side filtering */
    includeAllScopes?: boolean
  }
): Promise<TimelineEventWithCategory[]> {
  try {
    let query = db
      .from('timeline_events')
      .select(
        `
        *,
        category:timeline_event_categories(*)
      `
      )
      .eq('organization_id', organizationId)
      .eq('event_date', date)
      .neq('status', 'cancelled')
      .order('start_time', { ascending: true })

    // By default, fetch ALL events for the date and let client filter per-associate
    // This is needed for team dashboards where we show events relevant to each person
    const includeAllScopes = options?.includeAllScopes ?? true

    if (!includeAllScopes) {
      // Build comprehensive scope filter that handles all scope types
      // Events should be returned if:
      // - scope_type is 'all' (applies to everyone)
      // - scope_type is 'area' AND working_area_id matches the user's area
      // - scope_type is 'shift' AND shift_schedule_id matches the user's shift
      // - scope_type is 'user' AND user is in assigned_user_ids array
      const scopeConditions: string[] = ['scope_type.eq.all']

      if (options?.areaId && isValidUUID(options.areaId)) {
        scopeConditions.push(
          `and(scope_type.eq.area,working_area_id.eq.${options.areaId})`
        )
      }

      if (options?.shiftScheduleId && isValidUUID(options.shiftScheduleId)) {
        scopeConditions.push(
          `and(scope_type.eq.shift,shift_schedule_id.eq.${options.shiftScheduleId})`
        )
      }

      if (options?.userId && isValidUUID(options.userId)) {
        scopeConditions.push(
          `and(scope_type.eq.user,assigned_user_ids.cs.{${options.userId}})`
        )
      }

      // Apply OR condition across all scope types
      if (scopeConditions.length > 0) {
        query = query.or(scopeConditions.join(','))
      }
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as TimelineEventWithCategory[]
  } catch (error) {
    logger.error('Error fetching events for date:', error)
    throw error
  }
}

/**
 * Get timeline events for a date range
 * Supports filtering by all scope types: all, area, shift, user
 *
 * @param includeAllScopes - When true (default), returns ALL events for the date range
 *   regardless of scope, allowing client-side filtering per-associate.
 */
export async function getEventsForDateRange(
  organizationId: string,
  startDate: string,
  endDate: string,
  options?: {
    areaId?: string
    userId?: string
    shiftScheduleId?: string
    categoryId?: string
    status?: string
    /** When true (default), fetch all events regardless of scope for client-side filtering */
    includeAllScopes?: boolean
  }
): Promise<TimelineEventWithCategory[]> {
  try {
    let query = db
      .from('timeline_events')
      .select(
        `
        *,
        category:timeline_event_categories(*)
      `
      )
      .eq('organization_id', organizationId)
      .gte('event_date', startDate)
      .lte('event_date', endDate)
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true })

    // By default, fetch ALL events for the date range and let client filter per-associate
    const includeAllScopes = options?.includeAllScopes ?? true

    if (!includeAllScopes) {
      // Build comprehensive scope filter that handles all scope types
      const scopeConditions: string[] = ['scope_type.eq.all']

      if (options?.areaId && isValidUUID(options.areaId)) {
        scopeConditions.push(
          `and(scope_type.eq.area,working_area_id.eq.${options.areaId})`
        )
      }

      if (options?.shiftScheduleId && isValidUUID(options.shiftScheduleId)) {
        scopeConditions.push(
          `and(scope_type.eq.shift,shift_schedule_id.eq.${options.shiftScheduleId})`
        )
      }

      if (options?.userId && isValidUUID(options.userId)) {
        scopeConditions.push(
          `and(scope_type.eq.user,assigned_user_ids.cs.{${options.userId}})`
        )
      }

      // Apply OR condition across all scope types
      if (scopeConditions.length > 0) {
        query = query.or(scopeConditions.join(','))
      }
    }

    if (options?.categoryId && isValidUUID(options.categoryId)) {
      query = query.eq('category_id', options.categoryId)
    }

    if (options?.status) {
      query = query.eq('status', options.status)
    } else {
      query = query.neq('status', 'cancelled')
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as TimelineEventWithCategory[]
  } catch (error) {
    logger.error('Error fetching events for date range:', error)
    throw error
  }
}

/**
 * Get parent/standalone events for management (excludes child instances)
 * Returns events that either:
 * 1. Have no parent (standalone or parent of recurring)
 * 2. Are recurring parents
 */
export async function getManageableEvents(
  organizationId: string,
  options?: {
    categoryId?: string
    status?: string
  }
): Promise<TimelineEventWithCategory[]> {
  try {
    let query = db
      .from('timeline_events')
      .select(
        `
        *,
        category:timeline_event_categories(*)
      `
      )
      .eq('organization_id', organizationId)
      .is('parent_event_id', null) // Only parent/standalone events
      .order('event_date', { ascending: false })
      .order('start_time', { ascending: true })

    if (options?.categoryId) {
      query = query.eq('category_id', options.categoryId)
    }

    if (options?.status) {
      query = query.eq('status', options.status)
    } else {
      query = query.neq('status', 'cancelled')
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as TimelineEventWithCategory[]
  } catch (error) {
    logger.error('Error fetching manageable events:', error)
    throw error
  }
}

/**
 * Get a single timeline event by ID
 */
export async function getEvent(
  eventId: string
): Promise<TimelineEventWithCategory | null> {
  try {
    const { data, error } = await db
      .from('timeline_events')
      .select(
        `
        *,
        category:timeline_event_categories(*)
      `
      )
      .eq('id', eventId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }
    return data as TimelineEventWithCategory
  } catch (error) {
    logger.error('Error fetching event:', error)
    throw error
  }
}

/**
 * Create a new timeline event
 */
export async function createEvent(
  organizationId: string,
  input: CreateTimelineEventInput
): Promise<TimelineEvent> {
  try {
    // duration_minutes is a GENERATED column - don't insert it
    const { data, error } = await db
      .from('timeline_events')
      .insert({
        organization_id: organizationId,
        ...input,
      })
      .select()
      .single()

    if (error) throw error
    return data as TimelineEvent
  } catch (error) {
    logger.error('Error creating event:', error)
    throw error
  }
}

/**
 * Create multiple events (for recurring events)
 */
export async function createEvents(
  organizationId: string,
  events: CreateTimelineEventInput[]
): Promise<TimelineEvent[]> {
  try {
    // duration_minutes is a GENERATED column - don't insert it
    const { data, error } = await db
      .from('timeline_events')
      .insert(
        events.map((event) => ({
          organization_id: organizationId,
          ...event,
        }))
      )
      .select()

    if (error) throw error
    return (data || []) as TimelineEvent[]
  } catch (error) {
    logger.error('Error creating events:', error)
    throw error
  }
}

/**
 * Update a timeline event
 */
export async function updateEvent(
  eventId: string,
  updates: UpdateTimelineEventInput
): Promise<TimelineEvent> {
  try {
    // If both start_time and end_time are provided, recalculate duration
    // If only one is provided, we need to fetch the existing event to calculate
    // duration_minutes is a GENERATED column - don't update it
    // The database will automatically recalculate it when start_time or end_time changes
    const updateData: Record<string, unknown> = { ...updates }

    const { data, error } = await db
      .from('timeline_events')
      .update(updateData)
      .eq('id', eventId)
      .select()
      .single()

    if (error) throw error
    return data as TimelineEvent
  } catch (error) {
    logger.error('Error updating event:', error)
    throw error
  }
}

/**
 * Cancel a timeline event
 */
export async function cancelEvent(eventId: string): Promise<void> {
  try {
    const { error } = await db
      .from('timeline_events')
      .update({ status: 'cancelled' })
      .eq('id', eventId)

    if (error) throw error
  } catch (error) {
    logger.error('Error cancelling event:', error)
    throw error
  }
}

/**
 * Delete a timeline event (permanent)
 */
export async function deleteEvent(eventId: string): Promise<void> {
  try {
    // First, check if this is a recurring event and delete any instances
    const { data: event } = await db
      .from('timeline_events')
      .select('is_recurring')
      .eq('id', eventId)
      .single()

    if (event?.is_recurring) {
      // Delete all recurring event instances first (cascade delete)
      await deleteRecurringEventInstances(eventId)
    }

    // Also delete any instances where this event is a child of another recurring event
    await db.from('timeline_events').delete().eq('parent_event_id', eventId)

    // Then delete the main event
    const { error } = await db
      .from('timeline_events')
      .delete()
      .eq('id', eventId)

    if (error) throw error
  } catch (error) {
    logger.error('Error deleting event:', error)
    throw error
  }
}

/**
 * Delete all recurring instances of an event
 */
export async function deleteRecurringEventInstances(
  parentEventId: string
): Promise<void> {
  try {
    const { error } = await db
      .from('timeline_events')
      .delete()
      .eq('parent_event_id', parentEventId)

    if (error) throw error
  } catch (error) {
    logger.error('Error deleting recurring event instances:', error)
    throw error
  }
}

// ===== RECURRING EVENTS =====

/**
 * Generate recurring event instances
 */
export async function generateRecurringInstances(
  parentEventId: string,
  endDate?: string
): Promise<number> {
  try {
    const { data, error } = await db.rpc('create_recurring_event_instances', {
      p_parent_event_id: parentEventId,
      p_end_date: endDate || null,
    })

    if (error) throw error
    return (data || 0) as number
  } catch (error) {
    logger.error('Error generating recurring instances:', error)
    throw error
  }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Convert timeline events to activity blocks for Gantt chart
 */
export function eventsToActivityBlocks(events: TimelineEventWithCategory[]): {
  startTime: string
  endTime: string
  type: 'event'
  eventType: string
  eventName: string
  color: string
  taskCount: number
  duration: number
}[] {
  return events.map((event) => ({
    startTime: `${event.event_date}T${event.start_time}`,
    endTime: `${event.event_date}T${event.end_time}`,
    type: 'event' as const,
    eventType: event.category?.category_code || 'custom',
    eventName: event.event_name,
    color: event.category?.color || '#6B7280',
    taskCount: 0,
    duration: event.duration_minutes,
  }))
}

/**
 * Check if a time range overlaps with an event
 */
export function doesTimeOverlapWithEvent(
  startTime: string,
  endTime: string,
  event: TimelineEvent
): boolean {
  const eventStart = event.start_time
  const eventEnd = event.end_time

  return startTime < eventEnd && endTime > eventStart
}

/**
 * Get events that overlap with a time range
 */
export function getOverlappingEvents(
  events: TimelineEvent[],
  startTime: string,
  endTime: string
): TimelineEvent[] {
  return events.filter((event) =>
    doesTimeOverlapWithEvent(startTime, endTime, event)
  )
}

// ===== USER FETCHING FOR EVENT ASSIGNMENT =====

export interface UserForEventAssignment {
  id: string
  full_name: string
  email: string
  avatar_url?: string
  working_area_id?: string
  working_area_name?: string
}

/**
 * Get all active users in an organization for event assignment
 */
export async function getUsersForEventAssignment(
  organizationId: string,
  options?: {
    workingAreaId?: string
    searchTerm?: string
    limit?: number
  }
): Promise<UserForEventAssignment[]> {
  try {
    // First get users from user_profiles
    let query = db
      .from('user_profiles')
      .select('id, full_name, email, avatar_url, status')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('full_name', { ascending: true })

    if (options?.searchTerm) {
      const sanitized = sanitizeSearchTerm(options.searchTerm)
      query = query.or(
        `full_name.ilike.%${sanitized}%,email.ilike.%${sanitized}%`
      )
    }

    if (options?.limit) {
      query = query.limit(options.limit)
    }

    const { data: users, error: usersError } = await query

    if (usersError) throw usersError
    if (!users || users.length === 0) return []

    // Get shift assignments to find working area assignments
    const userIds = users.map((u: any) => u.id)
    const { data: assignments, error: assignmentsError } = await db
      .from('shift_assignments')
      .select(
        `
        user_id,
        working_areas (
          id,
          area_name
        )
      `
      )
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .eq('is_primary_position', true)
      .in('user_id', userIds)

    if (assignmentsError) {
      logger.warn('Error fetching assignments:', assignmentsError)
    }

    // Create a map of user_id to working area
    const userAreaMap = new Map<string, { id: string; name: string }>()
    if (assignments) {
      for (const assignment of assignments) {
        if (assignment.working_areas) {
          userAreaMap.set(assignment.user_id, {
            id: assignment.working_areas.id,
            name: assignment.working_areas.area_name,
          })
        }
      }
    }

    // Map users with their working area info
    const result: UserForEventAssignment[] = users.map((user: any) => {
      const areaInfo = userAreaMap.get(user.id)
      return {
        id: user.id,
        full_name: user.full_name || user.email,
        email: user.email,
        avatar_url: user.avatar_url,
        working_area_id: areaInfo?.id,
        working_area_name: areaInfo?.name,
      }
    })

    // Filter by working area if specified
    if (options?.workingAreaId) {
      return result.filter((u) => u.working_area_id === options.workingAreaId)
    }

    return result
  } catch (error) {
    logger.error('Error fetching users for event assignment:', error)
    throw error
  }
}

/**
 * Get user names by their IDs
 */
export async function getUserNamesByIds(
  userIds: string[]
): Promise<Map<string, string>> {
  try {
    if (!userIds || userIds.length === 0) return new Map()

    const { data, error } = await db
      .from('user_profiles')
      .select('id, full_name, email')
      .in('id', userIds)

    if (error) throw error

    const nameMap = new Map<string, string>()
    for (const user of data || []) {
      nameMap.set(user.id, user.full_name || user.email || 'Unknown')
    }

    return nameMap
  } catch (error) {
    logger.error('Error fetching user names:', error)
    return new Map()
  }
}

/**
 * Get events for specific users (employee-specific events)
 */
export async function getEmployeeEvents(
  organizationId: string,
  options?: {
    userId?: string
    status?: string
    excludePast?: boolean
  }
): Promise<TimelineEventWithCategory[]> {
  try {
    const today = new Date().toISOString().split('T')[0]

    let query = db
      .from('timeline_events')
      .select(
        `
        *,
        category:timeline_event_categories(*)
      `
      )
      .eq('organization_id', organizationId)
      .eq('scope_type', 'user')
      .is('parent_event_id', null) // Only parent/standalone events
      .order('event_date', { ascending: false })
      .order('start_time', { ascending: true })

    if (options?.excludePast) {
      query = query.gte('event_date', today)
    }

    if (options?.status) {
      query = query.eq('status', options.status)
    } else {
      query = query.neq('status', 'cancelled')
    }

    const { data, error } = await query

    if (error) throw error

    // If a specific userId is requested, filter events that include that user
    if (options?.userId) {
      return ((data || []) as TimelineEventWithCategory[]).filter((event) =>
        event.assigned_user_ids?.includes(options.userId!)
      )
    }

    return (data || []) as TimelineEventWithCategory[]
  } catch (error) {
    logger.error('Error fetching employee events:', error)
    throw error
  }
}

/**
 * Get recurring area events (scope_type = 'area' and is_recurring = true)
 * These are recurring meetings applied to specific working areas
 */
export async function getRecurringAreaEvents(
  organizationId: string,
  options?: {
    categoryId?: string
    status?: string
    excludePast?: boolean
  }
): Promise<TimelineEventWithCategory[]> {
  try {
    const today = new Date().toISOString().split('T')[0]

    let query = db
      .from('timeline_events')
      .select(
        `
        *,
        category:timeline_event_categories(*)
      `
      )
      .eq('organization_id', organizationId)
      .eq('scope_type', 'area')
      .eq('is_recurring', true)
      .is('parent_event_id', null) // Only parent/standalone events
      .order('event_date', { ascending: false })
      .order('start_time', { ascending: true })

    if (options?.excludePast) {
      // For recurring events, check if the recurrence_end_date is in the future
      // or if the event_date is in the future
      query = query.or(
        `event_date.gte.${today},recurrence_end_date.gte.${today},recurrence_end_date.is.null`
      )
    }

    if (options?.categoryId) {
      query = query.eq('category_id', options.categoryId)
    }

    if (options?.status) {
      query = query.eq('status', options.status)
    } else {
      query = query.neq('status', 'cancelled')
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as TimelineEventWithCategory[]
  } catch (error) {
    logger.error('Error fetching recurring area events:', error)
    throw error
  }
}

/**
 * Get one-time team events (non-user scoped events that are NOT recurring)
 * These are one-time team meetings/events
 */
export async function getOneTimeTeamEvents(
  organizationId: string,
  options?: {
    categoryId?: string
    status?: string
    excludePast?: boolean
  }
): Promise<TimelineEventWithCategory[]> {
  try {
    const today = new Date().toISOString().split('T')[0]

    let query = db
      .from('timeline_events')
      .select(
        `
        *,
        category:timeline_event_categories(*)
      `
      )
      .eq('organization_id', organizationId)
      .neq('scope_type', 'user') // Exclude user-scoped events
      .eq('is_recurring', false) // Only non-recurring events
      .is('parent_event_id', null) // Only parent/standalone events
      .order('event_date', { ascending: false })
      .order('start_time', { ascending: true })

    if (options?.excludePast) {
      query = query.gte('event_date', today)
    }

    if (options?.categoryId) {
      query = query.eq('category_id', options.categoryId)
    }

    if (options?.status) {
      query = query.eq('status', options.status)
    } else {
      query = query.neq('status', 'cancelled')
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as TimelineEventWithCategory[]
  } catch (error) {
    logger.error('Error fetching one-time team events:', error)
    throw error
  }
}

/**
 * Get all events (past and present) for consolidated view
 */
export async function getAllEvents(
  organizationId: string,
  options?: {
    categoryId?: string
    includeAllStatuses?: boolean
  }
): Promise<TimelineEventWithCategory[]> {
  try {
    let query = db
      .from('timeline_events')
      .select(
        `
        *,
        category:timeline_event_categories(*)
      `
      )
      .eq('organization_id', organizationId)
      .is('parent_event_id', null) // Only parent/standalone events
      .order('event_date', { ascending: false })
      .order('start_time', { ascending: true })

    if (options?.categoryId) {
      query = query.eq('category_id', options.categoryId)
    }

    if (!options?.includeAllStatuses) {
      query = query.neq('status', 'cancelled')
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as TimelineEventWithCategory[]
  } catch (error) {
    logger.error('Error fetching all events:', error)
    throw error
  }
}

export default {
  // Categories
  getEventCategories,
  initializeEventCategories,
  createEventCategory,
  updateEventCategory,
  deleteEventCategory,
  // Events
  getEventsForDate,
  getEventsForDateRange,
  getManageableEvents,
  getEmployeeEvents,
  getRecurringAreaEvents,
  getOneTimeTeamEvents,
  getAllEvents,
  getEvent,
  createEvent,
  createEvents,
  updateEvent,
  cancelEvent,
  deleteEvent,
  deleteRecurringEventInstances,
  generateRecurringInstances,
  // User fetching
  getUsersForEventAssignment,
  getUserNamesByIds,
  // Utilities
  eventsToActivityBlocks,
  doesTimeOverlapWithEvent,
  getOverlappingEvents,
}
// Developer and Creator: Jai Singh
