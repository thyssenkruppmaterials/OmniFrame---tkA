// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  autoPlaceCards,
  clampDragTo,
  defaultLayoutForVariant,
  findFreeSlot,
} from './bento-layout'
import type { BoardCard, CardVariant } from './card-variant'

function makeCard(
  id: string,
  variant: CardVariant,
  isDefault: boolean,
  x = 0,
  y = 0,
  w = 0,
  h = 0
): BoardCard {
  return {
    layoutId: isDefault ? null : `layout-${id}`,
    postKind: 'post',
    post: {
      id,
      title: `t-${id}`,
      severity: 'info',
      publishedAt: '2026-01-01T00:00:00Z',
    } as unknown as BoardCard['post'],
    gridX: x,
    gridY: y,
    gridW: w,
    gridH: h,
    cardVariant: variant,
    variantConfig: {},
    isDefaultLayout: isDefault,
  }
}

describe('autoPlaceCards', () => {
  it('returns empty for no cards', () => {
    expect(autoPlaceCards([], 12)).toEqual([])
  })

  it('respects persisted card positions', () => {
    const cards = [
      makeCard('a', 'classic', false, 3, 1, 4, 2),
      makeCard('b', 'classic', false, 0, 0, 3, 2),
    ]
    const out = autoPlaceCards(cards, 12)
    const a = out.find((c) => c.post.id === 'a')!
    expect(a.gridX).toBe(3)
    expect(a.gridY).toBe(1)
    expect(a.gridW).toBe(4)
    expect(a.gridH).toBe(2)
  })

  it('places default cards in the first free slot', () => {
    // Persisted card holds cells (0,0)-(3,2). Default card should land
    // beside it at x=3 (not on top).
    const cards = [
      makeCard('persisted', 'classic', false, 0, 0, 3, 2),
      makeCard('def', 'classic', true),
    ]
    const out = autoPlaceCards(cards, 12)
    const def = out.find((c) => c.post.id === 'def')!
    expect(def.gridX).toBeGreaterThanOrEqual(3)
    expect(def.gridY).toBe(0)
  })

  it('uses variant default size for default cards', () => {
    const cards = [makeCard('a', 'banner', true)]
    const out = autoPlaceCards(cards, 12)
    expect(out[0].gridW).toBe(12)
    expect(out[0].gridH).toBe(3)
  })

  it('clamps persisted card x so it fits in the grid', () => {
    // x=10, w=4 in a 12-col grid would overflow. Clamp to x=8.
    const cards = [makeCard('a', 'classic', false, 10, 0, 4, 2)]
    const out = autoPlaceCards(cards, 12)
    expect(out[0].gridX).toBe(8)
  })

  it('truncates persisted card w to the grid width', () => {
    const cards = [makeCard('a', 'banner', false, 0, 0, 20, 3)]
    const out = autoPlaceCards(cards, 12)
    expect(out[0].gridW).toBe(12)
  })
})

describe('findFreeSlot', () => {
  it('finds (0,0) on an empty grid', () => {
    expect(findFreeSlot([], 12, 3, 2)).toEqual({ x: 0, y: 0 })
  })

  it('finds the first row that fits', () => {
    const placed = [{ x: 0, y: 0, w: 12, h: 1 }]
    expect(findFreeSlot(placed, 12, 3, 1)).toEqual({ x: 0, y: 1 })
  })

  it('finds horizontal slot beside an existing card', () => {
    const placed = [{ x: 0, y: 0, w: 3, h: 2 }]
    expect(findFreeSlot(placed, 12, 3, 2)).toEqual({ x: 3, y: 0 })
  })
})

describe('clampDragTo', () => {
  it('clamps x so the card fits in the grid', () => {
    // classic max w = 6, so x = 7, w = 6 would overflow on a 12-col
    // grid (7+6 = 13). Should clamp to x=6.
    const { x } = clampDragTo('classic', 7, 0, 6, 2, 12)
    expect(x).toBe(6)
  })

  it('clamps y to >= 0', () => {
    const { y } = clampDragTo('classic', 0, -3, 3, 2, 12)
    expect(y).toBe(0)
  })
})

describe('defaultLayoutForVariant', () => {
  it('returns banner default size', () => {
    expect(defaultLayoutForVariant('banner')).toEqual({
      gridX: 0,
      gridY: 0,
      gridW: 12,
      gridH: 3,
    })
  })

  it('returns classic default size', () => {
    expect(defaultLayoutForVariant('classic')).toEqual({
      gridX: 0,
      gridY: 0,
      gridW: 3,
      gridH: 2,
    })
  })
})

// Created and developed by Jai Singh
