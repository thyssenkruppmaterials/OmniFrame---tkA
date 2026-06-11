// Created and developed by Jai Singh
// Decodes the packed Natural Earth land polygons (land-data.ts) and builds
// the dotted-landmass grid: a Fibonacci sphere lattice filtered by
// point-in-polygon against the land shapes. Pure — unit-testable.
import { fibonacciSphere } from './coords'
import {
  LAND_COORDS_B64,
  LAND_POLYGON_RING_COUNTS,
  LAND_RING_LENGTHS,
} from './land-data'

export interface LandPolygon {
  /** rings[0] is the outer ring; the rest are holes. [lng, lat] degrees. */
  rings: number[][][]
  bbox: [number, number, number, number] // minLng, minLat, maxLng, maxLat
}

let cache: LandPolygon[] | null = null

export function decodeLandPolygons(): LandPolygon[] {
  if (cache) return cache
  const bin = atob(LAND_COORDS_B64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const i16 = new Int16Array(bytes.buffer)

  const polygons: LandPolygon[] = []
  let ringIdx = 0
  let coordIdx = 0
  for (const ringCount of LAND_POLYGON_RING_COUNTS) {
    const rings: number[][][] = []
    let minLng = 180
    let minLat = 90
    let maxLng = -180
    let maxLat = -90
    for (let r = 0; r < ringCount; r++) {
      const len = LAND_RING_LENGTHS[ringIdx++]
      const ring: number[][] = []
      for (let p = 0; p < len; p++) {
        const lng = i16[coordIdx++] / 100
        const lat = i16[coordIdx++] / 100
        ring.push([lng, lat])
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
      rings.push(ring)
    }
    polygons.push({ rings, bbox: [minLng, minLat, maxLng, maxLat] })
  }
  cache = polygons
  return polygons
}

/** Even-odd ray-casting across all rings of one polygon (holes included). */
function inPolygon(lng: number, lat: number, poly: LandPolygon): boolean {
  const [minLng, minLat, maxLng, maxLat] = poly.bbox
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false
  let inside = false
  for (const ring of poly.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      ) {
        inside = !inside
      }
    }
  }
  return inside
}

export function isLand(lat: number, lng: number): boolean {
  // Natural Earth 110m's Antarctica ring closes along the ±180 edge, but
  // the deep-south cap is unambiguous land — short-circuit it.
  if (lat < -83) return true
  for (const poly of decodeLandPolygons()) {
    if (inPolygon(lng, lat, poly)) return true
  }
  return false
}

/**
 * Land-only dot lattice. Returns flat [lat, lng, ...] pairs in degrees,
 * sampled from a `sampleCount`-point Fibonacci sphere.
 */
export function buildLandDots(sampleCount: number): Float32Array {
  const out: number[] = []
  for (const [lat, lng] of fibonacciSphere(sampleCount)) {
    if (isLand(lat, lng)) out.push(lat, lng)
  }
  return new Float32Array(out)
}
