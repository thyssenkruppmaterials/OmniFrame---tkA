// Created and developed by Jai Singh
/**
 * Hook for managing drone scan data with Supabase Realtime subscriptions
 *
 * Provides:
 * - List of drone scans with filtering
 * - Full-text search functionality
 * - Statistics by zone
 * - Real-time updates when scans are added/updated
 * - CRUD operations for scans and missions
 *
 * Note: Uses 'any' casts for drone_scans and drone_missions tables
 * since they're not yet in the generated Supabase types.
 * Run `supabase gen types` after applying migrations to fix this.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import type { DroneScan } from '@/features/drone-scanner/components/scan-results-grid'

// Query keys
const DRONE_SCANS_KEY = 'drone-scans'
const DRONE_STATS_KEY = 'drone-statistics'
const DRONE_MISSIONS_KEY = 'drone-missions'

// Types
export interface DroneScanStatistics {
  warehouse_zone: string | null
  total_scans: number
  completed_analyses: number
  failed_analyses: number
  avg_processing_time_ms: number | null
  items_detected: number
  damage_detected_count: number
}

export interface DroneMission {
  id: string
  mission_name: string
  mission_type: string
  status: string
  total_scans: number
  successful_analyses: number
  failed_analyses: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  drone_id: string | null
  drone_model: string | null
}

export interface UseDroneScansProps {
  warehouseZone?: string
  aisle?: string
  status?: string
  missionId?: string
  enableRealtime?: boolean
}

export interface UseDroneScansReturn {
  // Data
  scans: DroneScan[]
  statistics: DroneScanStatistics[]
  missions: DroneMission[]
  zones: string[]

  // Loading states
  isLoading: boolean
  isSearching: boolean
  isLoadingStats: boolean

  // Error states
  error: Error | null

  // Actions
  search: (query: string, zone?: string, aisle?: string) => void
  refresh: () => void
  createScan: (scanData: Partial<DroneScan>) => Promise<void>
  createMission: (missionData: Partial<DroneMission>) => Promise<void>
  updateMissionStatus: (missionId: string, status: string) => Promise<void>
}

// Cast supabase to any for tables not in generated types
const db = supabase as any

export function useDroneScans({
  warehouseZone,
  aisle,
  status,
  missionId,
  enableRealtime = true,
}: UseDroneScansProps = {}): UseDroneScansReturn {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  // State
  const [searchResults, setSearchResults] = useState<DroneScan[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  // Fetch scans
  const {
    data: scansData = [],
    isLoading,
    error,
    refetch: refetchScans,
  } = useQuery({
    queryKey: [
      DRONE_SCANS_KEY,
      profile?.organization_id,
      warehouseZone,
      aisle,
      status,
      missionId,
    ],
    queryFn: async () => {
      if (!profile?.organization_id) return []

      let query = db
        .from('drone_scans')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('captured_at', { ascending: false })
        .limit(100)

      if (warehouseZone) {
        query = query.eq('warehouse_zone', warehouseZone)
      }
      if (aisle) {
        query = query.eq('aisle', aisle)
      }
      if (status) {
        query = query.eq('ai_analysis_status', status)
      }
      if (missionId) {
        query = query.eq('mission_id', missionId)
      }

      const { data, error } = await query

      if (error) throw error
      return (data || []) as DroneScan[]
    },
    enabled: !!profile?.organization_id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })

  // Fetch statistics
  const { data: statistics = [], isLoading: isLoadingStats } = useQuery({
    queryKey: [DRONE_STATS_KEY, profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return []

      const { data, error } = await db.rpc('get_drone_scan_statistics', {
        p_organization_id: profile.organization_id,
        p_days: 7,
      })

      if (error) {
        logger.warn('Stats fetch error:', error)
        return []
      }

      return (data || []) as DroneScanStatistics[]
    },
    enabled: !!profile?.organization_id,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })

  // Fetch missions
  const { data: missions = [] } = useQuery({
    queryKey: [DRONE_MISSIONS_KEY, profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return []

      const { data, error } = await db
        .from('drone_missions')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return (data || []) as DroneMission[]
    },
    enabled: !!profile?.organization_id,
    staleTime: 30 * 1000,
  })

  // Extract unique zones
  const zones = useMemo(() => {
    const uniqueZones = new Set<string>()
    scansData.forEach((scan: DroneScan) => {
      if (scan.warehouse_zone) {
        uniqueZones.add(scan.warehouse_zone)
      }
    })
    // Also add zones from statistics
    statistics.forEach((stat: DroneScanStatistics) => {
      if (stat.warehouse_zone) {
        uniqueZones.add(stat.warehouse_zone)
      }
    })
    return Array.from(uniqueZones).sort()
  }, [scansData, statistics])

  // Real-time subscription
  useEffect(() => {
    if (!enableRealtime || !profile?.organization_id) return

    logger.log('🔄 Setting up real-time subscription for drone scans')

    const channel = supabase
      .channel('drone-scans-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'drone_scans',
          filter: `organization_id=eq.${profile.organization_id}`,
        },
        (payload) => {
          logger.log('📡 Drone scan real-time update:', payload.eventType)

          // Invalidate queries
          queryClient.invalidateQueries({ queryKey: [DRONE_SCANS_KEY] })
          queryClient.invalidateQueries({ queryKey: [DRONE_STATS_KEY] })

          // Show notification
          if (payload.eventType === 'INSERT') {
            toast.success('New drone scan captured')
          } else if (payload.eventType === 'UPDATE') {
            const newRecord = payload.new as DroneScan
            if (newRecord.ai_analysis_status === 'completed') {
              toast.success('AI analysis completed')
            }
          }
        }
      )
      .subscribe()

    return () => {
      logger.log('🔄 Cleaning up drone scans subscription')
      supabase.removeChannel(channel)
    }
  }, [enableRealtime, profile?.organization_id, queryClient])

  // Search function
  const search = useCallback(
    async (query: string, zone?: string, aisleFilter?: string) => {
      if (!profile?.organization_id || !query.trim()) {
        setSearchResults(null)
        return
      }

      setIsSearching(true)

      try {
        const { data, error } = await db.rpc('search_drone_scans', {
          p_query: query,
          p_organization_id: profile.organization_id,
          p_warehouse_zone: zone || null,
          p_aisle: aisleFilter || null,
          p_limit: 50,
          p_offset: 0,
        })

        if (error) throw error

        setSearchResults((data || []) as DroneScan[])
      } catch (err) {
        logger.error('Search error:', err)
        toast.error('Search failed')
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    },
    [profile?.organization_id]
  )

  // Refresh function
  const refresh = useCallback(() => {
    setSearchResults(null)
    refetchScans()
    queryClient.invalidateQueries({ queryKey: [DRONE_STATS_KEY] })
  }, [refetchScans, queryClient])

  // Create scan mutation
  const createScanMutation = useMutation({
    mutationFn: async (scanData: Partial<DroneScan>) => {
      if (!user || !profile?.organization_id) {
        throw new Error('User not authenticated')
      }

      const { data, error } = await db
        .from('drone_scans')
        .insert({
          ...scanData,
          organization_id: profile.organization_id,
          scanned_by: user.id,
          captured_at: new Date().toISOString(),
          ai_analysis_status: 'pending',
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DRONE_SCANS_KEY] })
      toast.success('Scan created and queued for AI analysis')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create scan'
      )
    },
  })

  // Create mission mutation
  const createMissionMutation = useMutation({
    mutationFn: async (missionData: Partial<DroneMission>) => {
      if (!user || !profile?.organization_id) {
        throw new Error('User not authenticated')
      }

      const { data, error } = await db
        .from('drone_missions')
        .insert({
          ...missionData,
          organization_id: profile.organization_id,
          created_by: user.id,
          status: 'planned',
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DRONE_MISSIONS_KEY] })
      toast.success('Mission created')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create mission'
      )
    },
  })

  // Update mission status mutation
  const updateMissionMutation = useMutation({
    mutationFn: async ({
      missionId,
      status,
    }: {
      missionId: string
      status: string
    }) => {
      const updateData: Record<string, unknown> = { status }

      if (status === 'in_progress') {
        updateData.started_at = new Date().toISOString()
      } else if (['completed', 'aborted', 'failed'].includes(status)) {
        updateData.completed_at = new Date().toISOString()
      }

      const { data, error } = await db
        .from('drone_missions')
        .update(updateData)
        .eq('id', missionId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [DRONE_MISSIONS_KEY] })
      toast.success(`Mission status updated to ${variables.status}`)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update mission'
      )
    },
  })

  // Return values
  return {
    scans: searchResults ?? scansData,
    statistics,
    missions,
    zones,
    isLoading,
    isSearching,
    isLoadingStats,
    error: error as Error | null,
    search,
    refresh,
    createScan: createScanMutation.mutateAsync,
    createMission: createMissionMutation.mutateAsync,
    updateMissionStatus: (missionId: string, status: string) =>
      updateMissionMutation.mutateAsync({ missionId, status }),
  }
}

// Created and developed by Jai Singh
