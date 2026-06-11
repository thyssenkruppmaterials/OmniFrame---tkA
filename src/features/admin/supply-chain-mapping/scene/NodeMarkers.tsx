// Created and developed by Jai Singh
// One marker group per supply-chain node: kind-colored base disc, a light
// pillar sized by throughput and colored by propagated risk, a soft glow
// disc, and a shader-driven radar ring for troubled nodes. Labels are DOM
// (drei Html) so they stay crisp under both WebGPU and WebGL backends.
import { useEffect, useMemo, useState } from 'react'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { Quaternion, Vector3 } from 'three/webgpu'
import type {
  MapSelection,
  NetworkAnalysis,
  NodeRisk,
  SupplyChainNetwork,
  SupplyChainNode,
} from '../data/types'
import { KIND_COLORS, RISK_COLORS, RISK_LABELS } from '../palette'
import { GLOBE_RADIUS, latLngToVector3 } from './coords'
import {
  createBeamMaterial,
  createGlowDiscMaterial,
  createPulseRingMaterial,
} from './materials'

const Z_AXIS = new Vector3(0, 0, 1)

function hashPhase(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973
  return h / 9973
}

function nodeEmphasis(
  node: SupplyChainNode,
  selection: MapSelection,
  connectedToSelectedLink: boolean
): number {
  if (!selection) return 1
  if (selection.type === 'node') return selection.id === node.id ? 1.45 : 0.25
  return connectedToSelectedLink ? 1.35 : 0.25
}

interface MarkerProps {
  node: SupplyChainNode
  risk: NodeRisk
  maxCapacity: number
  emphasis: number
  /** True when a region focus is active and this node sits outside it. */
  dimmed: boolean
  selected: boolean
  showLabel: boolean
  onSelect: (id: string) => void
}

function Marker({
  node,
  risk,
  maxCapacity,
  emphasis,
  dimmed,
  selected,
  showLabel,
  onSelect,
}: MarkerProps) {
  const [hovered, setHovered] = useState(false)

  const { position, quaternion } = useMemo(() => {
    const p = latLngToVector3(node.lat, node.lng, GLOBE_RADIUS + 0.2)
    const normal = p.clone().normalize()
    // Group's local +z points away from the planet center
    return {
      position: p,
      quaternion: new Quaternion().setFromUnitVectors(Z_AXIS, normal),
    }
  }, [node.lat, node.lng])

  const phase = useMemo(() => hashPhase(node.id), [node.id])
  const beamHeight = 3.5 + (node.capacityPerWeek / Math.max(1, maxCapacity)) * 9
  const troubled = risk === 'at_risk' || risk === 'starved'

  // Created once per marker mount (Marker is keyed by node.id); risk and
  // emphasis changes re-sync through uniform setters in the effects below.
  const [beam] = useState(() =>
    createBeamMaterial(RISK_COLORS[risk], phase * Math.PI * 2)
  )
  const [glow] = useState(() => createGlowDiscMaterial(RISK_COLORS[risk]))
  const [ring] = useState(() =>
    createPulseRingMaterial(
      RISK_COLORS[risk],
      phase,
      risk === 'starved' ? 0.9 : 0.55
    )
  )
  useEffect(
    () => () => {
      beam.material.dispose()
      glow.material.dispose()
      ring.material.dispose()
    },
    [beam, glow, ring]
  )
  useEffect(() => {
    beam.setColor(RISK_COLORS[risk])
    glow.setColor(RISK_COLORS[risk])
    ring.setColor(RISK_COLORS[risk])
  }, [beam, glow, ring, risk])
  useEffect(() => {
    // Out-of-region sites recede unless the user is interacting with them
    const base =
      dimmed && !selected && !hovered ? Math.min(emphasis, 0.15) : emphasis
    const boost = hovered ? Math.max(base, 1.45) : base
    beam.setEmphasis(boost)
    glow.setEmphasis(boost)
    const ringActive =
      (troubled || selected) && !(dimmed && !selected && !hovered)
    ring.setEmphasis(ringActive ? boost : 0)
  }, [beam, glow, ring, emphasis, dimmed, hovered, troubled, selected])

  const discEmphasis =
    dimmed && !selected && !hovered ? Math.min(emphasis, 0.15) : emphasis

  return (
    <group position={position} quaternion={quaternion}>
      {/* Base disc — what the node IS (kind color) */}
      <mesh position-z={0.25}>
        <circleGeometry args={[1.35, 24]} />
        <meshBasicMaterial
          color={KIND_COLORS[node.kind]}
          transparent
          opacity={Math.min(1, 0.95 * discEmphasis)}
          toneMapped={false}
        />
      </mesh>
      {/* Soft glow halo — how the node is DOING (risk color) */}
      <mesh position-z={0.1} material={glow.material}>
        <planeGeometry args={[8.5, 8.5]} />
      </mesh>
      {/* Radar ring — animated entirely in the shader */}
      <mesh position-z={0.35} material={ring.material}>
        <ringGeometry args={[1.6, 1.85, 48]} />
      </mesh>
      {/* Light pillar — throughput beacon */}
      <mesh
        material={beam.material}
        rotation-x={Math.PI / 2}
        position-z={beamHeight / 2}
        scale={[1, beamHeight, 1]}
      >
        <cylinderGeometry args={[0.4, 0.55, 1, 10, 1, true]} />
      </mesh>
      {/* Fat invisible hit target */}
      <mesh
        position-z={1}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          onSelect(node.id)
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[3.2, 8, 8]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} transparent />
      </mesh>
      {((showLabel && !dimmed) || hovered || selected) && (
        <Html
          center
          position={[0, 0, beamHeight + 3]}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[10, 0]}
        >
          <div className='pointer-events-none flex flex-col items-center whitespace-nowrap'>
            <span className='rounded-md border border-white/10 bg-slate-950/80 px-2 py-0.5 text-[11px] font-medium text-slate-100 shadow-lg backdrop-blur'>
              {node.name}
            </span>
            {(hovered || selected) && (
              <span
                className='mt-0.5 rounded px-1.5 text-[10px] font-semibold tracking-wide uppercase'
                style={{ color: RISK_COLORS[risk] }}
              >
                {RISK_LABELS[risk]}
              </span>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

interface NodeMarkersProps {
  network: SupplyChainNetwork
  analysis: NetworkAnalysis
  selection: MapSelection
  showLabels: boolean
  focusNodeIds: Set<string> | null
  onSelect: (selection: MapSelection) => void
}

export function NodeMarkers({
  network,
  analysis,
  selection,
  showLabels,
  focusNodeIds,
  onSelect,
}: NodeMarkersProps) {
  const maxCapacity = useMemo(
    () => Math.max(...network.nodes.map((n) => n.capacityPerWeek), 1),
    [network.nodes]
  )
  const selectedLink = useMemo(
    () =>
      selection?.type === 'link'
        ? network.links.find((l) => l.id === selection.id)
        : undefined,
    [selection, network.links]
  )

  return (
    <group>
      {network.nodes.map((node) => (
        <Marker
          key={node.id}
          node={node}
          risk={analysis.nodeRisk.get(node.id) ?? 'ok'}
          maxCapacity={maxCapacity}
          emphasis={nodeEmphasis(
            node,
            selection,
            selectedLink
              ? selectedLink.from === node.id || selectedLink.to === node.id
              : false
          )}
          dimmed={focusNodeIds ? !focusNodeIds.has(node.id) : false}
          selected={selection?.type === 'node' && selection.id === node.id}
          showLabel={showLabels}
          onSelect={(id) => onSelect({ type: 'node', id })}
        />
      ))}
    </group>
  )
}
