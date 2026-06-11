// Created and developed by Jai Singh
/**
 * Heatmap tab for LL01 Warehouse Activity Monitor.
 */
import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Download,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  LL01_CATEGORY_META,
  LL01_DRILLDOWN_COLUMNS,
  LL01_PLANTS,
  classifyLL01Severity,
  trendArrow,
  type LL01CategoryKey,
  type LL01Progress,
  type LL01RunResult,
  type LL01Severity,
  type LL01SnapshotRow,
} from './warehouse-activity-monitor-types'

const SEVERITY_CLASS: Record<LL01Severity, string> = {
  green: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-800 border-amber-500/30',
  red: 'bg-red-500/15 text-red-700 border-red-500/30',
}

interface HeatmapTabProps {
  result: LL01RunResult | null
  priorSnapshots: LL01SnapshotRow[]
  isRunning: boolean
  progress: LL01Progress | null
  lastRunAt: string | null
  selectedPlants: string[]
  onTogglePlant: (plant: string) => void
  onRefresh: () => void
}

function exportDrilldownCsv(
  rows: Record<string, unknown>[],
  columns: string[]
) {
  const header = columns.join(',')
  const body = rows
    .map((row) =>
      columns
        .map((col) => {
          const val = String(row[col] ?? '')
          return val.includes(',') ? `"${val.replace(/"/g, '""')}"` : val
        })
        .join(',')
    )
    .join('\n')
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'll01-detail.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function HeatmapTab({
  result,
  priorSnapshots,
  isRunning,
  progress,
  lastRunAt,
  selectedPlants,
  onTogglePlant,
  onRefresh,
}: HeatmapTabProps) {
  const [drawer, setDrawer] = useState<{
    plant: string
    categoryKey: LL01CategoryKey
    label: string
    count: number
  } | null>(null)

  const plants = useMemo(() => {
    // A failed/result-less run normalizes `plants` to `[]`. Treat an empty
    // array the same as missing and fall back to the default plant list so
    // the grid columns never collapse to just Category/Trend/Total (the
    // "categories cleared out with no data" regression after a failed run).
    const base =
      result?.plants && result.plants.length > 0
        ? result.plants
        : [...LL01_PLANTS]
    return base.filter((p) => selectedPlants.includes(p))
  }, [result?.plants, selectedPlants])

  // A run that came back `ok: false` (agent/SAP not connected, fleet job
  // failed, etc.) renders an all-zeros grid that's indistinguishable from a
  // genuine "zero issues" run — surface the reason so it isn't mistaken for
  // real data.
  const failure =
    result && !result.ok
      ? (result.errors?.[0]?.detail ?? 'Unknown error')
      : null

  const priorByPlantCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of priorSnapshots) {
      map.set(`${row.plant}|${row.category}`, row.count)
    }
    return map
  }, [priorSnapshots])

  const drawerRows = useMemo(() => {
    if (!drawer || !result) return []
    const cat = result.categories?.find((c) => c.key === drawer.categoryKey)
    if (!cat) return []
    return (cat.rows ?? []).filter(
      (r) => String(r._plant ?? drawer.plant) === drawer.plant
    )
  }, [drawer, result])

  const drawerColumns =
    drawer?.categoryKey != null
      ? LL01_DRILLDOWN_COLUMNS[drawer.categoryKey]
      : []

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <div className='text-muted-foreground text-sm'>
          {lastRunAt ? (
            <>
              Last run:{' '}
              {formatDistanceToNow(new Date(lastRunAt), { addSuffix: true })}
              {result?.duration_ms != null && (
                <> · {(result.duration_ms / 1000).toFixed(0)}s</>
              )}
            </>
          ) : (
            'No run yet'
          )}
        </div>
        <Button size='sm' onClick={onRefresh} disabled={isRunning}>
          <RefreshCw
            className={cn('mr-2 h-4 w-4', isRunning && 'animate-spin')}
          />
          Re-run
        </Button>
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
      </div>

      {failure && !isRunning && (
        <Card className='border-red-500/40 bg-red-500/5'>
          <CardContent className='flex items-start gap-2 py-3 text-sm'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-red-600' />
            <span>
              Last run didn&apos;t complete — {failure}. The grid below has no
              counts; re-run once the agent / SAP connection is back.
            </span>
          </CardContent>
        </Card>
      )}

      {isRunning && progress && (
        <Card>
          <CardContent className='space-y-2 pt-4'>
            <div className='text-sm'>
              Plant {progress.plant_index} of {progress.plant_total} · category{' '}
              {progress.category_index} of {progress.category_total} ·{' '}
              {progress.elapsed_sec}s elapsed
            </div>
            <Progress
              value={
                progress.plant_total > 0
                  ? ((progress.plant_index - 1) / progress.plant_total +
                      progress.category_index /
                        progress.category_total /
                        progress.plant_total) *
                    100
                  : 0
              }
            />
            <p className='text-muted-foreground text-xs'>{progress.label}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Plant × Category Heatmap</CardTitle>
        </CardHeader>
        <CardContent className='overflow-x-auto'>
          <table className='w-full min-w-[720px] border-collapse text-sm'>
            <thead>
              <tr>
                <th className='p-2 text-left font-medium'>Category</th>
                {plants.map((plant) => (
                  <th key={plant} className='p-2 text-center font-medium'>
                    {plant}
                  </th>
                ))}
                <th className='p-2 text-center font-medium'>Trend</th>
                <th className='p-2 text-center font-medium'>Total</th>
              </tr>
            </thead>
            <tbody>
              {LL01_CATEGORY_META.map((meta) => {
                const cat = result?.categories?.find((c) => c.key === meta.key)
                const rowTotal = plants.reduce(
                  (sum, plant) => sum + (cat?.counts_by_plant[plant] ?? 0),
                  0
                )
                const rowSeverity = classifyLL01Severity(
                  rowTotal,
                  meta.thresholds
                )
                return (
                  <tr key={meta.key} className='border-t'>
                    <td className='p-2 align-middle'>{meta.label}</td>
                    {plants.map((plant) => {
                      const count = cat?.counts_by_plant[plant] ?? 0
                      const severity = classifyLL01Severity(
                        count,
                        meta.thresholds
                      )
                      return (
                        <td
                          key={plant}
                          className='p-2 text-center align-middle'
                        >
                          <button
                            type='button'
                            className={cn(
                              'inline-flex min-w-[3rem] items-center justify-center rounded-md border px-2 py-1 font-mono text-xs',
                              SEVERITY_CLASS[severity],
                              result && 'hover:opacity-80'
                            )}
                            title={`${plant} · ${meta.label} · ${count}`}
                            disabled={!result}
                            onClick={() =>
                              setDrawer({
                                plant,
                                categoryKey: meta.key,
                                label: meta.label,
                                count,
                              })
                            }
                          >
                            {count.toLocaleString()}
                          </button>
                        </td>
                      )
                    })}
                    <td className='p-2 text-center align-middle'>
                      {(() => {
                        const priorTotal = plants.reduce(
                          (sum, plant) =>
                            sum +
                            (priorByPlantCategory.get(`${plant}|${meta.key}`) ??
                              0),
                          0
                        )
                        const dir = trendArrow(rowTotal, priorTotal)
                        if (dir === 'up')
                          return (
                            <ArrowUp className='mx-auto h-4 w-4 text-red-500' />
                          )
                        if (dir === 'down')
                          return (
                            <ArrowDown className='mx-auto h-4 w-4 text-emerald-500' />
                          )
                        if (dir === 'flat')
                          return (
                            <ArrowRight className='text-muted-foreground mx-auto h-4 w-4' />
                          )
                        return '—'
                      })()}
                    </td>
                    <td className='p-2 text-center align-middle'>
                      <Badge
                        variant='outline'
                        className={SEVERITY_CLASS[rowSeverity]}
                      >
                        {rowTotal.toLocaleString()}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
              <tr className='border-t font-medium'>
                <td className='p-2'>Total</td>
                {plants.map((plant) => {
                  const total = LL01_CATEGORY_META.reduce((sum, meta) => {
                    const cat = result?.categories?.find(
                      (c) => c.key === meta.key
                    )
                    return sum + (cat?.counts_by_plant[plant] ?? 0)
                  }, 0)
                  return (
                    <td key={plant} className='p-2 text-center font-mono'>
                      {total.toLocaleString()}
                    </td>
                  )
                })}
                <td />
                <td className='p-2 text-center font-mono'>
                  {LL01_CATEGORY_META.reduce((sum, meta) => {
                    const cat = result?.categories?.find(
                      (c) => c.key === meta.key
                    )
                    return (
                      sum +
                      plants.reduce(
                        (s, plant) => s + (cat?.counts_by_plant[plant] ?? 0),
                        0
                      )
                    )
                  }, 0).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Sheet
        open={drawer != null}
        onOpenChange={(open) => !open && setDrawer(null)}
      >
        <SheetContent className='w-full overflow-y-auto sm:max-w-xl'>
          {drawer && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {drawer.plant} · {drawer.label}
                </SheetTitle>
                <SheetDescription>
                  {drawer.count.toLocaleString()} records
                </SheetDescription>
              </SheetHeader>
              <div className='mt-4 flex justify-end'>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => exportDrilldownCsv(drawerRows, drawerColumns)}
                  disabled={drawerRows.length === 0}
                >
                  <Download className='mr-2 h-4 w-4' />
                  Download CSV
                </Button>
              </div>
              <div className='mt-4 max-h-[70vh] overflow-auto rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {drawerColumns.map((col) => (
                        <TableHead key={col}>
                          {col.replace(/_/g, ' ')}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drawerRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={drawerColumns.length}
                          className='text-muted-foreground'
                        >
                          No rows for this plant × category.
                        </TableCell>
                      </TableRow>
                    ) : (
                      drawerRows.map((row, idx) => (
                        <TableRow key={idx}>
                          {drawerColumns.map((col) => (
                            <TableCell key={col} className='font-mono text-xs'>
                              {String(row[col] ?? '')}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

export { exportDrilldownCsv }

// Created and developed by Jai Singh
