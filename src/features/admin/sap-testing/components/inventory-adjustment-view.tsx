// Created and developed by Jai Singh
/**
 * InventoryAdjustmentView — SAP Testing → Inventory Management → Inventory
 * Adjustment (2026-05-07).
 *
 * Read/manage UI for the migration-288 `inventory_adjustment_staging`
 * table. Rows are appended from the LT10 query result via the
 * "+ Add to Inv. Adjust" row action; this view shows three stat cards
 * (Net Value / Gross Gains / Gross Losses), the staging table itself
 * with a per-row Remove action, and an "Export to Excel" button.
 *
 * Architecture notes:
 *   - Direct PostgREST against the staging table (RLS-scoped) — no
 *     control-plane Realtime channel. See `.cursor/rules/realtime-policy.mdc`:
 *     adds happen one-at-a-time via the agent at human pace, the table
 *     is org-scoped, and the user driving the inserts is the user
 *     reading the table. TanStack Query `invalidateQueries` after each
 *     mutation keeps the UI in sync.
 *   - Excel export uses the already-installed `exceljs` (lazy-imported
 *     so the chunk only lands in the browser when the user actually
 *     clicks Export).
 *   - Stat-card visual language matches the existing LT10 stat row
 *     (`stats={[]}` → CardHeader → 3-up grid with icon halo + accent
 *     class). We render them inline here because the standard
 *     ResultsCard expects an agent query result, not a Supabase table.
 */
import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Scale,
  Trash2,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { useOrgId } from '@/lib/auth/unified-auth-provider'
import {
  deleteInventoryAdjustmentStagingRow,
  inventoryAdjustmentStagingQueryKey,
  listInventoryAdjustmentStagingForOrg,
  type InventoryAdjustmentStagingRow,
} from '@/lib/supabase/inventory-adjustment-staging.service'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ──────────────────────────────────────────────────────────────────────
// Currency formatting
// ──────────────────────────────────────────────────────────────────────

/** Cache `Intl.NumberFormat` instances per currency — they're somewhat
 *  expensive to construct (V8 sets up a full ICU locale data path). */
const _formatterCache = new Map<string, Intl.NumberFormat>()

function moneyFormatter(
  currency: string | null | undefined
): Intl.NumberFormat {
  // ZMM60 normally returns ISO-4217 codes (USD, EUR, GBP). Defensive
  // fallback for orgs that haven't extended valuation: render as USD
  // so the value is still readable instead of showing "NaN" or empty.
  const ccy = (currency ?? 'USD').trim().toUpperCase() || 'USD'
  let fmt = _formatterCache.get(ccy)
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: ccy,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    } catch {
      // Unknown currency code — fall back to plain decimal so the export
      // still renders rather than throwing.
      fmt = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }
    _formatterCache.set(ccy, fmt)
  }
  return fmt
}

function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return moneyFormatter(currency).format(value)
}

function formatStock(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  // SAP often emits decimalised quantities — show up to 3 fraction digits
  // so e.g. 12.500 PC reads correctly without trailing zero noise.
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value)
}

// ──────────────────────────────────────────────────────────────────────
// Aggregations
// ──────────────────────────────────────────────────────────────────────

interface AdjustmentTotals {
  /** Sign-aware sum of `extended_value` across every row. */
  net: number
  /** Sum of `extended_value` for rows where `total_stock > 0`. */
  gains: number
  /** Absolute sum of `extended_value` for rows where `total_stock < 0`
   *  (negative-stock rows = SAP shortfalls). */
  losses: number
  /** Currency code to render the totals in. When the staging set mixes
   *  currencies, falls back to null and the FE renders "(mixed)". */
  currency: string | null
}

function computeTotals(
  rows: InventoryAdjustmentStagingRow[]
): AdjustmentTotals {
  let net = 0
  let gains = 0
  let losses = 0
  const currencies = new Set<string>()
  for (const row of rows) {
    const ev = Number(row.extended_value ?? row.total_stock * row.unit_value)
    if (!Number.isFinite(ev)) continue
    net += ev
    if (row.total_stock > 0) gains += ev
    else if (row.total_stock < 0) losses += Math.abs(ev)
    if (row.currency) currencies.add(row.currency.toUpperCase())
  }
  const currency = currencies.size === 1 ? [...currencies][0] : null
  return { net, gains, losses, currency }
}

// ──────────────────────────────────────────────────────────────────────
// Excel export (lazy-imported `exceljs`)
// ──────────────────────────────────────────────────────────────────────

/** Build the export filename: `inventory_adjustment_YYYYMMDD_HHmm.xlsx`. */
function buildExportFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const hh = pad(now.getHours())
  const mm = pad(now.getMinutes())
  return `inventory_adjustment_${y}${m}${d}_${hh}${mm}.xlsx`
}

async function exportRowsToXlsx(
  rows: InventoryAdjustmentStagingRow[],
  totals: AdjustmentTotals
): Promise<void> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.default.Workbook()
  workbook.creator = 'OmniFrame'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Inventory Adjustment')

  sheet.columns = [
    { header: 'Storage Type', key: 'storage_type', width: 14 },
    { header: 'Plant', key: 'plant', width: 8 },
    { header: 'Storage Location', key: 'storage_location', width: 18 },
    { header: 'Storage Bin', key: 'storage_bin', width: 16 },
    { header: 'Material', key: 'material', width: 14 },
    { header: 'Total Stock', key: 'total_stock', width: 14 },
    { header: 'Unit Value', key: 'unit_value', width: 14 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Extended Value', key: 'extended_value', width: 18 },
    { header: 'Created At', key: 'created_at', width: 22 },
  ]
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).alignment = { vertical: 'middle' }

  for (const r of rows) {
    sheet.addRow({
      storage_type: r.storage_type ?? '',
      plant: r.plant ?? '',
      storage_location: r.storage_location ?? '',
      storage_bin: r.storage_bin ?? '',
      material: r.material,
      total_stock: r.total_stock,
      unit_value: r.unit_value,
      currency: r.currency ?? '',
      extended_value:
        r.extended_value ?? Number(r.total_stock) * Number(r.unit_value),
      created_at: new Date(r.created_at).toISOString(),
    })
  }

  // Totals row — leave per-row numeric fields blank and put the net sum
  // in Extended Value so consumers can see the bottom line at a glance.
  // We export Net (sign-aware) here; gains / losses are summary-only and
  // already visible in the stat cards, so the Excel can stay one-line.
  if (rows.length > 0) {
    const totalsRow = sheet.addRow({
      storage_type: 'TOTAL',
      plant: '',
      storage_location: '',
      storage_bin: '',
      material: '',
      total_stock: '',
      unit_value: '',
      currency: totals.currency ?? '',
      extended_value: totals.net,
      created_at: '',
    })
    totalsRow.font = { bold: true }
    totalsRow.eachCell((cell) => {
      cell.border = { top: { style: 'thin' } }
    })
  }

  // Number-format the money columns so Excel renders them as currency.
  // ExcelJS uses standard Excel codes; "$#,##0.00;-$#,##0.00" works
  // everywhere even without a per-row currency code. (The currency
  // column above carries the actual ISO code for readers who care.)
  sheet.getColumn('unit_value').numFmt = '#,##0.0000'
  sheet.getColumn('extended_value').numFmt = '#,##0.00;-#,##0.00'
  sheet.getColumn('total_stock').numFmt = '#,##0.000;-#,##0.000'

  const buffer = await workbook.xlsx.writeBuffer()
  // Cast: exceljs' writeBuffer returns ArrayBuffer at runtime in browsers;
  // its typings declare Buffer (Node) so the BlobPart cast keeps both
  // happy.
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = buildExportFilename()
  a.click()
  URL.revokeObjectURL(url)
}

// ──────────────────────────────────────────────────────────────────────
// Main view
// ──────────────────────────────────────────────────────────────────────

export function InventoryAdjustmentView() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  const [pendingDelete, setPendingDelete] =
    useState<InventoryAdjustmentStagingRow | null>(null)
  const [exporting, setExporting] = useState(false)

  // Query — list staging rows for this org. Disabled until org id is
  // hydrated so we don't fire a cancelled query on first paint. Org id
  // sits in the queryKey so a tenant switch invalidates without manual
  // refetch.
  const stagingQuery = useQuery({
    queryKey: inventoryAdjustmentStagingQueryKey(orgId),
    queryFn: () => listInventoryAdjustmentStagingForOrg(orgId!),
    enabled: !!orgId,
    staleTime: 60 * 1000, // 1 min — adjustments are slow-tempo
    refetchOnWindowFocus: true,
  })

  const rows = useMemo(() => stagingQuery.data ?? [], [stagingQuery.data])
  const totals = useMemo(() => computeTotals(rows), [rows])

  const deleteMutation = useMutation({
    mutationFn: async (row: InventoryAdjustmentStagingRow) => {
      if (!orgId) throw new Error('Not signed in')
      await deleteInventoryAdjustmentStagingRow(row.id, orgId)
      return row
    },
    onSuccess: (row) => {
      void queryClient.invalidateQueries({
        queryKey: inventoryAdjustmentStagingQueryKey(orgId),
      })
      toast.success('Removed from inventory adjustment', {
        description: `${row.material}${row.storage_bin ? ` · ${row.storage_bin}` : ''}`,
      })
      setPendingDelete(null)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Could not remove row', { description: msg })
    },
  })

  const handleExport = useCallback(async () => {
    if (rows.length === 0) {
      toast.error('Nothing to export', {
        description: 'Add rows from LT10 results first.',
      })
      return
    }
    setExporting(true)
    try {
      await exportRowsToXlsx(rows, totals)
      toast.success('Exported', {
        description: `${rows.length} row(s) to .xlsx`,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      toast.error('Excel export failed', { description: msg })
    } finally {
      setExporting(false)
    }
  }, [rows, totals])

  const isLoading = stagingQuery.isLoading || (!stagingQuery.data && !!orgId)
  const hasError = stagingQuery.isError
  const isEmpty = !isLoading && !hasError && rows.length === 0

  return (
    <Card className='flex min-h-0 flex-col gap-3 overflow-hidden py-4 shadow-sm'>
      <CardHeader className='space-y-1 pb-2'>
        <div className='flex items-center gap-2 text-[10px] font-semibold tracking-widest text-emerald-600 uppercase dark:text-emerald-400'>
          <Wallet className='h-3 w-3' />
          <span>Inventory Adjustment</span>
        </div>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <CardTitle className='text-[15px] leading-tight font-semibold'>
            Staged Adjustment Rows
          </CardTitle>
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => stagingQuery.refetch()}
              disabled={stagingQuery.isFetching}
              title='Refresh staging table'
            >
              {stagingQuery.isFetching ? (
                <Loader2 className='mr-1 h-3 w-3 animate-spin' />
              ) : (
                <RefreshCw className='mr-1 h-3 w-3' />
              )}
              Refresh
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => void handleExport()}
              disabled={exporting || rows.length === 0}
              title={
                rows.length === 0
                  ? 'Add rows first'
                  : 'Download an Excel file of the staging table'
              }
            >
              {exporting ? (
                <Loader2 className='mr-1 h-3 w-3 animate-spin' />
              ) : (
                <Download className='mr-1 h-3 w-3' />
              )}
              Export to Excel
            </Button>
          </div>
        </div>
        <CardDescription className='text-xs'>
          Rows accumulate here as you pick{' '}
          <span className='font-medium'>+ Add to Inv. Adjust</span> from any
          LT10 result. Each row is priced via ZMM60 at the moment it's added.
          The Net Value is sign-aware: positive-stock rows count as gains,
          negative-stock rows (SAP shortfalls) count as losses.
        </CardDescription>
      </CardHeader>

      {/* Stat cards — visual language mirrors the LT10 query's stat row
          (icon halo + accent class + tabular-nums value). Three across on
          desktop, stacking on smaller widths. */}
      <div className='border-y px-4 py-3'>
        <div className='grid gap-3 sm:grid-cols-3'>
          <StatCard
            label='Net Value'
            value={formatMoney(totals.net, totals.currency)}
            icon={Scale}
            accentClass='text-foreground'
            hint={
              totals.currency === null && rows.length > 0
                ? 'Mixed currencies'
                : undefined
            }
          />
          <StatCard
            label='Gross Gains'
            value={formatMoney(totals.gains, totals.currency)}
            icon={ArrowUpCircle}
            accentClass='text-emerald-600 dark:text-emerald-400'
          />
          <StatCard
            label='Gross Losses'
            value={formatMoney(totals.losses, totals.currency)}
            icon={ArrowDownCircle}
            accentClass='text-red-600 dark:text-red-400'
          />
        </div>
      </div>

      <CardContent className='min-h-0 flex-1 p-0'>
        {hasError ? (
          <div className='m-4 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300'>
            Could not load staging rows.{' '}
            <button
              className='underline'
              onClick={() => stagingQuery.refetch()}
              type='button'
            >
              Retry
            </button>
            .
          </div>
        ) : isLoading ? (
          <div className='text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm'>
            <Loader2 className='h-4 w-4 animate-spin' />
            Loading staging rows...
          </div>
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          <div className='max-h-[600px] overflow-auto overscroll-contain *:data-[slot=table-container]:overflow-visible!'>
            <Table>
              <TableHeader className='bg-muted/30 sticky top-0 z-10'>
                <TableRow>
                  <TableHead className='w-[70px] text-xs whitespace-nowrap'>
                    Action
                  </TableHead>
                  <TableHead className='text-xs whitespace-nowrap'>
                    Storage Type
                  </TableHead>
                  <TableHead className='text-xs whitespace-nowrap'>
                    Plant
                  </TableHead>
                  <TableHead className='text-xs whitespace-nowrap'>
                    Storage Location
                  </TableHead>
                  <TableHead className='text-xs whitespace-nowrap'>
                    Storage Bin
                  </TableHead>
                  <TableHead className='text-xs whitespace-nowrap'>
                    Material
                  </TableHead>
                  <TableHead className='text-right text-xs whitespace-nowrap'>
                    Total Stock
                  </TableHead>
                  <TableHead className='text-right text-xs whitespace-nowrap'>
                    Unit Value
                  </TableHead>
                  <TableHead className='text-right text-xs whitespace-nowrap'>
                    Extended Value
                  </TableHead>
                  <TableHead className='text-xs whitespace-nowrap'>
                    Added
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const ev =
                    row.extended_value ??
                    Number(row.total_stock) * Number(row.unit_value)
                  const isShortfall = row.total_stock < 0
                  return (
                    <TableRow key={row.id} className='hover:bg-muted/40'>
                      <TableCell className='py-1'>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-muted-foreground h-7 w-7 p-0 hover:text-red-600'
                          onClick={() => setPendingDelete(row)}
                          aria-label='Remove row'
                          title='Remove this row from the staging table'
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </Button>
                      </TableCell>
                      <TableCell className='font-mono text-xs whitespace-nowrap'>
                        {row.storage_type ?? '—'}
                      </TableCell>
                      <TableCell className='font-mono text-xs whitespace-nowrap'>
                        {row.plant ?? '—'}
                      </TableCell>
                      <TableCell className='font-mono text-xs whitespace-nowrap'>
                        {row.storage_location ?? '—'}
                      </TableCell>
                      <TableCell className='font-mono text-xs whitespace-nowrap'>
                        {row.storage_bin ?? '—'}
                      </TableCell>
                      <TableCell className='font-mono text-xs whitespace-nowrap'>
                        {row.material}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-mono text-xs whitespace-nowrap tabular-nums',
                          isShortfall && 'text-red-600 dark:text-red-400'
                        )}
                      >
                        {formatStock(row.total_stock)}
                      </TableCell>
                      <TableCell className='text-right font-mono text-xs whitespace-nowrap tabular-nums'>
                        {formatMoney(row.unit_value, row.currency)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-mono text-xs font-medium whitespace-nowrap tabular-nums',
                          isShortfall
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        )}
                      >
                        {formatMoney(ev, row.currency)}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-xs whitespace-nowrap'>
                        {new Date(row.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {!isEmpty && !isLoading && !hasError && (
        <div className='text-muted-foreground border-t px-4 py-2 text-xs'>
          <span className='inline-flex items-center gap-1.5'>
            <CheckCircle2 className='h-3 w-3 text-emerald-500' />
            <span className='text-foreground font-medium'>
              {rows.length}
            </span>{' '}
            row{rows.length === 1 ? '' : 's'} staged
            {totals.currency && (
              <Badge
                variant='outline'
                className='ml-2 font-mono text-[10px] tracking-wide'
              >
                {totals.currency}
              </Badge>
            )}
          </span>
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setPendingDelete(null)
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <Trash2 className='h-4 w-4 text-red-500' />
              Remove staging row
            </DialogTitle>
            <DialogDescription>
              {pendingDelete && (
                <>
                  Permanently remove material{' '}
                  <span className='font-mono font-semibold'>
                    {pendingDelete.material}
                  </span>
                  {pendingDelete.storage_bin && (
                    <>
                      {' '}
                      at{' '}
                      <span className='font-mono font-semibold'>
                        {pendingDelete.storage_bin}
                      </span>
                    </>
                  )}{' '}
                  from the staging table? This does NOT touch SAP — only the
                  scratch row used for the Inventory Adjustment view.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setPendingDelete(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() =>
                pendingDelete && deleteMutation.mutate(pendingDelete)
              }
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Removing...
                </>
              ) : (
                <>
                  <Trash2 className='mr-2 h-4 w-4' />
                  Remove
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accentClass,
  hint,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  accentClass: string
  hint?: string
}) {
  return (
    <div className='bg-muted/30 flex items-center gap-3 rounded-lg border p-3'>
      <div className={cn('bg-background rounded-md p-2', accentClass)}>
        <Icon className='h-4 w-4' />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='text-muted-foreground text-xs'>{label}</div>
        <div
          className={cn(
            'text-lg leading-tight font-semibold tabular-nums',
            accentClass
          )}
        >
          {value}
        </div>
        {hint && (
          <div className='text-muted-foreground/80 text-[10px]'>{hint}</div>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className='flex flex-col items-center justify-center gap-2 px-6 py-14 text-center'>
      <div className='mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10'>
        <Wallet className='h-6 w-6 text-emerald-500' />
      </div>
      <div className='text-base font-semibold'>No rows yet</div>
      <p className='text-muted-foreground max-w-md text-xs'>
        Open the <span className='font-medium'>Bin Stock by Material</span>{' '}
        query in the library, run an LT10 lookup, then pick{' '}
        <span className='font-mono'>Actions → + Add to Inv. Adjust</span> on any
        row to price it via ZMM60 and stage it here.
      </p>
    </div>
  )
}

// Created and developed by Jai Singh
