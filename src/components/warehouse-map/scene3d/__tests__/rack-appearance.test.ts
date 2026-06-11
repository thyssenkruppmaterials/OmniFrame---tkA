// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  BEAM_ORANGE,
  defaultRackAppearance,
  levelHeightAt,
  levelOffsets,
  mergeRackAppearance,
  readRackAppearance,
} from '../rack-appearance'
import { PALETTE, SHELF_SPACING } from '../scene-config'

const pallet = (metadata: Record<string, unknown> | null = null) => ({
  rack_type: 'pallet' as const,
  metadata,
})
const shelving = (metadata: Record<string, unknown> | null = null) => ({
  rack_type: 'shelving' as const,
  metadata,
})

describe('defaultRackAppearance', () => {
  it('matches the previous hard-coded look', () => {
    expect(defaultRackAppearance('pallet')).toEqual({
      postColor: PALETTE.rackPost,
      shelfColor: PALETTE.rackShelf,
      beamColor: BEAM_ORANGE,
      levelHeightM: SHELF_SPACING,
      levelHeights: null,
      palletsPerBay: null,
      showBeams: true,
    })
    expect(defaultRackAppearance('shelving').showBeams).toBe(false)
  })
})

describe('readRackAppearance', () => {
  it('returns defaults for missing/legacy metadata', () => {
    expect(readRackAppearance(pallet())).toEqual(
      defaultRackAppearance('pallet')
    )
    expect(readRackAppearance(pallet({ other: 1 }))).toEqual(
      defaultRackAppearance('pallet')
    )
  })

  it('applies partial overrides field by field', () => {
    const app = readRackAppearance(
      pallet({ appearance: { postColor: '#112233', levelHeightM: 1.5 } })
    )
    expect(app.postColor).toBe('#112233')
    expect(app.levelHeightM).toBe(1.5)
    expect(app.shelfColor).toBe(PALETTE.rackShelf)
    expect(app.showBeams).toBe(true)
  })

  it('rejects malformed values', () => {
    const app = readRackAppearance(
      pallet({
        appearance: {
          postColor: 'red',
          levelHeightM: 99,
          showBeams: 'yes',
        },
      })
    )
    expect(app).toEqual(defaultRackAppearance('pallet'))
  })
})

describe('mergeRackAppearance', () => {
  it('stores only non-default values and preserves other metadata', () => {
    const meta = mergeRackAppearance(pallet({ keep: true }), {
      shelfColor: '#abcdef',
    })
    expect(meta).toEqual({ keep: true, appearance: { shelfColor: '#abcdef' } })
  })

  it('drops the appearance key entirely when reset to defaults', () => {
    const rack = pallet({ appearance: { shelfColor: '#abcdef' } })
    const meta = mergeRackAppearance(rack, { shelfColor: PALETTE.rackShelf })
    expect(meta).toEqual({})
  })

  it('reads pallets-per-bay and per-level heights', () => {
    const app = readRackAppearance(
      pallet({
        appearance: { palletsPerBay: 2, levelHeights: [1.8, 1.2, 9] },
      })
    )
    expect(app.palletsPerBay).toBe(2)
    expect(app.levelHeights).toEqual([1.8, 1.2, 4]) // 9 clamps to max 4
  })

  it('rejects malformed pallets-per-bay and level arrays', () => {
    expect(
      readRackAppearance(pallet({ appearance: { palletsPerBay: 5 } }))
        .palletsPerBay
    ).toBeNull()
    expect(
      readRackAppearance(pallet({ appearance: { levelHeights: [1, 'x'] } }))
        .levelHeights
    ).toBeNull()
    expect(
      readRackAppearance(pallet({ appearance: { levelHeights: [] } }))
        .levelHeights
    ).toBeNull()
  })

  it('round-trips through read', () => {
    const rack = shelving()
    const meta = mergeRackAppearance(rack, {
      beamColor: '#00ff00',
      showBeams: true,
      levelHeightM: 0.75,
    })
    const app = readRackAppearance({ ...rack, metadata: meta })
    expect(app.beamColor).toBe('#00ff00')
    expect(app.showBeams).toBe(true)
    expect(app.levelHeightM).toBe(0.75)
  })

  it('persists and clears per-level heights and pallets-per-bay', () => {
    const rack = pallet()
    const meta = mergeRackAppearance(rack, {
      levelHeights: [1.5, 0.5],
      palletsPerBay: 3,
    })
    expect(meta).toEqual({
      appearance: { levelHeights: [1.5, 0.5], palletsPerBay: 3 },
    })
    const cleared = mergeRackAppearance(
      { ...rack, metadata: meta },
      { levelHeights: null, palletsPerBay: null }
    )
    expect(cleared).toEqual({})
  })
})

describe('levelHeightAt / levelOffsets', () => {
  it('falls back to the uniform height beyond the array', () => {
    const app = {
      ...defaultRackAppearance('pallet'),
      levelHeightM: 0.5,
      levelHeights: [1.5],
    }
    expect(levelHeightAt(app, 0)).toBe(1.5)
    expect(levelHeightAt(app, 1)).toBe(0.5)
  })

  it('builds cumulative deck offsets and the total height', () => {
    const app = {
      ...defaultRackAppearance('pallet'),
      levelHeightM: 0.5,
      levelHeights: [1.5, 1.0],
    }
    const { deckY, heights, total } = levelOffsets(app, 3)
    expect(heights).toEqual([1.5, 1.0, 0.5])
    expect(deckY[0]).toBeCloseTo(0.12) // base deck
    expect(deckY[1]).toBeCloseTo(1.62)
    expect(deckY[2]).toBeCloseTo(2.62)
    expect(total).toBeCloseTo(3.12)
  })

  it('matches the legacy formula when uniform', () => {
    const app = defaultRackAppearance('pallet')
    const { total } = levelOffsets(app, 4)
    expect(total).toBeCloseTo(4 * SHELF_SPACING + 0.12)
  })
})
