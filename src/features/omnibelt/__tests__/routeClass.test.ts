// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import { routeClass, type RouteClass } from '../lib/routeClass'

describe('OmniBelt routeClass — every branch', () => {
  it.each<[string, RouteClass]>([
    // _authenticated/<group> form (TanStack Router)
    ['/_authenticated/admin', 'admin'],
    ['/_authenticated/admin/users', 'admin'],
    ['/_authenticated/operations', 'operations'],
    ['/_authenticated/operations/picking', 'operations'],
    ['/_authenticated/hr', 'hr'],
    ['/_authenticated/hr/people', 'hr'],
    ['/_authenticated/inventory', 'inventory'],
    ['/_authenticated/inventory/locations', 'inventory'],
    ['/_authenticated/outbound', 'outbound'],
    ['/_authenticated/outbound/orders', 'outbound'],
    ['/_authenticated/reports', 'reports'],
    ['/_authenticated/reports/productivity', 'reports'],
    // Bare prefix form (also accepted)
    ['/admin', 'admin'],
    ['/admin/omnibelt', 'admin'],
    ['/operations', 'operations'],
    ['/operations/picking/quick', 'operations'],
    ['/hr', 'hr'],
    ['/hr/people', 'hr'],
    ['/inventory', 'inventory'],
    ['/inventory/locations', 'inventory'],
    ['/outbound', 'outbound'],
    ['/outbound/orders', 'outbound'],
    ['/reports', 'reports'],
    ['/reports/productivity', 'reports'],
    // Default fallback
    ['/', 'default'],
    ['/dashboard', 'default'],
    ['/help-center', 'default'],
    ['/settings', 'default'],
    ['/apps/production-boards', 'default'],
    ['/profile', 'default'],
  ])('routeClass(%s) → %s', (pathname, expected) => {
    expect(routeClass(pathname)).toBe(expected)
  })
})

// Created and developed by Jai Singh
