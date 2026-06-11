// Created and developed by Jai Singh
/**
 * useUpdateAllowList — mutation hook for the org tool allow-list.
 *
 * Writes directly to the `settings` table via the primary
 * supabase client (RLS enforces admin gate). Optimistic update
 * against the cached bootstrap payload; rollback on error.
 *
 * Failure mode: `retry: 0` + toast classifier shared with
 * `useUpdateKillSwitch` — see the docblock there for the rationale.
 * The Supabase path here surfaces RLS denials as `PGRST301` / `401`
 * which `isAuthError` catches via message regex; everything else
 * routes through `isNetworkError` for the actionable backend toast.
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

export function useUpdateAllowList() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (toolIds: string[]) =>
      omnibeltAdminService.setAllowList(toolIds),
    retry: 0,
    onMutate: async (toolIds) => {
      await queryClient.cancelQueries({
        queryKey: OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY,
      })
      const snapshots = queryClient.getQueriesData<OmnibeltAdminBootstrap>({
        queryKey: OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY,
      })
      queryClient.setQueriesData<OmnibeltAdminBootstrap>(
        { queryKey: OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY },
        (prev) => (prev ? { ...prev, allowList: toolIds } : prev)
      )
      return { snapshots }
    },
    onError: (error, _toolIds, context) => {
      logger.warn('[OmniBeltAdmin] allow-list mutation failed', error)
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value)
        }
      }
      if (isAuthError(error)) {
        toast.error('You do not have permission to edit the allow list.')
      } else if (isNetworkError(error)) {
        toast.error(
          'OmniBelt backend unreachable. Start the FastAPI server on :8000.'
        )
      } else {
        toast.error('Failed to update OmniBelt allow list.')
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
