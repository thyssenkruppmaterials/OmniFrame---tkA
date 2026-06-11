// Created and developed by Jai Singh
/**
 * Camera Feed Component
 *
 * Displays MJPEG stream from camera with:
 * - Loading state
 * - Error handling with auto-reconnect
 * - Quality selection
 * - Fullscreen support
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import {
  IconRefresh,
  IconMaximize,
  IconMinimize,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCameraStream } from '../hooks/use-camera-stream'
import type { StreamQuality } from '../types/camera.types'

interface CameraFeedProps {
  cameraId: string
  cameraName: string
  className?: string
  showControls?: boolean
  initialQuality?: StreamQuality
  onFullscreenChange?: (isFullscreen: boolean) => void
}

const QUALITY_OPTIONS: { value: StreamQuality; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High (1080p)' },
  { value: 'medium', label: 'Medium (720p)' },
  { value: 'low', label: 'Low (480p)' },
]

export function CameraFeed({
  cameraId,
  cameraName,
  className,
  showControls = true,
  initialQuality = 'auto',
  onFullscreenChange,
}: CameraFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageKey, setImageKey] = useState(0)

  const {
    streamUrl,
    quality,
    isLoading,
    error,
    reconnectAttempts,
    setQuality,
    reconnect,
  } = useCameraStream({
    cameraId,
    initialQuality,
    autoReconnect: true,
  })

  // Handle image load
  const handleImageLoad = useCallback(() => {
    setImageLoaded(true)
  }, [])

  // Handle image error
  const handleImageError = useCallback(() => {
    setImageLoaded(false)
  }, [])

  // Handle manual reconnect
  const handleReconnect = useCallback(() => {
    setImageLoaded(false)
    setImageKey((prev) => prev + 1)
    reconnect()
  }, [reconnect])

  // Handle quality change
  const handleQualityChange = useCallback(
    (value: StreamQuality) => {
      setImageLoaded(false)
      setImageKey((prev) => prev + 1)
      setQuality(value)
    },
    [setQuality]
  )

  // Handle fullscreen toggle
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return

    try {
      if (!isFullscreen) {
        await containerRef.current.requestFullscreen()
        setIsFullscreen(true)
        onFullscreenChange?.(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
        onFullscreenChange?.(false)
      }
    } catch (err) {
      logger.error('Fullscreen error:', err)
    }
  }, [isFullscreen, onFullscreenChange])

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement
      setIsFullscreen(isNowFullscreen)
      onFullscreenChange?.(isNowFullscreen)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [onFullscreenChange])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden rounded-lg bg-black',
        isFullscreen && 'fixed inset-0 z-50',
        className
      )}
    >
      {/* Loading State */}
      {(isLoading || !imageLoaded) && !error && (
        <div className='bg-muted absolute inset-0 flex items-center justify-center'>
          <div className='space-y-2 text-center'>
            <Skeleton className='mx-auto h-8 w-8 rounded-full' />
            <p className='text-muted-foreground text-sm'>
              {reconnectAttempts > 0
                ? `Reconnecting... (${reconnectAttempts})`
                : 'Connecting to stream...'}
            </p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className='bg-muted absolute inset-0 flex items-center justify-center'>
          <div className='space-y-3 p-4 text-center'>
            <IconAlertTriangle className='text-destructive mx-auto h-10 w-10' />
            <div>
              <p className='text-destructive font-medium'>Connection Failed</p>
              <p className='text-muted-foreground max-w-xs text-sm'>
                {error || 'Unable to connect to camera stream'}
              </p>
            </div>
            <Button variant='outline' size='sm' onClick={handleReconnect}>
              <IconRefresh className='mr-2 h-4 w-4' />
              Retry Connection
            </Button>
          </div>
        </div>
      )}

      {/* MJPEG Stream */}
      <img
        key={imageKey}
        ref={imgRef}
        src={streamUrl}
        alt={cameraName}
        className={cn(
          'h-full w-full object-contain transition-opacity duration-300',
          imageLoaded ? 'opacity-100' : 'opacity-0'
        )}
        onLoad={handleImageLoad}
        onError={handleImageError}
      />

      {/* Controls Overlay */}
      {showControls && (
        <div className='absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/80 to-transparent p-3'>
          <div className='flex items-center justify-between'>
            {/* Quality Selector */}
            <Select value={quality} onValueChange={handleQualityChange}>
              <SelectTrigger className='h-8 w-32 border-white/20 bg-black/50 text-xs text-white'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUALITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Action Buttons */}
            <div className='flex items-center gap-2'>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 text-white hover:bg-white/20'
                onClick={handleReconnect}
                title='Refresh stream'
              >
                <IconRefresh className='h-4 w-4' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 text-white hover:bg-white/20'
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? (
                  <IconMinimize className='h-4 w-4' />
                ) : (
                  <IconMaximize className='h-4 w-4' />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Name Overlay */}
      <div className='absolute top-0 right-0 left-0 bg-gradient-to-b from-black/60 to-transparent p-3'>
        <p className='truncate text-sm font-medium text-white'>{cameraName}</p>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
