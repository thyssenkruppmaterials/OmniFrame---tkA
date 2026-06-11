// Created and developed by Jai Singh
/**
 * Warehouse3DView — full-warehouse Three.js scene that renders the entire
 * warehouse map (building outline, zones, racks with cells, optional aisle
 * graph, optional active route, optional live asset positions) as an
 * orbitable 3D environment, in the spirit of Mappedin / Matterport.
 *
 * 2D world coords (1 unit = ~1 cm in our model) are scaled by 1/100 to give
 * Three.js sensible meter-scale units. The 2D x axis maps to 3D x and the
 * 2D y axis maps to 3D z (so the world lies on the floor plane y=0 and the
 * camera orbits around it).
 */
import { Suspense, useMemo, useRef } from 'react'
import {
  OrbitControls,
  Grid,
  Edges,
  Text as DreiText,
  Line as DreiLine,
  Environment,
} from '@react-three/drei'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { STATUS_COLORS } from './types'
import type {
  AisleEdge,
  AisleNode,
  AssetPositionLatest,
  MapLayoutResponse,
  OperationalStatus,
  RoutePoint,
  WarehouseLocationMapping,
  WarehouseRack,
  WarehouseZone,
} from './types'

const WORLD_SCALE = 1 / 100
const RACK_BASE_HEIGHT = 0.4 // shelf thickness in meters
const SHELF_SPACING = 0.45 // ~0.45 m between shelves
const FLOOR_Y = 0
const ZONE_HEIGHT = 0.02
const BUILDING_WALL_HEIGHT = 4.5

interface Warehouse3DViewProps {
  layout: MapLayoutResponse | null
  mappings: WarehouseLocationMapping[]
  routePolyline?: RoutePoint[] | null
  assetPositions?: AssetPositionLatest[]
  aisleNodes?: AisleNode[]
  aisleEdges?: AisleEdge[]
  highlightedBin?: string | null
  onCellClick?: (mappingId: string) => void
  onRackClick?: (rackId: string) => void
}

export function Warehouse3DView({
  layout,
  mappings,
  routePolyline = null,
  assetPositions = [],
  aisleNodes = [],
  aisleEdges = [],
  highlightedBin = null,
  onCellClick,
  onRackClick,
}: Warehouse3DViewProps) {
  const showAisleGraph = useWarehouseMapStore((s) => s.showAisleGraph)
  const showAssetPositions = useWarehouseMapStore((s) => s.showAssetPositions)

  // ---- World bounds + initial camera target ---------------------------------

  const bounds = useMemo(() => {
    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity

    if (layout?.map?.building_outline) {
      for (const p of layout.map.building_outline) {
        minX = Math.min(minX, p.x)
        minZ = Math.min(minZ, p.y)
        maxX = Math.max(maxX, p.x)
        maxZ = Math.max(maxZ, p.y)
      }
    }
    for (const z of layout?.zones ?? []) {
      for (const p of z.polygon ?? []) {
        minX = Math.min(minX, p.x)
        minZ = Math.min(minZ, p.y)
        maxX = Math.max(maxX, p.x)
        maxZ = Math.max(maxZ, p.y)
      }
    }
    for (const r of layout?.racks ?? []) {
      minX = Math.min(minX, r.position_x)
      minZ = Math.min(minZ, r.position_y)
      maxX = Math.max(maxX, r.position_x + r.width)
      maxZ = Math.max(maxZ, r.position_y + r.height)
    }
    if (!isFinite(minX)) {
      minX = 0
      minZ = 0
      maxX = 1000
      maxZ = 800
    }
    const cx = ((minX + maxX) / 2) * WORLD_SCALE
    const cz = ((minZ + maxZ) / 2) * WORLD_SCALE
    const w = (maxX - minX) * WORLD_SCALE
    const d = (maxZ - minZ) * WORLD_SCALE
    return { cx, cz, width: w, depth: d, minX, minZ, maxX, maxZ }
  }, [layout])

  const cameraDistance = Math.max(bounds.width, bounds.depth) * 0.9 + 5

  return (
    <div className='relative h-full w-full overflow-hidden rounded-lg bg-slate-950'>
      <Canvas
        shadows
        camera={{
          position: [
            bounds.cx + cameraDistance * 0.7,
            cameraDistance * 0.6,
            bounds.cz + cameraDistance * 0.7,
          ],
          fov: 45,
          near: 0.1,
          far: 500,
        }}
      >
        <Suspense fallback={null}>
          <color attach='background' args={['#020617']} />
          <fog
            attach='fog'
            args={['#020617', cameraDistance * 1.4, cameraDistance * 4]}
          />

          <ambientLight intensity={0.45} />
          <directionalLight
            position={[bounds.cx + 30, 50, bounds.cz - 20]}
            intensity={0.85}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-cameraDistance}
            shadow-camera-right={cameraDistance}
            shadow-camera-top={cameraDistance}
            shadow-camera-bottom={-cameraDistance}
          />
          <Environment preset='warehouse' background={false} />

          {/* Floor + grid */}
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[bounds.cx, FLOOR_Y, bounds.cz]}
            receiveShadow
          >
            <planeGeometry args={[bounds.width + 20, bounds.depth + 20]} />
            <meshStandardMaterial color='#0f172a' />
          </mesh>
          <Grid
            args={[bounds.width + 20, bounds.depth + 20]}
            position={[bounds.cx, FLOOR_Y + 0.001, bounds.cz]}
            cellSize={0.5}
            cellThickness={0.4}
            sectionSize={5}
            sectionThickness={1}
            cellColor='#1e293b'
            sectionColor='#334155'
            fadeDistance={cameraDistance * 4}
            infiniteGrid={false}
          />

          {/* Building outline as walls */}
          {layout?.map?.building_outline &&
            layout.map.building_outline.length >= 3 && (
              <BuildingShell points={layout.map.building_outline} />
            )}

          {/* Zone floor patches */}
          {(layout?.zones ?? []).map((zone) => (
            <ZoneShape key={zone.id} zone={zone} />
          ))}

          {/* Racks */}
          {(layout?.racks ?? []).map((rack) => {
            const rackMappings = mappings.filter((m) => m.rack_id === rack.id)
            return (
              <Rack3D
                key={rack.id}
                rack={rack}
                mappings={rackMappings}
                highlightedBin={highlightedBin}
                onCellClick={onCellClick}
                onRackClick={onRackClick}
              />
            )
          })}

          {/* Aisle graph */}
          {showAisleGraph && aisleNodes.length > 0 && (
            <AisleGraph3D nodes={aisleNodes} edges={aisleEdges} />
          )}

          {/* Active route */}
          {routePolyline && routePolyline.length >= 2 && (
            <Route3D points={routePolyline} />
          )}

          {/* Asset positions */}
          {showAssetPositions &&
            assetPositions.map((p) => (
              <AssetMarker3D key={p.asset_id} pos={p} />
            ))}

          <OrbitControls
            target={[bounds.cx, 1, bounds.cz]}
            enableDamping
            dampingFactor={0.08}
            minDistance={1}
            maxDistance={cameraDistance * 4}
            maxPolarAngle={Math.PI / 2.05}
          />
        </Suspense>
      </Canvas>

      <Html3DHints />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Building shell: extrudes the outline polygon into low walls + glass roof.
// ---------------------------------------------------------------------------

function BuildingShell({ points }: { points: { x: number; y: number }[] }) {
  const shape = useMemo(() => {
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
    // Build walls from each edge as a thin extruded wall
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
      // Two triangles for each wall (rect from y=0 to y=BUILDING_WALL_HEIGHT)
      positions.push(
        x1,
        0,
        z1,
        x2,
        0,
        z2,
        x2,
        BUILDING_WALL_HEIGHT,
        z2,
        x1,
        BUILDING_WALL_HEIGHT,
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
  }, [points])

  return (
    <group>
      {/* Floor inside outline (slightly raised to avoid z-fighting) */}
      <mesh
        receiveShadow
        position={[0, 0.005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          color='#1e293b'
          metalness={0.1}
          roughness={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Walls — semi-transparent */}
      <mesh geometry={wallGeometry} castShadow receiveShadow>
        <meshStandardMaterial
          color='#475569'
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
          metalness={0.4}
          roughness={0.4}
        />
      </mesh>
      {/* Wall edges */}
      <mesh geometry={wallGeometry}>
        <meshBasicMaterial
          color='#64748b'
          wireframe
          transparent
          opacity={0.4}
        />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Zone (low-elevation colored floor patch).
// ---------------------------------------------------------------------------

function ZoneShape({ zone }: { zone: WarehouseZone }) {
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

  const center = useMemo(() => {
    if (!zone.polygon || zone.polygon.length === 0) return [0, 0]
    let sx = 0
    let sy = 0
    for (const p of zone.polygon) {
      sx += p.x
      sy += p.y
    }
    return [
      (sx / zone.polygon.length) * WORLD_SCALE,
      (sy / zone.polygon.length) * WORLD_SCALE,
    ]
  }, [zone.polygon])

  if (!shape) return null

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, ZONE_HEIGHT, 0]}
        receiveShadow
      >
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          color={zone.color}
          transparent
          opacity={zone.opacity ?? 0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
      <DreiText
        position={[center[0], 0.05, center[1]]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.4}
        color={zone.color}
        anchorX='center'
        anchorY='middle'
        outlineWidth={0.02}
        outlineColor='#020617'
      >
        {zone.name}
      </DreiText>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Rack (3D box-grid). Each cell is a small box colored by operational status.
// ---------------------------------------------------------------------------

const RACK_DEPTH_DEFAULT = 0.6 // along Z (real-world rack depth)

function Rack3D({
  rack,
  mappings,
  highlightedBin,
  onCellClick,
  onRackClick,
}: {
  rack: WarehouseRack
  mappings: WarehouseLocationMapping[]
  highlightedBin?: string | null
  onCellClick?: (mappingId: string) => void
  onRackClick?: (rackId: string) => void
}) {
  // 2D rack.height becomes 3D depth (along Z).
  const widthW = rack.width * WORLD_SCALE
  const depthW = rack.height * WORLD_SCALE
  const rows = Math.max(1, rack.rows)
  const columns = Math.max(1, rack.columns)
  const totalHeight = rows * SHELF_SPACING + RACK_BASE_HEIGHT
  const cellWidth = widthW / columns
  const cellHeight = SHELF_SPACING * 0.85
  const cellDepth = Math.min(depthW, RACK_DEPTH_DEFAULT) * 0.85

  const cellMap = useMemo(() => {
    const m = new Map<string, WarehouseLocationMapping>()
    for (const x of mappings) m.set(`${x.rack_row}-${x.rack_column}`, x)
    return m
  }, [mappings])

  // Origin (0,0) of the rack group is at its world (position_x, position_y) corner.
  const groupX = (rack.position_x + rack.width / 2) * WORLD_SCALE
  const groupZ = (rack.position_y + rack.height / 2) * WORLD_SCALE
  const rotationY = -((rack.rotation ?? 0) * Math.PI) / 180

  return (
    <group
      position={[groupX, 0, groupZ]}
      rotation={[0, rotationY, 0]}
      onClick={(e) => {
        if (e.eventObject === e.object) onRackClick?.(rack.id)
      }}
    >
      {/* Posts (4 corners) */}
      {[
        [-widthW / 2, -depthW / 2],
        [widthW / 2, -depthW / 2],
        [-widthW / 2, depthW / 2],
        [widthW / 2, depthW / 2],
      ].map(([x, z], i) => (
        <mesh key={`post-${i}`} position={[x, totalHeight / 2, z]} castShadow>
          <boxGeometry args={[0.05, totalHeight, 0.05]} />
          <meshStandardMaterial
            color='#94a3b8'
            metalness={0.7}
            roughness={0.4}
          />
        </mesh>
      ))}

      {/* Shelf decks */}
      {Array.from({ length: rows + 1 }, (_, r) => (
        <mesh
          key={`shelf-${r}`}
          position={[0, r * SHELF_SPACING + RACK_BASE_HEIGHT, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[widthW + 0.05, 0.04, depthW + 0.05]} />
          <meshStandardMaterial
            color='#cbd5e1'
            metalness={0.2}
            roughness={0.6}
          />
        </mesh>
      ))}

      {/* Cells (cargo boxes inside each shelf bay) */}
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, col) => {
          const mapping = cellMap.get(`${row + 1}-${col + 1}`)
          const status =
            (mapping?.operational_status as OperationalStatus | undefined) ??
            null
          const color = mapping
            ? (STATUS_COLORS[status as OperationalStatus] ?? '#334155')
            : '#1e293b'
          const x = -widthW / 2 + (col + 0.5) * cellWidth
          const y =
            row * SHELF_SPACING + RACK_BASE_HEIGHT + 0.04 + cellHeight / 2
          const isHighlighted =
            !!highlightedBin && mapping?.storage_bin === highlightedBin
          const handleClick = (e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation()
            if (mapping && onCellClick) onCellClick(mapping.id)
          }
          return (
            <mesh
              key={`cell-${row}-${col}`}
              position={[x, y, 0]}
              castShadow
              receiveShadow
              onClick={handleClick}
              onPointerOver={(e) => {
                if (mapping) {
                  document.body.style.cursor = 'pointer'
                  e.stopPropagation()
                }
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'default'
              }}
            >
              <boxGeometry args={[cellWidth * 0.85, cellHeight, cellDepth]} />
              <meshStandardMaterial
                color={color}
                opacity={mapping ? 0.92 : 0.18}
                transparent
                emissive={isHighlighted ? '#22d3ee' : '#000000'}
                emissiveIntensity={isHighlighted ? 0.65 : 0}
                roughness={0.5}
                metalness={0.1}
              />
              {isHighlighted && <Edges color='#22d3ee' threshold={1} />}
            </mesh>
          )
        })
      )}

      {/* Rack label hovering above */}
      <DreiText
        position={[0, totalHeight + 0.25, 0]}
        fontSize={0.22}
        color='#e2e8f0'
        anchorX='center'
        anchorY='middle'
        outlineWidth={0.012}
        outlineColor='#020617'
      >
        {rack.label}
      </DreiText>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Aisle graph as floating tubes / spheres.
// ---------------------------------------------------------------------------

function AisleGraph3D({
  nodes,
  edges,
}: {
  nodes: AisleNode[]
  edges: AisleEdge[]
}) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, AisleNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  return (
    <group position={[0, 0.1, 0]}>
      {nodes.map((n) => (
        <mesh key={n.id} position={[n.x * WORLD_SCALE, 0.1, n.y * WORLD_SCALE]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial
            color={kindColor3D(n.kind)}
            emissive={kindColor3D(n.kind)}
            emissiveIntensity={0.4}
          />
        </mesh>
      ))}
      {edges.map((e) => {
        const a = nodeMap.get(e.from_node_id)
        const b = nodeMap.get(e.to_node_id)
        if (!a || !b) return null
        return (
          <DreiLine
            key={e.id}
            points={[
              [a.x * WORLD_SCALE, 0.1, a.y * WORLD_SCALE],
              [b.x * WORLD_SCALE, 0.1, b.y * WORLD_SCALE],
            ]}
            color={e.one_way ? '#a855f7' : '#10b981'}
            lineWidth={1.2}
            transparent
            opacity={0.7}
          />
        )
      })}
    </group>
  )
}

const KIND_COLOR: Record<string, string> = {
  aisle: '#10b981',
  doorway: '#facc15',
  pickup: '#3b82f6',
  dock: '#a855f7',
  stair: '#f97316',
  elevator: '#06b6d4',
  manual: '#94a3b8',
}

function kindColor3D(kind: string): string {
  return KIND_COLOR[kind] ?? '#94a3b8'
}

// ---------------------------------------------------------------------------
// Active route: marching-ants tube floating just above the floor.
// ---------------------------------------------------------------------------

function Route3D({ points }: { points: RoutePoint[] }) {
  const linePoints = useMemo(
    () =>
      points.map(
        (p) =>
          [p.x * WORLD_SCALE, 0.15, p.y * WORLD_SCALE] as [
            number,
            number,
            number,
          ]
      ),
    [points]
  )

  return (
    <group>
      {/* Glow under-line */}
      <DreiLine
        points={linePoints}
        color='#22d3ee'
        lineWidth={6}
        transparent
        opacity={0.25}
      />
      <DreiLine points={linePoints} color='#22d3ee' lineWidth={2.5} />
      {/* Endpoints */}
      <mesh position={linePoints[0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color='#0891b2'
          emissive='#0891b2'
          emissiveIntensity={0.6}
        />
      </mesh>
      <mesh position={linePoints[linePoints.length - 1]}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial
          color='#22d3ee'
          emissive='#22d3ee'
          emissiveIntensity={0.7}
        />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Asset position marker (forklift, operator, etc.)
// ---------------------------------------------------------------------------

function AssetMarker3D({ pos }: { pos: AssetPositionLatest }) {
  const ref = useRef<THREE.Group>(null)
  return (
    <group
      ref={ref}
      position={[pos.x * WORLD_SCALE, 0.5, pos.y * WORLD_SCALE]}
      rotation={[0, ((pos.heading_deg ?? 0) * Math.PI) / 180, 0]}
    >
      <mesh castShadow>
        <coneGeometry args={[0.18, 0.5, 16]} />
        <meshStandardMaterial
          color='#f59e0b'
          emissive='#f59e0b'
          emissiveIntensity={0.4}
        />
      </mesh>
      <mesh position={[0.25, 0, 0]}>
        <boxGeometry args={[0.4, 0.06, 0.06]} />
        <meshStandardMaterial color='#fff' />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// HTML overlay with orbit / pan / zoom hint.
// ---------------------------------------------------------------------------

function Html3DHints() {
  return (
    <div
      className='bg-card/80 pointer-events-none absolute right-4 bottom-4 rounded-md border px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur-sm'
      role='note'
    >
      <div className='text-muted-foreground'>
        <strong className='text-foreground'>Orbit</strong> drag &middot;{' '}
        <strong className='text-foreground'>Pan</strong> right-drag &middot;{' '}
        <strong className='text-foreground'>Zoom</strong> scroll
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
