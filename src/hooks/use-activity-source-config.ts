// Created and developed by Jai Singh
/**
 * Activity Source Configuration Hook
 * Provides state management for activity source configurations
 * Created: January 4, 2026
 */
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import ActivitySourceConfigService, {
  type ActivitySourceConfig,
  type CreateActivitySourceInput,
  type UpdateActivitySourceInput,
  type AvailableTable,
  type TableColumn,
} from '@/lib/supabase/activity-source-config.service'
import { logger } from '@/lib/utils/logger'

interface UseActivitySourceConfigReturn {
  // Activity Source Configs
  activitySources: ActivitySourceConfig[]
  activitySourcesLoading: boolean
  activitySourcesError: string | null

  // CRUD Operations
  createActivitySource: (
    input: CreateActivitySourceInput
  ) => Promise<ActivitySourceConfig | null>
  updateActivitySource: (
    id: string,
    updates: UpdateActivitySourceInput
  ) => Promise<ActivitySourceConfig | null>
  deleteActivitySource: (id: string) => Promise<boolean>
  toggleActivitySourceActive: (
    id: string,
    isActive: boolean
  ) => Promise<ActivitySourceConfig | null>

  // Table Discovery
  availableTables: AvailableTable[]
  availableTablesLoading: boolean
  getTableColumns: (tableName: string) => Promise<TableColumn[]>
  validateTableConfig: (
    tableName: string,
    userIdColumn: string,
    timestampColumn: string,
    organizationIdColumn?: string
  ) => Promise<{ valid: boolean; errors: string[]; warnings: string[] }>

  // Reference Data
  activityCategories: { value: string; label: string }[]
  presetColors: { value: string; label: string; tailwind: string }[]

  // Refresh
  refreshActivitySources: () => Promise<void>
}

export function useActivitySourceConfig(): UseActivitySourceConfigReturn {
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''
  const queryClient = useQueryClient()

  const notifyRuntimeConfigChanged = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['team-performance', organizationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['activity-config', organizationId],
    })
    window.dispatchEvent(
      new CustomEvent('shift-productivity:activity-config-updated', {
        detail: { organizationId },
      })
    )
  }, [organizationId, queryClient])

  // Activity Sources State
  const [activitySources, setActivitySources] = useState<
    ActivitySourceConfig[]
  >([])
  const [activitySourcesLoading, setActivitySourcesLoading] = useState(true)
  const [activitySourcesError, setActivitySourcesError] = useState<
    string | null
  >(null)

  // Available Tables State
  const [availableTables, setAvailableTables] = useState<AvailableTable[]>([])
  const [availableTablesLoading, setAvailableTablesLoading] = useState(false)

  // Reference Data
  const activityCategories = ActivitySourceConfigService.getActivityCategories()
  const presetColors = ActivitySourceConfigService.getPresetColors()

  // Fetch activity sources
  const fetchActivitySources = useCallback(async () => {
    if (!organizationId) {
      setActivitySourcesLoading(false)
      return
    }

    try {
      setActivitySourcesLoading(true)
      setActivitySourcesError(null)
      const configs =
        await ActivitySourceConfigService.getActivitySourceConfigs(
          organizationId
        )
      setActivitySources(configs)
    } catch (error) {
      logger.error(
        '[useActivitySourceConfig] Error fetching activity sources:',
        error
      )
      setActivitySourcesError('Failed to load activity sources')
    } finally {
      setActivitySourcesLoading(false)
    }
  }, [organizationId])

  // Fetch available tables
  const fetchAvailableTables = useCallback(async () => {
    try {
      setAvailableTablesLoading(true)
      const tables = await ActivitySourceConfigService.getAvailableTables()
      setAvailableTables(tables)
    } catch (error) {
      logger.error(
        '[useActivitySourceConfig] Error fetching available tables:',
        error
      )
    } finally {
      setAvailableTablesLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchActivitySources()
    fetchAvailableTables()
  }, [fetchActivitySources, fetchAvailableTables])

  // Create activity source
  const createActivitySource = useCallback(
    async (
      input: CreateActivitySourceInput
    ): Promise<ActivitySourceConfig | null> => {
      try {
        const newConfig =
          await ActivitySourceConfigService.createActivitySourceConfig({
            ...input,
            organization_id: organizationId,
          })

        setActivitySources((prev) =>
          [...prev, newConfig].sort((a, b) => a.display_order - b.display_order)
        )
        notifyRuntimeConfigChanged()
        toast.success('Activity source created successfully')
        return newConfig
      } catch (error) {
        logger.error(
          '[useActivitySourceConfig] Error creating activity source:',
          error
        )
        toast.error('Failed to create activity source')
        return null
      }
    },
    [organizationId, notifyRuntimeConfigChanged]
  )

  // Update activity source
  const updateActivitySource = useCallback(
    async (
      id: string,
      updates: UpdateActivitySourceInput
    ): Promise<ActivitySourceConfig | null> => {
      try {
        const updatedConfig =
          await ActivitySourceConfigService.updateActivitySourceConfig(
            id,
            updates
          )

        setActivitySources((prev) =>
          prev
            .map((config) => (config.id === id ? updatedConfig : config))
            .sort((a, b) => a.display_order - b.display_order)
        )
        notifyRuntimeConfigChanged()
        toast.success('Activity source updated successfully')
        return updatedConfig
      } catch (error) {
        logger.error(
          '[useActivitySourceConfig] Error updating activity source:',
          error
        )
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to update activity source'
        )
        return null
      }
    },
    [notifyRuntimeConfigChanged]
  )

  // Delete activity source
  const deleteActivitySource = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await ActivitySourceConfigService.deleteActivitySourceConfig(id)
        setActivitySources((prev) => prev.filter((config) => config.id !== id))
        notifyRuntimeConfigChanged()
        toast.success('Activity source deleted successfully')
        return true
      } catch (error) {
        logger.error(
          '[useActivitySourceConfig] Error deleting activity source:',
          error
        )
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to delete activity source'
        )
        return false
      }
    },
    [notifyRuntimeConfigChanged]
  )

  // Toggle active status
  const toggleActivitySourceActive = useCallback(
    async (
      id: string,
      isActive: boolean
    ): Promise<ActivitySourceConfig | null> => {
      try {
        const updatedConfig =
          await ActivitySourceConfigService.toggleActivitySourceActive(
            id,
            isActive
          )

        setActivitySources((prev) =>
          prev.map((config) => (config.id === id ? updatedConfig : config))
        )
        notifyRuntimeConfigChanged()
        toast.success(
          `Activity source ${isActive ? 'enabled' : 'disabled'} successfully`
        )
        return updatedConfig
      } catch (error) {
        logger.error(
          '[useActivitySourceConfig] Error toggling activity source:',
          error
        )
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to toggle activity source'
        )
        return null
      }
    },
    [notifyRuntimeConfigChanged]
  )

  // Get table columns
  const getTableColumns = useCallback(
    async (tableName: string): Promise<TableColumn[]> => {
      try {
        return await ActivitySourceConfigService.getTableColumns(tableName)
      } catch (error) {
        logger.error(
          '[useActivitySourceConfig] Error fetching table columns:',
          error
        )
        return []
      }
    },
    []
  )

  // Validate table configuration
  const validateTableConfig = useCallback(
    async (
      tableName: string,
      userIdColumn: string,
      timestampColumn: string,
      organizationIdColumn: string = ''
    ): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> => {
      return ActivitySourceConfigService.validateTableConfiguration(
        tableName,
        userIdColumn,
        timestampColumn,
        organizationIdColumn
      )
    },
    []
  )

  // Refresh
  const refreshActivitySources = useCallback(async () => {
    await Promise.all([fetchActivitySources(), fetchAvailableTables()])
  }, [fetchActivitySources, fetchAvailableTables])

  return {
    activitySources,
    activitySourcesLoading,
    activitySourcesError,
    createActivitySource,
    updateActivitySource,
    deleteActivitySource,
    toggleActivitySourceActive,
    availableTables,
    availableTablesLoading,
    getTableColumns,
    validateTableConfig,
    activityCategories,
    presetColors,
    refreshActivitySources,
  }
}

// Created and developed by Jai Singh
