// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Warehouse Map – Domain Types
// ---------------------------------------------------------------------------

// ---- Canvas / UI primitives ------------------------------------------------

export interface Point2D {
  x: number
  y: number
}

export type Polygon = Point2D[]

export interface CanvasViewport {
  x: number
  y: number
  scale: number
}

export interface ViewportBounds {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
}

export type EditMode =
  | 'view'
  | 'edit-building'
  | 'edit-zones'
  | 'edit-racks'
  | 'edit-aisles'
  /** 3D scene editor: place/move racks + scene objects via the transform gizmo. */
  | 'edit-objects'

export type DataLayer = 'status' | 'stock' | 'utilization' | 'activity'

export type SidebarPanel =
  | 'none'
  | 'location-detail'
  | 'rack-config'
  | 'zone-config'
  | 'diagnostics'
  | 'rack-3d'
  | 'revisions'
  | 'auto-map'
  | 'route'
  | 'furniture-library'
  | 'object-config'

export type FallbackMode = 'placeholder' | 'list' | 'map'

// ---- Settings --------------------------------------------------------------

/** Organisation-level feature flags and defaults for the warehouse map. */
export interface WarehouseMapSettings {
  organization_id: string
  enabled: boolean
  read_only_mode: boolean
  live_updates_enabled: boolean
  allow_layout_edits: boolean
  allow_status_changes: boolean
  show_3d_viewer: boolean
  fallback_mode: FallbackMode
  stale_after_minutes: number
  default_warehouse_code: string | null
  updated_by: string
  updated_at: string
}

// ---- Grid ------------------------------------------------------------------

export interface GridSettings {
  size: number
  snap: boolean
  visible: boolean
}

// ---- Map -------------------------------------------------------------------

/** Top-level warehouse map entity owned by an organisation. */
export interface WarehouseMap {
  id: string
  organization_id: string
  warehouse_code: string
  name: string
  is_default: boolean
  scale_factor: number
  grid_settings: GridSettings
  canvas_settings: Record<string, unknown>
  building_outline: Point2D[] | null
  active_revision_id: string | null
  active_background_asset_id: string | null
  published_at: string | null
  published_by: string | null
  updated_at: string
  created_by: string
}

// ---- Revisions -------------------------------------------------------------

export type RevisionStatus = 'draft' | 'published' | 'archived' | 'rolled_back'

/** Immutable snapshot of a map layout at a point in time. */
export interface WarehouseMapRevision {
  id: string
  map_id: string
  organization_id: string
  version_number: number
  status: RevisionStatus
  change_summary: string | null
  snapshot_json: Record<string, unknown>
  created_by: string
  created_at: string
  published_by: string | null
  published_at: string | null
  rolled_back_from_revision_id: string | null
}

// ---- Background assets -----------------------------------------------------

/** Uploaded floor-plan image associated with a map. */
export interface WarehouseMapBackgroundAsset {
  id: string
  map_id: string
  organization_id: string
  storage_path: string
  content_hash: string
  version_number: number
  mime_type: string
  width: number
  height: number
  file_size_bytes: number
  is_active: boolean
  uploaded_by: string
  uploaded_at: string
  archived_at: string | null
}

// ---- Zones -----------------------------------------------------------------

export type ZoneType =
  | 'receiving'
  | 'shipping'
  | 'storage'
  | 'staging'
  | 'quality'
  | 'maintenance'
  | 'office'
  | 'other'

/** Logical area within a warehouse map defined by a polygon. */
export interface WarehouseZone {
  id: string
  map_id: string
  organization_id: string
  name: string
  zone_type: ZoneType
  polygon: Point2D[]
  color: string
  opacity: number
  floor_level: number
  sort_order: number
  updated_at: string
}

// ---- Racks -----------------------------------------------------------------

export type RackType =
  | 'pallet'
  | 'shelving'
  | 'cantilever'
  | 'flow'
  | 'mezzanine'

/** Physical rack placed on the map canvas. */
export interface WarehouseRack {
  id: string
  map_id: string
  zone_id: string | null
  organization_id: string
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
  updated_at: string
  metadata: Record<string, unknown>
}

// ---- Location mappings -----------------------------------------------------

export type OperationalStatus =
  | 'active'
  | 'maintenance'
  | 'shutdown'
  | 'reserved'
  | 'blocked'

/** Binding between a SAP storage bin and a visual rack cell. */
export interface WarehouseLocationMapping {
  id: string
  organization_id: string
  map_id: string
  rack_id: string
  warehouse_code: string
  storage_bin: string
  rack_row: number
  rack_column: number
  operational_status: OperationalStatus
  status_reason: string | null
  status_changed_at: string | null
  status_changed_by: string | null
  updated_at: string
  metadata: Record<string, unknown>
}

// ---- Status log ------------------------------------------------------------

/** Audit trail entry for operational-status changes. */
export interface LocationStatusLogEntry {
  id: string
  mapping_id: string
  organization_id: string
  old_status: OperationalStatus
  new_status: OperationalStatus
  reason: string | null
  changed_by: string
  changed_at: string
}

// ---- Auto-map --------------------------------------------------------------

export type AutoMapStatus =
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'applied'
  | 'failed'
  | 'cancelled'

export interface BulkAssignment {
  storage_bin: string
  rack_row: number
  rack_column: number
}

export interface AutoMapConflict {
  storage_bin: string
  rack_row: number
  rack_column: number
  existing_bin: string
  reason: string
}

/** Result of an automated bin-to-rack assignment run. */
export interface AutoMapRun {
  id: string
  map_id: string
  organization_id: string
  warehouse_code: string
  status: AutoMapStatus
  requested_area: string | null
  requested_by: string
  proposed_assignments: BulkAssignment[]
  applied_assignments: BulkAssignment[]
  conflicts: AutoMapConflict[]
  warnings: string[]
  started_at: string
  completed_at: string | null
  error_message: string | null
}

// ---- RPC response types ----------------------------------------------------

/** Full layout payload returned by the `get_map_layout` RPC. */
export interface MapLayoutResponse {
  settings: WarehouseMapSettings
  map: WarehouseMap
  active_background: WarehouseMapBackgroundAsset | null
  zones: WarehouseZone[]
  racks: WarehouseRack[]
  current_revision_number: number
}

/** Single row from the windowed location-detail RPC. */
export interface MapWindowRow {
  mapping_id: string
  storage_bin: string
  rack_id: string
  rack_row: number
  rack_column: number
  operational_status: OperationalStatus
  occupancy_state: 'empty' | 'occupied' | 'unknown' | 'orphaned'
  freshness_state: 'fresh' | 'stale' | 'unavailable'
  last_lx03_seen_at: string | null
  material_summary: string | null
  total_stock: number | null
  available_stock: number | null
  mlgt_match_status: 'matched' | 'ambiguous' | 'missing'
  mlgt_height: number | null
  mlgt_width: number | null
  mlgt_length: number | null
  mlgt_max_quantity: number | null
}

/** Aggregate counts for the map statistics panel. */
export interface MapStatistics {
  total_locations: number
  active_count: number
  maintenance_count: number
  shutdown_count: number
  blocked_count: number
  reserved_count: number
  empty_count: number
  occupied_count: number
  stale_count: number
  orphaned_count: number
  total_stock: number
  utilization_pct: number
  unmapped_bins_count: number
  last_lx03_sync_at: string | null
}

export interface UnassignedBin {
  storage_bin: string
  storage_area: string
  material: string | null
  total_stock: number
  occupancy_state: string
}

export interface OrphanedMapping {
  mapping_id: string
  storage_bin: string
  rack_id: string
  rack_label: string
}

export interface StaleBin {
  storage_bin: string
  last_lx03_seen_at: string
  minutes_since_sync: number
}

export interface AmbiguousMlgtMatch {
  storage_bin: string
  match_count: number
  matched_warehouse_numbers: string[]
}

/** Diagnostic issues surfaced by the health-check RPC. */
export interface MapDiagnostics {
  unmapped_bins: UnassignedBin[]
  orphaned_mappings: OrphanedMapping[]
  stale_bins: StaleBin[]
  ambiguous_mlgt_matches: AmbiguousMlgtMatch[]
  duplicate_rack_labels: string[]
  pending_auto_map_warnings: string[]
}

// ---- Color constants & helpers ---------------------------------------------

export const STATUS_COLORS: Record<OperationalStatus, string> = {
  active: '#22c55e',
  maintenance: '#f59e0b',
  shutdown: '#ef4444',
  reserved: '#64748b',
  blocked: '#6b7280',
} as const

export const OCCUPANCY_ICONS: Record<string, string> = {
  empty: '○',
  occupied: '●',
  unknown: '◌',
  orphaned: '⚠',
} as const

export const STATUS_BADGE_TEXT: Record<OperationalStatus, string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  shutdown: 'Shutdown',
  reserved: 'Reserved',
  blocked: 'Blocked',
} as const

// ---- Draft / local editing -------------------------------------------------

/** Payload sent when persisting local layout edits. */
export interface DraftLayoutPayload {
  zones: WarehouseZone[]
  racks: WarehouseRack[]
  location_mappings: WarehouseLocationMapping[]
}

export interface UndoAction {
  type: string
  payload: Record<string, unknown>
  timestamp: number
}

// ---- Aisle Graph (Pathfinding) ---------------------------------------------

export type AisleNodeKind =
  | 'aisle'
  | 'doorway'
  | 'pickup'
  | 'dock'
  | 'stair'
  | 'elevator'
  | 'manual'

export interface AisleNode {
  id: string
  map_id: string
  organization_id: string
  label: string | null
  x: number
  y: number
  floor_level: number
  kind: AisleNodeKind
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface AisleEdge {
  id: string
  map_id: string
  organization_id: string
  from_node_id: string
  to_node_id: string
  cost: number
  one_way: boolean
  is_stair: boolean
  is_elevator: boolean
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface RoutePoint extends Point2D {
  floor: number
  node_id: string
}

export interface RouteResponse {
  found: boolean
  reason?: string
  polyline: RoutePoint[]
  total_cost?: number
  from_node?: string
  to_node?: string
  from_bin?: string
  to_bin?: string
}

export interface PickTourLeg {
  from_bin: string
  to_bin: string
  polyline: RoutePoint[]
  cost: number
}

export interface PickTourResponse {
  found: boolean
  ordered_bins: string[]
  legs: PickTourLeg[]
  combined_polyline: RoutePoint[]
  total_cost: number
  visited: number
  requested: number
}

// ---- Asset Positions (Live Tracking) ---------------------------------------

export type AssetKind =
  | 'forklift'
  | 'operator'
  | 'cart'
  | 'pallet_jack'
  | 'robot'
  | 'sensor'
  | 'other'

export interface WarehouseAsset {
  id: string
  map_id: string
  organization_id: string
  external_id: string | null
  display_name: string
  kind: AssetKind
  color: string | null
  active: boolean
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface AssetPositionLatest {
  asset_id: string
  map_id: string
  organization_id: string
  x: number
  y: number
  floor_level: number
  heading_deg: number | null
  speed_mps: number | null
  source: string | null
  metadata: Record<string, unknown> | null
  observed_at: string
}

// ---- Scene objects (3D furniture / fixtures) -------------------------------
// Configurable, parametric objects placed in the 3D scene editor: desks,
// offices, tables, conveyors, doors, columns, pallets, etc. Persisted in the
// `warehouse_scene_objects` table (migration 335). The visual recipe for each
// kind (geometry + default dimensions + icon) lives in scene3d/object-catalog.ts;
// the DB only stores placement + dimensions so the catalog can evolve freely.

export type SceneObjectKind =
  | 'desk'
  | 'office'
  | 'meeting_room'
  | 'table'
  | 'workstation'
  | 'conveyor'
  | 'dock_door'
  | 'door'
  | 'column'
  | 'pallet'
  | 'pallet_stack'
  | 'forklift'
  | 'barrier'
  | 'safety_rail'
  | 'cabinet'
  | 'plant'
  | 'sign'
  | 'charging_station'
  // Structural building blocks (Minecraft-style build mode)
  | 'wall'
  | 'platform'
  | 'stairs'
  | 'ramp'
  // Extended catalog (recipes in scene3d/objects/recipes-extra.tsx)
  | 'chair'
  | 'sofa'
  | 'locker'
  | 'shelf_unit'
  | 'counter'
  | 'partition'
  | 'whiteboard'
  | 'pallet_jack'
  | 'hand_truck'
  | 'agv_robot'
  | 'scissor_lift'
  | 'ladder'
  | 'floor_scale'
  | 'stretch_wrapper'
  | 'trash_bin'
  | 'fan'
  | 'fire_extinguisher'
  | 'drum'
  | 'crate_stack'
  | 'gaylord'
  | 'tote_stack'
  | 'fence'
  | 'gate'
  | 'bollard'
  | 'guard_shack'
  | 'cone'
  | 'tree'
  // Vehicle fleet — brand-spec parametric trucks (recipes-vehicles.tsx)
  | 'forklift_reach'
  | 'forklift_orderpicker'
  | 'forklift_standup'
  | 'forklift_turret'
  | 'pallet_truck_rider'
  | 'walkie_stacker'
  | 'tugger'
  // Facility & dock extras (recipes-extra.tsx)
  | 'semi_trailer'
  | 'shipping_container'
  | 'dumpster'
  | 'ibc_tote'
  | 'floor_scrubber'
  | 'baler'
  | 'air_compressor'
  | 'battery_rack'
  | 'propane_cage'
  | 'eyewash_station'
  | 'dock_leveler'
  | 'mirror_dome'

/** A placed, configurable object in the 3D warehouse scene. */
export interface WarehouseSceneObject {
  id: string
  map_id: string
  organization_id: string
  kind: SceneObjectKind
  label: string | null
  /** World units (~cm), object footprint CENTER (unlike racks, which use a corner). */
  position_x: number
  position_y: number
  /** Elevation above the floor, world units (default 0). */
  position_z: number
  /** Footprint + vertical extent, world units. */
  width: number
  depth: number
  height: number
  /** Degrees, same convention as racks. */
  rotation: number
  /** Optional color override (else the catalog default for the kind). */
  color: string | null
  floor_level: number
  metadata: Record<string, unknown>
  updated_at: string
}

// ---- Layout templates (facility library) ------------------------------------
// Save a complete layout as a named template and stamp out new facilities
// from it. Snapshot/stats document shapes live in layout-template-core.ts.

export type FacilityKind =
  | 'warehouse'
  | 'distribution_center'
  | 'cold_storage'
  | 'manufacturing'
  | 'cross_dock'
  | 'fulfillment'
  | 'yard'
  | 'other'

export interface WarehouseLayoutTemplate {
  id: string
  organization_id: string
  name: string
  facility_kind: FacilityKind
  description: string | null
  snapshot: Record<string, unknown>
  stats: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
}

// ---- Map revision (publish flow) -------------------------------------------

export interface PublishRevisionResponse {
  revision_id: string
  version_number: number
  published_at: string
}

export interface RollbackRevisionResponse {
  revision_id: string
  version_number: number
  restored_from: string
  restored_version: number
}

export interface MapRevisionListEntry {
  id: string
  version_number: number
  status: RevisionStatus
  change_summary: string | null
  created_by: string | null
  created_at: string
  published_at: string | null
  rolled_back_from_revision_id: string | null
}

// Created and developed by Jai Singh
