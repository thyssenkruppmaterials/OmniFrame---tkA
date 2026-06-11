// Created and developed by Jai Singh
/**
 * Unit coverage for `useCrossLaneReassign` — cross-lane reassign
 * mutation with optimistic UI + Undo toast.
 *
 * Covers:
 *
 *   1. A successful reassign removes the task from the source
 *      lane's cache and inserts it into the target lane's cache.
 *   2. A rejected reassign (server error) rolls both caches back
 *      to their pre-mutation snapshots and surfaces an error toast.
 *   3. An attempted reassign of an `in_progress` task is rejected
 *      client-side without calling `pushToUser`; an error toast is
 *      surfaced.
 */
import type { ReactNode } from 'react'
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

const pushToUserMock: Mock = vi.fn(async () => undefined)
vi.mock('@/lib/work-service/client', () => ({
  workServiceClient: {
    pushToUser: (taskId: string, userId: string) =>
      pushToUserMock(taskId, userId),
  },
}))

// Silences the supabase auth-js / jsdom storage-stub unhandled
// rejection that surfaces every time a test imports something that
// loads `@/lib/supabase/client`. Mirrors the workaround documented
// in `work-distribution-panel.test.tsx`.
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

const sonnerMock = {
  success: vi.fn(),
  error: vi.fn(),
}
vi.mock('sonner', () => ({ toast: sonnerMock }))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const { useCrossLaneReassign } =
  await import('../hooks/use-cross-lane-reassign')
const { WORKER_TASKS_QUERY_KEY } = await import('@/hooks/use-active-workers')

function makeTask(id: string, status = 'pending') {
  return {
    id,
    count_number: `CC-${id}`,
    material_number: 'M1',
    material_description: null,
    location: 'L1',
    warehouse: null,
    system_quantity: 1,
    counted_quantity: null,
    unit_of_measure: 'EA',
    priority: 'normal' as const,
    status,
    count_type: null,
    assigned_to: 'w1',
    assigned_at: null,
    push_mode: 'pull' as const,
    pushed_by: null,
    pushed_at: null,
    push_acknowledged: false,
    organization_id: 'org-1',
    completed_at: null,
    recount_by: null,
    recount_date: null,
    recount_completed: false,
    requires_recount: false,
    counter_name: null,
    resolved_location_key: null,
    resolved_zone: null,
    resolved_aisle: null,
    resolved_sequence: null,
    resolution_source: null,
    workflow_config_id: null,
    workflow_config_version: null,
    workflow_snapshot: {},
    workflow_result: {},
    evidence_photo_urls: null,
    review_threshold_pct: null,
    review_threshold_abs: null,
    scanned_material_number: null,
    location_reported_empty: null,
    part_variance: null,
    scanned_parts: [],
    transfer_destination_location: null,
    transfer_source_quantity: null,
  }
}

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

describe('useCrossLaneReassign', () => {
  let client: QueryClient
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          // Keep cache entries pinned so post-mutation assertions
          // can inspect what setQueryData / invalidateQueries left
          // behind. Without this, gcTime:0 evicts the entry the
          // moment there are no observers.
          gcTime: Infinity,
          staleTime: Infinity,
        },
      },
    })
    pushToUserMock.mockReset()
    sonnerMock.success.mockReset()
    sonnerMock.error.mockReset()
  })
  afterEach(() => {
    client.clear()
  })

  it('optimistically moves the task between lanes on success', async () => {
    const task = makeTask('t1')
    client.setQueryData([WORKER_TASKS_QUERY_KEY, 'w1'], [task])
    client.setQueryData([WORKER_TASKS_QUERY_KEY, 'w2'], [])
    pushToUserMock.mockResolvedValueOnce(undefined)

    const workers = [makeWorker('w1', 'Alice'), makeWorker('w2', 'Bob')]
    const { result } = renderHook(() => useCrossLaneReassign({ workers }), {
      wrapper: wrapper(client),
    })

    await result.current.reassign({
      task,
      fromWorkerId: 'w1',
      toWorkerId: 'w2',
    })

    await waitFor(() => expect(pushToUserMock).toHaveBeenCalled())
    expect(pushToUserMock).toHaveBeenCalledWith('t1', 'w2')

    const w1Cache = client.getQueryData<Array<{ id: string }>>([
      WORKER_TASKS_QUERY_KEY,
      'w1',
    ])
    const w2Cache = client.getQueryData<Array<{ id: string }>>([
      WORKER_TASKS_QUERY_KEY,
      'w2',
    ])
    expect(w1Cache?.find((t) => t.id === 't1')).toBeUndefined()
    expect(w2Cache?.find((t) => t.id === 't1')).toBeTruthy()
    expect(sonnerMock.success).toHaveBeenCalledWith(
      'CC-t1 moved to Bob.',
      expect.objectContaining({ action: expect.any(Object) })
    )
  })

  it('rolls back both caches when the server rejects', async () => {
    const task = makeTask('t2')
    client.setQueryData([WORKER_TASKS_QUERY_KEY, 'w1'], [task])
    client.setQueryData([WORKER_TASKS_QUERY_KEY, 'w2'], [])
    pushToUserMock.mockRejectedValueOnce(new Error('ZONE_LOCKED'))

    const workers = [makeWorker('w1', 'Alice'), makeWorker('w2', 'Bob')]
    const { result } = renderHook(() => useCrossLaneReassign({ workers }), {
      wrapper: wrapper(client),
    })

    await result.current.reassign({
      task,
      fromWorkerId: 'w1',
      toWorkerId: 'w2',
    })

    const w1Cache = client.getQueryData<Array<{ id: string }>>([
      WORKER_TASKS_QUERY_KEY,
      'w1',
    ])
    const w2Cache = client.getQueryData<Array<{ id: string }>>([
      WORKER_TASKS_QUERY_KEY,
      'w2',
    ])
    expect(w1Cache?.[0]?.id).toBe('t2')
    expect(w2Cache?.length ?? 0).toBe(0)
    expect(sonnerMock.error).toHaveBeenCalledWith(
      "Couldn't reassign CC-t2 to Bob.",
      expect.objectContaining({
        description: expect.stringContaining('rejected'),
      })
    )
    expect(sonnerMock.success).not.toHaveBeenCalled()
  })

  it('refuses an in-progress reassign without calling pushToUser', async () => {
    const task = makeTask('t3', 'in_progress')
    client.setQueryData([WORKER_TASKS_QUERY_KEY, 'w1'], [task])
    client.setQueryData([WORKER_TASKS_QUERY_KEY, 'w2'], [])

    const workers = [makeWorker('w1', 'Alice'), makeWorker('w2', 'Bob')]
    const { result } = renderHook(() => useCrossLaneReassign({ workers }), {
      wrapper: wrapper(client),
    })

    await result.current.reassign({
      task,
      fromWorkerId: 'w1',
      toWorkerId: 'w2',
    })

    expect(pushToUserMock).not.toHaveBeenCalled()
    expect(sonnerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('in progress')
    )
  })
})

// Created and developed by Jai Singh
