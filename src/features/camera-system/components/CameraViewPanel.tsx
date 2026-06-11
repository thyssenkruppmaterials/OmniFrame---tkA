// Created and developed by Jai Singh
/**
 * Camera View Panel Component
 *
 * Right panel (75%) showing camera details with:
 * - Header: Camera name, status badge, recording indicator
 * - Main: CameraFeed component (MJPEG stream)
 * - Bottom: PTZ controls (if camera supports PTZ)
 * - Tabs: Live View | Recordings | Events
 * - Fullscreen button
 */
import { useState } from 'react'
import {
  IconVideo,
  IconHistory,
  IconAlertCircle,
  IconSettings,
  IconMapPin,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Camera } from '../types/camera.types'
import { CameraEventsList } from './CameraEventsList'
import { CameraFeed } from './CameraFeed'
import { CameraStatusBadge } from './CameraStatusBadge'
import { PTZControls } from './PTZControls'
import { RecordingsPanel } from './RecordingsPanel'

interface CameraViewPanelProps {
  camera: Camera | null
  className?: string
}

export function CameraViewPanel({ camera, className }: CameraViewPanelProps) {
  const [activeTab, setActiveTab] = useState('live')

  if (!camera) {
    return (
      <Card
        className={cn('flex h-full items-center justify-center', className)}
      >
        <div className='p-8 text-center'>
          <IconVideo className='text-muted-foreground/30 mx-auto mb-4 h-16 w-16' />
          <h3 className='text-muted-foreground text-lg font-semibold'>
            No Camera Selected
          </h3>
          <p className='text-muted-foreground mt-1 text-sm'>
            Select a camera from the list to view the live feed
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <CardHeader className='pb-2'>
        <div className='flex items-start justify-between'>
          <div className='space-y-1'>
            <div className='flex items-center gap-3'>
              <h2 className='text-xl font-semibold'>{camera.name}</h2>
              <CameraStatusBadge status={camera.status} />
            </div>
            <div className='text-muted-foreground flex items-center gap-2 text-sm'>
              <IconMapPin className='h-4 w-4' />
              <span>{camera.location}</span>
              {camera.ptz_capable && (
                <>
                  <span className='text-border'>•</span>
                  <span>PTZ Enabled</span>
                </>
              )}
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='icon' title='Camera settings'>
              <IconSettings className='h-5 w-5' />
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Content */}
      <CardContent className='flex-1 overflow-hidden p-4'>
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className='flex h-full flex-col'
        >
          <TabsList className='mb-4'>
            <TabsTrigger value='live' className='gap-2'>
              <IconVideo className='h-4 w-4' />
              Live View
            </TabsTrigger>
            <TabsTrigger value='recordings' className='gap-2'>
              <IconHistory className='h-4 w-4' />
              Recordings
            </TabsTrigger>
            <TabsTrigger value='events' className='gap-2'>
              <IconAlertCircle className='h-4 w-4' />
              Events
            </TabsTrigger>
          </TabsList>

          {/* Live View Tab */}
          <TabsContent value='live' className='m-0 flex-1 overflow-hidden'>
            <div className='flex h-full flex-col gap-4 lg:flex-row'>
              {/* Camera Feed */}
              <div className='min-h-0 flex-1'>
                <CameraFeed
                  cameraId={camera.id}
                  cameraName={camera.name}
                  className='h-full min-h-[300px]'
                  showControls
                />
              </div>

              {/* PTZ Controls (if supported) */}
              {camera.ptz_capable && camera.ptz_capabilities && (
                <div className='flex-shrink-0 lg:w-64'>
                  <div className='bg-card rounded-lg border p-4'>
                    <h3 className='mb-4 text-sm font-semibold'>PTZ Controls</h3>
                    <PTZControls
                      cameraId={camera.id}
                      capabilities={camera.ptz_capabilities}
                    />
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Recordings Tab */}
          <TabsContent
            value='recordings'
            className='m-0 flex-1 overflow-hidden'
          >
            <RecordingsPanel
              cameraId={camera.id}
              maxHeight='calc(100vh - 320px)'
            />
          </TabsContent>

          {/* Events Tab */}
          <TabsContent value='events' className='m-0 flex-1 overflow-hidden'>
            <CameraEventsList
              cameraId={camera.id}
              maxHeight='calc(100vh - 320px)'
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

// Created and developed by Jai Singh
