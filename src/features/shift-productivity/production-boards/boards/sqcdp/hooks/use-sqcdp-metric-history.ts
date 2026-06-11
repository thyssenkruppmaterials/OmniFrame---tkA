// Created and developed by Jai Singh
/**
 * SQCDP Metric History — TanStack Query hook scoped to a single metric's
 * `sqcdp_metric_history` rows over the last 180 days. Independent from
 * `useSqcdpMetrics` so the editor's history editor can refetch / mutate
 * without invalidating every metric in the parent grid (which would force
 * the chart strip on the SQCDP board to re-render and re-animate).
 *
 * Polling cadence: 60 s, visibility-gated (mirrors `useSqcdpMetrics`).
 *
 * Mutations all invalidate BOTH this query (so the editor's history table
 * + live preview stay fresh) AND the parent metrics list (so the card's
 * chart strip on the board re-renders with the new points).
 *
 * Disabled when `metricId === null` so the editor can call this hook in
 * "create mode" without firing a query for a non-existent row.
 *
 * The query mirrors the parent metrics hook's window cutoff
 * (`SQCDP_HISTORY_WINDOW_DAYS = 180`) on the SERVER via a `gte()` filter
 * — important because the editor's history table is intentionally finite
 * and the user shouldn't be confused by ancient back-dates that the card
 * chart silently filters out.
 */
import { useCallback, useEffect, useState } from 'react'
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
import { SQCDP_HISTORY_WINDOW_DAYS } from './use-sqcdp-metrics'

export interface SqcdpHistoryPoint {
  /** bigserial primary key from `sqcdp_metric_history.id`. */
  id: number
  metricId: string
  recordedAt: string
  value: number
  source: string | null
}

interface RawHistoryPoint {
  id: number
  metric_id: string
  recorded_at: string
  value: number
  source?: string | null
}

export interface CreateHistoryPointInput {
  recordedAt: string
  value: number
  source?: string
}

export interface UpdateHistoryPointInput {
  id: number
  recordedAt?: string
  value?: number
  source?: string | null
}

export interface BulkInsertHistoryInput {
  inserts: { recordedAt: string; value: number; source?: string }[]
}

interface UseSqcdpMetricHistoryResult {
  points: SqcdpHistoryPoint[]
  isLoading: boolean
  isFetching: boolean
  refresh: () => void
  createPoint: UseMutationResult<
    SqcdpHistoryPoint,
    Error,
    CreateHistoryPointInput
  >
  updatePoint: UseMutationResult<
    SqcdpHistoryPoint,
    Error,
    UpdateHistoryPointInput
  >
  deletePoint: UseMutationResult<void, Error, number>
  bulkInsertPoints: UseMutationResult<
    SqcdpHistoryPoint[],
    Error,
    BulkInsertHistoryInput
  >
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

function mapPoint(raw: RawHistoryPoint): SqcdpHistoryPoint {
  return {
    id: Number(raw.id),
    metricId: raw.metric_id,
    recordedAt: raw.recorded_at,
    value: Number(raw.value),
    source: raw.source ?? null,
  }
}

export function historyKey(metricId: string | null): readonly unknown[] {
  return ['sqcdp-metric-history', metricId, '180d'] as const
}

/**
 * Threaded into mutations so optimistic invalidations tickle the parent
 * `useSqcdpMetrics` hook's query key — the cards on the SQCDP board read
 * `metric.history` from there, not from this hook. We can't import a
 * `metricsKey` factory without creating a circular module reference, so
 * we mirror its key shape here. Keep these in sync if ever changed.
 */
function metricsListKey(orgId: string): readonly unknown[] {
  return ['sqcdp-metrics', orgId] as const
}

export function useSqcdpMetricHistory(
  metricId: string | null
): UseSqcdpMetricHistoryResult {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''
  const queryClient = useQueryClient()
  const visible = useDocumentVisibility()

  const query = useQuery<SqcdpHistoryPoint[]>({
    queryKey: historyKey(metricId),
    enabled: !!metricId,
    staleTime: 30_000,
    refetchInterval: visible ? 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!metricId) return []
      // Recompute the 180-day cutoff inside queryFn so it's fresh each
      // refetch without churning the queryKey on every render.
      const cutoffISO = new Date(
        Date.now() - SQCDP_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ).toISOString()
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              eq: (
                c: string,
                v: string
              ) => {
                gte: (
                  c: string,
                  v: string
                ) => {
                  order: (
                    c: string,
                    o: { ascending: boolean }
                  ) => Promise<{
                    data: RawHistoryPoint[] | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('sqcdp_metric_history')
        .select('id, metric_id, recorded_at, value, source')
        .eq('metric_id', metricId)
        .gte('recorded_at', cutoffISO)
        .order('recorded_at', { ascending: true })
      if (error) {
        logger.error('[useSqcdpMetricHistory] query failed', error)
        throw new Error(error.message)
      }
      return (data ?? []).map(mapPoint)
    },
  })

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: historyKey(metricId) })
  }, [queryClient, metricId])

  const invalidateAll = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: historyKey(metricId) })
    void queryClient.invalidateQueries({
      queryKey: metricsListKey(organizationId),
    })
  }, [queryClient, metricId, organizationId])

  const createPoint = useMutation<
    SqcdpHistoryPoint,
    Error,
    CreateHistoryPointInput,
    { previous: SqcdpHistoryPoint[] | undefined }
  >({
    mutationFn: async (input) => {
      if (!metricId) throw new Error('metricId required to create history')
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            insert: (rows: Record<string, unknown>[]) => {
              select: (cols: string) => {
                single: () => Promise<{
                  data: RawHistoryPoint | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      )
        .from('sqcdp_metric_history')
        .insert([
          {
            metric_id: metricId,
            organization_id: organizationId,
            recorded_at: input.recordedAt,
            value: input.value,
            source: input.source ?? 'manual',
          },
        ])
        .select('id, metric_id, recorded_at, value, source')
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to add data point')
      }
      return mapPoint(data)
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: historyKey(metricId) })
      const previous = queryClient.getQueryData<SqcdpHistoryPoint[]>(
        historyKey(metricId)
      )
      if (previous && metricId) {
        const optimistic: SqcdpHistoryPoint = {
          // negative ids signal optimistic — replaced by the real bigserial
          // on settle. Comparable across renders by reference identity is
          // unreliable here; the invalidate in onSettled is the source of truth.
          id: -Date.now(),
          metricId,
          recordedAt: input.recordedAt,
          value: input.value,
          source: input.source ?? 'manual',
        }
        queryClient.setQueryData<SqcdpHistoryPoint[]>(
          historyKey(metricId),
          [...previous, optimistic].sort((a, b) =>
            a.recordedAt < b.recordedAt ? -1 : 1
          )
        )
      }
      return { previous }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(historyKey(metricId), ctx.previous)
      }
      toast.error(`Failed to add data point: ${err.message}`)
    },
    onSuccess: () => {
      toast.success('Data point added')
    },
    onSettled: () => {
      invalidateAll()
    },
  })

  const updatePoint = useMutation<
    SqcdpHistoryPoint,
    Error,
    UpdateHistoryPointInput,
    { previous: SqcdpHistoryPoint[] | undefined }
  >({
    mutationFn: async (input) => {
      const update: Record<string, unknown> = {}
      if (input.recordedAt !== undefined) update.recorded_at = input.recordedAt
      if (input.value !== undefined) update.value = input.value
      if (input.source !== undefined) update.source = input.source

      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            update: (vals: Record<string, unknown>) => {
              eq: (
                c: string,
                v: number
              ) => {
                select: (cols: string) => {
                  single: () => Promise<{
                    data: RawHistoryPoint | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('sqcdp_metric_history')
        .update(update)
        .eq('id', input.id)
        .select('id, metric_id, recorded_at, value, source')
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to update data point')
      }
      return mapPoint(data)
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: historyKey(metricId) })
      const previous = queryClient.getQueryData<SqcdpHistoryPoint[]>(
        historyKey(metricId)
      )
      if (previous) {
        queryClient.setQueryData<SqcdpHistoryPoint[]>(
          historyKey(metricId),
          previous
            .map((p) =>
              p.id === input.id
                ? {
                    ...p,
                    recordedAt:
                      input.recordedAt === undefined
                        ? p.recordedAt
                        : input.recordedAt,
                    value: input.value === undefined ? p.value : input.value,
                    source:
                      input.source === undefined ? p.source : input.source,
                  }
                : p
            )
            .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1))
        )
      }
      return { previous }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(historyKey(metricId), ctx.previous)
      }
      toast.error(`Failed to update data point: ${err.message}`)
    },
    onSuccess: () => {
      toast.success('Data point updated')
    },
    onSettled: () => {
      invalidateAll()
    },
  })

  const deletePoint = useMutation<
    void,
    Error,
    number,
    { previous: SqcdpHistoryPoint[] | undefined }
  >({
    mutationFn: async (id) => {
      const { error } = await (
        supabase as unknown as {
          from: (t: string) => {
            delete: () => {
              eq: (
                c: string,
                v: number
              ) => Promise<{
                error: { message: string } | null
              }>
            }
          }
        }
      )
        .from('sqcdp_metric_history')
        .delete()
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: historyKey(metricId) })
      const previous = queryClient.getQueryData<SqcdpHistoryPoint[]>(
        historyKey(metricId)
      )
      if (previous) {
        queryClient.setQueryData<SqcdpHistoryPoint[]>(
          historyKey(metricId),
          previous.filter((p) => p.id !== id)
        )
      }
      return { previous }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(historyKey(metricId), ctx.previous)
      }
      toast.error(`Failed to delete data point: ${err.message}`)
    },
    onSuccess: () => {
      toast.success('Data point deleted')
    },
    onSettled: () => {
      invalidateAll()
    },
  })

  const bulkInsertPoints = useMutation<
    SqcdpHistoryPoint[],
    Error,
    BulkInsertHistoryInput
  >({
    mutationFn: async ({ inserts }) => {
      if (!metricId) throw new Error('metricId required to bulk-insert history')
      if (inserts.length === 0) return []
      const rows = inserts.map((i) => ({
        metric_id: metricId,
        organization_id: organizationId,
        recorded_at: i.recordedAt,
        value: i.value,
        source: i.source ?? 'sample',
      }))
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            insert: (rows: Record<string, unknown>[]) => {
              select: (cols: string) => Promise<{
                data: RawHistoryPoint[] | null
                error: { message: string } | null
              }>
            }
          }
        }
      )
        .from('sqcdp_metric_history')
        .insert(rows)
        .select('id, metric_id, recorded_at, value, source')
      if (error) {
        throw new Error(error.message ?? 'Failed to insert sample data')
      }
      return (data ?? []).map(mapPoint)
    },
    onSuccess: (data) => {
      toast.success(`Generated ${data.length} sample data points`)
    },
    onError: (err) => {
      toast.error(`Failed to generate sample data: ${err.message}`)
    },
    onSettled: () => {
      invalidateAll()
    },
  })

  return {
    points: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refresh,
    createPoint,
    updatePoint,
    deletePoint,
    bulkInsertPoints,
  }
}

// Created and developed by Jai Singh
