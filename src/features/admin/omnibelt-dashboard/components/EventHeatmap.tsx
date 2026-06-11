// Created and developed by Jai Singh
/**
 * EventHeatmap — hour-of-day × day-of-week heatmap.
 *
 * Renders panel_open events bucketed by date + hour. Each cell's
 * background intensity scales with `event_count`.
 */
import { useMemo } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

interface EventBucketRow {
  event_type: string | null
  event_count: number | null
  bucket_hour: string | null
}

interface EventHeatmapProps {
  buckets: EventBucketRow[]
  eventType?: string
  isLoading?: boolean
}

export function EventHeatmap({
  buckets,
  eventType = 'panel_open',
  isLoading,
}: EventHeatmapProps) {
  const { matrix, hours, days, max } = useMemo(
    () => buildMatrix(buckets, eventType),
    [buckets, eventType]
  )

  if (isLoading) {
    return <Skeleton className='h-48 w-full rounded' />
  }

  if (max === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        No <code>{eventType}</code> events in the last 24h.
      </p>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='text-muted-foreground text-[11px]'>
        Hour-of-day × day. Darker = more {eventType} events.
      </div>
      <div
        className='grid gap-px'
        style={{
          gridTemplateColumns: `auto repeat(${hours.length}, minmax(0, 1fr))`,
        }}
      >
        <div />
        {hours.map((h) => (
          <div key={h} className='text-muted-foreground text-center text-[9px]'>
            {h.toString().padStart(2, '0')}
          </div>
        ))}
        {days.map((day) => (
          <Row key={day} day={day} hours={hours} matrix={matrix} max={max} />
        ))}
      </div>
    </div>
  )
}

function Row({
  day,
  hours,
  matrix,
  max,
}: {
  day: string
  hours: number[]
  matrix: Map<string, Map<number, number>>
  max: number
}) {
  const row = matrix.get(day)
  return (
    <>
      <div className='text-muted-foreground text-[10px]'>
        {formatDayLabel(day)}
      </div>
      {hours.map((h) => {
        const v = row?.get(h) ?? 0
        const intensity = max > 0 ? v / max : 0
        const bg = `color-mix(in srgb, var(--primary) ${Math.round(
          intensity * 100
        )}%, transparent)`
        return (
          <div
            key={`${day}-${h}`}
            className='border-border/30 aspect-square min-w-[14px] rounded-sm border'
            style={{ background: bg }}
            title={`${formatDayLabel(day)} ${h}:00 — ${v} events`}
          />
        )
      })}
    </>
  )
}

function buildMatrix(
  buckets: EventBucketRow[],
  eventType: string
): {
  matrix: Map<string, Map<number, number>>
  hours: number[]
  days: string[]
  max: number
} {
  const matrix = new Map<string, Map<number, number>>()
  const dayKeys = new Set<string>()
  let max = 0
  for (const b of buckets) {
    if (b.event_type !== eventType || !b.bucket_hour) continue
    const date = new Date(b.bucket_hour)
    const dayKey = date.toISOString().slice(0, 10)
    const hour = date.getHours()
    dayKeys.add(dayKey)
    const inner = matrix.get(dayKey) ?? new Map<number, number>()
    const v = (inner.get(hour) ?? 0) + Number(b.event_count ?? 0)
    inner.set(hour, v)
    matrix.set(dayKey, inner)
    if (v > max) max = v
  }
  const days = Array.from(dayKeys).sort()
  const hours = Array.from({ length: 24 }, (_, i) => i)
  return { matrix, hours, days, max }
}

function formatDayLabel(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`)
    return d.toLocaleDateString([], { weekday: 'short', day: '2-digit' })
  } catch {
    return iso
  }
}

// Created and developed by Jai Singh
