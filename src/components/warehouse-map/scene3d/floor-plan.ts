// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Floor plan — the facility's maximum buildable envelope.
// ---------------------------------------------------------------------------
// A rectangular boundary (origin + width/depth in persisted world units, ~cm)
// stored in `warehouse_maps.canvas_settings.floor_plan` — no migration needed,
// the column is already free-form JSONB. Everything here is pure math in world
// units so the same module serves the 3D boundary renderer, the build-mode
// placement guard, and the Floor Plan dialog.
//
// Display units (m / ft) are a presentation preference only: the persisted
// numbers are ALWAYS world units, exactly like racks and scene objects.
import type { Point2D } from '../types'

/** World units (~cm) per meter — inverse of scene-config's WORLD_SCALE. */
export const WORLD_PER_METER = 100
export const FEET_PER_METER = 3.28084

export type FloorPlanUnits = 'm' | 'ft'

/** Persisted under canvas_settings.floor_plan. All lengths in world units. */
export interface FloorPlanConfig {
  enabled: boolean
  /** Top-left corner of the envelope (world units). */
  origin_x: number
  origin_y: number
  /** Envelope extents (world units, > 0). */
  width: number
  depth: number
  /** Preferred display units for dialogs/labels. */
  units: FloorPlanUnits
  /** When true, build-mode placements outside the envelope are blocked. */
  lock_placements: boolean
}

export const DEFAULT_FLOOR_PLAN: FloorPlanConfig = {
  enabled: true,
  origin_x: 0,
  origin_y: 0,
  width: 100 * WORLD_PER_METER, // 100 m
  depth: 80 * WORLD_PER_METER, // 80 m
  units: 'm',
  lock_placements: true,
}

// ---- Unit conversion --------------------------------------------------------

export function metersToWorld(m: number): number {
  return m * WORLD_PER_METER
}

export function worldToMeters(w: number): number {
  return w / WORLD_PER_METER
}

export function displayToWorld(v: number, units: FloorPlanUnits): number {
  return metersToWorld(units === 'ft' ? v / FEET_PER_METER : v)
}

export function worldToDisplay(w: number, units: FloorPlanUnits): number {
  const m = worldToMeters(w)
  return units === 'ft' ? m * FEET_PER_METER : m
}

// ---- Persistence helpers ----------------------------------------------------

/**
 * Read and validate the floor plan out of a map's canvas_settings. Returns
 * null when absent or malformed — callers treat that as "no envelope".
 */
export function readFloorPlan(
  canvasSettings: Record<string, unknown> | null | undefined
): FloorPlanConfig | null {
  const raw = canvasSettings?.floor_plan as
    | Partial<FloorPlanConfig>
    | null
    | undefined
  if (!raw || typeof raw !== 'object') return null
  const width = Number(raw.width)
  const depth = Number(raw.depth)
  if (!Number.isFinite(width) || !Number.isFinite(depth)) return null
  if (width <= 0 || depth <= 0) return null
  return {
    enabled: raw.enabled !== false,
    origin_x: Number.isFinite(Number(raw.origin_x)) ? Number(raw.origin_x) : 0,
    origin_y: Number.isFinite(Number(raw.origin_y)) ? Number(raw.origin_y) : 0,
    width,
    depth,
    units: raw.units === 'ft' ? 'ft' : 'm',
    lock_placements: raw.lock_placements !== false,
  }
}

/** Rectangle outline of the envelope (clockwise, 4 points, world units). */
export function floorPlanOutline(fp: FloorPlanConfig): Point2D[] {
  return [
    { x: fp.origin_x, y: fp.origin_y },
    { x: fp.origin_x + fp.width, y: fp.origin_y },
    { x: fp.origin_x + fp.width, y: fp.origin_y + fp.depth },
    { x: fp.origin_x, y: fp.origin_y + fp.depth },
  ]
}

/** Envelope floor area in square meters. */
export function floorPlanAreaM2(fp: FloorPlanConfig): number {
  return worldToMeters(fp.width) * worldToMeters(fp.depth)
}

// ---- Containment / clamping -------------------------------------------------

/**
 * World-axis-aligned extents of a rotated rectangular footprint centered at
 * the origin (same math as build-mode's paintStride).
 */
export function rotatedFootprintExtents(
  width: number,
  depth: number,
  rotationDeg: number
): { x: number; y: number } {
  const rad = ((rotationDeg ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return {
    x: width * cos + depth * sin,
    y: width * sin + depth * cos,
  }
}

/**
 * Whether a footprint (center + dims + rotation) lies fully inside the
 * envelope. Dimensions default to a point check.
 */
export function floorPlanContains(
  fp: FloorPlanConfig,
  centerX: number,
  centerY: number,
  width = 0,
  depth = 0,
  rotationDeg = 0
): boolean {
  const ext = rotatedFootprintExtents(width, depth, rotationDeg)
  return (
    centerX - ext.x / 2 >= fp.origin_x &&
    centerX + ext.x / 2 <= fp.origin_x + fp.width &&
    centerY - ext.y / 2 >= fp.origin_y &&
    centerY + ext.y / 2 <= fp.origin_y + fp.depth
  )
}

/** Clamp a footprint center so the (rotated) footprint stays inside. */
export function clampToFloorPlan(
  fp: FloorPlanConfig,
  centerX: number,
  centerY: number,
  width = 0,
  depth = 0,
  rotationDeg = 0
): Point2D {
  const ext = rotatedFootprintExtents(width, depth, rotationDeg)
  const minX = fp.origin_x + ext.x / 2
  const maxX = fp.origin_x + fp.width - ext.x / 2
  const minY = fp.origin_y + ext.y / 2
  const maxY = fp.origin_y + fp.depth - ext.y / 2
  return {
    // A footprint larger than the envelope clamps to the envelope center.
    x:
      minX > maxX
        ? fp.origin_x + fp.width / 2
        : Math.min(Math.max(centerX, minX), maxX),
    y:
      minY > maxY
        ? fp.origin_y + fp.depth / 2
        : Math.min(Math.max(centerY, minY), maxY),
  }
}

// ---- Direct manipulation (drag-move / corner-resize in the 3D editor) -------

/** Translate the envelope, snapping the resulting origin to the map grid. */
export function moveFloorPlan(
  fp: FloorPlanConfig,
  dx: number,
  dy: number,
  grid = 0
): FloorPlanConfig {
  const snap = (v: number) =>
    grid > 0 ? Math.round(v / grid) * grid : Math.round(v)
  return {
    ...fp,
    origin_x: snap(fp.origin_x + dx),
    origin_y: snap(fp.origin_y + dy),
  }
}

export type FloorPlanCorner = 'nw' | 'ne' | 'se' | 'sw'

export const FLOOR_PLAN_MIN_SIZE = 5 * WORLD_PER_METER // 5 m

/**
 * Resize by dragging one corner to a new position; the opposite corner stays
 * anchored. Snaps the dragged corner to the grid and enforces a minimum size
 * so the envelope can't invert or collapse.
 */
export function resizeFloorPlan(
  fp: FloorPlanConfig,
  corner: FloorPlanCorner,
  x: number,
  y: number,
  grid = 0
): FloorPlanConfig {
  const snap = (v: number) =>
    grid > 0 ? Math.round(v / grid) * grid : Math.round(v)
  const sx = snap(x)
  const sy = snap(y)
  const east = corner === 'ne' || corner === 'se'
  const south = corner === 'se' || corner === 'sw'
  const anchorX = east ? fp.origin_x : fp.origin_x + fp.width
  const anchorY = south ? fp.origin_y : fp.origin_y + fp.depth
  const width = Math.max(Math.abs(sx - anchorX), FLOOR_PLAN_MIN_SIZE)
  const depth = Math.max(Math.abs(sy - anchorY), FLOOR_PLAN_MIN_SIZE)
  return {
    ...fp,
    origin_x: east ? anchorX : anchorX - width,
    origin_y: south ? anchorY : anchorY - depth,
    width,
    depth,
  }
}

/** The world position of a named corner. */
export function floorPlanCorner(
  fp: FloorPlanConfig,
  corner: FloorPlanCorner
): Point2D {
  return {
    x: fp.origin_x + (corner === 'ne' || corner === 'se' ? fp.width : 0),
    y: fp.origin_y + (corner === 'se' || corner === 'sw' ? fp.depth : 0),
  }
}

/**
 * Whether build-mode should reject a placement: only when an enabled envelope
 * has lock_placements set AND the footprint escapes it.
 */
export function isPlacementBlocked(
  fp: FloorPlanConfig | null,
  centerX: number,
  centerY: number,
  width = 0,
  depth = 0,
  rotationDeg = 0
): boolean {
  if (!fp || !fp.enabled || !fp.lock_placements) return false
  return !floorPlanContains(fp, centerX, centerY, width, depth, rotationDeg)
}

// Created and developed by Jai Singh
