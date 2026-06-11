// Created and developed by Jai Singh
/**
 * Camera Alert Toast Component
 *
 * Real-time alert notification component that shows
 * camera events as toast notifications with optional
 * snapshot preview.
 */
import { useCallback, useRef } from 'react'
import {
  IconAlertTriangle,
  IconActivity,
  IconBan,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import { useCameraEvents } from '../hooks/use-camera-events'
import { useCameraPreferences } from '../hooks/use-camera-preferences'
import type { CameraAlert, CameraEventType } from '../types/camera.types'

interface CameraAlertToastProps {
  enabled?: boolean
}

const EVENT_ICONS: Record<CameraEventType, typeof IconActivity> = {
  motion: IconActivity,
  alarm: IconAlertTriangle,
  line_crossing: IconBan,
  intrusion: IconAlertTriangle,
  loitering: IconActivity,
  offline: IconWifiOff,
  online: IconWifi,
}

const EVENT_COLORS: Record<CameraEventType, string> = {
  motion: 'text-blue-500',
  alarm: 'text-red-500',
  line_crossing: 'text-orange-500',
  intrusion: 'text-red-600',
  loitering: 'text-amber-500',
  offline: 'text-gray-500',
  online: 'text-green-500',
}

// Audio notification
const playAlertSound = () => {
  try {
    const audio = new Audio('/sounds/alert.mp3')
    audio.volume = 0.5
    audio.play().catch(() => {
      // Ignore autoplay restrictions
    })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Ignore audio errors
  }
}

export function CameraAlertToast({ enabled = true }: CameraAlertToastProps) {
  const { preferences } = useCameraPreferences()
  const lastAlertRef = useRef<string | null>(null)

  // Handle new alert
  const handleNewAlert = useCallback(
    (alert: CameraAlert) => {
      // Prevent duplicate alerts
      if (lastAlertRef.current === alert.id) return
      lastAlertRef.current = alert.id

      // Play sound if enabled
      if (preferences.alert_sound_enabled) {
        playAlertSound()
      }

      const Icon = EVENT_ICONS[alert.event_type]
      const iconColor = EVENT_COLORS[alert.event_type]

      // Show toast notification
      toast(
        <div className='flex items-start gap-3'>
          <div className={iconColor}>
            <Icon className='h-5 w-5' />
          </div>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-semibold'>{alert.camera_name}</p>
            <p className='text-muted-foreground line-clamp-2 text-sm'>
              {alert.message}
            </p>
          </div>
          {alert.snapshot_url && (
            <div className='flex-shrink-0'>
              <img
                src={alert.snapshot_url}
                alt='Alert snapshot'
                className='h-10 w-16 rounded object-cover'
              />
            </div>
          )}
        </div>,
        {
          duration: 10000,
          action: {
            label: 'View',
            onClick: () => {
              // Navigate to camera or open event details
              logger.log('View alert:', alert.id)
            },
          },
        }
      )
    },
    [preferences.alert_sound_enabled]
  )

  // Subscribe to events
  useCameraEvents({
    acknowledged: false,
    enableRealtime: enabled && preferences.motion_notification_enabled,
    onNewAlert: handleNewAlert,
  })

  return null
}

/**
 * Hook to manually show a camera alert toast
 */
export function useShowCameraAlert() {
  const { preferences } = useCameraPreferences()

  const showAlert = useCallback(
    (alert: CameraAlert) => {
      // Play sound if enabled
      if (preferences.alert_sound_enabled) {
        playAlertSound()
      }

      const Icon = EVENT_ICONS[alert.event_type]
      const iconColor = EVENT_COLORS[alert.event_type]

      toast(
        <div className='flex items-start gap-3'>
          <div className={iconColor}>
            <Icon className='h-5 w-5' />
          </div>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-semibold'>{alert.camera_name}</p>
            <p className='text-muted-foreground line-clamp-2 text-sm'>
              {alert.message}
            </p>
          </div>
          {alert.snapshot_url && (
            <div className='flex-shrink-0'>
              <img
                src={alert.snapshot_url}
                alt='Alert snapshot'
                className='h-10 w-16 rounded object-cover'
              />
            </div>
          )}
        </div>,
        {
          duration: 10000,
        }
      )
    },
    [preferences.alert_sound_enabled]
  )

  return { showAlert }
}

// Created and developed by Jai Singh
