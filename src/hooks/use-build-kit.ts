// Created and developed by Jai Singh
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

  // Verify kit PO number exists and is ready for building. Legacy
  // PO-keyed entry point; new scans that look like a kit serial number
  // (`KIT-…`) should route through `verifyKitBySerialMutation` below
  // instead so they land on the direct PK lookup and avoid aggregating
  // across sibling kits sharing a PO.
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

  // Direct-by-serial entry point. Mirrors the picking flow's
  // smart-detect: when the scanned input is a `KIT-…` serial the form
  // calls this instead of `verifyKitMutation`, so the load is keyed on
  // the globally unique `kit_serial_number` PK and never silently
  // merges sibling kits that happen to share a Kit PO.
  const verifyKitBySerialMutation = useMutation({
    mutationFn: (kitSerialNumber: string) =>
      RRKittingDataService.verifyKitForBuildBySerialNumber(kitSerialNumber),
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
          data.error || 'Kit serial number not found or not ready for building'
        )
      }
    },
    onError: (error) => {
      logger.error('Kit serial verification failed:', error)
      toast.error('Failed to verify kit')
    },
  })

  // Start kit build (sets status to in_progress).
  //
  // Accepts either a bare PO string (legacy callers) or a
  // `{ kitPoNumber, kitSerialNumber? }` object. The serial-keyed
  // shape scopes the status flip to a single kit and is required for
  // multi-kit-per-PO scenarios — see
  // `Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md`.
  const startBuildMutation = useMutation({
    mutationFn: (
      input: string | { kitPoNumber: string; kitSerialNumber?: string | null }
    ) =>
      typeof input === 'string'
        ? RRKittingDataService.startKitBuild(input)
        : RRKittingDataService.startKitBuild(
            input.kitPoNumber,
            input.kitSerialNumber ?? null
          ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
    },
    onError: (error) => {
      logger.error('Failed to start kit build:', error)
      toast.error('Failed to start kit build')
    },
  })

  // Kit a material (mark TO line as kitted). `kitSerialNumber` is
  // optional but the RF Build Kit form now passes it whenever the
  // loaded `kitData` has one, so material lookups don't grab rows
  // belonging to a sibling kit sharing the PO.
  const kitMaterialMutation = useMutation({
    mutationFn: ({
      kitPoNumber,
      material,
      quantity,
      kitSerialNumber,
    }: {
      kitPoNumber: string
      material: string
      quantity: number
      kitSerialNumber?: string | null
    }) =>
      RRKittingDataService.kitMaterial(
        kitPoNumber,
        material,
        quantity,
        kitSerialNumber ?? null
      ),
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

  // Complete the kit build.
  //
  // Accepts either a bare PO string or a
  // `{ kitPoNumber, kitSerialNumber? }` object. THE FIX
  // (see `Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md`): callers
  // that have a serial in the loaded `kitData` MUST pass it so the
  // "all lines kitted?" check and the final status UPDATE are scoped
  // to that single kit — otherwise a PO covering two kits will reject
  // completion of the fully-kitted one because the partly-kitted
  // sibling's unkitted rows count against it.
  const completeKitMutation = useMutation({
    mutationFn: (
      input:
        | string
        | {
            kitPoNumber: string
            kitSerialNumber?: string | null
            skipInspection?: boolean
          }
    ) =>
      typeof input === 'string'
        ? RRKittingDataService.completeKitBuild(input)
        : RRKittingDataService.completeKitBuild(
            input.kitPoNumber,
            input.kitSerialNumber ?? null,
            input.skipInspection ? { skipInspection: true } : undefined
          ),
    onSuccess: (data, input) => {
      const kitPoNumber = typeof input === 'string' ? input : input.kitPoNumber
      if (data.success) {
        const onDockSuffix = data.skippedInspection
          ? ' (on dock — inspection bypassed)'
          : ''
        toast.success(`🎉 Kit ${kitPoNumber} build completed!${onDockSuffix}`, {
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
    // Verify Kit (legacy PO-keyed)
    verifyKit: verifyKitMutation.mutate,
    verifyKitAsync: verifyKitMutation.mutateAsync,
    isVerifyingKit: verifyKitMutation.isPending,

    // Verify Kit (direct-by-serial PK lookup)
    verifyKitBySerial: verifyKitBySerialMutation.mutate,
    verifyKitBySerialAsync: verifyKitBySerialMutation.mutateAsync,
    isVerifyingKitBySerial: verifyKitBySerialMutation.isPending,

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

// Created and developed by Jai Singh
