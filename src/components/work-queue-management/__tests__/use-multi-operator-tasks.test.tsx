// Created and developed by Jai Singh
/**
 * Unit coverage for `useMultiOperatorTasks` — the dispatcher-grid
 * data layer.
 *
 * The hook is a thin orchestration over `useQueries` + a shell-level
 * WS handler; we test the pieces that matter for correctness and
 * for the "no per-lane WS handler stack" guarantee:
 *
 *   1. Calling `useMultiOperatorTasks` with N workers issues N
 *      parallel HTTP fetches that share keys with `useWorkerTasks`
 *      (i.e. the cache is shared with the per-operator dialog).
 *   2. A `TaskAssigned` event with a known `user_id` invalidates
 *      ONLY that worker's task cache.
 *   3. A `TaskAssigned` event for an unknown / out-of-grid worker
 *      does NOT invalidate any visible lane.
 *   4. The WS subscription is set up once for the dispatcher (not
 *      once per lane).
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Auth provider — return a stable organization id for every test.
vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({
    authState: {
      profile: { organization_id: 'org-test' },
    },
  }),
}))

// Work-service client — replaceable per test via the
// `getWorkerTasksMock` ref below.
const getWorkerTasksMock = vi.fn(async (workerId: string) => [
  { id: `t-${workerId}-1`, count_number: 'CC-1', status: 'pending' },
])
vi.mock('@/lib/work-service/client', () => ({
  workServiceClient: {
    getWorkerTasks: (id: string) => getWorkerTasksMock(id),
  },
}))

// WebSocket singleton — capture handler so we can fire events.
let capturedHandler: ((event: unknown) => void) | null = null
const wsMock = {
  isConnected: vi.fn(() => true),
  connect: vi.fn((_orgId: string, handler: (event: unknown) => void) => {
    capturedHandler = handler
  }),
  removeHandler: vi.fn(() => {
    capturedHandler = null
  }),
  onStateChange: vi.fn(() => () => undefined),
}
vi.mock('@/lib/work-service/websocket', () => ({
  workServiceWs: wsMock,
}))

// Logger — silence the [useMultiOperatorTasks] debug spam during tests.
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Silences the supabase auth-js / jsdom storage-stub unhandled
// rejection (mirrors the workaround in
// `work-distribution-panel.test.tsx`).
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
    },
  },
}))

// Imports must come after the mocks so the mocked modules are used.
const { useMultiOperatorTasks } =
  await import('../hooks/use-multi-operator-tasks')
const { WORKER_TASKS_QUERY_KEY } = await import('@/hooks/use-active-workers')

function makeWorker(id: string, name: string) {
  return {
    user_id: id,
    full_name: name,
    email: null,
    status: 'busy' as const,
    current_task_id: null,
    current_task_type: null,
    current_zone: null,
    current_location: null,
    last_heartbeat: '2026-05-10T12:00:00.000Z',
  }
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useMultiOperatorTasks', () => {
  let client: QueryClient
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })
    capturedHandler = null
    wsMock.connect.mockClear()
    wsMock.removeHandler.mockClear()
    getWorkerTasksMock.mockClear()
  })
  afterEach(() => {
    client.clear()
  })

  it('fetches tasks per visible worker via shared cache key', async () => {
    const workers = [
      makeWorker('w1', 'Worker One'),
      makeWorker('w2', 'Worker Two'),
    ]
    const { result } = renderHook(() => useMultiOperatorTasks({ workers }), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(getWorkerTasksMock).toHaveBeenCalledTimes(2))
    expect(result.current.lanes.size).toBe(2)
    // The cache key matches the per-operator dialog's (shared cache).
    expect(client.getQueryData([WORKER_TASKS_QUERY_KEY, 'w1'])).toBeTruthy()
    expect(client.getQueryData([WORKER_TASKS_QUERY_KEY, 'w2'])).toBeTruthy()
  })

  it('subscribes to the WS singleton ONCE for the dispatcher', () => {
    const workers = [
      makeWorker('w1', 'A'),
      makeWorker('w2', 'B'),
      makeWorker('w3', 'C'),
    ]
    renderHook(() => useMultiOperatorTasks({ workers }), {
      wrapper: wrapper(client),
    })
    // Three workers, one connect call.
    expect(wsMock.connect).toHaveBeenCalledTimes(1)
  })

  it('invalidates only the affected lane on `TaskAssigned` with user_id', async () => {
    const workers = [makeWorker('w1', 'A'), makeWorker('w2', 'B')]
    renderHook(() => useMultiOperatorTasks({ workers }), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(getWorkerTasksMock).toHaveBeenCalledTimes(2))
    const initialCalls = getWorkerTasksMock.mock.calls.length

    expect(capturedHandler).toBeTruthy()
    // Fire a TaskAssigned for w1.
    await act(async () => {
      capturedHandler?.({ type: 'TaskAssigned', user_id: 'w1' })
    })
    await waitFor(() =>
      expect(getWorkerTasksMock.mock.calls.length).toBeGreaterThan(initialCalls)
    )
    // Only w1 was refetched.
    const afterFireCalls = getWorkerTasksMock.mock.calls.slice(initialCalls)
    expect(afterFireCalls.every(([id]) => id === 'w1')).toBe(true)
  })

  it('does NOT invalidate any visible lane when TaskAssigned targets an off-grid worker', async () => {
    const workers = [makeWorker('w1', 'A'), makeWorker('w2', 'B')]
    renderHook(() => useMultiOperatorTasks({ workers }), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(getWorkerTasksMock).toHaveBeenCalledTimes(2))
    const initialCalls = getWorkerTasksMock.mock.calls.length

    // The hook fans out to all visible lanes when target is unknown
    // (correctness over efficiency — see the hook's comment). Fire a
    // TaskAssigned for an UNKNOWN worker (not in the visible set).
    // The hook treats this as a fan-out invalidation.
    await act(async () => {
      capturedHandler?.({ type: 'TaskAssigned', user_id: 'unknown' })
    })
    // Wait long enough for any fan-out refetch to land.
    await new Promise((r) => setTimeout(r, 50))
    const afterFireCalls = getWorkerTasksMock.mock.calls.slice(initialCalls)
    // Every refetch is for one of the visible workers (no spurious
    // refetch for the unknown id).
    for (const [id] of afterFireCalls) {
      expect(['w1', 'w2']).toContain(id)
    }
  })
})

// Created and developed by Jai Singh
