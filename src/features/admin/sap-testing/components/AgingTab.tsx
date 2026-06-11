// Created and developed by Jai Singh
/**
 * Aging tab for LL01 Warehouse Activity Monitor (2026-05-27).
 *
 * Three cards, all derived from the existing `result.categories[i].rows`
 * payload via `useMemo` — no second fetch (per the task's TanStack
 * directive). Bucket math lives in `bucketizeLL01Aging` so it's testable
 * in isolation; quarter labels via `ll01QuarterLabel`.
 *
 *   1. Plant × Aging-Bucket grid — cumulative `>30`/`>60`/`>90`. The
 *      cumulative semantics are documented in
 *      Patterns/LL01-Aging-Breakdown.md.
 *   2. Quarter trend — items per `YYYY-Qn` (oldest → newest). The pill
 *      above the section surfaces the actual data span.
 *   3. User breakdown — top-N user IDs for categories that expose one;
 *      `LL01_USER_FIELD[key] === null` renders a clear "Not available"
 *      placeholder.
 *
 * Falls back to a "Re-run on a current agent build" hint when the run's
 * `payload_version < 2` (older agents that pre-date the additive
 * `created_on` columns).
 */
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  LL01_AGING_DATE_KEY,
  LL01_CATEGORY_META,
  LL01_PLANTS,
  LL01_USER_FIELD,
  bucketizeLL01Aging,
  ll01QuarterLabel,
  ll01QuarterSortKey,
  type LL01CategoryKey,
  type LL01RunResult,
} from './warehouse-activity-monitor-types'

const PLANT_COLORS = [
  '#2563eb', // blue-600
  '#16a34a', // green-600
  '#d97706', // amber-600
  '#9333ea', // purple-600
  '#dc2626', // red-600
]

const BUCKET_BADGE: Record<'low' | 'mid' | 'high', string> = {
  low: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  mid: 'bg-amber-500/15 text-amber-800 border-amber-500/30',
  high: 'bg-red-500/15 text-red-700 border-red-500/30',
}

function severityFor(count: number, total: number): 'low' | 'mid' | 'high' {
  if (count === 0 || total === 0) return 'low'
  const pct = count / total
  if (pct < 0.05) return 'low'
  if (pct < 0.2) return 'mid'
  return 'high'
}

interface AgingTabProps {
  result: LL01RunResult | null
  selectedPlants: string[]
  onTogglePlant: (plant: string) => void
}

export function AgingTab({
  result,
  selectedPlants,
  onTogglePlant,
}: AgingTabProps) {
  const [categoryKey, setCategoryKey] = useState<LL01CategoryKey>('open_to')

  const meta = useMemo(
    () =>
      LL01_CATEGORY_META.find((c) => c.key === categoryKey) ??
      LL01_CATEGORY_META[0],
    [categoryKey]
  )

  const plants = useMemo(() => {
    // Treat an empty `plants` (failed/result-less run) the same as missing —
    // fall back to the default list so the grid never collapses.
    const base =
      result?.plants && result.plants.length > 0
        ? result.plants
        : [...LL01_PLANTS]
    return base.filter((p) => selectedPlants.includes(p))
  }, [result?.plants, selectedPlants])

  const category = useMemo(
    () => result?.categories?.find((c) => c.key === categoryKey) ?? null,
    [result, categoryKey]
  )

  const anchorKey = LL01_AGING_DATE_KEY[categoryKey]
  const userField = LL01_USER_FIELD[categoryKey]

  // Bucket counts per plant — `>30` / `>60` / `>90` cumulative.
  const bucketsByPlant = useMemo(() => {
    const out = new Map<string, ReturnType<typeof bucketizeLL01Aging>>()
    if (!category) return out
    for (const plant of plants) {
      const slice = (category.rows ?? []).filter(
        (r) => String(r._plant ?? '') === plant
      )
      out.set(plant, bucketizeLL01Aging(slice, anchorKey))
    }
    return out
  }, [category, plants, anchorKey])

  // Quarter axis: aggregate counts per (quarter × plant) for the chart,
  // and surface the overall span (oldest → newest quarter present).
  const { quarterChart, quarterSpan } = useMemo(() => {
    const perQuarter = new Map<string, Record<string, number | string>>()
    if (!category) {
      return {
        quarterChart: [] as Record<string, number | string>[],
        quarterSpan: null as { oldest: string; newest: string } | null,
      }
    }
    let oldestKey = Number.POSITIVE_INFINITY
    let newestKey = Number.NEGATIVE_INFINITY
    let oldestLabel: string | null = null
    let newestLabel: string | null = null
    for (const row of category.rows ?? []) {
      const plant = String(row._plant ?? '')
      if (!plants.includes(plant)) continue
      const label = ll01QuarterLabel(row[anchorKey])
      if (!label) continue
      const sortKey = ll01QuarterSortKey(label)
      if (sortKey < oldestKey) {
        oldestKey = sortKey
        oldestLabel = label
      }
      if (sortKey > newestKey) {
        newestKey = sortKey
        newestLabel = label
      }
      const point = perQuarter.get(label) ?? { quarter: label }
      point[plant] = (Number(point[plant] ?? 0) as number) + 1
      perQuarter.set(label, point)
    }
    const sorted = [...perQuarter.values()].sort(
      (a, b) =>
        ll01QuarterSortKey(String(a.quarter)) -
        ll01QuarterSortKey(String(b.quarter))
    )
    return {
      quarterChart: sorted,
      quarterSpan:
        oldestLabel && newestLabel
          ? { oldest: oldestLabel, newest: newestLabel }
          : null,
    }
  }, [category, plants, anchorKey])

  // User breakdown — top 10 by row count, only for categories that
  // expose a user column in SAP's LL01 list view.
  const topUsers = useMemo(() => {
    if (!category || !userField) return []
    const counts = new Map<string, number>()
    for (const row of category.rows ?? []) {
      const plant = String(row._plant ?? '')
      if (!plants.includes(plant)) continue
      const u = String(row[userField] ?? '').trim()
      if (!u) continue
      counts.set(u, (counts.get(u) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([user, count]) => ({ user, count }))
  }, [category, userField, plants])

  const supportsAging = (result?.payload_version ?? 1) >= 2

  if (!result) {
    return (
      <Card>
        <CardContent className='text-muted-foreground py-12 text-center text-sm'>
          Run the query to populate the aging breakdown.
        </CardContent>
      </Card>
    )
  }

  if (!result.ok) {
    return (
      <Card>
        <CardContent className='text-muted-foreground py-12 text-center text-sm'>
          The last run didn&apos;t complete
          {result.errors?.[0]?.detail
            ? ` — ${result.errors[0].detail}`
            : '.'}{' '}
          Re-run once the agent / SAP connection is back to populate the aging
          breakdown.
        </CardContent>
      </Card>
    )
  }

  if (!supportsAging) {
    return (
      <Card>
        <CardContent className='text-muted-foreground py-12 text-center text-sm'>
          This run was produced by an older agent build that did not emit aging
          anchor dates. Re-run on a current agent (or from the fleet) to
          populate the Aging tab.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground text-sm'>Category</span>
          <Select
            value={categoryKey}
            onValueChange={(v) => setCategoryKey(v as LL01CategoryKey)}
          >
            <SelectTrigger size='sm' className='min-w-56'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LL01_CATEGORY_META.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-wrap gap-1'>
          {LL01_PLANTS.map((plant) => (
            <Badge
              key={plant}
              variant={selectedPlants.includes(plant) ? 'default' : 'outline'}
              className='cursor-pointer'
              onClick={() => onTogglePlant(plant)}
            >
              {plant}
            </Badge>
          ))}
        </div>
        {quarterSpan && (
          <Badge variant='outline' className='font-mono text-xs'>
            Data spans {quarterSpan.oldest} → {quarterSpan.newest}
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>
            Plant × Aging — {meta.label}
          </CardTitle>
          <p className='text-muted-foreground text-xs'>
            Cumulative buckets — <code>&gt;30</code> includes{' '}
            <code>&gt;60</code> which includes <code>&gt;90</code>. Aged from{' '}
            <code>{anchorKey.replace(/_/g, ' ')}</code> at row level.
          </p>
        </CardHeader>
        <CardContent className='overflow-x-auto'>
          <table className='w-full min-w-[640px] border-collapse text-sm'>
            <thead>
              <tr className='border-b'>
                <th className='p-2 text-left font-medium'>Plant</th>
                <th className='p-2 text-center font-medium'>&gt;30 days</th>
                <th className='p-2 text-center font-medium'>&gt;60 days</th>
                <th className='p-2 text-center font-medium'>&gt;90 days</th>
                <th className='p-2 text-center font-medium'>Dated rows</th>
                <th className='p-2 text-center font-medium'>Undated</th>
              </tr>
            </thead>
            <tbody>
              {plants.map((plant) => {
                const b = bucketsByPlant.get(plant) ?? {
                  gt30: 0,
                  gt60: 0,
                  gt90: 0,
                  dated: 0,
                  undated: 0,
                }
                const total = b.dated
                return (
                  <tr key={plant} className='border-t'>
                    <td className='p-2 align-middle font-medium'>{plant}</td>
                    {(['gt30', 'gt60', 'gt90'] as const).map((bucket) => {
                      const count = b[bucket]
                      const sev = severityFor(count, total)
                      return (
                        <td
                          key={bucket}
                          className='p-2 text-center align-middle'
                        >
                          <span
                            className={cn(
                              'inline-flex min-w-14 items-center justify-center rounded-md border px-2 py-1 font-mono text-xs',
                              BUCKET_BADGE[sev]
                            )}
                            title={
                              total > 0
                                ? `${count.toLocaleString()} / ${total.toLocaleString()} dated rows (${(
                                    (count / total) *
                                    100
                                  ).toFixed(1)}%)`
                                : `${count.toLocaleString()}`
                            }
                          >
                            {count.toLocaleString()}
                          </span>
                        </td>
                      )
                    })}
                    <td className='text-muted-foreground p-2 text-center font-mono'>
                      {b.dated.toLocaleString()}
                    </td>
                    <td className='text-muted-foreground p-2 text-center font-mono'>
                      {b.undated.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
              <tr className='border-t font-medium'>
                <td className='p-2'>Total</td>
                {(['gt30', 'gt60', 'gt90'] as const).map((bucket) => {
                  const sum = plants.reduce(
                    (s, p) => s + (bucketsByPlant.get(p)?.[bucket] ?? 0),
                    0
                  )
                  return (
                    <td key={bucket} className='p-2 text-center font-mono'>
                      {sum.toLocaleString()}
                    </td>
                  )
                })}
                <td className='p-2 text-center font-mono'>
                  {plants
                    .reduce(
                      (s, p) => s + (bucketsByPlant.get(p)?.dated ?? 0),
                      0
                    )
                    .toLocaleString()}
                </td>
                <td className='p-2 text-center font-mono'>
                  {plants
                    .reduce(
                      (s, p) => s + (bucketsByPlant.get(p)?.undated ?? 0),
                      0
                    )
                    .toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>
            Items per quarter — {meta.label}
          </CardTitle>
          <p className='text-muted-foreground text-xs'>
            Bucketed by calendar quarter of{' '}
            <code>{anchorKey.replace(/_/g, ' ')}</code>. Rows without a
            parseable date are excluded.
          </p>
        </CardHeader>
        <CardContent className='h-72'>
          {quarterChart.length === 0 ? (
            <p className='text-muted-foreground flex h-full items-center justify-center text-sm'>
              No dated rows in the current run for the selected plants.
            </p>
          ) : (
            <ResponsiveContainer width='100%' height='100%'>
              <BarChart data={quarterChart}>
                <CartesianGrid strokeOpacity={0.06} />
                <XAxis dataKey='quarter' fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                {plants.map((plant, idx) => (
                  <Bar
                    key={plant}
                    dataKey={plant}
                    stackId='quarters'
                    fill={PLANT_COLORS[idx % PLANT_COLORS.length]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>Top users — {meta.label}</CardTitle>
          {userField ? (
            <p className='text-muted-foreground text-xs'>
              By row count for the selected plants. Source column:{' '}
              <code>{userField}</code>.
            </p>
          ) : (
            <p className='text-muted-foreground text-xs'>
              SAP&apos;s LL01 list view does not expose a user column for this
              category.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {!userField ? (
            <p className='text-muted-foreground py-4 text-center text-sm'>
              Not available for this category.
            </p>
          ) : topUsers.length === 0 ? (
            <p className='text-muted-foreground py-4 text-center text-sm'>
              No user IDs in the current rows.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className='text-right'>Rows</TableHead>
                  <TableHead className='text-right'>Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const total = topUsers.reduce((s, u) => s + u.count, 0)
                  return topUsers.map(({ user, count }) => (
                    <TableRow key={user}>
                      <TableCell className='font-mono text-xs'>
                        {user}
                      </TableCell>
                      <TableCell className='text-right font-mono'>
                        {count.toLocaleString()}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-right font-mono'>
                        {total > 0
                          ? `${((count / total) * 100).toFixed(1)}%`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                })()}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
