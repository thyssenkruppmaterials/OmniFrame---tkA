// Created and developed by Jai Singh
/**
 * Regression tests for `useSqcdpMetrics`. The bug being guarded:
 *
 *   Failed to update metric: Cannot coerce the result to a single JSON object
 *
 * Root cause was migration 308's territory (a stale `has_permission`
 * function that rejected the UPDATE under RLS, so PostgREST's
 * `.single()` returned PGRST116). The client-side defence is to use
 * `.maybeSingle()` and surface a friendlier error when `data` is `null`
 * — this test pins that contract so a future refactor cannot quietly
 * re-introduce the raw `.single()` path.
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

let updateMaybeSingleData: Record<string, unknown> | null = null
let updateMaybeSingleError: { message: string } | null = null
const updateMaybeSingleCalls: number[] = []

const selectRows: Record<string, unknown>[] = [
  {
    id: 'metric-1',
    organization_id: 'org-test',
    category: 'safety',
    title: 'Recordables YTD',
    subtitle: null,
    value_format: 'number',
    current_value: 3,
    target_value: 0,
    unit: null,
    trend_period: 'rolling_4_weeks',
    color_hex: null,
    accent_hex: null,
    chart_type: 'area',
    show_markers: false,
    is_visible: true,
    display_order: 0,
    notes: null,
    style_config: null,
    sub_metrics: null,
    value_prefix: null,
    value_suffix: null,
    decimal_places: null,
    lower_is_better: true,
    show_trend: true,
    chart_config: null,
    updated_at: '2026-05-18T00:00:00Z',
    history: [],
  },
]

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from(table: string) {
      void table
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: string) {
              return {
                order(_c2: string, _o: { ascending: boolean }) {
                  return Promise.resolve({ data: selectRows, error: null })
                },
              }
            },
          }
        },
        update(_vals: Record<string, unknown>) {
          return {
            eq(_c: string, _v: string) {
              return {
                select(_cols: string) {
                  return {
                    maybeSingle() {
                      updateMaybeSingleCalls.push(updateMaybeSingleCalls.length)
                      return Promise.resolve({
                        data: updateMaybeSingleData,
                        error: updateMaybeSingleError,
                      })
                    },
                  }
                },
              }
            },
          }
        },
        insert(_rows: Record<string, unknown>[]) {
          return {
            select(_cols: string) {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: null, error: null })
                },
              }
            },
          }
        },
      }
    },
  },
}))

const { useSqcdpMetrics } = await import('./use-sqcdp-metrics')

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useSqcdpMetrics — updateMetric defensive handling', () => {
  beforeEach(() => {
    updateMaybeSingleData = null
    updateMaybeSingleError = null
    updateMaybeSingleCalls.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces a permission-flavoured error when the update returns no row (RLS gap)', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSqcdpMetrics(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let caught: Error | null = null
    await act(async () => {
      try {
        await result.current.updateMetric.mutateAsync({
          id: 'metric-1',
          patch: { title: 'Recordables YTD (edited)' },
        })
      } catch (err) {
        caught = err instanceof Error ? err : new Error(String(err))
      }
    })

    expect(caught).not.toBeNull()
    expect(caught!.message).not.toMatch(/cannot coerce/i)
    expect(caught!.message).toMatch(/production_boards:edit/)
    expect(caught!.message).toMatch(/administrator/)
    expect(updateMaybeSingleCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('passes through Supabase error messages verbatim when one is provided', async () => {
    updateMaybeSingleData = null
    updateMaybeSingleError = { message: 'check constraint violation: foo_bar' }
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSqcdpMetrics(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let caught: Error | null = null
    await act(async () => {
      try {
        await result.current.updateMetric.mutateAsync({
          id: 'metric-1',
          patch: { title: 'Recordables YTD (edited)' },
        })
      } catch (err) {
        caught = err instanceof Error ? err : new Error(String(err))
      }
    })

    expect(caught).not.toBeNull()
    expect(caught!.message).toBe('check constraint violation: foo_bar')
  })
})

// Created and developed by Jai Singh
