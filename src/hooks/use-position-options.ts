// Created and developed by Jai Singh
/**
 * Position Options Hook
 * React Query hook for managing position types and levels
 * Created: October 25, 2025
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  positionOptionsService,
  type PositionTypeOption,
  type PositionLevelOption,
} from '@/lib/supabase/position-options.service'
import { logger } from '@/lib/utils/logger'

export function usePositionOptions() {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''

  // ===== POSITION TYPES =====

  const {
    data: positionTypes = [],
    isLoading: typesLoading,
    error: typesError,
  } = useQuery({
    queryKey: ['position-types', organizationId],
    queryFn: () => positionOptionsService.getPositionTypes(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000, // 30 seconds
  })

  const { data: activePositionTypes = [] } = useQuery({
    queryKey: ['position-types-active', organizationId],
    queryFn: () =>
      positionOptionsService.getActivePositionTypes(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000,
  })

  const createPositionTypeMutation = useMutation({
    mutationFn: (
      data: Omit<
        PositionTypeOption,
        'id' | 'created_at' | 'updated_at' | 'created_by'
      >
    ) => positionOptionsService.createPositionType(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-types'] })
      toast.success('Position type created successfully')
    },
    onError: (error) => {
      logger.error('Error creating position type:', error)
      toast.error('Failed to create position type')
    },
  })

  const updatePositionTypeMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<PositionTypeOption>
    }) => positionOptionsService.updatePositionType(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-types'] })
      toast.success('Position type updated successfully')
    },
    onError: (error) => {
      logger.error('Error updating position type:', error)
      toast.error('Failed to update position type')
    },
  })

  const deletePositionTypeMutation = useMutation({
    mutationFn: (id: string) => positionOptionsService.deletePositionType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-types'] })
      toast.success('Position type deleted successfully')
    },
    onError: (error) => {
      logger.error('Error deleting position type:', error)
      toast.error('Failed to delete position type')
    },
  })

  const reorderPositionTypesMutation = useMutation({
    mutationFn: ({ orderedIds }: { orderedIds: string[] }) =>
      positionOptionsService.reorderPositionTypes(organizationId!, orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-types'] })
      toast.success('Position types reordered successfully')
    },
    onError: (error) => {
      logger.error('Error reordering position types:', error)
      toast.error('Failed to reorder position types')
    },
  })

  // ===== POSITION LEVELS =====

  const {
    data: positionLevels = [],
    isLoading: levelsLoading,
    error: levelsError,
  } = useQuery({
    queryKey: ['position-levels', organizationId],
    queryFn: () => positionOptionsService.getPositionLevels(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000,
  })

  const { data: activePositionLevels = [] } = useQuery({
    queryKey: ['position-levels-active', organizationId],
    queryFn: () =>
      positionOptionsService.getActivePositionLevels(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000,
  })

  const createPositionLevelMutation = useMutation({
    mutationFn: (
      data: Omit<
        PositionLevelOption,
        'id' | 'created_at' | 'updated_at' | 'created_by'
      >
    ) => positionOptionsService.createPositionLevel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-levels'] })
      toast.success('Position level created successfully')
    },
    onError: (error) => {
      logger.error('Error creating position level:', error)
      toast.error('Failed to create position level')
    },
  })

  const updatePositionLevelMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<PositionLevelOption>
    }) => positionOptionsService.updatePositionLevel(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-levels'] })
      toast.success('Position level updated successfully')
    },
    onError: (error) => {
      logger.error('Error updating position level:', error)
      toast.error('Failed to update position level')
    },
  })

  const deletePositionLevelMutation = useMutation({
    mutationFn: (id: string) => positionOptionsService.deletePositionLevel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-levels'] })
      toast.success('Position level deleted successfully')
    },
    onError: (error) => {
      logger.error('Error deleting position level:', error)
      toast.error('Failed to delete position level')
    },
  })

  const reorderPositionLevelsMutation = useMutation({
    mutationFn: ({ orderedIds }: { orderedIds: string[] }) =>
      positionOptionsService.reorderPositionLevels(organizationId!, orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-levels'] })
      toast.success('Position levels reordered successfully')
    },
    onError: (error) => {
      logger.error('Error reordering position levels:', error)
      toast.error('Failed to reorder position levels')
    },
  })

  // ===== SEED DEFAULTS =====

  const seedDefaultsMutation = useMutation({
    mutationFn: () => positionOptionsService.seedDefaults(organizationId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-types'] })
      queryClient.invalidateQueries({ queryKey: ['position-levels'] })
      toast.success('Default position options seeded successfully')
    },
    onError: (error) => {
      logger.error('Error seeding defaults:', error)
      toast.error('Failed to seed default options')
    },
  })

  return {
    // Position Types
    positionTypes,
    activePositionTypes,
    typesLoading,
    typesError,
    createPositionType: createPositionTypeMutation.mutateAsync,
    updatePositionType: updatePositionTypeMutation.mutateAsync,
    deletePositionType: deletePositionTypeMutation.mutateAsync,
    reorderPositionTypes: reorderPositionTypesMutation.mutateAsync,

    // Position Levels
    positionLevels,
    activePositionLevels,
    levelsLoading,
    levelsError,
    createPositionLevel: createPositionLevelMutation.mutateAsync,
    updatePositionLevel: updatePositionLevelMutation.mutateAsync,
    deletePositionLevel: deletePositionLevelMutation.mutateAsync,
    reorderPositionLevels: reorderPositionLevelsMutation.mutateAsync,

    // Utilities
    seedDefaults: seedDefaultsMutation.mutateAsync,
  }
}

// Created and developed by Jai Singh
