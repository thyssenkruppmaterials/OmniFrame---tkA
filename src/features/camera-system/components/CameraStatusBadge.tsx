// Created and developed by Jai Singh
/**
 * Camera Status Badge Component
 *
 * Displays camera status with appropriate styling:
 * - Green for online
 * - Red for offline
 * - Animated pulse for recording
 */
import { cn } from '@/lib/utils'
import type { CameraStatus } from '../types/camera.types'

interface CameraStatusBadgeProps {
  status: CameraStatus
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const statusConfig: Record<
  CameraStatus,
  { label: string; bgColor: string; textColor: string; dotColor: string }
> = {
  online: {
    label: 'Online',
    bgColor: 'bg-green-500/10',
    textColor: 'text-green-600 dark:text-green-400',
    dotColor: 'bg-green-500',
  },
  offline: {
    label: 'Offline',
    bgColor: 'bg-red-500/10',
    textColor: 'text-red-600 dark:text-red-400',
    dotColor: 'bg-red-500',
  },
  recording: {
    label: 'Recording',
    bgColor: 'bg-red-500/10',
    textColor: 'text-red-600 dark:text-red-400',
    dotColor: 'bg-red-500',
  },
  error: {
    label: 'Error',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-600 dark:text-amber-400',
    dotColor: 'bg-amber-500',
  },
}

const sizeConfig = {
  sm: {
    badge: 'px-1.5 py-0.5 text-xs gap-1',
    dot: 'h-1.5 w-1.5',
  },
  md: {
    badge: 'px-2 py-1 text-xs gap-1.5',
    dot: 'h-2 w-2',
  },
  lg: {
    badge: 'px-2.5 py-1.5 text-sm gap-2',
    dot: 'h-2.5 w-2.5',
  },
}

export function CameraStatusBadge({
  status,
  showLabel = true,
  size = 'md',
  className,
}: CameraStatusBadgeProps) {
  const config = statusConfig[status]
  const sizeStyles = sizeConfig[size]
  const isRecording = status === 'recording'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        config.bgColor,
        config.textColor,
        sizeStyles.badge,
        className
      )}
    >
      <span className='relative flex'>
        <span
          className={cn(
            'rounded-full',
            config.dotColor,
            sizeStyles.dot,
            isRecording && 'animate-pulse'
          )}
        />
        {isRecording && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              config.dotColor
            )}
          />
        )}
      </span>
      {showLabel && <span>{config.label}</span>}
    </span>
  )
}

// Created and developed by Jai Singh
