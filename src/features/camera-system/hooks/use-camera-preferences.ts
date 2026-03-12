/**
 * Hook for managing user camera preferences
 *
 * Provides:
 * - User preference storage/retrieval
 * - Default quality settings
 * - Alert notification preferences
 * - Favorite cameras
 */
import { useState, useCallback, useEffect } from 'react'
import { logger } from '@/lib/utils/logger'
import type { CameraPreferences, StreamQuality } from '../types/camera.types'

const STORAGE_KEY = 'camera-preferences'

const DEFAULT_PREFERENCES: CameraPreferences = {
  default_quality: 'auto',
  auto_reconnect: true,
  reconnect_interval_ms: 2000,
  show_timestamp_overlay: true,
  favorite_camera_ids: [],
  default_view_layout: 'single',
  alert_sound_enabled: true,
  motion_notification_enabled: true,
}

export interface UseCameraPreferencesReturn {
  preferences: CameraPreferences
  isLoading: boolean

  // Actions
  updatePreferences: (updates: Partial<CameraPreferences>) => void
  setDefaultQuality: (quality: StreamQuality) => void
  toggleAlertSound: () => void
  toggleMotionNotification: () => void
  addFavoriteCamera: (cameraId: string) => void
  removeFavoriteCamera: (cameraId: string) => void
  isFavoriteCamera: (cameraId: string) => boolean
  resetPreferences: () => void
}

export function useCameraPreferences(): UseCameraPreferencesReturn {
  const [preferences, setPreferences] =
    useState<CameraPreferences>(DEFAULT_PREFERENCES)
  const [isLoading, setIsLoading] = useState(true)

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<CameraPreferences>
        setPreferences({ ...DEFAULT_PREFERENCES, ...parsed })
      }
    } catch (error) {
      logger.error('Failed to load camera preferences:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Save preferences to localStorage whenever they change
  const savePreferences = useCallback((newPrefs: CameraPreferences) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs))
    } catch (error) {
      logger.error('Failed to save camera preferences:', error)
    }
  }, [])

  const updatePreferences = useCallback(
    (updates: Partial<CameraPreferences>) => {
      setPreferences((prev) => {
        const newPrefs = { ...prev, ...updates }
        savePreferences(newPrefs)
        return newPrefs
      })
    },
    [savePreferences]
  )

  const setDefaultQuality = useCallback(
    (quality: StreamQuality) => {
      updatePreferences({ default_quality: quality })
    },
    [updatePreferences]
  )

  const toggleAlertSound = useCallback(() => {
    updatePreferences({ alert_sound_enabled: !preferences.alert_sound_enabled })
  }, [updatePreferences, preferences.alert_sound_enabled])

  const toggleMotionNotification = useCallback(() => {
    updatePreferences({
      motion_notification_enabled: !preferences.motion_notification_enabled,
    })
  }, [updatePreferences, preferences.motion_notification_enabled])

  const addFavoriteCamera = useCallback(
    (cameraId: string) => {
      if (!preferences.favorite_camera_ids.includes(cameraId)) {
        updatePreferences({
          favorite_camera_ids: [...preferences.favorite_camera_ids, cameraId],
        })
      }
    },
    [updatePreferences, preferences.favorite_camera_ids]
  )

  const removeFavoriteCamera = useCallback(
    (cameraId: string) => {
      updatePreferences({
        favorite_camera_ids: preferences.favorite_camera_ids.filter(
          (id) => id !== cameraId
        ),
      })
    },
    [updatePreferences, preferences.favorite_camera_ids]
  )

  const isFavoriteCamera = useCallback(
    (cameraId: string) => {
      return preferences.favorite_camera_ids.includes(cameraId)
    },
    [preferences.favorite_camera_ids]
  )

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES)
    savePreferences(DEFAULT_PREFERENCES)
  }, [savePreferences])

  return {
    preferences,
    isLoading,
    updatePreferences,
    setDefaultQuality,
    toggleAlertSound,
    toggleMotionNotification,
    addFavoriteCamera,
    removeFavoriteCamera,
    isFavoriteCamera,
    resetPreferences,
  }
}
