// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  computeAutoValue,
  isAutoValueActive,
  parseAutoValueConfig,
  tickIntervalFor,
  type AutoValueConfig,
} from './auto-value'

describe('isAutoValueActive', () => {
  it('returns false for empty / nullish input', () => {
    expect(isAutoValueActive(null)).toBe(false)
    expect(isAutoValueActive(undefined)).toBe(false)
    expect(isAutoValueActive({})).toBe(false)
  })

  it('returns false when mode is unknown', () => {
    expect(
      isAutoValueActive({
        mode: 'bogus' as unknown as AutoValueConfig['mode'],
        anchor_at: '2024-01-01T00:00:00Z',
      })
    ).toBe(false)
  })

  it('returns false when anchor_at is missing or unparseable', () => {
    expect(isAutoValueActive({ mode: 'count_up_days' })).toBe(false)
    expect(
      isAutoValueActive({ mode: 'count_up_days', anchor_at: 'not a date' })
    ).toBe(false)
    expect(isAutoValueActive({ mode: 'count_up_days', anchor_at: null })).toBe(
      false
    )
  })

  it('returns true for valid config', () => {
    expect(
      isAutoValueActive({
        mode: 'count_up_days',
        anchor_at: '2024-01-01T00:00:00Z',
      })
    ).toBe(true)
  })
})

describe('computeAutoValue — days', () => {
  it('returns null when inactive', () => {
    expect(computeAutoValue(null)).toBeNull()
    expect(computeAutoValue({})).toBeNull()
    expect(computeAutoValue({ mode: 'count_up_days' })).toBeNull()
  })

  it('counts calendar days with default midnight floor', () => {
    // Anchor: 2024-01-13 13:00 local (the floor-to-midnight should
    // collapse this to 2024-01-13 00:00). Now: 2024-01-16 06:00 local
    // (floor to 2024-01-16 00:00) → exactly 3 days.
    const anchor = new Date(2024, 0, 13, 13, 0, 0).toISOString()
    const now = new Date(2024, 0, 16, 6, 0, 0).getTime()
    expect(
      computeAutoValue({ mode: 'count_up_days', anchor_at: anchor }, now)
    ).toBe(3)
  })

  it('honours floor_to_midnight=false (24h rolling)', () => {
    // Anchor: 2024-01-13 12:00. Now: 2024-01-14 11:59. Without
    // calendar floor the delta is 23h59m → 0 days.
    const anchor = new Date(2024, 0, 13, 12, 0, 0).toISOString()
    const now = new Date(2024, 0, 14, 11, 59, 0).getTime()
    expect(
      computeAutoValue(
        {
          mode: 'count_up_days',
          anchor_at: anchor,
          floor_to_midnight: false,
        },
        now
      )
    ).toBe(0)
  })

  it('clamps to 0 for an anchor in the future', () => {
    const anchor = new Date(2099, 0, 1).toISOString()
    expect(
      computeAutoValue(
        { mode: 'count_up_days', anchor_at: anchor },
        new Date(2024, 0, 1).getTime()
      )
    ).toBe(0)
  })

  it('matches the same-day case (0 Days since this morning)', () => {
    const anchor = new Date(2024, 0, 13, 8, 0, 0).toISOString()
    const now = new Date(2024, 0, 13, 17, 0, 0).getTime()
    expect(
      computeAutoValue({ mode: 'count_up_days', anchor_at: anchor }, now)
    ).toBe(0)
  })
})

describe('computeAutoValue — hours', () => {
  it('floors to integer hours', () => {
    const anchor = new Date(2024, 0, 13, 8, 0, 0).toISOString()
    const now = new Date(2024, 0, 13, 11, 30, 0).getTime()
    expect(
      computeAutoValue({ mode: 'count_up_hours', anchor_at: anchor }, now)
    ).toBe(3)
  })
})

describe('computeAutoValue — weeks', () => {
  it('counts whole weeks elapsed', () => {
    const anchor = new Date(2024, 0, 1).toISOString()
    const now = new Date(2024, 0, 22).getTime()
    expect(
      computeAutoValue({ mode: 'count_up_weeks', anchor_at: anchor }, now)
    ).toBe(3)
  })

  it('partial week reads as the lower whole week', () => {
    const anchor = new Date(2024, 0, 1).toISOString()
    const now = new Date(2024, 0, 6).getTime() // 5 days later
    expect(
      computeAutoValue({ mode: 'count_up_weeks', anchor_at: anchor }, now)
    ).toBe(0)
  })
})

describe('computeAutoValue — months', () => {
  it('counts full calendar months with day-of-month rollover', () => {
    const anchor = new Date(2024, 0, 13).toISOString()
    // 2024-04-13 → exactly 3 months.
    expect(
      computeAutoValue(
        { mode: 'count_up_months', anchor_at: anchor },
        new Date(2024, 3, 13).getTime()
      )
    ).toBe(3)
    // 2024-04-12 → still 2 months, hasn't reached the day yet.
    expect(
      computeAutoValue(
        { mode: 'count_up_months', anchor_at: anchor },
        new Date(2024, 3, 12).getTime()
      )
    ).toBe(2)
  })

  it('crosses year boundaries', () => {
    const anchor = new Date(2023, 9, 15).toISOString() // Oct 15 2023
    expect(
      computeAutoValue(
        { mode: 'count_up_months', anchor_at: anchor },
        new Date(2024, 0, 15).getTime() // Jan 15 2024
      )
    ).toBe(3)
  })
})

describe('parseAutoValueConfig', () => {
  it('returns {} for nullish / non-object input', () => {
    expect(parseAutoValueConfig(null)).toEqual({})
    expect(parseAutoValueConfig(undefined)).toEqual({})
    expect(parseAutoValueConfig('string')).toEqual({})
    expect(parseAutoValueConfig(42)).toEqual({})
    expect(parseAutoValueConfig([])).toEqual({})
  })

  it('drops unknown mode values silently', () => {
    expect(parseAutoValueConfig({ mode: 'count_sideways' })).toEqual({})
  })

  it('drops unparseable anchor_at strings', () => {
    expect(
      parseAutoValueConfig({ mode: 'count_up_days', anchor_at: 'never' })
    ).toEqual({ mode: 'count_up_days' })
  })

  it('keeps the full shape when valid', () => {
    const cfg = {
      mode: 'count_up_days',
      anchor_at: '2024-01-13T00:00:00.000Z',
      floor_to_midnight: false,
      extra_garbage: 'ignored',
    }
    expect(parseAutoValueConfig(cfg)).toEqual({
      mode: 'count_up_days',
      anchor_at: '2024-01-13T00:00:00.000Z',
      floor_to_midnight: false,
    })
  })
})

describe('tickIntervalFor', () => {
  it('uses 60s for days/hours', () => {
    expect(tickIntervalFor('count_up_days')).toBe(60_000)
    expect(tickIntervalFor('count_up_hours')).toBe(60_000)
  })

  it('uses 5 minutes for weeks/months', () => {
    expect(tickIntervalFor('count_up_weeks')).toBe(300_000)
    expect(tickIntervalFor('count_up_months')).toBe(300_000)
  })

  it('defaults to 60s for undefined', () => {
    expect(tickIntervalFor(undefined)).toBe(60_000)
  })
})

// Created and developed by Jai Singh
