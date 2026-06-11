// Created and developed by Jai Singh
import { cn } from '@/lib/utils'
import type { TicketFilterStatus, TicketStats } from '../types'

interface TicketStatusFilterProps {
  value: TicketFilterStatus
  onChange: (value: TicketFilterStatus) => void
  stats?: TicketStats
}

const filterOptions: {
  value: TicketFilterStatus
  label: string
  countKey?: keyof TicketStats
  dot?: string
}[] = [
  { value: 'all', label: 'All', countKey: 'total' },
  { value: 'open', label: 'Open', countKey: 'open', dot: 'bg-blue-500' },
  {
    value: 'in_progress',
    label: 'Active',
    countKey: 'inProgress',
    dot: 'bg-purple-500',
  },
  {
    value: 'resolved',
    label: 'Resolved',
    countKey: 'resolved',
    dot: 'bg-emerald-500',
  },
]

export function TicketStatusFilter({
  value,
  onChange,
  stats,
}: TicketStatusFilterProps) {
  return (
    <div className='bg-muted/50 flex gap-1 rounded-lg p-1'>
      {filterOptions.map((option) => {
        const count =
          stats && option.countKey ? stats[option.countKey] : undefined
        const isActive = value === option.value

        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
            )}
          >
            {option.dot && (
              <span className={cn('h-1.5 w-1.5 rounded-full', option.dot)} />
            )}
            {option.label}
            {count !== undefined && typeof count === 'number' && (
              <span
                className={cn(
                  'text-[10px] tabular-nums',
                  isActive
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/60'
                )}
              >
                {count.toLocaleString()}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// Created and developed by Jai Singh
