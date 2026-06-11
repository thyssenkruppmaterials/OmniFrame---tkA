// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  ALIGN_CLASS,
  DEFAULT_HEADER,
  DEFAULT_STYLES,
  FONT_FAMILY_CLASS,
  HEADER_ALIGN_CLASS,
  HEADER_HEIGHT_CLASS,
  LETTER_SPACING_CLASS,
  SIZE_CLASS,
  SIZE_POINTS,
  SIZE_PT_MAX,
  SIZE_PT_MIN,
  WEIGHT_CLASS,
  clampPt,
  fieldClasses,
  fieldColor,
  fieldInlineStyle,
  formatSizePoints,
  headerClasses,
  isSizePinned,
  parseStyleConfig,
  type FieldStyle,
  type FontSize,
} from './style-config'

describe('fieldClasses', () => {
  it('returns the defaults when no override is provided', () => {
    const out = fieldClasses(undefined, DEFAULT_STYLES.primary)
    // primary defaults: sans / 7xl / black / none
    expect(out).toContain('font-sans')
    expect(out).toContain('text-7xl')
    expect(out).toContain('font-black')
    expect(out).not.toContain('uppercase')
  })

  it('merges a partial override on top of the defaults', () => {
    const override: FieldStyle = { size: '5xl' }
    const out = fieldClasses(override, DEFAULT_STYLES.primary)
    expect(out).toContain('font-sans')
    expect(out).toContain('text-5xl')
    expect(out).not.toContain('text-7xl')
    expect(out).toContain('font-black')
  })

  it('honours a full override that swaps every field', () => {
    const override: FieldStyle = {
      font: 'mono',
      size: '6xl',
      weight: 'medium',
      transform: 'uppercase',
    }
    const out = fieldClasses(override, DEFAULT_STYLES.primary)
    expect(out).toContain('font-mono')
    expect(out).toContain('text-6xl')
    expect(out).toContain('font-medium')
    expect(out).toContain('uppercase')
    expect(out).not.toContain('font-sans')
    expect(out).not.toContain('text-7xl')
    expect(out).not.toContain('font-black')
  })

  it('applies transform classes (uppercase / capitalize) when set', () => {
    const upper = fieldClasses(
      { transform: 'uppercase' },
      DEFAULT_STYLES.subtitle
    )
    const cap = fieldClasses(
      { transform: 'capitalize' },
      DEFAULT_STYLES.subtitle
    )
    const none = fieldClasses({ transform: 'none' }, DEFAULT_STYLES.subtitle)
    expect(upper).toContain('uppercase')
    expect(cap).toContain('capitalize')
    expect(none).not.toContain('uppercase')
    expect(none).not.toContain('capitalize')
  })
})

describe('class-name maps are exhaustive and JIT-safe (literal strings)', () => {
  it('SIZE_CLASS maps every size to a literal `text-*` class', () => {
    for (const [k, v] of Object.entries(SIZE_CLASS)) {
      expect(v).toBe(`text-${k}`)
    }
  })

  it('WEIGHT_CLASS maps every weight to a literal `font-*` class', () => {
    for (const [k, v] of Object.entries(WEIGHT_CLASS)) {
      expect(v).toBe(`font-${k}`)
    }
  })

  it('FONT_FAMILY_CLASS only references real Tailwind utilities', () => {
    expect(FONT_FAMILY_CLASS.sans).toBe('font-sans')
    expect(FONT_FAMILY_CLASS.serif).toBe('font-serif')
    expect(FONT_FAMILY_CLASS.mono).toBe('font-mono')
    // No `font-display` — it isn't a real utility in this project.
    expect(Object.keys(FONT_FAMILY_CLASS)).toEqual(['sans', 'serif', 'mono'])
  })
})

describe('SIZE_POINTS / formatSizePoints — curator-facing point labels', () => {
  it('every key in SIZE_CLASS has a matching SIZE_POINTS entry', () => {
    const sizeKeys = Object.keys(SIZE_CLASS) as FontSize[]
    const pointKeys = Object.keys(SIZE_POINTS) as FontSize[]
    expect(pointKeys.sort()).toEqual(sizeKeys.sort())
    for (const k of sizeKeys) {
      expect(typeof SIZE_POINTS[k]).toBe('number')
      expect(Number.isFinite(SIZE_POINTS[k])).toBe(true)
      expect(SIZE_POINTS[k]).toBeGreaterThan(0)
    }
  })

  it('point values increase monotonically with the tier', () => {
    const ordered: FontSize[] = [
      'xs',
      'sm',
      'base',
      'lg',
      'xl',
      '2xl',
      '3xl',
      '4xl',
      '5xl',
      '6xl',
      '7xl',
      '8xl',
      '9xl',
    ]
    for (let i = 1; i < ordered.length; i += 1) {
      expect(SIZE_POINTS[ordered[i]]).toBeGreaterThan(
        SIZE_POINTS[ordered[i - 1]]
      )
    }
  })

  it('formatSizePoints renders the canonical `<n> pt` shape for every tier', () => {
    expect(formatSizePoints('xs')).toBe('9 pt')
    expect(formatSizePoints('sm')).toBe('11 pt')
    expect(formatSizePoints('base')).toBe('12 pt')
    expect(formatSizePoints('lg')).toBe('14 pt')
    expect(formatSizePoints('2xl')).toBe('18 pt')
    expect(formatSizePoints('7xl')).toBe('54 pt')
    expect(formatSizePoints('9xl')).toBe('96 pt')
  })
})

describe('parseStyleConfig', () => {
  it('returns an empty config for null / non-objects / arrays', () => {
    expect(parseStyleConfig(null)).toEqual({})
    expect(parseStyleConfig(undefined)).toEqual({})
    expect(parseStyleConfig('text')).toEqual({})
    expect(parseStyleConfig(42)).toEqual({})
  })

  it('keeps recognised keys and drops bogus enum values', () => {
    const out = parseStyleConfig({
      title: { font: 'serif', size: '3xl', weight: 'bold', transform: 'none' },
      subtitle: { size: 'lol-bogus' },
      primary: { font: 'sans', weight: 'black' },
      ignoredKey: { whatever: true },
    })
    expect(out.title).toEqual({
      font: 'serif',
      size: '3xl',
      weight: 'bold',
      transform: 'none',
    })
    // `subtitle` had no recognised values — dropped entirely.
    expect(out.subtitle).toBeUndefined()
    expect(out.primary).toEqual({ font: 'sans', weight: 'black' })
    expect((out as Record<string, unknown>).ignoredKey).toBeUndefined()
  })

  it('keeps v14 per-field align / letterSpacing / color overrides', () => {
    const out = parseStyleConfig({
      title: {
        align: 'center',
        letterSpacing: 'wide',
        color: '#dc2626',
      },
      subtitle: {
        align: 'right',
        letterSpacing: 'tight',
        color: '#22C55E',
      },
      primary: { transform: 'lowercase', color: 'not-a-hex' },
    })
    expect(out.title).toEqual({
      align: 'center',
      letterSpacing: 'wide',
      color: '#DC2626',
    })
    expect(out.subtitle).toEqual({
      align: 'right',
      letterSpacing: 'tight',
      color: '#22C55E',
    })
    // Bogus color drops silently; valid transform stays.
    expect(out.primary).toEqual({ transform: 'lowercase' })
  })

  it('parses the v14 header sub-config and drops bogus enum values', () => {
    const out = parseStyleConfig({
      header: { height: 'tall', align: 'center', showIcon: false },
    })
    expect(out.header).toEqual({
      height: 'tall',
      align: 'center',
      showIcon: false,
    })
    // Bogus enum values produce no recognised keys → header dropped entirely.
    expect(
      parseStyleConfig({ header: { height: 'wonky' } }).header
    ).toBeUndefined()
    expect(parseStyleConfig({ header: 'not-an-object' }).header).toBeUndefined()
  })
})

describe('v14 fine-grained controls — align / letterSpacing / color / header', () => {
  it('fieldClasses includes the resolved align + letterSpacing utilities', () => {
    const out = fieldClasses(
      { align: 'center', letterSpacing: 'wide' },
      DEFAULT_STYLES.title
    )
    expect(out).toContain('text-center')
    expect(out).toContain('tracking-wide')
  })

  it('fieldClasses falls back to defaults for missing align / letterSpacing', () => {
    const out = fieldClasses(undefined, DEFAULT_STYLES.title)
    expect(out).toContain('text-left')
    expect(out).toContain('tracking-tight')
  })

  it('lowercase transform resolves to the `lowercase` utility', () => {
    const out = fieldClasses(
      { transform: 'lowercase' },
      DEFAULT_STYLES.subtitle
    )
    expect(out).toContain('lowercase')
  })

  it('ALIGN_CLASS maps every align value to a literal `text-*` class', () => {
    expect(ALIGN_CLASS.left).toBe('text-left')
    expect(ALIGN_CLASS.center).toBe('text-center')
    expect(ALIGN_CLASS.right).toBe('text-right')
  })

  it('LETTER_SPACING_CLASS maps every value to a literal `tracking-*` class', () => {
    expect(LETTER_SPACING_CLASS.tight).toBe('tracking-tight')
    expect(LETTER_SPACING_CLASS.normal).toBe('tracking-normal')
    expect(LETTER_SPACING_CLASS.wide).toBe('tracking-wide')
  })

  it('fieldColor returns the hex when valid, undefined otherwise', () => {
    expect(fieldColor({ color: '#22C55E' }, DEFAULT_STYLES.primary)).toBe(
      '#22C55E'
    )
    expect(
      fieldColor({ color: '#abc' }, DEFAULT_STYLES.primary)
    ).toBeUndefined()
    expect(
      fieldColor({ color: 'not-hex' }, DEFAULT_STYLES.primary)
    ).toBeUndefined()
    expect(fieldColor({}, DEFAULT_STYLES.primary)).toBeUndefined()
    expect(fieldColor(undefined, DEFAULT_STYLES.primary)).toBeUndefined()
  })

  it('headerClasses returns the padding class for each density / height combo', () => {
    expect(headerClasses(undefined, 'normal')).toBe(
      HEADER_HEIGHT_CLASS.normal.normal
    )
    expect(headerClasses({ height: 'tall' }, 'tv')).toBe(
      HEADER_HEIGHT_CLASS.tv.tall
    )
    expect(headerClasses({ height: 'compact' }, 'normal')).toBe(
      HEADER_HEIGHT_CLASS.normal.compact
    )
  })

  it('HEADER_ALIGN_CLASS maps every alignment to a literal `justify-*` class', () => {
    expect(HEADER_ALIGN_CLASS.left).toBe('justify-between')
    expect(HEADER_ALIGN_CLASS.center).toBe('justify-center')
  })

  it('DEFAULT_HEADER preserves the v11.3 colored-header shape', () => {
    expect(DEFAULT_HEADER).toEqual({
      height: 'normal',
      align: 'left',
      showIcon: true,
    })
  })
})

describe('v16 pt-precision sizing — clampPt / fieldInlineStyle / isSizePinned', () => {
  it('clampPt returns null for null / undefined / NaN / out-of-band low values', () => {
    expect(clampPt(null)).toBeNull()
    expect(clampPt(undefined)).toBeNull()
    expect(clampPt(NaN)).toBeNull()
    expect(clampPt(0)).toBeNull()
    expect(clampPt(-12)).toBeNull()
    expect(clampPt(SIZE_PT_MIN - 1)).toBeNull()
  })

  it('clampPt rounds fractional input to the nearest integer and ceilings at max', () => {
    expect(clampPt(18.4)).toBe(18)
    expect(clampPt(18.6)).toBe(19)
    expect(clampPt(SIZE_PT_MAX + 10)).toBe(SIZE_PT_MAX)
    expect(clampPt(SIZE_PT_MIN)).toBe(SIZE_PT_MIN)
  })

  it('fieldClasses omits the SIZE_CLASS when sizePt is set', () => {
    const out = fieldClasses({ sizePt: 22 }, DEFAULT_STYLES.title)
    // Default title is `text-2xl`; pt override should suppress it so the
    // inline `font-size: 22pt` is the sole source of truth.
    expect(out).not.toContain('text-2xl')
    expect(out).not.toContain('text-xs')
    expect(out).toContain('font-bold')
    expect(out).toContain('font-sans')
  })

  it('fieldClasses still emits the SIZE_CLASS when only the enum is set', () => {
    const out = fieldClasses({ size: '3xl' }, DEFAULT_STYLES.title)
    expect(out).toContain('text-3xl')
  })

  it('fieldInlineStyle threads pt / lineHeight / italic / underline / color into the inline CSS', () => {
    const out = fieldInlineStyle(
      {
        sizePt: 28,
        lineHeight: 1.4,
        italic: true,
        underline: true,
        color: '#22C55E',
      },
      DEFAULT_STYLES.primary
    )
    expect(out.fontSize).toBe('28pt')
    expect(out.lineHeight).toBe(1.4)
    expect(out.fontStyle).toBe('italic')
    expect(out.textDecoration).toBe('underline')
    expect(out.color).toBe('#22C55E')
  })

  it('fieldInlineStyle drops out-of-band line-heights and invalid colors', () => {
    const out = fieldInlineStyle(
      { lineHeight: 0.2, color: 'rebeccapurple' },
      DEFAULT_STYLES.subtitle
    )
    expect(out.lineHeight).toBeUndefined()
    expect(out.color).toBeUndefined()
  })

  it('fieldInlineStyle is an empty object when no overrides are set', () => {
    const out = fieldInlineStyle(undefined, DEFAULT_STYLES.title)
    expect(out).toEqual({})
  })

  it('isSizePinned recognises both the enum and the pt override', () => {
    expect(isSizePinned(undefined)).toBe(false)
    expect(isSizePinned({})).toBe(false)
    expect(isSizePinned({ size: '5xl' })).toBe(true)
    expect(isSizePinned({ sizePt: 72 })).toBe(true)
    // Clamp-rejected pt should NOT count as pinned.
    expect(isSizePinned({ sizePt: 0 })).toBe(false)
  })

  it('parseStyleConfig accepts the v16 pt / lineHeight / italic / underline keys', () => {
    const out = parseStyleConfig({
      primary: {
        sizePt: 72.3,
        lineHeight: 1.25,
        italic: true,
        underline: true,
      },
      title: { sizePt: 'not a number', lineHeight: 10 },
    })
    expect(out.primary).toEqual({
      sizePt: 72,
      lineHeight: 1.25,
      italic: true,
      underline: true,
    })
    // Bogus / out-of-band values are dropped silently — title carried
    // nothing valid so it disappears entirely.
    expect(out.title).toBeUndefined()
  })
})

// Created and developed by Jai Singh
