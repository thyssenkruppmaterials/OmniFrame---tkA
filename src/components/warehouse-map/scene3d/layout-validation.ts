// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Layout validation — pure geometric checks for the designer.
// ---------------------------------------------------------------------------
// Oriented-bounding-box (OBB) overlap via the Separating Axis Theorem so that
// rotated racks/objects are checked correctly (not just axis-aligned). Plus
// out-of-bounds and minimum-aisle-clearance heuristics. All world units (~cm).
import type { MapLayoutResponse, Point2D, WarehouseSceneObject } from '../types'

export interface FootprintBox {
  id: string
  kind: 'rack' | 'object'
  label: string
  /** Center in world units. */
  cx: number
  cy: number
  /** Half-extents in world units. */
  hx: number
  hy: number
  /** Rotation in degrees. */
  rotation: number
}

export interface ValidationIssue {
  id: string
  severity: 'error' | 'warning'
  kind: 'overlap' | 'out-of-bounds' | 'clearance'
  message: string
  /** Item ids involved (for select/zoom-to). */
  refs: string[]
}

/** Footprint boxes for every rack (corner origin) + scene object (center origin). */
export function collectFootprints(
  layout: MapLayoutResponse | null,
  objects: WarehouseSceneObject[]
): FootprintBox[] {
  const boxes: FootprintBox[] = []
  for (const r of layout?.racks ?? []) {
    boxes.push({
      id: r.id,
      kind: 'rack',
      label: r.label,
      cx: r.position_x + r.width / 2,
      cy: r.position_y + r.height / 2,
      hx: r.width / 2,
      hy: r.height / 2,
      rotation: r.rotation ?? 0,
    })
  }
  for (const o of objects) {
    boxes.push({
      id: o.id,
      kind: 'object',
      label: o.label || o.kind,
      cx: o.position_x,
      cy: o.position_y,
      hx: o.width / 2,
      hy: o.depth / 2,
      rotation: o.rotation ?? 0,
    })
  }
  return boxes
}

function corners(b: FootprintBox): Point2D[] {
  const rad = (b.rotation * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const pts: Point2D[] = []
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const lx = sx * b.hx
    const ly = sy * b.hy
    pts.push({ x: b.cx + lx * c - ly * s, y: b.cy + lx * s + ly * c })
  }
  return pts
}

function project(pts: Point2D[], ax: number, ay: number): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of pts) {
    const d = p.x * ax + p.y * ay
    if (d < min) min = d
    if (d > max) max = d
  }
  return [min, max]
}

/** OBB-OBB overlap via SAT, with an optional inward margin (negative inflates). */
export function obbOverlap(
  a: FootprintBox,
  b: FootprintBox,
  margin = 0
): boolean {
  const ca = corners(a)
  const cb = corners(b)
  const axes: [number, number][] = []
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const p1 = poly[i]
      const p2 = poly[(i + 1) % 4]
      const ex = p2.x - p1.x
      const ey = p2.y - p1.y
      const len = Math.hypot(ex, ey) || 1
      axes.push([-ey / len, ex / len]) // normal
    }
  }
  for (const [ax, ay] of axes) {
    const [amin, amax] = project(ca, ax, ay)
    const [bmin, bmax] = project(cb, ax, ay)
    // margin>0 requires a gap of `margin`; <=0 means touching counts as overlap.
    if (amax + margin <= bmin || bmax + margin <= amin) return false
  }
  return true
}

function pointInPolygon(x: number, y: number, poly: Point2D[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export interface ValidationOptions {
  /** Minimum required clearance between footprints (world units). Default 0. */
  minClearance?: number
}

/**
 * Run all layout checks. Returns overlaps (errors), out-of-bounds (warnings),
 * and tight-clearance (warnings) issues.
 */
export function validateLayout(
  layout: MapLayoutResponse | null,
  objects: WarehouseSceneObject[],
  opts: ValidationOptions = {}
): ValidationIssue[] {
  const boxes = collectFootprints(layout, objects)
  const issues: ValidationIssue[] = []
  const outline = layout?.map?.building_outline ?? null
  const minClearance = opts.minClearance ?? 0

  // Pairwise overlap + clearance (O(n²); fine for typical layouts, the spatial
  // index in Phase 6 will accelerate this for 10k+ items).
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (obbOverlap(a, b, 0)) {
        issues.push({
          id: `overlap-${a.id}-${b.id}`,
          severity: 'error',
          kind: 'overlap',
          message: `${a.label} overlaps ${b.label}`,
          refs: [a.id, b.id],
        })
      } else if (minClearance > 0 && obbOverlap(a, b, minClearance)) {
        issues.push({
          id: `clearance-${a.id}-${b.id}`,
          severity: 'warning',
          kind: 'clearance',
          message: `${a.label} and ${b.label} are closer than the ${(
            minClearance / 100
          ).toFixed(1)} m clearance`,
          refs: [a.id, b.id],
        })
      }
    }
  }

  // Out-of-bounds (center outside the building outline).
  if (outline && outline.length >= 3) {
    for (const b of boxes) {
      if (!pointInPolygon(b.cx, b.cy, outline)) {
        issues.push({
          id: `oob-${b.id}`,
          severity: 'warning',
          kind: 'out-of-bounds',
          message: `${b.label} is outside the building outline`,
          refs: [b.id],
        })
      }
    }
  }

  return issues
}

// Created and developed by Jai Singh
