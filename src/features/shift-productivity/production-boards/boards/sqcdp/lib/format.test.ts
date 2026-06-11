// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  formatText,
  formatValue,
  formatValueWithOptions,
} from './format'

describe('formatNumber', () => {
  it('renders thousands separators with up to 1 fraction digit', () => {
    expect(formatNumber(1234567.89)).toBe('1,234,567.9')
    expect(formatNumber(42)).toBe('42')
  })

  it('returns em-dash for null / undefined / NaN', () => {
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(undefined)).toBe('—')
    expect(formatNumber(Number.NaN)).toBe('—')
  })
})

describe('formatPercent', () => {
  it('appends the percent sign and trims to 1 fraction digit', () => {
    expect(formatPercent(98.765)).toBe('98.8%')
    expect(formatPercent(0)).toBe('0%')
  })

  it('returns em-dash for missing values', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(Number.NaN)).toBe('—')
  })
})

describe('formatCurrency', () => {
  it('drops decimals once the absolute value crosses the 1000 threshold', () => {
    expect(formatCurrency(1499)).toBe('$1,499')
    expect(formatCurrency(1000)).toBe('$1,000')
  })

  it('keeps cents when below the threshold', () => {
    expect(formatCurrency(12.5)).toBe('$12.50')
    expect(formatCurrency(-12.5)).toBe('-$12.50')
  })

  it('honours an explicit currency code', () => {
    // Different runtimes serialise the symbol slightly differently; assert
    // on the substring instead of an exact match so we don't pin the test
    // to a single ICU revision.
    expect(formatCurrency(2500, 'EUR')).toMatch(/€/)
    expect(formatCurrency(2500, 'EUR')).toMatch(/2,500/)
  })

  it('returns em-dash for missing values', () => {
    expect(formatCurrency(null)).toBe('—')
    expect(formatCurrency(Number.NaN)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('handles the under-1-hour case', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(0)).toBe('0m')
  })

  it('renders the 60-minute boundary as exactly "1h"', () => {
    expect(formatDuration(60)).toBe('1h')
  })

  it('mixes hours + minutes for partials', () => {
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(1440)).toBe('24h')
    expect(formatDuration(90.5)).toBe('1h 31m')
  })

  it('clamps negatives to zero rather than producing odd strings', () => {
    expect(formatDuration(-15)).toBe('0m')
  })

  it('returns em-dash for missing values', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(Number.NaN)).toBe('—')
  })
})

describe('formatText', () => {
  it('passes a non-empty string through unchanged', () => {
    expect(formatText('On track')).toBe('On track')
  })

  it('returns em-dash for empty / null / undefined', () => {
    expect(formatText('')).toBe('—')
    expect(formatText(null)).toBe('—')
    expect(formatText(undefined)).toBe('—')
  })
})

describe('formatValue (dispatcher)', () => {
  it('routes by format and respects the optional unit suffix on numbers', () => {
    expect(formatValue('number', 12.5, 'units')).toBe('12.5 units')
    expect(formatValue('number', 12.5)).toBe('12.5')
  })

  it('uses the unit as the currency code in currency mode', () => {
    expect(formatValue('currency', 7500, 'USD')).toBe('$7,500')
  })

  it('returns em-dash for percent / duration when value is the wrong type', () => {
    expect(formatValue('percent', null)).toBe('—')
    expect(formatValue('duration', null)).toBe('—')
  })

  it('renders text values as-is', () => {
    expect(formatValue('text', 'Manual entry')).toBe('Manual entry')
    expect(formatValue('text', null)).toBe('—')
  })
})

describe('formatValueWithOptions (v12 prefix / suffix / decimal override)', () => {
  it('passes through to formatValue when no options are set', () => {
    expect(formatValueWithOptions('number', 12.5, 'units')).toBe('12.5 units')
    expect(formatValueWithOptions('percent', 98.7)).toBe('98.7%')
  })

  it('prepends a prefix and appends a suffix to the formatted value', () => {
    expect(
      formatValueWithOptions('number', 6.21, null, {
        prefix: '~',
        suffix: ' tons',
      })
    ).toBe('~6.2 tons')
    expect(
      formatValueWithOptions('currency', 12500, 'USD', { suffix: ' /yr' })
    ).toBe('$12,500 /yr')
  })

  it('honours decimal_places for number / percent (sets both min + max)', () => {
    // 12.5 with 2 decimal_places → 12.50 (padded with the trailing zero).
    expect(
      formatValueWithOptions('number', 12.5, null, { decimal_places: 2 })
    ).toBe('12.50')
    // 98.765 with 0 decimal_places → 99 (rounded).
    expect(
      formatValueWithOptions('percent', 98.765, null, { decimal_places: 0 })
    ).toBe('99%')
  })

  it('respects decimal_places + unit + prefix + suffix together', () => {
    expect(
      formatValueWithOptions('number', 1234.5, 'units', {
        prefix: '~',
        suffix: ' tonnes',
        decimal_places: 0,
      })
    ).toBe('~1,235 units tonnes')
  })

  it('does NOT apply prefix / suffix to the em-dash sentinel', () => {
    // Empty values should read as `—`, not `$—` or `— pcs`.
    expect(
      formatValueWithOptions('number', null, null, {
        prefix: '$',
        suffix: ' pcs',
      })
    ).toBe('—')
    expect(
      formatValueWithOptions('percent', undefined, null, { prefix: '~' })
    ).toBe('—')
  })

  it('skips decimal override for non-numeric formats and falls back to formatValue', () => {
    expect(
      formatValueWithOptions('text', 'on track', null, { decimal_places: 2 })
    ).toBe('on track')
    // Currency is intentionally NOT decimal-overridden; the dispatcher's
    // own ≥1000 → 0-frac-digits rule wins.
    expect(
      formatValueWithOptions('currency', 12500, 'USD', { decimal_places: 4 })
    ).toBe('$12,500')
  })
})

// Created and developed by Jai Singh
