// Created and developed by Jai Singh
/**
 * Shared authenticated-fetch helper for the FastAPI backend.
 *
 * Every `/api/*` endpoint that goes through the FastAPI layer requires
 * a `Authorization: Bearer <supabase access token>` header — the
 * server's `get_current_user` dependency reads the JWT from the
 * `Authorization` header (NOT from cookies). Without it, every
 * authenticated route returns `401 {"detail": "Authentication required"}`.
 *
 * Historically each feature wrote its own copy of this pattern
 * (`src/features/admin/sap-testing/utils/auth-fetch.ts`,
 *  `src/lib/work-service/dispatch.client.ts`, etc.). New code should
 * pull from here; old callsites can migrate opportunistically.
 *
 * Behaviour:
 *   - Fast path: `supabase.auth.getSession()` (reads from memory/storage).
 *   - Fallback: `supabase.auth.refreshSession()` — handles expired tokens.
 *   - No token → fetch proceeds WITHOUT the header (server returns 401,
 *     surfaced to the caller). We deliberately do NOT redirect to login
 *     from this layer — that's the auth provider's responsibility.
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

/** Retrieve the current Supabase access token, refreshing if needed. */
export async function getApiAccessToken(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (session?.access_token) return session.access_token

    logger.warn(
      '[apiFetch] No session from getSession(); attempting refreshSession()'
    )
    const {
      data: { session: refreshed },
    } = await supabase.auth.refreshSession()
    if (refreshed?.access_token) return refreshed.access_token

    logger.error(
      '[apiFetch] No auth token after refresh — user may need to re-login.'
    )
    return null
  } catch (err) {
    logger.error('[apiFetch] Failed to retrieve auth token', err)
    return null
  }
}

/**
 * Authenticated wrapper around `fetch`. Adds the
 * `Authorization: Bearer <token>` header and a default
 * `Content-Type: application/json`. Callers' headers / body / method
 * pass through.
 *
 * Use this for every `/api/*` call into the FastAPI backend. Do NOT
 * use it for direct Supabase calls (those go through the supabase
 * client and use the cookie/session internally).
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = await getApiAccessToken()
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

// Created and developed by Jai Singh
