// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  STYLE_DASH,
  computeAverage,
  findExtremes,
  parseChartConfig,
  resolveGoalLine,
  resolveTargetLine,
  type GoalLine,
} from './chart-config'

const ACCENT = '#10b981'

describe('resolveTargetLine', () => {
  it('falls back to the accent color when target_line is absent', () => {
    const out = resolveTargetLine(undefined, ACCENT)
    expect(out.color).toBe(ACCENT)
    expect(out.style).toBe('dashed')
    expect(out.width).toBe(1)
    expect(out.showLabel).toBe(false)
  })

  it('falls back to accent when target_line.color_hex is null', () => {
    const out = resolveTargetLine(
      { target_line: { color_hex: null, style: 'solid' } },
      ACCENT
    )
    expect(out.color).toBe(ACCENT)
    expect(out.style).toBe('solid')
  })

  it('honours every override when present', () => {
    const out = resolveTargetLine(
      {
        target_line: {
          color_hex: '#ff0000',
          style: 'dotted',
          width: 3,
          show_label: true,
        },
      },
      ACCENT
    )
    expect(out.color).toBe('#ff0000')
    expect(out.style).toBe('dotted')
    expect(out.width).toBe(3)
    expect(out.showLabel).toBe(true)
  })
})

describe('resolveGoalLine', () => {
  it('defaults style to dashed and width to 1 when missing', () => {
    const goal: GoalLine = { id: 'g1', value: 80 }
    const out = resolveGoalLine(goal, ACCENT)
    expect(out.style).toBe('dashed')
    expect(out.width).toBe(1)
    expect(out.color).toBe(ACCENT)
  })

  it('keeps explicit style + width when set', () => {
    const goal: GoalLine = {
      id: 'g2',
      value: 30,
      color_hex: '#dc2626',
      style: 'dotted',
      width: 2,
    }
    const out = resolveGoalLine(goal, ACCENT)
    expect(out.style).toBe('dotted')
    expect(out.width).toBe(2)
    expect(out.color).toBe('#dc2626')
  })

  it('falls back to accent when color_hex is null', () => {
    const goal: GoalLine = { id: 'g3', value: 50, color_hex: null }
    expect(resolveGoalLine(goal, ACCENT).color).toBe(ACCENT)
  })
})

describe('computeAverage', () => {
  it('returns null for empty history', () => {
    expect(computeAverage([])).toBeNull()
  })

  it('computes the arithmetic mean for a single point', () => {
    expect(computeAverage([{ value: 42 }])).toBe(42)
  })

  it('computes the arithmetic mean for multiple points', () => {
    expect(computeAverage([{ value: 1 }, { value: 2 }, { value: 3 }])).toBe(2)
    expect(computeAverage([{ value: 10 }, { value: 20 }])).toBe(15)
    expect(computeAverage([{ value: 0 }, { value: 100 }])).toBe(50)
  })
})

describe('findExtremes', () => {
  it('returns nulls for empty history', () => {
    expect(findExtremes([])).toEqual({ min: null, max: null })
  })

  it('returns the same point for both ends with a single datum', () => {
    const out = findExtremes([{ value: 7, recordedAt: '2026-05-01' }])
    expect(out.min?.value).toBe(7)
    expect(out.max?.value).toBe(7)
  })

  it('finds the correct min and max across multiple points', () => {
    const out = findExtremes([
      { value: 5, recordedAt: '2026-04-01' },
      { value: 1, recordedAt: '2026-04-15' },
      { value: 9, recordedAt: '2026-05-01' },
      { value: 3, recordedAt: '2026-05-08' },
    ])
    expect(out.min?.value).toBe(1)
    expect(out.min?.recordedAt).toBe('2026-04-15')
    expect(out.max?.value).toBe(9)
    expect(out.max?.recordedAt).toBe('2026-05-01')
  })

  it('handles negative values', () => {
    const out = findExtremes([
      { value: -5, recordedAt: '2026-01-01' },
      { value: -10, recordedAt: '2026-01-02' },
      { value: -1, recordedAt: '2026-01-03' },
    ])
    expect(out.min?.value).toBe(-10)
    expect(out.max?.value).toBe(-1)
  })
})

describe('STYLE_DASH', () => {
  it('maps solid to undefined (continuous stroke)', () => {
    expect(STYLE_DASH.solid).toBeUndefined()
  })

  it('maps dashed to a 4 4 pattern', () => {
    expect(STYLE_DASH.dashed).toBe('4 4')
  })

  it('maps dotted to a 2 4 pattern', () => {
    expect(STYLE_DASH.dotted).toBe('2 4')
  })
})

describe('parseChartConfig', () => {
  it('returns an empty object for null / non-object inputs', () => {
    expect(parseChartConfig(null)).toEqual({})
    expect(parseChartConfig(undefined)).toEqual({})
    expect(parseChartConfig('string')).toEqual({})
    expect(parseChartConfig(42)).toEqual({})
    expect(parseChartConfig([])).toEqual({})
  })

  it('keeps only valid goal_lines and drops entries missing id / value', () => {
    const out = parseChartConfig({
      goal_lines: [
        { id: 'g1', value: 80, label: 'Stretch' },
        { id: '', value: 1 },
        { value: 1 },
        { id: 'g2', value: 'nope' },
        { id: 'g3', value: 30, color_hex: '#abc', style: 'dotted', width: 2 },
        { id: 'g4', value: 5, style: 'bogus', width: 99 },
      ],
    })
    expect(out.goal_lines?.length).toBe(3)
    expect(out.goal_lines?.[0]).toEqual({
      id: 'g1',
      value: 80,
      label: 'Stretch',
    })
    expect(out.goal_lines?.[1]).toEqual({
      id: 'g3',
      value: 30,
      color_hex: '#abc',
      style: 'dotted',
      width: 2,
    })
    expect(out.goal_lines?.[2]).toEqual({ id: 'g4', value: 5 })
  })

  it('parses target_line with valid fields and drops bogus enums', () => {
    const out = parseChartConfig({
      target_line: {
        color_hex: '#22c55e',
        style: 'solid',
        width: 3,
        show_label: true,
        unknown: 'x',
      },
    })
    expect(out.target_line).toEqual({
      color_hex: '#22c55e',
      style: 'solid',
      width: 3,
      show_label: true,
    })
  })

  it('parses y_axis with mixed numeric and null bounds', () => {
    const out = parseChartConfig({
      y_axis: { show: true, min: 0, max: null },
    })
    expect(out.y_axis).toEqual({ show: true, min: 0, max: null })
  })

  it('parses grid + curve + show_average + highlight_extremes booleans', () => {
    const out = parseChartConfig({
      grid: { show_horizontal: false, show_vertical: true },
      curve: 'step',
      show_average: true,
      highlight_extremes: true,
    })
    expect(out.grid).toEqual({ show_horizontal: false, show_vertical: true })
    expect(out.curve).toBe('step')
    expect(out.show_average).toBe(true)
    expect(out.highlight_extremes).toBe(true)
  })

  it('clamps grid.opacity into the [0, 50] range and rounds to integer', () => {
    expect(parseChartConfig({ grid: { opacity: 12 } }).grid?.opacity).toBe(12)
    expect(parseChartConfig({ grid: { opacity: 12.6 } }).grid?.opacity).toBe(13)
    expect(parseChartConfig({ grid: { opacity: 999 } }).grid?.opacity).toBe(50)
    expect(parseChartConfig({ grid: { opacity: -8 } }).grid?.opacity).toBe(0)
    // Non-numeric: drop the field silently.
    expect(
      parseChartConfig({ grid: { opacity: 'bright' as unknown as number } })
        .grid?.opacity
    ).toBeUndefined()
  })

  it('drops invalid curve enum values', () => {
    const out = parseChartConfig({ curve: 'wiggle' })
    expect(out.curve).toBeUndefined()
  })
})

// Created and developed by Jai Singh
