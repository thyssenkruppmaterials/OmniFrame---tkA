// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// SimulationLayer — everything the live scenario draws inside the canvas.
// ---------------------------------------------------------------------------
// Lazy-loaded (own chunk; the feature chunk sits at the 500 KB gate). The
// layer's useFrame is the scenario's clock: it advances the store engine and
// re-invalidates so the demand frameloop keeps producing frames while the
// simulation runs. Markers read agent state imperatively — none of the
// per-frame motion goes through React.
import { useEffect, useMemo, useRef } from 'react'
import { Line as DreiLine, Text as DreiText } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { WORLD_SCALE } from '../scene-config'
import { parseHeatCellKey, type SimAgent } from './sim-core'
import { HEAT_CELL_WORLD, useSimulation } from './simulation.store'

const PATH_Y = 0.18
const HEAT_Y = 0.034

/** Worker marker: capsule body + head + picking ring, driven imperatively. */
function AgentMarker({ agent }: { agent: SimAgent }) {
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    g.position.set(agent.x * WORLD_SCALE, 0, agent.y * WORLD_SCALE)
    g.rotation.y = (agent.headingDeg * Math.PI) / 180
    if (ring.current) {
      const picking = agent.state === 'picking'
      ring.current.visible = picking
      if (picking) {
        const pulse = 1 + 0.25 * Math.sin(clock.elapsedTime * 6)
        ring.current.scale.setScalar(pulse)
      }
    }
  })

  return (
    <group ref={group}>
      {/* body */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.18, 0.55, 4, 12]} />
        <meshStandardMaterial color={agent.color} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.12, 0]} castShadow>
        <sphereGeometry args={[0.14, 12, 12]} />
        <meshStandardMaterial color='#f1d3b5' />
      </mesh>
      {/* travel direction nose */}
      <mesh position={[0.26, 0.62, 0]}>
        <boxGeometry args={[0.26, 0.06, 0.06]} />
        <meshBasicMaterial color='#ffffff' />
      </mesh>
      {/* picking pulse ring */}
      <mesh ref={ring} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.46, 24]} />
        <meshBasicMaterial
          color={agent.color}
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* name tag — billboarded text reads at iso zoom */}
      <DreiText
        position={[0, 1.5, 0]}
        fontSize={0.28}
        color='#1f2a3a'
        outlineWidth={0.02}
        outlineColor='#ffffff'
        anchorX='center'
        anchorY='middle'
      >
        {agent.name}
      </DreiText>
    </group>
  )
}

/** Static tour line + stop discs for one agent. */
function AgentTour({ agent }: { agent: SimAgent }) {
  const linePoints = useMemo(
    () =>
      agent.path.points.map(
        (p) =>
          [p.x * WORLD_SCALE, PATH_Y, p.y * WORLD_SCALE] as [
            number,
            number,
            number,
          ]
      ),
    [agent.path]
  )
  if (linePoints.length < 2) return null
  return (
    <group>
      <DreiLine
        points={linePoints}
        color={agent.color}
        lineWidth={1.8}
        transparent
        opacity={0.45}
      />
      {agent.stops.map((s, i) => {
        const idx = agent.path.cum.findIndex((c) => c >= s.distance)
        const p = agent.path.points[Math.max(idx, 0)]
        return (
          <mesh
            key={`${s.bin}-${i}`}
            position={[p.x * WORLD_SCALE, 0.05, p.y * WORLD_SCALE]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.22, 16]} />
            <meshBasicMaterial color={agent.color} transparent opacity={0.55} />
          </mesh>
        )
      })}
    </group>
  )
}

/** Congestion heat — one instanced quad per visited cell, rebuilt on version. */
function CongestionHeat() {
  const version = useSimulation((s) => s.version)
  const heat = useSimulation((s) => s.heat)

  const { mesh, count } = useMemo(() => {
    void version // rebuild trigger — heat itself is mutated in place
    const entries = Array.from(heat.entries())
    if (entries.length === 0) return { mesh: null, count: 0 }
    const capped = entries.sort((a, b) => b[1] - a[1]).slice(0, 4000)
    const max = capped[0]?.[1] ?? 1
    const cell = HEAT_CELL_WORLD * WORLD_SCALE
    const geom = new THREE.PlaneGeometry(cell, cell)
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.45,
      vertexColors: true,
      depthWrite: false,
    })
    const m = new THREE.InstancedMesh(geom, mat, capped.length)
    const mtx = new THREE.Matrix4()
    const quat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0)
    )
    const color = new THREE.Color()
    const cold = new THREE.Color('#22c55e')
    const warm = new THREE.Color('#f59e0b')
    const hot = new THREE.Color('#ef4444')
    capped.forEach(([key, value], i) => {
      const { col, row } = parseHeatCellKey(key)
      mtx.compose(
        new THREE.Vector3((col + 0.5) * cell, HEAT_Y, (row + 0.5) * cell),
        quat,
        new THREE.Vector3(1, 1, 1)
      )
      m.setMatrixAt(i, mtx)
      const t = Math.min(value / max, 1)
      if (t < 0.5) color.lerpColors(cold, warm, t * 2)
      else color.lerpColors(warm, hot, (t - 0.5) * 2)
      m.setColorAt(i, color)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    return { mesh: m, count: capped.length }
  }, [version, heat])

  // Imperatively-built geometry/material must be disposed by hand — fiber only
  // auto-disposes JSX-declared resources, not <primitive> payloads.
  useEffect(
    () => () => {
      if (!mesh) return
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    },
    [mesh]
  )

  if (!mesh || count === 0) return null
  return <primitive object={mesh} />
}

export default function SimulationLayer() {
  const invalidate = useThree((s) => s.invalidate)
  const agents = useSimulation((s) => s.agents)
  const showHeat = useSimulation((s) => s.showHeat)
  // Subscribing to status matters even though it isn't rendered: with the
  // demand frameloop, the paused→running edge must commit a React update so a
  // first frame gets scheduled — useFrame then self-sustains via invalidate().
  const status = useSimulation((s) => s.status)

  // The scenario clock. Clamp dt so a background tab doesn't teleport agents.
  useFrame((_, delta) => {
    const s = useSimulation.getState()
    if (s.status !== 'running') return
    s.tick(Math.min(delta, 0.25) * s.timeScale)
    invalidate()
  })

  useEffect(() => {
    if (status === 'running') invalidate()
  }, [status, invalidate])

  return (
    <group>
      {showHeat && <CongestionHeat />}
      {agents.map((a) => (
        <AgentTour key={`tour-${a.id}`} agent={a} />
      ))}
      {agents.map((a) => (
        <AgentMarker key={a.id} agent={a} />
      ))}
    </group>
  )
}

// Created and developed by Jai Singh
