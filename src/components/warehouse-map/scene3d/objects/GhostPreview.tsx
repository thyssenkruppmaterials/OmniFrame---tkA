// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// GhostPreview — translucent stand-in for the object about to be placed.
// ---------------------------------------------------------------------------
// Follows the pointer (snapped to the map grid / attachment face) so the user
// always sees exactly where and how big the next block lands before clicking —
// the Minecraft placement cue. Non-raycastable so it never blocks the picking
// that drives it.
import { useMemo } from 'react'
import * as THREE from 'three'
import type { BuildPlacement, PlacingDims } from '../build-mode'
import { rotationToY } from '../coords'
import { PALETTE, WORLD_SCALE } from '../scene-config'

interface GhostPreviewProps {
  placement: BuildPlacement
  dims: PlacingDims
  rotationDeg: number
  /** Placement would be rejected (outside the locked floor-plan envelope). */
  invalid?: boolean
}

const INVALID_COLOR = '#ef4444'

export function GhostPreview({
  placement,
  dims,
  rotationDeg,
  invalid = false,
}: GhostPreviewProps) {
  const w = dims.width * WORLD_SCALE
  const d = dims.depth * WORLD_SCALE
  const h = Math.max(dims.height, 4) * WORLD_SCALE
  const color = invalid ? INVALID_COLOR : PALETTE.accent

  // Footprint outline on the floor of the ghost (reads better than the box
  // alone when stacking high).
  const outline = useMemo(() => {
    const pts = [
      new THREE.Vector3(-w / 2, 0, -d / 2),
      new THREE.Vector3(w / 2, 0, -d / 2),
      new THREE.Vector3(w / 2, 0, d / 2),
      new THREE.Vector3(-w / 2, 0, d / 2),
      new THREE.Vector3(-w / 2, 0, -d / 2),
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [w, d])

  return (
    <group
      position={[
        placement.position_x * WORLD_SCALE,
        placement.position_z * WORLD_SCALE,
        placement.position_y * WORLD_SCALE,
      ]}
      rotation={[0, rotationToY(rotationDeg), 0]}
      raycast={() => null}
    >
      <mesh position={[0, h / 2, 0]} raycast={() => null}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, h / 2, 0]} raycast={() => null}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.7} />
      </mesh>
      <lineLoop geometry={outline} position={[0, 0.01, 0]} raycast={() => null}>
        <lineBasicMaterial color={color} />
      </lineLoop>
    </group>
  )
}

// Created and developed by Jai Singh
