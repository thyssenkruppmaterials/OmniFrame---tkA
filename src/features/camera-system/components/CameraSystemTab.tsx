/**
 * Camera System Tab Component
 *
 * Main container for the camera system feature with:
 * - 25/75 responsive layout (list/view panels)
 * - Mobile-optimized stacked layout with swipe navigation
 * - Real-time alert notifications
 */
import { useState, useCallback, useMemo, useRef } from 'react'
import {
  IconAlertCircle,
  IconChevronLeft,
  IconChevronRight,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useCameras } from '../hooks/use-cameras'
import type { CameraCategory, CameraFilterStatus } from '../types/camera.types'
import { CameraAlertToast } from './CameraAlertToast'
import { CameraListPanel } from './CameraListPanel'
import { CameraViewPanel } from './CameraViewPanel'

interface CameraSystemTabProps {
  className?: string
}

export function CameraSystemTab({ className }: CameraSystemTabProps) {
  // Selected camera
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<CameraCategory>('all')
  const [statusFilter, setStatusFilter] = useState<CameraFilterStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Mobile view state
  const [mobileShowList, setMobileShowList] = useState(true)

  // Touch handling for swipe navigation
  const touchStartX = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch cameras with filters
  const { cameras, stats, isLoading, isFetching, refresh, toggleFavorite } =
    useCameras({
      category: categoryFilter,
      status: statusFilter,
      searchQuery,
      enableRealtime: true,
    })

  // Get selected camera object
  const selectedCamera = useMemo(() => {
    return cameras.find((c) => c.id === selectedCameraId) ?? null
  }, [cameras, selectedCameraId])

  // Get current camera index for swipe navigation
  const currentCameraIndex = useMemo(() => {
    if (!selectedCameraId) return -1
    return cameras.findIndex((c) => c.id === selectedCameraId)
  }, [cameras, selectedCameraId])

  // Handle camera selection
  const handleSelectCamera = useCallback((cameraId: string | null) => {
    setSelectedCameraId(cameraId)
    // On mobile, switch to view panel when camera is selected
    if (cameraId && window.innerWidth < 1024) {
      setMobileShowList(false)
    }
  }, [])

  // Navigate to previous camera
  const handlePreviousCamera = useCallback(() => {
    if (currentCameraIndex > 0) {
      setSelectedCameraId(cameras[currentCameraIndex - 1].id)
    }
  }, [cameras, currentCameraIndex])

  // Navigate to next camera
  const handleNextCamera = useCallback(() => {
    if (currentCameraIndex < cameras.length - 1) {
      setSelectedCameraId(cameras[currentCameraIndex + 1].id)
    }
  }, [cameras, currentCameraIndex])

  // Touch handlers for swipe navigation (mobile)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return

      const touchEndX = e.changedTouches[0].clientX
      const diff = touchStartX.current - touchEndX
      const threshold = 50 // Minimum swipe distance

      if (Math.abs(diff) > threshold) {
        if (diff > 0) {
          // Swipe left - next camera
          handleNextCamera()
        } else {
          // Swipe right - previous camera
          handlePreviousCamera()
        }
      }

      touchStartX.current = null
    },
    [handleNextCamera, handlePreviousCamera]
  )

  // Handle back to list on mobile
  const handleBackToList = useCallback(() => {
    setMobileShowList(true)
  }, [])

  return (
    <div
      ref={containerRef}
      className={cn('h-full', className)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Real-time alert notifications */}
      <CameraAlertToast enabled />

      {/* Desktop Layout: 25/75 split */}
      <div className='hidden h-full gap-4 lg:grid lg:grid-cols-4'>
        {/* Left Panel - Camera List (25%) */}
        <div className='lg:col-span-1'>
          <CameraListPanel
            cameras={cameras}
            stats={stats}
            loading={isLoading || isFetching}
            selectedCameraId={selectedCameraId}
            onSelectCamera={handleSelectCamera}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onRefresh={refresh}
            onToggleFavorite={toggleFavorite}
          />
        </div>

        {/* Right Panel - Camera View (75%) */}
        <div className='lg:col-span-3'>
          <CameraViewPanel camera={selectedCamera} />
        </div>
      </div>

      {/* Mobile Layout: Stacked with swipe navigation */}
      <div className='h-full lg:hidden'>
        {mobileShowList ? (
          <CameraListPanel
            cameras={cameras}
            stats={stats}
            loading={isLoading || isFetching}
            selectedCameraId={selectedCameraId}
            onSelectCamera={handleSelectCamera}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onRefresh={refresh}
            onToggleFavorite={toggleFavorite}
          />
        ) : (
          <div className='flex h-full flex-col'>
            {/* Mobile Navigation Bar */}
            <div className='bg-card flex items-center justify-between border-b p-2'>
              <Button variant='ghost' size='sm' onClick={handleBackToList}>
                <IconChevronLeft className='mr-1 h-4 w-4' />
                Cameras
              </Button>

              {/* Camera navigation */}
              {selectedCamera && (
                <div className='flex items-center gap-2'>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    onClick={handlePreviousCamera}
                    disabled={currentCameraIndex <= 0}
                  >
                    <IconChevronLeft className='h-4 w-4' />
                  </Button>
                  <span className='text-muted-foreground text-sm'>
                    {currentCameraIndex + 1} / {cameras.length}
                  </span>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    onClick={handleNextCamera}
                    disabled={currentCameraIndex >= cameras.length - 1}
                  >
                    <IconChevronRight className='h-4 w-4' />
                  </Button>
                </div>
              )}
            </div>

            {/* Camera View */}
            <div className='flex-1 overflow-hidden'>
              <CameraViewPanel camera={selectedCamera} />
            </div>

            {/* Swipe hint */}
            <div className='text-muted-foreground bg-muted/50 py-2 text-center text-xs'>
              Swipe left/right to navigate cameras
            </div>
          </div>
        )}
      </div>

      {/* Error State */}
      {!isLoading &&
        cameras.length === 0 &&
        !searchQuery &&
        categoryFilter === 'all' &&
        statusFilter === 'all' && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
            <Card className='border-destructive pointer-events-auto'>
              <CardContent className='pt-6'>
                <div className='space-y-2 text-center'>
                  <IconAlertCircle className='text-destructive mx-auto h-8 w-8' />
                  <p className='text-destructive font-semibold'>
                    No cameras available
                  </p>
                  <p className='text-muted-foreground text-sm'>
                    Please check your camera configuration
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
    </div>
  )
}
