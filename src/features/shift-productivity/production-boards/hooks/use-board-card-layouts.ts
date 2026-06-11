// Created and developed by Jai Singh
/**
 * Per-board card layouts hook (`production_board_card_layouts`).
 *
 * Returns a Map<post_id, CardLayoutRow> for every board × scope, plus
 * three mutations:
 *
 *   - `upsertLayout` — saves a single card's position / size / variant /
 *     variant_config; idempotent on the unique key
 *     (org, board, scope, post_kind, post_id).
 *   - `deleteLayout` — drops a row, falling the card back to its
 *     default placement on the next render.
 *   - `resetBoardLayout` — bulk-deletes every row for (board, scope).
 *
 * Polling: 60 s, visibility-gated (matches the rest of the board hooks).
 * No new Supabase Realtime channel — per the workspace Realtime Policy
 * (`.cursor/rules/Master Rule.mdc`), org-fanout realtime workloads
 * must not introduce new channels. Polling on mutation invalidation is
 * sufficient for curator-driven layout changes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  parseCardVariant,
  parseVariantConfig,
  type BentoBoardKind,
  type BentoPostKind,
  type CardLayoutRow,
  type CardVariant,
  type VariantConfig,
} from '../components/bento/card-variant'

interface RawLayout {
  id: string
  organization_id: string
  board_kind: string
  scope: string
  post_id: string
  post_kind: string
  grid_x: number
  grid_y: number
  grid_w: number
  grid_h: number
  card_variant: string
  variant_config: unknown
  created_at: string
  updated_at: string
}

const SELECT_COLS =
  'id, organization_id, board_kind, scope, post_id, post_kind, grid_x, grid_y, grid_w, grid_h, card_variant, variant_config, created_at, updated_at'

function mapRow(raw: RawLayout): CardLayoutRow {
  const variant = parseCardVariant(raw.card_variant)
  return {
    id: raw.id,
    organizationId: raw.organization_id,
    boardKind: raw.board_kind as BentoBoardKind,
    scope: raw.scope,
    postId: raw.post_id,
    postKind: raw.post_kind as BentoPostKind,
    gridX: raw.grid_x,
    gridY: raw.grid_y,
    gridW: raw.grid_w,
    gridH: raw.grid_h,
    cardVariant: variant,
    variantConfig: parseVariantConfig(variant, raw.variant_config),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible'
  )
  useEffect(() => {
    if (typeof document === 'undefined') return
    const handler = (): void => {
      setVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])
  return visible
}

function layoutsKey(
  boardKind: BentoBoardKind,
  scope: string,
  orgId: string
): readonly unknown[] {
  return ['board-card-layouts', boardKind, scope, orgId] as const
}

export interface UpsertLayoutInput {
  postId: string
  postKind: BentoPostKind
  gridX: number
  gridY: number
  gridW: number
  gridH: number
  cardVariant: CardVariant
  variantConfig?: VariantConfig
}

interface UseBoardCardLayoutsResult {
  layouts: Map<string, CardLayoutRow>
  isLoading: boolean
  isFetching: boolean
  refresh: () => void
  upsertLayout: UseMutationResult<CardLayoutRow, Error, UpsertLayoutInput>
  deleteLayout: UseMutationResult<void, Error, string>
  /** Reset every layout for the (board, scope) — restores defaults. */
  resetBoardLayout: UseMutationResult<void, Error, void>
}

export function useBoardCardLayouts(
  boardKind: BentoBoardKind,
  scope = 'all'
): UseBoardCardLayoutsResult {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''
  const queryClient = useQueryClient()
  const visible = useDocumentVisibility()

  const queryKey = layoutsKey(boardKind, scope, organizationId)

  const query = useQuery<CardLayoutRow[]>({
    queryKey,
    enabled: !!organizationId,
    staleTime: 30_000,
    refetchInterval: visible ? 60_000 : false,
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
                eq: (
                  c: string,
                  v: string
                ) => {
                  eq: (
                    c: string,
                    v: string
                  ) => Promise<{
                    data: RawLayout[] | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('production_board_card_layouts')
        .select(SELECT_COLS)
        .eq('organization_id', organizationId)
        .eq('board_kind', boardKind)
        .eq('scope', scope)
      if (error) {
        logger.error('[useBoardCardLayouts] query failed', error)
        throw new Error(error.message)
      }
      return (data ?? []).map(mapRow)
    },
  })

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const upsertLayout = useMutation<CardLayoutRow, Error, UpsertLayoutInput>({
    mutationFn: async (input) => {
      const row: Record<string, unknown> = {
        organization_id: organizationId,
        board_kind: boardKind,
        scope,
        post_id: input.postId,
        post_kind: input.postKind,
        grid_x: input.gridX,
        grid_y: input.gridY,
        grid_w: input.gridW,
        grid_h: input.gridH,
        card_variant: input.cardVariant,
        variant_config: input.variantConfig ?? {},
      }
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            upsert: (
              row: Record<string, unknown>,
              opts: { onConflict: string }
            ) => {
              select: (cols: string) => {
                single: () => Promise<{
                  data: RawLayout | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      )
        .from('production_board_card_layouts')
        .upsert(row, {
          onConflict: 'organization_id,board_kind,scope,post_kind,post_id',
        })
        .select(SELECT_COLS)
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to save layout')
      }
      return mapRow(data)
    },
    onSuccess: () => {
      refresh()
    },
    onError: (err) => toast.error(`Failed to save card layout: ${err.message}`),
  })

  const deleteLayout = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await (
        supabase as unknown as {
          from: (t: string) => {
            delete: () => {
              eq: (
                c: string,
                v: string
              ) => Promise<{
                error: { message: string } | null
              }>
            }
          }
        }
      )
        .from('production_board_card_layouts')
        .delete()
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      refresh()
    },
    onError: (err) =>
      toast.error(`Failed to remove card layout: ${err.message}`),
  })

  const resetBoardLayout = useMutation<void, Error, void>({
    mutationFn: async () => {
      // Two .eq chained delete; we cap with a third .eq on scope so we
      // never accidentally wipe another board's rows.
      const { error } = await (
        supabase as unknown as {
          from: (t: string) => {
            delete: () => {
              eq: (
                c: string,
                v: string
              ) => {
                eq: (
                  c: string,
                  v: string
                ) => {
                  eq: (
                    c: string,
                    v: string
                  ) => Promise<{
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('production_board_card_layouts')
        .delete()
        .eq('organization_id', organizationId)
        .eq('board_kind', boardKind)
        .eq('scope', scope)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      refresh()
      toast.success('Layout reset')
    },
    onError: (err) => toast.error(`Failed to reset layout: ${err.message}`),
  })

  const layouts = useMemo(() => {
    const m = new Map<string, CardLayoutRow>()
    for (const row of query.data ?? []) m.set(row.postId, row)
    return m
  }, [query.data])

  return {
    layouts,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refresh,
    upsertLayout,
    deleteLayout,
    resetBoardLayout,
  }
}

// Created and developed by Jai Singh
