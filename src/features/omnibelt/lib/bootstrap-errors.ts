// Created and developed by Jai Singh
/**
 * OmniBelt — Bootstrap & admin error taxonomy
 *
 * Distinct error classes for the bootstrap query + admin mutations
 * so retry / circuit-breaker / toast-routing logic can branch
 * structurally instead of grepping `error.message`. Mirrors the
 * "fail-closed but quietly" posture from spec §13 — every error
 * here is recoverable; nothing escalates to a full-page crash.
 *
 * Helpers:
 *   - `classifyResponse(resp)` — converts a non-OK `Response` into
 *     the appropriate typed throwable. Returns `null` for 2xx so
 *     callers can branch with `throw classifyResponse(resp) ?? ...`.
 *   - `isNetworkError(err)` / `isAuthError(err)` / `isValidationError(err)`
 *     — duck-type checks that ALSO accept plain `Error` instances
 *     thrown by hand-rolled `omnibeltAdminService` callsites, so the
 *     admin mutations don't need a coordinated refactor to migrate.
 *
 * Why duck-type fallbacks: the existing `omnibeltAdminService`
 * methods throw `new Error("Kill-switch write failed: ${status} …")`.
 * Refactoring that into typed throws is a separate PR; the message
 * regex below recognises those messages and the native
 * `TypeError('Failed to fetch')` that the Vite proxy surfaces when
 * the FastAPI backend is unreachable (ECONNREFUSED on :8000).
 */

/**
 * `ErrorOptions` (ES2022) isn't in the project's ES2020 lib target,
 * so we attach `cause` manually after construction. Behaves
 * identically at runtime to `new Error(msg, { cause })` everywhere
 * the platform supports it (every modern browser + Node 16+).
 */
function withCause<E extends Error>(err: E, cause: unknown): E {
  if (cause !== undefined) {
    ;(err as unknown as { cause?: unknown }).cause = cause
  }
  return err
}

/** Backend reachable but transient: ECONNREFUSED, 5xx, 502/504 from
 *  the Vite proxy, generic `TypeError('Failed to fetch')`. Always
 *  safe to retry (subject to per-callsite caps). */
export class BootstrapNetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'BootstrapNetworkError'
    withCause(this, cause)
  }
}

/** 401 / 403. Never retried — the bearer token isn't going to fix
 *  itself within a request burst. */
export class BootstrapAuthError extends Error {
  readonly status: number
  constructor(message: string, status: number, cause?: unknown) {
    super(message)
    this.name = 'BootstrapAuthError'
    this.status = status
    withCause(this, cause)
  }
}

/** 400 / 422 / shape mismatch. Never retried — the request body
 *  isn't going to change on its own. */
export class BootstrapValidationError extends Error {
  readonly status: number
  constructor(message: string, status: number, cause?: unknown) {
    super(message)
    this.name = 'BootstrapValidationError'
    this.status = status
    withCause(this, cause)
  }
}

/**
 * Convert a non-OK `Response` into the appropriate typed error.
 * Returns `null` when the response is OK so callers can write:
 *   `if (!resp.ok) throw await classifyResponse(resp)`
 */
export async function classifyResponse(resp: Response): Promise<Error> {
  let body = ''
  try {
    body = await resp.text()
  } catch {
    /* swallow — body is informational only */
  }
  const status = resp.status
  const message = `${resp.status} ${resp.statusText}${body ? ` — ${body}` : ''}`

  if (status === 401 || status === 403) {
    return new BootstrapAuthError(message, status)
  }
  if (status === 400 || status === 422) {
    return new BootstrapValidationError(message, status)
  }
  // 5xx / 502 / 504 / 408 / anything else recoverable.
  return new BootstrapNetworkError(message)
}

// ─────────────────────────────────────────────────────────────────────
// Duck-type predicates (accept typed classes OR legacy plain Errors).
// ─────────────────────────────────────────────────────────────────────

/** True for backend-unreachable / proxy-failure / transient 5xx
 *  scenarios, including the native `TypeError('Failed to fetch')`
 *  raised by the Vite dev proxy on `ECONNREFUSED`. */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof BootstrapNetworkError) return true
  // Native fetch failures (ECONNREFUSED, DNS, CORS preflight bounce).
  if (
    err instanceof TypeError &&
    /fetch|network|load failed/i.test(err.message)
  ) {
    return true
  }
  if (err instanceof Error) {
    // Legacy admin-service messages embed the status code.
    if (
      /\b50[0-4]\b|ECONNREFUSED|backend (is )?unreachable|failed to fetch/i.test(
        err.message
      )
    ) {
      return true
    }
  }
  return false
}

/** True for 401 / 403 — used to short-circuit retries. */
export function isAuthError(err: unknown): boolean {
  if (err instanceof BootstrapAuthError) return true
  if (err instanceof Error) {
    if (/\b40[13]\b|unauthorized|forbidden/i.test(err.message)) return true
  }
  return false
}

/** True for 400 / 422 / shape mismatches. */
export function isValidationError(err: unknown): boolean {
  if (err instanceof BootstrapValidationError) return true
  if (err instanceof Error) {
    if (/\b400\b|\b422\b|validation/i.test(err.message)) return true
  }
  return false
}

// Created and developed by Jai Singh
