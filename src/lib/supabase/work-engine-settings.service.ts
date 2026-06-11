// Created and developed by Jai Singh
/**
 * Work Engine Settings Service
 *
 * CRUD over `work_engine_settings`, `work_type_settings`, and
 * `work_type_warehouse_overrides`. Every mutation writes a
 * `work_events('settings_changed', payload={ before, after })` row via the
 * service-role-backed RPC `record_settings_change_event`. Manager+ role is
 * enforced server-side by RLS — this client cannot bypass it.
 */
import { supabase } from '@/lib/supabase/client'
import type { Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { invalidateWorkEngineFlagCache } from '@/lib/work-engine/flags'

/**
 * Best-effort audit emitter — wraps the SECURITY DEFINER RPC
 * `record_settings_change_event` (migration 263). Failures are logged but
 * never thrown: the mutation already succeeded before this is called, and
 * audit writes must not block the supervisor UI. Server-side RLS still
 * gates the underlying mutations.
 */
async function recordSettingsChange(
  orgId: string,
  table: string,
  key: string,
  before: unknown,
  after: unknown
): Promise<void> {
  try {
    const { error } = await supabase.rpc('record_settings_change_event', {
      p_org: orgId,
      p_table: table,
      p_key: key,
      p_before: (before ?? null) as Json,
      p_after: (after ?? null) as Json,
    })
    if (error) {
      logger.warn(
        '[work-engine-settings] record_settings_change_event failed',
        error
      )
    }
  } catch (err) {
    logger.warn(
      '[work-engine-settings] record_settings_change_event threw',
      err
    )
  }
}

export interface WorkEngineSettingsRow {
  organization_id: string
  enabled_work_types: string[]
  default_strategy_overrides: Record<string, unknown>
  feature_flags: Record<string, boolean>
  notes: string | null
  updated_at: string
}

export interface WorkTypeSettingsRow {
  organization_id: string
  task_type: string
  enabled: boolean
  push_enabled: boolean
  pull_enabled: boolean
  batch_push_enabled: boolean
  capacity_per_worker: number
  require_capability: boolean
  require_zone_assignment: boolean
  abandonment_minutes: number
  reservation_escalation_minutes: number
  heartbeat_release_minutes: number
  bypass_priorities: string[]
  bypass_subtypes: string[]
  default_priority: 'critical' | 'hot' | 'normal' | 'low'
  payload_schema_version: number
  notes: string | null
}

export interface WarehouseOverrideRow {
  organization_id: string
  task_type: string
  warehouse: string
  enabled: boolean | null
  capacity_per_worker: number | null
  default_priority: 'critical' | 'hot' | 'normal' | 'low' | null
  notes: string | null
}

export const workEngineSettingsService = {
  async getEngineSettings(
    orgId: string
  ): Promise<WorkEngineSettingsRow | null> {
    const { data, error } = await supabase
      .from('work_engine_settings')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle()
    if (error) throw error
    return (data as WorkEngineSettingsRow | null) ?? null
  },

  async updateEngineSettings(
    orgId: string,
    patch: Partial<WorkEngineSettingsRow>
  ): Promise<WorkEngineSettingsRow> {
    const before = await this.getEngineSettings(orgId)
    const { data, error } = await supabase
      .from('work_engine_settings')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('organization_id', orgId)
      .select('*')
      .single()
    if (error) throw error
    invalidateWorkEngineFlagCache(orgId)
    await recordSettingsChange(
      orgId,
      'work_engine_settings',
      orgId,
      before,
      data
    )
    return data as WorkEngineSettingsRow
  },

  async listWorkTypeSettings(orgId: string): Promise<WorkTypeSettingsRow[]> {
    const { data, error } = await supabase
      .from('work_type_settings')
      .select('*')
      .eq('organization_id', orgId)
      .order('task_type')
    if (error) throw error
    return (data as WorkTypeSettingsRow[]) ?? []
  },

  async updateWorkTypeSettings(
    orgId: string,
    taskType: string,
    patch: Partial<WorkTypeSettingsRow>
  ): Promise<WorkTypeSettingsRow> {
    const beforeRows = await this.listWorkTypeSettings(orgId)
    const before = beforeRows.find((r) => r.task_type === taskType) ?? null
    const { data, error } = await supabase
      .from('work_type_settings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('task_type', taskType)
      .select('*')
      .single()
    if (error) throw error
    invalidateWorkEngineFlagCache(orgId)
    await recordSettingsChange(
      orgId,
      'work_type_settings',
      taskType,
      before,
      data
    )
    return data as WorkTypeSettingsRow
  },

  async listWarehouseOverrides(
    orgId: string,
    taskType?: string
  ): Promise<WarehouseOverrideRow[]> {
    let q = supabase
      .from('work_type_warehouse_overrides')
      .select('*')
      .eq('organization_id', orgId)
    if (taskType) q = q.eq('task_type', taskType)
    const { data, error } = await q.order('task_type').order('warehouse')
    if (error) throw error
    return (data as WarehouseOverrideRow[]) ?? []
  },

  async upsertWarehouseOverride(
    row: WarehouseOverrideRow
  ): Promise<WarehouseOverrideRow> {
    const beforeRows = await this.listWarehouseOverrides(
      row.organization_id,
      row.task_type
    )
    const before = beforeRows.find((r) => r.warehouse === row.warehouse) ?? null
    const { data, error } = await supabase
      .from('work_type_warehouse_overrides')
      .upsert(
        { ...row, updated_at: new Date().toISOString() },
        {
          onConflict: 'organization_id,task_type,warehouse',
        }
      )
      .select('*')
      .single()
    if (error) throw error
    invalidateWorkEngineFlagCache(row.organization_id)
    await recordSettingsChange(
      row.organization_id,
      'work_type_warehouse_overrides',
      `${row.task_type}/${row.warehouse}`,
      before,
      data
    )
    return data as WarehouseOverrideRow
  },

  async deleteWarehouseOverride(
    orgId: string,
    taskType: string,
    warehouse: string
  ): Promise<void> {
    const beforeRows = await this.listWarehouseOverrides(orgId, taskType)
    const before = beforeRows.find((r) => r.warehouse === warehouse) ?? null
    const { error } = await supabase
      .from('work_type_warehouse_overrides')
      .delete()
      .eq('organization_id', orgId)
      .eq('task_type', taskType)
      .eq('warehouse', warehouse)
    if (error) throw error
    invalidateWorkEngineFlagCache(orgId)
    await recordSettingsChange(
      orgId,
      'work_type_warehouse_overrides',
      `${taskType}/${warehouse}`,
      before,
      null
    )
  },

  /**
   * Compute the effective resolved value for one (task_type, warehouse, key)
   * tuple. Mirrors Postgres `work_setting()`.
   */
  resolveEffective<T = unknown>(
    engine: WorkEngineSettingsRow | null,
    typeRow: WorkTypeSettingsRow | undefined,
    warehouseRow: WarehouseOverrideRow | undefined,
    key: keyof WorkTypeSettingsRow & string
  ): {
    value: T | undefined
    from: 'warehouse' | 'type' | 'engine' | 'default'
  } {
    if (
      warehouseRow &&
      (warehouseRow as unknown as Record<string, unknown>)[key] != null
    ) {
      return {
        value: (warehouseRow as unknown as Record<string, unknown>)[key] as T,
        from: 'warehouse',
      }
    }
    if (
      typeRow &&
      (typeRow as unknown as Record<string, unknown>)[key] != null
    ) {
      return {
        value: (typeRow as unknown as Record<string, unknown>)[key] as T,
        from: 'type',
      }
    }
    if (engine && engine.default_strategy_overrides && typeRow) {
      const overrides =
        (
          engine.default_strategy_overrides as Record<
            string,
            Record<string, unknown>
          >
        )[typeRow.task_type] ?? {}
      if (overrides[key] != null) {
        return { value: overrides[key] as T, from: 'engine' }
      }
    }
    return { value: undefined, from: 'default' }
  },
}

// Created and developed by Jai Singh
