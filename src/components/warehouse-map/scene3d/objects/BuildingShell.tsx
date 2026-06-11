// Created and developed by Jai Singh
// Building outline → interior concrete floor + soft semi-transparent walls.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Point2D } from '../../types'
import { MATERIAL_PROPS, useGrainTexture } from '../materials3d'
import { BUILDING_WALL_HEIGHT, PALETTE, WORLD_SCALE } from '../scene-config'

export function BuildingShell({
  points,
  wallHeight = BUILDING_WALL_HEIGHT,
}: {
  points: Point2D[]
  wallHeight?: number
}) {
  const grain = useGrainTexture(36, 10)

  const floorShape = useMemo(() => {
    const s = new THREE.Shape()
    points.forEach((p, i) => {
      const x = p.x * WORLD_SCALE
      const z = p.y * WORLD_SCALE
      if (i === 0) s.moveTo(x, z)
      else s.lineTo(x, z)
    })
    s.closePath()
    return s
  }, [points])

  const wallGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    const positions: number[] = []
    const indices: number[] = []
    let vIdx = 0
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i]
      const p2 = points[(i + 1) % points.length]
      const x1 = p1.x * WORLD_SCALE
      const z1 = p1.y * WORLD_SCALE
      const x2 = p2.x * WORLD_SCALE
      const z2 = p2.y * WORLD_SCALE
      positions.push(
        x1,
        0,
        z1,
        x2,
        0,
        z2,
        x2,
        wallHeight,
        z2,
        x1,
        wallHeight,
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
  }, [points, wallHeight])

  // Dispose the imperatively-built geometry on unmount / when it changes. fiber
  // only auto-disposes geometry declared as a JSX child, NOT geometry attached
  // via the geometry={...} prop, so this must be an effect (useMemo never runs
  // its returned function).
  useEffect(() => () => wallGeometry.dispose(), [wallGeometry])

  return (
    <group>
      <mesh
        receiveShadow
        position={[0, 0.004, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          {...MATERIAL_PROPS.floor}
          roughnessMap={grain}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={wallGeometry} castShadow receiveShadow>
        <meshStandardMaterial
          {...MATERIAL_PROPS.wall}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={wallGeometry}>
        <meshBasicMaterial
          color={PALETTE.wallEdge}
          wireframe
          transparent
          opacity={0.55}
        />
      </mesh>
    </group>
  )
}

// Created and developed by Jai Singh
