/**
 * PresenceAvatar - Avatar with overlaid presence status dot
 * Teams-style: avatar with colored dot in bottom-right corner
 */
import type { PresenceStatus } from '@/lib/presence/types'
import { cn } from '@/lib/utils'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { StatusIndicator } from './status-indicator'

interface PresenceAvatarProps {
  src?: string | null
  fallback: string // initials
  alt?: string
  status: PresenceStatus
  size?: 'sm' | 'md' | 'lg'
  showStatus?: boolean
  className?: string
}

const avatarSizes = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
}

const dotSizeMap: Record<string, 'xs' | 'sm' | 'md'> = {
  sm: 'xs',
  md: 'sm',
  lg: 'md',
}

const dotPositions = {
  sm: '-bottom-0.5 -right-0.5',
  md: '-bottom-0.5 -right-0.5',
  lg: '-bottom-0 -right-0',
}

export function PresenceAvatar({
  src,
  fallback,
  alt,
  status,
  size = 'md',
  showStatus = true,
  className,
}: PresenceAvatarProps) {
  return (
    <div className={cn('relative inline-flex', className)}>
      <Avatar className={cn(avatarSizes[size], 'rounded-lg')}>
        {src && <AvatarImage src={src} alt={alt || fallback} />}
        <AvatarFallback className='rounded-lg text-xs'>
          {fallback}
        </AvatarFallback>
      </Avatar>
      {showStatus && status !== 'offline' && (
        <span className={cn('absolute', dotPositions[size])}>
          <StatusIndicator
            status={status}
            size={dotSizeMap[size]}
            showTooltip={false}
          />
        </span>
      )}
    </div>
  )
}
