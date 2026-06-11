// Created and developed by Jai Singh
import { useQuery } from '@tanstack/react-query'
import { authService } from '@/lib/auth/auth-service'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'

/**
 * Returns whether the current user has the `production_boards:edit` permission.
 * Cached at the React-Query layer (5 min) so per-card pencils + the global
 * BoardEditToggle don't each fire a check.
 */
export function useCanEditBoards(): { canEdit: boolean; isLoading: boolean } {
  const { authState } = useUnifiedAuth()
  const userId = authState.user?.id ?? null

  const query = useQuery({
    queryKey: ['can-edit', 'production_boards', userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return false
      const result = await authService.checkPermission(
        userId,
        'production_boards',
        'edit'
      )
      return result.granted
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })

  return {
    canEdit: query.data === true,
    isLoading: query.isLoading,
  }
}

// Created and developed by Jai Singh
