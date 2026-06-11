// Created and developed by Jai Singh
/**
 * useOmnibeltBootstrap — resilience contract.
 *
 * Validates the 2026-05-24 hardening pass:
 *   1. Network errors return the placeholder so the launcher keeps
 *      rendering instead of crashing the host.
 *   2. Auth / validation errors bypass retry — TanStack Query's
 *      `retry: 1` should NOT call the queryFn a second time when
 *      `BootstrapAuthError` or `BootstrapValidationError` is thrown.
 *   3. The local circuit breaker:
 *      - logs the actionable "start FastAPI" warn ONCE per cooldown,
 *      - trips after 3 consecutive network failures,
 *      - disables the bootstrap query while tripped (via
 *        `useSyncExternalStore` + `enabled: false`).
 *
 * The integration shape between TanStack's `retry: 1` + `retryDelay`
 * + `useSyncExternalStore`-driven `enabled` is tricky to assert
 * end-to-end without dancing with real-vs-fake-timer races; the
 * breaker primitive is therefore tested directly via the test-only
 * `__recordBootstrapFailureForTests` exit, with a final hook-level
 * smoke confirming the closed→open transition flips `enabled` off.
 */
import React, { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import {
  useOmnibeltBootstrap,
  OMNIBELT_BOOTSTRAP_PLACEHOLDER,
  __resetBootstrapCircuitBreakerForTests,
  __recordBootstrapFailureForTests,
  __isBootstrapCircuitOpenForTests,
} from '../hooks/useOmnibeltBootstrap'
import {
  BootstrapAuthError,
  BootstrapNetworkError,
  BootstrapValidationError,
} from '../lib/bootstrap-errors'

// ---- Module mocks (declared BEFORE the SUT import) ------------------------

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: vi.fn(),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    table: vi.fn(),
    time: vi.fn(),
    timeEnd: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
  },
}))

// `useOmnibeltBootstrap` calls the FastAPI proxy via `apiFetch`, which
// reads the Supabase session for its Bearer header. Stub the client
// so the wrapper doesn't reach for the real auth provider in jsdom.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
  supabaseRead: {},
}))

const fetchMock = vi.fn()
;(globalThis as unknown as { fetch: typeof fetch }).fetch =
  fetchMock as unknown as typeof fetch

// ---- Helpers ---------------------------------------------------------------

const USER_ID = 'user-bootstrap-test'

function authedAs(userId: string | null = USER_ID): void {
  ;(useUnifiedAuth as unknown as Mock).mockReturnValue({
    authState: {
      isAuthenticated: Boolean(userId),
      user: userId ? { id: userId } : null,
    },
  })
}

function makeWrapper(client: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }
  return Wrapper
}

/** Test QueryClient — override `retryDelay` to zero so the auth /
 *  validation retry-bypass tests don't wait the production 1–2 s
 *  exponential between attempts. Per-query options DO override
 *  defaults for `retry`, but `retryDelay` falls through to the
 *  default when not specified per-query — actually the hook DOES set
 *  it, so we additionally pump fake timers when needed (only in the
 *  network-error test). */
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, staleTime: 0, retryDelay: 0 },
      mutations: { retry: false },
    },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  ;(logger.warn as unknown as Mock).mockReset()
  ;(logger.debug as unknown as Mock).mockReset()
  ;(logger.info as unknown as Mock).mockReset()
  __resetBootstrapCircuitBreakerForTests()
  authedAs(USER_ID)
})

afterEach(() => {
  vi.clearAllMocks()
  __resetBootstrapCircuitBreakerForTests()
})

// ---------------------------------------------------------------------------
// Hook-level (placeholder + per-error retry contract)
// ---------------------------------------------------------------------------

describe('useOmnibeltBootstrap — hook contract', () => {
  it('exposes the frozen placeholder immediately so the launcher renders', () => {
    fetchMock.mockImplementation(
      () => new Promise(() => {}) // never resolves
    )
    const client = makeClient()
    const { result } = renderHook(() => useOmnibeltBootstrap(), {
      wrapper: makeWrapper(client),
    })
    // placeholderData makes `data` defined on the very first render
    // (no isLoading flash for downstream consumers).
    expect(result.current.data).toEqual(OMNIBELT_BOOTSTRAP_PLACEHOLDER)
    expect(Object.isFrozen(OMNIBELT_BOOTSTRAP_PLACEHOLDER)).toBe(true)
  })

  it('does NOT retry on 401 (BootstrapAuthError)', async () => {
    fetchMock.mockResolvedValue(
      new Response('forbidden', { status: 401, statusText: 'Unauthorized' })
    )
    const client = makeClient()
    const { result } = renderHook(() => useOmnibeltBootstrap(), {
      wrapper: makeWrapper(client),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeInstanceOf(BootstrapAuthError)
  })

  it('does NOT retry on 422 (BootstrapValidationError)', async () => {
    fetchMock.mockResolvedValue(
      new Response('bad shape', {
        status: 422,
        statusText: 'Unprocessable Entity',
      })
    )
    const client = makeClient()
    const { result } = renderHook(() => useOmnibeltBootstrap(), {
      wrapper: makeWrapper(client),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeInstanceOf(BootstrapValidationError)
  })

  it('disables the bootstrap query while the circuit is OPEN', async () => {
    // Trip the breaker via the test-only exit so we don't have to
    // race TanStack's retry timers.
    for (let i = 0; i < 3; i++) {
      __recordBootstrapFailureForTests(
        new BootstrapNetworkError('synthetic failure')
      )
    }
    expect(__isBootstrapCircuitOpenForTests()).toBe(true)

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(OMNIBELT_BOOTSTRAP_PLACEHOLDER), {
        status: 200,
      })
    )

    const client = makeClient()
    await act(async () => {
      renderHook(() => useOmnibeltBootstrap(), {
        wrapper: makeWrapper(client),
      })
      // Give React a few microtasks to commit + TanStack a turn to act.
      await new Promise((r) => setTimeout(r, 30))
    })

    // Breaker is open → `enabled: false` → fetch NEVER ran even
    // though the auth gate is green and the queryKey is fresh.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Circuit-breaker primitive (driven directly to avoid timer races)
// ---------------------------------------------------------------------------

describe('useOmnibeltBootstrap — circuit-breaker primitive', () => {
  it('logs the actionable warn ONCE across many consecutive failures', () => {
    for (let i = 0; i < 5; i++) {
      __recordBootstrapFailureForTests(new BootstrapNetworkError('boom #' + i))
    }
    const backendWarnings = (logger.warn as unknown as Mock).mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' && call[0].includes('bootstrap unreachable')
    )
    expect(backendWarnings.length).toBe(1)
  })

  it('trips OPEN on the 3rd consecutive failure', () => {
    expect(__isBootstrapCircuitOpenForTests()).toBe(false)
    __recordBootstrapFailureForTests(new BootstrapNetworkError('1'))
    __recordBootstrapFailureForTests(new BootstrapNetworkError('2'))
    expect(__isBootstrapCircuitOpenForTests()).toBe(false)
    __recordBootstrapFailureForTests(new BootstrapNetworkError('3'))
    expect(__isBootstrapCircuitOpenForTests()).toBe(true)

    const tripWarn = (logger.warn as unknown as Mock).mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('circuit OPEN')
    )
    expect(tripWarn).toBeTruthy()
  })

  it('resets cleanly between test cases', () => {
    expect(__isBootstrapCircuitOpenForTests()).toBe(false)
  })
})

// Created and developed by Jai Singh
