// Created and developed by Jai Singh
import { DEFAULT_PLANT_LOCATIONS } from '@/lib/kitting/plant-locations'
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

/**
 * Per-organization workflow settings for the Kitting Apps surface.
 *
 * Backed by the `kitting_workflow_settings` table (one row per
 * organization, UPSERT by `organization_id` PK). Default
 * `kit_inspection_required = true` preserves the legacy three-stage
 * (Build → Inspection → On-Dock) flow for any org that has never
 * touched the toggle.
 *
 * See `supabase/migrations/308_kitting_workflow_settings.sql` and
 * `memorybank/OmniFrame/Implementations/Optional-Kit-Inspection-Toggle.md`.
 */
export interface KittingWorkflowSettings {
  organization_id: string
  kit_inspection_required: boolean
  // Black-Hat ship-short authorization policy (see migration 312 +
  // [[Black-Hat-Ship-Short-Authorization-Panel]]). All three default
  // TRUE so the inline authorization panel is enabled with mandatory
  // per-line justification and no bulk-authorize shortcut — matches
  // the operator-team intent captured in the original spec.
  black_hat_ship_short_authorization_enabled: boolean
  black_hat_ship_short_require_justification: boolean
  black_hat_ship_short_require_line_by_line_approval: boolean
  // Case-insensitive substrings that mark a Transfer Order
  // `sourceStorageBin` as "lives at the plant, not inside our
  // warehouse" — when a TO with a matching bin lands in the
  // Add Kit Build Plan dialog (or the Append TOs flow), the operator
  // must explicitly acknowledge it before the kit can be saved.
  // See migration 314 + [[Non-Warehouse-Bin-Acknowledgment]].
  non_warehouse_bin_patterns: string[]
  // Human-readable labels rendered in the "Deliver To Plant" dropdown
  // of the Add Kit Build Plan dialog. Operator-editable from Settings
  // → Workflow Settings so a facility change doesn't require a code
  // push. Default seeds the eight values that used to be hardcoded.
  // See migration 324 + [[Configurable-Deliver-To-Plant-Locations]].
  deliver_to_plant_locations: string[]
  updated_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Subset of `KittingWorkflowSettings` that can be mutated via
 * `updateSettings`. Excludes the row-housekeeping columns (organization
 * id, audit timestamps, updated_by) which are managed by the service.
 */
export type KittingWorkflowSettingsUpdate = Partial<
  Pick<
    KittingWorkflowSettings,
    | 'kit_inspection_required'
    | 'black_hat_ship_short_authorization_enabled'
    | 'black_hat_ship_short_require_justification'
    | 'black_hat_ship_short_require_line_by_line_approval'
    | 'non_warehouse_bin_patterns'
    | 'deliver_to_plant_locations'
  >
>

const DEFAULT_SETTINGS: Omit<
  KittingWorkflowSettings,
  'organization_id' | 'updated_by' | 'created_at' | 'updated_at'
> = {
  kit_inspection_required: true,
  black_hat_ship_short_authorization_enabled: true,
  black_hat_ship_short_require_justification: true,
  black_hat_ship_short_require_line_by_line_approval: true,
  // Substring patterns matched case-insensitively against
  // sourceStorageBin. `NEEDBIN` catches `112NEEDBIN`, `R0NEEDBIN`,
  // anything containing the marker. Operators add more patterns
  // (e.g. plant-specific bin prefixes) via Settings → Workflow Settings.
  non_warehouse_bin_patterns: ['NEEDBIN'],
  // Operator-editable list of "Deliver To Plant" destinations rendered
  // in the Add Kit Build Plan dialog. Seeds the eight values that used
  // to be hardcoded in the frontend so a never-touched org sees the
  // identical dropdown options. See migration 324 +
  // [[Configurable-Deliver-To-Plant-Locations]].
  deliver_to_plant_locations: [...DEFAULT_PLANT_LOCATIONS],
}

class KittingWorkflowSettingsService {
  private static instance: KittingWorkflowSettingsService

  static getInstance() {
    if (!KittingWorkflowSettingsService.instance) {
      KittingWorkflowSettingsService.instance =
        new KittingWorkflowSettingsService()
    }
    return KittingWorkflowSettingsService.instance
  }

  /**
   * Fetch the workflow settings row for an organization. When no row
   * exists yet (org has never touched the Settings tab), returns the
   * default shape so consumers can render UI without having to insert
   * a placeholder row first.
   */
  async getSettings(
    organizationId: string
  ): Promise<KittingWorkflowSettings | null> {
    if (!organizationId) return null
    try {
      const { data, error } = await (supabase as any)
        .from('kitting_workflow_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle()

      if (error) throw error
      if (data) return data as KittingWorkflowSettings

      return {
        organization_id: organizationId,
        ...DEFAULT_SETTINGS,
        updated_by: null,
        created_at: '',
        updated_at: '',
      }
    } catch (error) {
      logger.error('Error fetching kitting workflow settings:', error)
      throw error
    }
  }

  /**
   * UPSERT the workflow settings row for an organization. Tracks the
   * acting user via `updated_by` (best-effort — falls back to NULL when
   * the auth context can't be resolved, e.g. unit tests).
   */
  async updateSettings(
    organizationId: string,
    updates: KittingWorkflowSettingsUpdate
  ): Promise<KittingWorkflowSettings> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { data, error } = await (supabase as any)
        .from('kitting_workflow_settings')
        .upsert(
          {
            organization_id: organizationId,
            ...updates,
            updated_by: user?.id ?? null,
          },
          { onConflict: 'organization_id' }
        )
        .select()
        .single()

      if (error) throw error
      return data as KittingWorkflowSettings
    } catch (error) {
      logger.error('Error updating kitting workflow settings:', error)
      throw error
    }
  }
}

export const kittingWorkflowSettingsService =
  KittingWorkflowSettingsService.getInstance()

export const KITTING_WORKFLOW_DEFAULTS = DEFAULT_SETTINGS

// Created and developed by Jai Singh
