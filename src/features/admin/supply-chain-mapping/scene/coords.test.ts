// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  GLOBE_RADIUS,
  fibonacciSphere,
  laneArc,
  latLngToVector3,
} from './coords'
import { buildLandDots, decodeLandPolygons, isLand } from './land'

describe('latLngToVector3', () => {
  it('places poles and keeps points on the sphere', () => {
    const north = latLngToVector3(90, 0)
    expect(north.y).toBeCloseTo(GLOBE_RADIUS)
    expect(north.x).toBeCloseTo(0)
    const random = latLngToVector3(48.86, 2.35)
    expect(random.length()).toBeCloseTo(GLOBE_RADIUS)
  })
})

describe('GreatCircleArc', () => {
  it('starts/ends on the surface and lifts at the midpoint', () => {
    const arc = laneArc(31.23, 121.47, 33.74, -118.26) // Shanghai → LA
    expect(arc.getPoint(0).length()).toBeCloseTo(GLOBE_RADIUS, 1)
    expect(arc.getPoint(1).length()).toBeCloseTo(GLOBE_RADIUS, 1)
    expect(arc.getPoint(0.5).length()).toBeGreaterThan(GLOBE_RADIUS * 1.05)
  })

  it('handles short hops without degenerating', () => {
    const arc = laneArc(51.95, 4.14, 51.56, 5.09) // Rotterdam → Tilburg
    expect(arc.getPoint(0.5).length()).toBeGreaterThan(GLOBE_RADIUS)
    expect(Number.isFinite(arc.getPoint(0.5).x)).toBe(true)
  })
})

describe('land decoding', () => {
  it('decodes the packed Natural Earth polygons', () => {
    const polys = decodeLandPolygons()
    expect(polys.length).toBeGreaterThan(100)
    const points = polys.reduce(
      (s, p) => s + p.rings.reduce((r, ring) => r + ring.length, 0),
      0
    )
    expect(points).toBeGreaterThan(2000)
  })

  it('classifies well-known land and ocean points', () => {
    expect(isLand(39.9, 116.4)).toBe(true) // Beijing
    expect(isLand(48.86, 2.35)).toBe(true) // Paris
    expect(isLand(-23.55, -46.63)).toBe(true) // São Paulo
    expect(isLand(0, -140)).toBe(false) // mid-Pacific
    expect(isLand(30, -45)).toBe(false) // mid-Atlantic
  })

  it('builds a land-only dot lattice at roughly land/ocean ratio', () => {
    const dots = buildLandDots(2000)
    const share = dots.length / 2 / 2000
    // Land is ~29% of Earth's surface; allow generous tolerance at 110m
    expect(share).toBeGreaterThan(0.15)
    expect(share).toBeLessThan(0.45)
  })
})

describe('fibonacciSphere', () => {
  it('produces valid evenly spread lat/lng pairs', () => {
    const pts = fibonacciSphere(500)
    expect(pts).toHaveLength(500)
    for (const [lat, lng] of pts) {
      expect(lat).toBeGreaterThanOrEqual(-90)
      expect(lat).toBeLessThanOrEqual(90)
      expect(lng).toBeGreaterThanOrEqual(-180)
      expect(lng).toBeLessThan(180)
    }
  })
})
