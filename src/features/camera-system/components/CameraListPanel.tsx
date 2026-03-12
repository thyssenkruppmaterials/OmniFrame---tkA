/**
 * Camera List Panel Component
 *
 * Left panel (25%) showing filterable list of cameras with:
 * - Search input to filter by name
 * - Category filter dropdown
 * - Status filter (Online, Offline, All)
 * - Virtual scrolling for 55 cameras
 * - Camera cards with name, thumbnail, status, location
 * - Favorite star toggle
 */
import { useRef, useCallback, useMemo, useEffect } from 'react'
import {
  IconSearch,
  IconRefresh,
  IconVideo,
  IconVideoOff,
  IconStar,
  IconStarFilled,
  IconCamera,
} from '@tabler/icons-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  Camera,
  CameraCategory,
  CameraFilterStatus,
  CameraStats,
} from '../types/camera.types'
import { CameraStatusBadge } from './CameraStatusBadge'

interface CameraListPanelProps {
  cameras: Camera[]
  stats: CameraStats
  loading: boolean
  selectedCameraId: string | null
  onSelectCamera: (id: string | null) => void
  categoryFilter: CameraCategory
  onCategoryFilterChange: (category: CameraCategory) => void
  statusFilter: CameraFilterStatus
  onStatusFilterChange: (status: CameraFilterStatus) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  onRefresh: () => void
  onToggleFavorite: (cameraId: string, isFavorite: boolean) => void
}

// Estimated height for each camera card
const CAMERA_CARD_HEIGHT = 88

const CATEGORY_OPTIONS: { value: CameraCategory; label: string }[] = [
  { value: 'all', label: 'All Cameras' },
  { value: 'indoor', label: 'Indoor' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'entrance', label: 'Entrance' },
  { value: 'parking', label: 'Parking' },
  { value: 'warehouse', label: 'Warehouse' },
]

const STATUS_OPTIONS: { value: CameraFilterStatus; label: string }[] = [
  { value: 'all', label: 'All Status' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
]

export function CameraListPanel({
  cameras,
  stats,
  loading,
  selectedCameraId,
  onSelectCamera,
  categoryFilter,
  onCategoryFilterChange,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
  onRefresh,
  onToggleFavorite,
}: CameraListPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  // Create unique key for virtualizer that changes when filters change
  const virtualizerKey = useMemo(() => {
    return `${categoryFilter}-${statusFilter}-${searchQuery}`
  }, [categoryFilter, statusFilter, searchQuery])

  // Virtual list setup
  const virtualizer = useVirtualizer({
    count: cameras.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CAMERA_CARD_HEIGHT,
    overscan: 5,
    getItemKey: (index) => cameras[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Scroll to top when filters change
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0
    }
  }, [virtualizerKey])

  // Handle favorite toggle
  const handleToggleFavorite = useCallback(
    (camera: Camera, e: React.MouseEvent) => {
      e.stopPropagation()
      onToggleFavorite(camera.id, !camera.is_favorite)
    },
    [onToggleFavorite]
  )

  return (
    <Card className='flex h-full flex-col'>
      <CardHeader className='space-y-4 pb-4'>
        <div className='flex items-center justify-between'>
          <div>
            <CardTitle className='text-lg'>Cameras</CardTitle>
            <p className='text-muted-foreground mt-1 text-xs'>
              {cameras.length} of {stats.total} cameras
            </p>
          </div>
          <Button
            variant={loading ? 'default' : 'outline'}
            size={loading ? 'sm' : 'icon'}
            onClick={onRefresh}
            disabled={loading}
            className={cn(
              'transition-all duration-300',
              loading &&
                'bg-primary/90 hover:bg-primary/90 text-primary-foreground min-w-[100px]'
            )}
          >
            <IconRefresh className={cn('h-4 w-4', loading && 'animate-spin')} />
            {loading && <span className='ml-2 text-sm'>Syncing...</span>}
          </Button>
        </div>

        {/* Search Input */}
        <div className='relative'>
          <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search cameras...'
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className='pl-9'
          />
        </div>

        {/* Filters Row */}
        <div className='flex items-center gap-2'>
          <Select
            value={categoryFilter}
            onValueChange={(v) => onCategoryFilterChange(v as CameraCategory)}
          >
            <SelectTrigger className='flex-1'>
              <SelectValue placeholder='Category' />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(v) => onStatusFilterChange(v as CameraFilterStatus)}
          >
            <SelectTrigger className='w-32'>
              <SelectValue placeholder='Status' />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Mini Stats Row */}
        <div className='text-muted-foreground flex items-center gap-4 py-1 text-xs'>
          <div className='flex items-center gap-1.5'>
            <IconVideo className='h-3.5 w-3.5 text-green-500' />
            <span className='text-foreground font-semibold'>
              {stats.online}
            </span>
            <span>Online</span>
          </div>
          <div className='bg-border h-3 w-px' />
          <div className='flex items-center gap-1.5'>
            <IconVideoOff className='h-3.5 w-3.5 text-red-500' />
            <span className='text-foreground font-semibold'>
              {stats.offline}
            </span>
            <span>Offline</span>
          </div>
          <div className='bg-border h-3 w-px' />
          <div className='flex items-center gap-1.5'>
            <span className='relative flex h-2 w-2'>
              <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75' />
              <span className='relative inline-flex h-2 w-2 rounded-full bg-red-500' />
            </span>
            <span className='text-foreground font-semibold'>
              {stats.recording}
            </span>
            <span>Recording</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className='flex-1 overflow-hidden p-0'>
        {/* Virtual Scroll Container */}
        <div
          ref={parentRef}
          className='h-[calc(100vh-420px)] overflow-auto px-4'
        >
          {loading && cameras.length === 0 ? (
            <div className='space-y-2 pb-4'>
              {Array.from({ length: 5 }).map((_, i) => (
                <CameraCardSkeleton key={i} />
              ))}
            </div>
          ) : cameras.length === 0 ? (
            <div className='text-muted-foreground py-12 text-center'>
              <IconCamera className='mx-auto mb-3 h-12 w-12 opacity-40' />
              <p className='font-medium'>No cameras found</p>
              <p className='text-sm'>
                {searchQuery
                  ? 'Try adjusting your search'
                  : 'No cameras match the current filters'}
              </p>
            </div>
          ) : (
            <div
              key={virtualizerKey}
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualItem) => {
                const camera = cameras[virtualItem.index]
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <CameraCard
                      camera={camera}
                      isSelected={selectedCameraId === camera.id}
                      onClick={() => onSelectCamera(camera.id)}
                      onToggleFavorite={(e) => handleToggleFavorite(camera, e)}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Individual Camera Card
interface CameraCardProps {
  camera: Camera
  isSelected: boolean
  onClick: () => void
  onToggleFavorite: (e: React.MouseEvent) => void
}

function CameraCard({
  camera,
  isSelected,
  onClick,
  onToggleFavorite,
}: CameraCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'mb-2 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all',
        'hover:border-primary/50 hover:bg-accent/50',
        isSelected
          ? 'border-primary bg-primary/5 ring-primary/20 ring-1'
          : 'border-border bg-card'
      )}
    >
      {/* Thumbnail */}
      <div className='bg-muted relative h-10 w-16 flex-shrink-0 overflow-hidden rounded'>
        {camera.thumbnail_url && camera.status !== 'offline' ? (
          <img
            src={camera.thumbnail_url}
            alt={camera.name}
            className='h-full w-full object-cover'
          />
        ) : (
          <div className='flex h-full w-full items-center justify-center'>
            <IconCamera className='text-muted-foreground h-5 w-5' />
          </div>
        )}
        {/* Recording indicator */}
        {camera.status === 'recording' && (
          <div className='absolute top-1 right-1'>
            <span className='relative flex h-2 w-2'>
              <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75' />
              <span className='relative inline-flex h-2 w-2 rounded-full bg-red-500' />
            </span>
          </div>
        )}
      </div>

      {/* Camera Info */}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center justify-between'>
          <h4 className='truncate text-sm font-semibold'>{camera.name}</h4>
          <button
            onClick={onToggleFavorite}
            className={cn(
              'hover:bg-accent rounded p-0.5 transition-colors',
              camera.is_favorite ? 'text-yellow-500' : 'text-muted-foreground'
            )}
          >
            {camera.is_favorite ? (
              <IconStarFilled className='h-4 w-4' />
            ) : (
              <IconStar className='h-4 w-4' />
            )}
          </button>
        </div>
        <p className='text-muted-foreground truncate text-xs'>
          {camera.location}
        </p>
        <div className='mt-1 flex items-center justify-between'>
          <CameraStatusBadge status={camera.status} size='sm' />
          {camera.ptz_capable && (
            <span className='text-muted-foreground text-xs'>PTZ</span>
          )}
        </div>
      </div>
    </div>
  )
}

// Skeleton loader
function CameraCardSkeleton() {
  return (
    <div className='border-border bg-card mb-2 flex items-center gap-3 rounded-lg border p-3'>
      <Skeleton className='h-10 w-16 rounded' />
      <div className='flex-1'>
        <div className='mb-1 flex items-center justify-between'>
          <Skeleton className='h-4 w-24' />
          <Skeleton className='h-4 w-4 rounded' />
        </div>
        <Skeleton className='mb-1 h-3 w-32' />
        <Skeleton className='h-5 w-14' />
      </div>
    </div>
  )
}
