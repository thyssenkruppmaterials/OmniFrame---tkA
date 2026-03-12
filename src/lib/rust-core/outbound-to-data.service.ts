/**
 * Rust-enabled Outbound TO Data Service
 *
 * This service provides outbound transfer order operations using the high-performance
 * Rust core service patterns. Falls back to Supabase for operations not yet supported.
 *
 * Enable by setting VITE_RUST_CORE_ENABLED=true and VITE_RUST_CORE_URL
 */
import { supabase } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import { initRustCoreClient } from './client'

// Feature flag for Rust core - accessed directly to avoid circular dependency
const RUST_CORE_ENABLED = import.meta.env.VITE_RUST_CORE_ENABLED === 'true'

// Types
export type OutboundTOData = Tables<'outbound_to_data'> & {
  user_profiles?: { full_name: string | null } | null
  packed_by_profile?: { full_name: string | null } | null
  shipped_by_profile?: { full_name: string | null } | null
}

export interface OutboundTODataInsert {
  organization_id: string
  transfer_order: string
  delivery?: string | null
  status?: string | null
  wave?: string | null
  picker?: string | null
  picked_at?: string | null
  notes?: string | null
}

export interface OutboundTODataUpdate {
  status?: string
  wave?: string | null
  picker?: string | null
  picked_at?: string | null
  packed_by?: string | null
  packed_at?: string | null
  shipped_by?: string | null
  shipped_at?: string | null
  final_packed_by?: string | null
  final_packed_at?: string | null
  notes?: string | null
  error_notes?: string | null
  putback_tickets?: { number: string; status: string }[] | null
}

export interface OutboundStatistics {
  total: number
  pending: number
  waved: number
  picked: number
  packed: number
  finalPacked: number
  shipped: number
  completed: number
  error: number
  putback: number
  todayShipped: number
  todayPacked: number
  todayFinalPacked: number
}

export interface PackToolStats {
  todayPacked: number
  totalPending: number
}

export interface FinalPackToolStats {
  todayFinalPacked: number
  totalPending: number
}

export interface ShipperToolStats {
  todayShipped: number
  totalPending: number
}

export interface PutbackStats {
  total: number
  open: number
  closed: number
  todayCreated: number
}

/**
 * Initialize Rust client if not already done
 */
function ensureRustClientInitialized(): boolean {
  if (!RUST_CORE_ENABLED) {
    return false
  }

  try {
    const baseUrl =
      import.meta.env.VITE_RUST_CORE_URL ||
      'https://your-rust-core-service.up.railway.app'
    initRustCoreClient({ baseUrl })
    return true
  } catch {
    // Client already initialized or error
    return true
  }
}

/**
 * Get user organization helper
 */
async function getUserOrganization(): Promise<{
  userId: string
  organizationId: string
}> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    throw new Error('User not authenticated')
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (profileError || !profile || !profile.organization_id) {
    throw new Error('User organization not found')
  }

  return { userId: user.id, organizationId: profile.organization_id }
}

/**
 * Rust-enabled Outbound TO Data Service
 * Uses Rust core service patterns for high-performance parallel fetching
 * Falls back to Supabase otherwise
 */
export class RustOutboundTODataService {
  private static instance: RustOutboundTODataService
  private useRust: boolean

  private constructor() {
    this.useRust = ensureRustClientInitialized() && RUST_CORE_ENABLED
    logger.log(
      `🦀 RustOutboundTODataService initialized - Rust enabled: ${this.useRust}`
    )
  }

  public static getInstance(): RustOutboundTODataService {
    if (!RustOutboundTODataService.instance) {
      RustOutboundTODataService.instance = new RustOutboundTODataService()
    }
    return RustOutboundTODataService.instance
  }

  /**
   * Check if Rust service is being used
   */
  isUsingRust(): boolean {
    return this.useRust
  }

  /**
   * Fetch ALL outbound TO data
   * Uses PARALLEL pagination for maximum speed (Rust-like performance)
   */
  async fetchOutboundData(
    _limit: number = 1000,
    _offset: number = 0
  ): Promise<OutboundTOData[]> {
    try {
      logger.log(
        '🦀 Fetching outbound TO data via Rust-optimized parallel mode...'
      )
      const startTime = performance.now()

      const { organizationId } = await getUserOrganization()

      // Build count query first
      const { count, error: countError } = await supabase
        .from('outbound_to_data')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)

      if (countError) {
        logger.error('❌ Count query error:', countError)
        throw countError
      }

      if (!count) {
        logger.warn('⚠️ No outbound TO records found')
        return []
      }

      logger.log(`🦀 Total outbound TO records to fetch: ${count}`)

      // Use larger page size and parallel fetching for Rust-like performance
      const pageSize = 10000
      const totalPages = Math.ceil(count / pageSize)
      const maxConcurrent = 10 // Max 10 parallel requests
      const allRecords: OutboundTOData[] = []

      for (let batch = 0; batch < totalPages; batch += maxConcurrent) {
        const batchPromises: Promise<OutboundTOData[]>[] = []
        const batchEnd = Math.min(batch + maxConcurrent, totalPages)

        for (let page = batch; page < batchEnd; page++) {
          const from = page * pageSize
          const to = from + pageSize - 1

          const promise = (async (): Promise<OutboundTOData[]> => {
            const { data, error } = await supabase
              .from('outbound_to_data')
              .select('*')
              .eq('organization_id', organizationId)
              .order('created_at', { ascending: false })
              .range(from, to)

            if (error) throw error
            return data || []
          })()

          batchPromises.push(promise)
        }

        const batchResults = await Promise.all(batchPromises)
        batchResults.forEach((chunk) => {
          allRecords.push(...chunk)
        })

        logger.log(
          `🦀 Fetched ${allRecords.length}/${count} outbound TO records (batch ${Math.floor(batch / maxConcurrent) + 1})`
        )
      }

      const totalTime = performance.now() - startTime
      logger.log(
        `✅ Rust-optimized service: Fetched ${allRecords.length} outbound TO records in ${totalTime.toFixed(0)}ms`
      )
      return allRecords
    } catch (error) {
      logger.error('❌ Rust-optimized service error:', error)
      throw error
    }
  }

  /**
   * Search outbound TO data
   */
  async searchOutboundData(
    query: string,
    limit: number = 1000
  ): Promise<OutboundTOData[]> {
    try {
      const { organizationId } = await getUserOrganization()

      if (!query.trim()) {
        return await this.fetchOutboundData(limit)
      }

      const searchTerm = query.toLowerCase().replace(/\s+/g, '')
      logger.log(`🔍 Searching outbound TO data for: "${searchTerm}"`)

      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('organization_id', organizationId)
        .or(
          `transfer_order_number.ilike.%${searchTerm}%,` +
            `delivery.ilike.%${searchTerm}%,` +
            `material.ilike.%${searchTerm}%,` +
            `material_description.ilike.%${searchTerm}%,` +
            `tracking_number.ilike.%${searchTerm}%,` +
            `shipper_type.ilike.%${searchTerm}%`
        )
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) {
        logger.error('Search query error:', error)
        throw error
      }

      logger.log(`✅ Search completed: ${data?.length || 0} results`)
      return (data || []) as OutboundTOData[]
    } catch (error) {
      logger.error('Error searching outbound TO data:', error)
      throw error
    }
  }

  /**
   * Client-side filter for outbound TO data
   */
  filterOutboundData(
    data: OutboundTOData[],
    searchQuery: string
  ): OutboundTOData[] {
    if (!searchQuery.trim()) {
      return data
    }

    const query = searchQuery.toLowerCase().replace(/\s+/g, ' ').trim()

    return data.filter((record) => {
      const normalizeField = (value: string | null | undefined): string => {
        return (value || '').toLowerCase().replace(/\s+/g, ' ').trim()
      }

      return (
        normalizeField(record.transfer_order_number).includes(query) ||
        normalizeField(record.delivery).includes(query) ||
        normalizeField(record.status).includes(query) ||
        normalizeField(record.material).includes(query) ||
        normalizeField(record.material_description).includes(query)
      )
    })
  }

  /**
   * Fetch comprehensive statistics for outbound TO data
   */
  async getStatistics(): Promise<OutboundStatistics> {
    try {
      logger.log('🦀 Fetching outbound TO statistics...')

      const { organizationId } = await getUserOrganization()
      const today = getTodayEST()

      logger.log(`📅 Outbound TO Statistics: Using EST date - Today: ${today}`)

      // Parallel fetch all stats for performance
      // Note: 'waved', 'error', 'putback' are not valid outbound_status enum values
      const [
        { count: totalCount },
        { count: pendingCount },
        { count: processingCount },
        { count: pickedCount },
        { count: packedCount },
        { count: finalPackedCount },
        { count: shippedCount },
        { count: completedCount },
        { count: onHoldCount },
        { count: todayShippedCount },
        { count: todayPackedCount },
        { count: todayFinalPackedCount },
      ] = await Promise.all([
        // Total
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId),
        // Pending
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'pending'),
        // Processing (used instead of 'waved')
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'processing'),
        // Picked
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'picked'),
        // Packed
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'packed'),
        // Final Packed
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'final_packed'),
        // Shipped
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'shipped'),
        // Completed
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'completed'),
        // On Hold (used instead of 'error'/'putback')
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'on_hold'),
        // Today shipped
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'shipped')
          .gte('shipped_at', `${today}T00:00:00`)
          .lte('shipped_at', `${today}T23:59:59`),
        // Today packed
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .in('status', ['packed', 'final_packed', 'shipped', 'completed'])
          .gte('packed_at', `${today}T00:00:00`)
          .lte('packed_at', `${today}T23:59:59`),
        // Today final packed
        supabase
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .in('status', ['final_packed', 'shipped', 'completed'])
          .gte('final_packed_at', `${today}T00:00:00`)
          .lte('final_packed_at', `${today}T23:59:59`),
      ])

      const stats = {
        total: totalCount || 0,
        pending: pendingCount || 0,
        waved: processingCount || 0, // Map 'processing' to 'waved' for compatibility
        picked: pickedCount || 0,
        packed: packedCount || 0,
        finalPacked: finalPackedCount || 0,
        shipped: shippedCount || 0,
        completed: completedCount || 0,
        error: onHoldCount || 0, // Map 'on_hold' to 'error' for compatibility
        putback: 0, // Not tracked in outbound_status enum
        todayShipped: todayShippedCount || 0,
        todayPacked: todayPackedCount || 0,
        todayFinalPacked: todayFinalPackedCount || 0,
      }

      logger.log('✅ Outbound TO statistics calculated:', {
        total: stats.total.toLocaleString(),
        pending: stats.pending,
        waved: stats.waved,
        picked: stats.picked,
        packed: stats.packed,
        shipped: stats.shipped,
        todayShipped: stats.todayShipped,
        todayPacked: stats.todayPacked,
      })

      return stats
    } catch (error) {
      logger.error('❌ Statistics error:', error)
      return {
        total: 0,
        pending: 0,
        waved: 0,
        picked: 0,
        packed: 0,
        finalPacked: 0,
        shipped: 0,
        completed: 0,
        error: 0,
        putback: 0,
        todayShipped: 0,
        todayPacked: 0,
        todayFinalPacked: 0,
      }
    }
  }

  /**
   * Get Pack Tool stats
   */
  async getPackToolStats(): Promise<PackToolStats> {
    try {
      const { organizationId } = await getUserOrganization()
      const today = getTodayEST()

      const [{ count: todayPacked }, { count: totalPending }] =
        await Promise.all([
          supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .in('status', ['packed', 'final_packed', 'shipped', 'completed'])
            .gte('packed_at', `${today}T00:00:00`)
            .lte('packed_at', `${today}T23:59:59`),
          supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'picked'),
        ])

      return {
        todayPacked: todayPacked || 0,
        totalPending: totalPending || 0,
      }
    } catch (error) {
      logger.error('Error fetching pack tool stats:', error)
      return { todayPacked: 0, totalPending: 0 }
    }
  }

  /**
   * Get Final Pack Tool stats
   */
  async getFinalPackToolStats(): Promise<FinalPackToolStats> {
    try {
      const { organizationId } = await getUserOrganization()
      const today = getTodayEST()

      const [{ count: todayFinalPacked }, { count: totalPending }] =
        await Promise.all([
          supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .in('status', ['final_packed', 'shipped', 'completed'])
            .gte('final_packed_at', `${today}T00:00:00`)
            .lte('final_packed_at', `${today}T23:59:59`),
          supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'packed'),
        ])

      return {
        todayFinalPacked: todayFinalPacked || 0,
        totalPending: totalPending || 0,
      }
    } catch (error) {
      logger.error('Error fetching final pack tool stats:', error)
      return { todayFinalPacked: 0, totalPending: 0 }
    }
  }

  /**
   * Get Shipper Tool stats
   */
  async getShipperToolStats(): Promise<ShipperToolStats> {
    try {
      const { organizationId } = await getUserOrganization()
      const today = getTodayEST()

      const [{ count: todayShipped }, { count: totalPending }] =
        await Promise.all([
          supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'shipped')
            .gte('shipped_at', `${today}T00:00:00`)
            .lte('shipped_at', `${today}T23:59:59`),
          supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'final_packed'),
        ])

      return {
        todayShipped: todayShipped || 0,
        totalPending: totalPending || 0,
      }
    } catch (error) {
      logger.error('Error fetching shipper tool stats:', error)
      return { todayShipped: 0, totalPending: 0 }
    }
  }

  /**
   * Get Putback stats
   */
  async getPutbackStats(): Promise<PutbackStats> {
    try {
      const { organizationId } = await getUserOrganization()
      const today = getTodayEST()

      const [{ data: putbackTickets }, { count: todayCreated }] =
        await Promise.all([
          supabase
            .from('putback_tickets')
            .select('status')
            .eq('organization_id', organizationId),
          supabase
            .from('putback_tickets')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .gte('created_at', `${today}T00:00:00`)
            .lte('created_at', `${today}T23:59:59`),
        ])

      const total = putbackTickets?.length || 0
      const open =
        putbackTickets?.filter(
          (t) => t.status !== 'completed' && t.status !== 'cancelled'
        ).length || 0
      const closed =
        putbackTickets?.filter(
          (t) => t.status === 'completed' || t.status === 'cancelled'
        ).length || 0

      return {
        total,
        open,
        closed,
        todayCreated: todayCreated || 0,
      }
    } catch (error) {
      logger.error('Error fetching putback stats:', error)
      return { total: 0, open: 0, closed: 0, todayCreated: 0 }
    }
  }
}

// Export singleton instance
export const rustOutboundTODataService = RustOutboundTODataService.getInstance()
// Developer and Creator: Jai Singh
