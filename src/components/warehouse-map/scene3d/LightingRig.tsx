// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Warehouse 3D Scene — lighting rig
// ---------------------------------------------------------------------------
// Gentle, lifelike lighting: a soft key "sun" (direction + colour from the
// weather adapter), hemisphere + ambient fill, IBL from a soft HDRI preset, and
// optional PCSS soft shadows. Sets the solid background + fog and ACES tone
// mapping so the whole scene reads soft and daylit rather than dark-industrial.
import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { Environment, Lightformer } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { SceneBounds } from './coords'
import type { QualitySettings } from './scene-config'
import { TONE_MAPPING_EXPOSURE } from './scene-config'
import type { SceneAtmosphere } from './use-weather-scene'

interface LightingRigProps {
  bounds: SceneBounds
  atmosphere: SceneAtmosphere
  quality: QualitySettings
}

/**
 * Best-effort IBL guard. The drei <Environment> preset streams an HDRI from a
 * CDN; a blocked/failed fetch must NOT take down the whole scene (which lost the
 * WebGL context before this guard existed). On error we fall back to the direct
 * sun + hemisphere + ambient lights — reflections soften, but the scene renders.
 */
class IBLBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    // Swallow: IBL is cosmetic; the lighting rig already lights the scene.
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function LightingRig({ bounds, atmosphere, quality }: LightingRigProps) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const sunRef = useRef<THREE.DirectionalLight>(null)
  const targetRef = useRef<THREE.Object3D>(null)

  // ACES tone mapping + exposure for the soft daylight palette.
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = TONE_MAPPING_EXPOSURE
  }, [gl])

  // Scale IBL contribution with the weather mood (overcast → softer).
  useEffect(() => {
    scene.environmentIntensity = atmosphere.envIntensity
    return () => {
      scene.environmentIntensity = 1
    }
  }, [scene, atmosphere.envIntensity])

  const sunDist = bounds.span * 1.5 + 30
  const sunPos: [number, number, number] = [
    bounds.cx + atmosphere.sunDir[0] * sunDist,
    atmosphere.sunDir[1] * sunDist,
    bounds.cz + atmosphere.sunDir[2] * sunDist,
  ]
  const shadowHalf = bounds.span * 0.75 + 12

  // Aim the sun at the warehouse center so the shadow camera frames the layout
  // (a directional light's target defaults to world origin, which would miss a
  // warehouse whose center is far from (0,0)).
  useEffect(() => {
    const light = sunRef.current
    const target = targetRef.current
    if (!light || !target) return
    light.target = target
    target.updateMatrixWorld()
  }, [bounds.cx, bounds.cz])

  return (
    <>
      <color attach='background' args={[atmosphere.background]} />
      <fog
        attach='fog'
        args={[atmosphere.fog.color, atmosphere.fog.near, atmosphere.fog.far]}
      />

      <ambientLight
        intensity={atmosphere.ambient.intensity}
        color={atmosphere.ambient.color}
      />
      <hemisphereLight
        intensity={atmosphere.hemi.intensity}
        color={atmosphere.hemi.sky}
        groundColor={atmosphere.hemi.ground}
      />
      <directionalLight
        ref={sunRef}
        position={sunPos}
        intensity={atmosphere.sun.intensity}
        color={atmosphere.sun.color}
        castShadow={quality.shadowMapSize > 0}
        shadow-mapSize={[
          quality.shadowMapSize || 1,
          quality.shadowMapSize || 1,
        ]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={0.5}
        shadow-camera-far={sunDist * 3}
        shadow-camera-left={-shadowHalf}
        shadow-camera-right={shadowHalf}
        shadow-camera-top={shadowHalf}
        shadow-camera-bottom={-shadowHalf}
      />
      <object3D ref={targetRef} position={[bounds.cx, 0, bounds.cz]} />

      {/* NOTE: drei <SoftShadows> (PCSS) is intentionally NOT used. It patches
          three's global shader chunks at mount and, against this three version
          (which deprecated PCFSoftShadowMap), intermittently corrupts every lit
          material — the whole opaque pass vanished on ~half of page loads.
          Plain PCF shadows at 2048px look fine for the miniature aesthetic. */}

      {/* Procedural IBL — a tiny baked cube of sky / sun / ground-bounce panels
          tinted by the weather mood. Fully local: no HDRI CDN fetch (the
          original CSP-crash source), no CSP entry, no network latency. Keyed on
          the mood colors so the cube re-bakes when the weather changes. The
          boundary stays as cheap insurance: IBL failure degrades reflections,
          never the scene. */}
      <IBLBoundary>
        <Suspense fallback={null}>
          <Environment
            key={`${atmosphere.background}|${atmosphere.sun.color}`}
            resolution={64}
            frames={1}
            background={false}
          >
            <Lightformer
              form='rect'
              intensity={1.5}
              color={atmosphere.hemi.sky}
              scale={[50, 50, 1]}
              position={[0, 30, 0]}
              rotation-x={Math.PI / 2}
            />
            <Lightformer
              form='rect'
              intensity={2.2}
              color={atmosphere.sun.color}
              scale={[16, 16, 1]}
              position={[
                atmosphere.sunDir[0] * 30,
                Math.max(6, atmosphere.sunDir[1] * 30),
                atmosphere.sunDir[2] * 30,
              ]}
              target={[0, 0, 0]}
            />
            <Lightformer
              form='rect'
              intensity={0.5}
              color={atmosphere.hemi.ground}
              scale={[50, 50, 1]}
              position={[0, -20, 0]}
              rotation-x={-Math.PI / 2}
            />
          </Environment>
        </Suspense>
      </IBLBoundary>
    </>
  )
}

// Created and developed by Jai Singh
