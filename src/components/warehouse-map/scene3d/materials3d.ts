// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Warehouse 3D Scene — PBR material tokens
// ---------------------------------------------------------------------------
// A small design-token layer for surfaces in the scene. Materials are expressed
// as plain prop objects spreadable onto <meshStandardMaterial {...}> so React
// Three Fiber owns their lifecycle (auto-dispose) — no manual material caching.
//
// For "soft, refined textures" without shipping any texture files (bundle
// budget), we synthesize a subtle grain map procedurally on a <canvas> via the
// useGrainTexture hook. This gives concrete/drywall/wood a gentle micro-surface
// that catches the light instead of looking like flat plastic.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { PALETTE } from './scene-config'

export interface MaterialProps {
  color: string
  roughness: number
  metalness: number
  envMapIntensity?: number
  transparent?: boolean
  opacity?: number
  /** clearcoat is meshPhysical-only; kept here for object renderers that opt in. */
  clearcoat?: number
}

export type SurfaceKey =
  | 'ground'
  | 'floor'
  | 'wall'
  | 'rackPost'
  | 'rackShelf'
  | 'cellEmpty'
  | 'wood'
  | 'drywall'
  | 'metal'
  | 'glass'
  | 'rubber'
  | 'plastic'

/**
 * Spreadable meshStandardMaterial props per surface, tuned for the soft daylight
 * "miniature" aesthetic (low metalness, mid-high roughness, gentle IBL).
 */
export const MATERIAL_PROPS: Record<SurfaceKey, MaterialProps> = {
  ground: {
    color: PALETTE.ground,
    roughness: 0.97,
    metalness: 0.0,
    envMapIntensity: 0.4,
  },
  floor: {
    color: PALETTE.floor,
    roughness: 0.85,
    metalness: 0.04,
    envMapIntensity: 0.5,
  },
  wall: {
    color: PALETTE.wall,
    roughness: 0.7,
    metalness: 0.0,
    envMapIntensity: 0.6,
    transparent: true,
    opacity: 0.32,
  },
  rackPost: {
    color: PALETTE.rackPost,
    roughness: 0.45,
    metalness: 0.55,
    envMapIntensity: 0.8,
  },
  rackShelf: {
    color: PALETTE.rackShelf,
    roughness: 0.55,
    metalness: 0.35,
    envMapIntensity: 0.7,
  },
  cellEmpty: {
    color: PALETTE.cellEmpty,
    roughness: 0.8,
    metalness: 0.05,
    transparent: true,
    opacity: 0.25,
  },
  wood: {
    color: PALETTE.wood,
    roughness: 0.6,
    metalness: 0.0,
    envMapIntensity: 0.5,
  },
  drywall: {
    color: PALETTE.drywall,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.5,
  },
  metal: {
    color: PALETTE.metal,
    roughness: 0.4,
    metalness: 0.7,
    envMapIntensity: 0.9,
  },
  glass: {
    color: PALETTE.glass,
    roughness: 0.08,
    metalness: 0.1,
    envMapIntensity: 1.0,
    transparent: true,
    opacity: 0.35,
  },
  rubber: { color: '#2b2f36', roughness: 0.95, metalness: 0.0 },
  plastic: {
    color: '#e2e8f0',
    roughness: 0.5,
    metalness: 0.0,
    envMapIntensity: 0.6,
  },
}

/**
 * Material props for a surface with an optional colour override, returned as ONE
 * object so it can be spread without a duplicate-`color` JSX attribute (the
 * preset already carries a default colour). e.g. `<meshStandardMaterial
 * {...surface('wood', obj.color)} />`.
 */
export function surface(
  key: SurfaceKey,
  colorOverride?: string
): MaterialProps {
  const base = MATERIAL_PROPS[key]
  return colorOverride ? { ...base, color: colorOverride } : base
}

/**
 * Build a subtle, tileable grain texture on a canvas. Used as a light albedo /
 * roughness perturbation so large flat surfaces (floor, walls) read as a real
 * material under the soft lighting rather than a flat fill.
 *
 * Deterministic (seeded) so it never changes between renders / resumes.
 */
function buildGrainCanvas(size: number, intensity: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const img = ctx.createImageData(size, size)
  // Simple deterministic LCG so we don't touch Math.random (and stay stable).
  let seed = 0x2545f491
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 255 - Math.floor(rand() * intensity)
    img.data[i] = n
    img.data[i + 1] = n
    img.data[i + 2] = n
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/**
 * Memoized subtle grain texture for a surface, repeated `repeat` times. Returns a
 * THREE.Texture safe to use as `roughnessMap`/`map`. Disposed on unmount.
 */
export function useGrainTexture(
  repeat = 24,
  intensity = 18,
  size = 128
): THREE.Texture {
  const texture = useMemo(() => {
    const canvas = buildGrainCanvas(size, intensity)
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat, repeat)
    tex.anisotropy = 4
    tex.needsUpdate = true
    return tex
  }, [repeat, intensity, size])

  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

// Created and developed by Jai Singh
