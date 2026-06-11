// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Layout templates — pure snapshot document logic.
// ---------------------------------------------------------------------------
// A template is a versioned JSONB document capturing everything that defines
// a facility layout EXCEPT facility-specific data (bin/location mappings,
// background image, revisions). Old row ids are kept inside the snapshot only
// as remap references (rack.zone_id, edge.from/to) — the apply step inserts
// fresh rows and rewires them.
//
// IMPORTANT: this module is shell-level — it must not import anything from
// scene3d/ (those modules are bundled into the lazy feature-warehouse-3d
// chunk; a static import here would drag that whole chunk into first paint).
import type {
  AisleEdge,
  AisleNode,
  AisleNodeKind,
  GridSettings,
  MapLayoutResponse,
  Point2D,
  RackType,
  WarehouseRack,
  WarehouseSceneObject,
  WarehouseZone,
  ZoneType,
} from './types'

export const TEMPLATE_SNAPSHOT_VERSION = 1

export interface TemplateZone {
  /** Original id — remap reference for racks only, never inserted. */
  ref: string
  name: string
  zone_type: ZoneType
  polygon: Point2D[]
  color: string
  opacity: number
  floor_level: number
  sort_order: number
}

export interface TemplateRack {
  zone_ref: string | null
  label: string
  rack_type: RackType
  position_x: number
  position_y: number
  rotation: number
  width: number
  height: number
  rows: number
  columns: number
  aisle: string | null
  metadata: Record<string, unknown>
}

export interface TemplateSceneObject {
  kind: string
  label: string | null
  position_x: number
  position_y: number
  position_z: number
  width: number
  depth: number
  height: number
  rotation: number
  color: string | null
  floor_level: number
  metadata: Record<string, unknown>
}

export interface TemplateAisleNode {
  ref: string
  label: string | null
  x: number
  y: number
  floor_level: number
  kind: AisleNodeKind
}

export interface TemplateAisleEdge {
  from_ref: string
  to_ref: string
  cost: number
  one_way: boolean
  is_stair: boolean
  is_elevator: boolean
}

export interface LayoutTemplateSnapshot {
  version: number
  building_outline: Point2D[] | null
  grid_settings: GridSettings | null
  canvas_settings: Record<string, unknown> | null
  scale_factor: number | null
  zones: TemplateZone[]
  racks: TemplateRack[]
  scene_objects: TemplateSceneObject[]
  aisle_nodes: TemplateAisleNode[]
  aisle_edges: TemplateAisleEdge[]
}

export interface LayoutTemplateStats {
  zones: number
  racks: number
  /** Rack bin positions (rows × columns summed). */
  locations: number
  scene_objects: number
  aisle_nodes: number
  /** Floor-plan envelope area when set, else layout bounding-box area. */
  area_m2: number
}

/** Capture the template document from a loaded layout. */
export function snapshotFromLayout(
  layout: MapLayoutResponse,
  sceneObjects: WarehouseSceneObject[],
  aisleNodes: AisleNode[] = [],
  aisleEdges: AisleEdge[] = []
): LayoutTemplateSnapshot {
  const zones: TemplateZone[] = (layout.zones ?? []).map(
    (z: WarehouseZone) => ({
      ref: z.id,
      name: z.name,
      zone_type: z.zone_type,
      polygon: z.polygon ?? [],
      color: z.color,
      opacity: z.opacity,
      floor_level: z.floor_level ?? 0,
      sort_order: z.sort_order ?? 0,
    })
  )
  const zoneRefs = new Set(zones.map((z) => z.ref))
  const racks: TemplateRack[] = (layout.racks ?? []).map(
    (r: WarehouseRack) => ({
      zone_ref: r.zone_id && zoneRefs.has(r.zone_id) ? r.zone_id : null,
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
    })
  )
  const nodes: TemplateAisleNode[] = aisleNodes.map((n) => ({
    ref: n.id,
    label: n.label,
    x: n.x,
    y: n.y,
    floor_level: n.floor_level ?? 0,
    kind: n.kind,
  }))
  const nodeRefs = new Set(nodes.map((n) => n.ref))
  const edges: TemplateAisleEdge[] = aisleEdges
    .filter((e) => nodeRefs.has(e.from_node_id) && nodeRefs.has(e.to_node_id))
    .map((e) => ({
      from_ref: e.from_node_id,
      to_ref: e.to_node_id,
      cost: e.cost,
      one_way: e.one_way,
      is_stair: e.is_stair,
      is_elevator: e.is_elevator,
    }))
  return {
    version: TEMPLATE_SNAPSHOT_VERSION,
    building_outline: layout.map.building_outline ?? null,
    grid_settings: layout.map.grid_settings ?? null,
    canvas_settings:
      (layout.map.canvas_settings as Record<string, unknown>) ?? null,
    scale_factor: layout.map.scale_factor ?? null,
    zones,
    racks,
    scene_objects: sceneObjects.map((o) => ({
      kind: o.kind,
      label: o.label,
      position_x: o.position_x,
      position_y: o.position_y,
      position_z: o.position_z,
      width: o.width,
      depth: o.depth,
      height: o.height,
      rotation: o.rotation,
      color: o.color,
      floor_level: o.floor_level ?? 0,
      metadata: o.metadata ?? {},
    })),
    aisle_nodes: nodes,
    aisle_edges: edges,
  }
}

/** Envelope/bbox floor area in m² (world units are ~cm → /10000 per axis pair). */
function snapshotAreaM2(s: LayoutTemplateSnapshot): number {
  const fp = s.canvas_settings?.floor_plan as
    | { width?: number; depth?: number }
    | undefined
  const fw = Number(fp?.width)
  const fd = Number(fp?.depth)
  if (Number.isFinite(fw) && Number.isFinite(fd) && fw > 0 && fd > 0)
    return (fw / 100) * (fd / 100)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const p of s.building_outline ?? []) grow(p.x, p.y)
  for (const z of s.zones) for (const p of z.polygon) grow(p.x, p.y)
  for (const r of s.racks) {
    grow(r.position_x, r.position_y)
    grow(r.position_x + r.width, r.position_y + r.height)
  }
  if (!isFinite(minX)) return 0
  return ((maxX - minX) / 100) * ((maxY - minY) / 100)
}

export function templateStats(s: LayoutTemplateSnapshot): LayoutTemplateStats {
  return {
    zones: s.zones.length,
    racks: s.racks.length,
    locations: s.racks.reduce(
      (sum, r) => sum + Math.max(1, r.rows) * Math.max(1, r.columns),
      0
    ),
    scene_objects: s.scene_objects.length,
    aisle_nodes: s.aisle_nodes.length,
    area_m2: Math.round(snapshotAreaM2(s)),
  }
}

/**
 * Validate a raw template snapshot (templates are long-lived rows; the app
 * must never crash on an old or hand-edited document). Returns null when the
 * document is unusable.
 */
export function validateSnapshot(raw: unknown): LayoutTemplateSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<LayoutTemplateSnapshot>
  if (typeof s.version !== 'number' || s.version < 1) return null
  const arr = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : [])
  return {
    version: s.version,
    building_outline: Array.isArray(s.building_outline)
      ? s.building_outline
      : null,
    grid_settings: s.grid_settings ?? null,
    canvas_settings: s.canvas_settings ?? null,
    scale_factor: typeof s.scale_factor === 'number' ? s.scale_factor : null,
    zones: arr(s.zones),
    racks: arr(s.racks),
    scene_objects: arr(s.scene_objects),
    aisle_nodes: arr(s.aisle_nodes),
    aisle_edges: arr(s.aisle_edges),
  }
}

// Created and developed by Jai Singh
