// Created and developed by Jai Singh
/**
 * Area Options Hook
 * React Query hook for managing area types and departments
 * Created: December 25, 2025
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  areaOptionsService,
  type AreaTypeOption,
  type DepartmentOption,
} from '@/lib/supabase/area-options.service'
import { logger } from '@/lib/utils/logger'

export function useAreaOptions() {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''

  // ===== AREA TYPES =====

  const {
    data: areaTypes = [],
    isLoading: areaTypesLoading,
    error: areaTypesError,
  } = useQuery({
    queryKey: ['area-types', organizationId],
    queryFn: () => areaOptionsService.getAreaTypes(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000, // 30 seconds
  })

  const { data: activeAreaTypes = [] } = useQuery({
    queryKey: ['area-types-active', organizationId],
    queryFn: () => areaOptionsService.getActiveAreaTypes(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000,
  })

  const createAreaTypeMutation = useMutation({
    mutationFn: (
      data: Omit<
        AreaTypeOption,
        'id' | 'created_at' | 'updated_at' | 'created_by'
      >
    ) => areaOptionsService.createAreaType(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['area-types'] })
      toast.success('Area type created successfully')
    },
    onError: (error) => {
      logger.error('Error creating area type:', error)
      toast.error('Failed to create area type')
    },
  })

  const updateAreaTypeMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<AreaTypeOption>
    }) => areaOptionsService.updateAreaType(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['area-types'] })
      toast.success('Area type updated successfully')
    },
    onError: (error) => {
      logger.error('Error updating area type:', error)
      toast.error('Failed to update area type')
    },
  })

  const deleteAreaTypeMutation = useMutation({
    mutationFn: (id: string) => areaOptionsService.deleteAreaType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['area-types'] })
      toast.success('Area type deleted successfully')
    },
    onError: (error) => {
      logger.error('Error deleting area type:', error)
      toast.error('Failed to delete area type')
    },
  })

  const reorderAreaTypesMutation = useMutation({
    mutationFn: ({ orderedIds }: { orderedIds: string[] }) =>
      areaOptionsService.reorderAreaTypes(organizationId!, orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['area-types'] })
      toast.success('Area types reordered successfully')
    },
    onError: (error) => {
      logger.error('Error reordering area types:', error)
      toast.error('Failed to reorder area types')
    },
  })

  // ===== DEPARTMENTS =====

  const {
    data: departments = [],
    isLoading: departmentsLoading,
    error: departmentsError,
  } = useQuery({
    queryKey: ['departments', organizationId],
    queryFn: () => areaOptionsService.getDepartments(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000,
  })

  const { data: activeDepartments = [] } = useQuery({
    queryKey: ['departments-active', organizationId],
    queryFn: () => areaOptionsService.getActiveDepartments(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000,
  })

  const createDepartmentMutation = useMutation({
    mutationFn: (
      data: Omit<
        DepartmentOption,
        'id' | 'created_at' | 'updated_at' | 'created_by'
      >
    ) => areaOptionsService.createDepartment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Department created successfully')
    },
    onError: (error) => {
      logger.error('Error creating department:', error)
      toast.error('Failed to create department')
    },
  })

  const updateDepartmentMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<DepartmentOption>
    }) => areaOptionsService.updateDepartment(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Department updated successfully')
    },
    onError: (error) => {
      logger.error('Error updating department:', error)
      toast.error('Failed to update department')
    },
  })

  const deleteDepartmentMutation = useMutation({
    mutationFn: (id: string) => areaOptionsService.deleteDepartment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Department deleted successfully')
    },
    onError: (error) => {
      logger.error('Error deleting department:', error)
      toast.error('Failed to delete department')
    },
  })

  const reorderDepartmentsMutation = useMutation({
    mutationFn: ({ orderedIds }: { orderedIds: string[] }) =>
      areaOptionsService.reorderDepartments(organizationId!, orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Departments reordered successfully')
    },
    onError: (error) => {
      logger.error('Error reordering departments:', error)
      toast.error('Failed to reorder departments')
    },
  })

  // ===== SEED DEFAULTS =====

  const seedDefaultsMutation = useMutation({
    mutationFn: () => areaOptionsService.seedDefaults(organizationId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['area-types'] })
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Default area and department options seeded successfully')
    },
    onError: (error) => {
      logger.error('Error seeding defaults:', error)
      toast.error('Failed to seed default options')
    },
  })

  return {
    // Area Types
    areaTypes,
    activeAreaTypes,
    areaTypesLoading,
    areaTypesError,
    createAreaType: createAreaTypeMutation.mutateAsync,
    updateAreaType: updateAreaTypeMutation.mutateAsync,
    deleteAreaType: deleteAreaTypeMutation.mutateAsync,
    reorderAreaTypes: reorderAreaTypesMutation.mutateAsync,

    // Departments
    departments,
    activeDepartments,
    departmentsLoading,
    departmentsError,
    createDepartment: createDepartmentMutation.mutateAsync,
    updateDepartment: updateDepartmentMutation.mutateAsync,
    deleteDepartment: deleteDepartmentMutation.mutateAsync,
    reorderDepartments: reorderDepartmentsMutation.mutateAsync,

    // Utilities
    seedDefaults: seedDefaultsMutation.mutateAsync,
  }
}

// Created and developed by Jai Singh
