/**
 * Date-Aware Productivity Service
 * Extends productivity service with date selection support
 * Allows querying productivity stats for any specific date
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// Helper function to get date string in EST timezone
function getESTDateString(date: Date): string {
  const estFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const estParts = estFormatter.formatToParts(date)
  const estYear = estParts.find((part) => part.type === 'year')?.value
  const estMonth = estParts.find((part) => part.type === 'month')?.value
  const estDay = estParts.find((part) => part.type === 'day')?.value
  return `${estYear}-${estMonth}-${estDay}`
}

export interface ProductivityStats {
  inbound_scans: number
  cart_stows: number
  put_aways: number
  picking: number
  packed: number
  shipped: number
  final_packed: number
  putbacks: number
  cycle_counts: number
  work_queue_tasks: number
}

class DateAwareProductivityService {
  /**
   * Get productivity stats for a specific date
   * @param targetDate - Date to query stats for
   * @returns Promise with complete productivity stats or error
   */
  async getStatsForDate(
    targetDate: Date
  ): Promise<{ data: ProductivityStats | null; error: string | null }> {
    try {
      logger.log(
        '📊 Date-Aware Productivity: Getting stats for date:',
        targetDate
      )

      // Get user auth
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // Get user profile
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        return { data: null, error: 'Failed to get user organization' }
      }

      const dateString = getESTDateString(targetDate)
      const orgId = profile.organization_id || ''

      logger.log(
        '📅 Date-Aware Productivity: Querying for EST date:',
        dateString
      )

      // Execute all queries in parallel
      const [
        inboundScans,
        putaways,
        cartStows,
        picking,
        packed,
        shipped,
        finalPacked,
        putbacks,
        cycleCounts,
      ] = await Promise.all([
        // Inbound Scans
        supabase
          .from('rr_inbound_scans')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('scanned_by', user.id)
          .gte('scanned_at', `${dateString}T00:00:00.000Z`)
          .lte('scanned_at', `${dateString}T23:59:59.999Z`),

        // Cart Stows
        (supabase as any)
          .from('inbound_cart_assignments')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('stowed_by', user.id)
          .gte('stowed_at', `${dateString}T00:00:00.000Z`)
          .lte('stowed_at', `${dateString}T23:59:59.999Z`),

        // Put Aways
        supabase
          .from('rf_putaway_operations')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('created_by', user.id)
          .gte('created_at', `${dateString}T00:00:00.000Z`)
          .lte('created_at', `${dateString}T23:59:59.999Z`),

        // Picking
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('picked_by', user.id)
          .gte('picked_at', `${dateString}T00:00:00.000Z`)
          .lte('picked_at', `${dateString}T23:59:59.999Z`),

        // Packed
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('packed_by', user.id)
          .gte('packed_at', `${dateString}T00:00:00.000Z`)
          .lte('packed_at', `${dateString}T23:59:59.999Z`),

        // Shipped
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('shipped_by', user.id)
          .gte('shipped_at', `${dateString}T00:00:00.000Z`)
          .lte('shipped_at', `${dateString}T23:59:59.999Z`),

        // Final Packed
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('final_packed_by', user.id)
          .gte('final_packed_at', `${dateString}T00:00:00.000Z`)
          .lte('final_packed_at', `${dateString}T23:59:59.999Z`),

        // Putbacks (count created, not processed)
        supabase
          .from('putback_tickets')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('created_by', user.id)
          .gte('created_at', `${dateString}T00:00:00.000Z`)
          .lte('created_at', `${dateString}T23:59:59.999Z`),

        // Cycle Counts
        supabase
          .from('rr_cyclecount_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('assigned_to', user.id)
          .in('status', ['completed', 'approved'])
          .gte('completed_at', `${dateString}T00:00:00.000Z`)
          .lte('completed_at', `${dateString}T23:59:59.999Z`),
      ])

      // Check for errors
      if (inboundScans.error) {
        logger.error('❌ Inbound scans error:', inboundScans.error)
        return {
          data: null,
          error: `Inbound scans: ${inboundScans.error.message}`,
        }
      }
      if (putaways.error) {
        logger.error('❌ Putaways error:', putaways.error)
        return { data: null, error: `Putaways: ${putaways.error.message}` }
      }
      if (picking.error) {
        logger.error('❌ Picking error:', picking.error)
        return { data: null, error: `Picking: ${picking.error.message}` }
      }

      // Non-critical errors - just log warnings
      if (packed.error) logger.warn('⚠️ Packed error:', packed.error)
      if (shipped.error) logger.warn('⚠️ Shipped error:', shipped.error)
      if (finalPacked.error)
        logger.warn('⚠️ Final packed error:', finalPacked.error)
      if (putbacks.error) logger.warn('⚠️ Putbacks error:', putbacks.error)
      if (cycleCounts.error)
        logger.warn('⚠️ Cycle counts error:', cycleCounts.error)

      const stats: ProductivityStats = {
        inbound_scans: inboundScans.count || 0,
        cart_stows: cartStows.count || 0,
        put_aways: putaways.count || 0,
        picking: picking.count || 0,
        packed: packed.count || 0,
        shipped: shipped.count || 0,
        final_packed: finalPacked.count || 0,
        putbacks: putbacks.count || 0,
        cycle_counts: cycleCounts.count || 0,
        work_queue_tasks: 0,
      }

      logger.log(
        '✅ Date-Aware Productivity: Stats for',
        dateString,
        ':',
        stats
      )
      return { data: stats, error: null }
    } catch (error: unknown) {
      logger.error('❌ Date-Aware Productivity: Unexpected error:', error)
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

// Export singleton instance
export const dateAwareProductivityService = new DateAwareProductivityService()
// Developer and Creator: Jai Singh
