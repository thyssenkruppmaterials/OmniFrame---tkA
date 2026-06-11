// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  deriveZone,
  parseZoneLockError,
} from '@/lib/supabase/zone-rules.service'

describe('zone-rules.service.deriveZone', () => {
  it('uses the first dash-separated segment by default', () => {
    expect(deriveZone('K1-08-02-2')).toBe('K1')
    expect(deriveZone('SC-22-C-01')).toBe('SC')
    expect(deriveZone('R0-19-C-03')).toBe('R0')
  })

  it('returns null for missing / sentinel locations', () => {
    expect(deriveZone(null)).toBeNull()
    expect(deriveZone('')).toBeNull()
    expect(deriveZone(undefined)).toBeNull()
    expect(deriveZone('<<empty>>')).toBeNull()
  })

  it('returns the whole string when no dash is present', () => {
    expect(deriveZone('NODASH')).toBe('NODASH')
  })

  it('honors a custom regex pattern when provided', () => {
    expect(deriveZone('K1-08-02-2', '^[A-Z]+[0-9]+')).toBe('K1')
    expect(deriveZone('A12-B45', '^[A-Z]+[0-9]+')).toBe('A12')
  })

  it('falls back to the default split on invalid regex', () => {
    expect(deriveZone('K1-08', '(unclosed')).toBe('K1')
  })
})

describe('zone-rules.service.parseZoneLockError', () => {
  it('detects a ZONE_LOCKED error with zone + owner', () => {
    const err = new Error(
      'ZONE_LOCKED: Zone "K1" is currently being counted by Nikki Mason. Only one counter may work a zone at a time.'
    )
    const parsed = parseZoneLockError(err)
    expect(parsed.isZoneBlocked).toBe(true)
    if (parsed.isZoneBlocked) {
      expect(parsed.kind).toBe('locked')
      expect(parsed.zone).toBe('K1')
      expect(parsed.ownerName).toBe('Nikki Mason')
    }
  })

  it('detects a ZONE_ASSIGNED error with zone + assignee', () => {
    const err = new Error(
      'ZONE_ASSIGNED: Zone "R0" is assigned to Erick Robinson. Only that counter may work this zone.'
    )
    const parsed = parseZoneLockError(err)
    expect(parsed.isZoneBlocked).toBe(true)
    if (parsed.isZoneBlocked) {
      expect(parsed.kind).toBe('assigned')
      expect(parsed.zone).toBe('R0')
      expect(parsed.ownerName).toBe('Erick Robinson')
    }
  })

  it('returns isZoneBlocked=false for unrelated errors', () => {
    const parsed = parseZoneLockError(new Error('Random failure'))
    expect(parsed.isZoneBlocked).toBe(false)
  })

  it('tolerates non-Error inputs', () => {
    expect(parseZoneLockError('ZONE_LOCKED: Zone "R0"').isZoneBlocked).toBe(
      true
    )
    expect(parseZoneLockError({ message: 'ZONE_LOCKED' }).isZoneBlocked).toBe(
      true
    )
    expect(parseZoneLockError(undefined).isZoneBlocked).toBe(false)
  })
})

// Created and developed by Jai Singh
