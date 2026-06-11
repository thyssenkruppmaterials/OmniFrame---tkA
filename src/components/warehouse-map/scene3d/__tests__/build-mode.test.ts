// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  attachPlacement,
  groundPlacement,
  paintStride,
  snapToGrid,
} from '../build-mode'

const DIMS = { width: 100, depth: 100, height: 100 }

const target = (over: Partial<Parameters<typeof attachPlacement>[0]> = {}) => ({
  position_x: 500,
  position_y: 400,
  position_z: 0,
  width: 200,
  depth: 100,
  height: 300,
  rotation: 0,
  ...over,
})

describe('snapToGrid', () => {
  it('snaps to the nearest grid line', () => {
    expect(snapToGrid(47, 20)).toBe(40)
    expect(snapToGrid(51, 20)).toBe(60)
    expect(snapToGrid(-31, 20)).toBe(-40)
  })
  it('is a no-op without a grid', () => {
    expect(snapToGrid(47, 0)).toBe(47)
  })
})

describe('groundPlacement', () => {
  it('snaps both axes and stays on the floor', () => {
    expect(groundPlacement(47, 92, 20)).toEqual({
      position_x: 40,
      position_y: 100,
      position_z: 0,
    })
  })
})

describe('attachPlacement', () => {
  it('stacks on the top face', () => {
    const { placement, face } = attachPlacement(
      target(),
      505,
      395,
      295, // hit near the top of a 300-tall object
      DIMS,
      20
    )
    expect(face).toBe('top')
    expect(placement.position_z).toBe(300)
    expect(placement.position_x).toBe(500) // snapped near hit
    expect(placement.position_y).toBe(400)
  })

  it('stacks on top of an elevated object (tower building)', () => {
    const { placement } = attachPlacement(
      target({ position_z: 300 }),
      500,
      400,
      590,
      DIMS,
      20
    )
    expect(placement.position_z).toBe(600)
  })

  it('adjoins flush on the +x side face', () => {
    const { placement, face } = attachPlacement(
      target(),
      599, // right edge (x extent 500±100)
      400,
      100, // mid-height → side, not top
      DIMS,
      0
    )
    expect(face).toBe('+x')
    expect(placement.position_x).toBe(500 + 100 + 50) // half extents: 200/2 + 100/2
    expect(placement.position_y).toBe(400)
    expect(placement.position_z).toBe(0)
  })

  it('adjoins on the -z side face', () => {
    const { placement, face } = attachPlacement(
      target(),
      500,
      351, // front edge (y extent 400±50)
      50,
      DIMS,
      0
    )
    expect(face).toBe('-z')
    expect(placement.position_y).toBe(400 - 50 - 50)
    expect(placement.position_x).toBe(500)
  })

  it('respects target rotation for side attachment', () => {
    // 90° rotation: the target's local +x axis points along world -y.
    const { placement } = attachPlacement(
      target({ rotation: 90 }),
      500,
      290, // hit toward world -y, which is local +x for a 90°-rotated box
      50,
      DIMS,
      0
    )
    // Local +x offset (100 + 50) maps back to world -y.
    expect(placement.position_x).toBeCloseTo(500, 5)
    expect(placement.position_y).toBeCloseTo(400 - 150, 5)
  })
})

describe('paintStride', () => {
  it('uses footprint extents rounded up to grid cells', () => {
    expect(paintStride({ width: 110, depth: 30, height: 50 }, 0, 50)).toEqual({
      x: 150,
      y: 50,
    })
  })
  it('swaps extents at 90°', () => {
    expect(paintStride({ width: 110, depth: 30, height: 50 }, 90, 50)).toEqual({
      x: 50,
      y: 150,
    })
  })
  it('works without a grid', () => {
    expect(paintStride({ width: 110, depth: 30, height: 50 }, 0, 0)).toEqual({
      x: 110,
      y: 30,
    })
  })
})

// Created and developed by Jai Singh
