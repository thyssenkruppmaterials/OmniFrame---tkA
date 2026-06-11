// Created and developed by Jai Singh
/**
 * SQCDP Categories — TanStack Query hook against
 * `production_board_sqcdp_categories` (table added in migration 306).
 *
 * Org-scoped CRUD: list / create / update / hide / unhide / delete /
 * reorder / reset-to-builtins. Mutations honour the `production_boards
 * .edit` permission via the migration's RLS, so the hook does not
 * gate at the JS layer (the UI hides the manager affordance via
 * `useCanEditBoards()` instead).
 *
 * Concurrency: every mutation invalidates the org's cache key on
 * settle. We deliberately do NOT subscribe to a Supabase Realtime
 * channel — the workspace rule (Realtime Policy) bans new channels;
 * the category list mutates rarely so polling at 60s plus on-success
 * invalidation is plenty.
 */
import { useCallback, useMemo } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import {
  BUILTIN_CATEGORIES,
  BUILTIN_CATEGORY_SEED,
  type SqcdpCategoryDef,
  type SqcdpCategoryTier,
} from '../lib/categories'
import { resolveCategoryIcon } from '../lib/category-icons'

interface RawCategoryRow {
  id: string
  organization_id: string
  slug: string
  label: string
  icon_name: string
  default_color_hex: string
  tier: SqcdpCategoryTier
  display_order: number
  is_builtin: boolean
  is_hidden: boolean
  updated_at: string
}

export interface SqcdpCategoryRow extends SqcdpCategoryDef {
  rowId: string
  organizationId: string
}

export interface CreateSqcdpCategoryInput {
  slug: string
  label: string
  iconName: string
  defaultColorHex: string
  tier: SqcdpCategoryTier
  /** Defaults to MAX(display_order) + 1 within the tier. */
  displayOrder?: number
}

export type UpdateSqcdpCategoryInput = {
  rowId: string
  patch: Partial<{
    label: string
    iconName: string
    defaultColorHex: string
    tier: SqcdpCategoryTier
    displayOrder: number
    isHidden: boolean
  }>
}

export interface ReorderSqcdpCategoryInput {
  /**
   * Ordered array of `rowId`s representing the new display order. The
   * mutation slots the rows into 0..N-1. Pass the entire tier — the
   * mutation handles tier-scoped slotting.
   */
  rowIds: readonly string[]
  tier: SqcdpCategoryTier
}

function mapRow(raw: RawCategoryRow): SqcdpCategoryRow {
  return {
    id: raw.slug,
    rowId: raw.id,
    organizationId: raw.organization_id,
    label: raw.label,
    defaultColor: raw.default_color_hex,
    Icon: resolveCategoryIcon(raw.icon_name),
    iconName: raw.icon_name,
    tier: raw.tier,
    displayOrder: raw.display_order,
    isBuiltin: raw.is_builtin,
    isHidden: raw.is_hidden,
  }
}

function categoriesKey(orgId: string): readonly unknown[] {
  return ['sqcdp-categories', orgId] as const
}

interface UseSqcdpCategoriesResult {
  /** All categories (visible + hidden) for the caller's org. */
  categories: SqcdpCategoryRow[]
  /** `categories.filter(c => !c.isHidden)`. Memoised. */
  visibleCategories: SqcdpCategoryRow[]
  isLoading: boolean
  isFetching: boolean
  refresh: () => void
  createCategory: UseMutationResult<
    SqcdpCategoryRow,
    Error,
    CreateSqcdpCategoryInput
  >
  updateCategory: UseMutationResult<
    SqcdpCategoryRow,
    Error,
    UpdateSqcdpCategoryInput
  >
  deleteCategory: UseMutationResult<void, Error, string>
  reorderCategories: UseMutationResult<void, Error, ReorderSqcdpCategoryInput>
  resetToBuiltins: UseMutationResult<void, Error, void>
}

export function useSqcdpCategories(): UseSqcdpCategoriesResult {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''
  const queryClient = useQueryClient()

  const query = useQuery<SqcdpCategoryRow[]>({
    queryKey: categoriesKey(organizationId),
    enabled: !!organizationId,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              eq: (
                c: string,
                v: string
              ) => {
                order: (
                  c: string,
                  o: { ascending: boolean }
                ) => {
                  order: (
                    c: string,
                    o: { ascending: boolean }
                  ) => Promise<{
                    data: RawCategoryRow[] | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('production_board_sqcdp_categories')
        .select(
          `
          id, organization_id, slug, label, icon_name, default_color_hex,
          tier, display_order, is_builtin, is_hidden, updated_at
        `
        )
        .eq('organization_id', organizationId)
        .order('tier', { ascending: true })
        .order('display_order', { ascending: true })
      if (error) {
        logger.error('[useSqcdpCategories] query failed', error)
        throw new Error(error.message)
      }
      return (data ?? []).map(mapRow)
    },
  })

  // Empty-org fallback. The migration's per-org seed + trigger should
  // make this branch unreachable, but a misconfigured environment
  // (e.g. fresh dev DB without the migration) shouldn't paint a
  // catastrophic empty-grid UX — fall back to the builtin seed so the
  // SQCDP cards still render.
  const categories = useMemo<SqcdpCategoryRow[]>(() => {
    if (query.data && query.data.length > 0) return query.data
    if (!organizationId) return []
    return BUILTIN_CATEGORIES.map((c) => ({
      ...c,
      rowId: `builtin-fallback-${c.id}`,
      organizationId,
    }))
  }, [query.data, organizationId])

  const visibleCategories = useMemo<SqcdpCategoryRow[]>(
    () => categories.filter((c) => !c.isHidden),
    [categories]
  )

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({
      queryKey: categoriesKey(organizationId),
    })
  }, [queryClient, organizationId])

  const createCategory = useMutation<
    SqcdpCategoryRow,
    Error,
    CreateSqcdpCategoryInput
  >({
    mutationFn: async (input) => {
      const sameTier = (query.data ?? []).filter((c) => c.tier === input.tier)
      const nextDisplayOrder =
        input.displayOrder ??
        (sameTier.length
          ? Math.max(...sameTier.map((c) => c.displayOrder)) + 1
          : 0)

      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            insert: (rows: Record<string, unknown>[]) => {
              select: (cols: string) => {
                single: () => Promise<{
                  data: RawCategoryRow | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      )
        .from('production_board_sqcdp_categories')
        .insert([
          {
            organization_id: organizationId,
            slug: input.slug,
            label: input.label,
            icon_name: input.iconName,
            default_color_hex: input.defaultColorHex,
            tier: input.tier,
            display_order: nextDisplayOrder,
            is_builtin: false,
            is_hidden: false,
          },
        ])
        .select(
          `
          id, organization_id, slug, label, icon_name, default_color_hex,
          tier, display_order, is_builtin, is_hidden, updated_at
        `
        )
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to create category')
      }
      return mapRow(data)
    },
    onSuccess: () => {
      refresh()
      toast.success('Category created')
    },
    onError: (err) => {
      toast.error(`Failed to create category: ${err.message}`)
    },
  })

  const updateCategory = useMutation<
    SqcdpCategoryRow,
    Error,
    UpdateSqcdpCategoryInput
  >({
    mutationFn: async ({ rowId, patch }) => {
      const update: Record<string, unknown> = {}
      if (patch.label !== undefined) update.label = patch.label
      if (patch.iconName !== undefined) update.icon_name = patch.iconName
      if (patch.defaultColorHex !== undefined)
        update.default_color_hex = patch.defaultColorHex
      if (patch.tier !== undefined) update.tier = patch.tier
      if (patch.displayOrder !== undefined)
        update.display_order = patch.displayOrder
      if (patch.isHidden !== undefined) update.is_hidden = patch.isHidden

      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            update: (vals: Record<string, unknown>) => {
              eq: (
                c: string,
                v: string
              ) => {
                select: (cols: string) => {
                  single: () => Promise<{
                    data: RawCategoryRow | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('production_board_sqcdp_categories')
        .update(update)
        .eq('id', rowId)
        .select(
          `
          id, organization_id, slug, label, icon_name, default_color_hex,
          tier, display_order, is_builtin, is_hidden, updated_at
        `
        )
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to update category')
      }
      return mapRow(data)
    },
    onSuccess: () => {
      refresh()
      toast.success('Category updated')
    },
    onError: (err) => {
      toast.error(`Failed to update category: ${err.message}`)
    },
  })

  const deleteCategory = useMutation<void, Error, string>({
    mutationFn: async (rowId) => {
      const { error } = await (
        supabase as unknown as {
          from: (t: string) => {
            delete: () => {
              eq: (
                c: string,
                v: string
              ) => Promise<{ error: { message: string } | null }>
            }
          }
        }
      )
        .from('production_board_sqcdp_categories')
        .delete()
        .eq('id', rowId)
      if (error) {
        // Postgres RESTRICT FK violation surfaces as code 23503.
        // Translate the system message to something a curator can act on.
        const friendly =
          /violates foreign key constraint|sqcdp_metrics_category_fk|sqcdp_problems_category_fk/i.test(
            error.message
          )
            ? 'Cannot delete: this category still has metrics or problems referencing it. Move or delete those first, or hide the category instead.'
            : error.message
        throw new Error(friendly)
      }
    },
    onSuccess: () => {
      refresh()
      toast.success('Category deleted')
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const reorderCategories = useMutation<void, Error, ReorderSqcdpCategoryInput>(
    {
      mutationFn: async ({ rowIds, tier: _tier }) => {
        // PostgREST does not support multi-row UPDATEs with per-row values
        // in a single round-trip, so we fan out — one UPDATE per row. Tiny
        // payload (≤ ~12 rows in practice) so the round-trip cost is fine.
        const updates = rowIds.map((rowId, idx) =>
          (
            supabase as unknown as {
              from: (t: string) => {
                update: (vals: Record<string, unknown>) => {
                  eq: (
                    c: string,
                    v: string
                  ) => Promise<{ error: { message: string } | null }>
                }
              }
            }
          )
            .from('production_board_sqcdp_categories')
            .update({ display_order: idx })
            .eq('id', rowId)
        )
        const results = await Promise.all(updates)
        const firstError = results.find((r) => r.error)
        if (firstError?.error) {
          throw new Error(firstError.error.message)
        }
      },
      onSuccess: () => {
        refresh()
      },
      onError: (err) => {
        toast.error(`Failed to reorder categories: ${err.message}`)
      },
    }
  )

  const resetToBuiltins = useMutation<void, Error, void>({
    mutationFn: async () => {
      // Upsert the canonical builtin shape for every seed entry. Keeps
      // is_hidden=false + is_builtin=true so previously-hidden builtins
      // re-appear and any custom edits to label / icon / color get
      // reverted. Custom (non-builtin) categories are untouched.
      const rows = BUILTIN_CATEGORY_SEED.map((c) => ({
        organization_id: organizationId,
        slug: c.id,
        label: c.label,
        icon_name: c.iconName,
        default_color_hex: c.defaultColor,
        tier: c.tier,
        display_order: c.displayOrder,
        is_builtin: true,
        is_hidden: false,
      }))
      const { error } = await (
        supabase as unknown as {
          from: (t: string) => {
            upsert: (
              rows: Record<string, unknown>[],
              opts: { onConflict: string }
            ) => Promise<{ error: { message: string } | null }>
          }
        }
      )
        .from('production_board_sqcdp_categories')
        .upsert(rows, { onConflict: 'organization_id,slug' })
      if (error) {
        throw new Error(error.message)
      }
    },
    onSuccess: () => {
      refresh()
      toast.success('Builtins restored to defaults')
    },
    onError: (err) => {
      toast.error(`Failed to reset builtins: ${err.message}`)
    },
  })

  return {
    categories,
    visibleCategories,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refresh,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    resetToBuiltins,
  }
}

export const _internalKeys = { categoriesKey }

// Created and developed by Jai Singh
