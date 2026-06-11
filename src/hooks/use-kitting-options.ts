// Created and developed by Jai Singh
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  kittingOptionsService,
  KITTING_OPTION_GROUPS,
  type KittingDropdownOption,
  type KittingOptionGroup,
} from '@/lib/supabase/kitting-options.service'
import { logger } from '@/lib/utils/logger'

export function useKittingOptions(optionGroups?: KittingOptionGroup[]) {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''

  const {
    data: options = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['kitting-dropdown-options', organizationId, optionGroups ?? []],
    queryFn: () =>
      kittingOptionsService.listOptions(organizationId, optionGroups),
    enabled: !!organizationId,
    staleTime: 30000,
  })

  const optionsByGroup = useMemo(() => {
    const seed = Object.fromEntries(
      KITTING_OPTION_GROUPS.map((group) => [
        group.value,
        [] as KittingDropdownOption[],
      ])
    ) as Record<KittingOptionGroup, KittingDropdownOption[]>

    for (const option of options) {
      seed[option.option_group].push(option)
    }

    return seed
  }, [options])

  const activeOptionsByGroup = useMemo(() => {
    return Object.fromEntries(
      Object.entries(optionsByGroup).map(([group, groupOptions]) => [
        group,
        groupOptions.filter((option) => option.is_active),
      ])
    ) as Record<KittingOptionGroup, KittingDropdownOption[]>
  }, [optionsByGroup])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['kitting-dropdown-options'] })

  const createOptionMutation = useMutation({
    mutationFn: (
      data: Omit<
        KittingDropdownOption,
        'id' | 'created_at' | 'updated_at' | 'created_by'
      >
    ) => kittingOptionsService.createOption(data),
    onSuccess: () => {
      invalidate()
      toast.success('Kitting dropdown option created')
    },
    onError: (mutationError) => {
      logger.error('Error creating kitting dropdown option:', mutationError)
      toast.error('Failed to create option')
    },
  })

  const updateOptionMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<KittingDropdownOption>
    }) => kittingOptionsService.updateOption(id, updates),
    onSuccess: () => {
      invalidate()
      toast.success('Kitting dropdown option updated')
    },
    onError: (mutationError) => {
      logger.error('Error updating kitting dropdown option:', mutationError)
      toast.error('Failed to update option')
    },
  })

  const deleteOptionMutation = useMutation({
    mutationFn: (id: string) => kittingOptionsService.deleteOption(id),
    onSuccess: () => {
      invalidate()
      toast.success('Kitting dropdown option deleted')
    },
    onError: (mutationError) => {
      logger.error('Error deleting kitting dropdown option:', mutationError)
      toast.error('Failed to delete option')
    },
  })

  const seedDefaultsMutation = useMutation({
    mutationFn: () => kittingOptionsService.seedDefaults(organizationId),
    onSuccess: () => {
      invalidate()
      toast.success('Default kitting dropdown options seeded')
    },
    onError: (mutationError) => {
      logger.error('Error seeding kitting dropdown options:', mutationError)
      toast.error('Failed to seed default dropdowns')
    },
  })

  return {
    organizationId,
    options,
    optionsByGroup,
    activeOptionsByGroup,
    isLoading,
    error,
    createOption: createOptionMutation.mutateAsync,
    updateOption: updateOptionMutation.mutateAsync,
    deleteOption: deleteOptionMutation.mutateAsync,
    seedDefaults: seedDefaultsMutation.mutateAsync,
  }
}

// Created and developed by Jai Singh
