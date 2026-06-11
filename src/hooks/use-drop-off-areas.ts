// Created and developed by Jai Singh
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import {
  dropOffAreaService,
  type DropOffAreaAssociateInsert,
  type DropOffAreaAssociateUpdate,
  type DropOffAreaInsert,
  type DropOffAreaUpdate,
  type DropOffAreaWithAssociates,
  type OrganizationUser,
} from '@/lib/supabase/drop-off-area.service'
import { logger } from '@/lib/utils/logger'

export const DROP_OFF_AREAS_QUERY_KEY = 'drop-off-areas'
export const DROP_OFF_AREA_USERS_QUERY_KEY = 'drop-off-area-users'

interface UseDropOffAreasOptions {
  enableRealtime?: boolean
  activeOnly?: boolean
}

export function useDropOffAreas({
  enableRealtime = true,
  activeOnly = false,
}: UseDropOffAreasOptions = {}) {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState
  const organizationId = profile?.organization_id || ''

  const {
    data: areas = [],
    isLoading,
    error,
    refetch,
  } = useQuery<DropOffAreaWithAssociates[]>({
    queryKey: [DROP_OFF_AREAS_QUERY_KEY, organizationId, activeOnly],
    queryFn: async () => {
      const { data, error } =
        await dropOffAreaService.fetchAreasWithAssociates(activeOnly)
      if (error) {
        throw error instanceof Error
          ? error
          : new Error('Failed to fetch drop-off areas')
      }
      return data
    },
    enabled: !!user && !!organizationId,
    staleTime: 60 * 1000,
  })

  const { data: organizationUsers = [], isLoading: isLoadingUsers } = useQuery<
    OrganizationUser[]
  >({
    queryKey: [DROP_OFF_AREA_USERS_QUERY_KEY, organizationId],
    queryFn: async () => {
      const { data, error } = await dropOffAreaService.fetchOrganizationUsers()
      if (error) {
        throw error instanceof Error
          ? error
          : new Error('Failed to fetch organization users')
      }
      return data
    },
    enabled: !!user && !!organizationId,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    if (!enableRealtime || !user) return

    const channel = supabase
      .channel('drop-off-areas-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rr_drop_off_areas' },
        () => {
          queryClient.invalidateQueries({
            queryKey: [DROP_OFF_AREAS_QUERY_KEY],
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rr_drop_off_area_associates',
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: [DROP_OFF_AREAS_QUERY_KEY],
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [enableRealtime, user, queryClient])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [DROP_OFF_AREAS_QUERY_KEY] })

  const createAreaMutation = useMutation({
    mutationFn: async (
      payload: Omit<DropOffAreaInsert, 'organization_id' | 'created_by'>
    ) => {
      if (!organizationId) {
        throw new Error('Missing organization context')
      }

      const { data, error } = await dropOffAreaService.createArea({
        ...payload,
        organization_id: organizationId,
        created_by: user?.id ?? null,
      })

      if (error) {
        throw error instanceof Error
          ? error
          : new Error('Failed to create drop-off area')
      }

      return data
    },
    onSuccess: () => {
      invalidate()
      toast.success('Drop-off area created')
    },
    onError: (err) => {
      logger.error('Error creating drop-off area:', err)
      toast.error(
        err instanceof Error ? err.message : 'Failed to create drop-off area'
      )
    },
  })

  const updateAreaMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: DropOffAreaUpdate
    }) => {
      const { data, error } = await dropOffAreaService.updateArea(id, {
        ...updates,
        updated_by: user?.id ?? null,
      })
      if (error) {
        throw error instanceof Error
          ? error
          : new Error('Failed to update drop-off area')
      }
      return data
    },
    onSuccess: () => {
      invalidate()
      toast.success('Drop-off area updated')
    },
    onError: (err) => {
      logger.error('Error updating drop-off area:', err)
      toast.error(
        err instanceof Error ? err.message : 'Failed to update drop-off area'
      )
    },
  })

  const deleteAreaMutation = useMutation({
    mutationFn: async (id: string) => {
      const { success, error } = await dropOffAreaService.deleteArea(id)
      if (!success) {
        throw error instanceof Error
          ? error
          : new Error('Failed to delete drop-off area')
      }
    },
    onSuccess: () => {
      invalidate()
      toast.success('Drop-off area deleted')
    },
    onError: (err) => {
      logger.error('Error deleting drop-off area:', err)
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete drop-off area'
      )
    },
  })

  const createAssociateMutation = useMutation({
    mutationFn: async (
      payload: Omit<
        DropOffAreaAssociateInsert,
        'organization_id' | 'created_by'
      >
    ) => {
      if (!organizationId) {
        throw new Error('Missing organization context')
      }

      const { data, error } = await dropOffAreaService.createAssociate({
        ...payload,
        organization_id: organizationId,
        created_by: user?.id ?? null,
      })

      if (error) {
        throw error instanceof Error
          ? error
          : new Error('Failed to create associate')
      }

      return data
    },
    onSuccess: () => {
      invalidate()
      toast.success('Associate added')
    },
    onError: (err) => {
      logger.error('Error creating drop-off area associate:', err)
      toast.error(
        err instanceof Error ? err.message : 'Failed to add associate'
      )
    },
  })

  const updateAssociateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: DropOffAreaAssociateUpdate
    }) => {
      const { data, error } = await dropOffAreaService.updateAssociate(id, {
        ...updates,
        updated_by: user?.id ?? null,
      })
      if (error) {
        throw error instanceof Error
          ? error
          : new Error('Failed to update associate')
      }
      return data
    },
    onSuccess: () => {
      invalidate()
      toast.success('Associate updated')
    },
    onError: (err) => {
      logger.error('Error updating drop-off area associate:', err)
      toast.error(
        err instanceof Error ? err.message : 'Failed to update associate'
      )
    },
  })

  const deleteAssociateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { success, error } = await dropOffAreaService.deleteAssociate(id)
      if (!success) {
        throw error instanceof Error
          ? error
          : new Error('Failed to delete associate')
      }
    },
    onSuccess: () => {
      invalidate()
      toast.success('Associate removed')
    },
    onError: (err) => {
      logger.error('Error deleting drop-off area associate:', err)
      toast.error(
        err instanceof Error ? err.message : 'Failed to remove associate'
      )
    },
  })

  return {
    organizationId,
    areas,
    organizationUsers,
    isLoading,
    isLoadingUsers,
    error: error as Error | null,
    refetch,
    createArea: createAreaMutation.mutateAsync,
    updateArea: updateAreaMutation.mutateAsync,
    deleteArea: deleteAreaMutation.mutateAsync,
    createAssociate: createAssociateMutation.mutateAsync,
    updateAssociate: updateAssociateMutation.mutateAsync,
    deleteAssociate: deleteAssociateMutation.mutateAsync,
  }
}

// Created and developed by Jai Singh
