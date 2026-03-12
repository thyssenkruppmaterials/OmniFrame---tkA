/**
 * Authenticated fetch helper for SAP API endpoints.
 *
 * All /api/sap/* endpoints require a valid JWT in the Authorization header.
 * This utility automatically retrieves the Supabase session token and attaches it.
 *
 * @since Feb 2026 - Fixes 401 errors on SAP endpoints after RBAC hardening
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

/**
 * Returns auth headers including the current user's JWT Bearer token.
 * Uses getSession() first (fast, from memory/storage), then falls back to
 * refreshSession() if the token is missing (handles expired sessions).
 */
async function getAuthToken(): Promise<string | null> {
  try {
    // Fast path: read session from memory/storage
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (session?.access_token) {
      return session.access_token
    }

    // Session may be expired or missing from storage -- attempt a refresh
    logger.warn(
      '[sapFetch] No session from getSession(), attempting refreshSession()...'
    )
    const {
      data: { session: refreshed },
    } = await supabase.auth.refreshSession()
    if (refreshed?.access_token) {
      return refreshed.access_token
    }

    logger.error(
      '[sapFetch] No auth token available after refresh. User may need to re-login.'
    )
    return null
  } catch (err) {
    logger.error('[sapFetch] Failed to retrieve auth token:', err)
    return null
  }
}

/**
 * Authenticated fetch wrapper for SAP API calls.
 * Automatically injects the JWT auth header and Content-Type for requests with a body.
 */
export async function sapFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = await getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...((options.headers as Record<string, string>) || {}),
    },
  })
}
