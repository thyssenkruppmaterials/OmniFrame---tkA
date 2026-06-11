// Created and developed by Jai Singh
/**
 * Per-org working-areas lookup tailored to the production-boards filter
 * chips + post editor.
 *
 * The hourly board reads working areas through `LaborManagementService`
 * with rich types. The other boards only need {id, name, code}, so we
 * keep this hook narrow rather than pulling in the full labor-management
 * surface.
 */
import { useQuery } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export interface BoardWorkingAreaRow {
  id: string
  areaName: string
  areaCode: string
}

interface RawArea {
  id: string
  area_name: string
  area_code: string
  is_active: boolean | null
}

export function useBoardWorkingAreas(): {
  workingAreas: BoardWorkingAreaRow[]
  isLoading: boolean
} {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''

  const query = useQuery<BoardWorkingAreaRow[]>({
    queryKey: ['production-board-working-areas', organizationId],
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
                order: (
                  c: string,
                  opts: { ascending: boolean }
                ) => Promise<{
                  data: RawArea[] | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      )
        .from('working_areas')
        .select('id, area_name, area_code, is_active')
        .eq('organization_id', organizationId)
        .order('area_code', { ascending: true })
      if (error) {
        logger.error('[useBoardWorkingAreas] query failed', error)
        throw new Error(error.message)
      }
      return (data ?? [])
        .filter((a) => a.is_active !== false)
        .map((a) => ({
          id: a.id,
          areaName: a.area_name,
          areaCode: a.area_code,
        }))
    },
  })

  return {
    workingAreas: query.data ?? [],
    isLoading: query.isLoading,
  }
}

// Created and developed by Jai Singh
