// Created and developed by Jai Singh
/**
 * useActivityConfig Hook
 * Provides dynamic activity configuration from database for timeline visualization
 * Created: January 4, 2026
 *
 * This hook loads activity configurations from the activity_source_config table
 * and provides color/label mappings for the Gantt chart and other visualizations.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import type { ActivityConfig } from '@/features/shift-productivity/team-performance/types/team-performance.types'

// ===== DEFAULT FALLBACK COLORS =====
// Used when configuration is not yet loaded or for unknown activity types

const DEFAULT_COLORS: Record<
  string,
  {
    bg: string
    bgHover: string
    text: string
    label: string
  }
> = {
  inbound_scan: {
    bg: 'bg-sky-500',
    bgHover: 'hover:bg-sky-400',
    text: 'text-white',
    label: 'Scanning',
  },
  putaway: {
    bg: 'bg-violet-500',
    bgHover: 'hover:bg-violet-400',
    text: 'text-white',
    label: 'Putaway',
  },
  putaway_confirm: {
    bg: 'bg-violet-500',
    bgHover: 'hover:bg-violet-400',
    text: 'text-white',
    label: 'Putaway Confirm',
  },
  picking: {
    bg: 'bg-emerald-500',
    bgHover: 'hover:bg-emerald-400',
    text: 'text-white',
    label: 'Picking',
  },
  pack: {
    bg: 'bg-orange-500',
    bgHover: 'hover:bg-orange-400',
    text: 'text-white',
    label: 'Packing',
  },
  ship: {
    bg: 'bg-cyan-500',
    bgHover: 'hover:bg-cyan-400',
    text: 'text-white',
    label: 'Shipping',
  },
  final_pack: {
    bg: 'bg-amber-500',
    bgHover: 'hover:bg-amber-400',
    text: 'text-white',
    label: 'Final Pack',
  },
  putback: {
    bg: 'bg-rose-500',
    bgHover: 'hover:bg-rose-400',
    text: 'text-white',
    label: 'Putback',
  },
  cycle_count: {
    bg: 'bg-indigo-500',
    bgHover: 'hover:bg-indigo-400',
    text: 'text-white',
    label: 'Counting',
  },
  cart_stow: {
    bg: 'bg-pink-500',
    bgHover: 'hover:bg-pink-400',
    text: 'text-white',
    label: 'Cart Stow',
  },
  customer_response: {
    bg: 'bg-blue-500',
    bgHover: 'hover:bg-blue-400',
    text: 'text-white',
    label: 'Customer Response',
  },
  // Kit workflow stages — migration 310 (Productivity-Wiring-Kit-Workflow-Stages)
  kit_picking: {
    bg: 'bg-lime-500',
    bgHover: 'hover:bg-lime-400',
    text: 'text-white',
    label: 'Kit Picking',
  },
  kit_building: {
    bg: 'bg-teal-500',
    bgHover: 'hover:bg-teal-400',
    text: 'text-white',
    label: 'Kit Building',
  },
  kit_inspection: {
    bg: 'bg-fuchsia-500',
    bgHover: 'hover:bg-fuchsia-400',
    text: 'text-white',
    label: 'Kit Inspection',
  },
  kit_dock_staging: {
    bg: 'bg-sky-500',
    bgHover: 'hover:bg-sky-400',
    text: 'text-white',
    label: 'Dock Staging',
  },
  idle: {
    bg: 'bg-gray-200 dark:bg-gray-700',
    bgHover: 'hover:bg-gray-300 dark:hover:bg-gray-600',
    text: 'text-gray-600 dark:text-gray-400',
    label: 'Idle',
  },
  break: {
    bg: 'bg-yellow-200 dark:bg-yellow-800',
    bgHover: 'hover:bg-yellow-300 dark:hover:bg-yellow-700',
    text: 'text-yellow-800 dark:text-yellow-200',
    label: 'Break',
  },
  event: {
    bg: 'bg-purple-300 dark:bg-purple-700',
    bgHover: 'hover:bg-purple-400 dark:hover:bg-purple-600',
    text: 'text-purple-900 dark:text-purple-100',
    label: 'Event',
  },
}

// Generate a color for unknown activity types based on the type name
function generateColorForType(activityType: string): {
  bg: string
  bgHover: string
  text: string
  label: string
} {
  // Hash the activity type to get a consistent color
  let hash = 0
  for (let i = 0; i < activityType.length; i++) {
    hash = activityType.charCodeAt(i) + ((hash << 5) - hash)
  }

  // Select from a set of nice colors
  const colors = [
    { base: 'teal', num: '500' },
    { base: 'pink', num: '500' },
    { base: 'lime', num: '500' },
    { base: 'purple', num: '500' },
    { base: 'blue', num: '500' },
    { base: 'green', num: '500' },
    { base: 'red', num: '500' },
    { base: 'yellow', num: '500' },
  ]

  const color = colors[Math.abs(hash) % colors.length]
  const hoverNum = parseInt(color.num) - 100

  // Convert snake_case to Title Case for label
  const label = activityType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return {
    bg: `bg-${color.base}-${color.num}`,
    bgHover: `hover:bg-${color.base}-${hoverNum}`,
    text: 'text-white',
    label,
  }
}

interface UseActivityConfigReturn {
  /** All activity configurations loaded from database */
  activityConfigs: ActivityConfig[]
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Get color configuration for an activity type */
  getActivityColors: (activityType: string) => {
    bg: string
    bgHover: string
    text: string
    label: string
  }
  /** Get the label for an activity type */
  getActivityLabel: (activityType: string) => string
  /** Get all activity types that should be shown on timeline */
  getTimelineActivityTypes: () => string[]
  /** Get all activity types that should be shown in summary */
  getSummaryActivityTypes: () => string[]
  /** Color map for quick lookup (used by mini-gantt) */
  colorMap: Record<string, string>
  /** Refresh configurations from database */
  refresh: () => Promise<void>
}

export function useActivityConfig(): UseActivityConfigReturn {
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''

  const [activityConfigs, setActivityConfigs] = useState<ActivityConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchConfigs = useCallback(async () => {
    if (!organizationId) {
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const { data, error: fetchError } = await (supabase as any).rpc(
        'get_activity_configurations',
        {
          p_organization_id: organizationId,
        }
      )

      if (fetchError) {
        logger.error(
          '[useActivityConfig] Error fetching configurations:',
          fetchError
        )
        // Don't throw - use defaults instead
        setActivityConfigs([])
      } else {
        setActivityConfigs(data || [])
      }
    } catch (err) {
      logger.error('[useActivityConfig] Unexpected error:', err)
      setError(
        err instanceof Error
          ? err
          : new Error('Failed to load activity configurations')
      )
      setActivityConfigs([])
    } finally {
      setIsLoading(false)
    }
  }, [organizationId])

  useEffect(() => {
    fetchConfigs()
  }, [fetchConfigs])

  useEffect(() => {
    const handleConfigUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ organizationId?: string }>).detail
      if (!detail?.organizationId || detail.organizationId === organizationId) {
        void fetchConfigs()
      }
    }

    window.addEventListener(
      'shift-productivity:activity-config-updated',
      handleConfigUpdated
    )
    return () => {
      window.removeEventListener(
        'shift-productivity:activity-config-updated',
        handleConfigUpdated
      )
    }
  }, [fetchConfigs, organizationId])

  // Build a map from activity type to colors for quick lookup
  const colorConfigMap = useMemo(() => {
    const map = new Map<
      string,
      { bg: string; bgHover: string; text: string; label: string }
    >()

    // Add defaults first
    for (const [type, colors] of Object.entries(DEFAULT_COLORS)) {
      map.set(type, colors)
    }

    // Override with database configs
    for (const config of activityConfigs) {
      map.set(config.activity_type, {
        bg: config.gantt_bg_class,
        bgHover: config.gantt_hover_class,
        text: config.gantt_text_class,
        label: config.activity_label,
      })
    }

    return map
  }, [activityConfigs])

  // Simple color map for mini-gantt (just bg class)
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {}

    // Add defaults
    for (const [type, colors] of Object.entries(DEFAULT_COLORS)) {
      map[type] = colors.bg
    }

    // Override with database configs
    for (const config of activityConfigs) {
      map[config.activity_type] = config.gantt_bg_class
    }

    return map
  }, [activityConfigs])

  const getActivityColors = useCallback(
    (activityType: string) => {
      // Check map first
      const cached = colorConfigMap.get(activityType)
      if (cached) return cached

      // Generate color for unknown types
      return generateColorForType(activityType)
    },
    [colorConfigMap]
  )

  const getActivityLabel = useCallback(
    (activityType: string) => {
      const config = activityConfigs.find(
        (c) => c.activity_type === activityType
      )
      if (config) return config.activity_label

      const defaultColor = DEFAULT_COLORS[activityType]
      if (defaultColor) return defaultColor.label

      // Convert snake_case to Title Case
      return activityType
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    },
    [activityConfigs]
  )

  const getTimelineActivityTypes = useCallback(() => {
    // Return activity types that should show on timeline (sorted by display_order)
    const types = activityConfigs
      .filter((c) => c.show_on_timeline)
      .sort((a, b) => a.display_order - b.display_order)
      .map((c) => c.activity_type)

    // If no configs loaded yet, return defaults
    if (types.length === 0) {
      return [
        'inbound_scan',
        'cart_stow',
        'putaway',
        'picking',
        'pack',
        'ship',
        'final_pack',
        'putback',
        'cycle_count',
        'kit_picking',
        'kit_building',
        'kit_inspection',
        'kit_dock_staging',
      ]
    }

    return types
  }, [activityConfigs])

  const getSummaryActivityTypes = useCallback(() => {
    const types = activityConfigs
      .filter((c) => c.show_in_summary)
      .sort((a, b) => a.display_order - b.display_order)
      .map((c) => c.activity_type)

    if (types.length === 0) {
      return [
        'inbound_scan',
        'cart_stow',
        'putaway',
        'picking',
        'pack',
        'ship',
        'final_pack',
        'putback',
        'cycle_count',
        'kit_picking',
        'kit_building',
        'kit_inspection',
        'kit_dock_staging',
      ]
    }

    return types
  }, [activityConfigs])

  return {
    activityConfigs,
    isLoading,
    error,
    getActivityColors,
    getActivityLabel,
    getTimelineActivityTypes,
    getSummaryActivityTypes,
    colorMap,
    refresh: fetchConfigs,
  }
}

// ===== STANDALONE HELPER FOR NON-HOOK CONTEXTS =====

/**
 * Get default colors for an activity type without using the hook
 * Useful for places where hooks can't be used
 */
export function getDefaultActivityColors(activityType: string): {
  bg: string
  bgHover: string
  text: string
  label: string
} {
  const defaultColor = DEFAULT_COLORS[activityType]
  if (defaultColor) return defaultColor
  return generateColorForType(activityType)
}

/**
 * Default color map for mini-gantt (static version)
 * Use useActivityConfig().colorMap for dynamic version
 */
export const DEFAULT_ACTIVITY_COLOR_MAP: Record<string, string> =
  Object.fromEntries(
    Object.entries(DEFAULT_COLORS).map(([type, colors]) => [type, colors.bg])
  )

// Created and developed by Jai Singh
