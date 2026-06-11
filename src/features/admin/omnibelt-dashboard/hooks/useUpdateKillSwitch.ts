// Created and developed by Jai Singh
/**
 * useUpdateKillSwitch — mutation hook for the org kill-switch.
 *
 * Optimistic update against the cached
 * `useOmnibeltAdminBootstrap` payload — flips the
 * `killSwitch.enabled` cell immediately, rolls back on error,
 * then invalidates the bootstrap key on success so the source
 * of truth (the FastAPI 200 response) wins.
 *
 * Failure mode: `retry: 0` (admin mutations are user-initiated and
 * already debounce themselves at the click level — a retry storm here
 * would just hammer a degraded backend). Error toasts branch on the
 * `isNetworkError` / `isAuthError` classifiers from the OmniBelt
 * shared error taxonomy so the admin gets actionable copy ("start
 * FastAPI at :8000") instead of a raw 502 string.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import {
  isAuthError,
  isNetworkError,
} from '@/features/omnibelt/lib/bootstrap-errors'
import { omnibeltAdminService } from '../services/omnibelt-admin.service'
import {
  OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY,
  type OmnibeltAdminBootstrap,
} from './useOmnibeltAdminBootstrap'

export function useUpdateKillSwitch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) =>
      omnibeltAdminService.setKillSwitch(enabled),
    // Admin writes are click-triggered; a network glitch should not
    // turn into 3 silent retries against an unreachable backend.
    retry: 0,
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({
        queryKey: OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY,
      })
      // Snapshot every variant of the bootstrap key (orgId is suffixed)
      // so rollback restores the exact previous shape.
      const snapshots = queryClient.getQueriesData<OmnibeltAdminBootstrap>({
        queryKey: OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY,
      })

      queryClient.setQueriesData<OmnibeltAdminBootstrap>(
        { queryKey: OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY },
        (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            killSwitch: {
              ...prev.killSwitch,
              enabled,
              source:
                prev.killSwitch.source === 'env' ? 'env' : ('org' as const),
            },
          }
        }
      )
      return { snapshots }
    },
    onError: (error, _enabled, context) => {
      logger.warn('[OmniBeltAdmin] kill-switch mutation failed', error)
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value)
        }
      }
      if (isNetworkError(error)) {
        toast.error(
          'OmniBelt backend unreachable. Start the FastAPI server on :8000.'
        )
      } else if (isAuthError(error)) {
        toast.error('You do not have permission to change the kill switch.')
      } else {
        toast.error('Failed to update OmniBelt kill switch.')
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY,
      })
    },
  })
}

// Created and developed by Jai Singh
