// Created and developed by Jai Singh
import { IconClockHour4 } from '@tabler/icons-react'
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BoardLegend } from './board-legend'

interface BoardHeaderProps {
  title: string
  description: string
  lastUpdatedAt: Date | null
  isFetching: boolean
  timezone: string
}

function formatLastUpdated(at: Date | null, timezone: string): string {
  if (!at) return '—'
  return at.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: timezone,
  })
}

export function BoardHeader({
  title,
  description,
  lastUpdatedAt,
  isFetching,
  timezone,
}: BoardHeaderProps) {
  return (
    <CardHeader className='pb-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-center gap-3'>
          <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10'>
            <IconClockHour4 className='h-5 w-5 text-emerald-500' />
          </div>
          <div>
            <CardTitle className='text-base'>{title}</CardTitle>
            <CardDescription className='text-xs'>{description}</CardDescription>
          </div>
        </div>
        <div className='text-muted-foreground flex items-center gap-2 text-[10px]'>
          {isFetching ? (
            <span className='inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500' />
          ) : (
            <span className='inline-block h-1.5 w-1.5 rounded-full bg-emerald-500/40' />
          )}
          <span className='font-mono'>
            Updated {formatLastUpdated(lastUpdatedAt, timezone)}
          </span>
        </div>
      </div>
      <BoardLegend className='mt-3' />
    </CardHeader>
  )
}

// Created and developed by Jai Singh
