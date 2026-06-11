// Created and developed by Jai Singh
// DEV harness helper (the `-` prefix keeps it out of the route tree): renders
// every object-catalog kind in a labelled grid with neutral lighting so all
// parametric recipes can be eyeballed at once (/scene3d-harness?showcase).
import { MapControls, OrthographicCamera } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { OBJECT_CATALOG } from '@/components/warehouse-map/scene3d/object-catalog'
import { SceneObject } from '@/components/warehouse-map/scene3d/objects/SceneObject'
import type { WarehouseSceneObject } from '@/components/warehouse-map/types'

const SPACING = 500 // world units between grid cells
const COLS = 8

const OBJECTS: WarehouseSceneObject[] = OBJECT_CATALOG.map((entry, i) => ({
  id: `showcase-${entry.kind}`,
  map_id: 'showcase',
  organization_id: 'showcase',
  kind: entry.kind,
  label: entry.label,
  position_x: (i % COLS) * SPACING,
  position_y: Math.floor(i / COLS) * SPACING,
  position_z: 0,
  width: entry.width,
  depth: entry.depth,
  height: entry.height,
  rotation: 0,
  color: entry.color,
  floor_level: 0,
  metadata: {},
  updated_at: '',
}))

const CX = (((COLS - 1) * SPACING) / 2) * 0.01
const CZ = ((Math.ceil(OBJECTS.length / COLS) - 1) * SPACING * 0.01) / 2

export default function CatalogShowcase() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      style={{ background: '#dfe7f0' }}
      orthographic
    >
      <OrthographicCamera
        makeDefault
        position={[CX + 30, 30, CZ + 30]}
        zoom={28}
        near={0.1}
        far={500}
      />
      <MapControls makeDefault target={[CX, 0, CZ]} />
      <ambientLight intensity={0.6} color='#eaf0f8' />
      <hemisphereLight intensity={0.7} color='#eef4ff' groundColor='#c9d3e0' />
      <directionalLight
        position={[CX + 20, 35, CZ + 12]}
        intensity={2}
        color='#fff4e2'
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[CX, -0.01, CZ]}
        receiveShadow
      >
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color='#cdd7e4' roughness={0.95} />
      </mesh>
      {OBJECTS.map((obj) => (
        <SceneObject key={obj.id} obj={obj} />
      ))}
    </Canvas>
  )
}

// Created and developed by Jai Singh
