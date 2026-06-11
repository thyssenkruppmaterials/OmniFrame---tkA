// Created and developed by Jai Singh
// The planet: fresnel-rimmed sphere, additive atmosphere shell, dotted
// landmass (one InstancedMesh, GitHub-globe style) and a seeded starfield.
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Object3D,
  PointsMaterial,
} from 'three/webgpu'
import { SCENE } from '../palette'
import { GLOBE_RADIUS, latLngToVector3 } from './coords'
import { buildLandDots } from './land'
import { createAtmosphereMaterial, createGlobeMaterial } from './materials'

const LAND_SAMPLES = 16000
const DOT_RADIUS = 0.42

function LandDots() {
  const meshRef = useRef<InstancedMesh>(null)
  const dots = useMemo(() => buildLandDots(LAND_SAMPLES), [])
  const count = dots.length / 2

  const geometry = useMemo(() => new CircleGeometry(DOT_RADIUS, 5), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const dummy = new Object3D()
    for (let i = 0; i < count; i++) {
      const lat = dots[i * 2]
      const lng = dots[i * 2 + 1]
      const p = latLngToVector3(lat, lng, GLOBE_RADIUS + 0.15)
      dummy.position.copy(p)
      dummy.lookAt(p.x * 2, p.y * 2, p.z * 2) // face outward along the normal
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [dots, count])

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, count]}>
      <meshBasicMaterial
        color={SCENE.landDot}
        transparent
        opacity={0.85}
        toneMapped={false}
      />
    </instancedMesh>
  )
}

function Starfield() {
  const { geometry, material } = useMemo(() => {
    // Deterministic LCG so the sky never twinkles differently between mounts
    let seed = 1337
    const rand = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    const positions: number[] = []
    for (let i = 0; i < 1200; i++) {
      const u = rand() * 2 - 1
      const theta = rand() * Math.PI * 2
      const r = 900 + rand() * 600
      const s = Math.sqrt(1 - u * u)
      positions.push(r * s * Math.cos(theta), r * u, r * s * Math.sin(theta))
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    const mat = new PointsMaterial({
      color: SCENE.star,
      size: 1.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    return { geometry: geo, material: mat }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material]
  )

  return <points geometry={geometry} material={material} />
}

export function Globe() {
  const globeMaterial = useMemo(
    () => createGlobeMaterial(SCENE.globeBase, SCENE.globeRim),
    []
  )
  const atmosphereMaterial = useMemo(
    () => createAtmosphereMaterial(SCENE.atmosphere),
    []
  )
  useEffect(
    () => () => {
      globeMaterial.dispose()
      atmosphereMaterial.dispose()
    },
    [globeMaterial, atmosphereMaterial]
  )

  return (
    <group>
      <mesh material={globeMaterial}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
      </mesh>
      <mesh material={atmosphereMaterial} scale={1.08}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
      </mesh>
      <LandDots />
      <Starfield />
    </group>
  )
}
