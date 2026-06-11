// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import type { MapLayoutResponse, WarehouseSceneObject } from '../../types'
import {
  obbOverlap,
  validateLayout,
  type FootprintBox,
} from '../layout-validation'

function box(p: Partial<FootprintBox>): FootprintBox {
  return {
    id: 'a',
    kind: 'object',
    label: 'A',
    cx: 0,
    cy: 0,
    hx: 50,
    hy: 50,
    rotation: 0,
    ...p,
  }
}

function obj(p: Partial<WarehouseSceneObject>): WarehouseSceneObject {
  return {
    id: 'o',
    map_id: 'm',
    organization_id: 'org',
    kind: 'desk',
    label: null,
    position_x: 0,
    position_y: 0,
    position_z: 0,
    width: 100,
    depth: 100,
    height: 100,
    rotation: 0,
    color: null,
    floor_level: 0,
    metadata: {},
    updated_at: '',
    ...p,
  }
}

describe('scene3d/layout-validation — OBB SAT', () => {
  it('detects axis-aligned overlap', () => {
    expect(obbOverlap(box({ cx: 0 }), box({ cx: 40 }))).toBe(true) // 80-wide centers 40 apart → overlap
    expect(obbOverlap(box({ cx: 0 }), box({ cx: 200 }))).toBe(false)
  })

  it('separates rotated boxes correctly (SAT, not naive AABB)', () => {
    // A thin bar along the y=x diagonal. Its AABB is ~(±60,±60), so a small box
    // at (45,-45) is INSIDE the AABB but far from the actual bar → SAT = false.
    const bar = box({ cx: 0, cy: 0, hx: 80, hy: 5, rotation: 45 })
    const offDiagonal = box({ cx: 45, cy: -45, hx: 8, hy: 8, rotation: 0 })
    const onDiagonal = box({ cx: 45, cy: 45, hx: 8, hy: 8, rotation: 0 })
    expect(obbOverlap(bar, offDiagonal)).toBe(false) // AABB would wrongly say true
    expect(obbOverlap(bar, onDiagonal)).toBe(true) // genuinely on the bar
  })

  it('clearance margin flags near-but-not-touching boxes', () => {
    const a = box({ cx: 0 })
    const b = box({ cx: 130 }) // gap of 30 between edges (each hx=50)
    expect(obbOverlap(a, b, 0)).toBe(false) // not touching
    expect(obbOverlap(a, b, 50)).toBe(true) // within 50 clearance
  })
})

describe('scene3d/layout-validation — validateLayout', () => {
  const layout = {
    map: {
      building_outline: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 },
      ],
    },
    racks: [],
    zones: [],
  } as unknown as MapLayoutResponse

  it('reports overlaps as errors', () => {
    const objs = [
      obj({ id: 'a', position_x: 300, position_y: 300 }),
      obj({ id: 'b', position_x: 340, position_y: 300 }),
    ]
    const issues = validateLayout(layout, objs)
    expect(
      issues.some((i) => i.kind === 'overlap' && i.severity === 'error')
    ).toBe(true)
  })

  it('reports out-of-bounds objects as warnings', () => {
    const objs = [obj({ id: 'a', position_x: 5000, position_y: 5000 })]
    const issues = validateLayout(layout, objs)
    expect(issues.some((i) => i.kind === 'out-of-bounds')).toBe(true)
  })

  it('is clean for a well-spaced in-bounds layout', () => {
    const objs = [
      obj({ id: 'a', position_x: 200, position_y: 200 }),
      obj({ id: 'b', position_x: 700, position_y: 700 }),
    ]
    expect(validateLayout(layout, objs)).toHaveLength(0)
  })
})
