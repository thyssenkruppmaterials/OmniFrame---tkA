// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// SceneObject — parametric renderer for placed furniture / fixtures.
// ---------------------------------------------------------------------------
// One <group> per object, origin at the footprint CENTER on the floor (y =
// position_z). Each kind builds recognizable geometry from soft-PBR primitives
// (no external models — parametric-first). Clicking selects (for the gizmo);
// when selected a thin accent bounding box is drawn and the label shows.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Text as DreiText } from '@react-three/drei'
import { type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { Object3D } from 'three'
import type { SceneObjectKind, WarehouseSceneObject } from '../../types'
import { rotationToY } from '../coords'
import { MATERIAL_PROPS, surface } from '../materials3d'
import { CATALOG_BY_KIND } from '../object-catalog'
import { FINISH_PRESETS, readObjectStyle } from '../object-style'
import { PALETTE, WORLD_SCALE } from '../scene-config'
import { ExtraObject } from './recipes-extra'
import { VehicleObject } from './recipes-vehicles'

interface SceneObjectProps {
  obj: WarehouseSceneObject
  selected?: boolean
  editable?: boolean
  /** Build mode: a kind is queued for placement (clicks build, not select). */
  placing?: boolean
  onSelect?: (id: string, object3D: Object3D, additive: boolean) => void
  /** Build mode: pointer moves over this object → ghost snaps to a face. */
  onBuildHover?: (
    obj: WarehouseSceneObject,
    e: ThreeEvent<PointerEvent>
  ) => void
  /** Build mode: click on this object → stack on top / adjoin at a side. */
  onBuildPlace?: (
    obj: WarehouseSceneObject,
    e: ThreeEvent<PointerEvent>
  ) => void
  /** Alt-click quick delete. */
  onQuickDelete?: (id: string) => void
  /** Middle-click pick block: start placing this object's kind. */
  onPickKind?: (kind: WarehouseSceneObject['kind']) => void
}

interface Dims {
  w: number
  d: number
  h: number
  color: string
}

export function SceneObject({
  obj,
  selected = false,
  editable = false,
  placing = false,
  onSelect,
  onBuildHover,
  onBuildPlace,
  onQuickDelete,
  onPickKind,
}: SceneObjectProps) {
  const entry = CATALOG_BY_KIND[obj.kind]
  const color = obj.color ?? entry?.color ?? '#c0c7d0'
  const w = obj.width * WORLD_SCALE
  const d = obj.depth * WORLD_SCALE
  const h = obj.height * WORLD_SCALE
  const dims: Dims = { w, d, h, color }

  const cx = obj.position_x * WORLD_SCALE
  const cz = obj.position_y * WORLD_SCALE
  const y = obj.position_z * WORLD_SCALE
  const rotationY = rotationToY(obj.rotation)

  // ---- Design style (metadata.style): finish preset + neon glow -------------
  // Applied by traversal so every recipe gets it without per-recipe plumbing.
  // Each material's recipe values are captured in userData on first touch so
  // switching back to 'standard' / glow-off restores the original look.
  const style = readObjectStyle(obj.metadata)
  const recipeRef = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const root = recipeRef.current
    if (!root) return
    const preset =
      style.finish !== 'standard' ? FINISH_PRESETS[style.finish] : null
    root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial
        if (!std.isMeshStandardMaterial) continue
        let base = std.userData.__recipeStyle as
          | {
              roughness: number
              metalness: number
              emissive: number
              emissiveIntensity: number
            }
          | undefined
        if (!base) {
          base = {
            roughness: std.roughness,
            metalness: std.metalness,
            emissive: std.emissive.getHex(),
            emissiveIntensity: std.emissiveIntensity,
          }
          std.userData.__recipeStyle = base
        }
        std.roughness = preset ? preset.roughness : base.roughness
        std.metalness = preset ? preset.metalness : base.metalness
        if (style.glow) {
          std.emissive.set(color)
          std.emissiveIntensity = 0.55
        } else {
          std.emissive.setHex(base.emissive)
          std.emissiveIntensity = base.emissiveIntensity
        }
      }
    })
  }, [style.finish, style.glow, color, obj.kind, w, d, h])

  return (
    <group
      position={[cx, y, cz]}
      rotation={[0, rotationY, 0]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (!editable || placing) return
        e.stopPropagation()
        if (e.nativeEvent.altKey && onQuickDelete) {
          onQuickDelete(obj.id) // Minecraft "break block"
          return
        }
        onSelect?.(obj.id, e.eventObject, e.shiftKey || e.nativeEvent.shiftKey)
      }}
      onPointerMove={
        editable && placing && onBuildHover
          ? (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation()
              onBuildHover(obj, e)
            }
          : undefined
      }
      onPointerDown={
        editable
          ? (e: ThreeEvent<PointerEvent>) => {
              // Middle-click pick-block works whether or not we're placing.
              if (e.button === 1 && onPickKind) {
                e.stopPropagation()
                onPickKind(obj.kind)
                return
              }
              if (placing && e.button === 0 && onBuildPlace) {
                e.stopPropagation()
                onBuildPlace(obj, e)
              }
            }
          : undefined
      }
      onPointerOver={(e) => {
        if (!editable) return
        e.stopPropagation()
        document.body.style.cursor = placing ? 'copy' : 'pointer'
      }}
      onPointerOut={() => {
        if (editable) document.body.style.cursor = 'default'
      }}
    >
      <group ref={recipeRef}>{buildKind(obj.kind, dims)}</group>

      {selected && (
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w + 0.06, h + 0.06, d + 0.06]} />
          <meshBasicMaterial color={PALETTE.selection} wireframe />
        </mesh>
      )}

      {(selected || !!obj.label) && (
        <DreiText
          position={[0, h + 0.22, 0]}
          fontSize={0.22}
          color={PALETTE.label}
          anchorX='center'
          anchorY='middle'
          outlineWidth={0.012}
          outlineColor={PALETTE.labelOutline}
        >
          {obj.label || entry?.label || obj.kind}
        </DreiText>
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Geometry recipes. All build from y=0 (floor) up to y=h, centered on x/z.
// ---------------------------------------------------------------------------

function buildKind(kind: SceneObjectKind, dims: Dims) {
  switch (kind) {
    case 'office':
    case 'meeting_room':
      return <Room {...dims} />
    case 'desk':
      return <Desk {...dims} />
    case 'table':
      return <Table4 {...dims} />
    case 'workstation':
      return <Workstation {...dims} />
    case 'cabinet':
      return <Cabinet {...dims} />
    case 'conveyor':
      return <Conveyor {...dims} />
    case 'forklift':
      return <Forklift {...dims} />
    case 'charging_station':
      return <ChargingStation {...dims} />
    case 'column':
      return <Column {...dims} />
    case 'dock_door':
      return <DockDoor {...dims} />
    case 'door':
      return <Door {...dims} />
    case 'barrier':
      return <Barrier {...dims} />
    case 'safety_rail':
      return <SafetyRail {...dims} />
    case 'sign':
      return <Sign {...dims} />
    case 'pallet':
      return <Pallet {...dims} />
    case 'pallet_stack':
      return <PalletStack {...dims} />
    case 'plant':
      return <Plant {...dims} />
    case 'wall':
      return <Wall {...dims} />
    case 'platform':
      return <Platform {...dims} />
    case 'stairs':
      return <Stairs {...dims} />
    case 'ramp':
      return <Ramp {...dims} />
    // Brand-spec vehicle fleet — own recipe module.
    case 'forklift_reach':
    case 'forklift_orderpicker':
    case 'forklift_standup':
    case 'forklift_turret':
    case 'pallet_truck_rider':
    case 'walkie_stacker':
    case 'tugger':
      return <VehicleObject kind={kind} {...dims} />
    default:
      // Extended catalog (chairs, lifts, drums, fences, …) lives in its own
      // recipe module to keep this file at the core kinds; it also renders the
      // unknown-kind fallback box.
      return <ExtraObject kind={kind} {...dims} />
  }
}

function Leg({
  x,
  z,
  h,
  color,
}: {
  x: number
  z: number
  h: number
  color: string
}) {
  return (
    <mesh position={[x, h / 2, z]} castShadow>
      <boxGeometry args={[0.05, h, 0.05]} />
      <meshStandardMaterial color={color} {...legMetal} />
    </mesh>
  )
}
const legMetal = { roughness: 0.45, metalness: 0.55 }

function Desk({ w, d, h, color }: Dims) {
  const topY = h - 0.02
  return (
    <group>
      <mesh position={[0, topY, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial {...surface('wood', color)} />
      </mesh>
      <Leg
        x={-w / 2 + 0.05}
        z={-d / 2 + 0.05}
        h={h - 0.04}
        color={PALETTE.metal}
      />
      <Leg
        x={w / 2 - 0.05}
        z={-d / 2 + 0.05}
        h={h - 0.04}
        color={PALETTE.metal}
      />
      <Leg
        x={-w / 2 + 0.05}
        z={d / 2 - 0.05}
        h={h - 0.04}
        color={PALETTE.metal}
      />
      <Leg
        x={w / 2 - 0.05}
        z={d / 2 - 0.05}
        h={h - 0.04}
        color={PALETTE.metal}
      />
      {/* monitor */}
      <mesh position={[0, topY + 0.18, -d / 2 + 0.12]} castShadow>
        <boxGeometry args={[Math.min(0.45, w * 0.4), 0.28, 0.03]} />
        <meshStandardMaterial color='#1f2937' roughness={0.3} metalness={0.2} />
      </mesh>
    </group>
  )
}

function Table4({ w, d, h, color }: Dims) {
  const topY = h - 0.02
  return (
    <group>
      <mesh position={[0, topY, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial {...surface('wood', color)} />
      </mesh>
      <Leg
        x={-w / 2 + 0.07}
        z={-d / 2 + 0.07}
        h={h - 0.04}
        color={PALETTE.metal}
      />
      <Leg
        x={w / 2 - 0.07}
        z={-d / 2 + 0.07}
        h={h - 0.04}
        color={PALETTE.metal}
      />
      <Leg
        x={-w / 2 + 0.07}
        z={d / 2 - 0.07}
        h={h - 0.04}
        color={PALETTE.metal}
      />
      <Leg
        x={w / 2 - 0.07}
        z={d / 2 - 0.07}
        h={h - 0.04}
        color={PALETTE.metal}
      />
    </group>
  )
}

function Workstation({ w, d, h, color }: Dims) {
  const surfaceY = h * 0.62
  return (
    <group>
      <mesh position={[0, surfaceY, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial {...surface('metal', color)} />
      </mesh>
      {/* back panel */}
      <mesh position={[0, h - (h - surfaceY) / 2, -d / 2 + 0.03]} castShadow>
        <boxGeometry args={[w, h - surfaceY, 0.04]} />
        <meshStandardMaterial {...surface('metal', color)} />
      </mesh>
      <Leg
        x={-w / 2 + 0.06}
        z={-d / 2 + 0.06}
        h={surfaceY}
        color={PALETTE.metal}
      />
      <Leg
        x={w / 2 - 0.06}
        z={-d / 2 + 0.06}
        h={surfaceY}
        color={PALETTE.metal}
      />
      <Leg
        x={-w / 2 + 0.06}
        z={d / 2 - 0.06}
        h={surfaceY}
        color={PALETTE.metal}
      />
      <Leg
        x={w / 2 - 0.06}
        z={d / 2 - 0.06}
        h={surfaceY}
        color={PALETTE.metal}
      />
    </group>
  )
}

function Cabinet({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...surface('plastic', color)} />
      </mesh>
      {/* door split line */}
      <mesh position={[0, h / 2, d / 2 + 0.001]}>
        <boxGeometry args={[0.01, h * 0.9, 0.005]} />
        <meshBasicMaterial color='#7c8696' />
      </mesh>
    </group>
  )
}

function Room({ w, d, h, color }: Dims) {
  const wall = 0.06
  return (
    <group>
      {/* floor */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial
          color='#dfe5ee'
          roughness={0.8}
          metalness={0.02}
        />
      </mesh>
      {/* back + sides (drywall) */}
      <mesh position={[0, h / 2, -d / 2 + wall / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, wall]} />
        <meshStandardMaterial {...surface('drywall', color)} />
      </mesh>
      <mesh position={[-w / 2 + wall / 2, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[wall, h, d]} />
        <meshStandardMaterial {...surface('drywall', color)} />
      </mesh>
      <mesh position={[w / 2 - wall / 2, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[wall, h, d]} />
        <meshStandardMaterial {...surface('drywall', color)} />
      </mesh>
      {/* glass front */}
      <mesh position={[0, h / 2, d / 2 - 0.02]}>
        <boxGeometry args={[w, h, 0.03]} />
        <meshStandardMaterial {...MATERIAL_PROPS.glass} />
      </mesh>
      {/* top frame rim */}
      <mesh position={[0, h, 0]}>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial
          {...surface('metal', PALETTE.metal)}
          transparent
          opacity={0.5}
        />
      </mesh>
    </group>
  )
}

function Conveyor({ w, d, h, color }: Dims) {
  const beltY = h * 0.9
  const legH = beltY - 0.08
  return (
    <group>
      {/* belt */}
      <mesh position={[0, beltY, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.1, d]} />
        <meshStandardMaterial
          color='#3b4250'
          roughness={0.85}
          metalness={0.1}
        />
      </mesh>
      {/* side rails */}
      <mesh position={[0, beltY + 0.08, -d / 2 + 0.03]}>
        <boxGeometry args={[w, 0.08, 0.04]} />
        <meshStandardMaterial {...surface('metal', color)} />
      </mesh>
      <mesh position={[0, beltY + 0.08, d / 2 - 0.03]}>
        <boxGeometry args={[w, 0.08, 0.04]} />
        <meshStandardMaterial {...surface('metal', color)} />
      </mesh>
      {/* legs */}
      {[-w / 2 + 0.1, 0, w / 2 - 0.1].map((x, i) => (
        <group key={i}>
          <Leg x={x} z={-d / 2 + 0.05} h={legH} color={color} />
          <Leg x={x} z={d / 2 - 0.05} h={legH} color={color} />
        </group>
      ))}
    </group>
  )
}

function Forklift({ w, d, h, color }: Dims) {
  return (
    <group>
      {/* body */}
      <mesh position={[w * 0.18, h * 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.55, h * 0.5, d * 0.9]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* cabin */}
      <mesh position={[w * 0.18, h * 0.75, 0]} castShadow>
        <boxGeometry args={[w * 0.4, h * 0.45, d * 0.7]} />
        <meshStandardMaterial {...MATERIAL_PROPS.glass} />
      </mesh>
      {/* mast */}
      <mesh position={[-w * 0.42, h * 0.5, -d * 0.2]} castShadow>
        <boxGeometry args={[0.06, h, 0.06]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      <mesh position={[-w * 0.42, h * 0.5, d * 0.2]} castShadow>
        <boxGeometry args={[0.06, h, 0.06]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      {/* forks */}
      <mesh position={[-w * 0.5, 0.06, -d * 0.18]} castShadow>
        <boxGeometry args={[w * 0.35, 0.04, 0.06]} />
        <meshStandardMaterial {...surface('metal', '#2b2f36')} />
      </mesh>
      <mesh position={[-w * 0.5, 0.06, d * 0.18]} castShadow>
        <boxGeometry args={[w * 0.35, 0.04, 0.06]} />
        <meshStandardMaterial {...surface('metal', '#2b2f36')} />
      </mesh>
      {/* wheels */}
      {[
        [-w * 0.25, -d * 0.4],
        [-w * 0.25, d * 0.4],
        [w * 0.35, -d * 0.4],
        [w * 0.35, d * 0.4],
      ].map(([x, z], i) => (
        <mesh
          key={i}
          position={[x, 0.12, z]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.12, 0.12, 0.1, 16]} />
          <meshStandardMaterial color='#1b1f25' roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function ChargingStation({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
      </mesh>
      {/* screen */}
      <mesh position={[0, h * 0.7, d / 2 + 0.001]}>
        <boxGeometry args={[w * 0.6, h * 0.25, 0.01]} />
        <meshStandardMaterial
          color='#0ea5e9'
          emissive='#0ea5e9'
          emissiveIntensity={0.5}
        />
      </mesh>
    </group>
  )
}

function Column({ w, h }: Dims) {
  const r = Math.max(w, 0.1) / 2
  return (
    <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[r, r * 1.1, h, 20]} />
      <meshStandardMaterial color='#cdd4de' roughness={0.85} metalness={0.05} />
    </mesh>
  )
}

function DockDoor({ w, d, h, color }: Dims) {
  return (
    <group>
      {/* frame */}
      <mesh position={[-w / 2 + 0.05, h / 2, 0]} castShadow>
        <boxGeometry args={[0.1, h, d + 0.1]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      <mesh position={[w / 2 - 0.05, h / 2, 0]} castShadow>
        <boxGeometry args={[0.1, h, d + 0.1]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      <mesh position={[0, h - 0.05, 0]} castShadow>
        <boxGeometry args={[w, 0.1, d + 0.1]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      {/* roller door panel */}
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w - 0.16, h - 0.16, d]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.3} />
      </mesh>
    </group>
  )
}

function Door({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, d * 0.5]} />
        <meshStandardMaterial {...surface('wood', color)} />
      </mesh>
      {/* handle */}
      <mesh position={[w / 2 - 0.12, h / 2, d * 0.3]}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshStandardMaterial color='#facc15' metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  )
}

function Barrier({ w, h, color }: Dims) {
  return (
    <group>
      <mesh position={[-w / 2 + 0.04, h / 2, 0]} castShadow>
        <boxGeometry args={[0.06, h, 0.06]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[w / 2 - 0.04, h / 2, 0]} castShadow>
        <boxGeometry args={[0.06, h, 0.06]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, h * 0.8, 0]} castShadow>
        <boxGeometry args={[w, 0.1, 0.08]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>
    </group>
  )
}

function SafetyRail({ w, h, color }: Dims) {
  return (
    <group>
      {[-w / 2 + 0.04, 0, w / 2 - 0.04].map((x, i) => (
        <mesh key={i} position={[x, h / 2, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, h, 12]} />
          <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, h * 0.9, 0]} castShadow>
        <boxGeometry args={[w, 0.05, 0.05]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, h * 0.5, 0]} castShadow>
        <boxGeometry args={[w, 0.05, 0.05]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
      </mesh>
    </group>
  )
}

function Sign({ w, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, (h * 0.6) / 2, 0]} castShadow>
        <boxGeometry args={[0.06, h * 0.6, 0.06]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      <mesh position={[0, h * 0.8, 0]} castShadow>
        <boxGeometry args={[w, h * 0.35, 0.04]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} />
      </mesh>
    </group>
  )
}

function Pallet({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...surface('wood', color)} />
      </mesh>
    </group>
  )
}

function PalletStack({ w, d, h, color }: Dims) {
  const palletH = Math.min(0.16, h * 0.12)
  return (
    <group>
      <mesh position={[0, palletH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, palletH, d]} />
        <meshStandardMaterial {...surface('wood', color)} />
      </mesh>
      {/* cargo */}
      <mesh
        position={[0, palletH + (h - palletH) / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[w * 0.95, h - palletH, d * 0.95]} />
        <meshStandardMaterial color='#c8a06a' roughness={0.85} metalness={0} />
      </mesh>
    </group>
  )
}

// ---- Structural building blocks (Minecraft-style build mode) ---------------

function Wall({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...surface('drywall', color)} />
      </mesh>
      {/* top cap so stacked rows read as courses */}
      <mesh position={[0, h - 0.015, 0]} castShadow>
        <boxGeometry args={[w, 0.03, d + 0.015]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
    </group>
  )
}

function Platform({ w, d, h, color }: Dims) {
  const deck = Math.min(0.08, Math.max(0.04, h * 0.4))
  return (
    <group>
      {/* deck */}
      <mesh position={[0, h - deck / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, deck, d]} />
        <meshStandardMaterial {...surface('plastic', color)} />
      </mesh>
      {/* support skirt */}
      <mesh position={[0, (h - deck) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.96, Math.max(0.02, h - deck), d * 0.96]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
    </group>
  )
}

function Stairs({ w, d, h, color }: Dims) {
  const steps = 5
  return (
    <group>
      {Array.from({ length: steps }, (_, i) => {
        const stepH = (h / steps) * (i + 1)
        const stepD = d / steps
        // Steps climb toward -z (the object's "back").
        const z = d / 2 - stepD * (i + 0.5)
        return (
          <mesh key={i} position={[0, stepH / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[w, stepH, stepD]} />
            <meshStandardMaterial {...surface('metal', color)} />
          </mesh>
        )
      })}
    </group>
  )
}

function Ramp({ w, d, h, color }: Dims) {
  // Wedge rising from the front edge (+z) to full height at the back (-z).
  const geometry = useMemo(() => {
    const hw = w / 2
    const hd = d / 2
    const v = [
      [-hw, 0, hd],
      [hw, 0, hd],
      [hw, 0, -hd],
      [-hw, 0, -hd], // floor
      [-hw, h, -hd],
      [hw, h, -hd], // top back edge
    ]
    const tris = [
      [0, 2, 1],
      [0, 3, 2], // bottom
      [0, 1, 5],
      [0, 5, 4], // slope
      [2, 3, 4],
      [2, 4, 5], // back face
      [0, 4, 3], // left side
      [1, 2, 5], // right side
    ]
    const positions = new Float32Array(tris.flat().flatMap((i) => v[i]))
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.computeVertexNormals()
    return geo
  }, [w, d, h])

  // R3F only auto-disposes geometries it created via JSX; this one is ours.
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial {...surface('plastic', color)} />
    </mesh>
  )
}

function Plant({ w, h }: Dims) {
  const potH = h * 0.3
  const r = Math.max(w, 0.12) / 2
  return (
    <group>
      <mesh position={[0, potH / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.7, r * 0.55, potH, 16]} />
        <meshStandardMaterial color='#a3624a' roughness={0.8} />
      </mesh>
      <mesh position={[0, potH + (h - potH) * 0.45, 0]} castShadow>
        <sphereGeometry args={[r * 1.1, 16, 16]} />
        <meshStandardMaterial color='#6aa84f' roughness={0.9} />
      </mesh>
    </group>
  )
}

// Created and developed by Jai Singh
