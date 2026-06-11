// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Warehouse 3D Scene — coordinate helpers
// ---------------------------------------------------------------------------
// Pure, testable functions that translate the 2D persisted warehouse model into
// the Three.js world. Extracted from the legacy warehouse-3d-view.tsx so the
// exact transform is shared by every scene component and never drifts.
import type { MapLayoutResponse, Point2D, WarehouseRack } from '../types'
import { readFloorPlan } from './floor-plan'
import { WORLD_SCALE } from './scene-config'

/** Convert a 2D world point to scene meters on the floor plane (x, z). */
export function toScene(p: Point2D): [number, number] {
  return [p.x * WORLD_SCALE, p.y * WORLD_SCALE]
}

/** Convert a single 2D scalar (already in world units) to meters. */
export function toMeters(v: number): number {
  return v * WORLD_SCALE
}

/** rack.rotation (degrees) → Three.js rotation about Y (radians). */
export function rotationToY(rotationDeg: number | null | undefined): number {
  return -((rotationDeg ?? 0) * Math.PI) / 180
}

export interface SceneBounds {
  /** Center in scene meters. */
  cx: number
  cz: number
  /** Extent in scene meters. */
  width: number
  depth: number
  /** Raw 2D bounds (world units). */
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  /** Largest horizontal extent in meters — handy for camera framing. */
  span: number
}

const DEFAULT_BOUNDS_2D = { minX: 0, minZ: 0, maxX: 1000, maxZ: 800 }

/**
 * Compute the world bounds of a layout (building outline + zones + racks) in
 * scene meters, with a sensible fallback when the layout is empty. This drives
 * camera framing, ground sizing, and the isometric zoom default.
 */
export function computeBounds(layout: MapLayoutResponse | null): SceneBounds {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity

  const grow = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minZ) minZ = y
    if (x > maxX) maxX = x
    if (y > maxZ) maxZ = y
  }

  // The floor-plan envelope (when set) IS the facility extent — camera
  // framing, ground sizing, and fog must cover all of it even while empty.
  const floorPlan = readFloorPlan(layout?.map?.canvas_settings)
  if (floorPlan?.enabled) {
    grow(floorPlan.origin_x, floorPlan.origin_y)
    grow(
      floorPlan.origin_x + floorPlan.width,
      floorPlan.origin_y + floorPlan.depth
    )
  }

  for (const p of layout?.map?.building_outline ?? []) grow(p.x, p.y)
  for (const z of layout?.zones ?? [])
    for (const p of z.polygon ?? []) grow(p.x, p.y)
  for (const r of layout?.racks ?? []) {
    grow(r.position_x, r.position_y)
    grow(r.position_x + r.width, r.position_y + r.height)
  }

  if (!isFinite(minX)) {
    minX = DEFAULT_BOUNDS_2D.minX
    minZ = DEFAULT_BOUNDS_2D.minZ
    maxX = DEFAULT_BOUNDS_2D.maxX
    maxZ = DEFAULT_BOUNDS_2D.maxZ
  }

  const cx = ((minX + maxX) / 2) * WORLD_SCALE
  const cz = ((minZ + maxZ) / 2) * WORLD_SCALE
  const width = (maxX - minX) * WORLD_SCALE
  const depth = (maxZ - minZ) * WORLD_SCALE
  return {
    cx,
    cz,
    width,
    depth,
    minX,
    minZ,
    maxX,
    maxZ,
    span: Math.max(width, depth),
  }
}

/** World-space center of a rack group (origin used by Rack components). */
export function rackCenter(rack: WarehouseRack): [number, number] {
  return [
    (rack.position_x + rack.width / 2) * WORLD_SCALE,
    (rack.position_y + rack.height / 2) * WORLD_SCALE,
  ]
}

/** Centroid of a polygon in scene meters. */
export function polygonCentroid(polygon: Point2D[]): [number, number] {
  if (!polygon || polygon.length === 0) return [0, 0]
  let sx = 0
  let sy = 0
  for (const p of polygon) {
    sx += p.x
    sy += p.y
  }
  return [
    (sx / polygon.length) * WORLD_SCALE,
    (sy / polygon.length) * WORLD_SCALE,
  ]
}

/** Discover the distinct floor levels present in a layout, sorted ascending. */
export function discoverFloors(layout: MapLayoutResponse | null): number[] {
  const set = new Set<number>()
  for (const z of layout?.zones ?? []) set.add(z.floor_level ?? 0)
  // Racks carry no floor_level today (single-floor model) → default 0.
  if (set.size === 0) set.add(0)
  return Array.from(set).sort((a, b) => a - b)
}

// Created and developed by Jai Singh
