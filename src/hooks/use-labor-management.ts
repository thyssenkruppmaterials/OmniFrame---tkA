// Created and developed by Jai Singh
/**
 * Labor Management React Hook
 * Provides state management for shift hierarchy and organizational structure
 * Created: October 19, 2025
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService, {
  type WorkingArea,
  type ShiftPosition,
  type ShiftAssignment,
  type LaborStandard,
} from '@/lib/supabase/labor-management.service'

export function useLaborManagement() {
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''
  const queryClient = useQueryClient()

  const invalidatePerformanceRuntime = () => {
    queryClient.invalidateQueries({
      queryKey: ['team-performance', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['team-performance-weekly', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['department-names', organizationId],
    })
  }

  // ===== WORKING AREAS =====

  const {
    data: workingAreas = [],
    isLoading: areasLoading,
    error: areasError,
  } = useQuery({
    queryKey: ['working-areas', organizationId],
    queryFn: () => LaborManagementService.getWorkingAreas(organizationId),
    enabled: !!organizationId,
  })

  const { data: areaStats = {}, isLoading: areaStatsLoading } = useQuery({
    queryKey: ['working-area-statistics', organizationId],
    queryFn: () =>
      LaborManagementService.getWorkingAreaStatistics(organizationId),
    enabled: !!organizationId,
  })

  const createWorkingAreaMutation = useMutation({
    mutationFn: (area: Partial<WorkingArea>) =>
      LaborManagementService.createWorkingArea({
        ...area,
        organization_id: organizationId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['working-areas', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['working-area-statistics', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Working area created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create working area: ${error.message}`)
    },
  })

  const updateWorkingAreaMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<WorkingArea>
    }) => LaborManagementService.updateWorkingArea(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['working-areas', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['working-area-statistics', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Working area updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update working area: ${error.message}`)
    },
  })

  const deleteWorkingAreaMutation = useMutation({
    mutationFn: (id: string) => LaborManagementService.deleteWorkingArea(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['working-areas', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['working-area-statistics', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Working area deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete working area: ${error.message}`)
    },
  })

  // ===== SHIFT POSITIONS =====

  const {
    data: shiftPositions = [],
    isLoading: positionsLoading,
    error: positionsError,
  } = useQuery({
    queryKey: ['shift-positions', organizationId],
    queryFn: () => LaborManagementService.getShiftPositions(organizationId),
    enabled: !!organizationId,
  })

  const { data: positionHierarchy = [], isLoading: hierarchyLoading } =
    useQuery({
      queryKey: ['position-hierarchy', organizationId],
      queryFn: () =>
        LaborManagementService.getPositionHierarchy(organizationId),
      enabled: !!organizationId,
    })

  const { data: positionStats = {}, isLoading: positionStatsLoading } =
    useQuery({
      queryKey: ['position-statistics', organizationId],
      queryFn: () =>
        LaborManagementService.getPositionStatistics(organizationId),
      enabled: !!organizationId,
    })

  const createShiftPositionMutation = useMutation({
    mutationFn: (position: Partial<ShiftPosition>) =>
      LaborManagementService.createShiftPosition({
        ...position,
        organization_id: organizationId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['shift-positions', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['position-hierarchy', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['position-statistics', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Position created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create position: ${error.message}`)
    },
  })

  const updateShiftPositionMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<ShiftPosition>
    }) => LaborManagementService.updateShiftPosition(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['shift-positions', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['position-hierarchy', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['position-statistics', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Position updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update position: ${error.message}`)
    },
  })

  const deleteShiftPositionMutation = useMutation({
    mutationFn: (id: string) => LaborManagementService.deleteShiftPosition(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['shift-positions', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['position-hierarchy', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['position-statistics', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Position deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete position: ${error.message}`)
    },
  })

  // ===== SHIFT ASSIGNMENTS =====

  const {
    data: shiftAssignments = [],
    isLoading: assignmentsLoading,
    error: assignmentsError,
  } = useQuery({
    queryKey: ['shift-assignments', organizationId],
    queryFn: () => LaborManagementService.getShiftAssignments(organizationId),
    enabled: !!organizationId,
  })

  const createShiftAssignmentMutation = useMutation({
    mutationFn: (assignment: Partial<ShiftAssignment>) =>
      LaborManagementService.createShiftAssignment({
        ...assignment,
        organization_id: organizationId,
        assigned_by: profile?.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['shift-assignments', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['organizational-tree', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Assignment created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create assignment: ${error.message}`)
    },
  })

  const updateShiftAssignmentMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<ShiftAssignment>
    }) => LaborManagementService.updateShiftAssignment(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['shift-assignments', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['organizational-tree', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Assignment updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update assignment: ${error.message}`)
    },
  })

  const deleteShiftAssignmentMutation = useMutation({
    mutationFn: (id: string) =>
      LaborManagementService.deleteShiftAssignment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['shift-assignments', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['organizational-tree', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Assignment deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete assignment: ${error.message}`)
    },
  })

  // ===== ORGANIZATIONAL TREE =====

  const { data: organizationalTree = [], isLoading: treeLoading } = useQuery({
    queryKey: ['organizational-tree', organizationId],
    queryFn: () => LaborManagementService.getOrganizationalTree(organizationId),
    enabled: !!organizationId,
  })

  // ===== LABOR STANDARDS =====

  const {
    data: laborStandards = [],
    isLoading: standardsLoading,
    error: standardsError,
  } = useQuery({
    queryKey: ['labor-standards', organizationId],
    queryFn: () => LaborManagementService.getLaborStandards(organizationId),
    enabled: !!organizationId,
  })

  const createLaborStandardMutation = useMutation({
    mutationFn: (standard: Partial<LaborStandard>) =>
      LaborManagementService.createLaborStandard({
        ...standard,
        organization_id: organizationId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['labor-standards', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Labor standard created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create labor standard: ${error.message}`)
    },
  })

  const updateLaborStandardMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<LaborStandard>
    }) => LaborManagementService.updateLaborStandard(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['labor-standards', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Labor standard updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update labor standard: ${error.message}`)
    },
  })

  const deleteLaborStandardMutation = useMutation({
    mutationFn: (id: string) => LaborManagementService.deleteLaborStandard(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['labor-standards', organizationId],
      })
      invalidatePerformanceRuntime()
      toast.success('Labor standard deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete labor standard: ${error.message}`)
    },
  })

  // ===== UTILITY FUNCTIONS =====

  const getAvailableUsers = async (searchTerm?: string) => {
    if (searchTerm) {
      return await LaborManagementService.searchUsers(
        organizationId,
        searchTerm
      )
    }
    return await LaborManagementService.getAvailableUsers(organizationId)
  }

  return {
    // Working Areas
    workingAreas,
    areasLoading,
    areasError,
    areaStats,
    areaStatsLoading,
    createWorkingArea: createWorkingAreaMutation.mutate,
    updateWorkingArea: updateWorkingAreaMutation.mutate,
    deleteWorkingArea: deleteWorkingAreaMutation.mutate,
    isCreatingArea: createWorkingAreaMutation.isPending,
    isUpdatingArea: updateWorkingAreaMutation.isPending,
    isDeletingArea: deleteWorkingAreaMutation.isPending,

    // Shift Positions
    shiftPositions,
    positionsLoading,
    positionsError,
    positionHierarchy,
    hierarchyLoading,
    positionStats,
    positionStatsLoading,
    createShiftPosition: createShiftPositionMutation.mutate,
    updateShiftPosition: updateShiftPositionMutation.mutate,
    deleteShiftPosition: deleteShiftPositionMutation.mutate,
    isCreatingPosition: createShiftPositionMutation.isPending,
    isUpdatingPosition: updateShiftPositionMutation.isPending,
    isDeletingPosition: deleteShiftPositionMutation.isPending,

    // Shift Assignments
    shiftAssignments,
    assignmentsLoading,
    assignmentsError,
    createShiftAssignment: createShiftAssignmentMutation.mutate,
    updateShiftAssignment: updateShiftAssignmentMutation.mutate,
    deleteShiftAssignment: deleteShiftAssignmentMutation.mutate,
    isCreatingAssignment: createShiftAssignmentMutation.isPending,
    isUpdatingAssignment: updateShiftAssignmentMutation.isPending,
    isDeletingAssignment: deleteShiftAssignmentMutation.isPending,

    // Organizational Tree
    organizationalTree,
    treeLoading,

    // Labor Standards
    laborStandards,
    standardsLoading,
    standardsError,
    createLaborStandard: createLaborStandardMutation.mutate,
    updateLaborStandard: updateLaborStandardMutation.mutate,
    deleteLaborStandard: deleteLaborStandardMutation.mutate,
    isCreatingStandard: createLaborStandardMutation.isPending,
    isUpdatingStandard: updateLaborStandardMutation.isPending,
    isDeletingStandard: deleteLaborStandardMutation.isPending,

    // Utilities
    getAvailableUsers,
    organizationId,
    currentUser: profile,
  }
}

// Created and developed by Jai Singh
