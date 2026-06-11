// Created and developed by Jai Singh
/**
 * Item 15 — Sentry init shim tests.
 *
 * Covers two halves of the contract:
 *   1. With NO VITE_SENTRY_DSN, `initSentry()` skips Sentry.init entirely
 *      but still installs a no-op capture so callers don't crash.
 *   2. With a DSN set, `Sentry.init` is called exactly once and the
 *      capture forwards `tags` + `extra.componentStack` correctly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const initMock = vi.fn()
const captureMock = vi.fn()

vi.mock('@sentry/react', () => ({
  init: initMock,
  captureException: captureMock,
}))

describe('initSentry (no DSN)', () => {
  beforeEach(() => {
    initMock.mockClear()
    captureMock.mockClear()
    vi.unstubAllEnvs()
    delete (window as unknown as { __OMNI_SENTRY_CAPTURE?: unknown })
      .__OMNI_SENTRY_CAPTURE
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('installs a safe no-op capture and never calls Sentry.init', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const { initSentry, __resetSentryForTests } = await import('../sentry')
    __resetSentryForTests()

    initSentry()

    const capture = (
      window as unknown as {
        __OMNI_SENTRY_CAPTURE?: (
          err: Error,
          ctx: { tags: Record<string, string>; componentStack: string }
        ) => void
      }
    ).__OMNI_SENTRY_CAPTURE
    expect(typeof capture).toBe('function')
    expect(() =>
      capture?.(new Error('boom'), {
        tags: { work_type: 'x' },
        componentStack: '',
      })
    ).not.toThrow()
    expect(initMock).not.toHaveBeenCalled()
  })
})

describe('initSentry (DSN set)', () => {
  beforeEach(() => {
    initMock.mockClear()
    captureMock.mockClear()
    vi.unstubAllEnvs()
    delete (window as unknown as { __OMNI_SENTRY_CAPTURE?: unknown })
      .__OMNI_SENTRY_CAPTURE
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('calls Sentry.init exactly once and forwards tagged exceptions', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example@sentry.io/12345')
    vi.stubEnv('VITE_ENV', 'test')
    const { initSentry, __resetSentryForTests } = await import('../sentry')
    __resetSentryForTests()

    initSentry()
    initSentry()

    expect(initMock).toHaveBeenCalledTimes(1)
    const call = initMock.mock.calls[0]?.[0] as
      | { dsn: string; environment: string; tracesSampleRate: number }
      | undefined
    expect(call?.dsn).toBe('https://example@sentry.io/12345')
    expect(call?.environment).toBe('test')
    expect(typeof call?.tracesSampleRate).toBe('number')

    const capture = (
      window as unknown as {
        __OMNI_SENTRY_CAPTURE?: (
          err: Error,
          ctx: { tags: Record<string, string>; componentStack: string }
        ) => void
      }
    ).__OMNI_SENTRY_CAPTURE
    expect(typeof capture).toBe('function')
    const err = new Error('render boom')
    capture?.(err, {
      tags: { work_type: 'cycle_count', flow: 'rf' },
      componentStack: 'at Foo (foo.tsx:1)',
    })

    expect(captureMock).toHaveBeenCalledTimes(1)
    const captureCall = captureMock.mock.calls[0]
    expect(captureCall?.[0]).toBe(err)
    expect(captureCall?.[1]).toEqual({
      tags: { work_type: 'cycle_count', flow: 'rf' },
      extra: { componentStack: 'at Foo (foo.tsx:1)' },
    })
  })
})

// Created and developed by Jai Singh
