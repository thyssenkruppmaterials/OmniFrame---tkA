// Created and developed by Jai Singh
/**
 * Hooks for the Kit Notes "unread message" indicator on the Kit Build Plans
 * grid.
 *
 * - `useKitUnreadNotes` reads the set of kit serials with an unread operator
 *   note for the current user (per-user read tracking from migration 330).
 * - `useMarkKitNotesRead` advances the current user's read watermark for a
 *   kit (fired when the Kit Build Audit Trail opens) and invalidates the
 *   unread query so the indicator clears.
 *
 * Realtime: NO Supabase Realtime channel ([[Master Rule]] § Realtime Policy).
 * Cross-user freshness relies on a 30s `refetchInterval` while mounted.
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { kitNotesService } from '@/lib/supabase/kit-notes.service'
import { logger } from '@/lib/utils/logger'

const UNREAD_QUERY_KEY = ['kit-notes', 'unread'] as const

export function useKitUnreadNotes(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true

  const query = useQuery<string[]>({
    queryKey: UNREAD_QUERY_KEY,
    queryFn: () => kitNotesService.getUnreadKitSerials(),
    enabled,
    // Cross-user freshness without a realtime channel. 30s balances perceived
    // freshness against the request budget for a low-frequency signal.
    refetchInterval: enabled ? 30_000 : false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })

  const unreadSerials = useMemo(() => new Set(query.data ?? []), [query.data])

  return {
    unreadSerials,
    isLoading: query.isLoading,
    refetch: query.refetch,
  }
}

export function useMarkKitNotesRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (kitSerialNumber: string) =>
      kitNotesService.markKitNotesRead(kitSerialNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY })
    },
    onError: (err: unknown) => {
      logger.error('[useMarkKitNotesRead] failed:', err)
    },
  })
}

// Created and developed by Jai Singh
