/**
 * Build Kit Tool Hook
 * Provides React Query mutations and queries for kit building operations
 * Created: December 14, 2025
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { logger } from '@/lib/utils/logger'

/**
 * Hook for Build Kit Tool workflow operations
 */
export function useBuildKitTool() {
  const queryClient = useQueryClient()

  // Verify kit PO number exists and is ready for building
  const verifyKitMutation = useMutation({
    mutationFn: (kitPoNumber: string) =>
      RRKittingDataService.verifyKitForBuild(kitPoNumber),
    onSuccess: (data) => {
      if (data.exists && data.kitData) {
        const { totalLines, kittedLines } = data.kitData
        const message =
          kittedLines > 0
            ? `Kit verified! ${kittedLines}/${totalLines} lines already kitted`
            : `Kit verified! ${totalLines} lines to kit`
        toast.success(message)
      } else {
        toast.error(
          data.error || 'Kit PO Number not found or not ready for building'
        )
      }
    },
    onError: (error) => {
      logger.error('Kit verification failed:', error)
      toast.error('Failed to verify kit')
    },
  })

  // Start kit build (sets status to in_progress)
  const startBuildMutation = useMutation({
    mutationFn: (kitPoNumber: string) =>
      RRKittingDataService.startKitBuild(kitPoNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
    },
    onError: (error) => {
      logger.error('Failed to start kit build:', error)
      toast.error('Failed to start kit build')
    },
  })

  // Kit a material (mark TO line as kitted)
  const kitMaterialMutation = useMutation({
    mutationFn: ({
      kitPoNumber,
      material,
      quantity,
    }: {
      kitPoNumber: string
      material: string
      quantity: number
    }) => RRKittingDataService.kitMaterial(kitPoNumber, material, quantity),
    onSuccess: (data) => {
      if (data.success && data.kittedLine) {
        toast.success(
          `✅ Material ${data.kittedLine.material} kitted successfully!`
        )

        if (data.allLinesKitted) {
          toast.success('🎉 All materials kitted! Kit is ready to complete.', {
            duration: 5000,
          })
        }

        // Invalidate relevant queries
        queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
        queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
      } else {
        toast.error(data.error || 'Failed to kit material')
      }
    },
    onError: (error) => {
      logger.error('Failed to kit material:', error)
      toast.error('Failed to kit material')
    },
  })

  // Mark a specific line as kitted
  const markLineKittedMutation = useMutation({
    mutationFn: (lineId: string) =>
      RRKittingDataService.markLineAsKitted(lineId),
    onSuccess: () => {
      toast.success('Line marked as kitted')
      queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
    },
    onError: (error) => {
      logger.error('Failed to mark line as kitted:', error)
      toast.error('Failed to mark line as kitted')
    },
  })

  // Unmark a specific line (for corrections)
  const unmarkLineKittedMutation = useMutation({
    mutationFn: (lineId: string) =>
      RRKittingDataService.unmarkLineAsKitted(lineId),
    onSuccess: () => {
      toast.success('Line unmarked')
      queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
    },
    onError: (error) => {
      logger.error('Failed to unmark line:', error)
      toast.error('Failed to unmark line')
    },
  })

  // Complete the kit build
  const completeKitMutation = useMutation({
    mutationFn: (kitPoNumber: string) =>
      RRKittingDataService.completeKitBuild(kitPoNumber),
    onSuccess: (data, kitPoNumber) => {
      if (data.success) {
        toast.success(`🎉 Kit ${kitPoNumber} build completed!`, {
          duration: 5000,
        })
        queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
        queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
      } else {
        toast.error(data.error || 'Failed to complete kit build')
      }
    },
    onError: (error) => {
      logger.error('Failed to complete kit build:', error)
      toast.error('Failed to complete kit build')
    },
  })

  return {
    // Verify Kit
    verifyKit: verifyKitMutation.mutate,
    verifyKitAsync: verifyKitMutation.mutateAsync,
    isVerifyingKit: verifyKitMutation.isPending,

    // Start Build
    startBuild: startBuildMutation.mutate,
    startBuildAsync: startBuildMutation.mutateAsync,
    isStartingBuild: startBuildMutation.isPending,

    // Kit Material
    kitMaterial: kitMaterialMutation.mutate,
    kitMaterialAsync: kitMaterialMutation.mutateAsync,
    isKittingMaterial: kitMaterialMutation.isPending,

    // Mark/Unmark Lines
    markLineKitted: markLineKittedMutation.mutate,
    markLineKittedAsync: markLineKittedMutation.mutateAsync,
    isMarkingLine: markLineKittedMutation.isPending,

    unmarkLineKitted: unmarkLineKittedMutation.mutate,
    unmarkLineKittedAsync: unmarkLineKittedMutation.mutateAsync,
    isUnmarkingLine: unmarkLineKittedMutation.isPending,

    // Complete Kit
    completeKit: completeKitMutation.mutate,
    completeKitAsync: completeKitMutation.mutateAsync,
    isCompletingKit: completeKitMutation.isPending,

    // Utils
    refreshData: () => {
      queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
    },
  }
}
