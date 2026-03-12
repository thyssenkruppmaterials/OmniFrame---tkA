import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

/**
 * Hot Part Alert Service
 *
 * Manages hot part alert rules for inbound scanning.
 * When scanned values match an active alert rule (by material number, SO/Line,
 * RMA/AFA #, or tracking number), RF operators receive immediate priority
 * notifications to receive and putaway the item.
 */

export interface HotPartAlert {
  id: string
  match_value: string
  match_type: 'material_number' | 'so_line_rma_afa' | 'tracking_number' | 'any'
  notes: string | null
  is_active: boolean
  priority: 'normal' | 'high' | 'critical'
  created_by: string | null
  created_at: string
  updated_at: string
  organization_id: string
}

export type HotPartAlertInsert = Omit<
  HotPartAlert,
  'id' | 'created_at' | 'updated_at'
>
export type HotPartAlertUpdate = Partial<
  Pick<
    HotPartAlert,
    'match_value' | 'match_type' | 'notes' | 'is_active' | 'priority'
  >
>

export const MATCH_TYPE_LABELS: Record<HotPartAlert['match_type'], string> = {
  material_number: 'Material Number',
  so_line_rma_afa: 'SO/Line, RMA/AFA #',
  tracking_number: 'Tracking Number',
  any: 'Any Field',
}

export const PRIORITY_LABELS: Record<HotPartAlert['priority'], string> = {
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
}

class HotPartAlertService {
  private static instance: HotPartAlertService

  private constructor() {}

  public static getInstance(): HotPartAlertService {
    if (!HotPartAlertService.instance) {
      HotPartAlertService.instance = new HotPartAlertService()
    }
    return HotPartAlertService.instance
  }

  /**
   * Fetch all hot part alerts for the current user's organization
   */
  async fetchAlerts(
    activeOnly = false
  ): Promise<{ data: HotPartAlert[]; error: any }> {
    try {
      // Cast to any - rr_hot_part_alerts is not yet in generated database.types.ts
      let query = (supabase as any)
        .from('rr_hot_part_alerts')
        .select('*')
        .order('created_at', { ascending: false })

      if (activeOnly) {
        query = query.eq('is_active', true)
      }

      const { data, error } = await query
      return { data: (data as HotPartAlert[]) || [], error }
    } catch (error) {
      logger.error('Error fetching hot part alerts:', error)
      return { data: [], error }
    }
  }

  /**
   * Create a new hot part alert rule
   */
  async createAlert(alert: {
    match_value: string
    match_type: HotPartAlert['match_type']
    notes?: string
    priority?: HotPartAlert['priority']
  }): Promise<{ data: HotPartAlert | null; error: any }> {
    try {
      // Get current user and their org
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()
      if (authError || !user) {
        return {
          data: null,
          error: authError || new Error('User not authenticated'),
        }
      }

      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile?.organization_id) {
        return {
          data: null,
          error: profileError || new Error('Organization not found'),
        }
      }

      // Cast to any - rr_hot_part_alerts is not yet in generated database.types.ts
      const { data, error } = await (supabase as any)
        .from('rr_hot_part_alerts')
        .insert({
          match_value: alert.match_value.trim(),
          match_type: alert.match_type,
          notes: alert.notes?.trim() || null,
          priority: alert.priority || 'high',
          is_active: true,
          created_by: user.id,
          organization_id: profile.organization_id,
        })
        .select()
        .single()

      return { data: data as HotPartAlert, error }
    } catch (error) {
      logger.error('Error creating hot part alert:', error)
      return { data: null, error }
    }
  }

  /**
   * Update an existing hot part alert
   */
  async updateAlert(
    id: string,
    updates: HotPartAlertUpdate
  ): Promise<{ data: HotPartAlert | null; error: any }> {
    try {
      // Cast to any - rr_hot_part_alerts is not yet in generated database.types.ts
      const { data, error } = await (supabase as any)
        .from('rr_hot_part_alerts')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      return { data: data as HotPartAlert, error }
    } catch (error) {
      logger.error('Error updating hot part alert:', error)
      return { data: null, error }
    }
  }

  /**
   * Toggle active status of a hot part alert
   */
  async toggleAlert(
    id: string,
    isActive: boolean
  ): Promise<{ data: HotPartAlert | null; error: any }> {
    return this.updateAlert(id, { is_active: isActive })
  }

  /**
   * Delete a hot part alert
   */
  async deleteAlert(id: string): Promise<{ success: boolean; error: any }> {
    try {
      // Cast to any - rr_hot_part_alerts is not yet in generated database.types.ts
      const { error } = await (supabase as any)
        .from('rr_hot_part_alerts')
        .delete()
        .eq('id', id)

      return { success: !error, error }
    } catch (error) {
      logger.error('Error deleting hot part alert:', error)
      return { success: false, error }
    }
  }

  /**
   * Check scanned data against active hot part alerts using the database function.
   * Performs substring matching - the match_value can appear anywhere within the scanned field.
   *
   * @returns Array of matching alerts, ordered by priority (critical > high > normal)
   */
  async checkForAlerts(scanData: {
    material_number?: string | null
    so_line_rma_afa?: string | null
    tracking_number?: string | null
  }): Promise<{ alerts: HotPartAlert[]; error: any }> {
    try {
      // Get organization ID for scoping
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()
      if (authError || !user) {
        return {
          alerts: [],
          error: authError || new Error('User not authenticated'),
        }
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      // Call the database function for efficient server-side matching
      // Cast to any - check_hot_part_alerts RPC is not yet in generated database.types.ts
      const { data, error } = await (supabase as any).rpc(
        'check_hot_part_alerts',
        {
          p_material_number: scanData.material_number || null,
          p_so_line_rma_afa: scanData.so_line_rma_afa || null,
          p_tracking_number: scanData.tracking_number || null,
          p_organization_id: profile?.organization_id || null,
        }
      )

      if (error) {
        logger.error('Error checking hot part alerts:', error)
        return { alerts: [], error }
      }

      return { alerts: (data as unknown as HotPartAlert[]) || [], error: null }
    } catch (error) {
      logger.error('Error checking hot part alerts:', error)
      return { alerts: [], error }
    }
  }

  /**
   * Client-side check for hot part alerts (faster, uses cached alerts).
   * Useful for real-time validation as the user types/scans.
   * Performs case-insensitive substring matching.
   */
  checkForAlertsLocal(
    alerts: HotPartAlert[],
    scanData: {
      material_number?: string | null
      so_line_rma_afa?: string | null
      tracking_number?: string | null
    }
  ): HotPartAlert[] {
    if (!alerts || alerts.length === 0) return []

    const activeAlerts = alerts.filter((a) => a.is_active)
    if (activeAlerts.length === 0) return []

    return activeAlerts
      .filter((alert) => {
        const matchVal = alert.match_value.toLowerCase()

        switch (alert.match_type) {
          case 'material_number':
            return (
              scanData.material_number &&
              scanData.material_number.toLowerCase().includes(matchVal)
            )
          case 'so_line_rma_afa':
            return (
              scanData.so_line_rma_afa &&
              scanData.so_line_rma_afa.toLowerCase().includes(matchVal)
            )
          case 'tracking_number':
            return (
              scanData.tracking_number &&
              scanData.tracking_number.toLowerCase().includes(matchVal)
            )
          case 'any':
            return (
              (scanData.material_number &&
                scanData.material_number.toLowerCase().includes(matchVal)) ||
              (scanData.so_line_rma_afa &&
                scanData.so_line_rma_afa.toLowerCase().includes(matchVal)) ||
              (scanData.tracking_number &&
                scanData.tracking_number.toLowerCase().includes(matchVal))
            )
          default:
            return false
        }
      })
      .sort((a, b) => {
        const priorityOrder = { critical: 1, high: 2, normal: 3 }
        return (
          (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3)
        )
      })
  }
}

// Export singleton instance
export const hotPartAlertService = HotPartAlertService.getInstance()
// Developer and Creator: Jai Singh
