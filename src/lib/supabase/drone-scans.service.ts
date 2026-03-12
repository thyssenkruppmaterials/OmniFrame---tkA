/**
 * Drone Scans Service
 *
 * Service layer for drone scan operations with Supabase.
 * Follows existing service patterns in the codebase.
 *
 * Note: Uses 'any' casts for drone_scans and drone_missions tables
 * since they're not yet in the generated Supabase types.
 * Run `supabase gen types` after applying migrations to fix this.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// Cast supabase to any for tables not in generated types
const db = supabase as any

// ==================== Types ====================

export interface DroneScan {
  id: string
  captured_at: string
  image_url: string
  thumbnail_url?: string
  image_size_bytes?: number
  image_dimensions?: string
  gps_lat?: number
  gps_lng?: number
  altitude_m?: number
  heading_degrees?: number
  warehouse_zone?: string
  aisle?: string
  shelf_position?: string
  rack_level?: string
  ai_model_used?: string
  ai_analysis_status: string
  ai_analysis_started_at?: string
  ai_analysis_completed_at?: string
  ai_processing_time_ms?: number
  ai_fallback_used?: boolean
  ai_error_message?: string
  ai_retry_count?: number
  detected_texts?: Array<{
    value: string
    type: string
    confidence: number
    bbox?: number[]
  }>
  detected_objects?: Array<{
    label: string
    confidence: number
    bbox?: number[]
    count?: number
  }>
  detected_barcodes?: Array<{
    value: string
    format: string
    bbox?: number[]
  }>
  inventory_assessment?: {
    level: string
    estimated_fill: number
    issues: string[]
    damage_detected: boolean
  }
  spatial_description?: string
  raw_text?: string
  mission_id?: string
  drone_id?: string
  organization_id: string
  scanned_by?: string
  created_at: string
  updated_at: string
}

export interface DroneMission {
  id: string
  mission_name: string
  mission_type: string
  waypoints?: Array<{
    lat: number
    lng: number
    alt?: number
    action?: string
    dwell_time?: number
  }>
  estimated_duration_minutes?: number
  coverage_zones?: string[]
  status: string
  started_at?: string
  completed_at?: string
  total_scans: number
  successful_analyses: number
  failed_analyses: number
  drone_id?: string
  drone_model?: string
  organization_id: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface DroneScanStatistics {
  warehouse_zone: string | null
  total_scans: number
  completed_analyses: number
  failed_analyses: number
  avg_processing_time_ms: number | null
  items_detected: number
  damage_detected_count: number
}

export interface CreateDroneScanInput {
  image_url: string
  thumbnail_url?: string
  gps_lat?: number
  gps_lng?: number
  altitude_m?: number
  heading_degrees?: number
  warehouse_zone?: string
  aisle?: string
  shelf_position?: string
  rack_level?: string
  drone_id?: string
  mission_id?: string
  image_size_bytes?: number
  image_dimensions?: string
}

export interface CreateMissionInput {
  mission_name: string
  mission_type?: string
  waypoints?: Array<{
    lat: number
    lng: number
    alt?: number
    action?: string
    dwell_time?: number
  }>
  estimated_duration_minutes?: number
  coverage_zones?: string[]
  drone_id?: string
  drone_model?: string
}

// ==================== Service Class ====================

export class DroneScanService {
  private static instance: DroneScanService

  private constructor() {}

  public static getInstance(): DroneScanService {
    if (!DroneScanService.instance) {
      DroneScanService.instance = new DroneScanService()
    }
    return DroneScanService.instance
  }

  // ==================== Scans ====================

  /**
   * Fetch drone scans with optional filters
   */
  async fetchScans(options: {
    organizationId: string
    warehouseZone?: string
    aisle?: string
    status?: string
    missionId?: string
    limit?: number
    offset?: number
  }): Promise<{ data: DroneScan[]; error: unknown }> {
    try {
      let query = db
        .from('drone_scans')
        .select('*')
        .eq('organization_id', options.organizationId)
        .order('captured_at', { ascending: false })

      if (options.warehouseZone) {
        query = query.eq('warehouse_zone', options.warehouseZone)
      }
      if (options.aisle) {
        query = query.eq('aisle', options.aisle)
      }
      if (options.status) {
        query = query.eq('ai_analysis_status', options.status)
      }
      if (options.missionId) {
        query = query.eq('mission_id', options.missionId)
      }

      const limit = options.limit || 100
      const offset = options.offset || 0
      query = query.range(offset, offset + limit - 1)

      const { data, error } = await query

      return { data: (data || []) as DroneScan[], error }
    } catch (error) {
      logger.error('Error fetching drone scans:', error)
      return { data: [], error }
    }
  }

  /**
   * Get a single scan by ID
   */
  async getScan(
    scanId: string,
    organizationId: string
  ): Promise<{ data: DroneScan | null; error: unknown }> {
    try {
      const { data, error } = await db
        .from('drone_scans')
        .select('*')
        .eq('id', scanId)
        .eq('organization_id', organizationId)
        .single()

      return { data: data as DroneScan | null, error }
    } catch (error) {
      logger.error('Error fetching drone scan:', error)
      return { data: null, error }
    }
  }

  /**
   * Create a new drone scan
   */
  async createScan(
    input: CreateDroneScanInput,
    organizationId: string,
    userId: string
  ): Promise<{ data: DroneScan | null; error: unknown }> {
    try {
      const { data, error } = await db
        .from('drone_scans')
        .insert({
          ...input,
          organization_id: organizationId,
          scanned_by: userId,
          captured_at: new Date().toISOString(),
          ai_analysis_status: 'pending',
        })
        .select()
        .single()

      return { data: data as DroneScan | null, error }
    } catch (error) {
      logger.error('Error creating drone scan:', error)
      return { data: null, error }
    }
  }

  /**
   * Search scans using full-text search
   */
  async searchScans(options: {
    query: string
    organizationId: string
    warehouseZone?: string
    aisle?: string
    limit?: number
    offset?: number
  }): Promise<{ data: DroneScan[]; error: unknown }> {
    try {
      const { data, error } = await db.rpc('search_drone_scans', {
        p_query: options.query,
        p_organization_id: options.organizationId,
        p_warehouse_zone: options.warehouseZone || null,
        p_aisle: options.aisle || null,
        p_limit: options.limit || 50,
        p_offset: options.offset || 0,
      })

      return { data: (data || []) as DroneScan[], error }
    } catch (error) {
      logger.error('Error searching drone scans:', error)
      return { data: [], error }
    }
  }

  /**
   * Get scan statistics by zone
   */
  async getStatistics(
    organizationId: string,
    days: number = 7
  ): Promise<{ data: DroneScanStatistics[]; error: unknown }> {
    try {
      const { data, error } = await db.rpc('get_drone_scan_statistics', {
        p_organization_id: organizationId,
        p_days: days,
      })

      return { data: (data || []) as DroneScanStatistics[], error }
    } catch (error) {
      logger.error('Error getting scan statistics:', error)
      return { data: [], error }
    }
  }

  // ==================== Missions ====================

  /**
   * Fetch drone missions
   */
  async fetchMissions(options: {
    organizationId: string
    status?: string
    limit?: number
    offset?: number
  }): Promise<{ data: DroneMission[]; error: unknown }> {
    try {
      let query = db
        .from('drone_missions')
        .select('*')
        .eq('organization_id', options.organizationId)
        .order('created_at', { ascending: false })

      if (options.status) {
        query = query.eq('status', options.status)
      }

      const limit = options.limit || 50
      const offset = options.offset || 0
      query = query.range(offset, offset + limit - 1)

      const { data, error } = await query

      return { data: (data || []) as DroneMission[], error }
    } catch (error) {
      logger.error('Error fetching drone missions:', error)
      return { data: [], error }
    }
  }

  /**
   * Get a single mission by ID
   */
  async getMission(
    missionId: string,
    organizationId: string
  ): Promise<{ data: DroneMission | null; error: unknown }> {
    try {
      const { data, error } = await db
        .from('drone_missions')
        .select('*')
        .eq('id', missionId)
        .eq('organization_id', organizationId)
        .single()

      return { data: data as DroneMission | null, error }
    } catch (error) {
      logger.error('Error fetching drone mission:', error)
      return { data: null, error }
    }
  }

  /**
   * Create a new drone mission
   */
  async createMission(
    input: CreateMissionInput,
    organizationId: string,
    userId: string
  ): Promise<{ data: DroneMission | null; error: unknown }> {
    try {
      const { data, error } = await db
        .from('drone_missions')
        .insert({
          ...input,
          organization_id: organizationId,
          created_by: userId,
          status: 'planned',
        })
        .select()
        .single()

      return { data: data as DroneMission | null, error }
    } catch (error) {
      logger.error('Error creating drone mission:', error)
      return { data: null, error }
    }
  }

  /**
   * Update mission status
   */
  async updateMissionStatus(
    missionId: string,
    organizationId: string,
    status: string
  ): Promise<{ data: DroneMission | null; error: unknown }> {
    try {
      const updateData: Record<string, unknown> = { status }

      if (status === 'in_progress') {
        updateData.started_at = new Date().toISOString()
      } else if (['completed', 'aborted', 'failed'].includes(status)) {
        updateData.completed_at = new Date().toISOString()
      }

      const { data, error } = await db
        .from('drone_missions')
        .update(updateData)
        .eq('id', missionId)
        .eq('organization_id', organizationId)
        .select()
        .single()

      return { data: data as DroneMission | null, error }
    } catch (error) {
      logger.error('Error updating mission status:', error)
      return { data: null, error }
    }
  }

  /**
   * Get all scans for a mission
   */
  async getMissionScans(
    missionId: string,
    organizationId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{ data: DroneScan[]; error: unknown }> {
    try {
      const { data, error } = await db
        .from('drone_scans')
        .select('*')
        .eq('mission_id', missionId)
        .eq('organization_id', organizationId)
        .order('captured_at', { ascending: false })
        .range(offset, offset + limit - 1)

      return { data: (data || []) as DroneScan[], error }
    } catch (error) {
      logger.error('Error fetching mission scans:', error)
      return { data: [], error }
    }
  }

  // ==================== Utility ====================

  /**
   * Get unique zones from existing scans
   */
  async getUniqueZones(
    organizationId: string
  ): Promise<{ data: string[]; error: unknown }> {
    try {
      const { data, error } = await db
        .from('drone_scans')
        .select('warehouse_zone')
        .eq('organization_id', organizationId)
        .not('warehouse_zone', 'is', null)

      if (error) return { data: [], error }

      const uniqueZones = [
        ...new Set(
          (data || [])
            .map((d: { warehouse_zone: string }) => d.warehouse_zone)
            .filter(Boolean) as string[]
        ),
      ]
      return { data: uniqueZones.sort(), error: null }
    } catch (error) {
      logger.error('Error getting unique zones:', error)
      return { data: [], error }
    }
  }
}

// Export singleton instance
export const droneScanService = DroneScanService.getInstance()
// Developer and Creator: Jai Singh
