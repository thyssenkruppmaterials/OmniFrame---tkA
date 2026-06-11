// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  CARD_VARIANTS,
  GALLERY_DEFAULT_INTERVAL_S,
  VARIANT_DEFAULT_SIZE,
  clampSizeForVariant,
  parseCardVariant,
  parseVariantConfig,
} from './card-variant'

describe('parseCardVariant', () => {
  it.each(CARD_VARIANTS)('accepts canonical variant %s', (v) => {
    expect(parseCardVariant(v)).toBe(v)
  })

  it('falls back to classic on unknown input', () => {
    expect(parseCardVariant('xxx')).toBe('classic')
    expect(parseCardVariant(null)).toBe('classic')
    expect(parseCardVariant(123)).toBe('classic')
  })
})

describe('parseVariantConfig', () => {
  it('returns empty object for variants without config', () => {
    expect(parseVariantConfig('classic', { foo: 'bar' })).toEqual({})
    expect(parseVariantConfig('quote', { foo: 'bar' })).toEqual({})
    expect(parseVariantConfig('spotlight', { foo: 'bar' })).toEqual({})
  })

  it('parses banner cover_position', () => {
    expect(parseVariantConfig('banner', { cover_position: 'top' })).toEqual({
      cover_position: 'top',
    })
    expect(parseVariantConfig('banner', { cover_position: 'middle' })).toEqual(
      {}
    )
  })

  it('parses gallery rotate_interval_seconds within range', () => {
    expect(
      parseVariantConfig('gallery', { rotate_interval_seconds: 10 })
    ).toEqual({ rotate_interval_seconds: 10 })
  })

  it('drops gallery interval outside the 3..30 range', () => {
    expect(
      parseVariantConfig('gallery', { rotate_interval_seconds: 1 })
    ).toEqual({})
    expect(
      parseVariantConfig('gallery', { rotate_interval_seconds: 100 })
    ).toEqual({})
  })

  it('rounds gallery interval to integer seconds', () => {
    expect(
      parseVariantConfig('gallery', { rotate_interval_seconds: 6.4 })
    ).toEqual({ rotate_interval_seconds: 6 })
  })

  it('tolerates malformed input', () => {
    expect(parseVariantConfig('banner', null)).toEqual({})
    expect(parseVariantConfig('banner', 'oops')).toEqual({})
    expect(parseVariantConfig('banner', [1, 2])).toEqual({})
  })
})

describe('clampSizeForVariant', () => {
  it('clamps below min width', () => {
    const { w } = clampSizeForVariant('banner', 1, 3, 12)
    expect(w).toBeGreaterThanOrEqual(6)
  })

  it('clamps above max width', () => {
    const { w } = clampSizeForVariant('classic', 99, 3, 12)
    expect(w).toBeLessThanOrEqual(6)
  })

  it('caps to total cols when smaller than variant max', () => {
    const { w } = clampSizeForVariant('banner', 12, 3, 6)
    expect(w).toBeLessThanOrEqual(6)
  })

  it('rounds non-integer input', () => {
    const { w } = clampSizeForVariant('gallery', 5.7, 4, 12)
    expect(Number.isInteger(w)).toBe(true)
  })
})

describe('constants sanity', () => {
  it('every variant has a default size', () => {
    for (const v of CARD_VARIANTS) {
      expect(VARIANT_DEFAULT_SIZE[v].w).toBeGreaterThan(0)
      expect(VARIANT_DEFAULT_SIZE[v].h).toBeGreaterThan(0)
    }
  })

  it('default gallery interval is in range', () => {
    expect(GALLERY_DEFAULT_INTERVAL_S).toBeGreaterThanOrEqual(3)
    expect(GALLERY_DEFAULT_INTERVAL_S).toBeLessThanOrEqual(30)
  })
})

// Created and developed by Jai Singh
