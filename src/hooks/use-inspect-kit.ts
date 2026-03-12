/**
 * Inspect Kit Tool Hook
 * Provides React Query mutations and queries for kit inspection operations
 * Created: December 14, 2025
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { logger } from '@/lib/utils/logger'

/**
 * Hook for Inspect Kit Tool workflow operations
 */
export function useInspectKitTool() {
  const queryClient = useQueryClient()

  // Verify kit PO number exists and is ready for inspection
  const verifyKitMutation = useMutation({
    mutationFn: (kitPoNumber: string) =>
      RRKittingDataService.verifyKitForInspection(kitPoNumber),
    onSuccess: (data) => {
      if (data.exists && data.kitData) {
        const { totalLines, inspectedLines } = data.kitData
        const message =
          inspectedLines > 0
            ? `Kit verified! ${inspectedLines}/${totalLines} lines already inspected`
            : `Kit verified! ${totalLines} lines to inspect`
        toast.success(message)
      } else {
        toast.error(
          data.error || 'Kit PO Number not found or not ready for inspection'
        )
      }
    },
    onError: (error) => {
      logger.error('Kit verification failed:', error)
      toast.error('Failed to verify kit')
    },
  })

  // Start kit inspection (sets status to inspection_in_progress)
  const startInspectionMutation = useMutation({
    mutationFn: (kitPoNumber: string) =>
      RRKittingDataService.startKitInspection(kitPoNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
    },
    onError: (error) => {
      logger.error('Failed to start kit inspection:', error)
      toast.error('Failed to start kit inspection')
    },
  })

  // Mark a specific line as inspected
  const markLineInspectedMutation = useMutation({
    mutationFn: (lineId: string) =>
      RRKittingDataService.markLineAsInspected(lineId),
    onSuccess: () => {
      toast.success('Line verified ✓')
      queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
    },
    onError: (error) => {
      logger.error('Failed to mark line as inspected:', error)
      toast.error('Failed to verify line')
    },
  })

  // Unmark a specific line (for corrections)
  const unmarkLineInspectedMutation = useMutation({
    mutationFn: (lineId: string) =>
      RRKittingDataService.unmarkLineAsInspected(lineId),
    onSuccess: () => {
      toast.success('Line verification removed')
      queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
    },
    onError: (error) => {
      logger.error('Failed to unmark line:', error)
      toast.error('Failed to remove verification')
    },
  })

  // Complete the kit inspection
  const completeInspectionMutation = useMutation({
    mutationFn: (kitPoNumber: string) =>
      RRKittingDataService.completeKitInspection(kitPoNumber),
    onSuccess: (data, kitPoNumber) => {
      if (data.success) {
        toast.success(`🎉 Kit ${kitPoNumber} inspection completed!`, {
          duration: 5000,
        })
        queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
        queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
      } else {
        toast.error(data.error || 'Failed to complete kit inspection')
      }
    },
    onError: (error) => {
      logger.error('Failed to complete kit inspection:', error)
      toast.error('Failed to complete kit inspection')
    },
  })

  return {
    // Verify Kit
    verifyKit: verifyKitMutation.mutate,
    verifyKitAsync: verifyKitMutation.mutateAsync,
    isVerifyingKit: verifyKitMutation.isPending,

    // Start Inspection
    startInspection: startInspectionMutation.mutate,
    startInspectionAsync: startInspectionMutation.mutateAsync,
    isStartingInspection: startInspectionMutation.isPending,

    // Mark/Unmark Lines
    markLineInspected: markLineInspectedMutation.mutate,
    markLineInspectedAsync: markLineInspectedMutation.mutateAsync,
    isMarkingLine: markLineInspectedMutation.isPending,

    unmarkLineInspected: unmarkLineInspectedMutation.mutate,
    unmarkLineInspectedAsync: unmarkLineInspectedMutation.mutateAsync,
    isUnmarkingLine: unmarkLineInspectedMutation.isPending,

    // Complete Inspection
    completeInspection: completeInspectionMutation.mutate,
    completeInspectionAsync: completeInspectionMutation.mutateAsync,
    isCompletingInspection: completeInspectionMutation.isPending,

    // Utils
    refreshData: () => {
      queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
    },
  }
}
