/**
 * Ticket Status Filter Component
 *
 * Filter tabs for ticket list (All/Open/In Progress/etc.)
 */
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
}[] = [
  { value: 'all', label: 'All', countKey: 'total' },
  { value: 'open', label: 'Open', countKey: 'open' },
  { value: 'in_progress', label: 'Active', countKey: 'inProgress' },
  { value: 'resolved', label: 'Resolved', countKey: 'resolved' },
]

export function TicketStatusFilter({
  value,
  onChange,
  stats,
}: TicketStatusFilterProps) {
  return (
    <div className='flex space-x-1 border-b'>
      {filterOptions.map((option) => {
        const count =
          stats && option.countKey ? stats[option.countKey] : undefined
        const isActive = value === option.value

        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative px-4 py-2 text-sm font-medium transition-colors',
              'hover:text-foreground',
              isActive
                ? 'text-foreground border-primary -mb-[2px] border-b-2'
                : 'text-muted-foreground'
            )}
          >
            {option.label}
            {count !== undefined && typeof count === 'number' && count > 0 && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-xs',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
