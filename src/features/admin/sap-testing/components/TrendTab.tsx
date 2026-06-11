// Created and developed by Jai Singh
/**
 * Trend tab for LL01 Warehouse Activity Monitor.
 */
import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  LL01_CATEGORY_META,
  LL01_PLANTS,
  type LL01CategoryKey,
  type LL01SnapshotRow,
} from './warehouse-activity-monitor-types'

const PLANT_COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#9333ea',
  '#dc2626',
  '#0891b2',
]

type DateRangeKey = '7d' | '30d' | '90d'

const RANGE_DAYS: Record<DateRangeKey, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

interface TrendTabProps {
  snapshots: LL01SnapshotRow[]
  selectedPlants: string[]
  onTogglePlant: (plant: string) => void
  onDrilldown?: (
    plant: string,
    category: LL01CategoryKey,
    ranAt: string
  ) => void
}

export function exportTrendCsv(rows: LL01SnapshotRow[]) {
  const header = 'ran_at,plant,category,count'
  const body = rows
    .map((r) => `${r.ran_at},${r.plant},${r.category},${r.count}`)
    .join('\n')
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'll01-trend.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function computeSpikeAlerts(snapshots: LL01SnapshotRow[]) {
  const byRun = new Map<string, LL01SnapshotRow[]>()
  for (const row of snapshots) {
    const key = row.snapshot_run_id ?? row.ran_at
    const list = byRun.get(key) ?? []
    list.push(row)
    byRun.set(key, list)
  }
  const runs = [...byRun.entries()].sort(
    (a, b) =>
      new Date(b[1][0]?.ran_at ?? 0).getTime() -
      new Date(a[1][0]?.ran_at ?? 0).getTime()
  )
  if (runs.length < 2) return []
  const [latestKey, latestRows] = runs[0]
  const [, priorRows] = runs[1]
  const priorMap = new Map(
    priorRows.map((r) => [`${r.plant}|${r.category}`, r.count])
  )
  const alerts: string[] = []
  for (const row of latestRows) {
    const prior = priorMap.get(`${row.plant}|${row.category}`)
    if (prior == null || prior === 0) continue
    const pct = ((row.count - prior) / prior) * 100
    if (pct > 50) {
      const label =
        LL01_CATEGORY_META.find((c) => c.key === row.category)?.label ??
        row.category
      alerts.push(
        `${label} at ${row.plant} grew ${pct.toFixed(0)}% (${prior.toLocaleString()} → ${row.count.toLocaleString()}) in the latest run.`
      )
    }
  }
  void latestKey
  return alerts
}

export function TrendTab({
  snapshots,
  selectedPlants,
  onTogglePlant,
  onDrilldown,
}: TrendTabProps) {
  const [range, setRange] = useState<DateRangeKey>('30d')

  const filtered = useMemo(() => {
    const cutoff = Date.now() - RANGE_DAYS[range] * 86400000
    return snapshots.filter(
      (s) =>
        selectedPlants.includes(s.plant) &&
        new Date(s.ran_at).getTime() >= cutoff
    )
  }, [snapshots, range, selectedPlants])

  const spikeAlerts = useMemo(() => computeSpikeAlerts(filtered), [filtered])

  const chartDataByCategory = useMemo(() => {
    const out: Record<LL01CategoryKey, Record<string, unknown>[]> =
      {} as Record<LL01CategoryKey, Record<string, unknown>[]>
    for (const meta of LL01_CATEGORY_META) {
      const runs = new Map<string, Record<string, unknown>>()
      for (const row of filtered.filter((s) => s.category === meta.key)) {
        const point = runs.get(row.ran_at) ?? { ran_at: row.ran_at }
        point[row.plant] = row.count
        const totalKey = '__total'
        point[totalKey] = Number(point[totalKey] ?? 0) + row.count
        runs.set(row.ran_at, point)
      }
      out[meta.key] = [...runs.values()].sort(
        (a, b) =>
          new Date(String(a.ran_at)).getTime() -
          new Date(String(b.ran_at)).getTime()
      )
    }
    return out
  }, [filtered])

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        {(['7d', '30d', '90d'] as DateRangeKey[]).map((key) => (
          <Button
            key={key}
            size='sm'
            variant={range === key ? 'default' : 'outline'}
            onClick={() => setRange(key)}
          >
            Last {RANGE_DAYS[key]} days
          </Button>
        ))}
        <div className='flex flex-wrap gap-1'>
          {LL01_PLANTS.map((plant) => (
            <Button
              key={plant}
              size='sm'
              variant={selectedPlants.includes(plant) ? 'default' : 'outline'}
              onClick={() => onTogglePlant(plant)}
            >
              {plant}
            </Button>
          ))}
        </div>
        <Button
          size='sm'
          variant='outline'
          onClick={() => exportTrendCsv(filtered)}
        >
          <Download className='mr-2 h-4 w-4' />
          Download CSV
        </Button>
      </div>

      {spikeAlerts.length > 0 && (
        <Card className='border-amber-500/40 bg-amber-500/5'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>Spike alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='list-disc space-y-1 pl-5 text-sm'>
              {spikeAlerts.map((alert, i) => (
                <li key={i}>{alert}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        {LL01_CATEGORY_META.map((meta) => {
          const data = chartDataByCategory[meta.key] ?? []
          return (
            <Card key={meta.key}>
              <CardHeader className='pb-2'>
                <CardTitle className='text-sm'>{meta.label}</CardTitle>
              </CardHeader>
              <CardContent className='h-56'>
                {data.length < 2 ? (
                  <p className='text-muted-foreground flex h-full items-center justify-center text-sm'>
                    Need at least 2 runs for trend
                  </p>
                ) : (
                  <ResponsiveContainer width='100%' height='100%'>
                    <LineChart data={data}>
                      <CartesianGrid strokeOpacity={0.06} />
                      <XAxis
                        dataKey='ran_at'
                        tickFormatter={(v) =>
                          new Date(v).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })
                        }
                        fontSize={11}
                      />
                      <YAxis fontSize={11} />
                      <Tooltip
                        labelFormatter={(v) =>
                          new Date(String(v)).toLocaleString()
                        }
                      />
                      <Legend />
                      {selectedPlants.map((plant, pIdx) => (
                        <Line
                          key={plant}
                          type='monotone'
                          dataKey={plant}
                          stroke={PLANT_COLORS[pIdx % PLANT_COLORS.length]}
                          dot={false}
                          strokeWidth={2}
                          onClick={(point: unknown) => {
                            // Recharts' Line onClick payload typing is loose;
                            // pull `payload.ran_at` defensively at runtime.
                            const p = point as
                              | { payload?: { ran_at?: unknown } }
                              | undefined
                            const ranAt = p?.payload?.ran_at
                            if (
                              onDrilldown &&
                              typeof ranAt !== 'undefined' &&
                              ranAt !== null
                            ) {
                              onDrilldown(plant, meta.key, String(ranAt))
                            }
                          }}
                        />
                      ))}
                      <Line
                        type='monotone'
                        dataKey='__total'
                        name='Total'
                        stroke='#64748b'
                        strokeDasharray='4 4'
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export { computeSpikeAlerts }

// Created and developed by Jai Singh
