// Created and developed by Jai Singh
import { useState, useRef, useCallback, useEffect } from 'react'
import { IconCamera, IconCameraOff, IconRefresh } from '@tabler/icons-react'
import { logger } from '@/lib/utils/logger'

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void
  isActive: boolean
}

export default function CameraCapture({
  onCapture,
  isActive,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [captured, setCaptured] = useState(false)

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          setCameraReady(true)
        }
      }
    } catch (err) {
      logger.error('Camera access error:', err)
      setCameraError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera access denied. Please allow camera permissions.'
          : 'Unable to access camera. Please check your device.'
      )
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setCameraReady(false)
    setCaptured(false)
  }, [])

  useEffect(() => {
    if (isActive) {
      startCamera()
    } else {
      stopCamera()
    }
    return () => {
      stopCamera()
    }
  }, [isActive, startCamera, stopCamera])

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !cameraReady) return

    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0)
    setCaptured(true)

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapture(blob)
        }
      },
      'image/jpeg',
      0.85
    )
  }, [cameraReady, onCapture])

  const retake = useCallback(() => {
    setCaptured(false)
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      }
    }
  }, [])

  return (
    <div className='flex flex-col items-center gap-4'>
      <div className='bg-muted border-border relative h-52 w-72 overflow-hidden rounded-xl border-2 shadow-sm'>
        {cameraError ? (
          <div className='flex h-full flex-col items-center justify-center gap-2 px-6 text-center'>
            <IconCameraOff className='text-destructive/50 h-10 w-10' />
            <p className='text-destructive text-xs'>{cameraError}</p>
            <button
              onClick={startCamera}
              className='bg-primary/10 hover:bg-primary/20 text-primary mt-1 rounded-lg px-3 py-1.5 text-xs font-medium transition'
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${captured ? 'hidden' : 'block'}`}
            />
            <canvas
              ref={canvasRef}
              className={`h-full w-full object-cover ${captured ? 'block' : 'hidden'}`}
            />
            {!cameraReady && !cameraError && (
              <div className='bg-muted absolute inset-0 flex items-center justify-center'>
                <div className='flex flex-col items-center gap-2'>
                  <div className='border-muted-foreground/30 border-t-primary h-6 w-6 animate-spin rounded-full border-2' />
                  <span className='text-muted-foreground text-xs'>
                    Starting camera...
                  </span>
                </div>
              </div>
            )}
            {captured && (
              <div className='absolute top-2 right-2'>
                <span className='rounded-md bg-green-600 px-2 py-1 text-[10px] font-semibold text-white'>
                  Captured
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {cameraReady && !cameraError && (
        <div className='flex gap-3'>
          {!captured ? (
            <button
              onClick={capturePhoto}
              className='bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-medium shadow-sm transition active:scale-[0.97]'
            >
              <IconCamera className='h-4 w-4' />
              Capture Photo
            </button>
          ) : (
            <button
              onClick={retake}
              className='bg-secondary hover:bg-secondary/80 text-secondary-foreground border-border flex items-center gap-2 rounded-xl border px-6 py-2.5 text-sm font-medium transition'
            >
              <IconRefresh className='h-4 w-4' />
              Retake
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
