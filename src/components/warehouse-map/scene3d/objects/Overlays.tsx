// Created and developed by Jai Singh
// Aisle graph, active route, and live asset markers — refactored from the legacy
// 3D view with the soft palette. These float just above the floor plane.
import { useMemo, useRef } from 'react'
import { Line as DreiLine } from '@react-three/drei'
import * as THREE from 'three'
import type {
  AisleEdge,
  AisleNode,
  AssetPositionLatest,
  RoutePoint,
} from '../../types'
import { WORLD_SCALE } from '../scene-config'

const KIND_COLOR: Record<string, string> = {
  aisle: '#10b981',
  doorway: '#f59e0b',
  pickup: '#3b82f6',
  dock: '#a855f7',
  stair: '#f97316',
  elevator: '#06b6d4',
  manual: '#64748b',
}
const kindColor = (kind: string) => KIND_COLOR[kind] ?? '#64748b'

export function AisleGraph3D({
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
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial
            color={kindColor(n.kind)}
            emissive={kindColor(n.kind)}
            emissiveIntensity={0.35}
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
            lineWidth={1.4}
            transparent
            opacity={0.7}
          />
        )
      })}
    </group>
  )
}

export function Route3D({ points }: { points: RoutePoint[] }) {
  const linePoints = useMemo(
    () =>
      points.map(
        (p) =>
          [p.x * WORLD_SCALE, 0.16, p.y * WORLD_SCALE] as [
            number,
            number,
            number,
          ]
      ),
    [points]
  )
  if (linePoints.length < 2) return null
  return (
    <group>
      <DreiLine
        points={linePoints}
        color='#0891b2'
        lineWidth={6}
        transparent
        opacity={0.25}
      />
      <DreiLine points={linePoints} color='#06b6d4' lineWidth={2.5} />
      <mesh position={linePoints[0]}>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial
          color='#0891b2'
          emissive='#0891b2'
          emissiveIntensity={0.5}
        />
      </mesh>
      <mesh position={linePoints[linePoints.length - 1]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial
          color='#06b6d4'
          emissive='#06b6d4'
          emissiveIntensity={0.6}
        />
      </mesh>
    </group>
  )
}

export function AssetMarker3D({ pos }: { pos: AssetPositionLatest }) {
  const ref = useRef<THREE.Group>(null)
  return (
    <group
      ref={ref}
      position={[pos.x * WORLD_SCALE, 0.5, pos.y * WORLD_SCALE]}
      rotation={[0, ((pos.heading_deg ?? 0) * Math.PI) / 180, 0]}
    >
      <mesh castShadow>
        <coneGeometry args={[0.2, 0.55, 16]} />
        <meshStandardMaterial
          color='#f59e0b'
          emissive='#f59e0b'
          emissiveIntensity={0.3}
        />
      </mesh>
      <mesh position={[0.28, 0, 0]}>
        <boxGeometry args={[0.42, 0.07, 0.07]} />
        <meshStandardMaterial color='#ffffff' />
      </mesh>
    </group>
  )
}

// Created and developed by Jai Singh
