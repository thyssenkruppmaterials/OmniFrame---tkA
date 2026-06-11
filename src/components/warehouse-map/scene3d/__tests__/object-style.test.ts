// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OBJECT_STYLE,
  mergeObjectStyle,
  readObjectStyle,
} from '../object-style'

describe('readObjectStyle', () => {
  it('defaults for missing/legacy/malformed metadata', () => {
    expect(readObjectStyle(null)).toEqual(DEFAULT_OBJECT_STYLE)
    expect(readObjectStyle({})).toEqual(DEFAULT_OBJECT_STYLE)
    expect(readObjectStyle({ style: 'neon' })).toEqual(DEFAULT_OBJECT_STYLE)
    expect(readObjectStyle({ style: { finish: 'mirror', glow: 1 } })).toEqual(
      DEFAULT_OBJECT_STYLE
    )
  })
  it('reads valid styles', () => {
    expect(
      readObjectStyle({ style: { finish: 'chrome', glow: true } })
    ).toEqual({
      finish: 'chrome',
      glow: true,
    })
  })
})

describe('mergeObjectStyle', () => {
  it('writes non-default styles and preserves other metadata', () => {
    expect(mergeObjectStyle({ keep: 1 }, { glow: true })).toEqual({
      keep: 1,
      style: { finish: 'standard', glow: true },
    })
  })
  it('drops the style key when reset to defaults', () => {
    const meta = mergeObjectStyle(
      { style: { finish: 'matte', glow: false } },
      { finish: 'standard' }
    )
    expect(meta).toEqual({})
  })
})
