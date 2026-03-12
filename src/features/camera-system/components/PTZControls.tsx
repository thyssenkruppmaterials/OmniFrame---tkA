/**
 * PTZ Controls Component
 *
 * Pan/Tilt/Zoom controls for PTZ-capable cameras:
 * - Directional pad (up, down, left, right)
 * - Zoom in/out buttons
 * - Preset positions dropdown
 */
import { useState, useCallback } from 'react'
import {
  IconArrowUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconZoomIn,
  IconZoomOut,
  IconHome,
  IconPlayerStop,
} from '@tabler/icons-react'
import { toast } from 'sonner'
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
import { Slider } from '@/components/ui/slider'
import type {
  PTZCapabilities,
  PTZPreset,
  PTZCommand,
} from '../types/camera.types'

interface PTZControlsProps {
  cameraId: string
  capabilities: PTZCapabilities
  presets?: PTZPreset[]
  className?: string
  onCommand?: (command: PTZCommand) => void
}

// Mock presets for development
const DEFAULT_PRESETS: PTZPreset[] = [
  {
    id: 'home',
    name: 'Home Position',
    camera_id: '',
    position: { pan: 0, tilt: 0, zoom: 1 },
  },
  {
    id: 'entrance',
    name: 'Entrance View',
    camera_id: '',
    position: { pan: -45, tilt: 10, zoom: 2 },
  },
  {
    id: 'parking',
    name: 'Parking Area',
    camera_id: '',
    position: { pan: 90, tilt: -15, zoom: 3 },
  },
  {
    id: 'corner',
    name: 'Corner View',
    camera_id: '',
    position: { pan: 180, tilt: 0, zoom: 1 },
  },
]

export function PTZControls({
  cameraId,
  capabilities,
  presets = DEFAULT_PRESETS,
  className,
  onCommand,
}: PTZControlsProps) {
  const [speed, setSpeed] = useState(50)
  const [isMoving, setIsMoving] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string>('')

  // Send PTZ command
  const sendCommand = useCallback(
    (action: PTZCommand['action'], presetId?: string) => {
      const command: PTZCommand = {
        camera_id: cameraId,
        action,
        preset_id: presetId,
        speed: speed / 100,
      }

      logger.log('PTZ Command:', command)

      // Call the onCommand callback if provided
      onCommand?.(command)

      // TODO: Replace with actual API call
      // await fetch(`/api/camera/${cameraId}/ptz`, {
      //   method: 'POST',
      //   body: JSON.stringify(command),
      // })

      if (action !== 'stop') {
        setIsMoving(true)
        toast.info(`PTZ: ${action.replace('_', ' ')}`)
      } else {
        setIsMoving(false)
      }
    },
    [cameraId, speed, onCommand]
  )

  // Handle preset selection
  const handlePresetChange = useCallback(
    (presetId: string) => {
      setSelectedPreset(presetId)
      sendCommand('goto_preset', presetId)
      toast.success(
        `Moving to preset: ${presets.find((p) => p.id === presetId)?.name}`
      )
    },
    [presets, sendCommand]
  )

  // Stop all movement
  const handleStop = useCallback(() => {
    sendCommand('stop')
    setIsMoving(false)
  }, [sendCommand])

  // Go to home position
  const handleHome = useCallback(() => {
    sendCommand('goto_preset', 'home')
    setSelectedPreset('home')
    toast.success('Moving to home position')
  }, [sendCommand])

  const canPan = capabilities.pan
  const canTilt = capabilities.tilt
  const canZoom = capabilities.zoom
  const hasPresets = capabilities.presets && presets.length > 0

  return (
    <div className={cn('space-y-4', className)}>
      {/* Directional Pad and Zoom */}
      <div className='flex items-start justify-center gap-6'>
        {/* Directional Pad */}
        {(canPan || canTilt) && (
          <div className='grid grid-cols-3 gap-1'>
            {/* Top Row */}
            <div />
            <Button
              variant='outline'
              size='icon'
              className='h-10 w-10'
              disabled={!canTilt}
              onMouseDown={() => sendCommand('tilt_up')}
              onMouseUp={handleStop}
              onMouseLeave={handleStop}
            >
              <IconArrowUp className='h-5 w-5' />
            </Button>
            <div />

            {/* Middle Row */}
            <Button
              variant='outline'
              size='icon'
              className='h-10 w-10'
              disabled={!canPan}
              onMouseDown={() => sendCommand('pan_left')}
              onMouseUp={handleStop}
              onMouseLeave={handleStop}
            >
              <IconArrowLeft className='h-5 w-5' />
            </Button>
            <Button
              variant={isMoving ? 'destructive' : 'outline'}
              size='icon'
              className='h-10 w-10'
              onClick={handleStop}
            >
              <IconPlayerStop className='h-5 w-5' />
            </Button>
            <Button
              variant='outline'
              size='icon'
              className='h-10 w-10'
              disabled={!canPan}
              onMouseDown={() => sendCommand('pan_right')}
              onMouseUp={handleStop}
              onMouseLeave={handleStop}
            >
              <IconArrowRight className='h-5 w-5' />
            </Button>

            {/* Bottom Row */}
            <div />
            <Button
              variant='outline'
              size='icon'
              className='h-10 w-10'
              disabled={!canTilt}
              onMouseDown={() => sendCommand('tilt_down')}
              onMouseUp={handleStop}
              onMouseLeave={handleStop}
            >
              <IconArrowDown className='h-5 w-5' />
            </Button>
            <div />
          </div>
        )}

        {/* Zoom Controls */}
        {canZoom && (
          <div className='flex flex-col gap-2'>
            <Button
              variant='outline'
              size='icon'
              className='h-10 w-10'
              onMouseDown={() => sendCommand('zoom_in')}
              onMouseUp={handleStop}
              onMouseLeave={handleStop}
            >
              <IconZoomIn className='h-5 w-5' />
            </Button>
            <Button
              variant='outline'
              size='icon'
              className='h-10 w-10'
              onMouseDown={() => sendCommand('zoom_out')}
              onMouseUp={handleStop}
              onMouseLeave={handleStop}
            >
              <IconZoomOut className='h-5 w-5' />
            </Button>
          </div>
        )}
      </div>

      {/* Speed Slider */}
      <div className='space-y-2'>
        <div className='flex items-center justify-between text-sm'>
          <span className='text-muted-foreground'>Speed</span>
          <span className='font-medium'>{speed}%</span>
        </div>
        <Slider
          value={[speed]}
          onValueChange={([value]) => setSpeed(value)}
          min={10}
          max={100}
          step={10}
          className='w-full'
        />
      </div>

      {/* Presets and Home */}
      {hasPresets && (
        <div className='flex items-center gap-2'>
          <Select value={selectedPreset} onValueChange={handlePresetChange}>
            <SelectTrigger className='flex-1'>
              <SelectValue placeholder='Go to preset...' />
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant='outline'
            size='icon'
            onClick={handleHome}
            title='Go to home position'
          >
            <IconHome className='h-4 w-4' />
          </Button>
        </div>
      )}
    </div>
  )
}
