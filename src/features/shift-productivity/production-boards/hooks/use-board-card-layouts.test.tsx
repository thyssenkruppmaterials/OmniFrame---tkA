// Created and developed by Jai Singh
/**
 * Smoke tests for `useBoardCardLayouts` — exercises:
 *
 *  - The query maps raw rows into the camel-cased shape + parses
 *    `card_variant` + `variant_config` defensively.
 *  - upsertLayout invokes the correct supabase call shape.
 *  - resetBoardLayout deletes by the (org, board, scope) tuple.
 */
import type { ReactNode } from 'react'
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationResult,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBoardCardLayouts } from './use-board-card-layouts'

const rawRows = [
  {
    id: 'l-1',
    organization_id: 'org-1',
    board_kind: 'announcement',
    scope: 'all',
    post_id: 'p-1',
    post_kind: 'post',
    grid_x: 0,
    grid_y: 0,
    grid_w: 6,
    grid_h: 2,
    card_variant: 'banner',
    variant_config: { cover_position: 'top' },
    created_at: '2026-05-17T00:00:00Z',
    updated_at: '2026-05-17T00:00:00Z',
  },
  {
    id: 'l-2',
    organization_id: 'org-1',
    board_kind: 'announcement',
    scope: 'all',
    post_id: 'p-2',
    post_kind: 'post',
    grid_x: 6,
    grid_y: 0,
    grid_w: 3,
    grid_h: 2,
    card_variant: 'unknown-future-variant',
    variant_config: 'not-an-object',
    created_at: '2026-05-17T00:00:00Z',
    updated_at: '2026-05-17T00:00:00Z',
  },
]

const upsertCall = vi.fn()
const deleteCall = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: rawRows, error: null })),
          })),
        })),
      }))
      chain.upsert = vi.fn((row: Record<string, unknown>, opts: unknown) => {
        upsertCall(row, opts)
        return {
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: {
                  ...rawRows[0],
                  id: 'new-layout-id',
                  ...row,
                  variant_config: row.variant_config,
                },
                error: null,
              })
            ),
          })),
        }
      })
      chain.delete = vi.fn(() => ({
        eq: vi.fn((col1: string, val1: string) => {
          deleteCall(col1, val1)
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          }
        }),
      }))
      return chain
    },
  },
}))

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({
    authState: { user: { id: 'u-1' }, profile: { organization_id: 'org-1' } },
  }),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  upsertCall.mockClear()
  deleteCall.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useBoardCardLayouts', () => {
  it('returns a Map keyed by post_id', async () => {
    const { result } = renderHook(
      () => useBoardCardLayouts('announcement', 'all'),
      { wrapper: wrap }
    )
    await waitFor(() => expect(result.current.layouts.size).toBe(2))
    expect(result.current.layouts.get('p-1')?.cardVariant).toBe('banner')
  })

  it('parses banner cover_position correctly', async () => {
    const { result } = renderHook(
      () => useBoardCardLayouts('announcement', 'all'),
      { wrapper: wrap }
    )
    await waitFor(() => expect(result.current.layouts.size).toBe(2))
    const layout = result.current.layouts.get('p-1')!
    expect(layout.variantConfig).toEqual({ cover_position: 'top' })
  })

  it('falls back to classic for unknown variants', async () => {
    const { result } = renderHook(
      () => useBoardCardLayouts('announcement', 'all'),
      { wrapper: wrap }
    )
    await waitFor(() => expect(result.current.layouts.size).toBe(2))
    expect(result.current.layouts.get('p-2')?.cardVariant).toBe('classic')
  })

  it('drops malformed variant_config to {}', async () => {
    const { result } = renderHook(
      () => useBoardCardLayouts('announcement', 'all'),
      { wrapper: wrap }
    )
    await waitFor(() => expect(result.current.layouts.size).toBe(2))
    expect(result.current.layouts.get('p-2')?.variantConfig).toEqual({})
  })

  it('upsertLayout sends the correct payload + conflict key', async () => {
    const { result } = renderHook(
      () => useBoardCardLayouts('announcement', 'all'),
      { wrapper: wrap }
    )
    await waitFor(() => expect(result.current.layouts.size).toBe(2))
    const mutation = result.current
      .upsertLayout as unknown as UseMutationResult<unknown, Error, unknown>

    await act(async () => {
      ;(mutation.mutateAsync as (input: unknown) => Promise<unknown>)({
        postId: 'p-new',
        postKind: 'post',
        gridX: 2,
        gridY: 4,
        gridW: 4,
        gridH: 3,
        cardVariant: 'spotlight',
        variantConfig: {},
      })
    })
    expect(upsertCall).toHaveBeenCalledTimes(1)
    const [row, opts] = upsertCall.mock.calls[0]
    expect((row as Record<string, unknown>).board_kind).toBe('announcement')
    expect((row as Record<string, unknown>).scope).toBe('all')
    expect((row as Record<string, unknown>).post_id).toBe('p-new')
    expect((row as Record<string, unknown>).card_variant).toBe('spotlight')
    expect(opts).toEqual({
      onConflict: 'organization_id,board_kind,scope,post_kind,post_id',
    })
  })

  it('resetBoardLayout filters by org first', async () => {
    const { result } = renderHook(
      () => useBoardCardLayouts('announcement', 'all'),
      { wrapper: wrap }
    )
    await waitFor(() => expect(result.current.layouts.size).toBe(2))
    await act(async () => {
      await (
        result.current.resetBoardLayout.mutateAsync as () => Promise<unknown>
      )()
    })
    expect(deleteCall).toHaveBeenCalledWith('organization_id', 'org-1')
  })
})

// Created and developed by Jai Singh
