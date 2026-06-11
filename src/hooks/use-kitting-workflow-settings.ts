// Created and developed by Jai Singh
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  KITTING_WORKFLOW_DEFAULTS,
  kittingWorkflowSettingsService,
  type KittingWorkflowSettings,
  type KittingWorkflowSettingsUpdate,
} from '@/lib/supabase/kitting-workflow-settings.service'
import { logger } from '@/lib/utils/logger'

const QUERY_KEY = ['kitting-workflow-settings'] as const

/**
 * Hook for the per-organization kitting workflow settings. Cached for
 * 5 minutes — settings flip rarely, and stale data on a kanban / RF
 * tile gate is acceptable until the next refetch.
 *
 * Exposed flags:
 *  - `kitInspectionRequired` — controls the optional Inspection stage
 *    (see [[Optional-Kit-Inspection-Toggle]]).
 *  - `blackHatShipShortPolicy` — three sub-flags governing the
 *    Black-Hat ship-short authorization panel inside the Kit Build
 *    Audit Trail (see [[Black-Hat-Ship-Short-Authorization-Panel]]).
 *
 * Defaults returned while loading or for orgs that have never written
 * the row preserve legacy behaviour: all flags TRUE.
 */
export function useKittingWorkflowSettings() {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id || ''

  const query = useQuery<KittingWorkflowSettings | null>({
    queryKey: [...QUERY_KEY, organizationId],
    queryFn: () => kittingWorkflowSettingsService.getSettings(organizationId),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  })

  const settings = query.data ?? null

  const kitInspectionRequired =
    settings?.kit_inspection_required ??
    KITTING_WORKFLOW_DEFAULTS.kit_inspection_required

  const blackHatShipShortPolicy = {
    enabled:
      settings?.black_hat_ship_short_authorization_enabled ??
      KITTING_WORKFLOW_DEFAULTS.black_hat_ship_short_authorization_enabled,
    requireJustification:
      settings?.black_hat_ship_short_require_justification ??
      KITTING_WORKFLOW_DEFAULTS.black_hat_ship_short_require_justification,
    requireLineByLineApproval:
      settings?.black_hat_ship_short_require_line_by_line_approval ??
      KITTING_WORKFLOW_DEFAULTS.black_hat_ship_short_require_line_by_line_approval,
  } as const

  const nonWarehouseBinPatterns =
    settings?.non_warehouse_bin_patterns ??
    KITTING_WORKFLOW_DEFAULTS.non_warehouse_bin_patterns

  const deliverToPlantLocations =
    settings?.deliver_to_plant_locations ??
    KITTING_WORKFLOW_DEFAULTS.deliver_to_plant_locations

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: QUERY_KEY })

  const updateMutation = useMutation({
    mutationFn: (updates: KittingWorkflowSettingsUpdate) =>
      kittingWorkflowSettingsService.updateSettings(organizationId, updates),
    onSuccess: () => {
      invalidate()
      toast.success('Kitting workflow settings updated')
    },
    onError: (error) => {
      logger.error('Failed to update kitting workflow settings:', error)
      toast.error('Failed to update workflow settings')
    },
  })

  return {
    organizationId,
    settings,
    kitInspectionRequired,
    blackHatShipShortPolicy,
    nonWarehouseBinPatterns,
    deliverToPlantLocations,
    isLoading: query.isLoading,
    isUpdating: updateMutation.isPending,
    error: query.error,
    setKitInspectionRequired: (value: boolean) =>
      updateMutation.mutate({ kit_inspection_required: value }),
    setKitInspectionRequiredAsync: (value: boolean) =>
      updateMutation.mutateAsync({ kit_inspection_required: value }),
    setBlackHatShipShortAuthorizationEnabled: (value: boolean) =>
      updateMutation.mutate({
        black_hat_ship_short_authorization_enabled: value,
      }),
    setBlackHatShipShortRequireJustification: (value: boolean) =>
      updateMutation.mutate({
        black_hat_ship_short_require_justification: value,
      }),
    setBlackHatShipShortRequireLineByLineApproval: (value: boolean) =>
      updateMutation.mutate({
        black_hat_ship_short_require_line_by_line_approval: value,
      }),
    setNonWarehouseBinPatterns: (patterns: string[]) =>
      updateMutation.mutate({ non_warehouse_bin_patterns: patterns }),
    setNonWarehouseBinPatternsAsync: (patterns: string[]) =>
      updateMutation.mutateAsync({ non_warehouse_bin_patterns: patterns }),
    setDeliverToPlantLocations: (locations: string[]) =>
      updateMutation.mutate({ deliver_to_plant_locations: locations }),
    setDeliverToPlantLocationsAsync: (locations: string[]) =>
      updateMutation.mutateAsync({ deliver_to_plant_locations: locations }),
  }
}

/**
 * Convenience hook for downstream surfaces (kanban column filter, RF
 * Inspect Kit tile, KitProductionTracker stages) that only need to
 * read the boolean. Defaults to `true` while loading or when the
 * profile context is not yet available, so the legacy three-stage
 * flow remains visible until the real value lands — never the other
 * way around (failing closed on a missing flag would surprise an
 * inspector who hasn't opted out).
 */
export function useKitInspectionRequired(): boolean {
  const { kitInspectionRequired } = useKittingWorkflowSettings()
  return kitInspectionRequired
}

/**
 * Convenience hook for the Kit Build Audit Trail's inline Black-Hat
 * ship-short authorization panel. Defaults match `KITTING_WORKFLOW_DEFAULTS`
 * so a never-touched org sees the panel ON with mandatory per-line
 * justification + no bulk-authorize shortcut.
 */
export function useBlackHatShipShortPolicy() {
  const { blackHatShipShortPolicy } = useKittingWorkflowSettings()
  return blackHatShipShortPolicy
}

/**
 * Convenience hook for the non-warehouse-bin acknowledgement flow.
 * Returns the configured substring patterns (defaults to
 * `['NEEDBIN']`). Consumers pair this with `detectNonWarehouseBins`
 * (see `src/lib/kitting/non-warehouse-bins.ts`) to flag affected TO
 * rows at import time.
 */
export function useNonWarehouseBinPatterns(): string[] {
  const { nonWarehouseBinPatterns } = useKittingWorkflowSettings()
  return nonWarehouseBinPatterns
}

/**
 * Convenience hook for the "Deliver To Plant" dropdown in the
 * Add Kit Build Plan dialog. Returns the configured plant-destination
 * labels (defaults to the same eight values that used to be hardcoded
 * as `PLANT_LOCATIONS`). The dropdown renders one `<SelectItem>` per
 * entry verbatim; the selected string lands on the kit row as the
 * `deliver_to_plant` value.
 *
 * See migration 324 + [[Configurable-Deliver-To-Plant-Locations]].
 */
export function useDeliverToPlantLocations(): string[] {
  const { deliverToPlantLocations } = useKittingWorkflowSettings()
  return deliverToPlantLocations
}

// Created and developed by Jai Singh
