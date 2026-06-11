// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  isOmnibeltAllowedRoute,
  OMNIBELT_EXCLUDED_PATTERNS_FOR_TESTS,
} from '../lib/routeGate'

describe('OmniBelt routeGate — isOmnibeltAllowedRoute', () => {
  // ---- Allowed (positive) cases -------------------------------------------
  it.each([
    '/',
    '/dashboard',
    '/_authenticated/admin/users',
    '/_authenticated/operations/picking',
    '/_authenticated/hr/people',
    '/_authenticated/inventory/locations',
    '/_authenticated/outbound/orders',
    '/_authenticated/reports/productivity',
    '/admin/omnibelt',
    '/help-center',
    '/profile',
    '/settings/notifications',
    '/apps/production-boards',
    // Lookalikes that must NOT match the excluded patterns:
    '/rf-something-else', // not /rf-interface or /rf-signin (no slash sep)
    '/timezones', // not /timeclock
    '/4001', // not /401, /403, /404
    '/5000-error-fallback', // not /500
    '/customer-portals', // not /customer-portal
    '/sign-in-help', // not /sign-in
  ])('allows %s', (pathname) => {
    expect(isOmnibeltAllowedRoute(pathname)).toBe(true)
  })

  // ---- Excluded (negative) cases ------------------------------------------
  it.each([
    // RF interface (entire tree)
    '/rf-interface',
    '/rf-interface/',
    '/rf-interface/putaway',
    '/rf-interface/cycle-count/start',
    // RF sign-in
    '/rf-signin',
    '/rf-signin/',
    '/rf-signin/select',
    // Timeclock (both /timeclock and /timeclockapp)
    '/timeclock',
    '/timeclock/',
    '/timeclock/punch',
    '/timeclockapp',
    '/timeclockapp/',
    '/timeclockapp/select',
    // Customer portal
    '/customer-portal',
    '/customer-portal/',
    '/customer-portal/tickets',
    // Auth flows
    '/sign-in',
    '/sign-in/',
    '/sign-up',
    '/sign-up/verify',
    '/forgot-password',
    '/reset-password',
    '/reset-password/abc123',
    // Error pages
    '/401',
    '/401/',
    '/403',
    '/403/details',
    '/404',
    '/404/',
    '/500',
    '/500/',
  ])('blocks %s', (pathname) => {
    expect(isOmnibeltAllowedRoute(pathname)).toBe(false)
  })

  it('exposes exactly the documented set of patterns', () => {
    // Anchors the contract for spec §14: 10 distinct exclusions.
    expect(OMNIBELT_EXCLUDED_PATTERNS_FOR_TESTS.length).toBe(10)
  })

  it('every documented pattern matches at least one canonical pathname', () => {
    // Quick sanity: every regex hits at least one pathname from the
    // negative list above. Defensive against typos when patterns evolve.
    const samples = [
      '/rf-interface/x',
      '/rf-signin/x',
      '/timeclock/x',
      '/timeclockapp/x',
      '/customer-portal/x',
      '/sign-in',
      '/sign-up',
      '/forgot-password',
      '/reset-password',
      '/401',
      '/403',
      '/404',
      '/500',
    ]
    for (const re of OMNIBELT_EXCLUDED_PATTERNS_FOR_TESTS) {
      expect(
        samples.some((s) => re.test(s)),
        `pattern ${re} matches no canonical sample`
      ).toBe(true)
    }
  })
})

// Created and developed by Jai Singh
