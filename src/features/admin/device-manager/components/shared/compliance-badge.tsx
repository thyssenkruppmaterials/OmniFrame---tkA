// Created and developed by Jai Singh
import { cn } from '@/lib/utils'

interface ComplianceBadgeProps {
  compliant: boolean | null
}

export function ComplianceBadge({ compliant }: ComplianceBadgeProps) {
  if (compliant === null || compliant === undefined) {
    return (
      <span className='bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'>
        Unknown
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        compliant
          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      )}
    >
      {compliant ? 'Compliant' : 'Non-Compliant'}
    </span>
  )
}

// Created and developed by Jai Singh
