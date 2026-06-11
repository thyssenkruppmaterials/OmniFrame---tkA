// Created and developed by Jai Singh
/**
 * Kit Definition Chains Service
 * CRUD operations for kit_definition_chains — groupings of kit definitions
 * that are built in order or shipped together.
 * Created: 2026-04-28
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

const db = supabase as unknown as ReturnType<(typeof supabase)['from']> & {
  from: (table: string) => ReturnType<(typeof supabase)['from']>
}

export type KitChainLinkType = 'build_order' | 'ship_together' | 'custom'
export type KitChainStatus = 'active' | 'archived'

export interface KitDefinitionChainRecord {
  id: string
  organization_id: string
  chain_name: string
  chain_description: string | null
  link_type: KitChainLinkType
  status: KitChainStatus
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

export interface CreateKitChainInput {
  chainName: string
  chainDescription?: string | null
  linkType?: KitChainLinkType
}

export interface UpdateKitChainInput extends Partial<CreateKitChainInput> {
  id: string
  status?: KitChainStatus
}

export const KIT_CHAIN_LINK_TYPES: Array<{
  value: KitChainLinkType
  label: string
  description: string
}> = [
  {
    value: 'build_order',
    label: 'Build in Order',
    description: 'These kits must be built sequentially.',
  },
  {
    value: 'ship_together',
    label: 'Ship Together',
    description: 'These kits ship as one shipment / load.',
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Custom linkage criteria documented on the chain.',
  },
]

export class KitDefinitionChainsService {
  private static readonly TABLE = 'kit_definition_chains'

  private static async getOrganizationId(): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    return (data as { organization_id: string } | null)?.organization_id ?? null
  }

  static async list(opts?: {
    status?: KitChainStatus
  }): Promise<KitDefinitionChainRecord[]> {
    try {
      const orgId = await this.getOrganizationId()
      if (!orgId) return []

      let query = (db.from(this.TABLE) as ReturnType<(typeof supabase)['from']>)
        .select('*')
        .eq('organization_id', orgId)
        .order('chain_name', { ascending: true })

      if (opts?.status) {
        query = query.eq('status', opts.status)
      }

      const { data, error } = await query
      if (error) {
        logger.error('[KitDefinitionChainsService] list error:', error)
        return []
      }

      return (data as unknown as KitDefinitionChainRecord[]) || []
    } catch (err) {
      logger.error('[KitDefinitionChainsService] list error:', err)
      return []
    }
  }

  static async listActive(): Promise<KitDefinitionChainRecord[]> {
    return this.list({ status: 'active' })
  }

  static async create(
    input: CreateKitChainInput
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const trimmed = input.chainName.trim()
      if (!trimmed) {
        return { success: false, error: 'Chain name is required' }
      }

      const orgId = await this.getOrganizationId()
      if (!orgId) {
        return { success: false, error: 'Could not determine organization' }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { data, error } = await (
        db.from(this.TABLE) as unknown as ReturnType<(typeof supabase)['from']>
      )
        .insert({
          organization_id: orgId,
          chain_name: trimmed,
          chain_description: input.chainDescription?.trim() || null,
          link_type: input.linkType || 'build_order',
          status: 'active',
          created_by: user?.id || null,
          updated_by: user?.id || null,
        } as never)
        .select('id')
        .single()

      if (error) {
        if (error.code === '23505') {
          return {
            success: false,
            error: `Chain "${trimmed}" already exists`,
          }
        }
        logger.error('[KitDefinitionChainsService] create error:', error)
        return { success: false, error: error.message }
      }

      return { success: true, id: (data as unknown as { id: string }).id }
    } catch (err) {
      logger.error('[KitDefinitionChainsService] create error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  static async update(
    input: UpdateKitChainInput
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()
      updates.updated_by = user?.id || null

      if (input.chainName !== undefined) {
        const trimmed = input.chainName.trim()
        if (!trimmed) {
          return { success: false, error: 'Chain name is required' }
        }
        updates.chain_name = trimmed
      }
      if (input.chainDescription !== undefined) {
        updates.chain_description = input.chainDescription?.trim() || null
      }
      if (input.linkType !== undefined) {
        updates.link_type = input.linkType
      }
      if (input.status !== undefined) {
        updates.status = input.status
      }

      const { error } = await (
        db.from(this.TABLE) as ReturnType<(typeof supabase)['from']>
      )
        .update(updates)
        .eq('id', input.id)

      if (error) {
        if (error.code === '23505') {
          return { success: false, error: 'Chain name already exists' }
        }
        logger.error('[KitDefinitionChainsService] update error:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (err) {
      logger.error('[KitDefinitionChainsService] update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  static async archive(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.update({ id, status: 'archived' })
  }

  static async activate(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.update({ id, status: 'active' })
  }

  static async delete(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TABLE) as ReturnType<(typeof supabase)['from']>
    )
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('[KitDefinitionChainsService] delete error:', error)
      return { success: false, error: error.message }
    }
    return { success: true }
  }

  static subscribeToChanges(callback: () => void) {
    return supabase
      .channel('kit_definition_chains_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: this.TABLE },
        () => callback()
      )
      .subscribe()
  }
}

// Created and developed by Jai Singh
