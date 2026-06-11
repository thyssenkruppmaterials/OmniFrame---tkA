// Created and developed by Jai Singh
import { cn } from '@/lib/utils'

interface TelemetryFreshnessBadgeProps {
  lastCheckinAt: string | null
}

export function TelemetryFreshnessBadge({
  lastCheckinAt,
}: TelemetryFreshnessBadgeProps) {
  if (!lastCheckinAt) {
    return (
      <span className='bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'>
        No data
      </span>
    )
  }

  const now = Date.now()
  const checkin = new Date(lastCheckinAt).getTime()
  const diffMinutes = (now - checkin) / 1000 / 60

  let label: string
  let colorClass: string

  if (diffMinutes < 5) {
    label = 'Live'
    colorClass =
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
  } else if (diffMinutes < 60) {
    label = `${Math.round(diffMinutes)}m ago`
    colorClass =
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
  } else if (diffMinutes < 1440) {
    label = `${Math.round(diffMinutes / 60)}h ago`
    colorClass =
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
  } else {
    label = `${Math.round(diffMinutes / 1440)}d ago`
    colorClass = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        colorClass
      )}
    >
      {label}
    </span>
  )
}

// Created and developed by Jai Singh
