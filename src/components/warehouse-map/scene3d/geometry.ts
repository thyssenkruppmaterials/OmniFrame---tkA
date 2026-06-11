// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// geometry.ts — pure axis-aligned bounding boxes from the PERSISTED model.
// ---------------------------------------------------------------------------
// Operates in world units (~cm), NOT on live Object3D, so it is pure, testable,
// and immune to the center-vs-corner coordinate footgun: scene objects are
// center-origin, racks are corner-origin, rotation is in degrees. Everything
// that needs bounds — align/distribute, marquee, collision, frame-selection,
// capacity — shares these helpers.
import type { WarehouseRack, WarehouseSceneObject } from '../types'

export interface AABB {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

function rotatedAABB(
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  rotationDeg: number
): AABB {
  const rad = (rotationDeg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const lx = sx * hx
    const ly = sy * hy
    const x = cx + lx * c - ly * s
    const y = cy + lx * s + ly * c
    if (x < minX) minX = x
    if (y < minZ) minZ = y
    if (x > maxX) maxX = x
    if (y > maxZ) maxZ = y
  }
  return { minX, minZ, maxX, maxZ }
}

/** AABB of a scene object (center-origin footprint). */
export function objectAABB(
  o: Pick<
    WarehouseSceneObject,
    'position_x' | 'position_y' | 'width' | 'depth' | 'rotation'
  >
): AABB {
  return rotatedAABB(
    o.position_x,
    o.position_y,
    o.width / 2,
    o.depth / 2,
    o.rotation ?? 0
  )
}

/** AABB of a rack (corner-origin footprint; 2D "height" is the Z depth). */
export function rackAABB(
  r: Pick<
    WarehouseRack,
    'position_x' | 'position_y' | 'width' | 'height' | 'rotation'
  >
): AABB {
  return rotatedAABB(
    r.position_x + r.width / 2,
    r.position_y + r.height / 2,
    r.width / 2,
    r.height / 2,
    r.rotation ?? 0
  )
}

export function unionAABB(boxes: AABB[]): AABB | null {
  if (boxes.length === 0) return null
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX
    if (b.minZ < minZ) minZ = b.minZ
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxZ > maxZ) maxZ = b.maxZ
  }
  return { minX, minZ, maxX, maxZ }
}

export function aabbCenter(b: AABB): { x: number; z: number } {
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }
}

export function aabbSize(b: AABB): { w: number; d: number } {
  return { w: b.maxX - b.minX, d: b.maxZ - b.minZ }
}

export type AlignEdge =
  | 'left'
  | 'right'
  | 'centerX'
  | 'top'
  | 'bottom'
  | 'centerZ'

/**
 * Compute the new CENTER position (world units) for each object so the set is
 * aligned along one edge/axis. Returns a map id → {position_x, position_y}.
 * Racks (corner-origin) are handled by the caller via their own AABB.
 */
export function computeAlignment(
  items: { id: string; aabb: AABB; center: { x: number; z: number } }[],
  edge: AlignEdge
): Record<string, { x: number; z: number }> {
  if (items.length < 2) return {}
  const group = unionAABB(items.map((i) => i.aabb))!
  const out: Record<string, { x: number; z: number }> = {}
  for (const it of items) {
    let nx = it.center.x
    let nz = it.center.z
    const halfW = (it.aabb.maxX - it.aabb.minX) / 2
    const halfD = (it.aabb.maxZ - it.aabb.minZ) / 2
    switch (edge) {
      case 'left':
        nx = group.minX + halfW
        break
      case 'right':
        nx = group.maxX - halfW
        break
      case 'centerX':
        nx = (group.minX + group.maxX) / 2
        break
      case 'top':
        nz = group.minZ + halfD
        break
      case 'bottom':
        nz = group.maxZ - halfD
        break
      case 'centerZ':
        nz = (group.minZ + group.maxZ) / 2
        break
    }
    out[it.id] = { x: nx, z: nz }
  }
  return out
}

/**
 * Distribute item centers evenly between the two extreme centers along an axis.
 * Returns id → new center.
 */
export function computeDistribution(
  items: { id: string; center: { x: number; z: number } }[],
  axis: 'x' | 'z'
): Record<string, { x: number; z: number }> {
  if (items.length < 3) return {}
  const sorted = [...items].sort((a, b) =>
    axis === 'x' ? a.center.x - b.center.x : a.center.z - b.center.z
  )
  const first = sorted[0].center[axis]
  const last = sorted[sorted.length - 1].center[axis]
  const step = (last - first) / (sorted.length - 1)
  const out: Record<string, { x: number; z: number }> = {}
  sorted.forEach((it, i) => {
    const v = first + step * i
    out[it.id] = {
      x: axis === 'x' ? v : it.center.x,
      z: axis === 'z' ? v : it.center.z,
    }
  })
  return out
}

// Created and developed by Jai Singh
