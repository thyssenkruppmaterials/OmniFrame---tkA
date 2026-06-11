// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

const db = supabase as any

export interface LocationResolutionRule {
  id: string
  organization_id: string
  warehouse_code: string | null
  name: string
  regex_pattern: string
  canonical_bin_template: string | null
  zone_template: string | null
  aisle_template: string | null
  sequence_template: string | null
  priority: number
  is_active: boolean
  created_at: string
  updated_at: string
  updated_by: string | null
}

export interface PathRule {
  id: string
  organization_id: string
  warehouse_code: string | null
  zone_filter: string | null
  aisle_filter: string | null
  strategy: 'serpentine_zone' | 'directional' | 'alternating_aisles'
  direction: 'ascending' | 'descending'
  max_counters_per_aisle: number
  fallback_behavior:
    | 'allow_unmapped_last'
    | 'block_unmapped'
    | 'ignore_path_rules'
  priority: number
  is_active: boolean
  created_at: string
  updated_at: string
  updated_by: string | null
}

export interface ResolvedLocationPreview {
  location: string
  resolved_key: string
  resolved_zone: string
  resolved_aisle: string
  resolved_sequence: number
  source: string
}

export interface ClaimOrderPreviewRow {
  count_number: string
  location: string
  priority: string
  resolved_zone: string
  resolved_aisle: string
  resolved_sequence: number
  source: string
}

export type UpsertResolutionRuleInput = Omit<
  LocationResolutionRule,
  'id' | 'organization_id' | 'created_at' | 'updated_at' | 'updated_by'
> & { id?: string }

export type UpsertPathRuleInput = Omit<
  PathRule,
  'id' | 'organization_id' | 'created_at' | 'updated_at' | 'updated_by'
> & { id?: string }

class PathRulesService {
  private static instance: PathRulesService
  private constructor() {}

  static getInstance(): PathRulesService {
    if (!PathRulesService.instance) {
      PathRulesService.instance = new PathRulesService()
    }
    return PathRulesService.instance
  }

  private async getOrgId(): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    return data?.organization_id ?? null
  }

  private async getUserId(): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  }

  async fetchResolutionRules(): Promise<LocationResolutionRule[]> {
    const orgId = await this.getOrgId()
    if (!orgId) return []
    const { data, error } = await db
      .from('cycle_count_location_resolution_rules')
      .select('*')
      .eq('organization_id', orgId)
      .order('priority', { ascending: false })
    if (error) {
      logger.error('Failed to fetch resolution rules:', error)
      return []
    }
    return data ?? []
  }

  async upsertResolutionRule(
    input: UpsertResolutionRuleInput
  ): Promise<{ success: boolean; error?: string }> {
    const orgId = await this.getOrgId()
    const userId = await this.getUserId()
    if (!orgId) return { success: false, error: 'No organization' }

    const payload = {
      ...input,
      organization_id: orgId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }

    const { error } = input.id
      ? await db
          .from('cycle_count_location_resolution_rules')
          .update(payload)
          .eq('id', input.id)
      : await db.from('cycle_count_location_resolution_rules').insert(payload)

    if (error) {
      logger.error('Failed to upsert resolution rule:', error)
      return { success: false, error: error.message }
    }
    return { success: true }
  }

  async deleteResolutionRule(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await db
      .from('cycle_count_location_resolution_rules')
      .delete()
      .eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  }

  async fetchPathRules(): Promise<PathRule[]> {
    const orgId = await this.getOrgId()
    if (!orgId) return []
    const { data, error } = await db
      .from('cycle_count_path_rules')
      .select('*')
      .eq('organization_id', orgId)
      .order('priority', { ascending: false })
    if (error) {
      logger.error('Failed to fetch path rules:', error)
      return []
    }
    return data ?? []
  }

  async upsertPathRule(
    input: UpsertPathRuleInput
  ): Promise<{ success: boolean; error?: string }> {
    const orgId = await this.getOrgId()
    const userId = await this.getUserId()
    if (!orgId) return { success: false, error: 'No organization' }

    const payload = {
      ...input,
      organization_id: orgId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }

    const { error } = input.id
      ? await db
          .from('cycle_count_path_rules')
          .update(payload)
          .eq('id', input.id)
      : await db.from('cycle_count_path_rules').insert(payload)

    if (error) {
      logger.error('Failed to upsert path rule:', error)
      return { success: false, error: error.message }
    }
    return { success: true }
  }

  async deletePathRule(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await db
      .from('cycle_count_path_rules')
      .delete()
      .eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  }

  testPattern(
    pattern: string,
    locations: string[]
  ): { location: string; matched: boolean; groups: string[] }[] {
    let regex: RegExp
    try {
      regex = new RegExp(pattern)
    } catch {
      return locations.map((l) => ({
        location: l,
        matched: false,
        groups: [],
      }))
    }
    return locations.map((location) => {
      const match = location.match(regex)
      return {
        location,
        matched: !!match,
        groups: match ? match.slice(1) : [],
      }
    })
  }

  async previewResolvedLocations(
    limit = 50
  ): Promise<ResolvedLocationPreview[]> {
    const orgId = await this.getOrgId()
    if (!orgId) return []
    const { data, error } = await db
      .from('rr_cyclecount_data')
      .select(
        'location, resolved_location_key, resolved_zone, resolved_aisle, resolved_sequence, resolution_source'
      )
      .eq('organization_id', orgId)
      .not('resolved_location_key', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      logger.error('Failed to preview resolved locations:', error)
      return []
    }
    return (data ?? []).map((r: any) => ({
      location: r.location,
      resolved_key: r.resolved_location_key ?? r.location,
      resolved_zone: r.resolved_zone ?? 'unresolved',
      resolved_aisle: r.resolved_aisle ?? 'unresolved',
      resolved_sequence: r.resolved_sequence ?? 0,
      source: r.resolution_source ?? 'unresolved',
    }))
  }

  async previewClaimOrder(limit = 25): Promise<ClaimOrderPreviewRow[]> {
    const orgId = await this.getOrgId()
    if (!orgId) return []
    const { data, error } = await db
      .from('rr_cyclecount_data')
      .select(
        'count_number, location, priority, resolved_zone, resolved_aisle, resolved_sequence, resolution_source, id'
      )
      .eq('organization_id', orgId)
      .in('status', ['pending', 'recount'])
      .is('assigned_to', null)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) {
      logger.error('Failed to preview claim order:', error)
      return []
    }

    const rows = (data ?? []).filter((row: any) => row.id)
    return rows
      .sort((a: any, b: any) => {
        const rank = (value?: string) =>
          value === 'critical'
            ? 1
            : value === 'hot'
              ? 2
              : value === 'normal'
                ? 3
                : value === 'low'
                  ? 4
                  : 5

        const priorityCmp = rank(a.priority) - rank(b.priority)
        if (priorityCmp !== 0) return priorityCmp

        const aUnresolved =
          !a.resolution_source || a.resolution_source === 'unresolved'
        const bUnresolved =
          !b.resolution_source || b.resolution_source === 'unresolved'
        if (aUnresolved !== bUnresolved) return aUnresolved ? 1 : -1

        const zoneCmp = (a.resolved_zone ?? 'unresolved').localeCompare(
          b.resolved_zone ?? 'unresolved'
        )
        if (zoneCmp !== 0) return zoneCmp

        const aisleCmp = (a.resolved_aisle ?? 'unresolved').localeCompare(
          b.resolved_aisle ?? 'unresolved'
        )
        if (aisleCmp !== 0) return aisleCmp

        return (a.resolved_sequence ?? 0) - (b.resolved_sequence ?? 0)
      })
      .map((row: any) => ({
        count_number: row.count_number,
        location: row.location,
        priority: row.priority ?? 'normal',
        resolved_zone: row.resolved_zone ?? 'unresolved',
        resolved_aisle: row.resolved_aisle ?? 'unresolved',
        resolved_sequence: row.resolved_sequence ?? 0,
        source: row.resolution_source ?? 'unresolved',
      }))
  }
}

export const pathRulesService = PathRulesService.getInstance()

// Created and developed by Jai Singh
