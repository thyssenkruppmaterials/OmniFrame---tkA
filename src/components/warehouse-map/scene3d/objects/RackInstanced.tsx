// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Rack renderer — posts + shelves + INSTANCED cells.
// ---------------------------------------------------------------------------
// The legacy view created one mesh+material per cell (rows×cols meshes per
// rack) which is the root of the 3D perf problem. Here each rack's cells are a
// single InstancedMesh: mapped (status-coloured, opaque, pickable) and empty
// (faint, translucent) are two instanced meshes. Clicking resolves
// instanceId → mapping for the existing handlers.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Text as DreiText } from '@react-three/drei'
import { type ThreeEvent } from '@react-three/fiber'
import type { Object3D } from 'three'
import * as THREE from 'three'
import type {
  OperationalStatus,
  WarehouseLocationMapping,
  WarehouseRack,
} from '../../types'
import { STATUS_COLORS } from '../../types'
import { rackCenter, rotationToY } from '../coords'
import { MATERIAL_PROPS } from '../materials3d'
import { levelOffsets, readRackAppearance } from '../rack-appearance'
import { PALETTE, RACK_DEPTH_DEFAULT, WORLD_SCALE } from '../scene-config'

interface RackProps {
  rack: WarehouseRack
  mappings: WarehouseLocationMapping[]
  highlightedBin?: string | null
  selected?: boolean
  /** When true, the whole rack is one selectable target for the 3D edit gizmo. */
  editable?: boolean
  onCellClick?: (mappingId: string) => void
  onRackClick?: (rackId: string) => void
  onSelect3D?: (rackId: string, object3D: Object3D) => void
}

const dummy = new THREE.Object3D()
const tmpColor = new THREE.Color()

export function RackInstanced({
  rack,
  mappings,
  highlightedBin = null,
  selected = false,
  editable = false,
  onCellClick,
  onRackClick,
  onSelect3D,
}: RackProps) {
  const widthW = rack.width * WORLD_SCALE
  const depthW = rack.height * WORLD_SCALE
  const rows = Math.max(1, rack.rows)
  const columns = Math.max(1, rack.columns)
  // Per-rack appearance (metadata.appearance): colours + level heights — each
  // level can have its own height; their sum drives the total build height.
  const appearance = useMemo(() => readRackAppearance(rack), [rack])
  const {
    deckY,
    heights: levelHs,
    total: totalHeight,
  } = useMemo(() => levelOffsets(appearance, rows), [appearance, rows])
  const cellWidth = widthW / columns
  // Instanced cells share ONE geometry at the uniform height; levels with a
  // height override scale their instances on Y instead.
  const cellHeight = appearance.levelHeightM * 0.8
  const cellDepth = Math.min(depthW, RACK_DEPTH_DEFAULT) * 0.82

  const [groupX, groupZ] = useMemo(() => rackCenter(rack), [rack])
  const rotationY = rotationToY(rack.rotation)

  // Upright-frame X positions. With palletsPerBay set the frames align to the
  // real bay boundaries (an upright every N pallet positions — 1/2/3-pallet
  // bays). Legacy racks keep the ~2.9 m heuristic so existing maps render
  // unchanged.
  const frameXs = useMemo(() => {
    if (appearance.palletsPerBay) {
      const bayW = cellWidth * appearance.palletsPerBay
      const bays = Math.max(1, Math.ceil(columns / appearance.palletsPerBay))
      return Array.from({ length: bays + 1 }, (_, i) =>
        Math.min(-widthW / 2 + bayW * i, widthW / 2)
      )
    }
    const bays = Math.max(1, Math.round(widthW / 2.9))
    return Array.from(
      { length: bays + 1 },
      (_, i) => -widthW / 2 + (widthW / bays) * i
    )
  }, [widthW, cellWidth, columns, appearance.palletsPerBay])

  // Partition cells into mapped (interactive) vs empty (decorative). Each
  // cell carries a Y scale so levels with a height override stretch/shrink
  // their instances (one shared geometry).
  const { mapped, empty } = useMemo(() => {
    const cellMap = new Map<string, WarehouseLocationMapping>()
    for (const m of mappings) cellMap.set(`${m.rack_row}-${m.rack_column}`, m)
    const mappedArr: {
      x: number
      y: number
      scaleY: number
      mapping: WarehouseLocationMapping
      color: string
    }[] = []
    const emptyArr: { x: number; y: number; scaleY: number }[] = []
    for (let row = 0; row < rows; row++) {
      const rowCellH = levelHs[row] * 0.8
      const scaleY = rowCellH / cellHeight
      for (let col = 0; col < columns; col++) {
        const x = -widthW / 2 + (col + 0.5) * cellWidth
        const y = deckY[row] + 0.04 + rowCellH / 2
        const mapping = cellMap.get(`${row + 1}-${col + 1}`)
        if (mapping) {
          const isHi =
            !!highlightedBin && mapping.storage_bin === highlightedBin
          const color = isHi
            ? PALETTE.accent
            : (STATUS_COLORS[mapping.operational_status as OperationalStatus] ??
              '#94a3b8')
          mappedArr.push({ x, y, scaleY, mapping, color })
        } else {
          emptyArr.push({ x, y, scaleY })
        }
      }
    }
    return { mapped: mappedArr, empty: emptyArr }
  }, [
    mappings,
    rows,
    columns,
    widthW,
    cellWidth,
    cellHeight,
    deckY,
    levelHs,
    highlightedBin,
  ])

  return (
    <group
      position={[groupX, 0, groupZ]}
      rotation={[0, rotationY, 0]}
      onClick={(e) => {
        if (editable) {
          e.stopPropagation()
          onSelect3D?.(rack.id, e.eventObject)
          return
        }
        if (e.eventObject === e.object) onRackClick?.(rack.id)
      }}
    >
      {/* Selection box (edit mode) */}
      {selected && editable && (
        <mesh position={[0, totalHeight / 2, 0]}>
          <boxGeometry args={[widthW + 0.1, totalHeight + 0.1, depthW + 0.1]} />
          <meshBasicMaterial color={PALETTE.selection} wireframe />
        </mesh>
      )}

      {/* Upright frames — end posts plus one intermediate frame per bay on
          long runs (a single run rack is the whole row, so end-only posts
          looked like a 20 m unsupported span). */}
      {frameXs.map((x, i) => (
        <group key={`frame-${i}`}>
          {[-depthW / 2, depthW / 2].map((z, j) => (
            <mesh key={j} position={[x, totalHeight / 2, z]} castShadow>
              <boxGeometry args={[0.07, totalHeight, 0.07]} />
              <meshStandardMaterial
                {...MATERIAL_PROPS.rackPost}
                color={selected ? PALETTE.selection : appearance.postColor}
              />
            </mesh>
          ))}
          {/* frame cross-brace */}
          <mesh position={[x, totalHeight * 0.55, 0]} castShadow>
            <boxGeometry
              args={[0.03, totalHeight * 0.85, Math.max(0.03, depthW - 0.1)]}
            />
            <meshStandardMaterial
              {...MATERIAL_PROPS.rackPost}
              color={appearance.postColor}
              transparent
              opacity={0.35}
            />
          </mesh>
        </group>
      ))}

      {/* Load beams (front + back) + shelf decks — per-level deck offsets */}
      {deckY.map((y, r) => (
        <group key={`level-${r}`}>
          {appearance.showBeams &&
            r > 0 &&
            [-depthW / 2 + 0.03, depthW / 2 - 0.03].map((z, j) => (
              <mesh key={`beam-${j}`} position={[0, y - 0.045, z]} castShadow>
                <boxGeometry args={[widthW, 0.09, 0.05]} />
                <meshStandardMaterial
                  color={appearance.beamColor}
                  roughness={0.45}
                  metalness={0.4}
                />
              </mesh>
            ))}
          <mesh position={[0, y, 0]} castShadow receiveShadow>
            <boxGeometry args={[widthW + 0.06, 0.05, depthW + 0.06]} />
            <meshStandardMaterial
              {...MATERIAL_PROPS.rackShelf}
              color={appearance.shelfColor}
            />
          </mesh>
        </group>
      ))}

      {/* Mapped cells — instanced, status-coloured. Pickable only outside edit
          mode (in edit mode clicks select the whole rack for the gizmo). */}
      {mapped.length > 0 && (
        <CellInstances
          cells={mapped}
          cellWidth={cellWidth}
          cellHeight={cellHeight}
          cellDepth={cellDepth}
          interactive={!editable}
          onPick={(i) => {
            const m = mapped[i]?.mapping
            if (m && onCellClick) onCellClick(m.id)
          }}
        />
      )}

      {/* Empty cells — instanced, faint */}
      {empty.length > 0 && (
        <EmptyInstances
          cells={empty}
          cellWidth={cellWidth}
          cellHeight={cellHeight}
          cellDepth={cellDepth}
        />
      )}

      {/* Rack label */}
      <DreiText
        position={[0, totalHeight + 0.28, 0]}
        fontSize={0.24}
        color={PALETTE.label}
        anchorX='center'
        anchorY='middle'
        outlineWidth={0.012}
        outlineColor={PALETTE.labelOutline}
      >
        {rack.label}
      </DreiText>
    </group>
  )
}

function CellInstances({
  cells,
  cellWidth,
  cellHeight,
  cellDepth,
  interactive,
  onPick,
}: {
  cells: { x: number; y: number; scaleY: number; color: string }[]
  cellWidth: number
  cellHeight: number
  cellDepth: number
  interactive: boolean
  onPick: (instanceId: number) => void
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < cells.length; i++) {
      dummy.position.set(cells[i].x, cells[i].y, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, cells[i].scaleY, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // instanceColor bypasses three's colour management — convert sRGB → linear
      // so status colours render true under the linear renderer pipeline.
      mesh.setColorAt(i, tmpColor.set(cells[i].color).convertSRGBToLinear())
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [cells])

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, cells.length]}
      castShadow
      receiveShadow
      onClick={
        interactive
          ? (e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation()
              if (e.instanceId != null) onPick(e.instanceId)
            }
          : undefined
      }
      onPointerOver={
        interactive
          ? (e) => {
              e.stopPropagation()
              document.body.style.cursor = 'pointer'
            }
          : undefined
      }
      onPointerOut={
        interactive
          ? () => {
              document.body.style.cursor = 'default'
            }
          : undefined
      }
    >
      <boxGeometry args={[cellWidth * 0.82, cellHeight, cellDepth]} />
      <meshStandardMaterial roughness={0.55} metalness={0.05} toneMapped />
    </instancedMesh>
  )
}

function EmptyInstances({
  cells,
  cellWidth,
  cellHeight,
  cellDepth,
}: {
  cells: { x: number; y: number; scaleY: number }[]
  cellWidth: number
  cellHeight: number
  cellDepth: number
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < cells.length; i++) {
      dummy.position.set(cells[i].x, cells[i].y, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, cells[i].scaleY, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [cells])

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, cells.length]}
      receiveShadow
    >
      <boxGeometry args={[cellWidth * 0.82, cellHeight, cellDepth]} />
      <meshStandardMaterial {...MATERIAL_PROPS.cellEmpty} />
    </instancedMesh>
  )
}

// Created and developed by Jai Singh
