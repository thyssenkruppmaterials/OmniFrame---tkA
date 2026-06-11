// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// recipes-vehicles — brand-spec parametric forklift fleet.
// ---------------------------------------------------------------------------
// High-fidelity material-handling trucks modelled from published real-world
// dimensions and silhouettes (Raymond 7500 Universal Stance reach truck,
// Raymond 9800 Swing-Reach turret truck, Crown SP 3500 order picker, Crown
// RC 5500 stand-up counterbalance, Crown PE rider pallet truck) with their
// signature colourways — Raymond red / black masts, Crown beige / black.
// Same contract as every recipe module: meters, floor at y=0, centered on
// x/z, forks point toward -x. The per-object colour override recolours the
// body panels; masts, tires, and forks keep their industrial finish.
import type { ReactNode } from 'react'
import type { SceneObjectKind } from '../../types'

interface Dims {
  w: number
  d: number
  h: number
  color: string
}

// Signature fleet colours live in the catalog entries (#c2342c Raymond red,
// #d6c9a3 Crown beige) — only components may be exported from recipe modules
// (react-refresh).
const STEEL_BLACK = '#23272e'
const FORK_STEEL = '#3c434d'
const TIRE = '#1b1f25'
const GUARD = '#2e343d'

const bodyMat = (color: string) => (
  <meshStandardMaterial color={color} roughness={0.42} metalness={0.25} />
)
const mastMat = (
  <meshStandardMaterial color={STEEL_BLACK} roughness={0.5} metalness={0.6} />
)
const forkMat = (
  <meshStandardMaterial color={FORK_STEEL} roughness={0.4} metalness={0.7} />
)
const tireMat = (
  <meshStandardMaterial color={TIRE} roughness={0.95} metalness={0} />
)
const guardMat = (
  <meshStandardMaterial color={GUARD} roughness={0.55} metalness={0.5} />
)

/** Solid cushion tire, axis along Z. */
function Wheel({
  x,
  z,
  r,
  w = 0.09,
  y,
}: {
  x: number
  z: number
  r: number
  w?: number
  y?: number
}) {
  return (
    <mesh position={[x, y ?? r, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[r, r, w, 18]} />
      {tireMat}
    </mesh>
  )
}

/** Two-stage upright: a pair of vertical channels + cross ties. */
function Mast({
  x,
  d,
  h,
  stages = 2,
}: {
  x: number
  d: number
  h: number
  stages?: number
}) {
  const railGap = d * 0.42
  return (
    <group position={[x, 0, 0]}>
      {[-railGap, railGap].map((z, i) => (
        <group key={i}>
          {Array.from({ length: stages }, (_, s) => (
            <mesh
              key={s}
              position={[s * 0.05, h / 2 + s * 0.02, z + (s % 2 ? 0.035 : 0)]}
              castShadow
            >
              <boxGeometry args={[0.06, h - s * 0.12, 0.07]} />
              {mastMat}
            </mesh>
          ))}
        </group>
      ))}
      {[0.18, 0.55, 0.88].map((t, i) => (
        <mesh key={i} position={[0.02, h * t, 0]} castShadow>
          <boxGeometry args={[0.05, 0.06, railGap * 2]} />
          {mastMat}
        </mesh>
      ))}
    </group>
  )
}

/** Fork pair pointing -x: vertical shanks on a carriage + horizontal blades. */
function Forks({
  x,
  y,
  len,
  spread,
  carriageW,
}: {
  x: number
  y: number
  len: number
  spread: number
  carriageW: number
}) {
  return (
    <group position={[x, y, 0]}>
      {/* carriage plate */}
      <mesh position={[0.05, 0.18, 0]} castShadow>
        <boxGeometry args={[0.05, 0.4, carriageW]} />
        {forkMat}
      </mesh>
      {[-spread / 2, spread / 2].map((z, i) => (
        <group key={i}>
          <mesh position={[-len / 2, 0.025, z]} castShadow>
            <boxGeometry args={[len, 0.045, 0.1]} />
            {forkMat}
          </mesh>
          <mesh position={[0.02, 0.2, z]} castShadow>
            <boxGeometry args={[0.05, 0.36, 0.1]} />
            {forkMat}
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Overhead guard: four posts + slatted roof. */
function OverheadGuard({
  x,
  z = 0,
  w,
  d,
  yBase,
  yTop,
}: {
  x: number
  z?: number
  w: number
  d: number
  yBase: number
  yTop: number
}) {
  const legH = yTop - yBase
  return (
    <group position={[x, 0, z]}>
      {[
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [-w / 2, d / 2],
        [w / 2, d / 2],
      ].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, yBase + legH / 2, lz]} castShadow>
          <boxGeometry args={[0.05, legH, 0.05]} />
          {guardMat}
        </mesh>
      ))}
      {[0.3, 0, -0.3].map((t, i) => (
        <mesh key={i} position={[t * w * 0.8, yTop, 0]} castShadow>
          <boxGeometry args={[0.07, 0.03, d]} />
          {guardMat}
        </mesh>
      ))}
      <mesh position={[0, yTop + 0.02, 0]}>
        <boxGeometry args={[w, 0.02, d]} />
        {guardMat}
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Raymond 7500 Universal Stance — stand-up narrow-aisle reach truck.
// Real proportions: ~48" wide chassis, ~54" head length + baselegs straddling
// the load, mast riding between the outriggers, side-stance operator bay.
// ---------------------------------------------------------------------------
function ReachTruck({ w, d, h, color }: Dims) {
  const headLen = w * 0.42
  const headX = w / 2 - headLen / 2
  const bodyH = h * 0.5
  const legLen = w - headLen
  const legH = 0.16
  return (
    <group>
      {/* power-unit head */}
      <mesh position={[headX, bodyH / 2 + 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[headLen, bodyH, d]} />
        {bodyMat(color)}
      </mesh>
      {/* operator side-stance bay (open compartment cut into the head) */}
      <mesh position={[headX - headLen * 0.18, bodyH + 0.12, d * 0.18]}>
        <boxGeometry args={[headLen * 0.5, 0.24, d * 0.5]} />
        <meshStandardMaterial
          color={STEEL_BLACK}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>
      <OverheadGuard
        x={headX}
        w={headLen * 0.92}
        d={d * 0.94}
        yBase={bodyH}
        yTop={h * 0.96}
      />
      {/* straddle baselegs (outriggers) with front load wheels */}
      {[-d / 2 + 0.08, d / 2 - 0.08].map((z, i) => (
        <group key={i}>
          <mesh position={[-w / 2 + legLen / 2, legH / 2 + 0.03, z]} castShadow>
            <boxGeometry args={[legLen, legH, 0.14]} />
            {bodyMat(color)}
          </mesh>
          <Wheel x={-w / 2 + 0.12} z={z} r={0.085} />
        </group>
      ))}
      <Wheel x={headX} z={0} r={0.16} w={0.14} />
      {/* mast between the baselegs + pantograph reach hint */}
      <Mast x={-w * 0.08} d={d * 0.8} h={h * 0.92} stages={2} />
      <mesh
        position={[w * 0.04, h * 0.3, 0]}
        rotation={[0, 0, Math.PI / 5]}
        castShadow
      >
        <boxGeometry args={[0.5, 0.04, d * 0.5]} />
        {mastMat}
      </mesh>
      <Forks
        x={-w * 0.16}
        y={0.06}
        len={w * 0.36}
        spread={d * 0.5}
        carriageW={d * 0.74}
      />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Crown SP 3500 — man-up order picker. ~42" wide, long chassis, elevating
// operator platform with side gates riding the mast, forks behind the platform.
// ---------------------------------------------------------------------------
function OrderPicker({ w, d, h, color }: Dims) {
  const bodyLen = w * 0.46
  const bodyX = w / 2 - bodyLen / 2
  const bodyH = h * 0.42
  const platX = -w * 0.1
  const platLen = w * 0.34
  return (
    <group>
      {/* power unit */}
      <mesh position={[bodyX, bodyH / 2 + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[bodyLen, bodyH, d]} />
        {bodyMat(color)}
      </mesh>
      <mesh position={[bodyX + bodyLen * 0.2, bodyH + 0.1, 0]} castShadow>
        <boxGeometry args={[bodyLen * 0.5, 0.2, d * 0.9]} />
        {bodyMat(color)}
      </mesh>
      <Wheel x={bodyX} z={0} r={0.14} w={0.12} />
      {[-d / 2 + 0.07, d / 2 - 0.07].map((z, i) => (
        <Wheel key={i} x={-w / 2 + 0.1} z={z} r={0.07} />
      ))}
      {/* mast */}
      <Mast
        x={bodyX - bodyLen / 2 - 0.06}
        d={d * 0.86}
        h={h * 0.96}
        stages={3}
      />
      {/* elevating operator platform: floor + side rails + console */}
      <group position={[platX, 0.18, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[platLen, 0.05, d * 0.96]} />
          {bodyMat(color)}
        </mesh>
        {[-d / 2 + 0.04, d / 2 - 0.04].map((z, i) => (
          <mesh key={i} position={[0, 0.5, z * 0.96]} castShadow>
            <boxGeometry args={[platLen, 0.9, 0.04]} />
            <meshStandardMaterial
              color={GUARD}
              roughness={0.6}
              metalness={0.4}
              transparent
              opacity={0.85}
            />
          </mesh>
        ))}
        {/* control console */}
        <mesh position={[platLen / 2 - 0.08, 0.62, 0]} castShadow>
          <boxGeometry args={[0.14, 0.3, d * 0.5]} />
          <meshStandardMaterial
            color={STEEL_BLACK}
            roughness={0.6}
            metalness={0.2}
          />
        </mesh>
      </group>
      {/* guard cage above the platform */}
      <OverheadGuard
        x={platX}
        w={platLen}
        d={d * 0.9}
        yBase={h * 0.62}
        yTop={h * 0.78}
      />
      <Forks
        x={-w * 0.3}
        y={0.16}
        len={w * 0.2}
        spread={d * 0.46}
        carriageW={d * 0.6}
      />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Crown RC 5500 — stand-up counterbalance. Compact ~68" chassis, side-stance
// entry bay, full-height integrated guard, no outriggers (counterweighted).
// ---------------------------------------------------------------------------
function StandUpForklift({ w, d, h, color }: Dims) {
  const bodyH = h * 0.42
  return (
    <group>
      {/* chassis with rounded counterweight tail */}
      <mesh position={[w * 0.06, bodyH / 2 + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.78, bodyH, d]} />
        {bodyMat(color)}
      </mesh>
      <mesh position={[w / 2 - 0.1, bodyH / 2 + 0.05, 0]} castShadow>
        <cylinderGeometry
          args={[d / 2, d / 2, bodyH, 20, 1, false, -Math.PI / 2, Math.PI]}
        />
        {bodyMat(color)}
      </mesh>
      {/* black bumper band */}
      <mesh position={[w * 0.1, 0.1, 0]}>
        <boxGeometry args={[w * 0.82, 0.12, d + 0.02]} />
        <meshStandardMaterial
          color={STEEL_BLACK}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>
      {/* operator bay floor (side entry) */}
      <mesh position={[w * 0.12, bodyH + 0.08, 0]}>
        <boxGeometry args={[w * 0.36, 0.16, d * 0.7]} />
        <meshStandardMaterial
          color={STEEL_BLACK}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>
      <OverheadGuard
        x={w * 0.08}
        w={w * 0.6}
        d={d * 0.92}
        yBase={bodyH}
        yTop={h * 0.97}
      />
      <Wheel x={w * 0.28} z={-d / 2 + 0.1} r={0.13} />
      <Wheel x={w * 0.28} z={d / 2 - 0.1} r={0.13} />
      <Wheel x={-w * 0.3} z={0} r={0.13} w={0.14} />
      <Mast x={-w / 2 + 0.1} d={d * 0.8} h={h * 0.9} stages={2} />
      <Forks
        x={-w / 2 + 0.02}
        y={0.05}
        len={w * 0.52}
        spread={d * 0.45}
        carriageW={d * 0.7}
      />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Raymond 9800 Swing-Reach — very-narrow-aisle turret truck. ~60" wide, long
// chassis, towering mast, man-up cab, swing turret carriage (forks traverse
// sideways into the racking).
// ---------------------------------------------------------------------------
function TurretTruck({ w, d, h, color }: Dims) {
  const bodyLen = w * 0.5
  const bodyX = w / 2 - bodyLen / 2
  const bodyH = h * 0.22
  const cabY = h * 0.34
  return (
    <group>
      {/* chassis */}
      <mesh position={[bodyX, bodyH / 2 + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[bodyLen, bodyH, d]} />
        {bodyMat(color)}
      </mesh>
      <mesh position={[-w * 0.18, 0.14, 0]} castShadow>
        <boxGeometry args={[w * 0.6, 0.22, d * 0.82]} />
        {bodyMat(color)}
      </mesh>
      <Wheel x={bodyX + bodyLen * 0.25} z={0} r={0.17} w={0.16} />
      {[-d / 2 + 0.1, d / 2 - 0.1].map((z, i) => (
        <Wheel key={i} x={-w / 2 + 0.16} z={z} r={0.12} />
      ))}
      {/* towering main mast */}
      <Mast x={-w * 0.04} d={d * 0.7} h={h * 0.98} stages={3} />
      {/* man-up operator cab riding the mast */}
      <group position={[-w * 0.04, cabY, 0]}>
        <mesh castShadow>
          <boxGeometry args={[w * 0.26, h * 0.2, d * 0.84]} />
          {bodyMat(color)}
        </mesh>
        <mesh position={[-w * 0.135, h * 0.03, 0]}>
          <boxGeometry args={[0.02, h * 0.12, d * 0.6]} />
          <meshStandardMaterial
            color='#bcd7e6'
            roughness={0.08}
            metalness={0.1}
            transparent
            opacity={0.45}
          />
        </mesh>
        <OverheadGuard
          x={0}
          w={w * 0.26}
          d={d * 0.8}
          yBase={h * 0.1}
          yTop={h * 0.16}
        />
      </group>
      {/* swing turret below the cab: forks traverse SIDEWAYS (+z) */}
      <group
        position={[-w * 0.26, cabY - h * 0.06, 0]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <mesh position={[0, 0.1, 0]} castShadow>
          <boxGeometry args={[0.3, 0.3, 0.3]} />
          {forkMat}
        </mesh>
        <Forks
          x={-0.14}
          y={0}
          len={w * 0.26}
          spread={d * 0.4}
          carriageW={d * 0.55}
        />
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Crown PE — end-control rider pallet truck. Motor head + side operator
// platform, long low forks with load wheels.
// ---------------------------------------------------------------------------
function RiderPalletTruck({ w, d, h, color }: Dims) {
  const headLen = w * 0.36
  const headX = w / 2 - headLen / 2
  const forkLen = w - headLen - 0.05
  return (
    <group>
      {/* motor head */}
      <mesh position={[headX, h * 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[headLen, h * 0.76, d * 0.9]} />
        {bodyMat(color)}
      </mesh>
      <mesh position={[headX, h * 0.84, 0]} castShadow>
        <boxGeometry args={[headLen * 0.7, h * 0.1, d * 0.6]} />
        <meshStandardMaterial
          color={STEEL_BLACK}
          roughness={0.6}
          metalness={0.2}
        />
      </mesh>
      {/* operator platform + backrest pad */}
      <mesh position={[headX - headLen * 0.78, 0.12, 0]} castShadow>
        <boxGeometry args={[headLen * 0.55, 0.06, d * 0.86]} />
        <meshStandardMaterial
          color={STEEL_BLACK}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>
      <Wheel x={headX} z={0} r={0.12} w={0.12} />
      {/* low fork pair with load-wheel bogies */}
      {[-d * 0.26, d * 0.26].map((z, i) => (
        <group key={i}>
          <mesh position={[-w / 2 + forkLen / 2, 0.12, z]} castShadow>
            <boxGeometry args={[forkLen, 0.07, d * 0.3]} />
            {bodyMat(color)}
          </mesh>
          <Wheel x={-w / 2 + 0.15} z={z} r={0.05} w={0.07} />
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Walkie stacker — pedestrian straddle stacker with tiller arm.
// ---------------------------------------------------------------------------
function WalkieStacker({ w, d, h, color }: Dims) {
  const headLen = w * 0.4
  const headX = w / 2 - headLen / 2
  return (
    <group>
      <mesh position={[headX, h * 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[headLen, h * 0.52, d * 0.92]} />
        {bodyMat(color)}
      </mesh>
      {/* tiller arm angled out the back */}
      <mesh
        position={[w / 2 + 0.12, h * 0.42, 0]}
        rotation={[0, 0, -Math.PI / 4]}
        castShadow
      >
        <cylinderGeometry args={[0.025, 0.025, 0.62, 10]} />
        {guardMat}
      </mesh>
      <mesh position={[w / 2 + 0.33, h * 0.56, 0]} castShadow>
        <boxGeometry args={[0.1, 0.05, 0.34]} />
        <meshStandardMaterial
          color={STEEL_BLACK}
          roughness={0.7}
          metalness={0.1}
        />
      </mesh>
      <Mast
        x={headX - headLen / 2 - 0.05}
        d={d * 0.7}
        h={h * 0.94}
        stages={2}
      />
      {[-d / 2 + 0.07, d / 2 - 0.07].map((z, i) => (
        <group key={i}>
          <mesh position={[-w * 0.12, 0.08, z]} castShadow>
            <boxGeometry args={[w * 0.66, 0.1, 0.1]} />
            {bodyMat(color)}
          </mesh>
          <Wheel key={i} x={-w / 2 + 0.1} z={z} r={0.05} />
        </group>
      ))}
      <Wheel x={headX} z={0} r={0.1} />
      <Forks
        x={-w * 0.14}
        y={0.18}
        len={w * 0.34}
        spread={d * 0.42}
        carriageW={d * 0.58}
      />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Tow tugger — seated tow tractor with rear hitch for cart trains.
// ---------------------------------------------------------------------------
function Tugger({ w, d, h, color }: Dims) {
  return (
    <group>
      {/* hood + body */}
      <mesh position={[-w * 0.18, h * 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.55, h * 0.5, d * 0.94]} />
        {bodyMat(color)}
      </mesh>
      <mesh position={[w * 0.16, h * 0.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.4, h * 0.34, d * 0.94]} />
        {bodyMat(color)}
      </mesh>
      {/* seat + console */}
      <mesh position={[w * 0.12, h * 0.5, 0]} castShadow>
        <boxGeometry args={[w * 0.2, h * 0.22, d * 0.5]} />
        <meshStandardMaterial
          color={STEEL_BLACK}
          roughness={0.85}
          metalness={0}
        />
      </mesh>
      <mesh position={[-w * 0.12, h * 0.62, 0]} castShadow>
        <boxGeometry args={[0.05, h * 0.26, 0.05]} />
        {guardMat}
      </mesh>
      <mesh
        position={[-w * 0.16, h * 0.76, 0]}
        rotation={[0, 0, Math.PI / 7]}
        castShadow
      >
        <cylinderGeometry args={[0.11, 0.11, 0.03, 16]} />
        <meshStandardMaterial
          color={STEEL_BLACK}
          roughness={0.6}
          metalness={0.2}
        />
      </mesh>
      {/* rear hitch plate */}
      <mesh position={[w / 2 - 0.04, h * 0.16, 0]} castShadow>
        <boxGeometry args={[0.08, 0.1, 0.16]} />
        {forkMat}
      </mesh>
      <Wheel x={-w * 0.3} z={-d / 2 + 0.09} r={0.11} />
      <Wheel x={-w * 0.3} z={d / 2 - 0.09} r={0.11} />
      <Wheel x={w * 0.28} z={-d / 2 + 0.09} r={0.11} />
      <Wheel x={w * 0.28} z={d / 2 - 0.09} r={0.11} />
    </group>
  )
}

const VEHICLE_RECIPES: Partial<
  Record<SceneObjectKind, (d: Dims) => ReactNode>
> = {
  forklift_reach: ReachTruck,
  forklift_orderpicker: OrderPicker,
  forklift_standup: StandUpForklift,
  forklift_turret: TurretTruck,
  pallet_truck_rider: RiderPalletTruck,
  walkie_stacker: WalkieStacker,
  tugger: Tugger,
}

/** Renderer for the vehicle fleet (component export for react-refresh). */
export function VehicleObject({
  kind,
  ...dims
}: { kind: SceneObjectKind } & Dims) {
  const R = VEHICLE_RECIPES[kind]
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

// Created and developed by Jai Singh
