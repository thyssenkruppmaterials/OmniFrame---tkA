// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Layout analytics — pure capacity / utilization / footprint stats.
// ---------------------------------------------------------------------------
// All inputs are the persisted 2D model (world units ~cm); areas are returned in
// square METERS. Pure + memo-friendly so the analytics panel and validation can
// share results without re-deriving.
import type {
  MapLayoutResponse,
  Point2D,
  WarehouseLocationMapping,
  WarehouseSceneObject,
} from '../types'
import { WORLD_SCALE } from './scene-config'

/** Shoelace polygon area in m² (input points in world units). */
export function polygonAreaM2(polygon: Point2D[] | null | undefined): number {
  if (!polygon || polygon.length < 3) return 0
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area / 2) * WORLD_SCALE * WORLD_SCALE
}

export interface LayoutAnalytics {
  rackCount: number
  /** Sum of rows × columns across all racks. */
  rackPositions: number
  zoneCount: number
  objectCount: number
  objectsByCategory: Record<string, number>
  /** Total mapped bins, and how many are occupied / by status. */
  mappedBins: number
  occupiedBins: number
  occupancyPct: number
  statusCounts: Record<string, number>
  /** Areas in m². */
  buildingAreaM2: number
  rackFootprintM2: number
  objectFootprintM2: number
  /** % of building floor covered by racks + objects. */
  floorUtilizationPct: number
}

export function computeAnalytics(
  layout: MapLayoutResponse | null,
  mappings: WarehouseLocationMapping[],
  objects: WarehouseSceneObject[],
  objectCategoryOf: (kind: string) => string
): LayoutAnalytics {
  const racks = layout?.racks ?? []
  const zones = layout?.zones ?? []

  let rackPositions = 0
  let rackFootprintM2 = 0
  for (const r of racks) {
    rackPositions += Math.max(0, r.rows) * Math.max(0, r.columns)
    rackFootprintM2 += r.width * WORLD_SCALE * (r.height * WORLD_SCALE)
  }

  const objectsByCategory: Record<string, number> = {}
  let objectFootprintM2 = 0
  for (const o of objects) {
    const cat = objectCategoryOf(o.kind)
    objectsByCategory[cat] = (objectsByCategory[cat] ?? 0) + 1
    objectFootprintM2 += o.width * WORLD_SCALE * (o.depth * WORLD_SCALE)
  }

  const statusCounts: Record<string, number> = {}
  let occupiedBins = 0
  for (const m of mappings) {
    statusCounts[m.operational_status] =
      (statusCounts[m.operational_status] ?? 0) + 1
    // "occupied" proxy: any active mapped bin counts toward utilization.
    if (m.operational_status === 'active') occupiedBins++
  }

  const buildingAreaM2 = polygonAreaM2(layout?.map?.building_outline)
  const coveredM2 = rackFootprintM2 + objectFootprintM2
  const floorUtilizationPct =
    buildingAreaM2 > 0 ? Math.min(100, (coveredM2 / buildingAreaM2) * 100) : 0

  return {
    rackCount: racks.length,
    rackPositions,
    zoneCount: zones.length,
    objectCount: objects.length,
    objectsByCategory,
    mappedBins: mappings.length,
    occupiedBins,
    occupancyPct:
      mappings.length > 0 ? (occupiedBins / mappings.length) * 100 : 0,
    statusCounts,
    buildingAreaM2,
    rackFootprintM2,
    objectFootprintM2,
    floorUtilizationPct,
  }
}

// Created and developed by Jai Singh
