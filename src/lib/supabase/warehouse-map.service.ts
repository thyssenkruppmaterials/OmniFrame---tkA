// Created and developed by Jai Singh
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - New warehouse map tables not yet in generated database.types.ts
import type { RealtimeChannel } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import type {
  AisleEdge,
  AisleNode,
  AisleNodeKind,
  AssetKind,
  AssetPositionLatest,
  AutoMapRun,
  BulkAssignment,
  LocationStatusLogEntry,
  MapDiagnostics,
  MapLayoutResponse,
  MapRevisionListEntry,
  MapStatistics,
  MapWindowRow,
  OperationalStatus,
  PickTourResponse,
  PublishRevisionResponse,
  RollbackRevisionResponse,
  RouteResponse,
  UnassignedBin,
  WarehouseAsset,
  WarehouseLocationMapping,
  WarehouseMap,
  WarehouseMapBackgroundAsset,
  WarehouseMapSettings,
  WarehouseRack,
  WarehouseZone,
} from '@/components/warehouse-map/types'
import { supabase } from './client'

export class WarehouseMapService {
  private static instance: WarehouseMapService

  private constructor() {}

  public static getInstance(): WarehouseMapService {
    if (!WarehouseMapService.instance) {
      WarehouseMapService.instance = new WarehouseMapService()
    }
    return WarehouseMapService.instance
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async getSettings(): Promise<WarehouseMapSettings | null> {
    try {
      const { data, error } = await supabase
        .from('warehouse_map_settings')
        .select('*')
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data as unknown as WarehouseMapSettings
    } catch (error) {
      logger.error('Error fetching warehouse map settings:', error)
      return null
    }
  }

  async upsertSettings(
    settings: Partial<WarehouseMapSettings>
  ): Promise<WarehouseMapSettings> {
    const { data, error } = await supabase
      .from('warehouse_map_settings')
      .upsert(settings as any)
      .select('*')
      .single()

    if (error) throw error
    return data as unknown as WarehouseMapSettings
  }

  // ---------------------------------------------------------------------------
  // Map CRUD
  // ---------------------------------------------------------------------------

  private async getOrganizationId(): Promise<string> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.organization_id)
      throw new Error('No organization found for user')
    return profile.organization_id
  }

  async getMapByWarehouse(warehouseCode: string): Promise<WarehouseMap | null> {
    try {
      const { data, error } = await supabase
        .from('warehouse_maps')
        .select('*')
        .eq('warehouse_code', warehouseCode)
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data as unknown as WarehouseMap
    } catch (error) {
      logger.error('Error fetching map by warehouse:', error)
      return null
    }
  }

  async getDefaultMap(): Promise<WarehouseMap | null> {
    try {
      const { data, error } = await supabase
        .from('warehouse_maps')
        .select('*')
        .eq('is_default', true)
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data as unknown as WarehouseMap
    } catch (error) {
      logger.error('Error fetching default map:', error)
      return null
    }
  }

  /** All maps in the org — drives the facility picker and template flows. */
  async listMaps(): Promise<WarehouseMap[]> {
    const { data, error } = await supabase
      .from('warehouse_maps')
      .select('*')
      .order('name', { ascending: true })
    if (error) throw error
    return (data ?? []) as unknown as WarehouseMap[]
  }

  async createMap(data: {
    warehouse_code: string
    name: string
    is_default?: boolean
    building_outline?: unknown
  }): Promise<WarehouseMap> {
    const organizationId = await this.getOrganizationId()

    const { data: created, error } = await supabase
      .from('warehouse_maps')
      .insert({ ...data, organization_id: organizationId } as any)
      .select('*')
      .single()

    if (error) throw error
    return created as unknown as WarehouseMap
  }

  async updateMap(
    id: string,
    data: Partial<WarehouseMap>
  ): Promise<WarehouseMap> {
    const { data: updated, error } = await supabase
      .from('warehouse_maps')
      .update(data as any)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error
    return updated as unknown as WarehouseMap
  }

  async deleteMap(id: string): Promise<void> {
    const { error } = await supabase
      .from('warehouse_maps')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  // ---------------------------------------------------------------------------
  // Layout (RPC)
  // ---------------------------------------------------------------------------

  async getMapLayout(mapId: string): Promise<MapLayoutResponse> {
    const { data, error } = await (supabase.rpc as any)(
      'get_warehouse_map_layout',
      { p_map_id: mapId }
    )

    if (error) throw error
    return data as unknown as MapLayoutResponse
  }

  async getMapStatistics(mapId: string): Promise<MapStatistics> {
    const { data, error } = await (supabase.rpc as any)(
      'get_warehouse_map_statistics',
      { p_map_id: mapId }
    )

    if (error) throw error

    // Normalize the SQL response { counts_by_status, occupied_bins,
    // total_mapped_bins, utilization_pct, unmapped_bins, last_lx03_sync }
    // into the frontend MapStatistics shape.
    const raw = (data ?? {}) as {
      counts_by_status?: Record<string, number>
      occupied_bins?: number
      total_mapped_bins?: number
      utilization_pct?: number
      unmapped_bins?: number
      last_lx03_sync?: string | null
    }
    const counts = raw.counts_by_status ?? {}
    const totalMapped = raw.total_mapped_bins ?? 0
    const occupied = raw.occupied_bins ?? 0
    return {
      total_locations: totalMapped,
      active_count: counts.active ?? 0,
      maintenance_count: counts.maintenance ?? 0,
      shutdown_count: counts.shutdown ?? 0,
      blocked_count: counts.blocked ?? 0,
      reserved_count: counts.reserved ?? 0,
      empty_count: Math.max(totalMapped - occupied, 0),
      occupied_count: occupied,
      stale_count: 0,
      orphaned_count: 0,
      total_stock: 0,
      utilization_pct: raw.utilization_pct ?? 0,
      unmapped_bins_count: raw.unmapped_bins ?? 0,
      last_lx03_sync_at: raw.last_lx03_sync ?? null,
    }
  }

  // ---------------------------------------------------------------------------
  // Zone CRUD
  // ---------------------------------------------------------------------------

  async createZone(
    data: Omit<WarehouseZone, 'id' | 'created_at' | 'updated_at'>
  ): Promise<WarehouseZone> {
    const { data: created, error } = await supabase
      .from('warehouse_zones')
      .insert(data as any)
      .select('*')
      .single()

    if (error) throw error
    return created as unknown as WarehouseZone
  }

  async updateZone(
    id: string,
    data: Partial<WarehouseZone>
  ): Promise<WarehouseZone> {
    const { data: updated, error } = await supabase
      .from('warehouse_zones')
      .update(data as any)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error
    return updated as unknown as WarehouseZone
  }

  async deleteZone(id: string): Promise<void> {
    const { error } = await supabase
      .from('warehouse_zones')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  // ---------------------------------------------------------------------------
  // Rack CRUD
  // ---------------------------------------------------------------------------

  async createRack(
    data: Omit<WarehouseRack, 'id' | 'created_at' | 'updated_at'>
  ): Promise<WarehouseRack> {
    const { data: created, error } = await supabase
      .from('warehouse_racks')
      .insert(data as any)
      .select('*')
      .single()

    if (error) throw error
    return created as unknown as WarehouseRack
  }

  async updateRack(
    id: string,
    data: Partial<WarehouseRack>
  ): Promise<WarehouseRack> {
    const { data: updated, error } = await supabase
      .from('warehouse_racks')
      .update(data as any)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error
    return updated as unknown as WarehouseRack
  }

  async deleteRack(id: string): Promise<void> {
    const { error } = await supabase
      .from('warehouse_racks')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  // ---------------------------------------------------------------------------
  // Location Mappings
  // ---------------------------------------------------------------------------

  async getUnassignedBins(
    mapId: string,
    areaFilter?: string,
    search?: string,
    limit?: number
  ): Promise<UnassignedBin[]> {
    const { data, error } = await (supabase.rpc as any)('get_unassigned_bins', {
      p_map_id: mapId,
      p_area_filter: areaFilter ?? null,
      p_search: search ?? null,
      p_limit: limit ?? 100,
    })

    if (error) throw error
    return (data ?? []) as unknown as UnassignedBin[]
  }

  async bulkAssignLocations(
    rackId: string,
    assignments: BulkAssignment[]
  ): Promise<number> {
    const { data, error } = await (supabase.rpc as any)(
      'bulk_assign_locations',
      {
        p_rack_id: rackId,
        p_assignments: assignments,
      }
    )

    if (error) throw error
    return (data as number) ?? 0
  }

  async removeMapping(id: string): Promise<void> {
    const { error } = await supabase
      .from('warehouse_location_mappings')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  // ---------------------------------------------------------------------------
  // Status Management
  // ---------------------------------------------------------------------------

  async updateLocationStatus(
    mappingId: string,
    newStatus: OperationalStatus,
    reason: string,
    expectedUpdatedAt: string
  ): Promise<WarehouseLocationMapping> {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) throw new Error('Not authenticated')

    const { data, error } = await (supabase.rpc as any)(
      'update_location_operational_status',
      {
        p_mapping_id: mappingId,
        p_new_status: newStatus,
        p_reason: reason,
        p_changed_by: user.id,
        p_expected_updated_at: expectedUpdatedAt,
      }
    )

    if (error) throw error
    return data as unknown as WarehouseLocationMapping
  }

  async bulkUpdateStatus(
    mappingIds: string[],
    newStatus: OperationalStatus,
    reason: string
  ): Promise<void> {
    for (const id of mappingIds) {
      const { data: mapping, error: fetchError } = await supabase
        .from('warehouse_location_mappings')
        .select('updated_at')
        .eq('id', id)
        .single()

      if (fetchError) throw fetchError

      await this.updateLocationStatus(
        id,
        newStatus,
        reason,
        (mapping as any).updated_at
      )
    }
  }

  async getStatusLog(mappingId: string): Promise<LocationStatusLogEntry[]> {
    const { data, error } = await supabase
      .from('warehouse_location_status_log')
      .select('*')
      .eq('mapping_id', mappingId)
      .order('changed_at', { ascending: false })

    if (error) throw error
    return (data ?? []) as unknown as LocationStatusLogEntry[]
  }

  // ---------------------------------------------------------------------------
  // Background Assets
  // ---------------------------------------------------------------------------

  async uploadBackgroundImage(
    mapId: string,
    file: File
  ): Promise<WarehouseMapBackgroundAsset> {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) throw new Error('User not authenticated')

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    if (profileError || !profile) throw new Error('User profile not found')

    const orgId = (profile as any).organization_id as string
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const ext = file.name.split('.').pop() ?? 'png'
    const storagePath = `${orgId}/${mapId}/${hashHex}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('warehouse-map-backgrounds')
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: true,
      })
    if (uploadError) throw uploadError

    const { data: asset, error: insertError } = await supabase
      .from('warehouse_map_background_assets')
      .insert({
        map_id: mapId,
        organization_id: orgId,
        storage_path: storagePath,
        content_hash: hashHex,
        mime_type: file.type,
        file_size_bytes: file.size,
        is_active: true,
        uploaded_by: user.id,
      } as any)
      .select('*')
      .single()
    if (insertError) throw insertError

    return asset as unknown as WarehouseMapBackgroundAsset
  }

  async getBackgroundSignedUrl(storagePath: string): Promise<string> {
    const { data, error } = await supabase.storage
      .from('warehouse-map-backgrounds')
      .createSignedUrl(storagePath, 60 * 60)

    if (error) throw error
    return data.signedUrl
  }

  async removeBackgroundImage(assetId: string): Promise<void> {
    const { error } = await supabase
      .from('warehouse_map_background_assets')
      .update({
        archived_at: new Date().toISOString(),
        is_active: false,
      })
      .eq('id', assetId)

    if (error) throw error
  }

  // ---------------------------------------------------------------------------
  // Realtime
  // ---------------------------------------------------------------------------

  subscribeToMappingChanges(
    mapId: string,
    callback: () => void
  ): RealtimeChannel {
    return supabase
      .channel(`warehouse-mappings:${mapId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'warehouse_location_mappings',
          filter: `map_id=eq.${mapId}`,
        },
        () => callback()
      )
      .subscribe()
  }

  unsubscribe(channel: RealtimeChannel): void {
    supabase.removeChannel(channel)
  }

  // ---------------------------------------------------------------------------
  // Auto-Map
  // ---------------------------------------------------------------------------

  async getAutoMapRuns(mapId: string): Promise<AutoMapRun[]> {
    const { data, error } = await supabase
      .from('warehouse_auto_map_runs')
      .select('*')
      .eq('map_id', mapId)
      .order('started_at', { ascending: false })

    if (error) throw error
    return (data ?? []) as unknown as AutoMapRun[]
  }

  async createAutoMapRun(mapId: string, area: string): Promise<AutoMapRun> {
    const orgId = await this.getOrganizationId()
    const { data: map } = await supabase
      .from('warehouse_maps')
      .select('warehouse_code')
      .eq('id', mapId)
      .single()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('warehouse_auto_map_runs')
      .insert({
        map_id: mapId,
        organization_id: orgId,
        warehouse_code: (map as any)?.warehouse_code,
        requested_area: area,
        requested_by: user?.id,
        status: 'queued',
      } as any)
      .select('*')
      .single()

    if (error) throw error
    return data as unknown as AutoMapRun
  }

  async applyAutoMapRun(runId: string): Promise<{
    run_id: string
    status: string
    inserted: number
    skipped: number
  }> {
    const { data, error } = await (supabase.rpc as any)('apply_auto_map_run', {
      p_run_id: runId,
    })
    if (error) throw error
    return data
  }

  async cancelAutoMapRun(
    runId: string
  ): Promise<{ run_id: string; status: string }> {
    const { data, error } = await (supabase.rpc as any)('cancel_auto_map_run', {
      p_run_id: runId,
    })
    if (error) throw error
    return data
  }

  // ---------------------------------------------------------------------------
  // Settings bootstrap
  // ---------------------------------------------------------------------------

  async ensureSettings(): Promise<WarehouseMapSettings> {
    const { data, error } = await (supabase.rpc as any)(
      'ensure_warehouse_map_settings'
    )
    if (error) throw error
    return data as unknown as WarehouseMapSettings
  }

  // ---------------------------------------------------------------------------
  // Windowed location details (occupancy, freshness, MLGT)
  // ---------------------------------------------------------------------------

  async getWindowedLocationDetails(params: {
    mapId: string
    mappingIds?: string[]
    bounds?: { minX: number; minY: number; maxX: number; maxY: number }
    limit?: number
  }): Promise<MapWindowRow[]> {
    const { data, error } = await (supabase.rpc as any)(
      'get_windowed_location_details',
      {
        p_map_id: params.mapId,
        p_mapping_ids: params.mappingIds ?? null,
        p_min_x: params.bounds?.minX ?? null,
        p_min_y: params.bounds?.minY ?? null,
        p_max_x: params.bounds?.maxX ?? null,
        p_max_y: params.bounds?.maxY ?? null,
        p_limit: params.limit ?? 2000,
      }
    )
    if (error) throw error
    return (data ?? []) as unknown as MapWindowRow[]
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  async getDiagnostics(mapId: string): Promise<MapDiagnostics> {
    const { data, error } = await (supabase.rpc as any)(
      'get_warehouse_map_diagnostics',
      { p_map_id: mapId }
    )
    if (error) throw error
    return (data ?? {}) as unknown as MapDiagnostics
  }

  // ---------------------------------------------------------------------------
  // Revisions / Publish / Rollback
  // ---------------------------------------------------------------------------

  async publishRevision(
    mapId: string,
    summary: string,
    expectedRevision?: number
  ): Promise<PublishRevisionResponse> {
    const { data, error } = await (supabase.rpc as any)(
      'publish_map_revision',
      {
        p_map_id: mapId,
        p_summary: summary,
        p_expected_revision: expectedRevision ?? null,
      }
    )
    if (error) throw error
    return data as unknown as PublishRevisionResponse
  }

  async rollbackRevision(
    mapId: string,
    revisionId: string
  ): Promise<RollbackRevisionResponse> {
    const { data, error } = await (supabase.rpc as any)(
      'rollback_map_revision',
      {
        p_map_id: mapId,
        p_revision_id: revisionId,
      }
    )
    if (error) throw error
    return data as unknown as RollbackRevisionResponse
  }

  async getRevisions(mapId: string): Promise<MapRevisionListEntry[]> {
    const { data, error } = await (supabase.rpc as any)('get_map_revisions', {
      p_map_id: mapId,
    })
    if (error) throw error
    return (data ?? []) as unknown as MapRevisionListEntry[]
  }

  // ---------------------------------------------------------------------------
  // Aisle Graph (Pathfinding)
  // ---------------------------------------------------------------------------

  async getAisleNodes(
    mapId: string,
    floorLevel?: number
  ): Promise<AisleNode[]> {
    let q = supabase
      .from('warehouse_aisle_nodes')
      .select('*')
      .eq('map_id', mapId)
    if (floorLevel != null) q = q.eq('floor_level', floorLevel)
    const { data, error } = await q.order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []) as unknown as AisleNode[]
  }

  async getAisleEdges(mapId: string): Promise<AisleEdge[]> {
    const { data, error } = await supabase
      .from('warehouse_aisle_edges')
      .select('*')
      .eq('map_id', mapId)
    if (error) throw error
    return (data ?? []) as unknown as AisleEdge[]
  }

  async createAisleNode(input: {
    map_id: string
    x: number
    y: number
    floor_level?: number
    kind?: AisleNodeKind
    label?: string | null
    metadata?: Record<string, unknown> | null
  }): Promise<AisleNode> {
    const orgId = await this.getOrganizationId()
    const { data, error } = await supabase
      .from('warehouse_aisle_nodes')
      .insert({
        ...input,
        floor_level: input.floor_level ?? 0,
        kind: input.kind ?? 'aisle',
        organization_id: orgId,
      } as any)
      .select('*')
      .single()
    if (error) throw error
    return data as unknown as AisleNode
  }

  async updateAisleNode(
    id: string,
    patch: Partial<
      Pick<AisleNode, 'x' | 'y' | 'kind' | 'label' | 'floor_level'>
    >
  ): Promise<AisleNode> {
    const { data, error } = await supabase
      .from('warehouse_aisle_nodes')
      .update(patch as any)
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return data as unknown as AisleNode
  }

  async deleteAisleNode(id: string): Promise<void> {
    const { error } = await supabase
      .from('warehouse_aisle_nodes')
      .delete()
      .eq('id', id)
    if (error) throw error
  }

  async createAisleEdge(input: {
    map_id: string
    from_node_id: string
    to_node_id: string
    cost: number
    one_way?: boolean
    is_stair?: boolean
    is_elevator?: boolean
  }): Promise<AisleEdge> {
    const orgId = await this.getOrganizationId()
    const { data, error } = await supabase
      .from('warehouse_aisle_edges')
      .insert({
        ...input,
        one_way: input.one_way ?? false,
        is_stair: input.is_stair ?? false,
        is_elevator: input.is_elevator ?? false,
        organization_id: orgId,
      } as any)
      .select('*')
      .single()
    if (error) throw error
    return data as unknown as AisleEdge
  }

  async deleteAisleEdge(id: string): Promise<void> {
    const { error } = await supabase
      .from('warehouse_aisle_edges')
      .delete()
      .eq('id', id)
    if (error) throw error
  }

  async autoConnectAisleNodes(mapId: string, k = 4): Promise<number> {
    const { data, error } = await (supabase.rpc as any)(
      'auto_connect_aisle_nodes',
      { p_map_id: mapId, p_k: k }
    )
    if (error) throw error
    return (data as number) ?? 0
  }

  async seedAisleNodesFromRacks(mapId: string): Promise<number> {
    const { data, error } = await (supabase.rpc as any)(
      'seed_aisle_nodes_from_racks',
      { p_map_id: mapId }
    )
    if (error) throw error
    return (data as number) ?? 0
  }

  async backfillMappingNearestNode(mapId: string): Promise<number> {
    const { data, error } = await (supabase.rpc as any)(
      'backfill_mapping_nearest_node',
      { p_map_id: mapId }
    )
    if (error) throw error
    return (data as number) ?? 0
  }

  subscribeToAisleGraph(mapId: string, callback: () => void): RealtimeChannel {
    return supabase
      .channel(`warehouse-aisle-graph:${mapId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'warehouse_aisle_nodes',
          filter: `map_id=eq.${mapId}`,
        },
        () => callback()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'warehouse_aisle_edges',
          filter: `map_id=eq.${mapId}`,
        },
        () => callback()
      )
      .subscribe()
  }

  // ---------------------------------------------------------------------------
  // Routing (A*)
  // ---------------------------------------------------------------------------

  async getRoute(
    mapId: string,
    fromBin: string,
    toBin: string
  ): Promise<RouteResponse> {
    const { data, error } = await (supabase.rpc as any)('get_route', {
      p_map_id: mapId,
      p_from_bin: fromBin,
      p_to_bin: toBin,
    })
    if (error) throw error
    return data as unknown as RouteResponse
  }

  async getPickTour(
    mapId: string,
    fromBin: string,
    bins: string[]
  ): Promise<PickTourResponse> {
    const { data, error } = await (supabase.rpc as any)('get_pick_tour', {
      p_map_id: mapId,
      p_from_bin: fromBin,
      p_bins: bins,
    })
    if (error) throw error
    return data as unknown as PickTourResponse
  }

  // ---------------------------------------------------------------------------
  // Asset Positions (Live Tracking)
  // ---------------------------------------------------------------------------

  async listAssets(mapId: string): Promise<WarehouseAsset[]> {
    const { data, error } = await supabase
      .from('warehouse_assets')
      .select('*')
      .eq('map_id', mapId)
      .order('display_name', { ascending: true })
    if (error) throw error
    return (data ?? []) as unknown as WarehouseAsset[]
  }

  async createAsset(input: {
    map_id: string
    display_name: string
    kind: AssetKind
    color?: string | null
    external_id?: string | null
  }): Promise<WarehouseAsset> {
    const orgId = await this.getOrganizationId()
    const { data, error } = await supabase
      .from('warehouse_assets')
      .insert({ ...input, organization_id: orgId } as any)
      .select('*')
      .single()
    if (error) throw error
    return data as unknown as WarehouseAsset
  }

  async deleteAsset(id: string): Promise<void> {
    const { error } = await supabase
      .from('warehouse_assets')
      .delete()
      .eq('id', id)
    if (error) throw error
  }

  async ingestAssetPosition(input: {
    asset_id: string
    x: number
    y: number
    floor_level?: number
    heading_deg?: number | null
    speed_mps?: number | null
    source?: string
    metadata?: Record<string, unknown> | null
  }): Promise<AssetPositionLatest> {
    const { data, error } = await (supabase.rpc as any)(
      'ingest_asset_position',
      {
        p_asset_id: input.asset_id,
        p_x: input.x,
        p_y: input.y,
        p_floor_level: input.floor_level ?? 0,
        p_heading_deg: input.heading_deg ?? null,
        p_speed_mps: input.speed_mps ?? null,
        p_source: input.source ?? 'manual',
        p_metadata: input.metadata ?? null,
      }
    )
    if (error) throw error
    return data as unknown as AssetPositionLatest
  }

  async getLatestPositions(
    mapId: string,
    floorLevel?: number
  ): Promise<AssetPositionLatest[]> {
    let q = supabase
      .from('warehouse_asset_position_latest')
      .select('*')
      .eq('map_id', mapId)
    if (floorLevel != null) q = q.eq('floor_level', floorLevel)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as unknown as AssetPositionLatest[]
  }

  subscribeToAssetPositions(
    mapId: string,
    callback: () => void
  ): RealtimeChannel {
    return supabase
      .channel(`warehouse-asset-positions:${mapId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'warehouse_asset_position_latest',
          filter: `map_id=eq.${mapId}`,
        },
        () => callback()
      )
      .subscribe()
  }
}

export const warehouseMapService = WarehouseMapService.getInstance()

// Created and developed by Jai Singh
