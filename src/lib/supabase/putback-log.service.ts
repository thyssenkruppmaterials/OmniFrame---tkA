// Created and developed by Jai Singh
/**
 * Putback Log Service - October 20, 2025
 *
 * Comprehensive service for managing putback ticket data operations.
 * Follows established patterns from PutawayLogService.
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import type { PutbackTicket } from './database.types'

// Putback ticket with user profile data
export type PutbackTicketWithUser = PutbackTicket & {
  creator_name?: string | null
  creator_email?: string | null
  processor_name?: string | null
  processor_email?: string | null
}

// Service class for putback log operations
export class PutbackLogService {
  private static instance: PutbackLogService

  private constructor() {
    // Private constructor for singleton pattern
  }

  static getInstance(): PutbackLogService {
    if (!PutbackLogService.instance) {
      PutbackLogService.instance = new PutbackLogService()
    }
    return PutbackLogService.instance
  }

  /**
   * Fetch putback tickets with optimized initial load (1000 rows)
   * @param limit - Maximum number of records to fetch (default: 1000)
   * @param offset - Starting position for pagination (default: 0)
   */
  async fetchPutbackTickets(
    limit: number = 1000,
    offset: number = 0
  ): Promise<PutbackTicketWithUser[]> {
    try {
      logger.log(
        `📋 Fetching putback tickets (limit: ${limit}, offset: ${offset})...`
      )

      const { data, error } = await supabase
        .from('putback_tickets')
        .select(
          `
          *,
          creator:created_by(id, full_name, first_name, last_name, email),
          processor:processed_by(id, full_name, first_name, last_name, email)
        `
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) {
        logger.error('❌ Error fetching putback tickets:', error)
        throw error
      }

      if (!data || data.length === 0) {
        logger.log('⚠️ No putback tickets found')
        return []
      }

      // Transform the data to flatten user profile information
      const processedData = data.map((ticket) => {
        const creator = ticket.creator as any
        const processor = ticket.processor as any

        return {
          ...ticket,
          creator: undefined,
          processor: undefined,
          creator_name:
            creator?.full_name ||
            (creator?.first_name
              ? `${creator.first_name} ${creator.last_name || ''}`.trim()
              : null) ||
            creator?.email ||
            null,
          creator_email: creator?.email || null,
          processor_name:
            processor?.full_name ||
            (processor?.first_name
              ? `${processor.first_name} ${processor.last_name || ''}`.trim()
              : null) ||
            processor?.email ||
            null,
          processor_email: processor?.email || null,
        } as PutbackTicketWithUser
      })

      logger.log(`✅ Fetched ${processedData.length} putback tickets`)
      return processedData
    } catch (error) {
      logger.error('❌ Error in fetchPutbackTickets:', error)
      throw error
    }
  }

  /**
   * Search putback tickets using database query (searches entire dataset)
   * @param query - Search query string
   * @param limit - Maximum number of results to return (default: 1000)
   */
  async searchPutbackTickets(
    query: string,
    limit: number = 1000
  ): Promise<PutbackTicketWithUser[]> {
    try {
      if (!query.trim()) {
        // If no query, return limited initial data
        return await this.fetchPutbackTickets(limit)
      }

      const searchTerm = query.toLowerCase()
      logger.log(`🔍 Searching putback tickets for: "${searchTerm}"`)

      const { data, error } = await supabase
        .from('putback_tickets')
        .select(
          `
          *,
          creator:created_by(id, full_name, first_name, last_name, email),
          processor:processed_by(id, full_name, first_name, last_name, email)
        `
        )
        .or(
          `putback_number.ilike.%${searchTerm}%,delivery_id.ilike.%${searchTerm}%,material_number.ilike.%${searchTerm}%,material_description.ilike.%${searchTerm}%,original_storage_bin.ilike.%${searchTerm}%`
        )
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) {
        logger.error('Search query error:', error)
        throw error
      }

      if (!data || data.length === 0) {
        logger.log('No search results found')
        return []
      }

      // Transform the data
      const processedData = data.map((ticket) => {
        const creator = ticket.creator as any
        const processor = ticket.processor as any

        return {
          ...ticket,
          creator: undefined,
          processor: undefined,
          creator_name:
            creator?.full_name ||
            (creator?.first_name
              ? `${creator.first_name} ${creator.last_name || ''}`.trim()
              : null) ||
            creator?.email ||
            null,
          creator_email: creator?.email || null,
          processor_name:
            processor?.full_name ||
            (processor?.first_name
              ? `${processor.first_name} ${processor.last_name || ''}`.trim()
              : null) ||
            processor?.email ||
            null,
          processor_email: processor?.email || null,
        } as PutbackTicketWithUser
      })

      logger.log(`✅ Found ${processedData.length} matching putback tickets`)
      return processedData
    } catch (error) {
      logger.error('Error searching putback tickets:', error)
      throw error
    }
  }

  /**
   * Get statistics for putback tickets
   */
  async getStatistics(): Promise<{
    totalTickets: number
    todayTickets: number
    openTickets: number
    completedTickets: number
    uniqueMaterials: number
    uniqueCreators: number
  }> {
    try {
      logger.log('📊 Calculating putback ticket statistics...')

      // Try RPC function first (if it exists)
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'get_putback_log_statistics' as any
        )

        if (!rpcError && rpcData) {
          logger.log('✅ Statistics from RPC function:', rpcData)
          return rpcData as {
            totalTickets: number
            todayTickets: number
            openTickets: number
            completedTickets: number
            uniqueMaterials: number
            uniqueCreators: number
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (rpcError) {
        logger.log('⚠️ RPC function not available, using fallback calculation')
      }

      // Fallback: Use COUNT queries to query entire database
      logger.log(
        '📊 Using optimized COUNT queries for putback statistics (client-side fallback)...'
      )

      // Use EST timezone for accurate "today" calculation
      const today = getTodayEST()

      logger.log(`📅 Putback Log Statistics: Using EST date - Today: ${today}`)

      // Get total count (entire database)
      const { count: totalCount } = await supabase
        .from('putback_tickets')
        .select('*', { count: 'exact', head: true })

      // Get today's tickets by fetching all and filtering client-side
      // This is less efficient but works correctly with timezone conversion
      // Note: In production, the RPC function should be used instead
      const { data: allTickets } = await supabase
        .from('putback_tickets')
        .select('created_at')

      // Filter to today's date in EST
      const todayCount =
        allTickets?.filter((record) => {
          if (!record.created_at) return false

          // Convert UTC timestamp to EST date
          const estDate = new Date(record.created_at).toLocaleDateString(
            'en-US',
            {
              timeZone: 'America/New_York',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }
          )

          // Format to match YYYY-MM-DD
          const [month, day, year] = estDate.split('/')
          const recordDateEST = `${year}-${month}-${day}`

          return recordDateEST === today
        }).length || 0

      // Get open tickets count
      const { count: openCount } = await supabase
        .from('putback_tickets')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open')

      // Get completed tickets count
      const { count: completedCount } = await supabase
        .from('putback_tickets')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed')

      // Get unique materials (selective field query)
      const { data: materialData } = await supabase
        .from('putback_tickets')
        .select('material_number')
        .not('material_number', 'is', null)

      // Get unique creators (selective field query)
      const { data: creatorData } = await supabase
        .from('putback_tickets')
        .select('created_by')
        .not('created_by', 'is', null)

      const stats = {
        totalTickets: totalCount || 0,
        todayTickets: todayCount || 0,
        openTickets: openCount || 0,
        completedTickets: completedCount || 0,
        uniqueMaterials: materialData
          ? new Set(materialData.map((t) => t.material_number).filter(Boolean))
              .size
          : 0,
        uniqueCreators: creatorData
          ? new Set(creatorData.map((t) => t.created_by).filter(Boolean)).size
          : 0,
      }

      logger.log('✅ Putback statistics calculated:', {
        totalTickets: stats.totalTickets.toLocaleString(),
        todayTickets: stats.todayTickets,
        openTickets: stats.openTickets,
        completedTickets: stats.completedTickets,
      })
      return stats
    } catch (error) {
      logger.error('❌ Error calculating statistics:', error)
      return {
        totalTickets: 0,
        todayTickets: 0,
        openTickets: 0,
        completedTickets: 0,
        uniqueMaterials: 0,
        uniqueCreators: 0,
      }
    }
  }

  /**
   * Update putback ticket
   */
  async updatePutbackTicket(
    id: string,
    updates: Partial<PutbackTicket>
  ): Promise<{ data: PutbackTicket | null; error: any }> {
    try {
      logger.log('🔄 Updating putback ticket:', id, updates)

      const { data, error } = await supabase
        .from('putback_tickets')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        logger.error('❌ Error updating putback ticket:', error)
        return { data: null, error }
      }

      logger.log('✅ Putback ticket updated successfully')
      return { data, error: null }
    } catch (error) {
      logger.error('❌ Exception updating putback ticket:', error)
      return { data: null, error }
    }
  }

  /**
   * Client-side search for filtering already-loaded putback tickets
   * @deprecated Use searchPutbackTickets(query, limit) for database search instead
   */
  filterPutbackTickets(
    tickets: PutbackTicketWithUser[],
    searchQuery: string
  ): PutbackTicketWithUser[] {
    if (!searchQuery.trim()) {
      return tickets
    }

    const query = searchQuery.toLowerCase().trim()

    return tickets.filter((ticket) => {
      return (
        ticket.putback_number?.toLowerCase().includes(query) ||
        ticket.delivery_id?.toLowerCase().includes(query) ||
        ticket.material_number?.toLowerCase().includes(query) ||
        ticket.material_description?.toLowerCase().includes(query) ||
        ticket.original_storage_bin?.toLowerCase().includes(query) ||
        ticket.status?.toLowerCase().includes(query) ||
        ticket.creator_name?.toLowerCase().includes(query) ||
        ticket.processor_name?.toLowerCase().includes(query)
      )
    })
  }

  /**
   * Export putback tickets to CSV
   */
  exportToCSV(tickets: PutbackTicketWithUser[]): string {
    if (tickets.length === 0) {
      return 'No data to export'
    }

    const headers = [
      'Putback Number',
      'Delivery ID',
      'Material Number',
      'Material Description',
      'Quantity Returned',
      'Original Storage Bin',
      'Status',
      'Created By',
      'Created At',
      'Processed By',
      'Processed At',
    ]

    const rows = tickets.map((ticket) => [
      ticket.putback_number || '',
      ticket.delivery_id || '',
      ticket.material_number || '',
      ticket.material_description || '',
      ticket.quantity_returned?.toString() || '0',
      ticket.original_storage_bin || '',
      ticket.status || '',
      ticket.creator_name || ticket.creator_email || '',
      ticket.created_at || '',
      ticket.processor_name || ticket.processor_email || '',
      ticket.processed_at || '',
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n')

    return csvContent
  }
}

// Export singleton instance
export const putbackLogService = PutbackLogService.getInstance()

// Created and developed by Jai Singh
