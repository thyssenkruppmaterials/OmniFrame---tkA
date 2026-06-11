// Created and developed by Jai Singh
/**
 * Hook for managing camera recordings
 *
 * Provides:
 * - Recording list with date filtering
 * - Playback URL generation
 * - Download functionality
 */
import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { CameraRecording, RecordingFilter } from '../types/camera.types'

// Query keys
export const CAMERA_RECORDINGS_KEY = 'camera-recordings'

export interface UseCameraRecordingsProps {
  cameraId?: string
  filter?: RecordingFilter
  enabled?: boolean
}

export interface UseCameraRecordingsReturn {
  // Data
  recordings: CameraRecording[]
  totalDurationSeconds: number
  totalSizeMb: number

  // Loading states
  isLoading: boolean

  // Error states
  error: Error | null

  // Actions
  refresh: () => void
  downloadRecording: (recordingId: string) => void
  getPlaybackUrl: (recordingId: string) => string
}

// Mock recordings for development
const generateMockRecordings = (cameraId?: string): CameraRecording[] => {
  const recordings: CameraRecording[] = []
  const baseTime = new Date()

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour += 4) {
      const id = `rec-${cameraId || 'all'}-${day}-${hour}`
      const startTime = new Date(baseTime)
      startTime.setDate(startTime.getDate() - day)
      startTime.setHours(hour, 0, 0, 0)

      const endTime = new Date(startTime)
      endTime.setHours(hour + 4)

      recordings.push({
        id,
        camera_id: cameraId || `cam-${((day * 6 + hour / 4) % 10) + 1}`,
        camera_name: `Camera ${String(((day * 6 + hour / 4) % 10) + 1).padStart(2, '0')}`,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration_seconds: 4 * 60 * 60,
        file_size_mb: 500 + Math.random() * 1000,
        file_url: `/api/camera/recordings/${id}`,
        thumbnail_url: `https://picsum.photos/seed/${id}/320/180`,
        event_triggered: Math.random() > 0.7,
        event_id: Math.random() > 0.7 ? `event-${day}` : undefined,
      })
    }
  }

  return recordings
}

export function useCameraRecordings({
  cameraId,
  filter,
  enabled = true,
}: UseCameraRecordingsProps = {}): UseCameraRecordingsReturn {
  const { authState } = useUnifiedAuth()
  const { profile } = authState

  // Fetch recordings
  const {
    data: recordingsData = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      CAMERA_RECORDINGS_KEY,
      profile?.organization_id,
      cameraId,
      filter,
    ],
    queryFn: async () => {
      if (!profile?.organization_id) return []

      // TODO: Replace with actual Supabase query
      // let query = supabase
      //   .from('camera_recordings')
      //   .select('*')
      //   .eq('organization_id', profile.organization_id)
      //   .order('start_time', { ascending: false })

      // if (cameraId) query = query.eq('camera_id', cameraId)
      // if (filter?.start_date) query = query.gte('start_time', filter.start_date)
      // if (filter?.end_date) query = query.lte('end_time', filter.end_date)
      // if (filter?.event_triggered !== undefined) query = query.eq('event_triggered', filter.event_triggered)

      // const { data, error } = await query
      // if (error) throw error
      // return data as CameraRecording[]

      // Filter mock data
      let result = generateMockRecordings(cameraId)

      if (filter?.start_date) {
        result = result.filter(
          (r) => new Date(r.start_time) >= new Date(filter.start_date!)
        )
      }
      if (filter?.end_date) {
        result = result.filter(
          (r) => new Date(r.end_time) <= new Date(filter.end_date!)
        )
      }
      if (filter?.event_triggered !== undefined) {
        result = result.filter(
          (r) => r.event_triggered === filter.event_triggered
        )
      }

      return result
    },
    enabled: enabled && !!profile?.organization_id,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })

  // Calculate totals
  const { totalDurationSeconds, totalSizeMb } = useMemo(() => {
    return recordingsData.reduce(
      (acc, rec) => ({
        totalDurationSeconds: acc.totalDurationSeconds + rec.duration_seconds,
        totalSizeMb: acc.totalSizeMb + rec.file_size_mb,
      }),
      { totalDurationSeconds: 0, totalSizeMb: 0 }
    )
  }, [recordingsData])

  const refresh = useCallback(() => {
    refetch()
  }, [refetch])

  const getPlaybackUrl = useCallback((recordingId: string) => {
    return `/api/camera/recordings/${recordingId}/playback`
  }, [])

  const downloadRecording = useCallback(
    (recordingId: string) => {
      const recording = recordingsData.find((r) => r.id === recordingId)
      if (!recording) {
        toast.error('Recording not found')
        return
      }

      // Create download link
      const link = document.createElement('a')
      link.href = recording.file_url
      link.download = `${recording.camera_name}_${recording.start_time}.mp4`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast.success('Download started')
    },
    [recordingsData]
  )

  return {
    recordings: recordingsData,
    totalDurationSeconds,
    totalSizeMb,
    isLoading,
    error: error as Error | null,
    refresh,
    downloadRecording,
    getPlaybackUrl,
  }
}

// Created and developed by Jai Singh
