// Created and developed by Jai Singh
// In-Canvas reporter: publishes camera scale + heading to view-info.store for
// the DOM scale bar + compass. Throttled so it doesn't churn the store.
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useViewInfo } from './view-info.store'

export function ViewReporter() {
  const setInfo = useViewInfo((s) => s.set)
  const last = useRef({ mpp: 0, north: 0 })
  const fallbackTarget = useRef(new THREE.Vector3())

  useFrame((state) => {
    const cam = state.camera as THREE.OrthographicCamera &
      THREE.PerspectiveCamera
    const controls = state.controls as { target?: THREE.Vector3 } | null
    const target = controls?.target ?? fallbackTarget.current
    const size = state.size

    let mpp: number
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      mpp = 1 / (cam.zoom || 1)
    } else {
      const dist = cam.position.distanceTo(target)
      const vFov = ((cam.fov ?? 45) * Math.PI) / 180
      mpp = (2 * Math.tan(vFov / 2) * dist) / Math.max(1, size.height)
    }

    const northDeg =
      (-Math.atan2(cam.position.x - target.x, cam.position.z - target.z) *
        180) /
      Math.PI

    const prev = last.current
    if (
      Math.abs(mpp - prev.mpp) / (prev.mpp || 1) > 0.01 ||
      Math.abs(northDeg - prev.north) > 0.5
    ) {
      last.current = { mpp, north: northDeg }
      setInfo(mpp, northDeg)
    }
  })

  return null
}

// Created and developed by Jai Singh
