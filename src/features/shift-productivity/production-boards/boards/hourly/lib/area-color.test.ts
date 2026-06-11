// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  AREA_COLOR_HEX,
  NEUTRAL_FALLBACK_HEX,
  accentHexFor,
  accentHexForKey,
  accentRgbaFor,
} from './area-color'
import { AREA_COLOR_KEYS, deriveAreaColor } from './skills'

describe('accentHexFor', () => {
  it('is deterministic — same area_code always returns the same hex', () => {
    const codes = ['OUTBOUND', 'INBOUND', 'PACKING', 'SHIPPING', 'qa']
    for (const code of codes) {
      const a = accentHexFor(code)
      const b = accentHexFor(code)
      const c = accentHexFor(code)
      expect(a).toBe(b)
      expect(b).toBe(c)
      // Must be one of the eight palette hexes (or the neutral fallback,
      // never — known codes always hash into the palette).
      expect(Object.values(AREA_COLOR_HEX)).toContain(a)
    }
  })

  it('two different area_codes can collide on the same hex (8 buckets)', () => {
    // The hash has 8 buckets — with > 8 distinct codes the pigeonhole
    // principle guarantees at least two share a colour. We verify by
    // sampling 32 distinct codes and confirming the produced palette
    // is small (≤ 8 unique hexes) — that's the signal that the hash is
    // bucketing rather than uniquifying.
    const codes = Array.from({ length: 32 }, (_, i) => `AREA_${i}`)
    const hexes = new Set(codes.map((c) => accentHexFor(c)))
    expect(hexes.size).toBeLessThanOrEqual(AREA_COLOR_KEYS.length)
    // And we can find at least one explicit collision pair.
    const seen = new Map<string, string>()
    let collided = false
    for (const c of codes) {
      const h = accentHexFor(c)
      const prior = seen.get(h)
      if (prior && prior !== c) {
        collided = true
        break
      }
      seen.set(h, c)
    }
    expect(collided).toBe(true)
  })

  it('falls back to the neutral slate for empty / null / undefined input', () => {
    expect(accentHexFor('')).toBe(NEUTRAL_FALLBACK_HEX)
    expect(accentHexFor(null)).toBe(NEUTRAL_FALLBACK_HEX)
    expect(accentHexFor(undefined)).toBe(NEUTRAL_FALLBACK_HEX)
  })

  it("matches deriveAreaColor's key → palette mapping for any input", () => {
    const codes = ['OUTBOUND', 'PUTAWAY', 'PICK-A', 'recv-1', 'A']
    for (const c of codes) {
      const key = deriveAreaColor(c)
      expect(accentHexFor(c)).toBe(AREA_COLOR_HEX[key])
    }
  })
})

describe('accentHexForKey', () => {
  it('returns a defined hex for every AreaColorKey', () => {
    for (const k of AREA_COLOR_KEYS) {
      const hex = accentHexForKey(k)
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('accentRgbaFor', () => {
  it('produces a well-formed rgba(...) string with the requested alpha', () => {
    const out = accentRgbaFor('OUTBOUND', 0.18)
    expect(out).toMatch(/^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [0-9.]+\)$/)
    // Alpha appears verbatim (within toFixed(3) trim) in the string.
    expect(out).toContain('0.18')
  })

  it('clamps alpha to [0, 1]', () => {
    const lo = accentRgbaFor('A', -1)
    expect(lo).toMatch(/, 0\)$/)
    const hi = accentRgbaFor('A', 5)
    expect(hi).toMatch(/, 1\)$/)
  })

  it('handles non-finite alpha gracefully (treats as 0)', () => {
    const out = accentRgbaFor('A', Number.NaN)
    expect(out).toMatch(/, 0\)$/)
  })

  it('uses the neutral hex when areaCode is missing', () => {
    const a = accentRgbaFor(null, 0.5)
    // 0x64 = 100, 0x74 = 116, 0x8b = 139 — slate-500.
    expect(a).toBe('rgba(100, 116, 139, 0.5)')
  })
})

// Created and developed by Jai Singh
