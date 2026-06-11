// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

export type KittingOptionGroup =
  | 'engine_program'
  | 'kit_type'
  | 'kit_container_type'
  | 'bom_line_container_type'
  | 'charge_code'
  | 'dock_location'

export interface KittingDropdownOption {
  id: string
  organization_id: string
  option_group: KittingOptionGroup
  option_value: string
  option_label: string
  description?: string | null
  display_order: number
  is_active: boolean
  created_by?: string | null
  created_at: string
  updated_at: string
}

export const KITTING_OPTION_GROUPS: Array<{
  value: KittingOptionGroup
  label: string
  description: string
}> = [
  {
    value: 'engine_program',
    label: 'Engine Programs',
    description: 'Used in kit definitions and build plans.',
  },
  {
    value: 'kit_type',
    label: 'Kit Types',
    description: 'Used in the kit definition metadata.',
  },
  {
    value: 'kit_container_type',
    label: 'Kit Container Types',
    description:
      'Used at the kit definition level and shown on build plans/sheets.',
  },
  {
    value: 'bom_line_container_type',
    label: 'BOM Line Container Types',
    description:
      'Used on individual BOM lines to describe where that part sits in the finished kit.',
  },
  {
    value: 'charge_code',
    label: 'Charge Codes',
    description: 'Used in kit definitions and shown on the build sheet.',
  },
  {
    value: 'dock_location',
    label: 'Dock Locations',
    description:
      'Used by the RF Dock Staging flow. Operators scan one of these values to confirm a built/inspected kit is on the dock and ready for shipping.',
  },
]

class KittingOptionsService {
  private static instance: KittingOptionsService

  static getInstance() {
    if (!KittingOptionsService.instance) {
      KittingOptionsService.instance = new KittingOptionsService()
    }
    return KittingOptionsService.instance
  }

  async listOptions(
    organizationId: string,
    optionGroups?: KittingOptionGroup[]
  ): Promise<KittingDropdownOption[]> {
    try {
      let query = (supabase as any)
        .from('kitting_dropdown_options')
        .select('*')
        .eq('organization_id', organizationId)
        .order('option_group', { ascending: true })
        .order('display_order', { ascending: true })

      if (optionGroups && optionGroups.length > 0) {
        query = query.in('option_group', optionGroups)
      }

      const { data, error } = await query
      if (error) throw error
      return (data || []) as KittingDropdownOption[]
    } catch (error) {
      logger.error('Error fetching kitting dropdown options:', error)
      throw error
    }
  }

  async createOption(input: {
    organization_id: string
    option_group: KittingOptionGroup
    option_value: string
    option_label: string
    description?: string | null
    display_order?: number
    is_active?: boolean
  }): Promise<KittingDropdownOption> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { data, error } = await (supabase as any)
        .from('kitting_dropdown_options')
        .insert({
          ...input,
          created_by: user?.id || null,
          is_active: input.is_active ?? true,
          display_order: input.display_order ?? 0,
        })
        .select()
        .single()

      if (error) throw error
      return data as KittingDropdownOption
    } catch (error) {
      logger.error('Error creating kitting dropdown option:', error)
      throw error
    }
  }

  async updateOption(
    id: string,
    updates: Partial<
      Omit<
        KittingDropdownOption,
        'id' | 'organization_id' | 'created_by' | 'created_at' | 'updated_at'
      >
    >
  ): Promise<KittingDropdownOption> {
    try {
      const { data, error } = await (supabase as any)
        .from('kitting_dropdown_options')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as KittingDropdownOption
    } catch (error) {
      logger.error('Error updating kitting dropdown option:', error)
      throw error
    }
  }

  async deleteOption(id: string): Promise<void> {
    try {
      const { error } = await (supabase as any)
        .from('kitting_dropdown_options')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      logger.error('Error deleting kitting dropdown option:', error)
      throw error
    }
  }

  async seedDefaults(organizationId: string): Promise<void> {
    try {
      const { error } = await (supabase as any).rpc(
        'seed_kitting_dropdown_options',
        {
          p_organization_id: organizationId,
        }
      )
      if (error) throw error
    } catch (error) {
      logger.error('Error seeding kitting dropdown options:', error)
      throw error
    }
  }
}

export const kittingOptionsService = KittingOptionsService.getInstance()

// Created and developed by Jai Singh
