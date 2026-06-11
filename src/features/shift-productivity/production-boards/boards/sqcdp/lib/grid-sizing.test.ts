// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import { resolveGridSizing } from './grid-sizing'

describe('SQCDP grid — resolveGridSizing', () => {
  it('5 + 4 (canonical) → flex-8 / flex-4 with grid-cols-5 / grid-cols-4', () => {
    const r = resolveGridSizing(5, 4)
    expect(r.primaryColsClass).toBe('grid-cols-5')
    expect(r.primaryFlexClass).toBe('flex-8')
    expect(r.secondaryColsClass).toBe('grid-cols-4')
    expect(r.secondaryFlexClass).toBe('flex-4')
  })

  it('clamps both dimensions at the maxima (6 cols, 8 flex)', () => {
    const r = resolveGridSizing(10, 12)
    expect(r.primaryColsClass).toBe('grid-cols-6')
    expect(r.primaryFlexClass).toBe('flex-8')
    expect(r.secondaryColsClass).toBe('grid-cols-6')
    expect(r.secondaryFlexClass).toBe('flex-8')
  })

  it('zero secondary returns empty flex class so the row is hidden', () => {
    const r = resolveGridSizing(3, 0)
    expect(r.secondaryFlexClass).toBe('')
  })

  it('zero primary returns empty flex class', () => {
    const r = resolveGridSizing(0, 4)
    expect(r.primaryFlexClass).toBe('')
    expect(r.secondaryFlexClass).toBe('flex-4')
  })

  it('1.5x multiplier on primary tier (1 → 2, 2 → 3, 3 → 5)', () => {
    expect(resolveGridSizing(1, 0).primaryFlexClass).toBe('flex-2')
    expect(resolveGridSizing(2, 0).primaryFlexClass).toBe('flex-3')
    expect(resolveGridSizing(3, 0).primaryFlexClass).toBe('flex-5')
  })

  it('every emitted col + flex class is a real Tailwind utility token', () => {
    // Tailwind v4 JIT can't see template-literal class strings; the
    // class maps in `grid-sizing.ts` enumerate the tokens explicitly so
    // the JIT picks them up. This test guards against drift.
    for (let n = 1; n <= 8; n++) {
      const r = resolveGridSizing(n, n)
      expect(r.primaryColsClass).toMatch(/^grid-cols-\d$/)
      expect(r.secondaryColsClass).toMatch(/^grid-cols-\d$/)
      expect(r.primaryFlexClass).toMatch(/^flex-\d$/)
      expect(r.secondaryFlexClass).toMatch(/^flex-\d$/)
    }
  })
})

// Created and developed by Jai Singh
