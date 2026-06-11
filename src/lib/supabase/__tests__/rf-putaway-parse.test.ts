// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  parseTONumber,
  validateTONumber,
} from '@/lib/supabase/rf-putaway.service'

// Mirrors the seeded allowlist (migration 334).
const ALLOWED = new Set(['PDC', 'WH5', 'JSF'])

describe('parseTONumber — allowlist enforcement (fix #1)', () => {
  it('accepts a known warehouse when an allowlist is supplied', () => {
    const r = parseTONumber('7293945$I0001$IWH5', ALLOWED)
    expect(r.isValid).toBe(true)
    expect(r.toNumber).toBe('7293945')
    expect(r.warehouse).toBe('WH5')
  })

  it.each([
    ['7293945$I0001$IWH52', 'H52'], // scanner appended a char → window shifted
    ['7293620$I0001$IWH5-', 'H5-'], // trailing junk
    ['7294552$I0001$XX-01', '-01'], // grabbed a location-style suffix
    ['1795043$I0001$IJSF1', 'SF1'], // JSF is valid, SF1 is not
  ])('rejects corrupted code from %s (parsed %s)', (raw, badCode) => {
    const r = parseTONumber(raw, ALLOWED)
    expect(r.isValid).toBe(false)
    expect(r.message).toContain(badCode)
    // A rejected scan yields no usable values, forcing a re-scan.
    expect(r.toNumber).toBe('')
    expect(r.warehouse).toBe('')
  })

  it('skips the check for PUTBACK and legacy plain-digit formats', () => {
    expect(parseTONumber('PUTBACK', ALLOWED).isValid).toBe(true)
    const legacy = parseTONumber('123456789', ALLOWED)
    expect(legacy.isValid).toBe(true)
    expect(legacy.warehouse).toBe('')
  })

  it('preserves legacy behavior when no allowlist is given (backward compatible)', () => {
    const r = parseTONumber('7293945$I0001$IWH52')
    expect(r.isValid).toBe(true)
    expect(r.warehouse).toBe('H52')
  })

  it('does not enforce when the allowlist is empty (fail-open)', () => {
    const r = parseTONumber('7293945$I0001$IWH52', new Set())
    expect(r.isValid).toBe(true)
    expect(r.warehouse).toBe('H52')
  })
})

describe('validateTONumber — threads the allowlist through', () => {
  it('reports invalid with a message for an unknown warehouse', () => {
    const v = validateTONumber('1795043$I0001$IJSF1', ALLOWED)
    expect(v.isValid).toBe(false)
    expect(v.message).toContain('SF1')
  })

  it('reports valid for a known warehouse', () => {
    expect(validateTONumber('7293945$I0001$IPDC', ALLOWED).isValid).toBe(true)
  })
})

// Created and developed by Jai Singh
