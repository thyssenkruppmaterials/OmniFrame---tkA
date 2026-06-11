// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  aabbCenter,
  aabbSize,
  computeAlignment,
  computeDistribution,
  objectAABB,
  rackAABB,
  unionAABB,
  type AABB,
} from '../geometry'

describe('scene3d/geometry — AABBs', () => {
  it('objectAABB for an axis-aligned center-origin footprint', () => {
    const b = objectAABB({
      position_x: 100,
      position_y: 100,
      width: 200,
      depth: 100,
      rotation: 0,
    })
    expect(b).toEqual({ minX: 0, minZ: 50, maxX: 200, maxZ: 150 })
  })

  it('objectAABB swaps extents under a 90° rotation', () => {
    const b = objectAABB({
      position_x: 100,
      position_y: 100,
      width: 200,
      depth: 100,
      rotation: 90,
    })
    expect(b.minX).toBeCloseTo(50, 6)
    expect(b.maxX).toBeCloseTo(150, 6)
    expect(b.minZ).toBeCloseTo(0, 6)
    expect(b.maxZ).toBeCloseTo(200, 6)
  })

  it('rackAABB uses the corner-origin convention', () => {
    const b = rackAABB({
      position_x: 0,
      position_y: 0,
      width: 200,
      height: 100,
      rotation: 0,
    })
    expect(b).toEqual({ minX: 0, minZ: 0, maxX: 200, maxZ: 100 })
  })

  it('unionAABB / center / size', () => {
    const u = unionAABB([
      { minX: 0, minZ: 0, maxX: 10, maxZ: 10 },
      { minX: 20, minZ: 5, maxX: 40, maxZ: 25 },
    ]) as AABB
    expect(u).toEqual({ minX: 0, minZ: 0, maxX: 40, maxZ: 25 })
    expect(aabbCenter(u)).toEqual({ x: 20, z: 12.5 })
    expect(aabbSize(u)).toEqual({ w: 40, d: 25 })
  })
})

describe('scene3d/geometry — align & distribute', () => {
  const items = [
    {
      id: 'a',
      aabb: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 },
      center: { x: 50, z: 50 },
    },
    {
      id: 'b',
      aabb: { minX: 200, minZ: 300, maxX: 300, maxZ: 400 },
      center: { x: 250, z: 350 },
    },
  ]

  it('aligns left edges to the group minX', () => {
    const r = computeAlignment(items, 'left')
    expect(r['a'].x).toBeCloseTo(50, 6) // already at left
    expect(r['b'].x).toBeCloseTo(50, 6) // moved to group left (minX 0 + halfW 50)
  })

  it('distributes three centers evenly along x', () => {
    const three = [
      { id: 'a', center: { x: 0, z: 0 } },
      { id: 'b', center: { x: 30, z: 0 } },
      { id: 'c', center: { x: 100, z: 0 } },
    ]
    const r = computeDistribution(three, 'x')
    expect(r['b'].x).toBeCloseTo(50, 6) // evenly between 0 and 100
  })
})
