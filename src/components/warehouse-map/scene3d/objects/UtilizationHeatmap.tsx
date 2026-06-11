// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// UtilizationHeatmap — a floor overlay tinting each rack by slotting density
// (mapped bins / total positions). Reuses the existing mappings; additive (does
// not touch RackInstanced). Cool = sparse, warm = dense.
// ---------------------------------------------------------------------------
import { useMemo } from 'react'
import * as THREE from 'three'
import type { WarehouseLocationMapping, WarehouseRack } from '../../types'
import { rackCenter, rotationToY } from '../coords'
import { WORLD_SCALE } from '../scene-config'

// 3-stop sequential gradient (light blue → amber → red).
const STOPS: [number, THREE.Color][] = [
  [0, new THREE.Color('#bfdbfe')],
  [0.5, new THREE.Color('#fbbf24')],
  [1, new THREE.Color('#ef4444')],
]

function heatColor(t: number): THREE.Color {
  const v = Math.min(1, Math.max(0, t))
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1]
      const [t1, c1] = STOPS[i]
      const f = (v - t0) / (t1 - t0 || 1)
      return c0.clone().lerp(c1, f)
    }
  }
  return STOPS[STOPS.length - 1][1].clone()
}

export function UtilizationHeatmap({
  racks,
  mappings,
}: {
  racks: WarehouseRack[]
  mappings: WarehouseLocationMapping[]
}) {
  const countByRack = useMemo(() => {
    const m = new Map<string, number>()
    for (const mp of mappings) m.set(mp.rack_id, (m.get(mp.rack_id) ?? 0) + 1)
    return m
  }, [mappings])

  return (
    <group>
      {racks.map((rack) => {
        const total = Math.max(1, rack.rows * rack.columns)
        const density = Math.min(1, (countByRack.get(rack.id) ?? 0) / total)
        const [cx, cz] = rackCenter(rack)
        const color = heatColor(density)
        return (
          <mesh
            key={rack.id}
            position={[cx, 0.03, cz]}
            rotation={[-Math.PI / 2, 0, rotationToY(rack.rotation)]}
          >
            <planeGeometry
              args={[
                (rack.width + 20) * WORLD_SCALE,
                (rack.height + 20) * WORLD_SCALE,
              ]}
            />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.55}
              depthWrite={false}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        )
      })}
    </group>
  )
}

// Created and developed by Jai Singh
