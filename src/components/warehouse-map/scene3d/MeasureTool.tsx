// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// MeasureTool — click two floor points to measure the distance (m + ft).
// ---------------------------------------------------------------------------
// Renders a transparent capture plane over the floor; first click sets A, second
// sets B (a third starts over). While active the caller pauses editor
// interaction so clicks land on the floor, not on objects.
import { useEffect, useState } from 'react'
import { Html, Line } from '@react-three/drei'
import { type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { SceneBounds } from './coords'

export function MeasureTool({
  active,
  bounds,
}: {
  active: boolean
  bounds: SceneBounds
}) {
  const [a, setA] = useState<THREE.Vector3 | null>(null)
  const [b, setB] = useState<THREE.Vector3 | null>(null)

  useEffect(() => {
    if (!active) {
      setA(null)
      setB(null)
    }
  }, [active])

  if (!active) return null

  const size = bounds.span * 3 + 40
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const p = e.point.clone()
    p.y = 0
    if (!a || (a && b)) {
      setA(p)
      setB(null)
    } else {
      setB(p)
    }
  }

  const dist = a && b ? a.distanceTo(b) : 0
  const mid = a && b ? a.clone().add(b).multiplyScalar(0.5) : null

  return (
    <group>
      <mesh
        position={[bounds.cx, 0.006, bounds.cz]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={handleClick}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {a && (
        <mesh position={a}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshBasicMaterial color='#0891b2' toneMapped={false} />
        </mesh>
      )}
      {b && (
        <mesh position={b}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshBasicMaterial color='#0891b2' toneMapped={false} />
        </mesh>
      )}
      {a && b && (
        <Line
          points={[a, b]}
          color='#06b6d4'
          lineWidth={2.5}
          dashed
          dashScale={4}
        />
      )}
      {mid && (
        <Html position={[mid.x, 0.4, mid.z]} center>
          <div className='pointer-events-none rounded bg-cyan-600 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow'>
            {dist.toFixed(2)} m · {(dist * 3.28084).toFixed(1)} ft
          </div>
        </Html>
      )}
    </group>
  )
}

// Created and developed by Jai Singh
