/**
 * Hook for managing camera events
 *
 * Provides:
 * - Event list with filtering
 * - Real-time event subscription
 * - Event acknowledgment
 * - Alert notifications
 */
import { useCallback, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import type {
  CameraEvent,
  CameraEventType,
  CameraAlert,
} from '../types/camera.types'

// Query keys
export const CAMERA_EVENTS_KEY = 'camera-events'

export interface UseCameraEventsProps {
  cameraId?: string
  eventTypes?: CameraEventType[]
  acknowledged?: boolean
  enableRealtime?: boolean
  limit?: number
  onNewAlert?: (alert: CameraAlert) => void
}

export interface UseCameraEventsReturn {
  // Data
  events: CameraEvent[]
  unacknowledgedCount: number

  // Loading states
  isLoading: boolean

  // Error states
  error: Error | null

  // Actions
  refresh: () => void
  acknowledgeEvent: (eventId: string) => Promise<void>
  acknowledgeAll: () => Promise<void>
}

// Mock events for development
const MOCK_EVENTS: CameraEvent[] = Array.from({ length: 25 }, (_, i) => ({
  id: `event-${i + 1}`,
  camera_id: `cam-${(i % 10) + 1}`,
  camera_name: `Camera ${String((i % 10) + 1).padStart(2, '0')}`,
  event_type: (
    [
      'motion',
      'alarm',
      'line_crossing',
      'intrusion',
      'offline',
      'online',
    ] as CameraEventType[]
  )[i % 6],
  severity: (['low', 'medium', 'high', 'critical'] as const)[i % 4],
  message: [
    'Motion detected in monitored area',
    'Alarm triggered - immediate attention required',
    'Line crossing violation detected',
    'Intrusion detected in restricted zone',
    'Camera went offline',
    'Camera back online',
  ][i % 6],
  snapshot_url: `https://picsum.photos/seed/event${i}/640/360`,
  timestamp: new Date(Date.now() - i * 15 * 60 * 1000).toISOString(),
  acknowledged: i > 5,
  acknowledged_by: i > 5 ? 'admin@example.com' : undefined,
  acknowledged_at:
    i > 5 ? new Date(Date.now() - i * 10 * 60 * 1000).toISOString() : undefined,
}))

export function useCameraEvents({
  cameraId,
  eventTypes,
  acknowledged,
  enableRealtime = true,
  limit = 50,
  onNewAlert,
}: UseCameraEventsProps = {}): UseCameraEventsReturn {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  // Fetch events
  const {
    data: eventsData = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      CAMERA_EVENTS_KEY,
      profile?.organization_id,
      cameraId,
      eventTypes,
      acknowledged,
      limit,
    ],
    queryFn: async () => {
      if (!profile?.organization_id) return []

      // TODO: Replace with actual Supabase query
      // let query = supabase
      //   .from('camera_events')
      //   .select('*')
      //   .eq('organization_id', profile.organization_id)
      //   .order('timestamp', { ascending: false })
      //   .limit(limit)

      // if (cameraId) query = query.eq('camera_id', cameraId)
      // if (eventTypes?.length) query = query.in('event_type', eventTypes)
      // if (acknowledged !== undefined) query = query.eq('acknowledged', acknowledged)

      // const { data, error } = await query
      // if (error) throw error
      // return data as CameraEvent[]

      // Filter mock data
      let result = [...MOCK_EVENTS]

      if (cameraId) {
        result = result.filter((e) => e.camera_id === cameraId)
      }
      if (eventTypes?.length) {
        result = result.filter((e) => eventTypes.includes(e.event_type))
      }
      if (acknowledged !== undefined) {
        result = result.filter((e) => e.acknowledged === acknowledged)
      }

      return result.slice(0, limit)
    },
    enabled: !!profile?.organization_id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })

  // Unacknowledged count
  const unacknowledgedCount = useMemo(() => {
    return eventsData.filter((e) => !e.acknowledged).length
  }, [eventsData])

  // Real-time subscription for new events
  useEffect(() => {
    if (!enableRealtime || !profile?.organization_id) return

    logger.log('🔄 Setting up real-time subscription for camera events')

    const channel = supabase
      .channel('camera-events-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'camera_events',
          filter: `organization_id=eq.${profile.organization_id}`,
        },
        (payload) => {
          logger.log('📡 New camera event:', payload.new)

          const newEvent = payload.new as CameraEvent

          // Invalidate queries
          queryClient.invalidateQueries({ queryKey: [CAMERA_EVENTS_KEY] })

          // Trigger alert callback
          if (onNewAlert && !newEvent.acknowledged) {
            onNewAlert({
              id: newEvent.id,
              camera_id: newEvent.camera_id,
              camera_name: newEvent.camera_name,
              event_type: newEvent.event_type,
              message: newEvent.message,
              snapshot_url: newEvent.snapshot_url,
              timestamp: newEvent.timestamp,
            })
          }
        }
      )
      .subscribe()

    return () => {
      logger.log('🔄 Cleaning up camera events subscription')
      supabase.removeChannel(channel)
    }
  }, [enableRealtime, profile?.organization_id, queryClient, onNewAlert])

  // Acknowledge event mutation
  const acknowledgeMutation = useMutation({
    mutationFn: async (eventId: string) => {
      if (!user) throw new Error('User not authenticated')

      // TODO: Replace with actual Supabase update
      // const { error } = await supabase
      //   .from('camera_events')
      //   .update({
      //     acknowledged: true,
      //     acknowledged_by: user.email,
      //     acknowledged_at: new Date().toISOString()
      //   })
      //   .eq('id', eventId)

      // if (error) throw error

      return eventId
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CAMERA_EVENTS_KEY] })
      toast.success('Event acknowledged')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to acknowledge event'
      )
    },
  })

  // Acknowledge all events mutation
  const acknowledgeAllMutation = useMutation({
    mutationFn: async () => {
      if (!user || !profile?.organization_id)
        throw new Error('User not authenticated')

      // TODO: Replace with actual Supabase update
      // const { error } = await supabase
      //   .from('camera_events')
      //   .update({
      //     acknowledged: true,
      //     acknowledged_by: user.email,
      //     acknowledged_at: new Date().toISOString()
      //   })
      //   .eq('organization_id', profile.organization_id)
      //   .eq('acknowledged', false)

      // if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CAMERA_EVENTS_KEY] })
      toast.success('All events acknowledged')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to acknowledge events'
      )
    },
  })

  const refresh = useCallback(() => {
    refetch()
  }, [refetch])

  const { mutateAsync: acknowledgeMutateAsync } = acknowledgeMutation
  const { mutateAsync: acknowledgeAllMutateAsync } = acknowledgeAllMutation

  const acknowledgeEvent = useCallback(
    async (eventId: string) => {
      await acknowledgeMutateAsync(eventId)
    },
    [acknowledgeMutateAsync]
  )

  const acknowledgeAll = useCallback(async () => {
    await acknowledgeAllMutateAsync()
  }, [acknowledgeAllMutateAsync])

  return {
    events: eventsData,
    unacknowledgedCount,
    isLoading,
    error: error as Error | null,
    refresh,
    acknowledgeEvent,
    acknowledgeAll,
  }
}
