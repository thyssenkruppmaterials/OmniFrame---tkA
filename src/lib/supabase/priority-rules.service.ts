// Created and developed by Jai Singh
/**
 * Cycle-Count Priority Rules Service
 *
 * CRUD + evaluator for `cycle_count_priority_rules` (migration 230).
 * Rules re-score pending/recount rows based on zone, count_type, warehouse,
 * age, variance, or requires_recount. `apply` calls an RPC that batch-updates
 * priority across the org.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

export type PriorityLevel = 'critical' | 'hot' | 'normal' | 'low'

export interface PriorityRule {
  id: string
  organization_id: string
  name: string
  enabled: boolean
  priority_level: PriorityLevel
  match_zone: string | null
  match_count_type: string | null
  match_warehouse: string | null
  match_age_gte_hours: number | null
  match_variance_gte_pct: number | null
  match_requires_recount: boolean | null
  sort_order: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type PriorityRuleUpsert = Omit<
  PriorityRule,
  'id' | 'organization_id' | 'created_at' | 'updated_at'
> & { id?: string }

async function currentOrgId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return profile?.organization_id ?? null
}

export async function listPriorityRules(): Promise<PriorityRule[]> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) return []

    const { data, error } = await (supabase as any)
      .from('cycle_count_priority_rules')
      .select('*')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: true })

    if (error) {
      logger.error('listPriorityRules error:', error)
      return []
    }
    return (data ?? []) as PriorityRule[]
  } catch (err) {
    logger.error('listPriorityRules exception:', err)
    return []
  }
}

export async function upsertPriorityRule(
  rule: PriorityRuleUpsert
): Promise<PriorityRule | null> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) throw new Error('No organization for current user')

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const payload: Record<string, unknown> = {
      organization_id: orgId,
      ...rule,
      updated_by: user?.id ?? null,
      created_by: user?.id ?? null,
    }

    const { data, error } = await (supabase as any)
      .from('cycle_count_priority_rules')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single()

    if (error) {
      logger.error('upsertPriorityRule error:', error)
      throw error
    }
    return data as PriorityRule
  } catch (err) {
    logger.error('upsertPriorityRule exception:', err)
    throw err
  }
}

export async function deletePriorityRule(id: string): Promise<void> {
  try {
    const { error } = await (supabase as any)
      .from('cycle_count_priority_rules')
      .delete()
      .eq('id', id)
    if (error) throw error
  } catch (err) {
    logger.error('deletePriorityRule exception:', err)
    throw err
  }
}

/**
 * Runs the server-side evaluator that re-scores every pending/recount row
 * against the enabled rules. Returns the number of rows whose priority
 * actually changed.
 */
export async function applyPriorityRules(): Promise<{
  success: boolean
  touched?: number
  error?: string
}> {
  try {
    const { data, error } = await (supabase.rpc as any)(
      'apply_cycle_count_priority_rules',
      {}
    )
    if (error) return { success: false, error: error.message }
    if (data && typeof data === 'object' && 'success' in data) {
      const asObj = data as {
        success: boolean
        error?: string
        touched?: number
      }
      return asObj.success
        ? { success: true, touched: asObj.touched ?? 0 }
        : { success: false, error: asObj.error ?? 'Evaluator failed' }
    }
    return { success: false, error: 'RPC returned no result' }
  } catch (err) {
    logger.error('applyPriorityRules exception:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// Created and developed by Jai Singh
