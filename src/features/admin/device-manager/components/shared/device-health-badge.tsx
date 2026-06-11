// Created and developed by Jai Singh
import { cn } from '@/lib/utils'

interface DeviceHealthBadgeProps {
  score: number | null
  size?: 'sm' | 'md'
}

export function DeviceHealthBadge({
  score,
  size = 'md',
}: DeviceHealthBadgeProps) {
  if (score === null || score === undefined) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full font-medium',
          'bg-muted text-muted-foreground',
          size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'
        )}
      >
        N/A
      </span>
    )
  }

  const getColor = (s: number) => {
    if (s >= 80)
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    if (s >= 60)
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    if (s >= 40)
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        getColor(score),
        size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'
      )}
    >
      {Math.round(score)}
    </span>
  )
}

// Created and developed by Jai Singh
