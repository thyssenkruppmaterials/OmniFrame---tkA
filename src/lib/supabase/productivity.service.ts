// Created and developed by Jai Singh
/**
 * RF Productivity Service
 * Handles productivity tracking and statistics for RF Terminal users
 * Follows OmniFrame service patterns and integrates with multiple Supabase tables
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

// Types
export interface ProductivityStats {
  inbound_scans: number
  put_aways: number
  picking: number
  packed: number // Items packed in Pack Tool
  shipped: number // Items shipped in Shipper Tool
  final_packed: number // Items final packed in Final Pack Tool
  putbacks: number // Putback tickets completed today
  cycle_counts: number
  /** Kit workflow stages — migration 310 (Productivity-Wiring-Kit-Workflow-Stages) */
  kit_picking: number // TO lines the operator picked off the floor / racks
  kit_building: number // Materials the operator kitted onto the BOM
  kit_inspection: number // Kits the operator inspected (org-gated)
  kit_dock_staging: number // Kits the operator staged to a dock location
  work_queue_tasks: number // Placeholder
}

export interface UserProductivityData {
  user_id: string
  user_name: string
  date: string
  stats: ProductivityStats
}

/**
 * RF Productivity Service Class
 * Handles productivity statistics for current day by user
 */
class ProductivityService {
  /**
   * Get current user's inbound scans for a specific date
   * @param targetDate - Date to query (defaults to today)
   * @returns Promise with count or error
   */
  async getUserInboundScans(
    targetDate: Date = new Date()
  ): Promise<{ data: number; error: string | null }> {
    try {
      logger.log(
        '📊 Productivity Service: Getting inbound scans for date:',
        targetDate
      )

      // Get the user's organization ID and user info
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: 0, error: 'User not authenticated' }
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ Productivity Service: Error getting user profile:',
          profileError
        )
        return { data: 0, error: 'Failed to get user organization' }
      }

      // Get date string in EST timezone
      const dateString = getESTDateString(targetDate)
      logger.log('📅 Productivity Service: Filtering by EST date:', dateString)

      // Query rr_inbound_scans for target date's scans by current user
      const { error, count } = await supabase
        .from('rr_inbound_scans')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id || '')
        .eq('scanned_by', user.id)
        .gte('scanned_at', `${dateString}T00:00:00.000Z`)
        .lte('scanned_at', `${dateString}T23:59:59.999Z`)

      if (error) {
        logger.error(
          '❌ Productivity Service: Error fetching inbound scans:',
          error
        )
        return { data: 0, error: error.message }
      }

      const scanCount = count || 0
      logger.log(
        '✅ Productivity Service: Inbound scans for',
        dateString,
        ':',
        scanCount
      )
      return { data: scanCount, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error in inbound scans:',
        error
      )
      return {
        data: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** @deprecated Use getUserInboundScans() instead */
  async getUserTodayInboundScans(): Promise<{
    data: number
    error: string | null
  }> {
    return this.getUserInboundScans(new Date())
  }

  /**
   * Get current user's put aways for today
   * @returns Promise with count or error
   */
  async getUserTodayPutaways(): Promise<{
    data: number
    error: string | null
  }> {
    try {
      logger.log('📊 Productivity Service: Getting today put aways...')

      // Get the user's organization ID and user info
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: 0, error: 'User not authenticated' }
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ Productivity Service: Error getting user profile:',
          profileError
        )
        return { data: 0, error: 'Failed to get user organization' }
      }

      // Get today's date in EST timezone for accurate comparison
      const today = new Date()
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const estParts = estFormatter.formatToParts(today)
      const estYear = estParts.find((part) => part.type === 'year')?.value
      const estMonth = estParts.find((part) => part.type === 'month')?.value
      const estDay = estParts.find((part) => part.type === 'day')?.value
      const todayDateString = `${estYear}-${estMonth}-${estDay}`

      logger.log(
        '📅 Productivity Service: Filtering by EST date:',
        todayDateString
      )

      // Query rf_putaway_operations for today's putaways by current user
      const { error, count } = await supabase
        .from('rf_putaway_operations')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id || '')
        .eq('created_by', user.id)
        .gte('created_at', `${todayDateString}T00:00:00.000Z`)
        .lte('created_at', `${todayDateString}T23:59:59.999Z`)

      if (error) {
        logger.error(
          '❌ Productivity Service: Error fetching put aways:',
          error
        )
        return { data: 0, error: error.message }
      }

      const putawayCount = count || 0
      logger.log('✅ Productivity Service: Today put aways:', putawayCount)
      return { data: putawayCount, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error in put aways:',
        error
      )
      return {
        data: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get current user's picking operations for today
   * @returns Promise with count or error
   */
  async getUserTodayPicking(): Promise<{ data: number; error: string | null }> {
    try {
      logger.log('📊 Productivity Service: Getting today picking operations...')

      // Get the user's organization ID and user info
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: 0, error: 'User not authenticated' }
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ Productivity Service: Error getting user profile:',
          profileError
        )
        return { data: 0, error: 'Failed to get user organization' }
      }

      // Get today's date in EST timezone for accurate comparison
      const today = new Date()
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const estParts = estFormatter.formatToParts(today)
      const estYear = estParts.find((part) => part.type === 'year')?.value
      const estMonth = estParts.find((part) => part.type === 'month')?.value
      const estDay = estParts.find((part) => part.type === 'day')?.value
      const todayDateString = `${estYear}-${estMonth}-${estDay}`

      logger.log(
        '📅 Productivity Service: Filtering by EST date:',
        todayDateString
      )

      // Query outbound_to_data for today's picked items by current user
      const { error, count } = await supabase
        .from('outbound_to_data')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id || '')
        .eq('picked_by', user.id)
        .gte('picked_at', `${todayDateString}T00:00:00.000Z`)
        .lte('picked_at', `${todayDateString}T23:59:59.999Z`)

      if (error) {
        logger.error(
          '❌ Productivity Service: Error fetching picking operations:',
          error
        )
        return { data: 0, error: error.message }
      }

      const pickingCount = count || 0
      logger.log(
        '✅ Productivity Service: Today picking operations:',
        pickingCount
      )
      return { data: pickingCount, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error in picking operations:',
        error
      )
      return {
        data: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get current user's packed items for today (Pack Tool)
   * @returns Promise with count or error
   */
  async getUserTodayPacked(): Promise<{ data: number; error: string | null }> {
    try {
      logger.log('📊 Productivity Service: Getting today packed items...')

      // Get the user's organization ID and user info
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: 0, error: 'User not authenticated' }
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ Productivity Service: Error getting user profile:',
          profileError
        )
        return { data: 0, error: 'Failed to get user organization' }
      }

      // Get today's date in EST timezone for accurate comparison
      const today = new Date()
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const estParts = estFormatter.formatToParts(today)
      const estYear = estParts.find((part) => part.type === 'year')?.value
      const estMonth = estParts.find((part) => part.type === 'month')?.value
      const estDay = estParts.find((part) => part.type === 'day')?.value
      const todayDateString = `${estYear}-${estMonth}-${estDay}`

      logger.log(
        '📅 Productivity Service: Filtering by EST date:',
        todayDateString
      )

      // Query outbound_to_data for today's packed items by current user
      const { error, count } = await supabase
        .from('outbound_to_data')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id || '')
        .eq('packed_by', user.id)
        .gte('packed_at', `${todayDateString}T00:00:00.000Z`)
        .lte('packed_at', `${todayDateString}T23:59:59.999Z`)

      if (error) {
        logger.error(
          '❌ Productivity Service: Error fetching packed items:',
          error
        )
        return { data: 0, error: error.message }
      }

      const packedCount = count || 0
      logger.log('✅ Productivity Service: Today packed items:', packedCount)
      return { data: packedCount, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error in packed items:',
        error
      )
      return {
        data: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get current user's shipped items for today (Shipper Tool)
   * @returns Promise with count or error
   */
  async getUserTodayShipped(): Promise<{ data: number; error: string | null }> {
    try {
      logger.log('📊 Productivity Service: Getting today shipped items...')

      // Get the user's organization ID and user info
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: 0, error: 'User not authenticated' }
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ Productivity Service: Error getting user profile:',
          profileError
        )
        return { data: 0, error: 'Failed to get user organization' }
      }

      // Get today's date in EST timezone for accurate comparison
      const today = new Date()
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const estParts = estFormatter.formatToParts(today)
      const estYear = estParts.find((part) => part.type === 'year')?.value
      const estMonth = estParts.find((part) => part.type === 'month')?.value
      const estDay = estParts.find((part) => part.type === 'day')?.value
      const todayDateString = `${estYear}-${estMonth}-${estDay}`

      logger.log(
        '📅 Productivity Service: Filtering by EST date:',
        todayDateString
      )

      // Query outbound_to_data for today's shipped items by current user
      const { error, count } = await supabase
        .from('outbound_to_data')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id || '')
        .eq('shipped_by', user.id)
        .gte('shipped_at', `${todayDateString}T00:00:00.000Z`)
        .lte('shipped_at', `${todayDateString}T23:59:59.999Z`)

      if (error) {
        logger.error(
          '❌ Productivity Service: Error fetching shipped items:',
          error
        )
        return { data: 0, error: error.message }
      }

      const shippedCount = count || 0
      logger.log('✅ Productivity Service: Today shipped items:', shippedCount)
      return { data: shippedCount, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error in shipped items:',
        error
      )
      return {
        data: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get current user's final packed items for today (Final Pack Tool)
   * @returns Promise with count or error
   */
  async getUserTodayFinalPacked(): Promise<{
    data: number
    error: string | null
  }> {
    try {
      logger.log('📊 Productivity Service: Getting today final packed items...')

      // Get the user's organization ID and user info
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: 0, error: 'User not authenticated' }
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ Productivity Service: Error getting user profile:',
          profileError
        )
        return { data: 0, error: 'Failed to get user organization' }
      }

      // Get today's date in EST timezone for accurate comparison
      const today = new Date()
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const estParts = estFormatter.formatToParts(today)
      const estYear = estParts.find((part) => part.type === 'year')?.value
      const estMonth = estParts.find((part) => part.type === 'month')?.value
      const estDay = estParts.find((part) => part.type === 'day')?.value
      const todayDateString = `${estYear}-${estMonth}-${estDay}`

      logger.log(
        '📅 Productivity Service: Filtering by EST date:',
        todayDateString
      )

      // Query outbound_to_data for today's final packed items by current user
      const { error, count } = await supabase
        .from('outbound_to_data')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id || '')
        .eq('final_packed_by', user.id)
        .gte('final_packed_at', `${todayDateString}T00:00:00.000Z`)
        .lte('final_packed_at', `${todayDateString}T23:59:59.999Z`)

      if (error) {
        logger.error(
          '❌ Productivity Service: Error fetching final packed items:',
          error
        )
        return { data: 0, error: error.message }
      }

      const finalPackedCount = count || 0
      logger.log(
        '✅ Productivity Service: Today final packed items:',
        finalPackedCount
      )
      return { data: finalPackedCount, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error in final packed items:',
        error
      )
      return {
        data: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get current user's putbacks completed today
   * @returns Promise with count or error
   */
  async getUserTodayPutbacks(): Promise<{
    data: number
    error: string | null
  }> {
    try {
      logger.log('📊 Productivity Service: Getting today putbacks...')

      // Get the user's organization ID and user info
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: 0, error: 'User not authenticated' }
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ Productivity Service: Error getting user profile:',
          profileError
        )
        return { data: 0, error: 'Failed to get user organization' }
      }

      // Get today's date range in EST timezone, then convert to UTC for querying
      const today = new Date()

      // Create EST midnight today
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const estParts = estFormatter.formatToParts(today)
      const estYear = estParts.find((part) => part.type === 'year')?.value
      const estMonth = estParts.find((part) => part.type === 'month')?.value
      const estDay = estParts.find((part) => part.type === 'day')?.value

      // Create Date objects for EST midnight (start and end of day)
      const estMidnight = new Date(
        `${estYear}-${estMonth}-${estDay}T00:00:00-05:00`
      ) // EST is UTC-5
      const estEndOfDay = new Date(
        `${estYear}-${estMonth}-${estDay}T23:59:59.999-05:00`
      )

      const startUTC = estMidnight.toISOString()
      const endUTC = estEndOfDay.toISOString()

      logger.log(
        '📅 Productivity Service: Filtering by EST date:',
        `${estYear}-${estMonth}-${estDay}`
      )
      logger.log('📅 UTC Range:', startUTC, 'to', endUTC)

      // Query putback_tickets for today's putbacks created by current user
      const { error, count } = await supabase
        .from('putback_tickets')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id || '')
        .eq('created_by', user.id)
        .gte('created_at', startUTC)
        .lte('created_at', endUTC)

      if (error) {
        logger.error('❌ Productivity Service: Error fetching putbacks:', error)
        return { data: 0, error: error.message }
      }

      const putbackCount = count || 0
      logger.log('✅ Productivity Service: Today putbacks:', putbackCount)
      return { data: putbackCount, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error in putbacks:',
        error
      )
      return {
        data: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get current user's cycle counts completed today
   * @returns Promise with count or error
   */
  async getUserTodayCycleCounts(): Promise<{
    data: number
    error: string | null
  }> {
    try {
      logger.log('📊 Productivity Service: Getting today cycle counts...')

      // Get the user's organization ID and user info
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: 0, error: 'User not authenticated' }
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ Productivity Service: Error getting user profile:',
          profileError
        )
        return { data: 0, error: 'Failed to get user organization' }
      }

      // Get today's date in EST timezone for accurate comparison
      const today = new Date()
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const estParts = estFormatter.formatToParts(today)
      const estYear = estParts.find((part) => part.type === 'year')?.value
      const estMonth = estParts.find((part) => part.type === 'month')?.value
      const estDay = estParts.find((part) => part.type === 'day')?.value
      const todayDateString = `${estYear}-${estMonth}-${estDay}`

      logger.log(
        '📅 Productivity Service: Filtering by EST date:',
        todayDateString
      )

      // Query rr_cyclecount_data for today's completed counts by current user
      const { error, count } = await supabase
        .from('rr_cyclecount_data')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id || '')
        .eq('assigned_to', user.id)
        .in('status', ['completed', 'approved']) // Count both completed and approved
        .gte('completed_at', `${todayDateString}T00:00:00.000Z`)
        .lte('completed_at', `${todayDateString}T23:59:59.999Z`)

      if (error) {
        logger.error(
          '❌ Productivity Service: Error fetching cycle counts:',
          error
        )
        return { data: 0, error: error.message }
      }

      const cycleCountCount = count || 0
      logger.log(
        '✅ Productivity Service: Today cycle counts:',
        cycleCountCount
      )
      return { data: cycleCountCount, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error in cycle counts:',
        error
      )
      return {
        data: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get all productivity stats for current user today
   * @returns Promise with complete productivity stats or error
   */
  async getUserTodayStats(): Promise<{
    data: ProductivityStats | null
    error: string | null
  }> {
    try {
      logger.log('📊 Productivity Service: Getting complete today stats...')

      // Get all productivity metrics in parallel
      const [
        inboundResult,
        putawayResult,
        pickingResult,
        packedResult,
        shippedResult,
        finalPackedResult,
        putbackResult,
        cycleCountResult,
      ] = await Promise.all([
        this.getUserTodayInboundScans(),
        this.getUserTodayPutaways(),
        this.getUserTodayPicking(),
        this.getUserTodayPacked(),
        this.getUserTodayShipped(),
        this.getUserTodayFinalPacked(),
        this.getUserTodayPutbacks(),
        this.getUserTodayCycleCounts(),
      ])

      // Check for errors
      if (inboundResult.error) {
        return {
          data: null,
          error: `Inbound scans error: ${inboundResult.error}`,
        }
      }
      if (putawayResult.error) {
        return { data: null, error: `Put aways error: ${putawayResult.error}` }
      }
      if (pickingResult.error) {
        return { data: null, error: `Picking error: ${pickingResult.error}` }
      }
      if (packedResult.error) {
        logger.warn(
          '⚠️ Productivity Service: Packed error (non-critical):',
          packedResult.error
        )
      }
      if (shippedResult.error) {
        logger.warn(
          '⚠️ Productivity Service: Shipped error (non-critical):',
          shippedResult.error
        )
      }
      if (finalPackedResult.error) {
        logger.warn(
          '⚠️ Productivity Service: Final packed error (non-critical):',
          finalPackedResult.error
        )
      }
      if (putbackResult.error) {
        logger.warn(
          '⚠️ Productivity Service: Putback error (non-critical):',
          putbackResult.error
        )
      }
      if (cycleCountResult.error) {
        logger.warn(
          '⚠️ Productivity Service: Cycle count error (non-critical):',
          cycleCountResult.error
        )
      }

      const stats: ProductivityStats = {
        inbound_scans: inboundResult.data,
        put_aways: putawayResult.data,
        picking: pickingResult.data,
        packed: packedResult.data,
        shipped: shippedResult.data,
        final_packed: finalPackedResult.data,
        putbacks: putbackResult.data,
        cycle_counts: cycleCountResult.data,
        // Kit workflow stages are populated by the batch RPC path in
        // team-performance.service (see migration 310). This per-user
        // legacy fallback path leaves them at 0 — the day-aware path
        // overlays them when present.
        kit_picking: 0,
        kit_building: 0,
        kit_inspection: 0,
        kit_dock_staging: 0,
        work_queue_tasks: 0, // Placeholder - not implemented yet
      }

      logger.log('✅ Productivity Service: Complete today stats:', stats)
      return { data: stats, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error in complete stats:',
        error
      )
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get current user information for productivity display
   * @returns Promise with user data or error
   */
  async getCurrentUserInfo(): Promise<{
    data: { id: string; name: string } | null
    error: string | null
  }> {
    try {
      // Get the user's organization ID and user info
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // Get user profile for display name
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('full_name, first_name, last_name')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ Productivity Service: Error getting user profile:',
          profileError
        )
        // Fall back to email if profile not found
        const displayName = user.email?.split('@')[0] || 'User'
        return { data: { id: user.id, name: displayName }, error: null }
      }

      const displayName =
        profile.full_name ||
        `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
        user.email?.split('@')[0] ||
        'User'

      return { data: { id: user.id, name: displayName }, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ Productivity Service: Unexpected error getting user info:',
        error
      )
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

// Export singleton instance
export const productivityService = new ProductivityService()

// Created and developed by Jai Singh
