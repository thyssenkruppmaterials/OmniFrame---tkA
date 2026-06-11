// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import { accentFor, gradientCss, meshConicCss } from './board-kind-accent'

describe('accentFor', () => {
  it('returns the correct accent palette for every board kind', () => {
    expect(accentFor('announcement').label).toBe('Announcements')
    expect(accentFor('hr_news').label).toBe('HR News')
    expect(accentFor('job').label).toBe('Jobs')
    expect(accentFor('safety_alert').label).toBe('Safety Alerts')
  })

  it('each kind has a non-empty 3-stop palette with hex values', () => {
    for (const kind of [
      'announcement',
      'hr_news',
      'job',
      'safety_alert',
    ] as const) {
      const a = accentFor(kind)
      expect(a.fromHex).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(a.midHex).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(a.toHex).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(a.glowSoft).toMatch(/rgba\(/)
      expect(a.glowStrong).toMatch(/rgba\(/)
      expect(a.eyebrowClass.length).toBeGreaterThan(0)
      expect(a.pulseClass.length).toBeGreaterThan(0)
      expect(a.tabUnderlineClass.length).toBeGreaterThan(0)
    }
  })

  it('returns the announcement palette as a defensive fallback for unknown kinds', () => {
    // @ts-expect-error — testing the fallback path
    const a = accentFor('unknown_kind_that_doesnt_exist')
    expect(a.label).toBe('Announcements')
  })
})

describe('gradientCss', () => {
  it('builds a 3-stop linear-gradient with the kind palette', () => {
    const css = gradientCss('announcement')
    expect(css).toContain('linear-gradient(135deg')
    expect(css).toContain('#0EA5E9')
    expect(css).toContain('#6366F1')
    expect(css).toContain('#8B5CF6')
  })

  it('honors a custom angle', () => {
    const css = gradientCss('hr_news', 45)
    expect(css).toContain('linear-gradient(45deg')
  })
})

describe('meshConicCss', () => {
  it('builds a conic-gradient with the kind hexes', () => {
    const css = meshConicCss('safety_alert')
    expect(css).toContain('conic-gradient')
    expect(css).toContain('#F43F5E')
    expect(css).toContain('#EF4444')
    expect(css).toContain('#F97316')
  })
})

// Created and developed by Jai Singh
