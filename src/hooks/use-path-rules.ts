// Created and developed by Jai Singh
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  pathRulesService,
  type UpsertResolutionRuleInput,
  type UpsertPathRuleInput,
} from '@/lib/supabase/path-rules.service'

const RESOLUTION_RULES_KEY = 'path-resolution-rules'
const PATH_RULES_KEY = 'path-rules'
const PREVIEW_KEY = 'path-resolved-preview'
const CLAIM_ORDER_PREVIEW_KEY = 'path-claim-order-preview'

export function usePathRules() {
  const queryClient = useQueryClient()

  const { data: resolutionRules = [], isLoading: isLoadingResolution } =
    useQuery({
      queryKey: [RESOLUTION_RULES_KEY],
      queryFn: () => pathRulesService.fetchResolutionRules(),
      staleTime: 60_000,
    })

  const { data: pathRules = [], isLoading: isLoadingPath } = useQuery({
    queryKey: [PATH_RULES_KEY],
    queryFn: () => pathRulesService.fetchPathRules(),
    staleTime: 60_000,
  })

  const { data: resolvedPreview = [], isLoading: isLoadingPreview } = useQuery({
    queryKey: [PREVIEW_KEY],
    queryFn: () => pathRulesService.previewResolvedLocations(50),
    staleTime: 30_000,
  })

  const { data: claimOrderPreview = [], isLoading: isLoadingClaimPreview } =
    useQuery({
      queryKey: [CLAIM_ORDER_PREVIEW_KEY],
      queryFn: () => pathRulesService.previewClaimOrder(25),
      staleTime: 30_000,
    })

  const upsertResolutionRuleMutation = useMutation({
    mutationFn: (input: UpsertResolutionRuleInput) =>
      pathRulesService.upsertResolutionRule(input),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Resolution rule saved')
        queryClient.invalidateQueries({ queryKey: [RESOLUTION_RULES_KEY] })
        queryClient.invalidateQueries({ queryKey: [PREVIEW_KEY] })
        queryClient.invalidateQueries({ queryKey: [CLAIM_ORDER_PREVIEW_KEY] })
      } else {
        toast.error(`Failed to save: ${result.error}`)
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteResolutionRuleMutation = useMutation({
    mutationFn: (id: string) => pathRulesService.deleteResolutionRule(id),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Resolution rule deleted')
        queryClient.invalidateQueries({ queryKey: [RESOLUTION_RULES_KEY] })
        queryClient.invalidateQueries({ queryKey: [PREVIEW_KEY] })
        queryClient.invalidateQueries({ queryKey: [CLAIM_ORDER_PREVIEW_KEY] })
      } else {
        toast.error(`Failed to delete: ${result.error}`)
      }
    },
  })

  const upsertPathRuleMutation = useMutation({
    mutationFn: (input: UpsertPathRuleInput) =>
      pathRulesService.upsertPathRule(input),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Path rule saved')
        queryClient.invalidateQueries({ queryKey: [PATH_RULES_KEY] })
        queryClient.invalidateQueries({ queryKey: [CLAIM_ORDER_PREVIEW_KEY] })
      } else {
        toast.error(`Failed to save: ${result.error}`)
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deletePathRuleMutation = useMutation({
    mutationFn: (id: string) => pathRulesService.deletePathRule(id),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Path rule deleted')
        queryClient.invalidateQueries({ queryKey: [PATH_RULES_KEY] })
        queryClient.invalidateQueries({ queryKey: [CLAIM_ORDER_PREVIEW_KEY] })
      } else {
        toast.error(`Failed to delete: ${result.error}`)
      }
    },
  })

  const testPattern = useCallback(
    (pattern: string, locations: string[]) =>
      pathRulesService.testPattern(pattern, locations),
    []
  )

  return {
    resolutionRules,
    pathRules,
    resolvedPreview,
    claimOrderPreview,
    isLoading: isLoadingResolution || isLoadingPath,
    isLoadingPreview,
    isLoadingClaimPreview,
    upsertResolutionRule: upsertResolutionRuleMutation.mutateAsync,
    deleteResolutionRule: deleteResolutionRuleMutation.mutateAsync,
    upsertPathRule: upsertPathRuleMutation.mutateAsync,
    deletePathRule: deletePathRuleMutation.mutateAsync,
    testPattern,
  }
}

// Created and developed by Jai Singh
