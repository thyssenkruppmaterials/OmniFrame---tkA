// Created and developed by Jai Singh
/**
 * useUpdateRoleConfig — mutation hook for per-role default belt config.
 *
 * Routes through the existing FastAPI admin endpoint
 * (`POST /api/admin/omnibelt/role-config`) so the
 * `omnibelt_config_changed` Postgres trigger fires and
 * rust-work-service broadcasts the change to every connected
 * client in the org.
 *
 * No optimistic update here — the editor maintains its own
 * draft state and the bootstrap query is invalidated on save
 * so the post-save view reflects the server's canonical row
 * (with `updated_at` / `updated_by` stamped).
 *
 * Failure mode: `retry: 0` + toast classifier shared with the other
 * admin mutation hooks. The role-config endpoint is the most likely
 * one to surface ECONNREFUSED locally (see the 7-min retry flood
 * captured in `Fix-OmniBelt-Bootstrap-Unreachable-Backend.md`).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import {
  isAuthError,
  isNetworkError,
} from '@/features/omnibelt/lib/bootstrap-errors'
import { omnibeltAdminService } from '../services/omnibelt-admin.service'
import { OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY } from './useOmnibeltAdminBootstrap'

export type RoleConfigMutationInput = Parameters<
  typeof omnibeltAdminService.saveRoleConfig
>[0]

export function useUpdateRoleConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RoleConfigMutationInput) =>
      omnibeltAdminService.saveRoleConfig(input),
    retry: 0,
    onError: (error) => {
      logger.warn('[OmniBeltAdmin] role-config mutation failed', error)
      if (isAuthError(error)) {
        toast.error('You do not have permission to edit role defaults.')
      } else if (isNetworkError(error)) {
        toast.error(
          'OmniBelt backend unreachable. Start the FastAPI server on :8000.'
        )
      } else {
        toast.error('Failed to save OmniBelt role configuration.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: OMNIBELT_ADMIN_BOOTSTRAP_QUERY_KEY,
      })
    },
  })
}

// Created and developed by Jai Singh
