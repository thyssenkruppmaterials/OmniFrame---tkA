// Created and developed by Jai Singh
/**
 * OmniBelt — Route Gate
 *
 * Determines whether OmniBelt should mount on a given route.
 *
 * Mirrors the kiosk-route regex pattern from
 * `src/lib/presence/constants.ts` (`PRESENCE_KIOSK_ROUTE_PATTERNS`):
 * we match against `location.pathname`, evaluate a list of regexes, and
 * fail-closed when any pattern hits.
 *
 * Excluded routes:
 *   - RF terminal interface and sign-in (handheld scanners; no chrome)
 *   - Time-clock kiosks (shared-device kiosks)
 *   - Customer portal (public, unauthenticated)
 *   - Auth flows (sign-in, sign-up, password reset) — pre-auth, no point
 *   - Error pages (401/403/404/500) — bare-bones layouts
 *
 * See spec §14 (Route Exclusion) for rationale.
 */

const OMNIBELT_EXCLUDED_PATTERNS: readonly RegExp[] = [
  /^\/rf-interface(\/|$)/,
  /^\/rf-signin(\/|$)/,
  /^\/timeclock(app)?(\/|$)/,
  /^\/customer-portal(\/|$)/,
  /^\/sign-in(\/|$)/,
  /^\/sign-up(\/|$)/,
  /^\/forgot-password(\/|$)/,
  /^\/reset-password(\/|$)/,
  /^\/4(0[13]|04)(\/|$)/,
  /^\/500(\/|$)/,
] as const

export function isOmnibeltAllowedRoute(pathname: string): boolean {
  return !OMNIBELT_EXCLUDED_PATTERNS.some((re) => re.test(pathname))
}

/**
 * Exposed for unit tests only — lets the test exhaustively iterate every
 * pattern without re-declaring the list. Production callers should use
 * `isOmnibeltAllowedRoute`.
 */
export const OMNIBELT_EXCLUDED_PATTERNS_FOR_TESTS = OMNIBELT_EXCLUDED_PATTERNS

// Created and developed by Jai Singh
