// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Warehouse 3D Scene — weather particle layer
// ---------------------------------------------------------------------------
// Renders precipitation (rain / snow) as an animated point system over the
// warehouse, drifting with the live wind vector, plus periodic thunderstorm
// light flashes. Density comes from the weather adapter; honours the quality
// preset and prefers-reduced-motion (renders nothing when motion is reduced).
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { SceneBounds } from './coords'
import type { QualitySettings } from './scene-config'
import type { SceneAtmosphere } from './use-weather-scene'

interface WeatherLayerProps {
  bounds: SceneBounds
  atmosphere: SceneAtmosphere
  quality: QualitySettings
  reducedMotion: boolean
}

export function WeatherLayer({
  bounds,
  atmosphere,
  quality,
  reducedMotion,
}: WeatherLayerProps) {
  const { precipitation, wind, thunder } = atmosphere

  if (reducedMotion) return null

  return (
    <group>
      {quality.weatherParticles && precipitation.kind !== 'none' && (
        <Precipitation
          bounds={bounds}
          kind={precipitation.kind}
          intensity={precipitation.intensity}
          wind={wind}
          maxParticles={quality.maxParticles}
        />
      )}
      {thunder && <ThunderFlash bounds={bounds} />}
    </group>
  )
}

// ---------------------------------------------------------------------------

function Precipitation({
  bounds,
  kind,
  intensity,
  wind,
  maxParticles,
}: {
  bounds: SceneBounds
  kind: 'rain' | 'snow'
  intensity: number
  wind: [number, number, number]
  maxParticles: number
}) {
  const pointsRef = useRef<THREE.Points>(null)
  const isSnow = kind === 'snow'
  // The canvas runs frameloop='demand' — an active particle system must keep
  // requesting the next frame itself.
  const invalidate = useThree((s) => s.invalidate)

  const count = Math.max(
    50,
    Math.floor(maxParticles * Math.min(1, Math.max(0.1, intensity)))
  )

  // Particle field box framed to the warehouse with headroom.
  const field = useMemo(() => {
    const w = bounds.width + 30
    const d = bounds.depth + 30
    const h = Math.max(30, bounds.span * 0.8 + 25)
    return { w, d, h, x0: bounds.cx, z0: bounds.cz }
  }, [bounds])

  const { positions, speeds } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const spd = new Float32Array(count)
    // Deterministic seeding (no Math.random in the hot path's init).
    let seed = 0x9e3779b9
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff
      return (seed >>> 0) / 0xffffffff
    }
    for (let i = 0; i < count; i++) {
      pos[i * 3] = field.x0 + (rand() - 0.5) * field.w
      pos[i * 3 + 1] = rand() * field.h
      pos[i * 3 + 2] = field.z0 + (rand() - 0.5) * field.d
      spd[i] = (isSnow ? 1.2 : 9) * (0.6 + rand() * 0.8)
    }
    return { positions: pos, speeds: spd }
  }, [count, field, isSnow])

  useFrame((_, delta) => {
    const pts = pointsRef.current
    if (!pts) return
    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    const dt = Math.min(delta, 0.05)
    for (let i = 0; i < count; i++) {
      const iy = i * 3 + 1
      arr[iy] -= speeds[i] * dt
      arr[i * 3] += wind[0] * dt * (isSnow ? 1.4 : 0.5)
      arr[i * 3 + 2] += wind[2] * dt * (isSnow ? 1.4 : 0.5)
      if (isSnow) {
        // gentle horizontal sway
        arr[i * 3] += Math.sin((arr[iy] + i) * 0.6) * dt * 0.3
      }
      if (arr[iy] < 0) {
        arr[iy] = field.h
        arr[i * 3] = field.x0 + (((i * 37) % 100) / 100 - 0.5) * field.w
        arr[i * 3 + 2] = field.z0 + (((i * 53) % 100) / 100 - 0.5) * field.d
      }
    }
    attr.needsUpdate = true
    invalidate()
  })

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach='attributes-position' args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={isSnow ? '#ffffff' : '#a9c3e0'}
        size={isSnow ? 0.18 : 0.09}
        transparent
        opacity={isSnow ? 0.9 : 0.55}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  )
}

// ---------------------------------------------------------------------------
// Periodic lightning: a high overhead light that spikes briefly on a cadence.
// ---------------------------------------------------------------------------

function ThunderFlash({ bounds }: { bounds: SceneBounds }) {
  const lightRef = useRef<THREE.PointLight>(null)
  const invalidate = useThree((s) => s.invalidate)
  useFrame(({ clock }) => {
    const light = lightRef.current
    if (!light) return
    // Two quick flashes every ~7s, derived from the clock (no randomness).
    const t = clock.elapsedTime % 7
    let v = 0
    if (t < 0.08) v = 1
    else if (t > 0.18 && t < 0.24) v = 0.7
    light.intensity = v * 40
    invalidate() // demand frameloop: keep the flash cadence ticking
  })
  return (
    <pointLight
      ref={lightRef}
      position={[bounds.cx, bounds.span + 40, bounds.cz]}
      color='#dfe7ff'
      intensity={0}
      distance={bounds.span * 6 + 200}
      decay={0.6}
    />
  )
}

// Created and developed by Jai Singh
