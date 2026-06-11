// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import { Database } from './types'

type InboundScan = Database['public']['Tables']['rr_inbound_scans']['Row']
type InboundScanInsert =
  Database['public']['Tables']['rr_inbound_scans']['Insert']
type InboundScanUpdate =
  Database['public']['Tables']['rr_inbound_scans']['Update']

/**
 * RF Interface Inbound Scanner Service
 * Handles CRUD operations for inbound scan data
 */
export class InboundScanService {
  /**
   * Create a new inbound scan record with enhanced 5-field structure
   */
  static async createScan(data: {
    tracking_number: string
    so_line_rma_afa: string
    material_number: string
    quantity: number
    tka_batch_number: string
    hot_truck: boolean
    scan_location?: string
  }): Promise<{ data: InboundScan | null; error: unknown }> {
    try {
      // Get current user
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

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile || !profile.organization_id) {
        return {
          data: null,
          error:
            profileError || new Error('User profile or organization not found'),
        }
      }

      // Create accurate timestamps - store proper UTC for correct timezone handling
      const now = new Date()
      const utcISOString = now.toISOString()

      logger.log('🕐 RF Inbound Scanner: Corrected Timestamp Capture:', {
        utcISOString,
        localTime: now.toLocaleString('en-US', {
          timeZone: 'America/New_York',
        }),
        note: 'Storing proper UTC, database will display in user timezone',
      })

      // Create the scan record with enhanced 5-field structure
      const scanData: InboundScanInsert = {
        tracking_number: data.tracking_number,
        so_line_rma_afa: data.so_line_rma_afa,
        material_number: data.material_number,
        quantity: data.quantity,
        tka_batch_number: data.tka_batch_number,
        hot_truck: data.hot_truck,
        scanned_by: user.id,
        organization_id: profile.organization_id,
        scan_location: data.scan_location || null,
        scanned_at: utcISOString,
        // Set barcode to material_number for backward compatibility
        barcode: data.material_number,
      }

      const { data: scan, error } = await supabase
        .from('rr_inbound_scans')
        .insert(scanData)
        .select()
        .single()

      return { data: scan, error }
    } catch (error) {
      logger.error('Error creating inbound scan:', error)
      return { data: null, error }
    }
  }

  /**
   * Get inbound scans with pagination and filtering (enhanced with new fields)
   */
  static async getScans(
    options: {
      limit?: number
      offset?: number
      tracking_number?: string
      material_number?: string
      so_line_rma_afa?: string
      tka_batch_number?: string
      hot_truck?: boolean
      scanned_by?: string
      from_date?: string
      to_date?: string
    } = {}
  ): Promise<{ data: InboundScan[] | null; error: unknown; count?: number }> {
    try {
      let query = supabase
        .from('rr_inbound_scans')
        .select(
          `
          *,
          scanned_by_profile:user_profiles!scanned_by(
            id,
            first_name,
            last_name,
            full_name,
            email
          )
        `,
          { count: 'exact' }
        )
        .order('scanned_at', { ascending: false })

      // Apply filters for enhanced fields
      if (options.tracking_number) {
        query = query.ilike('tracking_number', `%${options.tracking_number}%`)
      }

      if (options.material_number) {
        query = query.ilike('material_number', `%${options.material_number}%`)
      }

      if (options.so_line_rma_afa) {
        query = query.ilike('so_line_rma_afa', `%${options.so_line_rma_afa}%`)
      }

      if (options.tka_batch_number) {
        query = query.ilike('tka_batch_number', `%${options.tka_batch_number}%`)
      }

      if (options.hot_truck !== undefined) {
        query = query.eq('hot_truck', options.hot_truck)
      }

      if (options.scanned_by) {
        query = query.eq('scanned_by', options.scanned_by)
      }

      if (options.from_date) {
        query = query.gte('scanned_at', options.from_date)
      }

      if (options.to_date) {
        query = query.lte('scanned_at', options.to_date)
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit)
      }

      if (options.offset) {
        query = query.range(
          options.offset,
          options.offset + (options.limit || 50) - 1
        )
      }

      const { data, error, count } = await query

      return { data, error, count: count || 0 }
    } catch (error) {
      logger.error('Error fetching inbound scans:', error)
      return { data: null, error, count: 0 }
    }
  }

  /**
   * Get recent inbound scans for the current user
   */
  static async getRecentScans(
    limit: number = 10
  ): Promise<{ data: InboundScan[] | null; error: unknown }> {
    try {
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

      const { data, error } = await supabase
        .from('rr_inbound_scans')
        .select('*')
        .eq('scanned_by', user.id)
        .order('scanned_at', { ascending: false })
        .limit(limit)

      return { data, error }
    } catch (error) {
      logger.error('Error fetching recent scans:', error)
      return { data: null, error }
    }
  }

  /**
   * Update an inbound scan (mainly for notes)
   */
  static async updateScan(
    id: string,
    updates: InboundScanUpdate
  ): Promise<{ data: InboundScan | null; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from('rr_inbound_scans')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      return { data, error }
    } catch (error) {
      logger.error('Error updating inbound scan:', error)
      return { data: null, error }
    }
  }

  /**
   * Get scan statistics for the current user (enhanced with new fields)
   */
  static async getScanStats(
    options: {
      from_date?: string
      to_date?: string
    } = {}
  ): Promise<{
    data: {
      total_scans: number
      scans_today: number
      unique_materials: number
      unique_tracking_numbers: number
      hot_truck_count: number
      most_recent_scan: string | null
    } | null
    error: unknown
  }> {
    try {
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

      // Get current date for "today" calculation
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayString = today.toISOString()

      // Build query with filters
      let baseQuery = supabase
        .from('rr_inbound_scans')
        .select('*', { count: 'exact', head: true })
        .eq('scanned_by', user.id)

      if (options.from_date) {
        baseQuery = baseQuery.gte('scanned_at', options.from_date)
      }

      if (options.to_date) {
        baseQuery = baseQuery.lte('scanned_at', options.to_date)
      }

      // Execute queries in parallel for enhanced statistics
      const [
        totalResult,
        todayResult,
        uniqueMaterialResult,
        uniqueTrackingResult,
        hotTruckResult,
        recentResult,
      ] = await Promise.all([
        baseQuery,
        supabase
          .from('rr_inbound_scans')
          .select('*', { count: 'exact', head: true })
          .eq('scanned_by', user.id)
          .gte('scanned_at', todayString),
        supabase
          .from('rr_inbound_scans')
          .select('material_number', { count: 'exact', head: true })
          .eq('scanned_by', user.id)
          .not('material_number', 'is', null),
        supabase
          .from('rr_inbound_scans')
          .select('tracking_number', { count: 'exact', head: true })
          .eq('scanned_by', user.id)
          .not('tracking_number', 'is', null),
        supabase
          .from('rr_inbound_scans')
          .select('*', { count: 'exact', head: true })
          .eq('scanned_by', user.id)
          .eq('hot_truck', true),
        supabase
          .from('rr_inbound_scans')
          .select('scanned_at')
          .eq('scanned_by', user.id)
          .order('scanned_at', { ascending: false })
          .limit(1)
          .single(),
      ])

      if (totalResult.error) throw totalResult.error
      if (todayResult.error) throw todayResult.error
      if (uniqueMaterialResult.error) throw uniqueMaterialResult.error
      if (uniqueTrackingResult.error) throw uniqueTrackingResult.error
      if (hotTruckResult.error) throw hotTruckResult.error

      const stats = {
        total_scans: totalResult.count || 0,
        scans_today: todayResult.count || 0,
        unique_materials: uniqueMaterialResult.count || 0,
        unique_tracking_numbers: uniqueTrackingResult.count || 0,
        hot_truck_count: hotTruckResult.count || 0,
        most_recent_scan: recentResult.data?.scanned_at || null,
      }

      return { data: stats, error: null }
    } catch (error) {
      logger.error('Error fetching scan statistics:', error)
      return { data: null, error }
    }
  }

  /**
   * Delete an inbound scan (admin only)
   */
  static async deleteScan(id: string): Promise<{ error: unknown }> {
    try {
      const { error } = await supabase
        .from('rr_inbound_scans')
        .delete()
        .eq('id', id)

      return { error }
    } catch (error) {
      logger.error('Error deleting inbound scan:', error)
      return { error }
    }
  }

  /**
   * Get material number scan history
   */
  static async getMaterialHistory(
    materialNumber: string,
    limit: number = 20
  ): Promise<{
    data: InboundScan[] | null
    error: unknown
  }> {
    try {
      const { data, error } = await supabase
        .from('rr_inbound_scans')
        .select(
          `
          *,
          scanned_by_profile:user_profiles!scanned_by(
            id,
            first_name,
            last_name,
            full_name,
            email
          )
        `
        )
        .eq('material_number', materialNumber)
        .order('scanned_at', { ascending: false })
        .limit(limit)

      return { data, error }
    } catch (error) {
      logger.error('Error fetching material history:', error)
      return { data: null, error }
    }
  }

  /**
   * Get tracking number scan history
   */
  static async getTrackingHistory(
    trackingNumber: string,
    limit: number = 20
  ): Promise<{
    data: InboundScan[] | null
    error: unknown
  }> {
    try {
      const { data, error } = await supabase
        .from('rr_inbound_scans')
        .select(
          `
          *,
          scanned_by_profile:user_profiles!scanned_by(
            id,
            first_name,
            last_name,
            full_name,
            email
          )
        `
        )
        .eq('tracking_number', trackingNumber)
        .order('scanned_at', { ascending: false })
        .limit(limit)

      return { data, error }
    } catch (error) {
      logger.error('Error fetching tracking history:', error)
      return { data: null, error }
    }
  }
}

export type { InboundScan, InboundScanInsert, InboundScanUpdate }

// Created and developed by Jai Singh
