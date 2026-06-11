// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  generateRackSystem,
  runLetter,
  systemFootprint,
  type RackSystemConfig,
} from '../rack-system'

const CFG: RackSystemConfig = {
  rack_type: 'pallet',
  levels: 4,
  bays: 8,
  palletsPerBay: 1,
  bayWidth: 280,
  rackDepth: 110,
  runs: 4,
  backToBack: true,
  flueGap: 30,
  aisleWidth: 320,
  labelPrefix: '',
}

describe('runLetter', () => {
  it('letters runs A…Z then AA', () => {
    expect(runLetter(0)).toBe('A')
    expect(runLetter(25)).toBe('Z')
    expect(runLetter(26)).toBe('AA')
  })
})

describe('systemFootprint', () => {
  it('computes back-to-back footprint: pair + aisle + pair', () => {
    const { width, depth } = systemFootprint(CFG)
    expect(width).toBe(8 * 280)
    // pair (110+30+110) + aisle 320 + pair (110+30+110) = 820
    expect(depth).toBe(110 + 30 + 110 + 320 + 110 + 30 + 110)
  })
  it('computes single-row footprint with aisles between runs', () => {
    const { depth } = systemFootprint({ ...CFG, backToBack: false, runs: 3 })
    // 3 runs + 2 aisles
    expect(depth).toBe(3 * 110 + 2 * 320)
  })
})

describe('generateRackSystem', () => {
  it('creates one rack row per run with levels/bays mapped to rows/columns', () => {
    const racks = generateRackSystem(CFG, 0, 0)
    expect(racks).toHaveLength(4)
    for (const r of racks) {
      expect(r.rows).toBe(4)
      expect(r.columns).toBe(8)
      expect(r.width).toBe(2240)
      expect(r.height).toBe(110)
      expect(r.rotation).toBe(0)
    }
    expect(racks.map((r) => r.label)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('multiplies columns by palletsPerBay and stamps the appearance', () => {
    const racks = generateRackSystem({ ...CFG, palletsPerBay: 2 }, 0, 0)
    for (const r of racks) {
      expect(r.columns).toBe(16) // 8 bays × 2 pallet positions
      expect(r.width).toBe(2240) // footprint unchanged — bays define width
      expect(r.metadata).toEqual({ appearance: { palletsPerBay: 2 } })
    }
  })

  it('separates back-to-back pairs by the flue and pairs by the aisle', () => {
    const racks = generateRackSystem(CFG, 0, 0)
    const ys = racks.map((r) => r.position_y)
    expect(ys[1] - ys[0]).toBe(110 + 30) // inside pair: depth + flue
    expect(ys[2] - ys[1]).toBe(110 + 320) // across the aisle
  })

  it('centers the system on the requested point', () => {
    const { width, depth } = systemFootprint(CFG)
    const racks = generateRackSystem(CFG, 5000, 4000)
    expect(racks[0].position_x).toBe(5000 - width / 2)
    expect(racks[0].position_y).toBe(4000 - depth / 2)
    const last = racks[racks.length - 1]
    expect(last.position_y + last.height).toBe(4000 + depth / 2)
  })

  it('rotates run centers around the system center at 90°', () => {
    const cfg = { ...CFG, runs: 2, backToBack: false }
    const racks = generateRackSystem(cfg, 1000, 1000, 90)
    expect(racks[0].rotation).toBe(90)
    // At 90° the two run centers spread along X instead of Y.
    const c0 = {
      x: racks[0].position_x + racks[0].width / 2,
      y: racks[0].position_y + racks[0].height / 2,
    }
    const c1 = {
      x: racks[1].position_x + racks[1].width / 2,
      y: racks[1].position_y + racks[1].height / 2,
    }
    expect(Math.abs(c1.y - c0.y)).toBeLessThan(1e-6)
    expect(Math.abs(c1.x - c0.x)).toBeCloseTo(110 + 320, 6)
  })

  it('applies the label prefix', () => {
    const racks = generateRackSystem(
      { ...CFG, runs: 2, labelPrefix: 'WH5-' },
      0,
      0
    )
    expect(racks.map((r) => r.label)).toEqual(['WH5-A', 'WH5-B'])
  })
})

// Created and developed by Jai Singh
