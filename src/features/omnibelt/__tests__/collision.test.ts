// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  avoidCollisions,
  rectsOverlap,
  rectsOverlapAreaPx,
  type Rect,
} from '../lib/collision'

describe('OmniBelt collision — rectsOverlap', () => {
  const a: Rect = { x: 0, y: 0, w: 100, h: 100 }

  it('returns true when rects overlap', () => {
    expect(rectsOverlap(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true)
  })

  it('returns false when rects only touch at the edge', () => {
    // Default padding is 0 and edge-touching contributes 0 overlap.
    expect(rectsOverlap(a, { x: 100, y: 0, w: 50, h: 100 })).toBe(false)
  })

  it('returns false when rects are disjoint', () => {
    expect(rectsOverlap(a, { x: 200, y: 200, w: 50, h: 50 })).toBe(false)
  })

  it('respects a paddingPx threshold (small overlaps ignored)', () => {
    // 2 px overlap; with padding 4 px → ignored.
    expect(rectsOverlap(a, { x: 98, y: 0, w: 50, h: 100 }, 4)).toBe(false)
  })

  it('counts a >4 px overlap when padding is 4', () => {
    expect(rectsOverlap(a, { x: 90, y: 0, w: 50, h: 100 }, 4)).toBe(true)
  })
})

describe('OmniBelt collision — rectsOverlapAreaPx', () => {
  it('returns the overlap area in px²', () => {
    expect(
      rectsOverlapAreaPx(
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 50, y: 50, w: 100, h: 100 }
      )
    ).toBe(50 * 50)
  })

  it('returns 0 for disjoint rects', () => {
    expect(
      rectsOverlapAreaPx(
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 200, y: 0, w: 100, h: 100 }
      )
    ).toBe(0)
  })
})

describe('OmniBelt collision — avoidCollisions', () => {
  it('returns the input unchanged when there are no competing rects', () => {
    const widget = { x: 100, y: 100, w: 50, h: 50 }
    const r = avoidCollisions({ widget, competing: [] })
    expect(r.adjustedRect).toEqual(widget)
    expect(r.reason).toBe('no_overlap')
  })

  it('returns the input unchanged when overlap is below threshold', () => {
    const widget = { x: 100, y: 100, w: 50, h: 50 }
    // 2 px overlap with the toaster — under the default 4 px threshold.
    const competing = [{ x: 148, y: 100, w: 50, h: 50 }]
    const r = avoidCollisions({ widget, competing })
    expect(r.adjustedRect).toEqual(widget)
    expect(r.reason).toBe('no_overlap')
  })

  it('offsets the widget when overlap exceeds the threshold', () => {
    // Toaster sits directly under the widget (full overlap), 56 px step
    // should clear it in one move.
    const widget = { x: 100, y: 100, w: 100, h: 50 }
    const competing = [{ x: 100, y: 100, w: 100, h: 50 }]
    const r = avoidCollisions({ widget, competing })
    expect(r.adjustedRect).not.toEqual(widget)
    expect(r.reason).toMatch(/^avoided:/)
  })

  it('picks the direction with the smallest residual overlap', () => {
    // A toaster filling the top-half of the viewport — moving "down"
    // produces zero residual overlap, while up/left/right still
    // collide.
    const widget = { x: 100, y: 100, w: 100, h: 100 }
    const competing = [{ x: 0, y: 0, w: 1024, h: 150 }] // top ribbon
    const r = avoidCollisions({ widget, competing, offsetStepPx: 100 })
    expect(r.reason).toBe('avoided:down')
    expect(r.adjustedRect.y).toBe(200) // 100 + 100
  })

  it('handles cascading overlaps without infinite loops', () => {
    const widget = { x: 0, y: 0, w: 50, h: 50 }
    // Two stacked competing rects — first step pushes us into the
    // second; the algorithm must keep offsetting.
    const competing = [
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 60, y: 0, w: 50, h: 50 },
    ]
    const r = avoidCollisions({ widget, competing })
    expect(r.reason).toMatch(/^avoided:/)
    // The final rect must not overlap either competing rect.
    expect(rectsOverlap(r.adjustedRect, competing[0], 4)).toBe(false)
    expect(rectsOverlap(r.adjustedRect, competing[1], 4)).toBe(false)
  })

  it('uses the configured offsetStepPx', () => {
    const widget = { x: 100, y: 100, w: 100, h: 100 }
    const competing = [{ x: 100, y: 100, w: 100, h: 100 }]
    const r = avoidCollisions({ widget, competing, offsetStepPx: 200 })
    // 200 px step → adjusted rect should be 200 px away in at least
    // one axis.
    const dx = Math.abs(r.adjustedRect.x - 100)
    const dy = Math.abs(r.adjustedRect.y - 100)
    expect(Math.max(dx, dy)).toBe(200)
  })
})

// Created and developed by Jai Singh
