// Created and developed by Jai Singh
/**
 * Dock Staging Tool Hook
 *
 * Wraps the `RRKittingDataService` dock-staging service methods in
 * TanStack Query mutations so the new `RFDockStagingForm` can drive
 * the verify → stage flow with the standard pending / async / toast
 * affordances used by the sibling `useBuildKitTool` and
 * `useInspectKitTool` hooks.
 *
 * No new Supabase Realtime channels — invalidates the kit-kanban /
 * kitting-data query keys after a successful stage so any open
 * production-board or kanban view picks up the new on-dock state on
 * the next refresh tick. Honours the `.cursor/rules/Master Rule.mdc`
 * Realtime Policy.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { logger } from '@/lib/utils/logger'

export interface VerifyDockStagingInput {
  kitSerialNumber?: string | null
  kitPoNumber?: string | null
  kitInspectionRequired: boolean
}

export interface StageKitToDockInput {
  kitSerialNumber: string
  dockLocation: string
}

export function useDockStaging() {
  const queryClient = useQueryClient()

  const verifyKitMutation = useMutation({
    mutationFn: (input: VerifyDockStagingInput) =>
      RRKittingDataService.verifyKitForDockStaging(input),
    onError: (error) => {
      logger.error('[DockStaging] verify failed:', error)
      toast.error('Failed to verify kit for dock staging')
    },
  })

  const stageKitMutation = useMutation({
    mutationFn: (input: StageKitToDockInput) =>
      RRKittingDataService.stageKitToDock(
        input.kitSerialNumber,
        input.dockLocation
      ),
    onSuccess: (data, input) => {
      if (data.success) {
        toast.success(
          `🎉 Kit ${input.kitSerialNumber} staged at ${input.dockLocation}`,
          { duration: 5000 }
        )
        queryClient.invalidateQueries({ queryKey: ['kit-kanban'] })
        queryClient.invalidateQueries({ queryKey: ['kitting-data'] })
      } else {
        toast.error(data.error || 'Failed to stage kit to dock')
      }
    },
    onError: (error) => {
      logger.error('[DockStaging] stage failed:', error)
      toast.error('Failed to stage kit to dock')
    },
  })

  return {
    verifyKit: verifyKitMutation.mutate,
    verifyKitAsync: verifyKitMutation.mutateAsync,
    isVerifyingKit: verifyKitMutation.isPending,

    stageKit: stageKitMutation.mutate,
    stageKitAsync: stageKitMutation.mutateAsync,
    isStagingKit: stageKitMutation.isPending,
  }
}

// Created and developed by Jai Singh
