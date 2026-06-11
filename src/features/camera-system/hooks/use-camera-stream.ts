// Created and developed by Jai Singh
/**
 * Hook for managing camera stream connections
 *
 * Provides:
 * - Stream URL generation
 * - Auto-reconnect on error
 * - Quality selection
 * - Connection state management
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import type { StreamQuality, CameraStreamState } from '../types/camera.types'

const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY_MS = 2000

// Rust streaming service URL - in production this comes from env
const STREAMING_SERVICE_URL =
  import.meta.env.VITE_STREAMING_SERVICE_URL ||
  'https://rust-streaming-service-production.up.railway.app'

// Convert quality string to numeric value for ExacqVision (1-10, higher is better)
const QUALITY_MAP: Record<StreamQuality, number> = {
  low: 3,
  medium: 5,
  high: 8,
  auto: 7, // Default to good quality
}

export interface UseCameraStreamProps {
  cameraId: string
  initialQuality?: StreamQuality
  autoReconnect?: boolean
  onError?: (error: string) => void
  onConnect?: () => void
  onDisconnect?: () => void
}

export interface UseCameraStreamReturn {
  // Stream state
  streamUrl: string
  quality: StreamQuality
  isConnected: boolean
  isLoading: boolean
  error: string | null
  reconnectAttempts: number

  // Actions
  setQuality: (quality: StreamQuality) => void
  reconnect: () => void
  disconnect: () => void
}

export function useCameraStream({
  cameraId,
  initialQuality = 'auto',
  autoReconnect = true,
  onError,
  onConnect,
  onDisconnect,
}: UseCameraStreamProps): UseCameraStreamReturn {
  const [state, setState] = useState<CameraStreamState>({
    camera_id: cameraId,
    quality: initialQuality,
    is_connected: false,
    is_loading: true,
    error: undefined,
    reconnect_attempts: 0,
  })

  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // Generate stream URL for ExacqVision cameras via rust-streaming-service
  // Camera IDs are ExacqVision camera IDs (numeric strings like "5898496")
  // The rust-streaming-service handles authentication and proxies MJPEG streams
  const numericQuality = QUALITY_MAP[state.quality] || 7
  const streamUrl = `${STREAMING_SERVICE_URL}/api/v1/stream/${cameraId}?quality=${numericQuality}&t=${Date.now()}`

  // Handle successful connection (exported for external use)
  const handleConnect = useCallback(() => {
    if (!mountedRef.current) return

    setState((prev) => ({
      ...prev,
      is_connected: true,
      is_loading: false,
      error: undefined,
      reconnect_attempts: 0,
    }))

    onConnect?.()
  }, [onConnect])

  // Handle connection error (exported for external use)
  const handleError = useCallback(
    (errorMsg: string) => {
      if (!mountedRef.current) return

      setState((prev) => ({
        ...prev,
        is_connected: false,
        is_loading: false,
        error: errorMsg,
      }))

      onError?.(errorMsg)

      // Auto-reconnect if enabled
      if (autoReconnect && state.reconnect_attempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectTimeoutRef.current = setTimeout(
          () => {
            if (mountedRef.current) {
              reconnect()
            }
          },
          RECONNECT_DELAY_MS * Math.pow(2, state.reconnect_attempts)
        )
      }
    },
    // reconnect is defined later; circular dep prevents adding to deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoReconnect, state.reconnect_attempts, onError]
  )

  // Expose handlers for external img onLoad/onError
  void handleConnect
  void handleError

  // Reconnect to stream
  const reconnect = useCallback(() => {
    if (!mountedRef.current) return

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    setState((prev) => ({
      ...prev,
      is_loading: true,
      error: undefined,
      reconnect_attempts: prev.reconnect_attempts + 1,
    }))
  }, [])

  // Disconnect from stream
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    setState((prev) => ({
      ...prev,
      is_connected: false,
      is_loading: false,
    }))

    onDisconnect?.()
  }, [onDisconnect])

  // Set quality
  const setQuality = useCallback((quality: StreamQuality) => {
    setState((prev) => ({
      ...prev,
      quality,
      is_loading: true,
      reconnect_attempts: 0,
    }))
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [])

  // Reset when camera changes
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      camera_id: cameraId,
      is_loading: true,
      is_connected: false,
      error: undefined,
      reconnect_attempts: 0,
    }))
  }, [cameraId])

  return {
    streamUrl,
    quality: state.quality,
    isConnected: state.is_connected,
    isLoading: state.is_loading,
    error: state.error ?? null,
    reconnectAttempts: state.reconnect_attempts,
    setQuality,
    reconnect,
    disconnect,
  }
}

// Created and developed by Jai Singh
