// Created and developed by Jai Singh
/**
 * Per-org branches lookup. Reads from the `branches` table introduced in
 * migration 295. Used by the HR News board's filter chips and by the
 * shared post editor's branch selector.
 */
import { useQuery } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export interface BranchRow {
  id: string
  name: string
  code: string
  isActive: boolean
}

interface RawBranch {
  id: string
  name: string
  code: string
  is_active: boolean
}

export function useBranches(): {
  branches: BranchRow[]
  isLoading: boolean
} {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''

  const query = useQuery<BranchRow[]>({
    queryKey: ['production-board-branches', organizationId],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
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
                  v: boolean
                ) => {
                  order: (
                    c: string,
                    opts: { ascending: boolean }
                  ) => Promise<{
                    data: RawBranch[] | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('branches')
        .select('id, name, code, is_active')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (error) {
        logger.error('[useBranches] query failed', error)
        throw new Error(error.message)
      }
      return (data ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        isActive: b.is_active,
      }))
    },
  })

  return {
    branches: query.data ?? [],
    isLoading: query.isLoading,
  }
}

// Created and developed by Jai Singh
