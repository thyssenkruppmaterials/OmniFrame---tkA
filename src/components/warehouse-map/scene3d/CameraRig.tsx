// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Warehouse 3D Scene — camera rig
// ---------------------------------------------------------------------------
// Three navigation modes share one target:
//   • ISO   — locked OrthographicCamera on the 45°/35.264° isometric rail. No
//             perspective distortion → the "toy miniature" look. Pan + zoom only.
//   • ORBIT — PerspectiveCamera + full OrbitControls for free inspection.
//   • FLY   — PerspectiveCamera + WASD/drag FlyControls to "fly through the city".
// The active camera uses makeDefault so R3F swaps raycaster + projection cleanly.
import { useEffect, useMemo, useRef } from 'react'
import {
  OrthographicCamera,
  PerspectiveCamera,
  OrbitControls,
  MapControls,
  FlyControls,
} from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useCameraFocus } from './camera-focus.store'
import type { SceneBounds } from './coords'
import { ISO_DIR, isoCameraDistance, type CameraMode } from './scene-config'

interface CameraRigProps {
  bounds: SceneBounds
  mode: CameraMode
  /** Pause pan/orbit (e.g. while drag-painting blocks). FlyControls ignores it. */
  controlsEnabled?: boolean
}

export function CameraRig({
  bounds,
  mode,
  controlsEnabled = true,
}: CameraRigProps) {
  const target = useMemo<[number, number, number]>(
    () => [bounds.cx, 0, bounds.cz],
    [bounds.cx, bounds.cz]
  )

  return (
    <>
      {mode === 'fly' ? (
        <FlyCamera bounds={bounds} />
      ) : mode === 'orbit' ? (
        <OrbitCamera
          bounds={bounds}
          target={target}
          enabled={controlsEnabled}
        />
      ) : (
        <IsoCamera bounds={bounds} target={target} enabled={controlsEnabled} />
      )}
      {/* Frame-selection tween (no-op in fly mode — FlyControls has no target). */}
      {mode !== 'fly' && <Focuser />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Focuser — eased "frame selection" (F key). Reads camera-focus.store and
// tweens controls.target + camera position/zoom. ISO-aware: keeps the locked
// 45° rail (moves along ISO_DIR + adjusts ortho zoom) instead of breaking
// isometry; in orbit it preserves the current view direction and dollies in.
// ---------------------------------------------------------------------------

interface FocusAnim {
  t: number
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  fromZoom: number
  toZoom: number
}

function Focuser() {
  // Cast to a concrete camera so .zoom / .updateProjectionMatrix type-check;
  // perspective cameras have these too, and isOrthographicCamera gates the
  // zoom write at runtime.
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const controls = useThree((s) => s.controls) as
    | (THREE.EventDispatcher & { target?: THREE.Vector3; update?: () => void })
    | null
  const size = useThree((s) => s.size)
  const target = useCameraFocus((s) => s.target)
  const nonce = useCameraFocus((s) => s.nonce)
  const zoomFactor = useCameraFocus((s) => s.zoomFactor)
  const zoomNonce = useCameraFocus((s) => s.zoomNonce)
  const anim = useRef<FocusAnim | null>(null)
  const lastNonce = useRef(0)
  const lastZoomNonce = useRef(0)

  const invalidate = useThree((s) => s.invalidate)

  // DOM toolbar zoom buttons: ortho adjusts camera.zoom, perspective dollies
  // toward the controls target.
  useEffect(() => {
    if (zoomNonce === lastZoomNonce.current) return
    lastZoomNonce.current = zoomNonce
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      camera.zoom = Math.min(600, Math.max(4, camera.zoom * zoomFactor))
      camera.updateProjectionMatrix()
    } else if (controls?.target) {
      const offset = camera.position.clone().sub(controls.target)
      offset.multiplyScalar(1 / zoomFactor)
      camera.position.copy(controls.target).add(offset)
    }
    controls?.update?.()
    invalidate()
  }, [zoomNonce, zoomFactor, camera, controls, invalidate])

  useEffect(() => {
    if (!target || !controls?.target || nonce === lastNonce.current) return
    lastNonce.current = nonce
    const toTarget = new THREE.Vector3(target.cx, 0, target.cz)
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera
    const radius = Math.max(target.radius, 2)
    let toPos: THREE.Vector3
    let toZoom = camera.zoom
    if (ortho) {
      const dist = camera.position.distanceTo(controls.target) || 100
      toPos = toTarget.clone().add(ISO_DIR.clone().multiplyScalar(dist))
      const minDim = Math.min(size.width, size.height)
      toZoom = (minDim * 0.7) / (radius * 2 * 1.4)
    } else {
      const dir = camera.position.clone().sub(controls.target).normalize()
      toPos = toTarget.clone().add(dir.multiplyScalar(radius * 2.6 + 4))
    }
    anim.current = {
      t: 0,
      fromTarget: controls.target.clone(),
      toTarget,
      fromPos: camera.position.clone(),
      toPos,
      fromZoom: camera.zoom,
      toZoom,
    }
    invalidate() // kick the first frame of the tween in demand mode
  }, [target, nonce, controls, camera, size, invalidate])

  useFrame((_, delta) => {
    const a = anim.current
    if (!a || !controls?.target) return
    invalidate() // demand frameloop: keep the tween advancing
    a.t = Math.min(1, a.t + delta / 0.45)
    const e = 1 - Math.pow(1 - a.t, 3) // easeOutCubic
    controls.target.lerpVectors(a.fromTarget, a.toTarget, e)
    camera.position.lerpVectors(a.fromPos, a.toPos, e)
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      camera.zoom = a.fromZoom + (a.toZoom - a.fromZoom) * e
      camera.updateProjectionMatrix()
    }
    controls.update?.()
    if (a.t >= 1) anim.current = null
  })

  return null
}

// ---------------------------------------------------------------------------
// ISO — orthographic, locked angle, pan + zoom (the default "miniature" view).
// ---------------------------------------------------------------------------

function IsoCamera({
  bounds,
  target,
  enabled = true,
}: {
  bounds: SceneBounds
  target: [number, number, number]
  enabled?: boolean
}) {
  const camRef = useRef<THREE.OrthographicCamera>(null)
  const size = useThree((s) => s.size)
  const dist = isoCameraDistance(bounds.span)

  const pos = useMemo<[number, number, number]>(
    () => [
      target[0] + ISO_DIR.x * dist,
      target[1] + ISO_DIR.y * dist,
      target[2] + ISO_DIR.z * dist,
    ],
    [target, dist]
  )

  // Fit the scene to ~80% of the smaller viewport dimension via ortho zoom.
  useEffect(() => {
    const cam = camRef.current
    if (!cam || size.width === 0 || size.height === 0) return
    const minDim = Math.min(size.width, size.height)
    const spanMeters = Math.max(bounds.span, 4)
    cam.zoom = (minDim * 0.8) / (spanMeters * 1.4)
    cam.updateProjectionMatrix()
  }, [bounds.span, size.width, size.height])

  return (
    <>
      <OrthographicCamera
        ref={camRef}
        makeDefault
        position={pos}
        near={0.1}
        far={dist * 4}
      />
      <MapControls
        makeDefault
        enabled={enabled}
        target={target}
        enableRotate={false}
        enableDamping
        dampingFactor={0.12}
        screenSpacePanning
        minZoom={4}
        maxZoom={600}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// ORBIT — perspective free orbit (inspection).
// ---------------------------------------------------------------------------

function OrbitCamera({
  bounds,
  target,
  enabled = true,
}: {
  bounds: SceneBounds
  target: [number, number, number]
  enabled?: boolean
}) {
  const dist = bounds.span * 0.9 + 6
  const pos = useMemo<[number, number, number]>(
    () => [target[0] + dist * 0.7, dist * 0.6, target[2] + dist * 0.7],
    [target, dist]
  )
  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={pos}
        fov={42}
        near={0.1}
        far={dist * 8}
      />
      <OrbitControls
        makeDefault
        enabled={enabled}
        target={target}
        enableDamping
        dampingFactor={0.08}
        minDistance={1}
        maxDistance={dist * 5}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// FLY — perspective WASD/drag traversal ("fly through the city").
// ---------------------------------------------------------------------------

function FlyCamera({ bounds }: { bounds: SceneBounds }) {
  const dist = bounds.span * 0.6 + 8
  const pos = useMemo<[number, number, number]>(
    () => [bounds.cx + dist * 0.4, dist * 0.5, bounds.cz + dist * 0.9],
    [bounds.cx, bounds.cz, dist]
  )
  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={pos}
        fov={60}
        near={0.05}
        far={dist * 12}
      />
      <FlyControls
        makeDefault
        movementSpeed={Math.max(6, bounds.span * 0.6)}
        rollSpeed={0.5}
        dragToLook
        autoForward={false}
      />
    </>
  )
}

// Created and developed by Jai Singh
