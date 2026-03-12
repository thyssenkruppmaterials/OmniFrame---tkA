/**
 * Hook for managing camera list data
 *
 * Provides:
 * - List of cameras with filtering
 * - Camera statistics
 * - Real-time status updates
 * - Favorite toggling
 */
import { useCallback, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import type {
  Camera,
  CameraCategory,
  CameraFilterStatus,
  CameraStats,
} from '../types/camera.types'

// Query keys
export const CAMERAS_QUERY_KEY = 'cameras'
export const CAMERA_STATS_KEY = 'camera-stats'

export interface UseCamerasProps {
  category?: CameraCategory
  status?: CameraFilterStatus
  searchQuery?: string
  enableRealtime?: boolean
}

export interface UseCamerasReturn {
  // Data
  cameras: Camera[]
  stats: CameraStats
  categories: CameraCategory[]

  // Loading states
  isLoading: boolean
  isFetching: boolean

  // Error states
  error: Error | null

  // Actions
  refresh: () => void
  toggleFavorite: (cameraId: string, isFavorite: boolean) => Promise<void>
}

// Real ExacqVision cameras - mapped from actual camera system
// Video URL format: /video.web?s={session};camera={cameraId};w={w};h={h};q={q};format=6
const EXACQ_CAMERAS: Array<{
  exacq_id: number
  name: string
  ip_address: string
  category: CameraCategory
  ptz_capable: boolean
}> = [
  // Multi-Sensor Camera (Illustra Pro4 32MP)
  {
    exacq_id: 5898496,
    name: 'Shipping Camera Head 1',
    ip_address: '192.168.1.20',
    category: 'warehouse',
    ptz_capable: true,
  },
  {
    exacq_id: 5898497,
    name: 'Shipping Camera Head 2',
    ip_address: '192.168.1.20',
    category: 'warehouse',
    ptz_capable: true,
  },
  {
    exacq_id: 5898498,
    name: 'Shipping Camera Head 3',
    ip_address: '192.168.1.20',
    category: 'warehouse',
    ptz_capable: true,
  },
  {
    exacq_id: 5898499,
    name: 'Shipping Camera Head 4',
    ip_address: '192.168.1.20',
    category: 'warehouse',
    ptz_capable: true,
  },

  // Illustra Flex3 4k Bullet Cameras - Outdoor
  {
    exacq_id: 4597248,
    name: 'Blades and Vanes',
    ip_address: '192.168.1.43',
    category: 'outdoor',
    ptz_capable: false,
  },
  {
    exacq_id: 4597504,
    name: 'North Lot - Turnstiles - Visitor Parking',
    ip_address: '192.168.1.44',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4598784,
    name: 'North Trash',
    ip_address: '192.168.1.24',
    category: 'outdoor',
    ptz_capable: false,
  },
  {
    exacq_id: 4599040,
    name: 'South Lot Trash',
    ip_address: '192.168.1.25',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4599296,
    name: 'South Lot Mid',
    ip_address: '192.168.1.26',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4599552,
    name: 'West Lot S Corner',
    ip_address: '192.168.1.27',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4599808,
    name: 'South Ramp 2',
    ip_address: '192.168.1.28',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4594944,
    name: 'North Lot East Fence',
    ip_address: '192.168.1.29',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4603904,
    name: 'South Ramp',
    ip_address: '192.168.1.30',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4600064,
    name: 'South Lot Entrance',
    ip_address: '192.168.1.31',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4604160,
    name: 'West Lot South Entrance',
    ip_address: '192.168.1.34',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4595200,
    name: 'West Lot Mid Entrance',
    ip_address: '192.168.1.35',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4595456,
    name: 'West Lot Mid Entrance 1',
    ip_address: '192.168.1.36',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4595712,
    name: 'West Lot Mid Entrance 2',
    ip_address: '192.168.1.37',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4595968,
    name: 'West Lot North',
    ip_address: '192.168.1.38',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4596224,
    name: 'West Lot N Entrance',
    ip_address: '192.168.1.39',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4596480,
    name: 'Visitor Parking West',
    ip_address: '192.168.1.40',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4596736,
    name: 'Visitor Parking West 2',
    ip_address: '192.168.1.41',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4596992,
    name: 'Turnstiles',
    ip_address: '192.168.1.42',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4597760,
    name: 'North Lot Mid',
    ip_address: '192.168.1.45',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4598016,
    name: 'North Lot Mid 2',
    ip_address: '192.168.1.46',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4604928,
    name: 'South Lot Mid Entrance',
    ip_address: '192.168.1.47',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4604672,
    name: 'South Lot Trash (2)',
    ip_address: '192.168.1.48',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4598272,
    name: 'North Lot Mid 3',
    ip_address: '192.168.1.49',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4593152,
    name: 'North Lot East',
    ip_address: '192.168.1.50',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4600320,
    name: 'North Lot West',
    ip_address: '192.168.1.51',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4603648,
    name: 'North Lot East Fence 2',
    ip_address: '192.168.1.52',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4603392,
    name: 'South Lot East Fence',
    ip_address: '192.168.1.53',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4602880,
    name: 'South Lot East',
    ip_address: '192.168.1.22',
    category: 'parking',
    ptz_capable: false,
  },
  {
    exacq_id: 4600576,
    name: 'South Lot 28',
    ip_address: '192.168.1.23',
    category: 'parking',
    ptz_capable: false,
  },

  // Illustra Flex3 4k Compact Out Cameras - Indoor/Warehouse
  {
    exacq_id: 4593408,
    name: 'Whse NW Corner 2',
    ip_address: '192.168.1.2',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4593664,
    name: 'Rec Doc 1',
    ip_address: '192.168.1.3',
    category: 'indoor',
    ptz_capable: false,
  },
  {
    exacq_id: 4593920,
    name: 'Battery Chargers',
    ip_address: '192.168.1.4',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4605184,
    name: 'Battery Chargers Corner',
    ip_address: '192.168.1.5',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4605440,
    name: 'Whse NW Corner',
    ip_address: '192.168.1.6',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4600832,
    name: 'Kitting South',
    ip_address: '192.168.1.7',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4601088,
    name: 'Shelves SE Corner',
    ip_address: '192.168.1.8',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4603136,
    name: 'South Dock East',
    ip_address: '192.168.1.9',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4601344,
    name: 'Shipping Compactors',
    ip_address: '192.168.1.10',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4598528,
    name: 'Ramp Entrance',
    ip_address: '192.168.1.11',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4601600,
    name: 'Engine Storage',
    ip_address: '192.168.1.12',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4602368,
    name: 'Engine Storage 2',
    ip_address: '192.168.1.13',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4594176,
    name: 'Incora Entrance',
    ip_address: '192.168.1.14',
    category: 'entrance',
    ptz_capable: false,
  },
  {
    exacq_id: 4601856,
    name: 'Spares Packaging',
    ip_address: '192.168.1.15',
    category: 'warehouse',
    ptz_capable: false,
  },
  {
    exacq_id: 4594432,
    name: 'Qual SE',
    ip_address: '192.168.1.16',
    category: 'indoor',
    ptz_capable: false,
  },
  {
    exacq_id: 4602112,
    name: 'Input 1',
    ip_address: '192.168.1.18',
    category: 'indoor',
    ptz_capable: false,
  },

  // Illustra Flex4 4k Dome Out
  {
    exacq_id: 4605696,
    name: 'Input 1 Dome',
    ip_address: '192.168.1.19',
    category: 'indoor',
    ptz_capable: true,
  },
]

// Transform to Camera type with exacq_camera_id for streaming
const REAL_CAMERAS: Camera[] = EXACQ_CAMERAS.map((cam, i) => ({
  id: String(cam.exacq_id), // Use ExacqVision ID as the camera ID
  exacq_camera_id: cam.exacq_id,
  name: cam.name,
  location:
    cam.category === 'warehouse'
      ? 'Warehouse'
      : cam.category === 'parking'
        ? 'Parking Lot'
        : cam.category === 'entrance'
          ? 'Entrance'
          : cam.category === 'outdoor'
            ? 'Outdoor'
            : 'Indoor',
  category: cam.category,
  status: 'online' as const,
  ip_address: cam.ip_address,
  stream_url: '', // Will be generated by stream hook
  thumbnail_url: '', // Will be generated from stream
  ptz_capable: cam.ptz_capable,
  ptz_capabilities: cam.ptz_capable
    ? { pan: true, tilt: true, zoom: true, presets: true }
    : undefined,
  recording_enabled: true,
  motion_detection_enabled: true,
  organization_id: 'org-1',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
  is_favorite: i < 5,
}))

export function useCameras({
  category = 'all',
  status = 'all',
  searchQuery = '',
  enableRealtime = true,
}: UseCamerasProps = {}): UseCamerasReturn {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { profile } = authState

  // Fetch cameras
  const {
    data: camerasData = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: [CAMERAS_QUERY_KEY, profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return []

      // TODO: Replace with actual Supabase query when cameras table is created
      // const { data, error } = await supabase
      //   .from('cameras')
      //   .select('*')
      //   .eq('organization_id', profile.organization_id)
      //   .order('name', { ascending: true })

      // if (error) throw error
      // return data as Camera[]

      // Return real ExacqVision cameras
      return REAL_CAMERAS.map((cam) => ({
        ...cam,
        organization_id: profile.organization_id,
      }))
    },
    enabled: !!profile?.organization_id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })

  // Filter cameras
  const filteredCameras = useMemo(() => {
    let result = camerasData

    // Category filter
    if (category !== 'all') {
      result = result.filter((cam) => cam.category === category)
    }

    // Status filter
    if (status !== 'all') {
      result = result.filter((cam) => cam.status === status)
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (cam) =>
          cam.name.toLowerCase().includes(query) ||
          cam.location.toLowerCase().includes(query) ||
          cam.ip_address.includes(query)
      )
    }

    // Sort: favorites first, then by name
    return result.sort((a, b) => {
      if (a.is_favorite && !b.is_favorite) return -1
      if (!a.is_favorite && b.is_favorite) return 1
      return a.name.localeCompare(b.name)
    })
  }, [camerasData, category, status, searchQuery])

  // Calculate stats
  const stats: CameraStats = useMemo(() => {
    const online = camerasData.filter(
      (c) => c.status === 'online' || c.status === 'recording'
    ).length
    const offline = camerasData.filter((c) => c.status === 'offline').length
    const recording = camerasData.filter((c) => c.status === 'recording').length

    return {
      total: camerasData.length,
      online,
      offline,
      recording,
      alerts_today: Math.floor(Math.random() * 10), // Mock value
    }
  }, [camerasData])

  // Get unique categories
  const categories = useMemo(() => {
    const uniqueCategories = new Set<CameraCategory>(['all'])
    camerasData.forEach((cam) => uniqueCategories.add(cam.category))
    return Array.from(uniqueCategories)
  }, [camerasData])

  // Real-time subscription for camera status updates
  useEffect(() => {
    if (!enableRealtime || !profile?.organization_id) return

    logger.log('🔄 Setting up real-time subscription for cameras')

    const channel = supabase
      .channel('cameras-status-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cameras',
          filter: `organization_id=eq.${profile.organization_id}`,
        },
        (payload) => {
          logger.log('📡 Camera real-time update:', payload.eventType)
          queryClient.invalidateQueries({ queryKey: [CAMERAS_QUERY_KEY] })
        }
      )
      .subscribe()

    return () => {
      logger.log('🔄 Cleaning up cameras subscription')
      supabase.removeChannel(channel)
    }
  }, [enableRealtime, profile?.organization_id, queryClient])

  // Toggle favorite mutation
  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({
      cameraId,
      isFavorite,
    }: {
      cameraId: string
      isFavorite: boolean
    }) => {
      // TODO: Replace with actual Supabase update when cameras_favorites table exists
      // const { error } = await supabase
      //   .from('cameras_favorites')
      //   .upsert({ camera_id: cameraId, user_id: user.id, is_favorite: isFavorite })

      // For now, just update local state
      return { cameraId, isFavorite }
    },
    onMutate: async ({ cameraId, isFavorite }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: [CAMERAS_QUERY_KEY] })

      const previousCameras = queryClient.getQueryData<Camera[]>([
        CAMERAS_QUERY_KEY,
        profile?.organization_id,
      ])

      queryClient.setQueryData<Camera[]>(
        [CAMERAS_QUERY_KEY, profile?.organization_id],
        (old) =>
          old?.map((cam) =>
            cam.id === cameraId ? { ...cam, is_favorite: isFavorite } : cam
          ) ?? []
      )

      return { previousCameras }
    },
    onError: (_error, _variables, context) => {
      // Rollback on error
      if (context?.previousCameras) {
        queryClient.setQueryData(
          [CAMERAS_QUERY_KEY, profile?.organization_id],
          context.previousCameras
        )
      }
      toast.error('Failed to update favorite')
    },
    onSuccess: (_, { isFavorite }) => {
      toast.success(
        isFavorite ? 'Added to favorites' : 'Removed from favorites'
      )
    },
  })

  const refresh = useCallback(() => {
    refetch()
  }, [refetch])

  const { mutateAsync: toggleFavoriteMutateAsync } = toggleFavoriteMutation

  const toggleFavorite = useCallback(
    async (cameraId: string, isFavorite: boolean) => {
      await toggleFavoriteMutateAsync({ cameraId, isFavorite })
    },
    [toggleFavoriteMutateAsync]
  )

  return {
    cameras: filteredCameras as Camera[],
    stats,
    categories,
    isLoading,
    isFetching,
    error: error as Error | null,
    refresh,
    toggleFavorite,
  }
}
