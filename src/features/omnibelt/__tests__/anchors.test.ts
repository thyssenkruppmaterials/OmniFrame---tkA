// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  ANCHOR_POSITIONS,
  USER_CORNER_ANCHORS,
  NUB_ANCHORS,
  SNAP_DEADZONE_PX,
  VIEWPORT_GUTTER_PX,
  clampToViewport,
  pickAnchorByZone,
  resolveAnchorPosition,
  snapToNearestAnchor,
  type AnchorName,
} from '../lib/anchors'

const VIEWPORT_W = 1024
const VIEWPORT_H = 768
const WIDGET_W = 220
const WIDGET_H = 44

describe('OmniBelt anchors — constants', () => {
  it('exports 14 AnchorPosition values (12 anchors + FREE + PINNED)', () => {
    expect(ANCHOR_POSITIONS).toHaveLength(14)
    expect(new Set(ANCHOR_POSITIONS).size).toBe(14)
  })

  it('exports the 8 user corner / edge anchors (no nubs, no modes)', () => {
    expect(USER_CORNER_ANCHORS).toEqual([
      'TL',
      'TC',
      'TR',
      'ML',
      'MR',
      'BL',
      'BC',
      'BR',
    ])
  })

  it('exports the 4 edge nubs', () => {
    expect(NUB_ANCHORS).toEqual(['NUB_L', 'NUB_R', 'NUB_T', 'NUB_B'])
  })

  it('exposes the spec-mandated deadzone + gutter constants', () => {
    expect(SNAP_DEADZONE_PX).toBe(32)
    expect(VIEWPORT_GUTTER_PX).toBe(24)
  })
})

describe('OmniBelt anchors — resolveAnchorPosition', () => {
  const baseArgs = {
    offset: { x: 0, y: 0 },
    viewportW: VIEWPORT_W,
    viewportH: VIEWPORT_H,
    widgetW: WIDGET_W,
    widgetH: WIDGET_H,
  }

  it.each<[AnchorName, { x: number; y: number }]>([
    ['TL', { x: 24, y: 24 }],
    ['TC', { x: (1024 - 220) / 2, y: 24 }],
    ['TR', { x: 1024 - 220 - 24, y: 24 }],
    ['ML', { x: 24, y: (768 - 44) / 2 }],
    ['MR', { x: 1024 - 220 - 24, y: (768 - 44) / 2 }],
    ['BL', { x: 24, y: 768 - 44 - 24 }],
    ['BC', { x: (1024 - 220) / 2, y: 768 - 44 - 24 }],
    ['BR', { x: 1024 - 220 - 24, y: 768 - 44 - 24 }],
    ['NUB_L', { x: 0, y: (768 - 44) / 2 }],
    ['NUB_R', { x: 1024 - 220, y: (768 - 44) / 2 }],
    ['NUB_T', { x: (1024 - 220) / 2, y: 0 }],
    ['NUB_B', { x: (1024 - 220) / 2, y: 768 - 44 }],
  ])('resolves %s to its canonical top-left', (anchor, expected) => {
    expect(resolveAnchorPosition({ ...baseArgs, anchor })).toEqual(expected)
  })

  it('FREE uses the offset as absolute coordinates', () => {
    expect(
      resolveAnchorPosition({
        ...baseArgs,
        anchor: 'FREE',
        offset: { x: 200, y: 300 },
      })
    ).toEqual({ x: 200, y: 300 })
  })

  it('PINNED uses the offset as absolute coordinates (same as FREE)', () => {
    expect(
      resolveAnchorPosition({
        ...baseArgs,
        anchor: 'PINNED',
        offset: { x: 99, y: 88 },
      })
    ).toEqual({ x: 99, y: 88 })
  })

  it('applies offset on top of named anchors (collision-avoidance nudge)', () => {
    expect(
      resolveAnchorPosition({
        ...baseArgs,
        anchor: 'BR',
        offset: { x: 0, y: -56 },
      })
    ).toEqual({ x: 1024 - 220 - 24, y: 768 - 44 - 24 - 56 })
  })

  it('clamps an overflow caused by offset back into the viewport', () => {
    expect(
      resolveAnchorPosition({
        ...baseArgs,
        anchor: 'TL',
        offset: { x: -100, y: -200 },
      })
    ).toEqual({ x: 0, y: 0 })
  })
})

describe('OmniBelt anchors — snapToNearestAnchor', () => {
  const baseArgs = {
    viewportW: VIEWPORT_W,
    viewportH: VIEWPORT_H,
    widgetW: WIDGET_W,
    widgetH: WIDGET_H,
  }

  it('snaps to TL when drop near top-left inside deadzone', () => {
    const r = snapToNearestAnchor({ ...baseArgs, dropX: 30, dropY: 30 })
    expect(r.anchor).toBe('TL')
    expect(r.offset).toEqual({ x: 0, y: 0 })
    expect(r).toMatchObject({ x: 24, y: 24 })
  })

  it('snaps to BR when drop near bottom-right inside deadzone', () => {
    const r = snapToNearestAnchor({
      ...baseArgs,
      dropX: VIEWPORT_W - WIDGET_W - VIEWPORT_GUTTER_PX + 5,
      dropY: VIEWPORT_H - WIDGET_H - VIEWPORT_GUTTER_PX + 5,
    })
    expect(r.anchor).toBe('BR')
  })

  it('snaps to NUB_R when drop very close to the right edge', () => {
    // NUB_R sits at x = viewportW - widgetW = 1024 - 220 = 804, y = mid.
    const r = snapToNearestAnchor({
      ...baseArgs,
      dropX: VIEWPORT_W - WIDGET_W + 1,
      dropY: (VIEWPORT_H - WIDGET_H) / 2 + 1,
    })
    expect(r.anchor).toBe('NUB_R')
  })

  it('returns FREE when drop is far from every anchor', () => {
    // Center of the viewport is far from every anchor (more than 32px).
    const cx = VIEWPORT_W / 2
    const cy = VIEWPORT_H / 2
    const r = snapToNearestAnchor({ ...baseArgs, dropX: cx, dropY: cy })
    expect(r.anchor).toBe('FREE')
    expect(r.offset).toEqual({ x: cx, y: cy })
    expect(r.x).toBe(cx)
    expect(r.y).toBe(cy)
  })

  it('uses the custom deadzonePx when provided', () => {
    // A drop ~100 px from BR would normally be FREE; a 200 px deadzone
    // snaps it.
    const r = snapToNearestAnchor({
      ...baseArgs,
      dropX: VIEWPORT_W - WIDGET_W - VIEWPORT_GUTTER_PX - 60,
      dropY: VIEWPORT_H - WIDGET_H - VIEWPORT_GUTTER_PX - 60,
      deadzonePx: 200,
    })
    expect(r.anchor).toBe('BR')
  })

  it('clamps a FREE drop that would overflow the viewport', () => {
    const r = snapToNearestAnchor({
      ...baseArgs,
      dropX: 10_000,
      dropY: 10_000,
    })
    expect(r.anchor).toBe('FREE')
    expect(r.x).toBe(VIEWPORT_W - WIDGET_W)
    expect(r.y).toBe(VIEWPORT_H - WIDGET_H)
  })
})

describe('OmniBelt anchors — pickAnchorByZone', () => {
  it('returns one of the 8 user corner anchors for any (x, y)', () => {
    for (const [x, y] of [
      [0, 0],
      [VIEWPORT_W / 2, VIEWPORT_H / 2],
      [VIEWPORT_W, VIEWPORT_H],
      [-100, -100],
    ]) {
      const a = pickAnchorByZone(
        x,
        y,
        VIEWPORT_W,
        VIEWPORT_H,
        WIDGET_W,
        WIDGET_H
      )
      expect(USER_CORNER_ANCHORS).toContain(a)
    }
  })

  it('maps top-left corner cell to TL', () => {
    expect(
      pickAnchorByZone(20, 20, VIEWPORT_W, VIEWPORT_H, WIDGET_W, WIDGET_H)
    ).toBe('TL')
  })

  it('maps bottom-right corner cell to BR', () => {
    expect(
      pickAnchorByZone(
        VIEWPORT_W - 20,
        VIEWPORT_H - 20,
        VIEWPORT_W,
        VIEWPORT_H,
        WIDGET_W,
        WIDGET_H
      )
    ).toBe('BR')
  })
})

describe('OmniBelt anchors — clampToViewport', () => {
  const dims = {
    widgetW: 100,
    widgetH: 50,
    viewportW: 500,
    viewportH: 400,
  }

  it('leaves a fully-inside rect untouched', () => {
    expect(clampToViewport({ x: 100, y: 100, ...dims })).toEqual({
      x: 100,
      y: 100,
    })
  })

  it('clamps negative coordinates to 0', () => {
    expect(clampToViewport({ x: -100, y: -50, ...dims })).toEqual({
      x: 0,
      y: 0,
    })
  })

  it('clamps overflow on the right and bottom', () => {
    expect(clampToViewport({ x: 9_999, y: 9_999, ...dims })).toEqual({
      x: 400, // 500 - 100
      y: 350, // 400 - 50
    })
  })

  it('handles widgets larger than the viewport gracefully (max=0)', () => {
    expect(
      clampToViewport({
        x: 50,
        y: 50,
        widgetW: 9_999,
        widgetH: 9_999,
        viewportW: 500,
        viewportH: 400,
      })
    ).toEqual({ x: 0, y: 0 })
  })
})

// Created and developed by Jai Singh
