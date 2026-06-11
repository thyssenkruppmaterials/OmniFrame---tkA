// Created and developed by Jai Singh
/**
 * useKitNotes — persistent chat thread for the Kit Build Audit Trail
 * (Quick View). Reads from / writes to `public.kit_notes` via
 * `kitNotesService`.
 *
 * Realtime: NO Supabase Realtime channel ([[Master Rule]] § Realtime
 * Policy). Cross-user updates rely on a 10s `refetchInterval` while the
 * dialog is mounted — sufficient for low-frequency operator chat where
 * an exact-RTT update is not required.
 */
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { kitNotesService, type KitNote } from '@/lib/supabase/kit-notes.service'
import { logger } from '@/lib/utils/logger'

const QUERY_KEY_ROOT = ['kit-notes'] as const

function keyFor(kitSerialNumber: string | null) {
  return [...QUERY_KEY_ROOT, kitSerialNumber ?? 'disabled'] as const
}

export function useKitNotes(kitSerialNumber: string | null) {
  const queryClient = useQueryClient()
  const enabled = !!kitSerialNumber?.trim()

  const notesQuery = useQuery<KitNote[]>({
    queryKey: keyFor(kitSerialNumber),
    queryFn: () => kitNotesService.getNotes(kitSerialNumber),
    enabled,
    // Cross-user refresh while the dialog is open. 10s is a balance
    // between perceived freshness and Supabase request budget — there
    // is typically only one or two operators looking at a kit at once.
    refetchInterval: enabled ? 10_000 : false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  })

  const invalidate = useCallback(() => {
    if (kitSerialNumber) {
      queryClient.invalidateQueries({ queryKey: keyFor(kitSerialNumber) })
    }
  }, [queryClient, kitSerialNumber])

  const addUserNoteMutation = useMutation({
    mutationFn: (body: string) => {
      if (!kitSerialNumber) {
        return Promise.reject(new Error('No kit selected'))
      }
      return kitNotesService.addUserNote(kitSerialNumber, body)
    },
    onSuccess: () => invalidate(),
    onError: (err: unknown) => {
      logger.error('[useKitNotes] addUserNote failed:', err)
      const description =
        err instanceof Error ? err.message : 'An unexpected error occurred'
      toast.error('Failed to send message', { description })
    },
  })

  /**
   * Append a system note. Wrapped in a stable callback so consumers
   * can pass it into other hook deps without thrashing.
   *
   * Non-blocking: errors are logged and swallowed — system notes are
   * audit metadata, not source-of-truth state, so a write failure
   * should never roll back the primary action that triggered it.
   */
  const addSystemNote = useCallback(
    async (body: string, eventKind?: string) => {
      if (!kitSerialNumber) return null
      const note = await kitNotesService.addSystemNote(
        kitSerialNumber,
        body,
        eventKind ?? null
      )
      if (note) invalidate()
      return note
    },
    [kitSerialNumber, invalidate]
  )

  return {
    notes: notesQuery.data ?? [],
    isLoading: notesQuery.isLoading,
    isFetching: notesQuery.isFetching,
    error: notesQuery.error,
    addUserNote: addUserNoteMutation.mutate,
    addUserNoteAsync: addUserNoteMutation.mutateAsync,
    isSending: addUserNoteMutation.isPending,
    addSystemNote,
    refetch: notesQuery.refetch,
  }
}

export type { KitNote }

// Created and developed by Jai Singh
