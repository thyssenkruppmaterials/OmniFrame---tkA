// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  clampToFloorPlan,
  displayToWorld,
  FLOOR_PLAN_MIN_SIZE,
  floorPlanAreaM2,
  floorPlanContains,
  floorPlanCorner,
  floorPlanOutline,
  isPlacementBlocked,
  moveFloorPlan,
  readFloorPlan,
  resizeFloorPlan,
  rotatedFootprintExtents,
  worldToDisplay,
  type FloorPlanConfig,
} from '../floor-plan'

const FP: FloorPlanConfig = {
  enabled: true,
  origin_x: 0,
  origin_y: 0,
  width: 10000, // 100 m
  depth: 8000, // 80 m
  units: 'm',
  lock_placements: true,
}

describe('unit conversion', () => {
  it('round-trips meters through world units', () => {
    expect(displayToWorld(12.5, 'm')).toBe(1250)
    expect(worldToDisplay(1250, 'm')).toBe(12.5)
  })
  it('round-trips feet through world units', () => {
    const w = displayToWorld(100, 'ft')
    expect(w).toBeCloseTo(3048, 0) // 100 ft ≈ 30.48 m
    expect(worldToDisplay(w, 'ft')).toBeCloseTo(100, 6)
  })
})

describe('readFloorPlan', () => {
  it('returns null for missing or malformed settings', () => {
    expect(readFloorPlan(null)).toBeNull()
    expect(readFloorPlan({})).toBeNull()
    expect(readFloorPlan({ floor_plan: 'nope' })).toBeNull()
    expect(readFloorPlan({ floor_plan: { width: -5, depth: 100 } })).toBeNull()
    expect(readFloorPlan({ floor_plan: { width: 100 } })).toBeNull()
  })
  it('fills defaults and validates a partial config', () => {
    const fp = readFloorPlan({ floor_plan: { width: 5000, depth: 4000 } })
    expect(fp).toEqual({
      enabled: true,
      origin_x: 0,
      origin_y: 0,
      width: 5000,
      depth: 4000,
      units: 'm',
      lock_placements: true,
    })
  })
  it('preserves explicit flags', () => {
    const fp = readFloorPlan({
      floor_plan: {
        enabled: false,
        origin_x: -100,
        origin_y: 50,
        width: 5000,
        depth: 4000,
        units: 'ft',
        lock_placements: false,
      },
    })
    expect(fp?.enabled).toBe(false)
    expect(fp?.origin_x).toBe(-100)
    expect(fp?.units).toBe('ft')
    expect(fp?.lock_placements).toBe(false)
  })
})

describe('floorPlanOutline / area', () => {
  it('produces a clockwise rectangle from the origin', () => {
    expect(floorPlanOutline(FP)).toEqual([
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 8000 },
      { x: 0, y: 8000 },
    ])
  })
  it('computes the area in square meters', () => {
    expect(floorPlanAreaM2(FP)).toBe(8000) // 100 m × 80 m
  })
})

describe('rotatedFootprintExtents', () => {
  it('is identity at 0° and swaps at 90°', () => {
    expect(rotatedFootprintExtents(200, 100, 0)).toEqual({ x: 200, y: 100 })
    const r = rotatedFootprintExtents(200, 100, 90)
    expect(r.x).toBeCloseTo(100)
    expect(r.y).toBeCloseTo(200)
  })
  it('grows the AABB at 45°', () => {
    const r = rotatedFootprintExtents(200, 200, 45)
    expect(r.x).toBeCloseTo(200 * Math.SQRT2)
    expect(r.y).toBeCloseTo(200 * Math.SQRT2)
  })
})

describe('floorPlanContains', () => {
  it('accepts interior points and rejects exterior ones', () => {
    expect(floorPlanContains(FP, 5000, 4000)).toBe(true)
    expect(floorPlanContains(FP, -1, 4000)).toBe(false)
    expect(floorPlanContains(FP, 5000, 8001)).toBe(false)
  })
  it('accounts for the footprint extent', () => {
    // 200-wide object centered 50 units from the edge: half-extent 100 > 50.
    expect(floorPlanContains(FP, 50, 4000, 200, 100)).toBe(false)
    expect(floorPlanContains(FP, 100, 4000, 200, 100)).toBe(true)
  })
  it('accounts for rotation via the world AABB', () => {
    // 90°-rotated 200×100 needs 50 of x-clearance, not 100.
    expect(floorPlanContains(FP, 60, 4000, 200, 100, 90)).toBe(true)
    expect(floorPlanContains(FP, 60, 4000, 200, 100, 0)).toBe(false)
  })
})

describe('clampToFloorPlan', () => {
  it('clamps an escaping center back inside', () => {
    expect(clampToFloorPlan(FP, -500, 9000, 200, 100)).toEqual({
      x: 100,
      y: 7950,
    })
  })
  it('keeps interior points unchanged', () => {
    expect(clampToFloorPlan(FP, 5000, 4000, 200, 100)).toEqual({
      x: 5000,
      y: 4000,
    })
  })
  it('centers footprints larger than the envelope', () => {
    expect(clampToFloorPlan(FP, 0, 0, 20000, 100)).toEqual({ x: 5000, y: 50 })
  })
})

describe('moveFloorPlan', () => {
  it('translates with grid snap', () => {
    const moved = moveFloorPlan(FP, 130, -70, 100)
    expect(moved.origin_x).toBe(100)
    expect(moved.origin_y).toBe(-100)
    expect(moved.width).toBe(FP.width)
  })
  it('rounds without a grid', () => {
    expect(moveFloorPlan(FP, 33.4, 0).origin_x).toBe(33)
  })
})

describe('resizeFloorPlan / floorPlanCorner', () => {
  it('names corners correctly', () => {
    expect(floorPlanCorner(FP, 'nw')).toEqual({ x: 0, y: 0 })
    expect(floorPlanCorner(FP, 'se')).toEqual({ x: 10000, y: 8000 })
  })
  it('drags the SE corner, anchoring NW', () => {
    const r = resizeFloorPlan(FP, 'se', 12050, 6020, 100)
    expect(r).toMatchObject({
      origin_x: 0,
      origin_y: 0,
      width: 12100,
      depth: 6000,
    })
  })
  it('drags the NW corner, anchoring SE', () => {
    const r = resizeFloorPlan(FP, 'nw', 1000, 1000, 100)
    expect(r).toMatchObject({
      origin_x: 1000,
      origin_y: 1000,
      width: 9000,
      depth: 7000,
    })
  })
  it('enforces the minimum size', () => {
    const r = resizeFloorPlan(FP, 'se', 10, 10, 100)
    expect(r.width).toBe(FLOOR_PLAN_MIN_SIZE)
    expect(r.depth).toBe(FLOOR_PLAN_MIN_SIZE)
    expect(r.origin_x).toBe(0)
  })
})

describe('isPlacementBlocked', () => {
  it('never blocks without an enabled, locked envelope', () => {
    expect(isPlacementBlocked(null, -999, -999)).toBe(false)
    expect(isPlacementBlocked({ ...FP, enabled: false }, -999, -999)).toBe(
      false
    )
    expect(
      isPlacementBlocked({ ...FP, lock_placements: false }, -999, -999)
    ).toBe(false)
  })
  it('blocks out-of-envelope placements when locked', () => {
    expect(isPlacementBlocked(FP, -999, 4000)).toBe(true)
    expect(isPlacementBlocked(FP, 5000, 4000)).toBe(false)
  })
})
