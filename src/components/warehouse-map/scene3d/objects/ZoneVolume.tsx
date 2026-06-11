// Created and developed by Jai Singh
// Zone rendering: a soft tinted floor patch for every zone, plus low extruded
// translucent walls for enclosed room types (office) so the layout reads as
// architecture rather than flat colour blocks.
import { useEffect, useMemo } from 'react'
import { Text as DreiText } from '@react-three/drei'
import * as THREE from 'three'
import type { WarehouseZone } from '../../types'
import { polygonCentroid } from '../coords'
import { MATERIAL_PROPS } from '../materials3d'
import { PALETTE, WORLD_SCALE, ZONE_PATCH_Y } from '../scene-config'

const ROOM_TYPES: ReadonlySet<string> = new Set([
  'office',
  'quality',
  'maintenance',
])
const ROOM_WALL_HEIGHT = 2.6

export function ZoneVolume({ zone }: { zone: WarehouseZone }) {
  const shape = useMemo(() => {
    if (!zone.polygon || zone.polygon.length < 3) return null
    const s = new THREE.Shape()
    zone.polygon.forEach((p, i) => {
      const x = p.x * WORLD_SCALE
      const z = p.y * WORLD_SCALE
      if (i === 0) s.moveTo(x, z)
      else s.lineTo(x, z)
    })
    s.closePath()
    return s
  }, [zone.polygon])

  const wallGeometry = useMemo(() => {
    if (
      !ROOM_TYPES.has(zone.zone_type) ||
      !zone.polygon ||
      zone.polygon.length < 3
    )
      return null
    const geom = new THREE.BufferGeometry()
    const positions: number[] = []
    const indices: number[] = []
    let vIdx = 0
    const pts = zone.polygon
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const x1 = a.x * WORLD_SCALE
      const z1 = a.y * WORLD_SCALE
      const x2 = b.x * WORLD_SCALE
      const z2 = b.y * WORLD_SCALE
      positions.push(
        x1,
        0,
        z1,
        x2,
        0,
        z2,
        x2,
        ROOM_WALL_HEIGHT,
        z2,
        x1,
        ROOM_WALL_HEIGHT,
        z1
      )
      indices.push(vIdx, vIdx + 1, vIdx + 2, vIdx, vIdx + 2, vIdx + 3)
      vIdx += 4
    }
    geom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    )
    geom.setIndex(indices)
    geom.computeVertexNormals()
    return geom
  }, [zone.polygon, zone.zone_type])

  // See BuildingShell: geometry attached via prop is not auto-disposed by fiber.
  useEffect(() => () => wallGeometry?.dispose(), [wallGeometry])

  const center = useMemo(
    () => polygonCentroid(zone.polygon ?? []),
    [zone.polygon]
  )

  if (!shape) return null

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, ZONE_PATCH_Y, 0]}
        receiveShadow
      >
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          color={zone.color}
          transparent
          opacity={zone.opacity ?? 0.28}
          roughness={0.9}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {wallGeometry && (
        <mesh geometry={wallGeometry} castShadow receiveShadow>
          <meshStandardMaterial
            {...MATERIAL_PROPS.drywall}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      <DreiText
        position={[center[0], 0.06, center[1]]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.45}
        color={PALETTE.label}
        anchorX='center'
        anchorY='middle'
        outlineWidth={0.02}
        outlineColor={PALETTE.labelOutline}
      >
        {zone.name}
      </DreiText>
    </group>
  )
}

// Created and developed by Jai Singh
