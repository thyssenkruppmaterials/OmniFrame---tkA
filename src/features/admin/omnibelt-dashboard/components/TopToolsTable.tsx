// Created and developed by Jai Singh
/**
 * TopToolsTable — top N tools by event_count from the 24h MV.
 *
 * Wrapped in a Card so it slots into the Overview grid as a tile.
 */
import { useMemo } from 'react'
import { IconChartBar } from '@tabler/icons-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TOOL_REGISTRY } from '@/features/omnibelt/tools/registry'

interface BucketRow {
  event_type: string | null
  event_count: number | null
  user_count: number | null
  tool_id: string | null
}

interface TopToolsTableProps {
  buckets: BucketRow[]
  limit?: number
  eventType?: string
  isLoading?: boolean
}

export function TopToolsTable({
  buckets,
  limit = 6,
  eventType = 'tool_launch',
  isLoading,
}: TopToolsTableProps) {
  const labels = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of TOOL_REGISTRY) map.set(t.id, t.label)
    return map
  }, [])

  const rows = useMemo(() => {
    const counts = new Map<string, { events: number; users: number }>()
    for (const b of buckets) {
      if (b.event_type !== eventType) continue
      const id = b.tool_id ?? ''
      if (!id) continue
      const prev = counts.get(id) ?? { events: 0, users: 0 }
      prev.events += Number(b.event_count ?? 0)
      prev.users = Math.max(prev.users, Number(b.user_count ?? 0))
      counts.set(id, prev)
    }
    return Array.from(counts.entries())
      .map(([id, v]) => ({ id, label: labels.get(id) ?? id, ...v }))
      .sort((a, b) => b.events - a.events)
      .slice(0, limit)
  }, [buckets, eventType, labels, limit])

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <IconChartBar size={16} aria-hidden /> Top tools (24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className='h-40 w-full rounded' />
        ) : rows.length === 0 ? (
          <p className='text-muted-foreground text-xs'>
            No <code>{eventType}</code> events yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead className='text-right'>Events</TableHead>
                <TableHead className='text-right'>Users</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className='flex flex-col leading-tight'>
                      <span>{r.label}</span>
                      <code className='text-muted-foreground text-[10px]'>
                        {r.id}
                      </code>
                    </div>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {r.events.toLocaleString()}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {r.users.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// Created and developed by Jai Singh
