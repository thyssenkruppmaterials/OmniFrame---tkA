// Created and developed by Jai Singh
// Soft ground plane + subtle reference grid surrounding the building footprint.
import { Grid } from '@react-three/drei'
import type { SceneBounds } from '../coords'
import { MATERIAL_PROPS, useGrainTexture } from '../materials3d'
import { FLOOR_Y, PALETTE } from '../scene-config'

export function Ground({
  bounds,
  showGrid = true,
}: {
  bounds: SceneBounds
  showGrid?: boolean
}) {
  const grain = useGrainTexture(48, 12)
  const size = bounds.span * 3 + 40

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[bounds.cx, FLOOR_Y - 0.03, bounds.cz]}
        receiveShadow
      >
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial {...MATERIAL_PROPS.ground} roughnessMap={grain} />
      </mesh>
      {showGrid && (
        <Grid
          position={[bounds.cx, FLOOR_Y - 0.018, bounds.cz]}
          args={[size, size]}
          cellSize={1}
          cellThickness={0.5}
          cellColor={PALETTE.gridCell}
          sectionSize={5}
          sectionThickness={1}
          sectionColor={PALETTE.gridSection}
          fadeDistance={bounds.span * 2.6 + 30}
          fadeStrength={1.6}
          infiniteGrid={false}
        />
      )}
    </group>
  )
}

// Created and developed by Jai Singh
