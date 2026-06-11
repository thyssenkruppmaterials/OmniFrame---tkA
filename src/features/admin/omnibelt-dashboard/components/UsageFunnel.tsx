// Created and developed by Jai Singh
/**
 * UsageFunnel — belt_visible → panel_open → tool_launch conversion.
 *
 * Counts are passed in pre-aggregated so the section owns the
 * MV-traversal pass (cheaper for caching and avoids re-traversal
 * on each tab re-render).
 */
import { Skeleton } from '@/components/ui/skeleton'

interface UsageFunnelProps {
  visible: number
  opens: number
  launches: number
  isLoading?: boolean
}

export function UsageFunnel({
  visible,
  opens,
  launches,
  isLoading,
}: UsageFunnelProps) {
  if (isLoading) {
    return (
      <div className='space-y-2'>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className='h-10 w-full rounded' />
        ))}
      </div>
    )
  }

  const stages = [
    { id: 'belt_visible', label: 'Belt visible', count: visible },
    { id: 'panel_open', label: 'Panel opened', count: opens },
    { id: 'tool_launch', label: 'Tool launched', count: launches },
  ]
  const top = stages[0].count

  if (top === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        No funnel data yet — telemetry not ingesting <code>belt_visible</code>{' '}
        events in the last 24h.
      </p>
    )
  }

  return (
    <ul className='space-y-2'>
      {stages.map((s, i) => {
        const prev = i === 0 ? null : stages[i - 1].count
        const pct = prev && prev > 0 ? Math.round((s.count / prev) * 100) : null
        const widthPct = top > 0 ? Math.max(4, (s.count / top) * 100) : 0
        return (
          <li key={s.id} className='space-y-1'>
            <div className='flex items-center justify-between text-xs'>
              <span className='font-medium'>{s.label}</span>
              <span className='text-muted-foreground'>
                {s.count.toLocaleString()}{' '}
                {pct !== null && (
                  <span className='ml-2'>({pct}% of previous)</span>
                )}
              </span>
            </div>
            <div className='bg-muted h-3 overflow-hidden rounded-full'>
              <div
                className='bg-primary h-full rounded-full transition-all'
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// Created and developed by Jai Singh
