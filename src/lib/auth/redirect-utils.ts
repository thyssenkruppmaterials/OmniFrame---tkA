/**
 * Auth Redirect Utilities
 *
 * Centralized redirect functions for authentication flows.
 * Ensures the current URL is always preserved when redirecting
 * to sign-in, so users return to where they left off after login.
 *
 * @date 2026-02-05
 */

/**
 * Redirect to the sign-in page, preserving the current URL as a redirect parameter.
 * Uses window.location.href for a full page reload to ensure clean auth state.
 *
 * @param customPath - Optional custom path to redirect back to after sign-in.
 *                     Defaults to the current full URL (pathname + search + hash).
 */
export function redirectToSignIn(customPath?: string) {
  if (typeof window === 'undefined') return

  const currentPath =
    customPath ??
    window.location.pathname + window.location.search + window.location.hash

  // Don't redirect back to sign-in to prevent loops
  if (
    currentPath.includes('/sign-in') ||
    currentPath.includes('/sign-up') ||
    currentPath.includes('/forgot-password')
  ) {
    window.location.href = '/sign-in'
    return
  }

  const redirectParam = encodeURIComponent(currentPath)
  window.location.href = `/sign-in?redirect=${redirectParam}`
}

/**
 * Build a sign-in URL with a redirect parameter, for use with router navigation.
 *
 * @param returnPath - The path to redirect back to after sign-in.
 * @returns An object with `to` and `search` properties for TanStack Router.
 */
export function buildSignInRedirect(returnPath: string) {
  return {
    to: '/sign-in' as const,
    search: {
      redirect: returnPath,
    },
  }
}
