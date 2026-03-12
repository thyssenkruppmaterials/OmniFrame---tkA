/**
 * Area Options Service
 * Manages configurable area types and departments per organization
 * Created: December 25, 2025
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// ===== TYPESCRIPT INTERFACES =====

export interface AreaTypeOption {
  id: string
  organization_id: string
  type_value: string
  type_label: string
  description?: string
  display_order: number
  is_active: boolean
  color_code?: string
  icon_name?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface DepartmentOption {
  id: string
  organization_id: string
  department_value: string
  department_label: string
  description?: string
  display_order: number
  is_active: boolean
  color_code?: string
  icon_name?: string
  created_by?: string
  created_at: string
  updated_at: string
}

// ===== AREA OPTIONS SERVICE =====

class AreaOptionsService {
  private static instance: AreaOptionsService

  static getInstance(): AreaOptionsService {
    if (!AreaOptionsService.instance) {
      AreaOptionsService.instance = new AreaOptionsService()
    }
    return AreaOptionsService.instance
  }

  // ===== AREA TYPE OPERATIONS =====

  async getAreaTypes(organizationId: string): Promise<AreaTypeOption[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('area_type_options')
        .select('*')
        .eq('organization_id', organizationId)
        .order('display_order', { ascending: true })

      if (error) throw error
      return (data || []) as AreaTypeOption[]
    } catch (error) {
      logger.error('Error fetching area types:', error)
      throw error
    }
  }

  async getActiveAreaTypes(organizationId: string): Promise<AreaTypeOption[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('area_type_options')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })

      if (error) throw error
      return (data || []) as AreaTypeOption[]
    } catch (error) {
      logger.error('Error fetching active area types:', error)
      throw error
    }
  }

  async createAreaType(typeData: {
    organization_id: string
    type_value: string
    type_label: string
    description?: string
    display_order?: number
    color_code?: string
    icon_name?: string
  }): Promise<AreaTypeOption> {
    try {
      // Get user for audit
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { data, error } = await (supabase as any)
        .from('area_type_options')
        .insert({
          ...typeData,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error
      return data as AreaTypeOption
    } catch (error) {
      logger.error('Error creating area type:', error)
      throw error
    }
  }

  async updateAreaType(
    id: string,
    updates: Partial<
      Omit<
        AreaTypeOption,
        'id' | 'organization_id' | 'created_by' | 'created_at' | 'updated_at'
      >
    >
  ): Promise<AreaTypeOption> {
    try {
      const { data, error } = await (supabase as any)
        .from('area_type_options')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as AreaTypeOption
    } catch (error) {
      logger.error('Error updating area type:', error)
      throw error
    }
  }

  async deleteAreaType(id: string): Promise<void> {
    try {
      const { error } = await (supabase as any)
        .from('area_type_options')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      logger.error('Error deleting area type:', error)
      throw error
    }
  }

  async reorderAreaTypes(
    organizationId: string,
    orderedIds: string[]
  ): Promise<void> {
    try {
      // Update display_order for each type
      const updates = orderedIds.map((id, index) => ({
        id,
        display_order: index,
      }))

      for (const update of updates) {
        await (supabase as any)
          .from('area_type_options')
          .update({ display_order: update.display_order })
          .eq('id', update.id)
          .eq('organization_id', organizationId)
      }
    } catch (error) {
      logger.error('Error reordering area types:', error)
      throw error
    }
  }

  // ===== DEPARTMENT OPERATIONS =====

  async getDepartments(organizationId: string): Promise<DepartmentOption[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('department_options')
        .select('*')
        .eq('organization_id', organizationId)
        .order('display_order', { ascending: true })

      if (error) throw error
      return (data || []) as DepartmentOption[]
    } catch (error) {
      logger.error('Error fetching departments:', error)
      throw error
    }
  }

  async getActiveDepartments(
    organizationId: string
  ): Promise<DepartmentOption[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('department_options')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })

      if (error) throw error
      return (data || []) as DepartmentOption[]
    } catch (error) {
      logger.error('Error fetching active departments:', error)
      throw error
    }
  }

  async createDepartment(deptData: {
    organization_id: string
    department_value: string
    department_label: string
    description?: string
    display_order?: number
    color_code?: string
    icon_name?: string
  }): Promise<DepartmentOption> {
    try {
      // Get user for audit
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { data, error } = await (supabase as any)
        .from('department_options')
        .insert({
          ...deptData,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error
      return data as DepartmentOption
    } catch (error) {
      logger.error('Error creating department:', error)
      throw error
    }
  }

  async updateDepartment(
    id: string,
    updates: Partial<
      Omit<
        DepartmentOption,
        'id' | 'organization_id' | 'created_by' | 'created_at' | 'updated_at'
      >
    >
  ): Promise<DepartmentOption> {
    try {
      const { data, error } = await (supabase as any)
        .from('department_options')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as DepartmentOption
    } catch (error) {
      logger.error('Error updating department:', error)
      throw error
    }
  }

  async deleteDepartment(id: string): Promise<void> {
    try {
      const { error } = await (supabase as any)
        .from('department_options')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      logger.error('Error deleting department:', error)
      throw error
    }
  }

  async reorderDepartments(
    organizationId: string,
    orderedIds: string[]
  ): Promise<void> {
    try {
      // Update display_order for each department
      const updates = orderedIds.map((id, index) => ({
        id,
        display_order: index,
      }))

      for (const update of updates) {
        await (supabase as any)
          .from('department_options')
          .update({ display_order: update.display_order })
          .eq('id', update.id)
          .eq('organization_id', organizationId)
      }
    } catch (error) {
      logger.error('Error reordering departments:', error)
      throw error
    }
  }

  // ===== SEED DEFAULT OPTIONS =====
  async seedDefaults(organizationId: string): Promise<void> {
    try {
      const { error } = await (supabase as any).rpc(
        'seed_area_and_department_options',
        {
          p_organization_id: organizationId,
        }
      )

      if (error) throw error
    } catch (error) {
      logger.error('Error seeding default area and department options:', error)
      throw error
    }
  }
}

export const areaOptionsService = AreaOptionsService.getInstance()
// Developer and Creator: Jai Singh
