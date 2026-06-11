// Created and developed by Jai Singh
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface TvClockProps {
  timezone: string
  className?: string
}

export function TvClock({ timezone, className }: TvClockProps) {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const time = new Intl.DateTimeFormat([], {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now)

  const date = new Intl.DateTimeFormat([], {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(now)

  return (
    <div className={cn('flex flex-col items-end leading-none', className)}>
      <span className='text-foreground font-mono text-4xl font-semibold tabular-nums'>
        {time}
      </span>
      <span className='text-muted-foreground mt-1 text-sm'>
        {date} · {timezone.split('/').pop()?.replace(/_/g, ' ')}
      </span>
    </div>
  )
}

// Created and developed by Jai Singh
