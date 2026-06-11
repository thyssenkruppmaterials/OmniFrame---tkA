// Created and developed by Jai Singh
// Canvas shell for the supply-chain globe. WebGPU-first: three's
// WebGPURenderer initializes via R3F v9's async gl factory and silently
// falls back to a WebGL2 backend on browsers without navigator.gpu — the
// TSL materials compile to WGSL or GLSL accordingly.
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { logger } from '@/lib/utils/logger'
import type {
  MapSelection,
  NetworkAnalysis,
  SupplyChainNetwork,
  SupplyChainNode,
} from '../data/types'
import { SCENE, type LaneStyle } from '../palette'
import { FlowArcs } from './FlowArcs'
import { Globe } from './Globe'
import { NodeMarkers } from './NodeMarkers'
import { PostFX } from './PostFX'
import { GLOBE_RADIUS, angularDistance, latLngToVector3 } from './coords'

export interface SupplyChainSceneProps {
  network: SupplyChainNetwork
  analysis: NetworkAnalysis
  selection: MapSelection
  onSelect: (selection: MapSelection) => void
  autoRotate: boolean
  showLabels: boolean
  visibleStatuses: Record<string, boolean>
  visibleModes: Record<string, boolean>
  laneStyle: LaneStyle
  /** Node ids inside the focused region; null = global view. */
  focusNodeIds: Set<string> | null
  /** When on, lanes on the critical path glow and the rest recede. */
  showCriticalPath: boolean
  criticalPathLinkIds: Set<string>
  onBackendDetected?: (backend: 'WebGPU' | 'WebGL2') => void
}

/**
 * Camera position framing a node set: direction = node centroid (nudged
 * north for a pleasing tilt), distance = global default or, for a region
 * focus, scaled by the region's angular spread so tight clusters zoom in
 * and continent-spanning ones stay framed.
 */
function frameFor(
  nodes: SupplyChainNode[],
  focusNodeIds: Set<string> | null
): THREE.Vector3 {
  const members = focusNodeIds
    ? nodes.filter((n) => focusNodeIds.has(n.id))
    : nodes
  const centroid = new THREE.Vector3()
  for (const n of members) centroid.add(latLngToVector3(n.lat, n.lng, 1))
  if (members.length === 0) centroid.set(0, 0.4, 1)
  centroid.normalize()
  let spread = 0
  for (const n of members) {
    spread = Math.max(
      spread,
      angularDistance(centroid, latLngToVector3(n.lat, n.lng, 1))
    )
  }
  centroid.y += focusNodeIds ? 0.18 : 0.35
  centroid.normalize()
  const distance = focusNodeIds
    ? GLOBE_RADIUS * Math.min(3.4, Math.max(1.75, 1.45 + spread * 1.35))
    : GLOBE_RADIUS * 3.4
  return centroid.multiplyScalar(distance)
}

/**
 * Flies the camera to frame the network (or the focused region) whenever
 * either changes. The flight slerps direction and lerps distance separately
 * so the camera never cuts a chord through the planet, and is time-boxed
 * so it always terminates even while auto-rotate keeps nudging azimuth.
 */
interface ControlsEvents {
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

function CameraRig({
  network,
  focusNodeIds,
}: {
  network: SupplyChainNetwork
  focusNodeIds: Set<string> | null
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const flight = useRef<{ target: THREE.Vector3; ttl: number } | null>(null)
  useEffect(() => {
    flight.current = {
      target: frameFor(network.nodes, focusNodeIds),
      ttl: 2.5,
    }
  }, [network.id, network.nodes, focusNodeIds])
  // The user's hand always wins: any drag/zoom on the controls cancels an
  // in-progress flight, otherwise the lerp tugs against every wheel step
  // and the view visibly snaps between the two zoom levels.
  useEffect(() => {
    const c = controls as unknown as ControlsEvents | null
    if (!c?.addEventListener) return
    const cancelFlight = () => {
      flight.current = null
    }
    c.addEventListener('start', cancelFlight)
    return () => c.removeEventListener('start', cancelFlight)
  }, [controls])
  useFrame((_, delta) => {
    const f = flight.current
    if (!f) return
    const dt = Math.min(delta, 0.1)
    const k = 1 - Math.exp(-3.2 * dt)
    const currentLen = camera.position.length()
    const nextLen = currentLen + (f.target.length() - currentLen) * k
    const dir = camera.position
      .clone()
      .normalize()
      .lerp(f.target.clone().normalize(), k)
      .normalize()
    camera.position.copy(dir.multiplyScalar(nextLen))
    camera.lookAt(0, 0, 0)
    f.ttl -= dt
    if (f.ttl <= 0 || camera.position.distanceTo(f.target) < 0.6) {
      flight.current = null
    }
  })
  return null
}

/**
 * Re-asserts the renderer size after the async WebGPU init and on every
 * resize. With an async `gl` factory, R3F can apply its initial size while
 * the backend is still initializing — on some platforms (Windows / D3D
 * swapchain) the renderer's internal MSAA color buffer then stays at the
 * canvas default (300×150) and every render pass fails validation with
 * "resolve target size does not match the other attachments". An explicit
 * setSize after mount forces the backend to re-allocate its buffers at
 * the real size; re-running on size/dpr changes keeps resizes safe too.
 */
function SizeSync() {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return
    gl.setPixelRatio(dpr)
    gl.setSize(size.width, size.height, false)
  }, [gl, size.width, size.height, dpr])
  return null
}

class SceneErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    logger.error('Supply chain 3D scene crashed', error)
  }
  render() {
    if (this.state.failed) {
      return (
        <div className='flex h-full items-center justify-center text-sm text-slate-400'>
          The 3D engine could not start on this device (WebGPU/WebGL2
          unavailable). Try a recent Chrome, Edge or Safari.
        </div>
      )
    }
    return this.props.children
  }
}

export default function SupplyChainScene({
  network,
  analysis,
  selection,
  onSelect,
  autoRotate,
  showLabels,
  visibleStatuses,
  visibleModes,
  laneStyle,
  focusNodeIds,
  showCriticalPath,
  criticalPathLinkIds,
  onBackendDetected,
}: SupplyChainSceneProps) {
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null)

  // Hovering anything interactive → pointer cursor on the canvas wrapper
  const cursor = hoveredLinkId ? 'pointer' : 'grab'
  const initialCameraPosition = useMemo(
    () => latLngToVector3(28, 24, GLOBE_RADIUS * 3.4),
    []
  )

  return (
    <SceneErrorBoundary>
      <Canvas
        style={{ cursor }}
        dpr={[1, 2]}
        frameloop='always'
        performance={{ min: 0.5 }}
        camera={{
          fov: 38,
          // near=10 (controls keep the camera ≥135 from center, so the
          // closest geometry is ~35 away). A tight near plane is what
          // gives the surface layers (globe / land dots / discs, only
          // 0.1–0.35 apart) enough depth resolution — at near=1 they
          // z-fight and shimmer on browsers with lower-precision depth.
          near: 10,
          far: 4000,
          position: initialCameraPosition,
        }}
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer({
            ...(props as ConstructorParameters<typeof THREE.WebGPURenderer>[0]),
            antialias: true,
          })
          await renderer.init()
          renderer.setClearColor(new THREE.Color(SCENE.background), 1)
          const isWebGPU =
            (renderer.backend as { isWebGPUBackend?: boolean })
              .isWebGPUBackend === true
          onBackendDetected?.(isWebGPU ? 'WebGPU' : 'WebGL2')
          logger.log(
            `Supply chain map renderer: ${isWebGPU ? 'WebGPU' : 'WebGL2 fallback'}`
          )
          return renderer
        }}
        onPointerMissed={() => onSelect(null)}
      >
        <Globe />
        <FlowArcs
          network={network}
          analysis={analysis}
          selection={selection}
          hoveredLinkId={hoveredLinkId}
          visibleStatuses={visibleStatuses}
          visibleModes={visibleModes}
          laneStyle={laneStyle}
          focusNodeIds={focusNodeIds}
          showCriticalPath={showCriticalPath}
          criticalPathLinkIds={criticalPathLinkIds}
          onSelect={onSelect}
          onHover={setHoveredLinkId}
        />
        <NodeMarkers
          network={network}
          analysis={analysis}
          selection={selection}
          showLabels={showLabels}
          focusNodeIds={focusNodeIds}
          onSelect={onSelect}
        />
        <SizeSync />
        <CameraRig network={network} focusNodeIds={focusNodeIds} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.55}
          autoRotate={autoRotate}
          autoRotateSpeed={0.4}
          enablePan={false}
          minDistance={GLOBE_RADIUS * 1.35}
          maxDistance={GLOBE_RADIUS * 5.2}
        />
        <PostFX />
      </Canvas>
    </SceneErrorBoundary>
  )
}
