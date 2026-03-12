/**
 * StatusIndicator - Small colored dot showing presence status
 * Can be used standalone or composed with Avatar
 */
import {
  PRESENCE_STATUS_CONFIG,
  type PresenceStatus,
} from '@/lib/presence/types'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface StatusIndicatorProps {
  status: PresenceStatus
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showTooltip?: boolean
  pulse?: boolean
  className?: string
}

const sizeClasses = {
  xs: 'h-2 w-2',
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
}

export function StatusIndicator({
  status,
  size = 'sm',
  showTooltip = true,
  pulse = false,
  className,
}: StatusIndicatorProps) {
  const config = PRESENCE_STATUS_CONFIG[status]

  const dot = (
    <span
      className={cn(
        'border-background inline-block rounded-full border-2',
        sizeClasses[size],
        config.dotClass,
        pulse && status === 'online' && 'animate-pulse',
        className
      )}
      aria-label={config.label}
    />
  )

  if (!showTooltip) return dot

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{dot}</TooltipTrigger>
        <TooltipContent
          side='right'
          className='bg-popover text-popover-foreground border text-xs shadow-md'
        >
          <p className='font-semibold'>{config.label}</p>
          <p className='text-popover-foreground/60'>{config.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
