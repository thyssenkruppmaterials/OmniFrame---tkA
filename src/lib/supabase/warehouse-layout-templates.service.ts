// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Facility layout templates — save a layout as a named template and stamp out
// new facilities from it. Backed by warehouse_layout_templates (migration
// 336; table may be missing in older environments → list() degrades to []).
// Mirrors the focused-module pattern of warehouse-scene-objects.service.
// ---------------------------------------------------------------------------
import { logger } from '@/lib/utils/logger'
import {
  snapshotFromLayout,
  templateStats,
  validateSnapshot,
  type LayoutTemplateSnapshot,
} from '@/components/warehouse-map/layout-template-core'
import type {
  FacilityKind,
  WarehouseLayoutTemplate,
  WarehouseMap,
  WarehouseRack,
  WarehouseZone,
} from '@/components/warehouse-map/types'
import { supabase } from './client'
import { warehouseMapService } from './warehouse-map.service'
import { warehouseSceneObjectsService } from './warehouse-scene-objects.service'

const TABLE = 'warehouse_layout_templates'

async function getOrganizationId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!(profile as any)?.organization_id)
    throw new Error('No organization found for user')
  return (profile as any).organization_id
}

export const warehouseLayoutTemplatesService = {
  /** Browse the org's template library (newest first; [] if table missing). */
  async list(): Promise<WarehouseLayoutTemplate[]> {
    const { data, error } = await (supabase as any)
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      logger.warn(
        '[layout-templates] list failed (table may not exist yet)',
        error
      )
      return []
    }
    return (data ?? []) as WarehouseLayoutTemplate[]
  },

  /**
   * Capture the CURRENT layout of a map as a new template. Pulls everything
   * the snapshot needs server-side so the caller only supplies naming.
   */
  async captureFromMap(
    mapId: string,
    input: { name: string; facility_kind: FacilityKind; description?: string }
  ): Promise<WarehouseLayoutTemplate> {
    const organizationId = await getOrganizationId()
    const [layout, sceneObjects, aisleNodes, aisleEdges] = await Promise.all([
      warehouseMapService.getMapLayout(mapId),
      warehouseSceneObjectsService.list(mapId),
      warehouseMapService.getAisleNodes(mapId),
      warehouseMapService.getAisleEdges(mapId),
    ])
    const snapshot = snapshotFromLayout(
      layout,
      sceneObjects,
      aisleNodes,
      aisleEdges
    )
    const { data, error } = await (supabase as any)
      .from(TABLE)
      .insert({
        organization_id: organizationId,
        name: input.name,
        facility_kind: input.facility_kind,
        description: input.description || null,
        snapshot,
        stats: templateStats(snapshot),
      })
      .select('*')
      .single()
    if (error) throw error
    return data as WarehouseLayoutTemplate
  },

  async remove(id: string): Promise<void> {
    const { error } = await (supabase as any).from(TABLE).delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Stamp out a NEW facility from a template: a fresh warehouse_maps row plus
   * remapped zones, racks, scene objects, and the aisle graph. Location
   * mappings are facility-specific and never copied. Returns the new map.
   */
  async createFacility(
    template: WarehouseLayoutTemplate | null,
    input: { warehouse_code: string; name: string }
  ): Promise<WarehouseMap> {
    const organizationId = await getOrganizationId()
    const snapshot: LayoutTemplateSnapshot | null = template
      ? validateSnapshot(template.snapshot)
      : null
    if (template && !snapshot)
      throw new Error('This template is unreadable — re-save it from a layout.')

    const map = await warehouseMapService.createMap({
      warehouse_code: input.warehouse_code.trim(),
      name: input.name.trim(),
      building_outline: snapshot?.building_outline ?? undefined,
    })

    if (!snapshot) return map

    // Map-level settings (floor-plan envelope, ceiling, grid, scale).
    const mapPatch: Partial<WarehouseMap> = {}
    if (snapshot.canvas_settings)
      mapPatch.canvas_settings = snapshot.canvas_settings
    if (snapshot.grid_settings) mapPatch.grid_settings = snapshot.grid_settings
    if (snapshot.scale_factor != null)
      mapPatch.scale_factor = snapshot.scale_factor
    if (Object.keys(mapPatch).length > 0)
      await warehouseMapService.updateMap(map.id, mapPatch)

    // Zones first (racks reference them).
    const zoneIdByRef = new Map<string, string>()
    for (const z of snapshot.zones) {
      const created = await warehouseMapService.createZone({
        map_id: map.id,
        organization_id: organizationId,
        name: z.name,
        zone_type: z.zone_type,
        polygon: z.polygon,
        color: z.color,
        opacity: z.opacity,
        floor_level: z.floor_level,
        sort_order: z.sort_order,
      } as Omit<WarehouseZone, 'id' | 'created_at' | 'updated_at'>)
      zoneIdByRef.set(z.ref, created.id)
    }

    for (const r of snapshot.racks) {
      await warehouseMapService.createRack({
        map_id: map.id,
        organization_id: organizationId,
        zone_id: r.zone_ref ? (zoneIdByRef.get(r.zone_ref) ?? null) : null,
        label: r.label,
        rack_type: r.rack_type,
        position_x: r.position_x,
        position_y: r.position_y,
        rotation: r.rotation,
        width: r.width,
        height: r.height,
        rows: r.rows,
        columns: r.columns,
        aisle: r.aisle,
        metadata: r.metadata ?? {},
      } as Omit<WarehouseRack, 'id' | 'created_at' | 'updated_at'>)
    }

    await warehouseSceneObjectsService.bulkCreate(
      map.id,
      snapshot.scene_objects.map((o) => ({
        kind: o.kind as any,
        label: o.label ?? undefined,
        position_x: o.position_x,
        position_y: o.position_y,
        position_z: o.position_z,
        width: o.width,
        depth: o.depth,
        height: o.height,
        rotation: o.rotation,
        color: o.color,
        floor_level: o.floor_level,
        metadata: o.metadata ?? {},
      }))
    )

    // Aisle graph: nodes, then edges rewired through the ref map.
    const nodeIdByRef = new Map<string, string>()
    for (const n of snapshot.aisle_nodes) {
      const created = await warehouseMapService.createAisleNode({
        map_id: map.id,
        x: n.x,
        y: n.y,
        floor_level: n.floor_level,
        kind: n.kind,
        label: n.label,
      })
      nodeIdByRef.set(n.ref, created.id)
    }
    for (const e of snapshot.aisle_edges) {
      const from = nodeIdByRef.get(e.from_ref)
      const to = nodeIdByRef.get(e.to_ref)
      if (!from || !to) continue
      await warehouseMapService.createAisleEdge({
        map_id: map.id,
        from_node_id: from,
        to_node_id: to,
        cost: e.cost,
        one_way: e.one_way,
        is_stair: e.is_stair,
        is_elevator: e.is_elevator,
      })
    }

    return map
  },
}

// Created and developed by Jai Singh
