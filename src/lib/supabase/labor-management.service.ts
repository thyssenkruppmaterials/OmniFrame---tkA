// Created and developed by Jai Singh
/**
 * Labor Management Service
 * Comprehensive service for managing shift hierarchy, positions, and organizational structure
 * Created: October 19, 2025
 */
import { logger } from '@/lib/utils/logger'
import type { ReassignmentResult } from '@/features/shift-productivity/team-performance/types/team-performance.types'
import { supabase } from './client'

// ===== TYPESCRIPT INTERFACES =====

export interface WorkingArea {
  id: string
  organization_id: string
  area_code: string
  area_name: string
  area_type: string
  description?: string
  location_details?: Record<string, unknown>
  capacity?: number
  is_active: boolean
  requires_certification: boolean
  required_certifications?: string[]
  primary_supervisor_id?: string
  backup_supervisor_id?: string
  operating_hours?: { start: string; end: string }
  operating_days?: number[]
  created_by?: string
  created_at: string
  updated_at: string
}

export interface ShiftPosition {
  id: string
  organization_id: string
  position_code: string
  position_title: string
  position_type: string
  position_level: number
  description?: string
  responsibilities?: string
  required_skills?: string[]
  required_certifications?: string[]
  pay_grade?: string
  reports_to_position_id?: string
  department?: string
  headcount_budget: number
  is_supervisory: boolean
  requires_background_check: boolean
  minimum_experience_years?: number
  is_active: boolean
  effective_date: string
  end_date?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface ShiftAssignment {
  id: string
  organization_id: string
  user_id: string
  position_id: string
  working_area_id?: string
  assignment_type: string
  shift_pattern: string
  shift_schedule?: {
    days: number[]
    start_time: string
    end_time: string
  }
  shift_schedule_id?: string // Link to shift_schedules table
  direct_supervisor_id?: string
  team_lead_id?: string
  status: string
  start_date: string
  end_date?: string
  is_primary_position: boolean
  productivity_target?: number
  quality_target?: number
  assignment_notes?: string
  custom_attributes?: Record<string, unknown>
  assigned_by?: string
  assigned_at: string
  created_at: string
  updated_at: string
}

export interface OrganizationalHierarchy {
  id: string
  organization_id: string
  subordinate_id: string
  supervisor_id: string
  relationship_type: string
  effective_from: string
  effective_to?: string
  level_difference: number
  delegation_authority?: string[]
  is_active: boolean
  created_by?: string
  created_at: string
  updated_at: string
}

export interface BreakPeriod {
  break_name: string
  start_time: string
  duration_minutes: number
  is_paid: boolean
}

export interface ShiftSchedule {
  id: string
  organization_id: string
  schedule_name: string
  schedule_code?: string
  schedule_type: string
  shift_start_time: string
  shift_end_time: string
  break_duration_minutes: number
  break_start_time?: string
  breaks?: BreakPeriod[]
  operating_days: number[]
  min_headcount: number
  max_headcount?: number
  target_headcount?: number
  applicable_positions?: string[]
  applicable_areas?: string[]
  is_active: boolean
  effective_from: string
  effective_to?: string
  description?: string
  color?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface LaborStandard {
  id: string
  organization_id: string
  standard_name: string
  standard_type: string
  position_id?: string
  working_area_id?: string
  task_type?: string
  target_value: number
  unit_of_measure: string
  minimum_acceptable?: number
  maximum_acceptable?: number
  excellent_threshold?: number
  applies_to_shifts?: string[]
  applies_to_days?: number[]
  is_active: boolean
  effective_from: string
  effective_to?: string
  created_by?: string
  created_at: string
  updated_at: string
}

// ===== EXTENDED INTERFACES FOR UI =====

export interface ShiftAssignmentWithDetails extends ShiftAssignment {
  user_full_name?: string
  user_email?: string
  position_title?: string
  area_name?: string
  supervisor_name?: string
  team_lead_name?: string
}

export interface PositionWithHierarchy extends ShiftPosition {
  reports_to_title?: string
  current_headcount: number
  direct_reports?: PositionWithHierarchy[]
}

// ===== SERVICE CLASS =====

export class LaborManagementService {
  private static instance: LaborManagementService

  private constructor() {}

  static getInstance(): LaborManagementService {
    if (!LaborManagementService.instance) {
      LaborManagementService.instance = new LaborManagementService()
    }
    return LaborManagementService.instance
  }

  // ===== WORKING AREAS =====

  async getWorkingAreas(organizationId: string): Promise<WorkingArea[]> {
    const { data, error } = await (supabase as any)
      .from('working_areas')
      .select('*')
      .eq('organization_id', organizationId)
      .order('area_code', { ascending: true })

    if (error) {
      logger.error('Error fetching working areas:', error)
      throw error
    }

    return (data || []) as WorkingArea[]
  }

  async createWorkingArea(area: Partial<WorkingArea>): Promise<WorkingArea> {
    const { data, error } = await (supabase as any)
      .from('working_areas')
      .insert([area])
      .select()
      .single()

    if (error) {
      logger.error('Error creating working area:', error)
      throw error
    }

    return data as WorkingArea
  }

  async updateWorkingArea(
    id: string,
    updates: Partial<WorkingArea>
  ): Promise<WorkingArea> {
    const { data, error } = await (supabase as any)
      .from('working_areas')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating working area:', error)
      throw error
    }

    return data as WorkingArea
  }

  async deleteWorkingArea(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('working_areas')
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('Error deleting working area:', error)
      throw error
    }
  }

  async getWorkingAreaStatistics(organizationId: string): Promise<any> {
    const { data, error } = await (supabase as any).rpc(
      'get_working_area_statistics',
      { p_organization_id: organizationId }
    )

    if (error) {
      logger.error('Error fetching working area statistics:', error)
      return {}
    }

    return data || {}
  }

  // ===== SHIFT POSITIONS =====

  async getShiftPositions(organizationId: string): Promise<ShiftPosition[]> {
    const { data, error } = await (supabase as any)
      .from('shift_positions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('position_level', { ascending: true })
      .order('position_title', { ascending: true })

    if (error) {
      logger.error('Error fetching shift positions:', error)
      throw error
    }

    return (data || []) as ShiftPosition[]
  }

  async getPositionHierarchy(organizationId: string): Promise<any[]> {
    const { data, error } = await (supabase as any).rpc(
      'get_position_hierarchy',
      { p_organization_id: organizationId }
    )

    if (error) {
      logger.error('Error fetching position hierarchy:', error)
      throw error
    }

    return (Array.isArray(data) ? data : []) as any[]
  }

  async createShiftPosition(
    position: Partial<ShiftPosition>
  ): Promise<ShiftPosition> {
    const { data, error } = await (supabase as any)
      .from('shift_positions')
      .insert([position])
      .select()
      .single()

    if (error) {
      logger.error('Error creating shift position:', error)
      throw error
    }

    return data as ShiftPosition
  }

  async updateShiftPosition(
    id: string,
    updates: Partial<ShiftPosition>
  ): Promise<ShiftPosition> {
    const { data, error } = await (supabase as any)
      .from('shift_positions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating shift position:', error)
      throw error
    }

    return data as ShiftPosition
  }

  async deleteShiftPosition(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('shift_positions')
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('Error deleting shift position:', error)
      throw error
    }
  }

  async getPositionStatistics(organizationId: string): Promise<any> {
    const { data, error } = await (supabase as any).rpc(
      'get_position_statistics',
      { p_organization_id: organizationId }
    )

    if (error) {
      logger.error('Error fetching position statistics:', error)
      return {}
    }

    return data || {}
  }

  // ===== SHIFT ASSIGNMENTS =====

  async getShiftAssignments(
    organizationId: string
  ): Promise<ShiftAssignmentWithDetails[]> {
    const { data, error } = await (supabase as any)
      .from('shift_assignments')
      .select(
        `
        *,
        user_profiles!shift_assignments_user_id_fkey (
          full_name,
          email
        ),
        shift_positions (
          position_title
        ),
        working_areas (
          area_name
        ),
        supervisor:user_profiles!shift_assignments_direct_supervisor_id_fkey (
          full_name
        ),
        team_lead:user_profiles!shift_assignments_team_lead_id_fkey (
          full_name
        )
      `
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Error fetching shift assignments:', error)
      throw error
    }

    // Transform the nested data
    const transformed = ((data || []) as any[]).map((assignment: any) => ({
      ...assignment,
      user_full_name: assignment.user_profiles?.full_name,
      user_email: assignment.user_profiles?.email,
      position_title: assignment.shift_positions?.position_title,
      area_name: assignment.working_areas?.area_name,
      supervisor_name: assignment.supervisor?.full_name,
      team_lead_name: assignment.team_lead?.full_name,
    }))

    return transformed as ShiftAssignmentWithDetails[]
  }

  async createShiftAssignment(
    assignment: Partial<ShiftAssignment>
  ): Promise<ShiftAssignment> {
    const { data, error } = await (supabase as any)
      .from('shift_assignments')
      .insert([assignment])
      .select()
      .single()

    if (error) {
      logger.error('Error creating shift assignment:', error)
      throw error
    }

    return data as ShiftAssignment
  }

  async updateShiftAssignment(
    id: string,
    updates: Partial<ShiftAssignment>
  ): Promise<ShiftAssignment> {
    const { data, error } = await (supabase as any)
      .from('shift_assignments')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating shift assignment:', error)
      throw error
    }

    return data as ShiftAssignment
  }

  async deleteShiftAssignment(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('shift_assignments')
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('Error deleting shift assignment:', error)
      throw error
    }
  }

  async getUserCurrentPosition(userId: string): Promise<any> {
    const { data, error } = await (supabase as any).rpc(
      'get_user_current_position',
      { p_user_id: userId }
    )

    if (error) {
      logger.error('Error fetching user current position:', error)
      return null
    }

    return data?.[0] || null
  }

  // ===== ORGANIZATIONAL HIERARCHY =====

  async getOrganizationalTree(
    organizationId: string,
    rootUserId?: string
  ): Promise<any[]> {
    const { data, error } = await (supabase as any).rpc(
      'get_organizational_tree',
      {
        p_organization_id: organizationId,
        p_root_user_id: rootUserId || null,
      }
    )

    if (error) {
      logger.error('Error fetching organizational tree:', error)
      throw error
    }

    return (Array.isArray(data) ? data : []) as any[]
  }

  async createHierarchyRelationship(
    hierarchy: Partial<OrganizationalHierarchy>
  ): Promise<OrganizationalHierarchy> {
    const { data, error } = await (supabase as any)
      .from('organizational_hierarchy')
      .insert([hierarchy])
      .select()
      .single()

    if (error) {
      logger.error('Error creating hierarchy relationship:', error)
      throw error
    }

    return data as OrganizationalHierarchy
  }

  async updateHierarchyRelationship(
    id: string,
    updates: Partial<OrganizationalHierarchy>
  ): Promise<OrganizationalHierarchy> {
    const { data, error } = await (supabase as any)
      .from('organizational_hierarchy')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating hierarchy relationship:', error)
      throw error
    }

    return data as OrganizationalHierarchy
  }

  async deleteHierarchyRelationship(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('organizational_hierarchy')
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('Error deleting hierarchy relationship:', error)
      throw error
    }
  }

  // ===== SHIFT SCHEDULES =====

  async getShiftSchedules(organizationId: string): Promise<ShiftSchedule[]> {
    const { data, error } = await (supabase as any)
      .from('shift_schedules')
      .select('*')
      .eq('organization_id', organizationId)
      .order('schedule_code', { ascending: true })

    if (error) {
      logger.error('Error fetching shift schedules:', error)
      throw error
    }

    return (data || []) as ShiftSchedule[]
  }

  async createShiftSchedule(
    schedule: Partial<ShiftSchedule>
  ): Promise<ShiftSchedule> {
    const { data, error } = await (supabase as any)
      .from('shift_schedules')
      .insert([schedule])
      .select()
      .single()

    if (error) {
      logger.error('Error creating shift schedule:', error)
      throw error
    }

    return data as ShiftSchedule
  }

  async updateShiftSchedule(
    id: string,
    updates: Partial<ShiftSchedule>
  ): Promise<ShiftSchedule> {
    const { data, error } = await (supabase as any)
      .from('shift_schedules')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating shift schedule:', error)
      throw error
    }

    return data as ShiftSchedule
  }

  async deleteShiftSchedule(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('shift_schedules')
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('Error deleting shift schedule:', error)
      throw error
    }
  }

  // ===== LABOR STANDARDS =====

  async getLaborStandards(organizationId: string): Promise<LaborStandard[]> {
    const { data, error } = await (supabase as any)
      .from('labor_standards')
      .select('*')
      .eq('organization_id', organizationId)
      .order('standard_name', { ascending: true })

    if (error) {
      logger.error('Error fetching labor standards:', error)
      throw error
    }

    return (data || []) as LaborStandard[]
  }

  async createLaborStandard(
    standard: Partial<LaborStandard>
  ): Promise<LaborStandard> {
    const { data, error } = await (supabase as any)
      .from('labor_standards')
      .insert([standard])
      .select()
      .single()

    if (error) {
      logger.error('Error creating labor standard:', error)
      throw error
    }

    return data as LaborStandard
  }

  async updateLaborStandard(
    id: string,
    updates: Partial<LaborStandard>
  ): Promise<LaborStandard> {
    const { data, error } = await (supabase as any)
      .from('labor_standards')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating labor standard:', error)
      throw error
    }

    return data as LaborStandard
  }

  async deleteLaborStandard(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('labor_standards')
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('Error deleting labor standard:', error)
      throw error
    }
  }

  // ===== BULK OPERATIONS =====

  async bulkCreatePositions(
    positions: Partial<ShiftPosition>[]
  ): Promise<ShiftPosition[]> {
    const { data, error } = await (supabase as any)
      .from('shift_positions')
      .insert(positions)
      .select()

    if (error) {
      logger.error('Error bulk creating positions:', error)
      throw error
    }

    return (data || []) as ShiftPosition[]
  }

  async bulkCreateAssignments(
    assignments: Partial<ShiftAssignment>[]
  ): Promise<ShiftAssignment[]> {
    const { data, error } = await (supabase as any)
      .from('shift_assignments')
      .insert(assignments)
      .select()

    if (error) {
      logger.error('Error bulk creating assignments:', error)
      throw error
    }

    return (data || []) as ShiftAssignment[]
  }

  // ===== SEARCH AND FILTER =====

  async searchUsers(
    organizationId: string,
    searchTerm: string
  ): Promise<any[]> {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, full_name, email, role_id, roles(name), status')
      .eq('organization_id', organizationId)
      .or(`full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      .limit(20)

    if (error) {
      logger.error('Error searching users:', error)
      return []
    }

    return data || []
  }

  async getAvailableUsers(organizationId: string): Promise<any[]> {
    // Get users who don't have active primary positions
    const { data: allUsers, error: usersError } = await supabase
      .from('user_profiles')
      .select('id, full_name, email, role_id, roles(name), status')
      .eq('organization_id', organizationId)
      .eq('status', 'active')

    if (usersError) {
      logger.error('Error fetching users:', usersError)
      return []
    }

    const { data: assignedUsers, error: assignmentsError } = await (
      supabase as any
    )
      .from('shift_assignments')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .eq('is_primary_position', true)

    if (assignmentsError) {
      logger.error('Error fetching assignments:', assignmentsError)
      return allUsers || []
    }

    const assignedUserIds = new Set(
      ((assignedUsers || []) as any[]).map((a) => a.user_id)
    )
    return (allUsers || []).filter((user) => !assignedUserIds.has(user.id))
  }

  // ===== TEAM PERFORMANCE METHODS =====

  /**
   * Get currently active associates with their assignments
   */
  async getActiveAssociates(
    organizationId: string
  ): Promise<ShiftAssignmentWithDetails[]> {
    const { data, error } = await (supabase as any)
      .from('shift_assignments')
      .select(
        `
        *,
        user_profiles!shift_assignments_user_id_fkey (
          id,
          full_name,
          email,
          avatar_url,
          status
        ),
        shift_positions (
          id,
          position_title,
          department,
          position_type
        ),
        working_areas (
          id,
          area_code,
          area_name,
          area_type
        )
      `
      )
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .eq('is_primary_position', true)

    if (error) {
      logger.error('Error fetching active associates:', error)
      throw error
    }

    // Transform the nested data
    const transformed = ((data || []) as any[]).map((assignment: any) => ({
      ...assignment,
      user_full_name: assignment.user_profiles?.full_name,
      user_email: assignment.user_profiles?.email,
      position_title: assignment.shift_positions?.position_title,
      area_name: assignment.working_areas?.area_name,
    }))

    return transformed as ShiftAssignmentWithDetails[]
  }

  /**
   * Get shift assignments grouped by department
   */
  async getAssignmentsByDepartment(
    organizationId: string
  ): Promise<Map<string, ShiftAssignmentWithDetails[]>> {
    const assignments = await this.getActiveAssociates(organizationId)
    const departmentMap = new Map<string, ShiftAssignmentWithDetails[]>()

    for (const assignment of assignments) {
      // Get department from position
      const { data: position } = await (supabase as any)
        .from('shift_positions')
        .select('department')
        .eq('id', assignment.position_id)
        .single()

      const department = position?.department || 'Unassigned'

      if (!departmentMap.has(department)) {
        departmentMap.set(department, [])
      }
      departmentMap.get(department)!.push(assignment)
    }

    return departmentMap
  }

  /**
   * Get shift assignments grouped by working area
   */
  async getAssignmentsByArea(
    organizationId: string
  ): Promise<Map<string, ShiftAssignmentWithDetails[]>> {
    const assignments = await this.getActiveAssociates(organizationId)
    const areaMap = new Map<string, ShiftAssignmentWithDetails[]>()

    for (const assignment of assignments) {
      const areaId = assignment.working_area_id || 'unassigned'

      if (!areaMap.has(areaId)) {
        areaMap.set(areaId, [])
      }
      areaMap.get(areaId)!.push(assignment)
    }

    return areaMap
  }

  /**
   * Get labor standards for a specific task type
   */
  async getLaborStandardsByTaskType(
    organizationId: string,
    taskType: string
  ): Promise<LaborStandard[]> {
    const { data, error } = await (supabase as any)
      .from('labor_standards')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .ilike('task_type', `%${taskType}%`)

    if (error) {
      logger.error('Error fetching labor standards by task type:', error)
      return []
    }

    return (data || []) as LaborStandard[]
  }

  /**
   * Get all active labor standards with position and area details
   */
  async getActiveLaborStandardsWithDetails(
    organizationId: string
  ): Promise<any[]> {
    const { data, error } = await (supabase as any)
      .from('labor_standards')
      .select(
        `
        *,
        shift_positions (
          position_title,
          department
        ),
        working_areas (
          area_name,
          area_code
        )
      `
      )
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('standard_name', { ascending: true })

    if (error) {
      logger.error('Error fetching labor standards with details:', error)
      return []
    }

    return data || []
  }

  /**
   * Get distinct departments from shift positions
   */
  async getDistinctDepartments(organizationId: string): Promise<string[]> {
    const { data, error } = await (supabase as any)
      .from('shift_positions')
      .select('department')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .not('department', 'is', null)

    if (error) {
      logger.error('Error fetching departments:', error)
      return []
    }

    const departments = new Set<string>()
    for (const row of (data || []) as any[]) {
      if (row.department) {
        departments.add(row.department)
      }
    }

    return Array.from(departments).sort()
  }

  /**
   * Reassign an associate to a new working area
   * Uses RPC with optimistic locking, capacity validation, and audit logging
   * @param userId - The associate's user ID
   * @param organizationId - The organization ID
   * @param newAreaId - The target area ID (null to unassign)
   * @param expectedUpdatedAt - For optimistic concurrency control
   * @param reassignedBy - The user performing the reassignment
   * @param reason - Optional reason for the reassignment
   * @returns Result object with success status and error details if failed
   */
  async reassignAssociateToArea(
    userId: string,
    organizationId: string,
    newAreaId: string | null,
    expectedUpdatedAt: string | null,
    reassignedBy: string,
    reason?: string
  ): Promise<ReassignmentResult> {
    const { data, error } = await (supabase as any).rpc(
      'reassign_associate_to_area',
      {
        p_user_id: userId,
        p_organization_id: organizationId,
        p_new_area_id: newAreaId,
        p_expected_updated_at: expectedUpdatedAt,
        p_reassigned_by: reassignedBy,
        p_reason: reason || null,
      }
    )

    if (error) {
      logger.error('Error reassigning associate:', error)
      throw new Error(error.message)
    }

    return data
  }
}

export default LaborManagementService.getInstance()

// Created and developed by Jai Singh
