// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import type { MapLayoutResponse, WarehouseRack } from '../../types'
import {
  computeBounds,
  discoverFloors,
  rackCenter,
  rotationToY,
  toMeters,
  toScene,
} from '../coords'

// Minimal rack factory — only the fields the coord math reads.
function rack(p: Partial<WarehouseRack>): WarehouseRack {
  return {
    id: 'r',
    map_id: 'm',
    zone_id: null,
    organization_id: 'o',
    label: 'R',
    rack_type: 'pallet',
    position_x: 0,
    position_y: 0,
    rotation: 0,
    width: 100,
    height: 100,
    rows: 1,
    columns: 1,
    aisle: null,
    updated_at: '',
    metadata: {},
    ...p,
  }
}

describe('scene3d/coords — legacy transform parity', () => {
  it('toScene/toMeters scale 2D world units by 1/100 (cm → m)', () => {
    expect(toScene({ x: 100, y: 200 })).toEqual([1, 2])
    expect(toMeters(500)).toBe(5)
  })

  it('rotationToY converts degrees to negated radians (matches legacy)', () => {
    expect(rotationToY(0)).toBe(-0)
    expect(rotationToY(90)).toBeCloseTo(-Math.PI / 2, 6)
    expect(rotationToY(null)).toBe(-0)
  })

  it('rackCenter returns the world-meter center of the rack footprint', () => {
    const [x, z] = rackCenter(
      rack({ position_x: 200, position_y: 400, width: 100, height: 200 })
    )
    expect(x).toBeCloseTo((200 + 50) / 100, 6)
    expect(z).toBeCloseTo((400 + 100) / 100, 6)
  })

  it('computeBounds frames racks in meters and centers them', () => {
    const layout = {
      map: { building_outline: null },
      zones: [],
      racks: [rack({ position_x: 0, position_y: 0, width: 200, height: 100 })],
    } as unknown as MapLayoutResponse
    const b = computeBounds(layout)
    expect(b.width).toBeCloseTo(2, 6)
    expect(b.depth).toBeCloseTo(1, 6)
    expect(b.cx).toBeCloseTo(1, 6)
    expect(b.cz).toBeCloseTo(0.5, 6)
    expect(b.span).toBeCloseTo(2, 6)
  })

  it('computeBounds falls back to a default frame when layout is empty', () => {
    const b = computeBounds(null)
    expect(b.width).toBeGreaterThan(0)
    expect(b.depth).toBeGreaterThan(0)
    expect(Number.isFinite(b.cx)).toBe(true)
  })

  it('discoverFloors returns distinct sorted zone floor levels (default [0])', () => {
    expect(discoverFloors(null)).toEqual([0])
    const layout = {
      map: {},
      zones: [
        { floor_level: 1 },
        { floor_level: 0 },
        { floor_level: 1 },
        { floor_level: -1 },
      ],
      racks: [],
    } as unknown as MapLayoutResponse
    expect(discoverFloors(layout)).toEqual([-1, 0, 1])
  })
})

// Created and developed by Jai Singh
