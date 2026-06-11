// Created and developed by Jai Singh
/**
 * OmniBelt — Route Class
 *
 * Bounded route-class mapper used to key per-route position memory in
 * `omnibeltStore.positionByRoute` and `omnibelt_user_prefs.position_by_route`.
 *
 * Storing the exact pathname would let `position_by_route` grow unbounded
 * across hundreds of dynamic routes; bucketing into a fixed set of <=10
 * classes (matching the top-level navigation domains) keeps the persisted
 * state tiny and predictable.
 *
 * The `_authenticated/<group>` prefix is the TanStack Router shape used by
 * this codebase (see `src/routes/_authenticated/...`). We also accept the
 * bare prefix (e.g. `/admin`) so the function works equally well in tests
 * and in any callsite that passes a normalized path.
 *
 * See spec §8.3 (Per-route memory) for rationale.
 */

export type RouteClass =
  | 'admin'
  | 'operations'
  | 'hr'
  | 'inventory'
  | 'outbound'
  | 'reports'
  | 'default'

export function routeClass(pathname: string): RouteClass {
  if (
    pathname.startsWith('/_authenticated/admin') ||
    pathname.startsWith('/admin')
  ) {
    return 'admin'
  }
  if (
    pathname.startsWith('/_authenticated/operations') ||
    pathname.startsWith('/operations')
  ) {
    return 'operations'
  }
  if (pathname.startsWith('/_authenticated/hr') || pathname.startsWith('/hr')) {
    return 'hr'
  }
  if (
    pathname.startsWith('/_authenticated/inventory') ||
    pathname.startsWith('/inventory')
  ) {
    return 'inventory'
  }
  if (
    pathname.startsWith('/_authenticated/outbound') ||
    pathname.startsWith('/outbound')
  ) {
    return 'outbound'
  }
  if (
    pathname.startsWith('/_authenticated/reports') ||
    pathname.startsWith('/reports')
  ) {
    return 'reports'
  }
  return 'default'
}

// Created and developed by Jai Singh
