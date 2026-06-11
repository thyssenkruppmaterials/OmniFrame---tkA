// Created and developed by Jai Singh
/**
 * Standard Work React Hook
 * Provides state management for standard work checklists, templates, and submissions
 * Created: January 4, 2026
 */
import { useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import StandardWorkService, {
  type StandardWorkTemplate,
  type StandardWorkItem,
  type StandardWorkSubmission,
  type StandardWorkResponse,
  type ScheduledTask,
  type UserProgressStats,
  type UserStreak,
  type ScheduleConfig,
  type NotificationSettings,
  type StandardWorkTemplateAssignment,
  type UserDailyCompletion,
} from '@/lib/supabase/standard-work.service'
import { getLocalDateString } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'

export function useStandardWork() {
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''
  const userId = profile?.id || ''
  const queryClient = useQueryClient()

  // ===== TEMPLATES =====

  const {
    data: templates = [],
    isLoading: templatesLoading,
    error: templatesError,
    refetch: refetchTemplates,
  } = useQuery({
    queryKey: ['standard-work-templates', organizationId],
    queryFn: () => StandardWorkService.getTemplates(organizationId),
    enabled: !!organizationId,
  })

  const { data: activeTemplates = [], isLoading: activeTemplatesLoading } =
    useQuery({
      queryKey: ['standard-work-templates-active', organizationId],
      queryFn: () =>
        StandardWorkService.getTemplates(organizationId, { status: 'active' }),
      enabled: !!organizationId,
    })

  const createTemplateMutation = useMutation({
    mutationFn: (template: Partial<StandardWorkTemplate>) =>
      StandardWorkService.createTemplate({
        ...template,
        organization_id: organizationId,
        created_by: userId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-templates', organizationId],
      })
      toast.success('Template created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create template: ${error.message}`)
    },
  })

  const updateTemplateMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<StandardWorkTemplate>
    }) =>
      StandardWorkService.updateTemplate(id, {
        ...updates,
        updated_by: userId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-templates', organizationId],
      })
      toast.success('Template updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update template: ${error.message}`)
    },
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: (templateId: string) =>
      StandardWorkService.deleteTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-templates', organizationId],
      })
      toast.success('Template archived successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to archive template: ${error.message}`)
    },
  })

  const duplicateTemplateMutation = useMutation({
    mutationFn: ({
      templateId,
      newName,
    }: {
      templateId: string
      newName: string
    }) => StandardWorkService.duplicateTemplate(templateId, newName),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-templates', organizationId],
      })
      toast.success('Template duplicated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to duplicate template: ${error.message}`)
    },
  })

  // ===== ITEMS =====

  const useTemplateItems = (templateId: string) => {
    return useQuery({
      queryKey: ['standard-work-items', templateId],
      queryFn: () => StandardWorkService.getTemplateItems(templateId),
      enabled: !!templateId,
    })
  }

  const createItemMutation = useMutation({
    mutationFn: (item: Partial<StandardWorkItem>) =>
      StandardWorkService.createItem({
        ...item,
        organization_id: organizationId,
        created_by: userId,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-items', variables.template_id],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-templates', organizationId],
      })
      toast.success('Item added successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to add item: ${error.message}`)
    },
  })

  const updateItemMutation = useMutation({
    mutationFn: ({
      id,
      updates,
      templateId: tId,
    }: {
      id: string
      updates: Partial<StandardWorkItem>
      templateId: string
    }) =>
      StandardWorkService.updateItem(id, {
        ...updates,
        updated_by: userId,
      }).then((result) => ({ result, tId })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-items', data.tId],
      })
      // No toast here -- item updates happen frequently via the properties panel.
      // Toasting on every save would spam the user.
    },
    onError: (error: Error) => {
      toast.error(`Failed to update item: ${error.message}`)
    },
  })

  // Deletes route through the builder's own "undo" toast, so we suppress
  // the generic success toast here -- the builder surfaces a richer one
  // with an Undo action that calls restoreItem.
  const deleteItemMutation = useMutation({
    mutationFn: ({
      itemId,
      templateId: tId,
    }: {
      itemId: string
      templateId: string
    }) => StandardWorkService.deleteItem(itemId).then(() => tId),
    onSuccess: (tId) => {
      queryClient.invalidateQueries({ queryKey: ['standard-work-items', tId] })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-templates', organizationId],
      })
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove item: ${error.message}`)
    },
  })

  const restoreItemMutation = useMutation({
    mutationFn: ({
      itemId,
      templateId: tId,
    }: {
      itemId: string
      templateId: string
    }) =>
      StandardWorkService.restoreItem(itemId).then((result) => ({
        result,
        tId,
      })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-items', data.tId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-templates', organizationId],
      })
    },
    onError: (error: Error) => {
      toast.error(`Couldn't restore item: ${error.message}`)
    },
  })

  const duplicateItemMutation = useMutation({
    mutationFn: ({
      itemId,
      templateId: tId,
    }: {
      itemId: string
      templateId: string
    }) =>
      StandardWorkService.duplicateItem(itemId).then((result) => ({
        result,
        tId,
      })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-items', data.tId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-templates', organizationId],
      })
    },
    onError: (error: Error) => {
      toast.error(`Failed to duplicate item: ${error.message}`)
    },
  })

  const reorderItemsMutation = useMutation({
    mutationFn: ({
      templateId,
      itemOrders,
    }: {
      templateId: string
      itemOrders: Array<{
        id: string
        display_order: number
        section_name?: string
      }>
    }) => StandardWorkService.reorderItems(templateId, itemOrders),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-items', variables.templateId],
      })
    },
    onError: (error: Error) => {
      toast.error(`Failed to reorder items: ${error.message}`)
    },
  })

  // ===== SUBMISSIONS =====

  const {
    data: submissionsData,
    isLoading: submissionsLoading,
    error: submissionsError,
    refetch: refetchSubmissions,
  } = useQuery({
    queryKey: ['standard-work-submissions', organizationId],
    queryFn: () =>
      StandardWorkService.getSubmissions(organizationId, { limit: 50 }),
    enabled: !!organizationId,
  })

  const submissions = submissionsData?.submissions || []
  const totalSubmissions = submissionsData?.total || 0

  const { data: todaySubmissions = [], isLoading: todaySubmissionsLoading } =
    useQuery({
      queryKey: ['standard-work-submissions-today', organizationId, userId],
      queryFn: () =>
        StandardWorkService.getTodaySubmissions(organizationId, userId),
      enabled: !!organizationId && !!userId,
    })

  const useSubmission = (submissionId: string) => {
    return useQuery({
      queryKey: ['standard-work-submission', submissionId],
      queryFn: () => StandardWorkService.getSubmission(submissionId),
      enabled: !!submissionId,
    })
  }

  const useSubmissionResponses = (submissionId: string) => {
    return useQuery({
      queryKey: ['standard-work-responses', submissionId],
      queryFn: () => StandardWorkService.getSubmissionResponses(submissionId),
      enabled: !!submissionId,
    })
  }

  /**
   * Combined submission + items + responses fetched via the
   * `get_submission_with_responses` RPC. Replaces three parallel queries on
   * the runner load path with one round trip.
   */
  const useSubmissionBundle = (submissionId: string) => {
    return useQuery({
      queryKey: ['standard-work-submission-bundle', submissionId],
      queryFn: () => StandardWorkService.getSubmissionBundle(submissionId),
      enabled: !!submissionId,
    })
  }

  // Helper used by submission lifecycle mutations to keep dashboard, progress,
  // upcoming, and overdue caches in sync with submitted state.
  const invalidateDashboardSurfaces = () => {
    queryClient.invalidateQueries({
      queryKey: ['standard-work-dashboard-tasks', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['standard-work-user-progress', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['standard-work-upcoming-tasks', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['standard-work-overdue-tasks', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['standard-work-scheduled-tasks', organizationId],
    })
  }

  const startSubmissionMutation = useMutation({
    mutationFn: ({
      templateId,
      workingAreaId,
    }: {
      templateId: string
      workingAreaId?: string
    }) =>
      StandardWorkService.startNewSubmission(
        organizationId,
        templateId,
        userId,
        workingAreaId,
        {
          name: profile?.full_name || '',
          position: profile?.role || '',
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submissions', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submissions-today', organizationId],
      })
      invalidateDashboardSurfaces()
      toast.success('Checklist started')
    },
    onError: (error: Error) => {
      toast.error(`Failed to start checklist: ${error.message}`)
    },
  })

  const updateSubmissionMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<StandardWorkSubmission>
    }) => StandardWorkService.updateSubmission(id, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submission', variables.id],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submissions', organizationId],
      })
      invalidateDashboardSurfaces()
    },
    onError: (error: Error) => {
      toast.error(`Failed to update submission: ${error.message}`)
    },
  })

  const submitChecklistMutation = useMutation({
    mutationFn: (submissionId: string) =>
      StandardWorkService.submitChecklist(submissionId),
    onSuccess: (_, submissionId) => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submission', submissionId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submission-bundle', submissionId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submissions', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submissions-today', organizationId],
      })
      invalidateDashboardSurfaces()
      toast.success('Checklist submitted successfully!')
    },
    onError: (error: Error) => {
      toast.error(`Failed to submit checklist: ${error.message}`)
    },
  })

  const deleteSubmissionMutation = useMutation({
    mutationFn: (submissionId: string) =>
      StandardWorkService.deleteSubmission(submissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submissions', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-submissions-today', organizationId],
      })
      invalidateDashboardSurfaces()
      toast.success('Submission deleted')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete submission: ${error.message}`)
    },
  })

  // ===== RESPONSES =====

  // Track repeated upsert failures so a single network blip doesn't spam the
  // user, but persistent failures still surface.
  const upsertFailureCountRef = useRef(0)

  const upsertResponseMutation = useMutation({
    mutationFn: (response: Partial<StandardWorkResponse>) =>
      StandardWorkService.upsertResponse({
        ...response,
        organization_id: organizationId,
      }),
    // No query invalidation here -- local state in the checklist component
    // already has the correct data. Invalidation on every keystroke caused a
    // query storm (refetch loop). Responses are refreshed when the submission
    // view is mounted or after submit.
    onSuccess: () => {
      upsertFailureCountRef.current = 0
    },
    onError: (error: Error) => {
      upsertFailureCountRef.current += 1
      logger.error('Failed to save response:', error.message)
      // Surface a toast on the first failure and every 5th repeat so an
      // offline user knows their work isn't being persisted.
      if (
        upsertFailureCountRef.current === 1 ||
        upsertFailureCountRef.current % 5 === 0
      ) {
        toast.error(
          `Couldn't save your last change: ${error.message}. We'll retry on the next edit.`
        )
      }
    },
  })

  const bulkUpsertResponsesMutation = useMutation({
    mutationFn: (responses: Partial<StandardWorkResponse>[]) =>
      StandardWorkService.bulkUpsertResponses(
        responses.map((r) => ({ ...r, organization_id: organizationId }))
      ),
    onSuccess: (_, variables) => {
      const submissionId = variables[0]?.submission_id
      if (submissionId) {
        queryClient.invalidateQueries({
          queryKey: ['standard-work-responses', submissionId],
        })
        queryClient.invalidateQueries({
          queryKey: ['standard-work-submission', submissionId],
        })
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to save responses: ${error.message}`)
    },
  })

  // ===== STATISTICS =====

  const {
    data: statistics,
    isLoading: statisticsLoading,
    error: statisticsError,
  } = useQuery({
    queryKey: ['standard-work-statistics', organizationId],
    queryFn: () => StandardWorkService.getStatistics(organizationId),
    enabled: !!organizationId,
  })

  const {
    data: userDailyCompletion = [],
    isLoading: userDailyCompletionLoading,
  } = useQuery({
    queryKey: ['standard-work-user-daily-completion', organizationId],
    queryFn: () =>
      StandardWorkService.getUserDailyCompletion(organizationId, 30),
    enabled: !!organizationId,
  })

  // ===== SCHEDULING HOOKS =====

  /**
   * Hook for getting scheduled tasks for a specific date
   */
  const useScheduledTasks = (date?: string, workingAreaId?: string) => {
    const targetDate = date || getLocalDateString()
    return useQuery({
      queryKey: [
        'standard-work-scheduled-tasks',
        organizationId,
        userId,
        targetDate,
        workingAreaId,
      ],
      queryFn: () =>
        StandardWorkService.getScheduledTasks(
          organizationId,
          userId,
          targetDate,
          workingAreaId
        ),
      enabled: !!organizationId && !!userId,
      refetchInterval: 60000, // Refresh every minute to update overdue status
    })
  }

  /**
   * Hook for getting dashboard tasks grouped by status
   */
  const useDashboardTasks = (workingAreaId?: string) => {
    return useQuery({
      queryKey: [
        'standard-work-dashboard-tasks',
        organizationId,
        userId,
        workingAreaId,
      ],
      queryFn: () =>
        StandardWorkService.getDashboardTasks(
          organizationId,
          userId,
          workingAreaId
        ),
      enabled: !!organizationId && !!userId,
      refetchInterval: 60000, // Refresh every minute
    })
  }

  /**
   * Hook for getting upcoming tasks
   */
  const useUpcomingTasks = (days: number = 7, workingAreaId?: string) => {
    return useQuery({
      queryKey: [
        'standard-work-upcoming-tasks',
        organizationId,
        userId,
        days,
        workingAreaId,
      ],
      queryFn: () =>
        StandardWorkService.getUpcomingTasks(
          organizationId,
          userId,
          days,
          workingAreaId
        ),
      enabled: !!organizationId && !!userId,
    })
  }

  /**
   * Hook for getting user progress stats
   */
  const useUserProgress = (days: number = 30) => {
    return useQuery({
      queryKey: ['standard-work-user-progress', organizationId, userId, days],
      queryFn: () =>
        StandardWorkService.getUserStats(organizationId, userId, days),
      enabled: !!organizationId && !!userId,
      refetchInterval: 300000, // Refresh every 5 minutes
    })
  }

  /**
   * Hook for getting user streak
   */
  const useUserStreak = (templateId?: string) => {
    return useQuery({
      queryKey: [
        'standard-work-user-streak',
        organizationId,
        userId,
        templateId,
      ],
      queryFn: () =>
        StandardWorkService.getUserStreak(organizationId, userId, templateId),
      enabled: !!organizationId && !!userId,
    })
  }

  /**
   * Hook for getting overdue tasks
   */
  const useOverdueTasks = () => {
    return useQuery({
      queryKey: ['standard-work-overdue-tasks', organizationId, userId],
      queryFn: () =>
        StandardWorkService.getOverdueTasks(organizationId, userId),
      enabled: !!organizationId && !!userId,
      refetchInterval: 60000, // Refresh every minute
    })
  }

  /**
   * Mutation for updating template schedule
   */
  const updateTemplateScheduleMutation = useMutation({
    mutationFn: ({
      templateId,
      scheduleConfig,
      dueTime,
      gracePeriodMinutes,
      notificationSettings,
    }: {
      templateId: string
      scheduleConfig: ScheduleConfig
      dueTime?: string
      gracePeriodMinutes?: number
      notificationSettings?: NotificationSettings
    }) =>
      StandardWorkService.updateTemplateSchedule(
        templateId,
        scheduleConfig,
        dueTime,
        gracePeriodMinutes,
        notificationSettings
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-templates', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-scheduled-tasks', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-dashboard-tasks', organizationId],
      })
      toast.success('Schedule updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update schedule: ${error.message}`)
    },
  })

  // ===== TEMPLATE ASSIGNMENTS =====

  const useTemplateAssignments = (templateId: string) => {
    return useQuery({
      queryKey: ['standard-work-assignments', templateId],
      queryFn: () => StandardWorkService.getTemplateAssignments(templateId),
      enabled: !!templateId,
    })
  }

  const useAssignmentCount = (templateId: string) => {
    return useQuery({
      queryKey: ['standard-work-assignment-count', templateId],
      queryFn: () => StandardWorkService.getAssignmentCount(templateId),
      enabled: !!templateId,
    })
  }

  const createAssignmentMutation = useMutation({
    mutationFn: (assignment: Partial<StandardWorkTemplateAssignment>) =>
      StandardWorkService.createAssignment({
        ...assignment,
        organization_id: organizationId,
        assigned_by: userId,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-assignments', variables.template_id],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-assignment-count', variables.template_id],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-scheduled-tasks'],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-dashboard-tasks'],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-user-progress'],
      })
      toast.success('Assignment created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create assignment: ${error.message}`)
    },
  })

  const deleteAssignmentMutation = useMutation({
    mutationFn: ({
      assignmentId,
      templateId,
    }: {
      assignmentId: string
      templateId: string
    }) =>
      StandardWorkService.deleteAssignment(assignmentId).then(() => templateId),
    onSuccess: (templateId) => {
      queryClient.invalidateQueries({
        queryKey: ['standard-work-assignments', templateId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-assignment-count', templateId],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-scheduled-tasks'],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-dashboard-tasks'],
      })
      queryClient.invalidateQueries({
        queryKey: ['standard-work-user-progress'],
      })
      toast.success('Assignment removed')
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove assignment: ${error.message}`)
    },
  })

  // ===== HELPER FUNCTIONS =====

  const getTemplatesForArea = (workingAreaId: string) => {
    return templates.filter(
      (t) => t.working_area_id === workingAreaId && t.status === 'active'
    )
  }

  const getSubmissionsForTemplate = (templateId: string) => {
    return submissions.filter((s) => s.template_id === templateId)
  }

  const checkIfCompletedToday = (
    templateId: string,
    workingAreaId?: string
  ) => {
    return todaySubmissions.some(
      (s) =>
        s.template_id === templateId &&
        (workingAreaId ? s.working_area_id === workingAreaId : true) &&
        s.status === 'submitted'
    )
  }

  return {
    // Templates
    templates,
    activeTemplates,
    templatesLoading,
    activeTemplatesLoading,
    templatesError,
    refetchTemplates,
    createTemplate: createTemplateMutation.mutateAsync,
    updateTemplate: updateTemplateMutation.mutateAsync,
    deleteTemplate: deleteTemplateMutation.mutateAsync,
    duplicateTemplate: duplicateTemplateMutation.mutateAsync,
    isCreatingTemplate: createTemplateMutation.isPending,
    isUpdatingTemplate: updateTemplateMutation.isPending,

    // Items
    useTemplateItems,
    createItem: createItemMutation.mutateAsync,
    updateItem: updateItemMutation.mutateAsync,
    deleteItem: deleteItemMutation.mutateAsync,
    restoreItem: restoreItemMutation.mutateAsync,
    duplicateItem: duplicateItemMutation.mutateAsync,
    reorderItems: reorderItemsMutation.mutateAsync,
    isCreatingItem: createItemMutation.isPending,
    isUpdatingItem: updateItemMutation.isPending,
    isDuplicatingItem: duplicateItemMutation.isPending,

    // Submissions
    submissions,
    totalSubmissions,
    submissionsLoading,
    submissionsError,
    refetchSubmissions,
    todaySubmissions,
    todaySubmissionsLoading,
    useSubmission,
    useSubmissionResponses,
    useSubmissionBundle,
    startSubmission: startSubmissionMutation.mutateAsync,
    updateSubmission: updateSubmissionMutation.mutateAsync,
    submitChecklist: submitChecklistMutation.mutateAsync,
    deleteSubmission: deleteSubmissionMutation.mutateAsync,
    isStartingSubmission: startSubmissionMutation.isPending,
    isSubmittingChecklist: submitChecklistMutation.isPending,

    // Responses
    upsertResponse: upsertResponseMutation.mutateAsync,
    bulkUpsertResponses: bulkUpsertResponsesMutation.mutateAsync,
    isSavingResponse: upsertResponseMutation.isPending,

    // Statistics
    statistics,
    statisticsLoading,
    statisticsError,
    userDailyCompletion,
    userDailyCompletionLoading,

    // Scheduling
    useScheduledTasks,
    useDashboardTasks,
    useUpcomingTasks,
    useUserProgress,
    useUserStreak,
    useOverdueTasks,
    updateTemplateSchedule: updateTemplateScheduleMutation.mutateAsync,
    isUpdatingSchedule: updateTemplateScheduleMutation.isPending,

    // Assignments
    useTemplateAssignments,
    useAssignmentCount,
    createAssignment: createAssignmentMutation.mutateAsync,
    deleteAssignment: deleteAssignmentMutation.mutateAsync,
    isCreatingAssignment: createAssignmentMutation.isPending,
    isDeletingAssignment: deleteAssignmentMutation.isPending,

    // Helpers
    getTemplatesForArea,
    getSubmissionsForTemplate,
    checkIfCompletedToday,
  }
}

// Export types for consumers
export type {
  StandardWorkTemplate,
  StandardWorkItem,
  StandardWorkSubmission,
  StandardWorkResponse,
  StandardWorkTemplateAssignment,
  UserDailyCompletion,
  ScheduledTask,
  UserProgressStats,
  UserStreak,
  ScheduleConfig,
  NotificationSettings,
}

// Created and developed by Jai Singh
