// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// FloorPlanBoundary — the facility's maximum buildable envelope, drawn as a
// dashed survey line with corner stakes and live dimension labels. Purely
// visual; the placement guard lives in WarehouseScene via floor-plan.ts.
// ---------------------------------------------------------------------------
import { useMemo } from 'react'
import { Line, Text } from '@react-three/drei'
import { worldToDisplay, type FloorPlanConfig } from '../floor-plan'
import { PALETTE, WORLD_SCALE } from '../scene-config'

const BOUNDARY_COLOR = '#5b86b8'
const BOUNDARY_Y = 0.024 // above the slab/zone patches, below racks

function formatLength(
  worldLen: number,
  units: FloorPlanConfig['units']
): string {
  const v = worldToDisplay(worldLen, units)
  const rounded = Math.round(v * 10) / 10
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} ${units}`
}

export function FloorPlanBoundary({ fp }: { fp: FloorPlanConfig }) {
  const x0 = fp.origin_x * WORLD_SCALE
  const z0 = fp.origin_y * WORLD_SCALE
  const x1 = (fp.origin_x + fp.width) * WORLD_SCALE
  const z1 = (fp.origin_y + fp.depth) * WORLD_SCALE

  const outline = useMemo(
    () =>
      [
        [x0, BOUNDARY_Y, z0],
        [x1, BOUNDARY_Y, z0],
        [x1, BOUNDARY_Y, z1],
        [x0, BOUNDARY_Y, z1],
        [x0, BOUNDARY_Y, z0],
      ] as [number, number, number][],
    [x0, z0, x1, z1]
  )

  const corners = useMemo(
    () =>
      [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ] as [number, number][],
    [x0, z0, x1, z1]
  )

  const labelSize = Math.min(Math.max((x1 - x0) * 0.035, 0.45), 2.2)

  return (
    <group>
      <Line
        points={outline}
        color={BOUNDARY_COLOR}
        lineWidth={2}
        dashed
        dashSize={0.6}
        gapSize={0.35}
        transparent
        opacity={0.85}
      />
      {corners.map(([cx, cz], i) => (
        <mesh key={i} position={[cx, 0.3, cz]}>
          <cylinderGeometry args={[0.05, 0.07, 0.6, 8]} />
          <meshStandardMaterial
            color={BOUNDARY_COLOR}
            emissive={BOUNDARY_COLOR}
            emissiveIntensity={0.25}
          />
        </mesh>
      ))}
      {/* Width label along the near (top) edge, depth label along the left. */}
      <Text
        position={[(x0 + x1) / 2, 0.02, z0 - labelSize * 0.9]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={labelSize}
        color={PALETTE.label}
        outlineWidth={labelSize * 0.08}
        outlineColor={PALETTE.labelOutline}
        anchorX='center'
        anchorY='middle'
      >
        {formatLength(fp.width, fp.units)}
      </Text>
      <Text
        position={[x0 - labelSize * 0.9, 0.02, (z0 + z1) / 2]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        fontSize={labelSize}
        color={PALETTE.label}
        outlineWidth={labelSize * 0.08}
        outlineColor={PALETTE.labelOutline}
        anchorX='center'
        anchorY='middle'
      >
        {formatLength(fp.depth, fp.units)}
      </Text>
    </group>
  )
}

// Created and developed by Jai Singh
