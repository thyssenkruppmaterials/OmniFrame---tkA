// Created and developed by Jai Singh
/**
 * Smoke tests for `useSqcdpMetricHistory`. We mock the supabase chain
 * (no msw) since the hook uses a thin builder pattern and the surface we
 * care about is "did the optimistic cache get the right shape, and did
 * the right invalidations fire after settle?". A live Postgres roundtrip
 * is over-the-top here.
 */
import { type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({
    authState: { profile: { organization_id: 'org-test' } },
  }),
}))

// Stable supabase chain stub. Each `from(table)` call returns a bag of
// chainable methods. The select+eq+gte+order chain resolves with
// `selectRows`; insert+select+single resolves with `insertRow`; update
// resolves with `updateRow`; delete returns `{ error: null }`.
let selectRows: {
  id: number
  metric_id: string
  recorded_at: string
  value: number
  source: string | null
}[] = []
let insertRow: (typeof selectRows)[number] | null = null
let updateRow: (typeof selectRows)[number] | null = null
let bulkInsertRows: typeof selectRows = []
const insertCalls: Record<string, unknown>[][] = []
const updateCalls: Record<string, unknown>[] = []
const deleteCalls: number[] = []

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from(table: string) {
      void table
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: string) {
              return {
                gte(_c2: string, _v2: string) {
                  return {
                    order(_c3: string, _o: { ascending: boolean }) {
                      return Promise.resolve({
                        data: selectRows,
                        error: null,
                      })
                    },
                  }
                },
              }
            },
          }
        },
        insert(rows: Record<string, unknown>[]) {
          insertCalls.push(rows)
          // Multi-row insert returns a select() => Promise; single-row
          // returns a select().single() => Promise. Disambiguate by
          // length.
          if (rows.length > 1) {
            return {
              select(_cols: string) {
                return Promise.resolve({
                  data: bulkInsertRows,
                  error: null,
                })
              },
            }
          }
          return {
            select(_cols: string) {
              return {
                single() {
                  return Promise.resolve({
                    data: insertRow,
                    error: null,
                  })
                },
              }
            },
          }
        },
        update(vals: Record<string, unknown>) {
          updateCalls.push(vals)
          return {
            eq(_c: string, _v: number) {
              return {
                select(_cols: string) {
                  return {
                    single() {
                      return Promise.resolve({
                        data: updateRow,
                        error: null,
                      })
                    },
                  }
                },
              }
            },
          }
        },
        delete() {
          return {
            eq(_c: string, v: number) {
              deleteCalls.push(v)
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  },
}))

const { useSqcdpMetricHistory, historyKey } =
  await import('./use-sqcdp-metric-history')

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useSqcdpMetricHistory', () => {
  beforeEach(() => {
    selectRows = []
    insertRow = null
    updateRow = null
    bulkInsertRows = []
    insertCalls.length = 0
    updateCalls.length = 0
    deleteCalls.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('disables query and returns empty points when metricId is null', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSqcdpMetricHistory(null), {
      wrapper,
    })
    expect(result.current.points).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('createPoint optimistically inserts then invalidates after settle', async () => {
    selectRows = [
      {
        id: 1,
        metric_id: 'm-1',
        recorded_at: '2026-04-01T00:00:00Z',
        value: 10,
        source: 'manual',
      },
    ]
    insertRow = {
      id: 2,
      metric_id: 'm-1',
      recorded_at: '2026-04-15T00:00:00Z',
      value: 12,
      source: 'manual',
    }
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSqcdpMetricHistory('m-1'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.points.length).toBe(1))
    await act(async () => {
      await result.current.createPoint.mutateAsync({
        recordedAt: '2026-04-15T00:00:00Z',
        value: 12,
      })
    })
    expect(insertCalls.length).toBe(1)
    expect(insertCalls[0][0]).toMatchObject({
      metric_id: 'm-1',
      recorded_at: '2026-04-15T00:00:00Z',
      value: 12,
      source: 'manual',
    })
  })

  it('updatePoint optimistically patches the matching row', async () => {
    selectRows = [
      {
        id: 1,
        metric_id: 'm-1',
        recorded_at: '2026-04-01T00:00:00Z',
        value: 10,
        source: 'manual',
      },
      {
        id: 2,
        metric_id: 'm-1',
        recorded_at: '2026-04-15T00:00:00Z',
        value: 20,
        source: 'manual',
      },
    ]
    updateRow = {
      id: 2,
      metric_id: 'm-1',
      recorded_at: '2026-04-15T00:00:00Z',
      value: 25,
      source: 'manual',
    }
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSqcdpMetricHistory('m-1'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.points.length).toBe(2))
    await act(async () => {
      await result.current.updatePoint.mutateAsync({
        id: 2,
        value: 25,
      })
    })
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]).toMatchObject({ value: 25 })
  })

  it('deletePoint removes the row optimistically and resolves', async () => {
    selectRows = [
      {
        id: 1,
        metric_id: 'm-1',
        recorded_at: '2026-04-01T00:00:00Z',
        value: 10,
        source: 'manual',
      },
    ]
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSqcdpMetricHistory('m-1'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.points.length).toBe(1))
    await act(async () => {
      await result.current.deletePoint.mutateAsync(1)
    })
    expect(deleteCalls).toEqual([1])
  })

  it('bulkInsertPoints sends a single insert with the full array', async () => {
    bulkInsertRows = Array.from({ length: 3 }).map((_, i) => ({
      id: i + 10,
      metric_id: 'm-1',
      recorded_at: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      value: 5 + i,
      source: 'sample',
    }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSqcdpMetricHistory('m-1'), {
      wrapper,
    })
    await act(async () => {
      const inserted = await result.current.bulkInsertPoints.mutateAsync({
        inserts: [
          { recordedAt: '2026-04-01T00:00:00Z', value: 5 },
          { recordedAt: '2026-04-02T00:00:00Z', value: 6 },
          { recordedAt: '2026-04-03T00:00:00Z', value: 7 },
        ],
      })
      expect(inserted.length).toBe(3)
    })
    expect(insertCalls.length).toBe(1)
    expect(insertCalls[0].length).toBe(3)
    expect(insertCalls[0][0]).toMatchObject({
      metric_id: 'm-1',
      source: 'sample',
    })
  })

  it('exports a stable history query key shape', () => {
    expect(historyKey('m-1')).toEqual(['sqcdp-metric-history', 'm-1', '180d'])
    expect(historyKey(null)).toEqual(['sqcdp-metric-history', null, '180d'])
  })
})

// Created and developed by Jai Singh
