// Created and developed by Jai Singh
/**
 * Sentry init shim (Phase 12.4a / Item 15).
 *
 * Wires `window.__OMNI_SENTRY_CAPTURE` so the `WorkflowErrorBoundary`
 * forwards render errors with `{ work_type, flow }` tags. The boundary
 * itself stays Sentry-agnostic (see
 * `src/components/error-boundaries/WorkflowErrorBoundary.tsx`) so an
 * uninitialised environment doesn't break the build.
 *
 * Behaviour:
 *   - When `VITE_SENTRY_DSN` is unset we install a no-op capture so the
 *     boundary's optional-chain still resolves to a safe call. We log the
 *     skip exactly once.
 *   - When the DSN is present we call `Sentry.init` with the default
 *     integrations only (no replay, no profiling — those are heavyweight
 *     and the operator opts in deliberately when ready).
 *   - Sample rate defaults: 0.1 in production, 1.0 in dev.
 */
import * as Sentry from '@sentry/react'
import { logger } from '@/lib/utils/logger'

declare global {
  interface Window {
    __OMNI_SENTRY_CAPTURE?: (
      err: Error,
      ctx: { tags: Record<string, string>; componentStack: string }
    ) => void
  }
}

let initialized = false

/** Install a no-op capture so callers don't have to feature-detect. */
function installNoopCapture(reason: string): void {
  if (typeof window === 'undefined') return
  if (window.__OMNI_SENTRY_CAPTURE) return
  window.__OMNI_SENTRY_CAPTURE = () => {
    /* no-op until DSN is configured */
  }
  logger.log(`[sentry] capture shim installed (no-op): ${reason}`)
}

/**
 * Initialize Sentry. Safe to call multiple times — the second call is a
 * no-op. Call this once at app boot before React mounts.
 */
export function initSentry(): void {
  if (initialized) return
  initialized = true

  if (typeof window === 'undefined') {
    return
  }

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) {
    installNoopCapture('VITE_SENTRY_DSN unset')
    return
  }

  const environment =
    (import.meta.env.VITE_ENV as string | undefined) ??
    (import.meta.env.PROD ? 'production' : 'development')

  try {
    Sentry.init({
      dsn,
      environment,
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    })

    window.__OMNI_SENTRY_CAPTURE = (err, ctx) => {
      Sentry.captureException(err, {
        tags: ctx.tags,
        extra: { componentStack: ctx.componentStack },
      })
    }
    logger.log(`[sentry] initialized (env=${environment})`)
  } catch (e) {
    installNoopCapture(`Sentry.init threw: ${(e as Error).message}`)
  }
}

/**
 * Test helper — resets module-level state so unit tests can re-run
 * `initSentry()` from a clean slate. Not part of the runtime contract.
 */
export function __resetSentryForTests(): void {
  initialized = false
  if (typeof window !== 'undefined') {
    delete window.__OMNI_SENTRY_CAPTURE
  }
}

// Created and developed by Jai Singh
