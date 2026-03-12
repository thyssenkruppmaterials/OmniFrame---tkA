import { cn } from '@/lib/utils'
import type { DeviceStatus } from '../../types/device-manager.types'

interface DeviceStatusDotProps {
  status: DeviceStatus
  showLabel?: boolean
  size?: 'sm' | 'md'
}

const STATUS_CONFIG: Record<
  DeviceStatus,
  { color: string; pulse: boolean; label: string }
> = {
  Online: { color: 'bg-green-500', pulse: true, label: 'Online' },
  Offline: { color: 'bg-gray-400', pulse: false, label: 'Offline' },
  Pending: { color: 'bg-yellow-500', pulse: true, label: 'Pending' },
  Lost: { color: 'bg-red-500', pulse: true, label: 'Lost' },
  Wiped: { color: 'bg-red-800', pulse: false, label: 'Wiped' },
  Retired: { color: 'bg-gray-600', pulse: false, label: 'Retired' },
}

export function DeviceStatusDot({
  status,
  showLabel = false,
  size = 'md',
}: DeviceStatusDotProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.Offline

  return (
    <span className='inline-flex items-center gap-1.5'>
      <span className='relative flex'>
        <span
          className={cn(
            'rounded-full',
            config.color,
            size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5',
            config.pulse && 'animate-pulse'
          )}
        />
      </span>
      {showLabel && (
        <span className='text-muted-foreground text-xs font-medium'>
          {config.label}
        </span>
      )}
    </span>
  )
}
