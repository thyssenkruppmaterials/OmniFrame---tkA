// Created and developed by Jai Singh
/**
 * Smoke tests for `useSqcdpCategories`. We mock the supabase chain (no
 * msw) since the hook uses a thin builder pattern; we only care that
 * the read maps shape correctly + the create / update / delete payloads
 * land on the right table with the right columns.
 */
import { type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({
    authState: { profile: { organization_id: 'org-test' } },
  }),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const seedRows = [
  {
    id: 'row-safety',
    organization_id: 'org-test',
    slug: 'safety',
    label: 'Safety',
    icon_name: 'IconShield',
    default_color_hex: '#DC2626',
    tier: 'primary' as const,
    display_order: 0,
    is_builtin: true,
    is_hidden: false,
    updated_at: '2026-05-17T00:00:00Z',
  },
  {
    id: 'row-quality',
    organization_id: 'org-test',
    slug: 'quality',
    label: 'Quality',
    icon_name: 'IconCheck',
    default_color_hex: '#16A34A',
    tier: 'primary' as const,
    display_order: 1,
    is_builtin: true,
    is_hidden: false,
    updated_at: '2026-05-17T00:00:00Z',
  },
]

const insertCalls: Record<string, unknown>[][] = []
const updateCalls: { id?: string; vals: Record<string, unknown> }[] = []
const deleteCalls: string[] = []
const upsertCalls: Record<string, unknown>[][] = []

function clearCalls(): void {
  insertCalls.length = 0
  updateCalls.length = 0
  deleteCalls.length = 0
  upsertCalls.length = 0
}

let deleteShouldFail: { message: string } | null = null

vi.mock('@/lib/supabase/client', () => {
  const fromTable = () => ({
    select: () => ({
      eq: () => ({
        order: () => ({
          order: () => Promise.resolve({ data: seedRows, error: null }),
        }),
      }),
    }),
    insert: (rows: Record<string, unknown>[]) => {
      insertCalls.push(rows)
      return {
        select: () => ({
          single: () =>
            Promise.resolve({
              data: {
                ...seedRows[0],
                ...rows[0],
                id: 'row-new',
                updated_at: '2026-05-17T01:00:00Z',
              },
              error: null,
            }),
        }),
      }
    },
    update: (vals: Record<string, unknown>) => ({
      eq: (_col: string, id: string) => {
        updateCalls.push({ id, vals })
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: { ...seedRows[0], ...vals, id },
                error: null,
              }),
          }),
        }
      },
    }),
    delete: () => ({
      eq: (_col: string, id: string) => {
        deleteCalls.push(id)
        if (deleteShouldFail) {
          return Promise.resolve({ error: deleteShouldFail })
        }
        return Promise.resolve({ error: null })
      },
    }),
    upsert: (rows: Record<string, unknown>[]) => {
      upsertCalls.push(rows)
      return Promise.resolve({ error: null })
    },
  })
  return {
    supabase: {
      from: vi.fn(fromTable),
    },
  }
})

const { useSqcdpCategories } = await import('./use-sqcdp-categories')

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

describe('useSqcdpCategories', () => {
  it('maps DB rows into SqcdpCategoryRow with resolved icons', async () => {
    clearCalls()
    const { result } = renderHook(() => useSqcdpCategories(), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.categories.length).toBe(2))
    expect(result.current.categories[0].id).toBe('safety')
    expect(result.current.categories[0].iconName).toBe('IconShield')
    expect(result.current.categories[0].defaultColor).toBe('#DC2626')
    expect(result.current.categories[0].isBuiltin).toBe(true)
  })

  it('createCategory inserts with the new slug + tier + auto-incremented display_order', async () => {
    clearCalls()
    const { result } = renderHook(() => useSqcdpCategories(), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.categories.length).toBe(2))
    await act(async () => {
      await result.current.createCategory.mutateAsync({
        slug: 'compliance',
        label: 'Compliance',
        iconName: 'IconClipboardCheck',
        defaultColorHex: '#0EA5A9',
        tier: 'primary',
      })
    })
    expect(insertCalls).toHaveLength(1)
    const row = insertCalls[0][0]
    expect(row.slug).toBe('compliance')
    expect(row.tier).toBe('primary')
    // 2 builtin primaries with order 0/1 → next inserted is order 2.
    expect(row.display_order).toBe(2)
    expect(row.is_builtin).toBe(false)
    expect(row.is_hidden).toBe(false)
  })

  it('updateCategory only patches set fields', async () => {
    clearCalls()
    const { result } = renderHook(() => useSqcdpCategories(), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.categories.length).toBe(2))
    await act(async () => {
      await result.current.updateCategory.mutateAsync({
        rowId: 'row-safety',
        patch: { isHidden: true },
      })
    })
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]).toEqual({
      id: 'row-safety',
      vals: { is_hidden: true },
    })
  })

  it('deleteCategory translates FK-violation messages into a curator-friendly hint', async () => {
    clearCalls()
    deleteShouldFail = {
      message:
        'update or delete on table "production_board_sqcdp_categories" violates foreign key constraint "sqcdp_metrics_category_fk"',
    }
    const { result } = renderHook(() => useSqcdpCategories(), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.categories.length).toBe(2))
    await act(async () => {
      await expect(
        result.current.deleteCategory.mutateAsync('row-safety')
      ).rejects.toThrow(/Cannot delete/)
    })
    deleteShouldFail = null
  })

  it('reorderCategories slots row IDs into 0..N-1 display_order', async () => {
    clearCalls()
    const { result } = renderHook(() => useSqcdpCategories(), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.categories.length).toBe(2))
    await act(async () => {
      await result.current.reorderCategories.mutateAsync({
        rowIds: ['row-quality', 'row-safety'],
        tier: 'primary',
      })
    })
    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[0]).toEqual({
      id: 'row-quality',
      vals: { display_order: 0 },
    })
    expect(updateCalls[1]).toEqual({
      id: 'row-safety',
      vals: { display_order: 1 },
    })
  })

  it('resetToBuiltins upserts all 9 canonical seed rows', async () => {
    clearCalls()
    const { result } = renderHook(() => useSqcdpCategories(), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.categories.length).toBe(2))
    await act(async () => {
      await result.current.resetToBuiltins.mutateAsync()
    })
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]).toHaveLength(9)
    const slugs = upsertCalls[0].map((r) => r.slug as string).sort()
    expect(slugs).toEqual(
      [
        'announcement',
        'big_idea',
        'cost',
        'delivery',
        'maintenance',
        'production',
        'quality',
        'safety',
        'shipping',
      ].sort()
    )
    expect(upsertCalls[0].every((r) => r.is_builtin === true)).toBe(true)
    expect(upsertCalls[0].every((r) => r.is_hidden === false)).toBe(true)
  })
})

// Created and developed by Jai Singh
