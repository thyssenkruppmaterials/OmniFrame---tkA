/**
 * Activity Source Configuration Service
 * Manages dynamic activity source configurations for timeline tracking
 * Created: January 4, 2026
 *
 * This service enables administrators to add new activity types to the
 * labor management timeline without requiring code changes.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// ===== TYPE DEFINITIONS =====

export interface ActivitySourceConfig {
  id: string
  organization_id: string | null
  activity_type: string
  activity_label: string
  activity_description: string | null
  source_table: string
  source_schema: string
  user_id_column: string
  timestamp_column: string
  organization_id_column: string
  area_column: string | null
  area_fallback: string | null
  where_conditions: Record<string, unknown>
  count_enabled: boolean
  count_column: string
  display_color: string
  display_icon: string | null
  display_order: number
  activity_category: string
  department: string | null
  is_active: boolean
  is_system: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface ActivityDisplayConfig {
  id: string
  organization_id: string | null
  activity_type: string
  label_override: string | null
  color_override: string | null
  icon_override: string | null
  show_on_timeline: boolean
  show_in_summary: boolean
  show_in_breakdown: boolean
  gantt_bg_class: string | null
  gantt_hover_class: string | null
  gantt_text_class: string | null
  gantt_min_width_percent: number
  include_in_efficiency: boolean
  efficiency_weight: number
  created_at: string
  updated_at: string
}

export interface ActivityConfiguration {
  activity_type: string
  activity_label: string
  activity_description: string | null
  display_color: string
  display_order: number
  activity_category: string
  gantt_bg_class: string
  gantt_hover_class: string
  gantt_text_class: string
  show_on_timeline: boolean
  show_in_summary: boolean
  include_in_efficiency: boolean
  efficiency_weight: number
}

export interface CreateActivitySourceInput {
  organization_id?: string | null
  activity_type: string
  activity_label: string
  activity_description?: string
  source_table: string
  source_schema?: string
  user_id_column: string
  timestamp_column: string
  organization_id_column?: string
  area_column?: string
  area_fallback?: string
  where_conditions?: Record<string, unknown>
  count_enabled?: boolean
  count_column?: string
  display_color: string
  display_icon?: string
  display_order?: number
  activity_category?: string
  department?: string
  is_active?: boolean
}

export interface UpdateActivitySourceInput {
  activity_label?: string
  activity_description?: string
  area_column?: string
  area_fallback?: string
  where_conditions?: Record<string, unknown>
  count_enabled?: boolean
  display_color?: string
  display_icon?: string
  display_order?: number
  activity_category?: string
  department?: string
  is_active?: boolean
}

export interface TableColumn {
  column_name: string
  data_type: string
  is_nullable: boolean
}

export interface AvailableTable {
  table_name: string
  columns: TableColumn[]
}

// ===== SERVICE CLASS =====

class ActivitySourceConfigService {
  private static instance: ActivitySourceConfigService

  private constructor() {}

  static getInstance(): ActivitySourceConfigService {
    if (!ActivitySourceConfigService.instance) {
      ActivitySourceConfigService.instance = new ActivitySourceConfigService()
    }
    return ActivitySourceConfigService.instance
  }

  /**
   * Get all activity source configurations for an organization
   */
  async getActivitySourceConfigs(
    organizationId: string
  ): Promise<ActivitySourceConfig[]> {
    const { data, error } = await (supabase as any)
      .from('activity_source_config')
      .select('*')
      .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
      .order('display_order', { ascending: true })
      .order('activity_type', { ascending: true })

    if (error) {
      logger.error('[ActivitySourceConfig] Error fetching configs:', error)
      throw error
    }

    return data || []
  }

  /**
   * Get a single activity source configuration by ID
   */
  async getActivitySourceConfig(
    id: string
  ): Promise<ActivitySourceConfig | null> {
    const { data, error } = await (supabase as any)
      .from('activity_source_config')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      logger.error('[ActivitySourceConfig] Error fetching config:', error)
      return null
    }

    return data
  }

  /**
   * Create a new activity source configuration
   */
  async createActivitySourceConfig(
    input: CreateActivitySourceInput
  ): Promise<ActivitySourceConfig> {
    const { data, error } = await (supabase as any)
      .from('activity_source_config')
      .insert({
        organization_id: input.organization_id || null,
        activity_type: input.activity_type,
        activity_label: input.activity_label,
        activity_description: input.activity_description || null,
        source_table: input.source_table,
        source_schema: input.source_schema || 'public',
        user_id_column: input.user_id_column,
        timestamp_column: input.timestamp_column,
        organization_id_column:
          input.organization_id_column || 'organization_id',
        area_column: input.area_column || null,
        area_fallback: input.area_fallback || 'Other',
        where_conditions: input.where_conditions || {},
        count_enabled: input.count_enabled ?? true,
        count_column: input.count_column || '*',
        display_color: input.display_color,
        display_icon: input.display_icon || null,
        display_order: input.display_order ?? 100,
        activity_category: input.activity_category || 'work',
        department: input.department || null,
        is_active: input.is_active ?? true,
        is_system: false,
      })
      .select()
      .single()

    if (error) {
      logger.error('[ActivitySourceConfig] Error creating config:', error)
      throw error
    }

    return data
  }

  /**
   * Update an activity source configuration
   */
  async updateActivitySourceConfig(
    id: string,
    updates: UpdateActivitySourceInput
  ): Promise<ActivitySourceConfig> {
    // Check if it's a system config
    const existing = await this.getActivitySourceConfig(id)
    if (existing?.is_system) {
      throw new Error('Cannot modify system activity configurations')
    }

    const { data, error } = await (supabase as any)
      .from('activity_source_config')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('is_system', false) // Extra safety check
      .select()
      .single()

    if (error) {
      logger.error('[ActivitySourceConfig] Error updating config:', error)
      throw error
    }

    return data
  }

  /**
   * Delete an activity source configuration
   */
  async deleteActivitySourceConfig(id: string): Promise<void> {
    // Check if it's a system config
    const existing = await this.getActivitySourceConfig(id)
    if (existing?.is_system) {
      throw new Error('Cannot delete system activity configurations')
    }

    const { error } = await (supabase as any)
      .from('activity_source_config')
      .delete()
      .eq('id', id)
      .eq('is_system', false) // Extra safety check

    if (error) {
      logger.error('[ActivitySourceConfig] Error deleting config:', error)
      throw error
    }
  }

  /**
   * Toggle active status of an activity source configuration
   */
  async toggleActivitySourceActive(
    id: string,
    isActive: boolean
  ): Promise<ActivitySourceConfig> {
    return this.updateActivitySourceConfig(id, { is_active: isActive })
  }

  /**
   * Get all activity configurations with display settings
   * Uses the RPC function for optimized fetching
   */
  async getActivityConfigurations(
    organizationId: string
  ): Promise<ActivityConfiguration[]> {
    const { data, error } = await (supabase as any).rpc(
      'get_activity_configurations',
      {
        p_organization_id: organizationId,
      }
    )

    if (error) {
      logger.error(
        '[ActivitySourceConfig] Error fetching configurations:',
        error
      )
      // Fall back to fetching from source config directly
      const configs = await this.getActivitySourceConfigs(organizationId)
      return configs.map((config) => ({
        activity_type: config.activity_type,
        activity_label: config.activity_label,
        activity_description: config.activity_description,
        display_color: config.display_color,
        display_order: config.display_order,
        activity_category: config.activity_category,
        gantt_bg_class: `bg-${config.display_color}`,
        gantt_hover_class: `hover:bg-${config.display_color.replace('-500', '-400')}`,
        gantt_text_class: 'text-white',
        show_on_timeline: true,
        show_in_summary: true,
        include_in_efficiency: true,
        efficiency_weight: 1.0,
      }))
    }

    return data || []
  }

  /**
   * Get available database tables that could be used as activity sources
   * Returns tables in the public schema with common required columns
   */
  async getAvailableTables(): Promise<AvailableTable[]> {
    // First, try the RPC function (requires migration 086 to be applied)
    const { data, error } = await (supabase as any).rpc(
      'get_available_activity_tables'
    )

    if (!error && data && data.length > 0) {
      logger.log(
        `[ActivitySourceConfig] Loaded ${data.length} tables from database`
      )
      return data
    }

    if (error) {
      logger.warn(
        '[ActivitySourceConfig] RPC get_available_activity_tables failed:',
        error.message
      )
      logger.warn(
        '[ActivitySourceConfig] Make sure migration 086_dynamic_activity_configuration.sql has been applied'
      )
    }

    // Fallback: return hardcoded list (users can still type any table name manually)
    logger.warn(
      '[ActivitySourceConfig] Using hardcoded fallback table list - apply migration 086 to see all tables'
    )
    return this.getFallbackTableList()
  }

  /**
   * Get all tables by probing known table patterns
   * This can be called when the user needs to see more tables
   */
  async discoverTables(tableNameHint: string = ''): Promise<AvailableTable[]> {
    // If user provides a hint, try to get columns for that specific table
    if (tableNameHint) {
      const columns = await this.getTableColumns(tableNameHint)
      if (columns.length > 0) {
        return [
          {
            table_name: tableNameHint,
            columns,
          },
        ]
      }
    }

    // Otherwise return fallback
    return this.getFallbackTableList()
  }

  /**
   * Get columns for a specific table
   */
  async getTableColumns(tableName: string): Promise<TableColumn[]> {
    const { data, error } = await (supabase as any).rpc('get_table_columns', {
      p_table_name: tableName,
    })

    if (error) {
      logger.error(
        `[ActivitySourceConfig] Error fetching columns for ${tableName}:`,
        error
      )
      return []
    }

    return data || []
  }

  /**
   * Fallback list of known tables with activity potential
   */
  private getFallbackTableList(): AvailableTable[] {
    return [
      {
        table_name: 'rr_inbound_scans',
        columns: [
          { column_name: 'scanned_by', data_type: 'uuid', is_nullable: false },
          {
            column_name: 'scanned_at',
            data_type: 'timestamptz',
            is_nullable: false,
          },
          {
            column_name: 'organization_id',
            data_type: 'uuid',
            is_nullable: false,
          },
          { column_name: 'area', data_type: 'text', is_nullable: true },
        ],
      },
      {
        table_name: 'rf_putaway_operations',
        columns: [
          { column_name: 'created_by', data_type: 'uuid', is_nullable: false },
          {
            column_name: 'created_at',
            data_type: 'timestamptz',
            is_nullable: false,
          },
          { column_name: 'confirmed_by', data_type: 'uuid', is_nullable: true },
          {
            column_name: 'confirmed_at',
            data_type: 'timestamptz',
            is_nullable: true,
          },
          {
            column_name: 'organization_id',
            data_type: 'uuid',
            is_nullable: false,
          },
          {
            column_name: 'shelf_location',
            data_type: 'text',
            is_nullable: true,
          },
        ],
      },
      {
        table_name: 'outbound_to_data',
        columns: [
          { column_name: 'picked_by', data_type: 'uuid', is_nullable: true },
          {
            column_name: 'picked_at',
            data_type: 'timestamptz',
            is_nullable: true,
          },
          { column_name: 'packed_by', data_type: 'uuid', is_nullable: true },
          {
            column_name: 'packed_at',
            data_type: 'timestamptz',
            is_nullable: true,
          },
          { column_name: 'shipped_by', data_type: 'uuid', is_nullable: true },
          {
            column_name: 'shipped_at',
            data_type: 'timestamptz',
            is_nullable: true,
          },
          {
            column_name: 'final_packed_by',
            data_type: 'uuid',
            is_nullable: true,
          },
          {
            column_name: 'final_packed_at',
            data_type: 'timestamptz',
            is_nullable: true,
          },
          {
            column_name: 'organization_id',
            data_type: 'uuid',
            is_nullable: false,
          },
        ],
      },
      {
        table_name: 'putback_tickets',
        columns: [
          { column_name: 'created_by', data_type: 'uuid', is_nullable: false },
          {
            column_name: 'created_at',
            data_type: 'timestamptz',
            is_nullable: false,
          },
          {
            column_name: 'processed_at',
            data_type: 'timestamptz',
            is_nullable: true,
          },
          {
            column_name: 'organization_id',
            data_type: 'uuid',
            is_nullable: false,
          },
        ],
      },
      {
        table_name: 'rr_cyclecount_data',
        columns: [
          { column_name: 'assigned_to', data_type: 'uuid', is_nullable: true },
          {
            column_name: 'completed_at',
            data_type: 'timestamptz',
            is_nullable: true,
          },
          {
            column_name: 'created_at',
            data_type: 'timestamptz',
            is_nullable: false,
          },
          {
            column_name: 'organization_id',
            data_type: 'uuid',
            is_nullable: false,
          },
          { column_name: 'status', data_type: 'text', is_nullable: true },
        ],
      },
    ]
  }

  /**
   * Validate that a table and columns exist before saving configuration
   * Organization ID column is optional - if not provided or not found, filtering will be skipped
   */
  async validateTableConfiguration(
    tableName: string,
    userIdColumn: string,
    timestampColumn: string,
    organizationIdColumn: string = ''
  ): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      const columns = await this.getTableColumns(tableName)

      if (columns.length === 0) {
        errors.push(`Table '${tableName}' not found or has no columns`)
        return { valid: false, errors, warnings }
      }

      const columnNames = columns.map((c) => c.column_name)

      if (!columnNames.includes(userIdColumn)) {
        errors.push(
          `User ID column '${userIdColumn}' not found in table '${tableName}'`
        )
      }

      if (!columnNames.includes(timestampColumn)) {
        errors.push(
          `Timestamp column '${timestampColumn}' not found in table '${tableName}'`
        )
      }

      // Organization ID column is optional - just warn if specified but not found
      if (organizationIdColumn && organizationIdColumn.trim() !== '') {
        if (!columnNames.includes(organizationIdColumn)) {
          warnings.push(
            `Organization ID column '${organizationIdColumn}' not found in table '${tableName}'. Data will not be filtered by organization.`
          )
        }
      } else {
        warnings.push(
          `No organization ID column specified. Data will not be filtered by organization.`
        )
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      errors.push('Unable to validate table configuration')
      return { valid: false, errors, warnings }
    }
  }

  /**
   * Get activity categories for dropdown
   */
  getActivityCategories(): { value: string; label: string }[] {
    return [
      { value: 'work', label: 'Work Activity' },
      { value: 'admin', label: 'Administrative' },
      { value: 'quality', label: 'Quality Control' },
      { value: 'maintenance', label: 'Maintenance' },
      { value: 'training', label: 'Training' },
      { value: 'other', label: 'Other' },
    ]
  }

  /**
   * Get predefined colors for timeline blocks
   */
  getPresetColors(): { value: string; label: string; tailwind: string }[] {
    return [
      { value: 'sky-500', label: 'Sky Blue', tailwind: 'bg-sky-500' },
      { value: 'violet-500', label: 'Violet', tailwind: 'bg-violet-500' },
      { value: 'emerald-500', label: 'Emerald', tailwind: 'bg-emerald-500' },
      { value: 'orange-500', label: 'Orange', tailwind: 'bg-orange-500' },
      { value: 'cyan-500', label: 'Cyan', tailwind: 'bg-cyan-500' },
      { value: 'amber-500', label: 'Amber', tailwind: 'bg-amber-500' },
      { value: 'rose-500', label: 'Rose', tailwind: 'bg-rose-500' },
      { value: 'indigo-500', label: 'Indigo', tailwind: 'bg-indigo-500' },
      { value: 'teal-500', label: 'Teal', tailwind: 'bg-teal-500' },
      { value: 'pink-500', label: 'Pink', tailwind: 'bg-pink-500' },
      { value: 'lime-500', label: 'Lime', tailwind: 'bg-lime-500' },
      { value: 'purple-500', label: 'Purple', tailwind: 'bg-purple-500' },
      { value: 'blue-500', label: 'Blue', tailwind: 'bg-blue-500' },
      { value: 'green-500', label: 'Green', tailwind: 'bg-green-500' },
      { value: 'red-500', label: 'Red', tailwind: 'bg-red-500' },
      { value: 'yellow-500', label: 'Yellow', tailwind: 'bg-yellow-500' },
    ]
  }
}

export default ActivitySourceConfigService.getInstance()
export { ActivitySourceConfigService }
// Developer and Creator: Jai Singh
