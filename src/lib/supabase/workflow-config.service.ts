// Created and developed by Jai Singh
/**
 * Workflow Config Service
 * CRUD operations for cycle_count_workflow_configs table
 * Follows OmniFrame service patterns (singleton, error handling, supabase client)
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// The new table is not yet in the generated database.types.ts.
// Use an untyped client reference for this table until types are regenerated.

const db = supabase as any

export interface WorkflowStepConfig {
  id: string
  type: WorkflowStepType
  label: string
  required: boolean
  order: number
  config: Record<string, unknown>
}

export type WorkflowStepType =
  | 'confirm'
  | 'location_scan'
  | 'quantity_entry'
  | 'empty_location_verification'
  | 'photo_capture'
  | 'serial_number'
  | 'barcode_label_scan'
  | 'condition_assessment'
  | 'notes'
  | 'review'
  | 'supervisor_signoff'
  | 'part_number_verification'
  | 'found_part_transfer'

export interface WorkflowConfig {
  id: string
  organization_id: string
  count_type: string
  version: number
  display_name: string
  description: string | null
  is_active: boolean
  steps: WorkflowStepConfig[]
  created_at: string
  updated_at: string
  updated_by: string | null
}

export interface WorkflowConfigSnapshot {
  config_id: string
  config_version: number
  steps: WorkflowStepConfig[]
  review_threshold_pct: number
  review_threshold_abs: number
}

// OrgResult intentionally removed - was unused

interface UpsertConfigInput {
  count_type: string
  display_name: string
  description?: string
  is_active: boolean
  steps: WorkflowStepConfig[]
}

export class WorkflowConfigService {
  private static instance: WorkflowConfigService

  private constructor() {}

  public static getInstance(): WorkflowConfigService {
    if (!WorkflowConfigService.instance) {
      WorkflowConfigService.instance = new WorkflowConfigService()
    }
    return WorkflowConfigService.instance
  }

  private async getOrganizationId(): Promise<string | null> {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) return null

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.organization_id) return null
    return profile.organization_id
  }

  private async getCurrentUserId(): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  }

  /** Fetch all workflow configs for the current user's organization */
  async fetchConfigs(): Promise<{ data: WorkflowConfig[]; error: unknown }> {
    try {
      const organizationId = await this.getOrganizationId()
      if (!organizationId) {
        return { data: [], error: new Error('User organization not found') }
      }

      const { data, error } = await db
        .from('cycle_count_workflow_configs')
        .select('*')
        .eq('organization_id', organizationId)
        .order('count_type')

      if (error) {
        logger.error('Error fetching workflow configs:', error)
        return { data: [], error }
      }

      return {
        data: (data || []) as WorkflowConfig[],
        error: null,
      }
    } catch (error) {
      logger.error('Error fetching workflow configs:', error)
      return { data: [], error }
    }
  }

  /** Fetch a single config by count type for the user's organization */
  async getConfigForCountType(
    countType: string
  ): Promise<{ data: WorkflowConfig | null; error: unknown }> {
    try {
      const organizationId = await this.getOrganizationId()
      if (!organizationId) {
        return { data: null, error: new Error('User organization not found') }
      }

      const { data, error } = await db
        .from('cycle_count_workflow_configs')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('count_type', countType)
        .single()

      if (error) {
        logger.error('Error fetching workflow config for count type:', error)
        return { data: null, error }
      }

      return { data: data as WorkflowConfig, error: null }
    } catch (error) {
      logger.error('Error fetching workflow config for count type:', error)
      return { data: null, error }
    }
  }

  /** Upsert a workflow config. On update, increments version by 1. */
  async upsertConfig(
    config: UpsertConfigInput
  ): Promise<{ success: boolean; data?: WorkflowConfig; error: unknown }> {
    try {
      const organizationId = await this.getOrganizationId()
      const userId = await this.getCurrentUserId()
      if (!organizationId) {
        return {
          success: false,
          error: new Error('User organization not found'),
        }
      }

      // Fetch existing row to get current version for increment
      const { data: existing } = await db
        .from('cycle_count_workflow_configs')
        .select('version')
        .eq('organization_id', organizationId)
        .eq('count_type', config.count_type)
        .maybeSingle()

      const nextVersion = existing ? (existing.version ?? 1) + 1 : 1
      const now = new Date().toISOString()

      const row = {
        organization_id: organizationId,
        count_type: config.count_type,
        version: nextVersion,
        display_name: config.display_name,
        description: config.description ?? null,
        is_active: config.is_active,
        steps: config.steps as unknown[],
        updated_at: now,
        updated_by: userId,
      }

      const { data, error } = await db
        .from('cycle_count_workflow_configs')
        .upsert(row, { onConflict: 'organization_id,count_type' })
        .select()
        .single()

      if (error) {
        logger.error('Error upserting workflow config:', error)
        return { success: false, error }
      }

      return { success: true, data: data as WorkflowConfig, error: null }
    } catch (error) {
      logger.error('Error upserting workflow config:', error)
      return { success: false, error }
    }
  }

  /** Delete the config row so the seed can re-create it on next fetch */
  async resetToDefault(
    countType: string
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      const organizationId = await this.getOrganizationId()
      if (!organizationId) {
        return {
          success: false,
          error: new Error('User organization not found'),
        }
      }

      const { error } = await db
        .from('cycle_count_workflow_configs')
        .delete()
        .eq('organization_id', organizationId)
        .eq('count_type', countType)

      if (error) {
        logger.error('Error resetting workflow config to default:', error)
        return { success: false, error }
      }

      return { success: true, error: null }
    } catch (error) {
      logger.error('Error resetting workflow config to default:', error)
      return { success: false, error }
    }
  }

  /** Returns a snapshot object ready to be stamped onto a count row */
  async getSnapshotForTask(
    countType: string
  ): Promise<{ data: WorkflowConfigSnapshot | null; error: unknown }> {
    try {
      const { data: config, error } =
        await this.getConfigForCountType(countType)
      if (error || !config) {
        return { data: null, error: error ?? new Error('Config not found') }
      }

      const reviewStep = config.steps.find((s) => s.type === 'review')
      const configObj = reviewStep?.config ?? {}

      // Extract thresholds - support both variance_threshold_* and review_threshold_*
      const review_threshold_pct =
        (configObj.review_threshold_pct as number) ??
        (configObj.variance_threshold_pct as number) ??
        10
      const review_threshold_abs =
        (configObj.review_threshold_abs as number) ??
        (configObj.variance_threshold_abs as number) ??
        10

      const snapshot: WorkflowConfigSnapshot = {
        config_id: config.id,
        config_version: config.version,
        steps: config.steps,
        review_threshold_pct,
        review_threshold_abs,
      }

      return { data: snapshot, error: null }
    } catch (error) {
      logger.error('Error getting workflow snapshot for task:', error)
      return { data: null, error }
    }
  }
}

export const workflowConfigService = WorkflowConfigService.getInstance()

// Created and developed by Jai Singh
