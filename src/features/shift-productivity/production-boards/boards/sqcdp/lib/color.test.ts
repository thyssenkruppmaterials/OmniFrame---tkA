// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import { hexToRgba } from './color'

describe('hexToRgba', () => {
  it('converts a 6-digit hex to rgba with the supplied alpha', () => {
    expect(hexToRgba('#10b981', 0.45)).toBe('rgba(16, 185, 129, 0.45)')
  })

  it('accepts 3-digit shorthand hex', () => {
    expect(hexToRgba('#fff', 1)).toBe('rgba(255, 255, 255, 1)')
    expect(hexToRgba('#000', 0)).toBe('rgba(0, 0, 0, 0)')
  })

  it('accepts hex without leading #', () => {
    expect(hexToRgba('DC2626', 0.5)).toBe('rgba(220, 38, 38, 0.5)')
  })

  it('clamps alpha into [0, 1]', () => {
    expect(hexToRgba('#000000', -0.5)).toBe('rgba(0, 0, 0, 0)')
    expect(hexToRgba('#000000', 2)).toBe('rgba(0, 0, 0, 1)')
  })

  it('treats non-finite alpha as 0', () => {
    expect(hexToRgba('#10b981', Number.NaN)).toBe('rgba(16, 185, 129, 0)')
  })

  it('falls back to opaque black on malformed input', () => {
    expect(hexToRgba('not-a-hex', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
    expect(hexToRgba('#zzzzzz', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
    expect(hexToRgba('', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('trims trailing zeros in alpha for compact rgba output', () => {
    expect(hexToRgba('#10b981', 0.5)).toBe('rgba(16, 185, 129, 0.5)')
    expect(hexToRgba('#10b981', 0.1)).toBe('rgba(16, 185, 129, 0.1)')
  })
})

// Created and developed by Jai Singh
