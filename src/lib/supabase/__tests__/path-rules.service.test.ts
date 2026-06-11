// Created and developed by Jai Singh
import { describe, expect, it, vi } from 'vitest'
import { pathRulesService } from '@/lib/supabase/path-rules.service'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  },
}))

describe('PathRulesService.testPattern', () => {
  it('matches a standard hyphen-delimited location', () => {
    const results = pathRulesService.testPattern(
      '^([A-Z]\\d+)-(\\d+)-(\\d+)-(\\d+)$',
      ['E4-51-01-4', 'A1-28-03-1']
    )
    expect(results[0].matched).toBe(true)
    expect(results[0].groups).toEqual(['E4', '51', '01', '4'])
    expect(results[1].matched).toBe(true)
    expect(results[1].groups).toEqual(['A1', '28', '03', '1'])
  })

  it('returns no match for non-conforming locations', () => {
    const results = pathRulesService.testPattern(
      '^([A-Z]\\d+)-(\\d+)-(\\d+)-(\\d+)$',
      ['BULK-A', '12345']
    )
    expect(results[0].matched).toBe(false)
    expect(results[0].groups).toEqual([])
    expect(results[1].matched).toBe(false)
  })

  it('handles invalid regex gracefully', () => {
    const results = pathRulesService.testPattern('(invalid[', ['E4-51-01-4'])
    expect(results[0].matched).toBe(false)
  })

  it('returns empty groups for patterns without capture groups', () => {
    const results = pathRulesService.testPattern('^\\S+$', ['E4-51-01-4'])
    expect(results[0].matched).toBe(true)
    expect(results[0].groups).toEqual([])
  })

  it('matches a letter-delimited location format', () => {
    const results = pathRulesService.testPattern(
      '^(\\w+)-(\\d+)-([A-Z])-(\\d+)$',
      ['SQ-28-C-01']
    )
    expect(results[0].matched).toBe(true)
    expect(results[0].groups).toEqual(['SQ', '28', 'C', '01'])
  })
})

// Created and developed by Jai Singh
