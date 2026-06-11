// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import { cssColorToHex } from './css-color'

describe('cssColorToHex', () => {
  it('passes 6-digit hex through untouched (no DOM work)', () => {
    expect(cssColorToHex('#3b82f6')).toBe('#3b82f6')
    expect(cssColorToHex('#ABCDEF')).toBe('#ABCDEF')
  })

  it('falls back when the color cannot be resolved to pixels', () => {
    // jsdom has no 2d canvas context, so anything non-hex takes the
    // fallback path — the important part is it never throws and never
    // returns an invalid value for <input type="color">.
    expect(cssColorToHex('var(--card)')).toBe('#000000')
    expect(cssColorToHex('var(--border)', '#1e293b')).toBe('#1e293b')
  })
})
