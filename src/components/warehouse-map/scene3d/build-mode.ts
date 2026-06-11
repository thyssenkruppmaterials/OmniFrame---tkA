// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Build mode — pure placement math for the Minecraft-style editor.
// ---------------------------------------------------------------------------
// Everything here works in PERSISTED WORLD UNITS (~cm, the same space as
// warehouse_scene_objects.position_x/y/z) so it is directly testable and the
// render layer only converts at the edges (× WORLD_SCALE). Two placement
// surfaces exist:
//   • the ground plane — free placement snapped to the map grid, and
//   • an existing object — "block building": hitting the TOP face stacks the
//     new object on it; hitting a SIDE face places it adjacent along that
//     face's outward axis (exactly like placing a block in Minecraft).
import type { WarehouseSceneObject } from '../types'

/** Footprint + height of the object kind being placed (world units). */
export interface PlacingDims {
  width: number
  depth: number
  height: number
}

/** A resolved placement: footprint-center coordinates + elevation. */
export interface BuildPlacement {
  position_x: number
  position_y: number
  position_z: number
}

/** Snap a scalar to the map grid (no-op when the grid is off / size 0). */
export function snapToGrid(v: number, grid: number): number {
  if (!grid || grid <= 0) return v
  return Math.round(v / grid) * grid
}

/** Ground placement: snap the pointer hit to the grid, elevation 0. */
export function groundPlacement(
  worldX: number,
  worldY: number,
  grid: number
): BuildPlacement {
  return {
    position_x: snapToGrid(worldX, grid),
    position_y: snapToGrid(worldY, grid),
    position_z: 0,
  }
}

/** Which face of the target box a hit resolved to. */
export type BuildFace = 'top' | '+x' | '-x' | '+z' | '-z'

/**
 * Resolve where a new object lands when the user clicks an EXISTING object
 * while placing. The hit point is classified against the target's box in the
 * target's local frame (so rotated objects behave correctly):
 *   top face   → stack: same (snapped) x/y, elevation = target top.
 *   side faces → adjoin: offset along that local axis by the two half-extents,
 *                same elevation as the target (blocks line up in a row).
 *
 * @param target  the object that was hit
 * @param hitX/hitY  pointer hit in world units (2D plan coordinates)
 * @param hitElev    pointer hit elevation in world units (3D y / WORLD_SCALE)
 * @param dims    dimensions of the object kind being placed
 * @param grid    map grid size in world units (0 = no snapping)
 */
export function attachPlacement(
  target: Pick<
    WarehouseSceneObject,
    | 'position_x'
    | 'position_y'
    | 'position_z'
    | 'width'
    | 'depth'
    | 'height'
    | 'rotation'
  >,
  hitX: number,
  hitY: number,
  hitElev: number,
  dims: PlacingDims,
  grid: number
): { placement: BuildPlacement; face: BuildFace } {
  // Hit point in the target's local (un-rotated) frame. Persisted rotation is
  // degrees clockwise in plan view (rendered as rotationY = -deg); undo it.
  const rad = ((target.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = hitX - target.position_x
  const dy = hitY - target.position_y
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos

  // Normalized penetration per face: 1 ≈ exactly on that face.
  const rx = localX / (target.width / 2)
  const rz = localY / (target.depth / 2)
  const topRatio =
    target.height > 0 ? (hitElev - target.position_z) / target.height : 0

  // The top face wins when the hit is at (or above) ~80% of the target's
  // height — clicking the upper sliver of a side still stacks, which is what
  // builders almost always want.
  if (topRatio >= 0.8) {
    return {
      face: 'top',
      placement: {
        position_x: snapToGrid(hitX, grid),
        position_y: snapToGrid(hitY, grid),
        position_z: target.position_z + target.height,
      },
    }
  }

  // Side face: dominant local axis of the hit. Offset by both half-extents so
  // the new footprint sits flush against the target, then rotate the offset
  // back into world space.
  const face: BuildFace =
    Math.abs(rx) >= Math.abs(rz)
      ? rx >= 0
        ? '+x'
        : '-x'
      : rz >= 0
        ? '+z'
        : '-z'
  const offX =
    face === '+x'
      ? target.width / 2 + dims.width / 2
      : face === '-x'
        ? -(target.width / 2 + dims.width / 2)
        : 0
  const offY =
    face === '+z'
      ? target.depth / 2 + dims.depth / 2
      : face === '-z'
        ? -(target.depth / 2 + dims.depth / 2)
        : 0
  // Inverse of the local transform above (rotate by -rad).
  const worldOffX = offX * cos + offY * sin
  const worldOffY = -offX * sin + offY * cos
  return {
    face,
    placement: {
      position_x: target.position_x + worldOffX,
      position_y: target.position_y + worldOffY,
      position_z: target.position_z,
    },
  }
}

/**
 * Per-axis stride between stamps while drag-painting, in world units: the
 * placed footprint's world-AABB extent per axis, rounded UP to whole grid
 * cells. A new stamp lands once the pointer has moved a full extent along
 * EITHER axis — so painting a thin wall along its length strides by its
 * length, while painting rows of them sideways strides by its thickness.
 */
export function paintStride(
  dims: PlacingDims,
  rotationDeg: number,
  grid: number
): { x: number; y: number } {
  const rad = ((rotationDeg ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const extX = dims.width * cos + dims.depth * sin
  const extY = dims.width * sin + dims.depth * cos
  const roundUp = (v: number) =>
    !grid || grid <= 0
      ? Math.max(1, v)
      : Math.max(grid, Math.ceil(v / grid) * grid)
  return { x: roundUp(extX), y: roundUp(extY) }
}

// Created and developed by Jai Singh
