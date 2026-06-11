// Created and developed by Jai Singh
/**
 * useUpdateKillSwitch — optimistic update + rollback contract.
 *
 * Verifies:
 *   1. POST hits `/api/admin/omnibelt/kill-switch` with `{ enabled }`.
 *   2. On 200, the bootstrap cache flips immediately (optimistic).
 *   3. On error, the snapshot restores the previous state.
 */
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY } from '../hooks/useOmnibeltAdminBootstrap'
import { useUpdateKillSwitch } from '../hooks/useUpdateKillSwitch'

const fetchMock = vi.fn()
;(globalThis as unknown as { fetch: typeof fetch }).fetch =
  fetchMock as unknown as typeof fetch

const toastErrorMock = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  // `apiFetch` reads the session token via `supabase.auth.getSession()`
  // to attach the `Authorization: Bearer` header. Stub the auth surface
  // so the wrapper doesn't crash when the kill-switch mutation runs.
  supabase: {
    from: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
  supabaseRead: { from: vi.fn() },
}))

// `useUpdateKillSwitch` transitively pulls in `unified-auth-provider`
// (via `useOmnibeltAdminBootstrap`'s import). The provider eagerly
// instantiates the `singletonAuthManager` which in turn calls
// `supabase.auth.onAuthStateChange` — undefined in this test because
// the supabase client is mocked above. Mock the hook directly so the
// real provider chain never loads.
vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({
    authState: {
      isAuthenticated: true,
      profile: { organization_id: 'org-test' },
    },
  }),
}))

function makeWrapper(client: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }
  return Wrapper
}

beforeEach(() => {
  fetchMock.mockReset()
  toastErrorMock.mockReset()
})

describe('useUpdateKillSwitch', () => {
  it('posts to the FastAPI admin endpoint with { enabled }', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: false }), { status: 200 })
    )

    const { result } = renderHook(() => useUpdateKillSwitch(), {
      wrapper: makeWrapper(client),
    })

    await act(async () => {
      result.current.mutate(false)
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/omnibelt/kill-switch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
      })
    )
  })

  it('optimistically flips the cached killSwitch.enabled before the server responds', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    // Seed cache with a "currently enabled" bootstrap value.
    const seedKey = [...OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY, 'org-test']
    client.setQueryData(seedKey, {
      killSwitch: {
        enabled: true,
        source: 'org' as const,
        updated_at: null,
        updated_by: null,
      },
      allowList: null,
      roles: [],
      roleConfigs: [],
      activeUsersLast5m: 0,
    })

    // Block the fetch so the optimistic state stays visible.
    let resolveFetch: (v: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolveFetch = r
      })
    )

    const { result } = renderHook(() => useUpdateKillSwitch(), {
      wrapper: makeWrapper(client),
    })

    act(() => {
      result.current.mutate(false)
    })

    // Optimistic update applied
    await waitFor(() => {
      const cached = client.getQueryData(seedKey) as
        | { killSwitch: { enabled: boolean } }
        | undefined
      expect(cached?.killSwitch.enabled).toBe(false)
    })

    // Resolve the in-flight request so React Query doesn't dangle.
    resolveFetch(
      new Response(JSON.stringify({ enabled: false }), { status: 200 })
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('rolls the cache back to the snapshot on error', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const seedKey = [...OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY, 'org-test']
    const original = {
      killSwitch: {
        enabled: true,
        source: 'org' as const,
        updated_at: null,
        updated_by: null,
      },
      allowList: null,
      roles: [],
      roleConfigs: [],
      activeUsersLast5m: 0,
    }
    client.setQueryData(seedKey, original)

    fetchMock.mockResolvedValueOnce(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' })
    )

    const { result } = renderHook(() => useUpdateKillSwitch(), {
      wrapper: makeWrapper(client),
    })

    await act(async () => {
      result.current.mutate(false)
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    const cached = client.getQueryData(seedKey) as typeof original | undefined
    expect(cached?.killSwitch.enabled).toBe(true)
  })

  it('shows the backend-unreachable toast when the proxy returns 502', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    // Simulate the Vite proxy → upstream ECONNREFUSED path: most http
    // proxy middlewares surface a 502 to the caller. Anything in 5xx
    // is classified as `isNetworkError` and gets the actionable copy.
    fetchMock.mockResolvedValueOnce(
      new Response('connect ECONNREFUSED', {
        status: 502,
        statusText: 'Bad Gateway',
      })
    )

    const { result } = renderHook(() => useUpdateKillSwitch(), {
      wrapper: makeWrapper(client),
    })

    await act(async () => {
      result.current.mutate(false)
    })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(toastErrorMock).toHaveBeenCalledWith(
      'OmniBelt backend unreachable. Start the FastAPI server on :8000.'
    )
    // retry: 0 — should never get a second attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the permission toast when the endpoint returns 403', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response('forbidden', { status: 403, statusText: 'Forbidden' })
    )

    const { result } = renderHook(() => useUpdateKillSwitch(), {
      wrapper: makeWrapper(client),
    })

    await act(async () => {
      result.current.mutate(false)
    })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(toastErrorMock).toHaveBeenCalledWith(
      'You do not have permission to change the kill switch.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// Created and developed by Jai Singh
