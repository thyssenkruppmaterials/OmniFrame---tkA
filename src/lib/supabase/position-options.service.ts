// Created and developed by Jai Singh
/**
 * Position Options Service
 * Manages customizable position types and levels per organization
 * Created: October 25, 2025
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// ===== TYPESCRIPT INTERFACES =====

export interface PositionTypeOption {
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

export interface PositionLevelOption {
  id: string
  organization_id: string
  level_value: number
  level_label: string
  description?: string
  display_order: number
  is_active: boolean
  color_code?: string
  created_by?: string
  created_at: string
  updated_at: string
}

// ===== POSITION TYPE OPTIONS SERVICE =====

class PositionOptionsService {
  private static instance: PositionOptionsService

  static getInstance(): PositionOptionsService {
    if (!PositionOptionsService.instance) {
      PositionOptionsService.instance = new PositionOptionsService()
    }
    return PositionOptionsService.instance
  }

  // ===== POSITION TYPE OPERATIONS =====

  async getPositionTypes(
    organizationId: string
  ): Promise<PositionTypeOption[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('position_type_options')
        .select('*')
        .eq('organization_id', organizationId)
        .order('display_order', { ascending: true })

      if (error) throw error
      return (data || []) as PositionTypeOption[]
    } catch (error) {
      logger.error('Error fetching position types:', error)
      throw error
    }
  }

  async getActivePositionTypes(
    organizationId: string
  ): Promise<PositionTypeOption[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('position_type_options')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })

      if (error) throw error
      return (data || []) as PositionTypeOption[]
    } catch (error) {
      logger.error('Error fetching active position types:', error)
      throw error
    }
  }

  async createPositionType(typeData: {
    organization_id: string
    type_value: string
    type_label: string
    description?: string
    display_order?: number
    color_code?: string
    icon_name?: string
  }): Promise<PositionTypeOption> {
    try {
      // Get user for audit
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { data, error } = await (supabase as any)
        .from('position_type_options')
        .insert({
          ...typeData,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error
      return data as PositionTypeOption
    } catch (error) {
      logger.error('Error creating position type:', error)
      throw error
    }
  }

  async updatePositionType(
    id: string,
    updates: Partial<
      Omit<
        PositionTypeOption,
        'id' | 'organization_id' | 'created_by' | 'created_at' | 'updated_at'
      >
    >
  ): Promise<PositionTypeOption> {
    try {
      const { data, error } = await (supabase as any)
        .from('position_type_options')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as PositionTypeOption
    } catch (error) {
      logger.error('Error updating position type:', error)
      throw error
    }
  }

  async deletePositionType(id: string): Promise<void> {
    try {
      const { error } = await (supabase as any)
        .from('position_type_options')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      logger.error('Error deleting position type:', error)
      throw error
    }
  }

  async reorderPositionTypes(
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
          .from('position_type_options')
          .update({ display_order: update.display_order })
          .eq('id', update.id)
          .eq('organization_id', organizationId)
      }
    } catch (error) {
      logger.error('Error reordering position types:', error)
      throw error
    }
  }

  // ===== POSITION LEVEL OPERATIONS =====

  async getPositionLevels(
    organizationId: string
  ): Promise<PositionLevelOption[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('position_level_options')
        .select('*')
        .eq('organization_id', organizationId)
        .order('level_value', { ascending: true })

      if (error) throw error
      return (data || []) as PositionLevelOption[]
    } catch (error) {
      logger.error('Error fetching position levels:', error)
      throw error
    }
  }

  async getActivePositionLevels(
    organizationId: string
  ): Promise<PositionLevelOption[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('position_level_options')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('level_value', { ascending: true })

      if (error) throw error
      return (data || []) as PositionLevelOption[]
    } catch (error) {
      logger.error('Error fetching active position levels:', error)
      throw error
    }
  }

  async createPositionLevel(levelData: {
    organization_id: string
    level_value: number
    level_label: string
    description?: string
    display_order?: number
    color_code?: string
  }): Promise<PositionLevelOption> {
    try {
      // Get user for audit
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { data, error } = await (supabase as any)
        .from('position_level_options')
        .insert({
          ...levelData,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error
      return data as PositionLevelOption
    } catch (error) {
      logger.error('Error creating position level:', error)
      throw error
    }
  }

  async updatePositionLevel(
    id: string,
    updates: Partial<
      Omit<
        PositionLevelOption,
        'id' | 'organization_id' | 'created_by' | 'created_at' | 'updated_at'
      >
    >
  ): Promise<PositionLevelOption> {
    try {
      const { data, error } = await (supabase as any)
        .from('position_level_options')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as PositionLevelOption
    } catch (error) {
      logger.error('Error updating position level:', error)
      throw error
    }
  }

  async deletePositionLevel(id: string): Promise<void> {
    try {
      const { error } = await (supabase as any)
        .from('position_level_options')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      logger.error('Error deleting position level:', error)
      throw error
    }
  }

  async reorderPositionLevels(
    organizationId: string,
    orderedIds: string[]
  ): Promise<void> {
    try {
      // Update display_order for each level
      const updates = orderedIds.map((id, index) => ({
        id,
        display_order: index,
      }))

      for (const update of updates) {
        await (supabase as any)
          .from('position_level_options')
          .update({ display_order: update.display_order })
          .eq('id', update.id)
          .eq('organization_id', organizationId)
      }
    } catch (error) {
      logger.error('Error reordering position levels:', error)
      throw error
    }
  }

  // ===== SEED DEFAULT OPTIONS =====
  // Manually seed defaults for an organization (called from frontend)
  async seedDefaults(organizationId: string): Promise<void> {
    try {
      const { error } = await (supabase as any).rpc('seed_position_options', {
        p_organization_id: organizationId,
      })

      if (error) throw error
    } catch (error) {
      logger.error('Error seeding default position options:', error)
      throw error
    }
  }
}

export const positionOptionsService = PositionOptionsService.getInstance()

// Created and developed by Jai Singh
