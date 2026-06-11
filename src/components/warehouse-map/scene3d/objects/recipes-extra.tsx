// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// recipes-extra — parametric geometry for the extended object catalog.
// ---------------------------------------------------------------------------
// Keeps SceneObject.tsx focused on the core kinds; everything here follows the
// same contract: build from y=0 (floor) up to y=h, centered on x/z, in meters.
import type { ReactNode } from 'react'
import type { SceneObjectKind } from '../../types'
import { MATERIAL_PROPS, surface } from '../materials3d'
import { PALETTE } from '../scene-config'

interface Dims {
  w: number
  d: number
  h: number
  color: string
}

/**
 * Renderer for the extended kinds; unknown kinds fall back to a simple box so
 * persisted objects always render even if the catalog evolves. (Component
 * export — keeps react-refresh happy for the whole recipe module.)
 */
export function ExtraObject({
  kind,
  ...dims
}: { kind: SceneObjectKind } & Dims) {
  const R = EXTRA_RECIPES[kind]
  if (R) return <>{R(dims)}</>
  return (
    <mesh position={[0, dims.h / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[dims.w, dims.h, dims.d]} />
      <meshStandardMaterial
        color={dims.color}
        roughness={0.7}
        metalness={0.05}
      />
    </mesh>
  )
}

const legMetal = { roughness: 0.45, metalness: 0.55 }

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
      <boxGeometry args={[0.04, h, 0.04]} />
      <meshStandardMaterial color={color} {...legMetal} />
    </mesh>
  )
}

// ---- Furniture --------------------------------------------------------------

function Chair({ w, d, h, color }: Dims) {
  const seatY = h * 0.5
  return (
    <group>
      <mesh position={[0, seatY, 0]} castShadow>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial {...surface('plastic', color)} />
      </mesh>
      {/* backrest */}
      <mesh position={[0, seatY + (h - seatY) / 2, -d / 2 + 0.03]} castShadow>
        <boxGeometry args={[w, h - seatY, 0.05]} />
        <meshStandardMaterial {...surface('plastic', color)} />
      </mesh>
      <Leg
        x={-w / 2 + 0.04}
        z={-d / 2 + 0.04}
        h={seatY}
        color={PALETTE.metal}
      />
      <Leg x={w / 2 - 0.04} z={-d / 2 + 0.04} h={seatY} color={PALETTE.metal} />
      <Leg x={-w / 2 + 0.04} z={d / 2 - 0.04} h={seatY} color={PALETTE.metal} />
      <Leg x={w / 2 - 0.04} z={d / 2 - 0.04} h={seatY} color={PALETTE.metal} />
    </group>
  )
}

function Sofa({ w, d, h, color }: Dims) {
  const baseH = h * 0.45
  return (
    <group>
      <mesh position={[0, baseH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, baseH, d]} />
        <meshStandardMaterial color={color} roughness={0.9} metalness={0} />
      </mesh>
      {/* backrest */}
      <mesh
        position={[0, baseH + (h - baseH) / 2, -d / 2 + d * 0.12]}
        castShadow
      >
        <boxGeometry args={[w, h - baseH, d * 0.24]} />
        <meshStandardMaterial color={color} roughness={0.9} metalness={0} />
      </mesh>
      {/* armrests */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (w / 2 - w * 0.06), baseH * 1.25, 0]}
          castShadow
        >
          <boxGeometry args={[w * 0.12, baseH * 0.5, d]} />
          <meshStandardMaterial color={color} roughness={0.9} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}

function Locker({ w, d, h, color }: Dims) {
  const doors = Math.max(2, Math.round(w / 0.5))
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...surface('metal', color)} />
      </mesh>
      {Array.from({ length: doors - 1 }, (_, i) => (
        <mesh
          key={i}
          position={[-w / 2 + (w / doors) * (i + 1), h / 2, d / 2 + 0.002]}
        >
          <boxGeometry args={[0.01, h * 0.92, 0.004]} />
          <meshBasicMaterial color='#5c6878' />
        </mesh>
      ))}
    </group>
  )
}

function ShelfUnit({ w, d, h, color }: Dims) {
  const shelves = 4
  return (
    <group>
      {/* side panels */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.015), h / 2, 0]} castShadow>
          <boxGeometry args={[0.03, h, d]} />
          <meshStandardMaterial {...surface('metal', color)} />
        </mesh>
      ))}
      {Array.from({ length: shelves }, (_, i) => (
        <mesh
          key={i}
          position={[0, 0.05 + (h - 0.1) * (i / (shelves - 1)), 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[w - 0.06, 0.035, d]} />
          <meshStandardMaterial {...surface('wood', PALETTE.rackShelf)} />
        </mesh>
      ))}
    </group>
  )
}

function Counter({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, (h - 0.05) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w - 0.04, h - 0.05, d - 0.04]} />
        <meshStandardMaterial {...surface('drywall', color)} />
      </mesh>
      <mesh position={[0, h - 0.025, 0]} castShadow>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial {...surface('wood', PALETTE.wood)} />
      </mesh>
    </group>
  )
}

function Partition({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h / 2 + 0.04, 0]} castShadow>
        <boxGeometry args={[w, h - 0.08, Math.max(0.04, d)]} />
        <meshStandardMaterial color={color} roughness={0.9} metalness={0} />
      </mesh>
      {/* feet */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.08), 0.02, 0]} castShadow>
          <boxGeometry args={[0.12, 0.04, Math.max(0.25, d * 3)]} />
          <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
        </mesh>
      ))}
    </group>
  )
}

function Whiteboard({ w, d, h }: Dims) {
  const boardH = h * 0.55
  const legH = h - boardH
  return (
    <group>
      <mesh position={[0, legH + boardH / 2, 0]} castShadow>
        <boxGeometry args={[w, boardH, 0.04]} />
        <meshStandardMaterial
          color='#fafcff'
          roughness={0.25}
          metalness={0.02}
        />
      </mesh>
      {/* frame + tray */}
      <mesh position={[0, legH - 0.02, 0.05]}>
        <boxGeometry args={[w * 0.9, 0.03, 0.08]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      <Leg
        x={-w / 2 + 0.05}
        z={-d / 4}
        h={legH + boardH * 0.2}
        color={PALETTE.metal}
      />
      <Leg
        x={w / 2 - 0.05}
        z={-d / 4}
        h={legH + boardH * 0.2}
        color={PALETTE.metal}
      />
      <Leg
        x={-w / 2 + 0.05}
        z={d / 4}
        h={legH + boardH * 0.2}
        color={PALETTE.metal}
      />
      <Leg
        x={w / 2 - 0.05}
        z={d / 4}
        h={legH + boardH * 0.2}
        color={PALETTE.metal}
      />
    </group>
  )
}

// ---- Equipment ---------------------------------------------------------------

function PalletJack({ w, d, h, color }: Dims) {
  return (
    <group>
      {/* forks */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[w * 0.08, 0.05, s * d * 0.22]} castShadow>
          <boxGeometry args={[w * 0.75, 0.06, d * 0.18]} />
          <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
      {/* hydraulic body */}
      <mesh position={[-w * 0.38, 0.18, 0]} castShadow>
        <boxGeometry args={[w * 0.18, 0.3, d * 0.5]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} />
      </mesh>
      {/* handle */}
      <mesh
        position={[-w * 0.46, h * 0.55, 0]}
        rotation={[0, 0, Math.PI / 9]}
        castShadow
      >
        <cylinderGeometry args={[0.02, 0.02, h * 0.8, 8]} />
        <meshStandardMaterial {...surface('metal', '#2b2f36')} />
      </mesh>
      {/* wheels */}
      <mesh
        position={[-w * 0.38, 0.07, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[0.07, 0.07, d * 0.4, 12]} />
        <meshStandardMaterial color='#1b1f25' roughness={0.95} />
      </mesh>
    </group>
  )
}

function HandTruck({ w, d, h, color }: Dims) {
  return (
    <group>
      {/* frame */}
      <mesh
        position={[0, h / 2 + 0.05, -d * 0.2]}
        rotation={[Math.PI / 14, 0, 0]}
        castShadow
      >
        <boxGeometry args={[w * 0.8, h * 0.95, 0.04]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} />
      </mesh>
      {/* toe plate */}
      <mesh position={[0, 0.03, d * 0.18]} castShadow>
        <boxGeometry args={[w * 0.85, 0.03, d * 0.55]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      {/* wheels */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * w * 0.35, 0.09, -d * 0.25]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.09, 0.09, 0.05, 14]} />
          <meshStandardMaterial color='#1b1f25' roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function AgvRobot({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h * 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h * 0.8, d]} />
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.3} />
      </mesh>
      {/* lidar puck */}
      <mesh position={[w * 0.25, h * 0.9, 0]} castShadow>
        <cylinderGeometry
          args={[
            Math.min(0.06, w * 0.12),
            Math.min(0.06, w * 0.12),
            h * 0.2,
            14,
          ]}
        />
        <meshStandardMaterial color='#1f2937' roughness={0.4} metalness={0.3} />
      </mesh>
      {/* accent stripe */}
      <mesh position={[0, h * 0.55, d / 2 + 0.002]}>
        <boxGeometry args={[w * 0.9, h * 0.12, 0.004]} />
        <meshStandardMaterial
          color='#22d3ee'
          emissive='#22d3ee'
          emissiveIntensity={0.4}
        />
      </mesh>
    </group>
  )
}

function ScissorLift({ w, d, h, color }: Dims) {
  const baseH = h * 0.16
  const platY = h * 0.78
  return (
    <group>
      <mesh position={[0, baseH / 2 + 0.06, 0]} castShadow>
        <boxGeometry args={[w, baseH, d]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.35} />
      </mesh>
      {/* wheels */}
      {[
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh
          key={i}
          position={[sx * (w / 2 - 0.12), 0.09, sz * (d / 2 - 0.1)]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.09, 0.09, 0.08, 12]} />
          <meshStandardMaterial color='#1b1f25' roughness={0.95} />
        </mesh>
      ))}
      {/* scissor X */}
      {[-1, 1].map((s) => (
        <group
          key={s}
          position={[0, baseH + (platY - baseH) / 2, s * (d / 2 - 0.06)]}
        >
          <mesh rotation={[0, 0, Math.PI / 5]} castShadow>
            <boxGeometry args={[(platY - baseH) * 1.5, 0.05, 0.03]} />
            <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 5]} castShadow>
            <boxGeometry args={[(platY - baseH) * 1.5, 0.05, 0.03]} />
            <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
          </mesh>
        </group>
      ))}
      {/* platform + rails */}
      <mesh position={[0, platY, 0]} castShadow>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial {...surface('metal', color)} />
      </mesh>
      <mesh position={[0, platY + (h - platY) / 2, -d / 2 + 0.02]} castShadow>
        <boxGeometry args={[w, h - platY, 0.03]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (w / 2 - 0.02), platY + (h - platY) / 2, 0]}
          castShadow
        >
          <boxGeometry args={[0.03, h - platY, d]} />
          <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
        </mesh>
      ))}
    </group>
  )
}

function Ladder({ w, h, color }: Dims) {
  const lean = Math.PI / 16
  return (
    <group rotation={[lean, 0, 0]}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.025), h / 2, 0]} castShadow>
          <boxGeometry args={[0.05, h, 0.05]} />
          <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <mesh
          key={i}
          position={[0, (h / 6) * (i + 1), 0]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.018, 0.018, w - 0.1, 8]} />
          <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
        </mesh>
      ))}
    </group>
  )
}

function FloorScale({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.08, d]} />
        <meshStandardMaterial {...surface('metal', color)} />
      </mesh>
      {/* display pillar */}
      <mesh position={[-w / 2 + 0.05, h / 2, -d / 2 + 0.05]} castShadow>
        <boxGeometry args={[0.06, h, 0.06]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      <mesh position={[-w / 2 + 0.05, h * 0.92, -d / 2 + 0.09]} castShadow>
        <boxGeometry args={[0.22, 0.14, 0.05]} />
        <meshStandardMaterial color='#1f2937' roughness={0.4} />
      </mesh>
    </group>
  )
}

function StretchWrapper({ w, d, h, color }: Dims) {
  const r = Math.min(w, d) * 0.45
  return (
    <group>
      {/* turntable */}
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, 0.1, 24]} />
        <meshStandardMaterial {...surface('metal', color)} />
      </mesh>
      {/* mast */}
      <mesh position={[-w / 2 + 0.1, h / 2, 0]} castShadow>
        <boxGeometry args={[0.2, h, 0.25]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.35} />
      </mesh>
      {/* film carriage */}
      <mesh position={[-w / 2 + 0.1, h * 0.45, 0.2]} castShadow>
        <boxGeometry args={[0.14, 0.4, 0.14]} />
        <meshStandardMaterial {...surface('plastic', '#e2e8f0')} />
      </mesh>
    </group>
  )
}

function TrashBin({ w, h, color }: Dims) {
  const r = Math.max(w, 0.2) / 2
  return (
    <group>
      <mesh position={[0, (h - 0.04) / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.92, r * 0.8, h - 0.04, 18]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />
      </mesh>
      <mesh position={[0, h - 0.02, 0]} castShadow>
        <cylinderGeometry args={[r, r, 0.04, 18]} />
        <meshStandardMaterial color='#3f4754' roughness={0.6} />
      </mesh>
    </group>
  )
}

function FanUnit({ w, h, color }: Dims) {
  const r = Math.max(w, 0.3) / 2
  return (
    <group>
      {/* pole + base */}
      <mesh position={[0, 0.025, 0]} castShadow>
        <cylinderGeometry args={[r * 0.7, r * 0.7, 0.05, 16]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      <mesh position={[0, (h - r) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, h - r, 10]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
      {/* cage */}
      <mesh
        position={[0, h - r * 0.9, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[r * 0.9, r * 0.9, 0.12, 20]} />
        <meshStandardMaterial
          color={color}
          roughness={0.4}
          metalness={0.5}
          transparent
          opacity={0.85}
        />
      </mesh>
      <mesh position={[0, h - r * 0.9, 0.07]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r * 0.18, r * 0.18, 0.06, 12]} />
        <meshStandardMaterial color='#1f2937' roughness={0.4} />
      </mesh>
    </group>
  )
}

function FireExtinguisher({ w, h }: Dims) {
  const r = Math.max(w, 0.12) / 2
  return (
    <group>
      <mesh position={[0, h * 0.45, 0]} castShadow>
        <cylinderGeometry args={[r * 0.8, r * 0.8, h * 0.75, 14]} />
        <meshStandardMaterial
          color='#dc2626'
          roughness={0.45}
          metalness={0.25}
        />
      </mesh>
      <mesh position={[0, h * 0.88, 0]} castShadow>
        <boxGeometry args={[r * 0.7, h * 0.18, r * 0.5]} />
        <meshStandardMaterial color='#1f2937' roughness={0.5} />
      </mesh>
    </group>
  )
}

// ---- Storage -----------------------------------------------------------------

function Drum({ w, h, color }: Dims) {
  const r = Math.max(w, 0.3) / 2
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 20]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.3} />
      </mesh>
      {[0.3, 0.7].map((t) => (
        <mesh key={t} position={[0, h * t, 0]}>
          <cylinderGeometry args={[r * 1.03, r * 1.03, 0.025, 20]} />
          <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
        </mesh>
      ))}
    </group>
  )
}

function CrateStack({ w, d, h, color }: Dims) {
  const levels = 3
  const lh = h / levels
  return (
    <group>
      {Array.from({ length: levels }, (_, i) => (
        <mesh
          key={i}
          position={[
            (i % 2 ? 1 : -1) * w * 0.03,
            lh * i + lh / 2,
            (i % 2 ? -1 : 1) * d * 0.03,
          ]}
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={[w * (1 - i * 0.06), lh - 0.02, d * (1 - i * 0.06)]}
          />
          <meshStandardMaterial {...surface('wood', color)} />
        </mesh>
      ))}
    </group>
  )
}

function Gaylord({ w, d, h, color }: Dims) {
  const palletH = Math.min(0.14, h * 0.15)
  const wall = 0.03
  const innerH = h - palletH
  return (
    <group>
      <mesh position={[0, palletH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, palletH, d]} />
        <meshStandardMaterial {...surface('wood', '#b98a52')} />
      </mesh>
      {/* open-top box walls */}
      {[
        [0, -d / 2 + wall / 2, w, wall],
        [0, d / 2 - wall / 2, w, wall],
      ].map(([x, z, bw, bd], i) => (
        <mesh
          key={i}
          position={[x as number, palletH + innerH / 2, z as number]}
          castShadow
        >
          <boxGeometry args={[bw as number, innerH, bd as number]} />
          <meshStandardMaterial color={color} roughness={0.85} metalness={0} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (w / 2 - wall / 2), palletH + innerH / 2, 0]}
          castShadow
        >
          <boxGeometry args={[wall, innerH, d]} />
          <meshStandardMaterial color={color} roughness={0.85} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}

function ToteStack({ w, d, h, color }: Dims) {
  const levels = 3
  const lh = h / levels
  return (
    <group>
      {Array.from({ length: levels }, (_, i) => (
        <mesh
          key={i}
          position={[0, lh * i + lh / 2, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[w - i * 0.01, lh - 0.015, d - i * 0.01]} />
          <meshStandardMaterial
            color={color}
            roughness={0.55}
            metalness={0.05}
          />
        </mesh>
      ))}
    </group>
  )
}

// ---- Structure ---------------------------------------------------------------

function FenceSegment({ w, d, h, color }: Dims) {
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.03), h / 2, 0]} castShadow>
          <boxGeometry args={[0.06, h, 0.06]} />
          <meshStandardMaterial {...surface('metal', color)} />
        </mesh>
      ))}
      {/* mesh panel */}
      <mesh position={[0, h / 2 + 0.04, 0]}>
        <boxGeometry args={[w - 0.1, h - 0.12, Math.max(0.02, d * 0.5)]} />
        <meshStandardMaterial
          color={color}
          roughness={0.5}
          metalness={0.4}
          transparent
          opacity={0.45}
        />
      </mesh>
      <mesh position={[0, h - 0.04, 0]} castShadow>
        <boxGeometry args={[w, 0.05, 0.05]} />
        <meshStandardMaterial {...surface('metal', color)} />
      </mesh>
    </group>
  )
}

function GateSegment({ w, d, h, color }: Dims) {
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.05), h / 2, 0]} castShadow>
          <boxGeometry args={[0.1, h, 0.1]} />
          <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
        </mesh>
      ))}
      {/* sliding panel */}
      <mesh position={[0, h * 0.55, 0]} castShadow>
        <boxGeometry args={[w - 0.24, h * 0.78, Math.max(0.03, d * 0.4)]} />
        <meshStandardMaterial
          color={color}
          roughness={0.5}
          metalness={0.35}
          transparent
          opacity={0.7}
        />
      </mesh>
    </group>
  )
}

function Bollard({ w, h, color }: Dims) {
  const r = Math.max(w, 0.12) / 2
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r, h, 14]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, h * 0.8, 0]}>
        <cylinderGeometry args={[r * 1.04, r * 1.04, h * 0.12, 14]} />
        <meshStandardMaterial color='#1f2937' roughness={0.6} />
      </mesh>
    </group>
  )
}

function GuardShack({ w, d, h, color }: Dims) {
  const wall = 0.06
  const winY = h * 0.55
  const winH = h * 0.3
  return (
    <group>
      {/* lower walls */}
      <mesh position={[0, winY / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, winY, d]} />
        <meshStandardMaterial {...surface('drywall', color)} />
      </mesh>
      {/* window band */}
      <mesh position={[0, winY + winH / 2, 0]}>
        <boxGeometry args={[w - wall, winH, d - wall]} />
        <meshStandardMaterial {...MATERIAL_PROPS.glass} />
      </mesh>
      {/* corner posts through the band */}
      {[
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh
          key={i}
          position={[
            sx * (w / 2 - wall / 2),
            winY + winH / 2,
            sz * (d / 2 - wall / 2),
          ]}
          castShadow
        >
          <boxGeometry args={[wall, winH, wall]} />
          <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
        </mesh>
      ))}
      {/* roof */}
      <mesh position={[0, winY + winH + (h - winY - winH) / 2, 0]} castShadow>
        <boxGeometry args={[w + 0.12, h - winY - winH, d + 0.12]} />
        <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
      </mesh>
    </group>
  )
}

function SafetyCone({ w, h }: Dims) {
  const r = Math.max(w, 0.2) / 2
  return (
    <group>
      <mesh position={[0, 0.015, 0]} castShadow>
        <boxGeometry args={[r * 2, 0.03, r * 2]} />
        <meshStandardMaterial color='#ea580c' roughness={0.6} />
      </mesh>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.012, r * 0.75, h - 0.03, 14]} />
        <meshStandardMaterial color='#f97316' roughness={0.55} />
      </mesh>
      <mesh position={[0, h * 0.55, 0]}>
        <cylinderGeometry args={[r * 0.45, r * 0.52, h * 0.14, 14]} />
        <meshStandardMaterial color='#ffffff' roughness={0.45} />
      </mesh>
    </group>
  )
}

// ---- Decor -------------------------------------------------------------------

function Tree({ w, h, color }: Dims) {
  const trunkH = h * 0.3
  const r = Math.max(w, 0.4) / 2
  return (
    <group>
      <mesh position={[0, trunkH / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.12, r * 0.16, trunkH, 10]} />
        <meshStandardMaterial color='#7c5a3c' roughness={0.85} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[0, trunkH + (h - trunkH) * (0.2 + i * 0.28), 0]}
          castShadow
        >
          <coneGeometry args={[r * (1 - i * 0.25), (h - trunkH) * 0.45, 12]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

// ---- Facility & dock extras ---------------------------------------------------

function SemiTrailer({ w, d, h, color }: Dims) {
  const floorY = 1.2
  const boxH = h - floorY
  return (
    <group>
      {/* van box */}
      <mesh position={[0, floorY + boxH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, boxH, d]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.35} />
      </mesh>
      {/* rear door seam + lock bars (rear = -x, toward the dock) */}
      {[-d * 0.22, 0, d * 0.22].map((z, i) => (
        <mesh key={i} position={[-w / 2 - 0.012, floorY + boxH / 2, z]}>
          <boxGeometry args={[0.02, boxH * 0.94, 0.05]} />
          <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
        </mesh>
      ))}
      {/* chassis rail + rear underride bar */}
      <mesh position={[0, floorY - 0.12, 0]} castShadow>
        <boxGeometry args={[w * 0.96, 0.2, d * 0.5]} />
        <meshStandardMaterial color='#2b313a' roughness={0.8} metalness={0.2} />
      </mesh>
      <mesh position={[-w / 2 + 0.06, 0.45, 0]} castShadow>
        <boxGeometry args={[0.08, 0.08, d * 0.9]} />
        <meshStandardMaterial color='#2b313a' roughness={0.7} metalness={0.3} />
      </mesh>
      {/* tandem axles at the rear third + landing gear up front */}
      {[w * -0.28, w * -0.18].map((x, i) => (
        <group key={i}>
          {[-d / 2 + 0.12, d / 2 - 0.12].map((z, j) => (
            <mesh
              key={j}
              position={[x, 0.5, z]}
              rotation={[Math.PI / 2, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[0.5, 0.5, 0.24, 18]} />
              <meshStandardMaterial color='#16191e' roughness={0.95} />
            </mesh>
          ))}
        </group>
      ))}
      {[-d * 0.3, d * 0.3].map((z, i) => (
        <mesh key={i} position={[w * 0.3, (floorY - 0.2) / 2, z]} castShadow>
          <boxGeometry args={[0.08, floorY - 0.2, 0.08]} />
          <meshStandardMaterial {...surface('metal', PALETTE.metal)} />
        </mesh>
      ))}
    </group>
  )
}

function ShippingContainer({ w, d, h, color }: Dims) {
  const ribs = Math.max(4, Math.floor(w / 0.6))
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.4} />
      </mesh>
      {/* corrugation hint: vertical ribs along both long sides */}
      {Array.from({ length: ribs }, (_, i) => {
        const x = -w / 2 + ((i + 0.5) * w) / ribs
        return (
          <group key={i}>
            <mesh position={[x, h / 2, d / 2 + 0.012]}>
              <boxGeometry args={[0.08, h * 0.92, 0.02]} />
              <meshStandardMaterial
                color={color}
                roughness={0.65}
                metalness={0.45}
              />
            </mesh>
            <mesh position={[x, h / 2, -d / 2 - 0.012]}>
              <boxGeometry args={[0.08, h * 0.92, 0.02]} />
              <meshStandardMaterial
                color={color}
                roughness={0.65}
                metalness={0.45}
              />
            </mesh>
          </group>
        )
      })}
      {/* door lock rods on one end */}
      {[-d * 0.25, -d * 0.08, d * 0.08, d * 0.25].map((z, i) => (
        <mesh key={i} position={[w / 2 + 0.015, h / 2, z]}>
          <cylinderGeometry args={[0.025, 0.025, h * 0.9, 8]} />
          <meshStandardMaterial {...surface('metal', '#9aa3ad')} />
        </mesh>
      ))}
    </group>
  )
}

function Dumpster({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h * 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h * 0.82, d]} />
        <meshStandardMaterial color={color} roughness={0.75} metalness={0.25} />
      </mesh>
      {/* sloped lid */}
      <mesh
        position={[0, h * 0.9, -d * 0.05]}
        rotation={[Math.PI / 14, 0, 0]}
        castShadow
      >
        <boxGeometry args={[w * 0.98, 0.05, d * 1.02]} />
        <meshStandardMaterial color='#1f2937' roughness={0.85} />
      </mesh>
      {/* front lift pocket bar */}
      <mesh position={[0, h * 0.3, d / 2 + 0.02]}>
        <boxGeometry args={[w * 0.9, 0.12, 0.04]} />
        <meshStandardMaterial {...surface('metal', '#374151')} />
      </mesh>
    </group>
  )
}

function IbcTote({ w, d, h, color }: Dims) {
  const palletH = 0.12
  return (
    <group>
      <mesh position={[0, palletH / 2, 0]} castShadow>
        <boxGeometry args={[w, palletH, d]} />
        <meshStandardMaterial {...surface('metal', '#7d8794')} />
      </mesh>
      {/* translucent tank */}
      <mesh position={[0, palletH + (h - palletH) / 2 - 0.02, 0]} castShadow>
        <boxGeometry args={[w * 0.92, h - palletH - 0.06, d * 0.92]} />
        <meshStandardMaterial
          color={color}
          roughness={0.35}
          metalness={0}
          transparent
          opacity={0.85}
        />
      </mesh>
      {/* cage lattice */}
      {[0.3, 0.55, 0.8].map((t, i) => (
        <mesh key={i} position={[0, h * t, 0]}>
          <boxGeometry args={[w + 0.015, 0.035, d + 0.015]} />
          <meshStandardMaterial {...surface('metal', '#9aa3ad')} />
        </mesh>
      ))}
      {[
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [-w / 2, d / 2],
        [w / 2, d / 2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, h / 2, z]}>
          <boxGeometry args={[0.04, h * 0.9, 0.04]} />
          <meshStandardMaterial {...surface('metal', '#9aa3ad')} />
        </mesh>
      ))}
      {/* cap */}
      <mesh position={[0, h - 0.015, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.05, 12]} />
        <meshStandardMaterial color='#dc2626' roughness={0.5} />
      </mesh>
    </group>
  )
}

function FloorScrubber({ w, d, h, color }: Dims) {
  return (
    <group>
      {/* brush deck + body */}
      <mesh position={[-w * 0.1, h * 0.18, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.74, h * 0.32, d * 0.94]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.15} />
      </mesh>
      <mesh position={[w * 0.18, h * 0.42, 0]} castShadow>
        <boxGeometry args={[w * 0.34, h * 0.4, d * 0.8]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.15} />
      </mesh>
      {/* seat + steering column */}
      <mesh position={[w * 0.16, h * 0.7, 0]} castShadow>
        <boxGeometry args={[w * 0.18, h * 0.14, d * 0.42]} />
        <meshStandardMaterial color='#1f2937' roughness={0.9} />
      </mesh>
      <mesh
        position={[-w * 0.08, h * 0.62, 0]}
        rotation={[0, 0, Math.PI / 8]}
        castShadow
      >
        <cylinderGeometry args={[0.025, 0.025, h * 0.36, 8]} />
        <meshStandardMaterial {...surface('metal', '#4b5563')} />
      </mesh>
      {/* rear squeegee */}
      <mesh position={[w * 0.42, 0.045, 0]}>
        <boxGeometry args={[0.06, 0.07, d * 1.04]} />
        <meshStandardMaterial color='#111827' roughness={0.95} />
      </mesh>
      {[-d / 2 + 0.08, d / 2 - 0.08].map((z, i) => (
        <mesh
          key={i}
          position={[w * 0.22, 0.1, z]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.1, 0.1, 0.07, 14]} />
          <meshStandardMaterial color='#16191e' roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function Baler({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h * 0.46, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h * 0.92, d]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.35} />
      </mesh>
      {/* ram housing on top */}
      <mesh position={[0, h * 0.97, 0]} castShadow>
        <boxGeometry args={[w * 0.6, h * 0.1, d * 0.7]} />
        <meshStandardMaterial color='#1f2937' roughness={0.6} metalness={0.4} />
      </mesh>
      {/* feed slot + control box */}
      <mesh position={[0, h * 0.55, d / 2 + 0.012]}>
        <boxGeometry args={[w * 0.7, h * 0.16, 0.02]} />
        <meshStandardMaterial color='#0b0f14' roughness={0.9} />
      </mesh>
      <mesh position={[w / 2 + 0.04, h * 0.6, 0]} castShadow>
        <boxGeometry args={[0.08, 0.26, 0.2]} />
        <meshStandardMaterial color='#facc15' roughness={0.55} />
      </mesh>
    </group>
  )
}

function AirCompressor({ w, d, h, color }: Dims) {
  const tankR = Math.min(d * 0.42, h * 0.34)
  return (
    <group>
      {/* horizontal receiver tank */}
      <mesh
        position={[0, tankR + 0.18, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[tankR, tankR, w * 0.9, 18]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} />
      </mesh>
      {/* motor + pump on top */}
      <mesh position={[-w * 0.12, tankR * 2 + 0.28, 0]} castShadow>
        <boxGeometry args={[w * 0.34, h * 0.26, d * 0.55]} />
        <meshStandardMaterial color='#1f2937' roughness={0.6} metalness={0.3} />
      </mesh>
      {[-w * 0.32, w * 0.32].map((x, i) => (
        <mesh key={i} position={[x, 0.09, 0]} castShadow>
          <boxGeometry args={[0.07, 0.18, d * 0.8]} />
          <meshStandardMaterial {...surface('metal', '#4b5563')} />
        </mesh>
      ))}
    </group>
  )
}

function BatteryRack({ w, d, h, color }: Dims) {
  const cells = Math.max(2, Math.floor(w / 0.85))
  return (
    <group>
      {/* steel frame */}
      {[0.06, h * 0.5, h - 0.04].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} castShadow>
          <boxGeometry args={[w, 0.06, d]} />
          <meshStandardMaterial {...surface('metal', '#6b7280')} />
        </mesh>
      ))}
      {Array.from({ length: cells + 1 }, (_, i) => (
        <mesh
          key={i}
          position={[-w / 2 + (i * w) / cells, h / 2, 0]}
          castShadow
        >
          <boxGeometry args={[0.05, h, 0.05]} />
          <meshStandardMaterial {...surface('metal', '#6b7280')} />
        </mesh>
      ))}
      {/* battery boxes on both tiers + charger lights */}
      {Array.from({ length: cells }, (_, i) => {
        const x = -w / 2 + ((i + 0.5) * w) / cells
        return [0.1, h * 0.54].map((y, t) => (
          <group key={`${i}-${t}`}>
            <mesh position={[x, y + h * 0.16, 0]} castShadow>
              <boxGeometry args={[w / cells - 0.12, h * 0.3, d * 0.8]} />
              <meshStandardMaterial
                color={color}
                roughness={0.6}
                metalness={0.3}
              />
            </mesh>
            <mesh position={[x, y + h * 0.3, d / 2 - 0.01]}>
              <boxGeometry args={[0.05, 0.02, 0.02]} />
              <meshStandardMaterial
                color='#22c55e'
                emissive='#22c55e'
                emissiveIntensity={0.8}
              />
            </mesh>
          </group>
        ))
      })}
    </group>
  )
}

function PropaneCage({ w, d, h, color }: Dims) {
  const tanks = Math.max(2, Math.floor(w / 0.4))
  return (
    <group>
      {/* cage lattice */}
      {[
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [-w / 2, d / 2],
        [w / 2, d / 2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, h / 2, z]} castShadow>
          <boxGeometry args={[0.04, h, 0.04]} />
          <meshStandardMaterial
            color={color}
            roughness={0.55}
            metalness={0.35}
          />
        </mesh>
      ))}
      {[0.25, 0.6, 0.95].map((t, i) => (
        <group key={i}>
          <mesh position={[0, h * t, d / 2]}>
            <boxGeometry args={[w, 0.035, 0.035]} />
            <meshStandardMaterial
              color={color}
              roughness={0.55}
              metalness={0.35}
            />
          </mesh>
          <mesh position={[0, h * t, -d / 2]}>
            <boxGeometry args={[w, 0.035, 0.035]} />
            <meshStandardMaterial
              color={color}
              roughness={0.55}
              metalness={0.35}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[0, h + 0.01, 0]} castShadow>
        <boxGeometry args={[w + 0.05, 0.03, d + 0.05]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.35} />
      </mesh>
      {/* LP tanks inside */}
      {Array.from({ length: tanks }, (_, i) => {
        const x = -w / 2 + ((i + 0.5) * w) / tanks
        return (
          <mesh key={i} position={[x, 0.3, 0]} castShadow>
            <cylinderGeometry args={[0.14, 0.14, 0.56, 12]} />
            <meshStandardMaterial
              color='#e5e7eb'
              roughness={0.45}
              metalness={0.3}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function EyewashStation({ w, d: _d, h, color }: Dims) {
  return (
    <group>
      {/* pedestal */}
      <mesh position={[0, h * 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, h * 0.8, 10]} />
        <meshStandardMaterial {...surface('metal', '#9aa3ad')} />
      </mesh>
      {/* bowl */}
      <mesh position={[0, h * 0.82, 0]} castShadow>
        <cylinderGeometry args={[w * 0.45, w * 0.3, 0.1, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>
      {/* twin nozzles */}
      {[-0.07, 0.07].map((z, i) => (
        <mesh key={i} position={[0, h * 0.86, z]}>
          <cylinderGeometry args={[0.018, 0.018, 0.05, 8]} />
          <meshStandardMaterial color='#fb923c' roughness={0.5} />
        </mesh>
      ))}
      {/* sign */}
      <mesh position={[0, h * 0.98, 0]}>
        <boxGeometry args={[0.16, 0.16, 0.01]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.25}
        />
      </mesh>
    </group>
  )
}

function DockLeveler({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.5} />
      </mesh>
      {/* hinge seam + dock-face lip */}
      <mesh position={[0, h + 0.002, -d * 0.32]}>
        <boxGeometry args={[w * 0.98, 0.006, 0.03]} />
        <meshStandardMaterial color='#374151' roughness={0.7} />
      </mesh>
      {/* dock bumpers on the trailer side */}
      {[-w * 0.42, w * 0.42].map((x, i) => (
        <mesh key={i} position={[x, h + 0.18, -d / 2 + 0.06]} castShadow>
          <boxGeometry args={[0.3, 0.3, 0.11]} />
          <meshStandardMaterial color='#111827' roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function MirrorDome({ w, d, h, color }: Dims) {
  return (
    <group>
      <mesh position={[0, h * 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.04, h * 0.9, 10]} />
        <meshStandardMaterial {...surface('metal', '#6b7280')} />
      </mesh>
      {/* orange back shell + convex mirror face, angled down */}
      <group position={[0, h * 0.92, d * 0.1]} rotation={[Math.PI / 7, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[w / 2, w / 2, 0.05, 20]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.05, 0]}>
          <sphereGeometry
            args={[w / 2 - 0.03, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.6]}
          />
          <meshStandardMaterial
            color='#dbe7f2'
            roughness={0.05}
            metalness={0.9}
          />
        </mesh>
      </group>
    </group>
  )
}

const EXTRA_RECIPES: Partial<Record<SceneObjectKind, (d: Dims) => ReactNode>> =
  {
    semi_trailer: SemiTrailer,
    shipping_container: ShippingContainer,
    dumpster: Dumpster,
    ibc_tote: IbcTote,
    floor_scrubber: FloorScrubber,
    baler: Baler,
    air_compressor: AirCompressor,
    battery_rack: BatteryRack,
    propane_cage: PropaneCage,
    eyewash_station: EyewashStation,
    dock_leveler: DockLeveler,
    mirror_dome: MirrorDome,
    chair: Chair,
    sofa: Sofa,
    locker: Locker,
    shelf_unit: ShelfUnit,
    counter: Counter,
    partition: Partition,
    whiteboard: Whiteboard,
    pallet_jack: PalletJack,
    hand_truck: HandTruck,
    agv_robot: AgvRobot,
    scissor_lift: ScissorLift,
    ladder: Ladder,
    floor_scale: FloorScale,
    stretch_wrapper: StretchWrapper,
    trash_bin: TrashBin,
    fan: FanUnit,
    fire_extinguisher: FireExtinguisher,
    drum: Drum,
    crate_stack: CrateStack,
    gaylord: Gaylord,
    tote_stack: ToteStack,
    fence: FenceSegment,
    gate: GateSegment,
    bollard: Bollard,
    guard_shack: GuardShack,
    cone: SafetyCone,
    tree: Tree,
  }

// Created and developed by Jai Singh
