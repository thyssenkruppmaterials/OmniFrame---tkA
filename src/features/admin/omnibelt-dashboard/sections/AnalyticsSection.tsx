// Created and developed by Jai Singh
/**
 * AnalyticsSection — telemetry-heavy v1-rich tab.
 *
 * Five surfaces, each its own card:
 *   1. Top tools sparklines  — per-tool 24h line chart, small repeats
 *   2. Event heatmap         — hour-of-day × event_type density
 *   3. Skin distribution pie — counts by chosen skin (best-effort)
 *   4. Usage funnel          — belt_visible → panel_open → tool_launch
 *   5. Recent activity feed  — last 50 raw events scrollable list
 *
 * All reads via `supabaseRead`; refetch on 60s when visible (gated
 * by `useUsageStats`). No new Supabase realtime channels.
 */
import { useMemo } from 'react'
import { IconActivity } from '@tabler/icons-react'
import type { OmnibeltToolEvent } from '@/lib/supabase/database.types'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { TOOL_REGISTRY } from '@/features/omnibelt/tools/registry'
import { EventHeatmap } from '../components/EventHeatmap'
import { SkinDistributionPie } from '../components/SkinDistributionPie'
import { UsageFunnel } from '../components/UsageFunnel'
import { UsageSparkline } from '../components/UsageSparkline'
import {
  useEvents24h,
  usePrefsAggregate,
  useRecentEvents,
} from '../hooks/useUsageStats'

export function AnalyticsSection() {
  const events24h = useEvents24h()
  const recent = useRecentEvents(50)
  const prefs = usePrefsAggregate()

  const sparkData = useMemo(
    () => bucketByTool(events24h.data ?? []),
    [events24h.data]
  )

  const funnelData = useMemo(() => {
    const buckets = events24h.data ?? []
    let visible = 0
    let opens = 0
    let launches = 0
    for (const row of buckets) {
      const count = row.event_count ?? 0
      if (row.event_type === 'belt_visible') visible += count
      else if (row.event_type === 'panel_open') opens += count
      else if (row.event_type === 'tool_launch') launches += count
    }
    return { visible, opens, launches }
  }, [events24h.data])

  return (
    <div className='grid gap-4 xl:grid-cols-3'>
      <Card className='xl:col-span-2'>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>
            Top tools — 24h sparklines
          </CardTitle>
          <CardDescription>
            Hourly launch counts per tool from
            <code className='mx-1'>omnibelt_tool_events_24h_mv</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events24h.isLoading ? (
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className='h-20 w-full rounded-md' />
              ))}
            </div>
          ) : (
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              {TOOL_REGISTRY.map((tool) => (
                <UsageSparkline
                  key={tool.id}
                  toolLabel={tool.label}
                  hourlyCounts={sparkData[tool.id] ?? []}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>Usage funnel (24h)</CardTitle>
          <CardDescription>
            belt_visible → panel_open → tool_launch conversion.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsageFunnel
            visible={funnelData.visible}
            opens={funnelData.opens}
            launches={funnelData.launches}
            isLoading={events24h.isLoading}
          />
        </CardContent>
      </Card>

      <Card className='xl:col-span-2'>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>Event heatmap</CardTitle>
          <CardDescription>
            Event volume by hour-of-day from the 24h MV.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EventHeatmap
            buckets={events24h.data ?? []}
            isLoading={events24h.isLoading}
          />
        </CardContent>
      </Card>

      <SkinDistributionPie
        distribution={prefs.data?.skinDistribution ?? {}}
        isLoading={prefs.isLoading}
      />

      <Card className='xl:col-span-3'>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <IconActivity size={16} aria-hidden /> Recent activity (last 50)
          </CardTitle>
          <CardDescription>
            Tail of <code>omnibelt_tool_events</code>. Refreshes every 30
            seconds while the tab is visible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recent.isLoading ? (
            <div className='space-y-2'>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className='h-8 w-full rounded' />
              ))}
            </div>
          ) : (
            <ScrollArea className='h-72 rounded-md border'>
              <ul className='divide-border divide-y'>
                {(recent.data ?? []).map((event) => (
                  <RecentEventRow key={event.id} event={event} />
                ))}
                {(recent.data ?? []).length === 0 && (
                  <li className='text-muted-foreground p-4 text-sm'>
                    No events yet.
                  </li>
                )}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface RecentEventRowProps {
  event: OmnibeltToolEvent
}

function RecentEventRow({ event }: RecentEventRowProps) {
  return (
    <li className='grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-sm'>
      <span className='text-muted-foreground text-xs tabular-nums'>
        {formatTime(event.occurred_at)}
      </span>
      <span className='truncate'>
        <span className='font-medium'>{event.event_type}</span>
        <span className='text-muted-foreground mx-2'>·</span>
        <code className='text-xs'>{event.tool_id}</code>
      </span>
      <span className='text-muted-foreground text-xs tabular-nums'>
        {event.user_id ? event.user_id.slice(0, 8) : '—'}
      </span>
    </li>
  )
}

interface Bucket {
  tool_id: string | null
  event_type: string | null
  bucket_hour: string | null
  event_count: number | null
}

/**
 * Reshape MV rows into per-tool [{ hour, count }] arrays suitable
 * for the sparkline component. Only `tool_launch` rows are counted —
 * the sparkline represents tool engagement, not panel opens.
 */
function bucketByTool(
  rows: Bucket[]
): Record<string, Array<{ hour: string; count: number }>> {
  const result: Record<string, Array<{ hour: string; count: number }>> = {}
  for (const row of rows) {
    if (row.event_type !== 'tool_launch') continue
    const id = row.tool_id ?? '__unknown__'
    const list = result[id] ?? []
    list.push({
      hour: row.bucket_hour ?? '',
      count: row.event_count ?? 0,
    })
    result[id] = list
  }
  for (const id of Object.keys(result)) {
    result[id].sort((a, b) => a.hour.localeCompare(b.hour))
  }
  return result
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// Created and developed by Jai Singh
