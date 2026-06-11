// Created and developed by Jai Singh
/**
 * TransferOrderHistoryView — visual trail/timeline rendering of LT24
 * movement data (2026-05-09).
 *
 * Replaces the flat-table view of the old TO History tab. Surfaces TWO
 * presentation modes for the same dataset:
 *
 *   - Journey (default) — one card per Transfer Order, showing the
 *     physical bin-to-bin movement as a chip → arrow → chip trail. Best
 *     for "where did this material travel?" questions.
 *
 *   - Timeline — vertical day-clustered timeline, each node = one
 *     movement. Best for "what happened in this material's life,
 *     chronologically?" questions.
 *
 * Both modes consume the same `QueryResult` shape returned by the
 * agent's `handler_lt24` (via `/sap/query`) — `{columns, rows, total}`.
 * Column ids are positional (`c0_MATNR`, `MATNR`, etc.) so we resolve
 * by title using a tolerant substring match (mirrors the
 * `_col(...)` helper used in `_rows_to_graph` server-side).
 *
 * Performance: rows are sliced to the active filter set, then
 * virtualised via `@tanstack/react-virtual` when > 200 to keep
 * scrolling smooth on the 7000+ rows the example LT24 export
 * contains.
 *
 * Related:
 *   - [[Implementations/Implement-LT24-History-Trail]]
 *   - [[Components/Inventory-Management - SAP Query Framework]]
 *   - [[Components/Omni-Agent - Headless SAP Agent]] — `handler_lt24`
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  History,
  ListFilter,
  MapPin,
  Package,
  PackagePlus,
  PackageOpen,
  RefreshCw,
  Route,
  Search,
  Timer,
  User,
  Warehouse,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

interface QueryColumn {
  id: string
  title: string
}

export interface TransferOrderQueryResult {
  ok: boolean
  columns?: QueryColumn[]
  rows?: Record<string, string>[]
  total?: number
  meta?: Record<string, unknown>
  error?: string
}

interface TransferOrderHistoryViewProps {
  result: TransferOrderQueryResult | null
  isRunning: boolean
  /** Hash of the current query input set — used to scroll the journey
   *  list back to the top when the user runs a new query so they don't
   *  have to scroll up to see fresh results. */
  queryKey: string
  /** Echo of the user's query inputs for the empty-state copy. */
  queryInputs: Record<string, string>
  /** Re-run the same query (used by the empty-state retry button). */
  onRefresh?: () => void
}

/** Normalised LT24 row — pulled out of the SAP positional row by the
 *  resolver so downstream code doesn't have to thread `value(...)`
 *  everywhere. */
interface MovementRow {
  raw: Record<string, string>
  toNumber: string
  itemNumber: string
  movementType: string
  material: string
  description: string
  warehouse: string
  plant: string
  storageLocation: string
  sourceStorageType: string
  sourceBin: string
  destinationStorageType: string
  destinationBin: string
  quantity: number
  quantityText: string
  uom: string
  status: 'confirmed' | 'pending' | 'cancelled'
  createdOnText: string
  createdAt: number | null
  confirmedOnText: string
  confirmedAt: number | null
  createdBy: string
  confirmedBy: string
  delivery: string
  reference: string
  durationMs: number | null
}

// ──────────────────────────────────────────────────────────────────────
// Column resolution
// ──────────────────────────────────────────────────────────────────────

/** Resolve the first column whose title (or id) matches any candidate
 *  via case-insensitive substring. Returns the column id, or empty
 *  string if no match. SAP renders the same logical field under
 *  different titles depending on whether the export came from an ALV
 *  grid or a classic list, so the matcher errs on the lenient side
 *  (mirrors `_col(...)` in the agent's `_rows_to_graph`).
 *
 *  When `position` is set, prefer the Nth match instead of the first
 *  (e.g. LT24 has TWO `Typ` columns — source and destination — and
 *  TWO `User` columns — created-by and confirmed-by). */
function resolveColumnId(
  columns: QueryColumn[],
  candidates: string[],
  position = 0
): string {
  const matches: string[] = []
  for (const col of columns) {
    const haystack = `${col.title} ${col.id}`.toLowerCase()
    for (const cand of candidates) {
      if (haystack.includes(cand.toLowerCase())) {
        matches.push(col.id)
        break
      }
    }
  }
  return matches[position] ?? matches[0] ?? ''
}

// ──────────────────────────────────────────────────────────────────────
// Date / number parsing
// ──────────────────────────────────────────────────────────────────────

/** SAP renders dates as MM/DD/YYYY and times as HH:MM:SS. Combined
 *  parser returns an epoch-ms timestamp or null when the value is
 *  blank / `00/00/0000`. */
function parseSapDateTime(date: string, time: string): number | null {
  const d = (date || '').trim()
  const t = (time || '').trim()
  if (!d || d === '00/00/0000') return null
  const m = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2000
  let hour = 0
  let minute = 0
  let second = 0
  if (t && t !== '00:00:00') {
    const tm = t.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/)
    if (tm) {
      hour = Number(tm[1])
      minute = Number(tm[2])
      second = Number(tm[3])
    }
  }
  const dt = new Date(year, month - 1, day, hour, minute, second)
  return Number.isNaN(dt.getTime()) ? null : dt.getTime()
}

/** Parse SAP-rendered numbers (whitespace, thousand-grouping, trailing
 *  minus). Returns NaN on failure so callers can guard cleanly. */
function parseSapNumber(raw: string): number {
  if (!raw) return NaN
  let s = raw.trim()
  if (!s) return NaN
  let negative = false
  if (s.endsWith('-')) {
    negative = true
    s = s.slice(0, -1).trim()
  }
  s = s.replace(/,/g, '')
  const n = Number(s)
  if (Number.isNaN(n)) return NaN
  return negative ? -n : n
}

function formatRelative(ms: number): string {
  const abs = Math.abs(ms)
  const min = abs / 60_000
  const hr = abs / 3_600_000
  const day = abs / 86_400_000
  if (day >= 1) {
    const d = Math.floor(day)
    const h = Math.floor((abs - d * 86_400_000) / 3_600_000)
    return h > 0 ? `${d}d ${h}h` : `${d}d`
  }
  if (hr >= 1) {
    const h = Math.floor(hr)
    const m = Math.floor((abs - h * 3_600_000) / 60_000)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  if (min >= 1) return `${Math.round(min)}m`
  return '<1m'
}

function formatDateTime(ms: number | null): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDayHeader(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** Compact timestamp formatter for the dense Journey footer rows.
 *  Same day → `02:54:07 PM` (only). Different day in same year →
 *  `May 09, 02:54 PM`. Different year → `May 09 '25, 02:54 PM`. The
 *  goal is to fit the most common case (a same-day TO that completed
 *  within minutes) into ~10 chars so the whole footer line stays on
 *  one row up to ~`md` viewports. */
function formatCompactTime(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(sameYear ? {} : { year: '2-digit' }),
  })
}

// ──────────────────────────────────────────────────────────────────────
// Movement type metadata
// ──────────────────────────────────────────────────────────────────────

interface MovementMeta {
  label: string
  hint: string
  classes: string
}

/** Tailwind palette per common WM movement type. Tokens use the
 *  standard `<color>-500` line so dark-mode just works without a
 *  per-mode override. The `classes` string is a full pill
 *  bg+text+border combo. */
const MOVEMENT_META: Record<string, MovementMeta> = {
  '101': {
    label: 'Goods Receipt',
    hint: 'Inbound receipt against a purchase order',
    classes: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  },
  '301': {
    label: 'Plant Transfer',
    hint: 'Transfer between plants',
    classes:
      'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  },
  '311': {
    label: 'SLoc Transfer',
    hint: 'Transfer between storage locations',
    classes:
      'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
  },
  '312': {
    label: 'SLoc Transfer (rev)',
    hint: 'Reversal of storage location transfer',
    classes:
      'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
  },
  '319': {
    label: 'Putaway',
    hint: 'Stock putaway from interim into bin',
    classes:
      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  '320': {
    label: 'Pick',
    hint: 'Stock removal for outbound delivery',
    classes:
      'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  '321': {
    label: 'QM Release',
    hint: 'Release from quality inspection',
    classes:
      'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30',
  },
  '349': {
    label: 'QM Transfer',
    hint: 'Transfer to quality inspection',
    classes:
      'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  },
  '351': {
    label: 'STO Issue',
    hint: 'Stock transport order issue',
    classes:
      'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30',
  },
  '525': {
    label: 'Internal',
    hint: 'Internal warehouse movement',
    classes:
      'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
  },
  '919': {
    label: 'Inventory Adj',
    hint: 'Inventory adjustment posting',
    classes:
      'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
  },
  '929': {
    label: 'Repack',
    hint: 'Repacking / restock',
    classes:
      'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30',
  },
  '980': {
    label: 'WF-Batch Move',
    hint: 'Workflow-initiated movement',
    classes:
      'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
  },
  '999': {
    label: 'Adjustment',
    hint: 'Stock adjustment / gain / loss',
    classes:
      'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
  },
}

const FALLBACK_MOVEMENT_META: MovementMeta = {
  label: 'Movement',
  hint: 'Custom or non-standard movement type',
  classes:
    'bg-stone-500/10 text-stone-700 dark:text-stone-300 border-stone-500/30',
}

function getMovementMeta(type: string): MovementMeta {
  const trimmed = (type || '').trim()
  return MOVEMENT_META[trimmed] ?? FALLBACK_MOVEMENT_META
}

const STATUS_CLASSES: Record<MovementRow['status'], string> = {
  confirmed:
    'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  pending:
    'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  cancelled:
    'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
}

const STATUS_DOT_CLASSES: Record<MovementRow['status'], string> = {
  confirmed: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
  pending: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
  cancelled: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]',
}

// ──────────────────────────────────────────────────────────────────────
// Storage type → muted accent for bin chips. We deliberately avoid
// reusing the movement colours so the eye reads bins as "where" and
// movements as "what".
// ──────────────────────────────────────────────────────────────────────

function storageTypeAccent(stype: string): string {
  const k = (stype || '').trim()
  if (!k) return 'bg-muted text-muted-foreground border-border'
  // Hash to a stable hue so the same storage type always picks the same
  // chip colour across renders. Five-tone palette keeps the surface
  // readable without competing with the movement-type pills.
  const hash = k.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 5
  switch (hash) {
    case 0:
      return 'bg-blue-500/8 text-blue-700 dark:text-blue-300 border-blue-500/25'
    case 1:
      return 'bg-emerald-500/8 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
    case 2:
      return 'bg-amber-500/8 text-amber-700 dark:text-amber-300 border-amber-500/25'
    case 3:
      return 'bg-violet-500/8 text-violet-700 dark:text-violet-300 border-violet-500/25'
    default:
      return 'bg-rose-500/8 text-rose-700 dark:text-rose-300 border-rose-500/25'
  }
}

// ──────────────────────────────────────────────────────────────────────
// Row normalisation
// ──────────────────────────────────────────────────────────────────────

function normaliseRows(
  columns: QueryColumn[],
  rows: Record<string, string>[]
): MovementRow[] {
  const cTo = resolveColumnId(columns, ['TANUM', 'TO Number', 'Transfer Order'])
  const cItem = resolveColumnId(columns, ['Item', 'TAPOS'])
  const cMvt = resolveColumnId(columns, [
    'BWLVS',
    'Mvmt Type',
    'Mvt Type',
    'MvT',
    'Movement type',
  ])
  const cMaterial = resolveColumnId(columns, ['MATNR', 'Material'])
  const cDescription = resolveColumnId(columns, ['Description', 'MAKTX'])
  const cWarehouse = resolveColumnId(columns, ['LGNUM', 'Warehouse', 'WhN'])
  const cPlant = resolveColumnId(columns, ['WERKS', 'Plnt', 'Plant'])
  const cSloc = resolveColumnId(columns, ['LGORT', 'SLoc'])
  const cSrcType = resolveColumnId(
    columns,
    ['VLTYP', 'Src STyp', 'SrcSTyp', 'Source Stor.Type', 'Typ'],
    0
  )
  const cSrcBin = resolveColumnId(columns, [
    'VLPLA',
    'Source Bin',
    'SrcBin',
    'Src Bin',
  ])
  const cDstType = resolveColumnId(
    columns,
    ['NLTYP', 'Dest. Stor.Type', 'DstSTyp', 'Typ'],
    1
  )
  const cDstBin = resolveColumnId(columns, [
    'NLPLA',
    'Dest. Bin',
    'DstBin',
    'Dest Bin',
  ])
  const cQty = resolveColumnId(columns, [
    'VSOLM',
    'Actual qty',
    'SrceTgtQty',
    'Quantity',
    'TrQty',
  ])
  const cUom = resolveColumnId(columns, ['MEINS', 'UoM', 'Unit'])
  const cCreatedOn = resolveColumnId(columns, [
    'BDATU',
    'Created On',
    'Cr.Date',
    'CrDate',
  ])
  const cCreatedTime = resolveColumnId(columns, ['BZEIT', 'Time'])
  const cConfDate = resolveColumnId(columns, [
    'KQDAT',
    'Conf.date',
    'Confirmed on',
    'ConfDate',
  ])
  const cConfTime = resolveColumnId(columns, ['KQUIT', 'Conf.t.', 'ConfTme'])
  const cCreatedBy = resolveColumnId(
    columns,
    ['UNAME', 'Created by', 'User'],
    0
  )
  const cConfirmedBy = resolveColumnId(
    columns,
    ['BNAME', 'Confirmed by', 'User'],
    1
  )
  const cDelivery = resolveColumnId(columns, ['VBELN', 'Delivery'])
  const cReference = resolveColumnId(columns, [
    'Ref.Doc',
    'Ref. Doc',
    'Mat. Doc',
    'TR Number',
  ])

  const get = (row: Record<string, string>, id: string): string =>
    id ? (row[id] ?? '').trim() : ''

  const out: MovementRow[] = []
  for (const raw of rows) {
    const toNumber = get(raw, cTo)
    if (!toNumber) continue // SAP list output sometimes prepends header rows
    const createdAt = parseSapDateTime(
      get(raw, cCreatedOn),
      get(raw, cCreatedTime)
    )
    const confirmedAt = parseSapDateTime(
      get(raw, cConfDate),
      get(raw, cConfTime)
    )
    let status: MovementRow['status'] = 'pending'
    if (confirmedAt != null) status = 'confirmed'
    const qtyText = get(raw, cQty)
    const qty = parseSapNumber(qtyText)
    out.push({
      raw,
      toNumber,
      itemNumber: get(raw, cItem),
      movementType: get(raw, cMvt),
      material: get(raw, cMaterial),
      description: get(raw, cDescription),
      warehouse: get(raw, cWarehouse),
      plant: get(raw, cPlant),
      storageLocation: get(raw, cSloc),
      sourceStorageType: get(raw, cSrcType),
      sourceBin: get(raw, cSrcBin),
      destinationStorageType: get(raw, cDstType),
      destinationBin: get(raw, cDstBin),
      quantity: Number.isNaN(qty) ? 0 : qty,
      quantityText: qtyText,
      uom: get(raw, cUom),
      status,
      createdOnText: get(raw, cCreatedOn),
      createdAt,
      confirmedOnText: get(raw, cConfDate),
      confirmedAt,
      createdBy: get(raw, cCreatedBy),
      confirmedBy: get(raw, cConfirmedBy),
      delivery: get(raw, cDelivery),
      reference: get(raw, cReference),
      durationMs:
        createdAt != null && confirmedAt != null
          ? confirmedAt - createdAt
          : null,
    })
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────
// Stat ribbon
// ──────────────────────────────────────────────────────────────────────

interface StatCard {
  id: string
  label: string
  value: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
}

function buildStats(
  movements: MovementRow[],
  uniqueTOCount: number
): StatCard[] {
  const total = movements.length
  let qtySum = 0
  let qtySamples = 0
  let durationSum = 0
  let durationSamples = 0
  let activeCount = 0
  for (const m of movements) {
    if (m.quantity) {
      qtySum += m.quantity
      qtySamples++
    }
    if (m.durationMs != null && m.durationMs >= 0) {
      durationSum += m.durationMs
      durationSamples++
    }
    if (m.status !== 'confirmed') activeCount++
  }
  const intFmt = new Intl.NumberFormat()
  return [
    {
      id: 'movements',
      label: 'Total Movements',
      value: intFmt.format(total),
      hint: `${uniqueTOCount.toLocaleString()} unique transfer order(s)`,
      icon: Route,
      accent: 'text-sky-500',
    },
    {
      id: 'quantity',
      label: 'Quantity Moved',
      value: qtySamples > 0 ? intFmt.format(Math.round(qtySum)) : '—',
      hint:
        qtySamples > 0
          ? `Across ${qtySamples.toLocaleString()} priced rows`
          : 'No quantity column resolved',
      icon: PackagePlus,
      accent: 'text-emerald-500',
    },
    {
      id: 'avg-duration',
      label: 'Avg Time to Confirm',
      value:
        durationSamples > 0
          ? formatRelative(durationSum / durationSamples)
          : '—',
      hint:
        durationSamples > 0
          ? `${durationSamples.toLocaleString()} confirmed movements`
          : 'No confirmed movements yet',
      icon: Timer,
      accent: 'text-violet-500',
    },
    {
      id: 'in-flight',
      label: 'In-Flight',
      value: intFmt.format(activeCount),
      hint:
        activeCount === 0 ? 'All movements confirmed' : 'Awaiting confirmation',
      icon: Clock,
      accent: activeCount === 0 ? 'text-emerald-500' : 'text-amber-500',
    },
  ]
}

// ──────────────────────────────────────────────────────────────────────
// Filter bar
// ──────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | MovementRow['status']

interface FilterState {
  search: string
  movementType: string | 'all'
  status: StatusFilter
  storageType: string | 'all'
}

const INITIAL_FILTER: FilterState = {
  search: '',
  movementType: 'all',
  status: 'all',
  storageType: 'all',
}

// ──────────────────────────────────────────────────────────────────────
// Bin chip
// ──────────────────────────────────────────────────────────────────────

interface BinChipProps {
  storageType: string
  bin: string
  size?: 'sm' | 'md'
  onClick?: () => void
  title?: string
}

function BinChip({
  storageType,
  bin,
  size = 'md',
  onClick,
  title,
}: BinChipProps) {
  if (!bin) {
    return (
      <span className='text-muted-foreground inline-flex items-center gap-1 text-xs italic'>
        <PackageOpen className='h-3 w-3' />
        none
      </span>
    )
  }
  const accent = storageTypeAccent(storageType)
  const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1'
  const text = size === 'sm' ? 'text-[11px]' : 'text-xs'
  return (
    <button
      type='button'
      onClick={onClick}
      title={title ?? `${storageType ? `${storageType} / ` : ''}${bin}`}
      className={cn(
        'group/binchip inline-flex items-center gap-1.5 rounded-md border font-mono font-medium transition-all',
        padding,
        text,
        accent,
        onClick &&
          'focus-visible:ring-ring cursor-pointer hover:-translate-y-0.5 hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none'
      )}
    >
      {storageType && (
        <span className='bg-background/40 border-border/40 rounded-sm border px-1 text-[9px] tracking-wider uppercase opacity-80'>
          {storageType}
        </span>
      )}
      <span className='truncate'>{bin}</span>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Movement type pill
// ──────────────────────────────────────────────────────────────────────

interface MovementPillProps {
  type: string
  size?: 'sm' | 'md'
}

function MovementPill({ type, size = 'md' }: MovementPillProps) {
  if (!type) return null
  const meta = getMovementMeta(type)
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-0.5'
  const text = size === 'sm' ? 'text-[10px]' : 'text-[11px]'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border font-mono font-semibold tracking-wide uppercase',
            padding,
            text,
            meta.classes
          )}
        >
          {type}
          <span className='hidden font-sans normal-case opacity-80 sm:inline'>
            {meta.label}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top' className='text-xs'>
        <div className='font-medium'>
          Movement {type} — {meta.label}
        </div>
        <div className='text-muted-foreground'>{meta.hint}</div>
      </TooltipContent>
    </Tooltip>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Status pill
// ──────────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: MovementRow['status'] }) {
  const Icon =
    status === 'confirmed'
      ? CheckCircle2
      : status === 'pending'
        ? Clock
        : XCircle
  const label =
    status === 'confirmed'
      ? 'Confirmed'
      : status === 'pending'
        ? 'Pending'
        : 'Cancelled'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        STATUS_CLASSES[status]
      )}
    >
      <Icon className='h-3 w-3' />
      {label}
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Sep — small `·` divider used everywhere in the compact rows. Picks
// up `text-muted-foreground/40` so it reads as a quiet visual rhythm
// mark rather than competing for attention with the actual content.
// ──────────────────────────────────────────────────────────────────────

function Sep() {
  return (
    <span
      aria-hidden='true'
      className='text-muted-foreground/40 px-px select-none'
    >
      ·
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Journey card — one TO with all its line items, rendered as a dense
// 3-row strip (header / bin trail / footer) divided by hairline borders
// instead of full Card chrome. Vertical density target is ~60–80px per
// TO (was ~150–200px in the round-1 design).
// ──────────────────────────────────────────────────────────────────────

interface JourneyCardProps {
  toNumber: string
  movements: MovementRow[]
  onSelectMovement: (m: MovementRow) => void
}

function JourneyCard({
  toNumber,
  movements,
  onSelectMovement,
}: JourneyCardProps) {
  const first = movements[0]
  const last = movements[movements.length - 1]
  // A TO is "fully confirmed" when every line item has been confirmed.
  // Mixed states resolve to the strictest unfulfilled status so the
  // header dot reads honestly (a partially-confirmed TO is still
  // pending).
  const overallStatus: MovementRow['status'] = movements.every(
    (m) => m.status === 'confirmed'
  )
    ? 'confirmed'
    : 'pending'
  const totalQty = movements.reduce((acc, m) => acc + (m.quantity || 0), 0)
  const intFmt = new Intl.NumberFormat()
  const distinctMvts = Array.from(
    new Set(movements.map((m) => m.movementType).filter(Boolean))
  )

  const onCopyTo = useCallback(() => {
    void navigator.clipboard.writeText(toNumber).then(() => {
      toast.success('TO number copied', { description: toNumber })
    })
  }, [toNumber])

  // Solid 6px status dot. Replaces the full status pill in the
  // round-1 design — keeps signal (color) without the chrome. Only
  // two states are reachable here because `overallStatus` collapses
  // any non-confirmed movement to `'pending'` above.
  const dotClass =
    overallStatus === 'confirmed' ? 'bg-emerald-500' : 'bg-amber-500'

  return (
    <div className='group/journey border-border/40 hover:bg-accent/30 border-b transition-colors duration-75'>
      {/* Row 1 — header. Single dense line: dot · TO · mvmt-pills · material · description · qty */}
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2 pb-1.5'>
        <span
          aria-label={`Status: ${overallStatus}`}
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass)}
          title={overallStatus}
        />
        <button
          type='button'
          onClick={() => onSelectMovement(first)}
          className='focus-visible:ring-ring inline-flex items-center rounded-sm focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none'
          title='Open transfer order detail'
        >
          <Badge
            variant='outline'
            className='h-5 px-1.5 py-0 font-mono text-[10px] tracking-wider'
          >
            TO {toNumber}
          </Badge>
        </button>
        <button
          type='button'
          onClick={onCopyTo}
          className='text-muted-foreground hover:text-foreground -ml-1 opacity-0 transition-opacity group-hover/journey:opacity-100 focus-visible:opacity-100'
          title='Copy TO number'
        >
          <Copy className='h-3 w-3' />
        </button>
        {distinctMvts.length > 0 && (
          <>
            <Sep />
            {distinctMvts.map((mt) => (
              <MovementPill key={mt} type={mt} size='sm' />
            ))}
          </>
        )}
        <Sep />
        <span className='min-w-0 truncate font-mono text-xs'>
          {first.material}
        </span>
        {first.description && (
          <span className='text-muted-foreground hidden min-w-0 truncate text-xs md:inline'>
            · {first.description}
          </span>
        )}
        <span className='ml-auto inline-flex shrink-0 items-center gap-1.5'>
          <span className='font-mono text-xs font-semibold tabular-nums'>
            {intFmt.format(totalQty)}
          </span>
          {first.uom && (
            <span className='text-muted-foreground text-[10px] uppercase'>
              {first.uom}
            </span>
          )}
          {movements.length > 1 && (
            <>
              <Sep />
              <span className='text-muted-foreground text-[10px] tabular-nums'>
                {movements.length} legs
              </span>
            </>
          )}
        </span>
      </div>

      {/* Row 2 — bin trail. One inline group per leg, wrapping naturally
       *  when the screen narrows. Compact (size='sm') chips + 12px arrow
       *  per the user's "tighter arrow icons" spec. */}
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-1.5'>
        {movements.map((m, idx) => (
          <div
            key={`${m.toNumber}-${m.itemNumber}-${idx}`}
            className='inline-flex items-center gap-1.5'
          >
            {movements.length > 1 && (
              <span className='text-muted-foreground/70 font-mono text-[9px] tabular-nums'>
                {m.itemNumber || idx + 1}
              </span>
            )}
            <BinChip
              storageType={m.sourceStorageType}
              bin={m.sourceBin}
              size='sm'
              onClick={() => onSelectMovement(m)}
            />
            <ArrowRight className='text-muted-foreground/50 h-3 w-3 shrink-0' />
            <BinChip
              storageType={m.destinationStorageType}
              bin={m.destinationBin}
              size='sm'
              onClick={() => onSelectMovement(m)}
            />
            {movements.length > 1 && m.quantity > 0 && (
              <span className='text-muted-foreground/70 font-mono text-[10px] tabular-nums'>
                {intFmt.format(m.quantity)} {m.uom}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Row 3 — meta footer. Inline · separators, muted text, tabular
       *  nums on times so the column-aligned look is preserved when
       *  multiple cards stack. */}
      <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 pb-2 text-[11px]'>
        {first.createdAt != null && (
          <span className='inline-flex items-center gap-1'>
            <span className='text-foreground/70'>Created</span>
            <span className='tabular-nums'>
              {formatCompactTime(first.createdAt)}
            </span>
            {first.createdBy && (
              <span className='font-mono'>by {first.createdBy}</span>
            )}
          </span>
        )}
        {last.confirmedAt != null && (
          <>
            <Sep />
            <span className='inline-flex items-center gap-1'>
              <span className='text-foreground/70'>Confirmed</span>
              <span className='tabular-nums'>
                {formatCompactTime(last.confirmedAt)}
              </span>
              {last.confirmedBy && (
                <span className='font-mono'>by {last.confirmedBy}</span>
              )}
            </span>
          </>
        )}
        {last.durationMs != null && last.durationMs >= 0 && (
          <>
            <Sep />
            <span className='inline-flex items-center gap-1'>
              <Timer className='h-2.5 w-2.5' />
              {formatRelative(last.durationMs)}
            </span>
          </>
        )}
        {first.warehouse && (
          <>
            <Sep />
            <span className='inline-flex items-center gap-1'>
              <Warehouse className='h-2.5 w-2.5' />
              {first.warehouse}
              {first.plant && ` / ${first.plant}`}
            </span>
          </>
        )}
        {first.delivery && (
          <>
            <Sep />
            <span className='inline-flex items-center gap-1'>
              <MapPin className='h-2.5 w-2.5' />
              {first.delivery}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Timeline view
// ──────────────────────────────────────────────────────────────────────

interface TimelineCluster {
  dayMs: number
  movements: MovementRow[]
}

function clusterByDay(movements: MovementRow[]): TimelineCluster[] {
  const map = new Map<number, MovementRow[]>()
  for (const m of movements) {
    const ms = m.createdAt ?? m.confirmedAt ?? 0
    const d = new Date(ms)
    d.setHours(0, 0, 0, 0)
    const dayMs = d.getTime()
    const arr = map.get(dayMs)
    if (arr) arr.push(m)
    else map.set(dayMs, [m])
  }
  return Array.from(map.entries())
    .map(([dayMs, arr]) => ({ dayMs, movements: arr }))
    .sort((a, b) => b.dayMs - a.dayMs)
}

interface TimelineRowProps {
  movement: MovementRow
  onSelect: (m: MovementRow) => void
  isLast: boolean
}

function TimelineRow({ movement, onSelect, isLast }: TimelineRowProps) {
  const intFmt = new Intl.NumberFormat()
  const time = movement.createdAt ?? movement.confirmedAt
  // 8px dot directly anchored to the rail, framed by `ring-background`
  // so the rail line cleanly breaks at the dot. Replaces the old 28×28
  // padded dot wrapper.
  const dotClass =
    movement.status === 'confirmed'
      ? 'bg-emerald-500'
      : movement.status === 'cancelled'
        ? 'bg-rose-500'
        : 'bg-amber-500'
  return (
    <div className='hover:bg-accent/30 group relative flex gap-3 rounded-sm py-1 pr-1 pl-2 transition-colors duration-75'>
      {/* Connector line — 1px hairline. Anchors at the dot's vertical
       *  centre and continues to the next row. */}
      {!isLast && (
        <div className='bg-border/40 absolute top-[14px] bottom-0 left-[10px] w-px' />
      )}
      {/* 8px status dot. `ring-background` halo lets the rail visually
       *  pass behind it without an extra wrapper. */}
      <span
        aria-label={`Status: ${movement.status}`}
        title={movement.status}
        className={cn(
          'ring-background relative z-10 mt-[7px] h-2 w-2 shrink-0 rounded-full ring-2',
          dotClass
        )}
      />
      {/* Body — two lines max. Whole body is the click target. */}
      <button
        type='button'
        onClick={() => onSelect(movement)}
        className='focus-visible:ring-ring min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none'
      >
        {/* Line 1: time, TO, mvmt, material, qty */}
        <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
          <span className='text-muted-foreground font-mono text-[11px] tabular-nums'>
            {time != null
              ? new Date(time).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : '—:—:—'}
          </span>
          <Badge
            variant='outline'
            className='h-5 px-1.5 py-0 font-mono text-[10px] tracking-wider'
          >
            TO {movement.toNumber}
            {movement.itemNumber && (
              <span className='text-muted-foreground ml-0.5'>
                /{movement.itemNumber}
              </span>
            )}
          </Badge>
          <MovementPill type={movement.movementType} size='sm' />
          <span className='font-mono text-xs'>{movement.material}</span>
          {movement.quantity > 0 && (
            <span className='text-muted-foreground ml-auto font-mono text-[11px] tabular-nums'>
              {intFmt.format(movement.quantity)}
              {movement.uom && (
                <span className='ml-0.5 text-[9px] uppercase opacity-80'>
                  {movement.uom}
                </span>
              )}
            </span>
          )}
        </div>
        {/* Line 2: bin trail + users + duration, all muted */}
        <div className='text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]'>
          <BinChip
            storageType={movement.sourceStorageType}
            bin={movement.sourceBin}
            size='sm'
          />
          <ArrowRight className='text-muted-foreground/50 h-2.5 w-2.5 shrink-0' />
          <BinChip
            storageType={movement.destinationStorageType}
            bin={movement.destinationBin}
            size='sm'
          />
          {movement.createdBy && (
            <>
              <Sep />
              <span className='inline-flex items-center gap-0.5'>
                <User className='h-2.5 w-2.5' />
                {movement.createdBy}
              </span>
            </>
          )}
          {movement.confirmedBy &&
            movement.confirmedBy !== movement.createdBy && (
              <>
                <Sep />
                <span className='inline-flex items-center gap-0.5'>
                  <CheckCircle2 className='h-2.5 w-2.5 text-emerald-500' />
                  {movement.confirmedBy}
                </span>
              </>
            )}
          {movement.durationMs != null && movement.durationMs >= 0 && (
            <>
              <Sep />
              <span className='inline-flex items-center gap-0.5'>
                <Timer className='h-2.5 w-2.5' />
                {formatRelative(movement.durationMs)}
              </span>
            </>
          )}
        </div>
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Detail drawer
// ──────────────────────────────────────────────────────────────────────

interface DetailDrawerProps {
  movement: MovementRow | null
  siblings: MovementRow[]
  onClose: () => void
  onSelectSibling: (m: MovementRow) => void
}

function DetailDrawer({
  movement,
  siblings,
  onClose,
  onSelectSibling,
}: DetailDrawerProps) {
  if (!movement) return null
  const intFmt = new Intl.NumberFormat()
  return (
    <Sheet open={movement !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side='right'
        className='w-full overflow-y-auto sm:max-w-[480px]'
      >
        <SheetHeader>
          <SheetTitle className='flex items-center gap-2'>
            <Route className='h-4 w-4' />
            TO #{movement.toNumber}
            {movement.itemNumber && (
              <span className='text-muted-foreground font-mono text-sm'>
                / {movement.itemNumber}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className='flex flex-wrap items-center gap-2'>
            <MovementPill type={movement.movementType} />
            <StatusPill status={movement.status} />
          </SheetDescription>
        </SheetHeader>

        <div className='mt-4 space-y-4 px-1'>
          {/* Hero trail */}
          <div className='from-muted/40 to-muted/10 rounded-lg border bg-linear-to-br p-3'>
            <div className='text-muted-foreground mb-2 text-[10px] font-semibold tracking-widest uppercase'>
              Bin Movement
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <BinChip
                storageType={movement.sourceStorageType}
                bin={movement.sourceBin}
              />
              <ArrowRight className='text-muted-foreground h-4 w-4' />
              <BinChip
                storageType={movement.destinationStorageType}
                bin={movement.destinationBin}
              />
            </div>
            {movement.quantity > 0 && (
              <div className='mt-3 flex items-baseline gap-1'>
                <span className='text-2xl font-bold tabular-nums'>
                  {intFmt.format(movement.quantity)}
                </span>
                <span className='text-muted-foreground text-xs uppercase'>
                  {movement.uom}
                </span>
              </div>
            )}
          </div>

          {/* Material */}
          <div className='space-y-1'>
            <div className='text-muted-foreground text-[10px] font-semibold tracking-widest uppercase'>
              Material
            </div>
            <div className='flex items-center gap-2'>
              <Package className='text-muted-foreground h-3.5 w-3.5' />
              <span className='font-mono text-sm font-medium'>
                {movement.material}
              </span>
            </div>
            {movement.description && (
              <div className='text-muted-foreground pl-5 text-xs'>
                {movement.description}
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1'>
              <div className='text-muted-foreground text-[10px] font-semibold tracking-widest uppercase'>
                Created
              </div>
              <div className='text-sm'>
                {movement.createdAt != null
                  ? formatDateTime(movement.createdAt)
                  : movement.createdOnText || '—'}
              </div>
              {movement.createdBy && (
                <div className='text-muted-foreground inline-flex items-center gap-1 font-mono text-xs'>
                  <User className='h-3 w-3' />
                  {movement.createdBy}
                </div>
              )}
            </div>
            <div className='space-y-1'>
              <div className='text-muted-foreground text-[10px] font-semibold tracking-widest uppercase'>
                Confirmed
              </div>
              <div className='text-sm'>
                {movement.confirmedAt != null
                  ? formatDateTime(movement.confirmedAt)
                  : '—'}
              </div>
              {movement.confirmedBy && (
                <div className='text-muted-foreground inline-flex items-center gap-1 font-mono text-xs'>
                  <CheckCircle2 className='h-3 w-3 text-emerald-500' />
                  {movement.confirmedBy}
                </div>
              )}
            </div>
          </div>

          {movement.durationMs != null && movement.durationMs >= 0 && (
            <div className='border-border bg-muted/30 flex items-center gap-2 rounded-md border p-2 text-xs'>
              <Timer className='h-3.5 w-3.5 text-violet-500' />
              <span>
                Confirmation took{' '}
                <span className='font-semibold'>
                  {formatRelative(movement.durationMs)}
                </span>
              </span>
            </div>
          )}

          {/* Warehouse / Plant / SLoc / Delivery */}
          <div className='border-border space-y-2 border-t pt-3'>
            <div className='text-muted-foreground text-[10px] font-semibold tracking-widest uppercase'>
              Context
            </div>
            <div className='grid grid-cols-2 gap-2 text-xs'>
              {movement.warehouse && (
                <div>
                  <span className='text-muted-foreground'>Warehouse</span>
                  <div className='font-mono'>{movement.warehouse}</div>
                </div>
              )}
              {movement.plant && (
                <div>
                  <span className='text-muted-foreground'>Plant</span>
                  <div className='font-mono'>{movement.plant}</div>
                </div>
              )}
              {movement.storageLocation && (
                <div>
                  <span className='text-muted-foreground'>SLoc</span>
                  <div className='font-mono'>{movement.storageLocation}</div>
                </div>
              )}
              {movement.delivery && (
                <div>
                  <span className='text-muted-foreground'>Delivery</span>
                  <div className='font-mono'>{movement.delivery}</div>
                </div>
              )}
              {movement.reference && (
                <div className='col-span-2'>
                  <span className='text-muted-foreground'>Reference Doc</span>
                  <div className='font-mono'>{movement.reference}</div>
                </div>
              )}
            </div>
          </div>

          {/* Sibling movements */}
          {siblings.length > 1 && (
            <div className='border-border space-y-2 border-t pt-3'>
              <div className='text-muted-foreground text-[10px] font-semibold tracking-widest uppercase'>
                Other items in TO #{movement.toNumber}
              </div>
              <div className='space-y-1'>
                {siblings
                  .filter(
                    (s) =>
                      !(
                        s.itemNumber === movement.itemNumber &&
                        s.movementType === movement.movementType
                      )
                  )
                  .map((s, i) => (
                    <button
                      key={`${s.itemNumber}-${i}`}
                      type='button'
                      onClick={() => onSelectSibling(s)}
                      className='border-border hover:border-primary/40 hover:bg-muted/30 group flex w-full items-center gap-2 rounded border p-2 text-left text-xs transition-colors'
                    >
                      <span className='text-muted-foreground bg-muted inline-flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[9px]'>
                        {s.itemNumber}
                      </span>
                      <BinChip
                        storageType={s.sourceStorageType}
                        bin={s.sourceBin}
                        size='sm'
                      />
                      <ArrowRight className='text-muted-foreground/60 h-3 w-3 shrink-0' />
                      <BinChip
                        storageType={s.destinationStorageType}
                        bin={s.destinationBin}
                        size='sm'
                      />
                      <span
                        className={cn(
                          'ml-auto h-2 w-2 rounded-full',
                          STATUS_DOT_CLASSES[s.status]
                        )}
                      />
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className='flex gap-2 pt-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => {
                void navigator.clipboard
                  .writeText(movement.toNumber)
                  .then(() => {
                    toast.success('TO number copied', {
                      description: movement.toNumber,
                    })
                  })
              }}
            >
              <Copy className='mr-1.5 h-3.5 w-3.5' />
              Copy TO #
            </Button>
            <Button size='sm' variant='outline' onClick={onClose}>
              <X className='mr-1.5 h-3.5 w-3.5' />
              Close
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Filter dropdown helper — small click-to-set chip with a count
// ──────────────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string
  active: boolean
  onClick: () => void
  count?: number
}

function FilterChip({ label, active, onClick, count }: FilterChipProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors duration-75',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background hover:bg-accent text-muted-foreground border-border/60 hover:text-foreground'
      )}
    >
      <span>{label}</span>
      {typeof count === 'number' && (
        <span
          className={cn(
            'rounded px-1 text-[10px] tabular-nums',
            active ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15'
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Empty / loading / error states
// ──────────────────────────────────────────────────────────────────────

function EmptyState({
  hasResult,
  isRunning,
}: {
  hasResult: boolean
  isRunning: boolean
}) {
  return (
    <Card className='border-dashed'>
      <CardContent className='flex flex-col items-center justify-center gap-3 py-16'>
        <div className='text-muted-foreground/40 relative'>
          <Route className='h-14 w-14' strokeWidth={1.25} />
          <span className='absolute right-0 bottom-0 inline-block h-3 w-3 animate-pulse rounded-full bg-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.7)]' />
        </div>
        <div className='space-y-1 text-center'>
          <h3 className='text-base font-semibold tracking-tight'>
            {isRunning
              ? 'Tracing the trail…'
              : hasResult
                ? 'No movements match your filters'
                : 'No movements yet'}
          </h3>
          <p className='text-muted-foreground max-w-sm text-sm'>
            {isRunning
              ? 'Walking LT24 — this can take a few seconds for large materials.'
              : hasResult
                ? 'Try clearing a filter or widening the date range.'
                : 'Run an LT24 query above to populate the trail. The trail will reconstruct each TO\u2019s physical journey from source bin to destination.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Main view
// ──────────────────────────────────────────────────────────────────────

export function TransferOrderHistoryView({
  result,
  isRunning,
  queryKey,
  queryInputs,
  onRefresh,
}: TransferOrderHistoryViewProps) {
  const [mode, setMode] = useState<'journey' | 'timeline'>('journey')
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTER)
  const [selectedMovement, setSelectedMovement] = useState<MovementRow | null>(
    null
  )
  const journeyScrollRef = useRef<HTMLDivElement>(null)

  // Reset scroll + filters when a fresh query lands so users don't end
  // up staring at the bottom of yesterday's result while today's data
  // sits unread above.
  useEffect(() => {
    setFilters(INITIAL_FILTER)
    journeyScrollRef.current?.scrollTo({ top: 0 })
  }, [queryKey])

  const movements = useMemo(() => {
    if (!result?.ok || !result.columns || !result.rows) return []
    return normaliseRows(result.columns, result.rows)
  }, [result])

  const distinctMovementTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of movements) {
      if (!m.movementType) continue
      counts.set(m.movementType, (counts.get(m.movementType) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
  }, [movements])

  const distinctStorageTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of movements) {
      for (const t of [m.sourceStorageType, m.destinationStorageType]) {
        if (!t) continue
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  }, [movements])

  const filteredMovements = useMemo(() => {
    const search = filters.search.trim().toLowerCase()
    return movements.filter((m) => {
      if (
        filters.movementType !== 'all' &&
        m.movementType !== filters.movementType
      ) {
        return false
      }
      if (filters.status !== 'all' && m.status !== filters.status) {
        return false
      }
      if (
        filters.storageType !== 'all' &&
        m.sourceStorageType !== filters.storageType &&
        m.destinationStorageType !== filters.storageType
      ) {
        return false
      }
      if (search) {
        const hay = [
          m.toNumber,
          m.material,
          m.description,
          m.sourceBin,
          m.destinationBin,
          m.delivery,
          m.reference,
          m.createdBy,
          m.confirmedBy,
          m.movementType,
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(search)) return false
      }
      return true
    })
  }, [movements, filters])

  // Group filtered movements by TO number for the journey view. Sort
  // groups by the latest activity timestamp so most-recent journeys
  // float to the top — matching how Linear's commit history reads.
  const journeys = useMemo(() => {
    const map = new Map<string, MovementRow[]>()
    for (const m of filteredMovements) {
      const arr = map.get(m.toNumber)
      if (arr) arr.push(m)
      else map.set(m.toNumber, [m])
    }
    const out = Array.from(map.entries()).map(([toNumber, ms]) => {
      const sorted = ms
        .slice()
        .sort((a, b) => Number(a.itemNumber) - Number(b.itemNumber))
      return { toNumber, movements: sorted }
    })
    out.sort((a, b) => {
      const aT = Math.max(
        ...a.movements.map((m) => m.confirmedAt ?? m.createdAt ?? 0)
      )
      const bT = Math.max(
        ...b.movements.map((m) => m.confirmedAt ?? m.createdAt ?? 0)
      )
      return bT - aT
    })
    return out
  }, [filteredMovements])

  const stats = useMemo(
    () => buildStats(filteredMovements, journeys.length),
    [filteredMovements, journeys.length]
  )

  // Day-clustered timeline rows — flat array in display order so the
  // virtualizer can index by row index without nested loops.
  const timelineRows = useMemo(() => {
    const sorted = filteredMovements
      .slice()
      .sort(
        (a, b) =>
          (b.createdAt ?? b.confirmedAt ?? 0) -
          (a.createdAt ?? a.confirmedAt ?? 0)
      )
    return clusterByDay(sorted)
  }, [filteredMovements])

  // Virtualisation — kicks in for journey view when journeys.length > 80
  // OR timeline movements > 200. Below that the native overflow is fine
  // and we get cleaner animations.
  const journeyVirtualRef = useRef<HTMLDivElement>(null)
  const useJourneyVirtual = journeys.length > 80
  // estimateSize matches the new dense JourneyCard footprint (~80–110px
  // for a single-leg TO, more for multi-leg). The virtualizer measures
  // actual heights as rows mount, so this only affects the very first
  // render before measurement.
  const journeyRowVirtualizer = useVirtualizer({
    count: journeys.length,
    getScrollElement: () => journeyVirtualRef.current,
    estimateSize: () => 96,
    overscan: 8,
    enabled: useJourneyVirtual,
  })

  // Selecting a movement also surfaces siblings (same TO).
  const siblings = useMemo<MovementRow[]>(() => {
    if (!selectedMovement) return []
    return movements.filter((m) => m.toNumber === selectedMovement.toNumber)
  }, [selectedMovement, movements])

  // CSV export — emits the SAME normalised set the user is looking at
  // (filters applied, ordering preserved). Headers are the friendly
  // field names so downstream Excel users don't have to decode SAP
  // column codes.
  const exportCsv = useCallback(() => {
    if (filteredMovements.length === 0) {
      toast.error('Nothing to export')
      return
    }
    const esc = (v: string | number) => {
      const s = String(v ?? '')
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = [
      'TO Number',
      'Item',
      'Movement Type',
      'Material',
      'Description',
      'Warehouse',
      'Plant',
      'Storage Location',
      'Source Storage Type',
      'Source Bin',
      'Destination Storage Type',
      'Destination Bin',
      'Quantity',
      'UoM',
      'Status',
      'Created On',
      'Created By',
      'Confirmed On',
      'Confirmed By',
      'Duration',
      'Delivery',
      'Reference Doc',
    ]
    const lines = filteredMovements.map((m) =>
      [
        m.toNumber,
        m.itemNumber,
        m.movementType,
        m.material,
        m.description,
        m.warehouse,
        m.plant,
        m.storageLocation,
        m.sourceStorageType,
        m.sourceBin,
        m.destinationStorageType,
        m.destinationBin,
        m.quantity,
        m.uom,
        m.status,
        m.createdAt != null ? new Date(m.createdAt).toISOString() : '',
        m.createdBy,
        m.confirmedAt != null ? new Date(m.confirmedAt).toISOString() : '',
        m.confirmedBy,
        m.durationMs != null ? formatRelative(m.durationMs) : '',
        m.delivery,
        m.reference,
      ]
        .map(esc)
        .join(',')
    )
    const csv = [headers.map(esc).join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const tag = queryInputs.material || queryInputs.to_number || 'lt24'
    a.download = `lt24-history-${tag}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported', {
      description: `${filteredMovements.length} movement(s) to CSV`,
    })
  }, [filteredMovements, queryInputs])

  // ── Render ────────────────────────────────────────────────────────
  if (!result) {
    return <EmptyState hasResult={false} isRunning={isRunning} />
  }
  if (!result.ok) {
    return (
      <Card className='border-destructive'>
        <CardHeader className='pb-2'>
          <CardTitle className='text-destructive flex items-center gap-2 text-sm'>
            <XCircle className='h-4 w-4' />
            LT24 query failed
          </CardTitle>
        </CardHeader>
        <CardContent className='text-destructive/80 text-xs'>
          {result.error ?? 'Unknown error from agent'}
        </CardContent>
      </Card>
    )
  }
  if (movements.length === 0) {
    return <EmptyState hasResult={true} isRunning={isRunning} />
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className='space-y-4'>
        {/* Stat ribbon — quiet bordered tiles instead of full Card chrome.
         *  Vertical density: ~46px tall vs the round-1 ~96px tile height. */}
        <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
          {stats.map((s) => {
            const Icon = s.icon
            return (
              <div
                key={s.id}
                className='border-border/40 bg-card/50 hover:border-border/70 flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors duration-75'
              >
                <div className='min-w-0 space-y-0.5'>
                  <div className='text-muted-foreground text-[10px] font-semibold tracking-widest uppercase'>
                    {s.label}
                  </div>
                  <div className='text-xl font-semibold tracking-tight tabular-nums'>
                    {s.value}
                  </div>
                  <div className='text-muted-foreground line-clamp-1 text-[10px]'>
                    {s.hint}
                  </div>
                </div>
                <Icon className={cn('h-4 w-4 shrink-0', s.accent)} />
              </div>
            )
          })}
        </div>

        {/* Toolbar — quieter chrome, denser controls. The Card is kept
         *  as a structural surface but its border + bg are softened so
         *  it doesn't compete with the content cards below. */}
        <Card className='border-border/40 bg-card/50 overflow-hidden shadow-none'>
          <CardHeader className='flex flex-col gap-2 space-y-0 pb-2 lg:flex-row lg:items-center lg:justify-between'>
            <div className='min-w-0 space-y-0.5'>
              <CardTitle className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                <History className='h-4 w-4 shrink-0' />
                Transfer Order History Trail
                <Badge
                  variant='secondary'
                  className='ml-1 h-5 px-1.5 py-0 text-[10px] tabular-nums'
                >
                  {filteredMovements.length.toLocaleString()} /{' '}
                  {movements.length.toLocaleString()}
                </Badge>
              </CardTitle>
              <p className='text-muted-foreground line-clamp-1 text-[11px]'>
                Each movement reconstructs the physical bin-to-bin journey.
                Click any chip for full row detail.
              </p>
            </div>
            <div className='flex items-center gap-1.5'>
              <Tabs
                value={mode}
                onValueChange={(v) => setMode(v as typeof mode)}
              >
                <TabsList className='h-7 p-0.5'>
                  <TabsTrigger
                    value='journey'
                    className='h-6 gap-1 px-2 text-[11px]'
                  >
                    <Route className='h-3 w-3' />
                    Journey
                  </TabsTrigger>
                  <TabsTrigger
                    value='timeline'
                    className='h-6 gap-1 px-2 text-[11px]'
                  >
                    <Clock className='h-3 w-3' />
                    Timeline
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {onRefresh && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={onRefresh}
                  disabled={isRunning}
                  title='Re-run the LT24 query'
                  className='h-7 px-2'
                >
                  <RefreshCw
                    className={cn('h-3.5 w-3.5', isRunning && 'animate-spin')}
                  />
                </Button>
              )}
              <Button
                size='sm'
                variant='outline'
                onClick={exportCsv}
                className='h-7 px-2 text-[11px]'
              >
                <Download className='mr-1 h-3.5 w-3.5' />
                Export
              </Button>
            </div>
          </CardHeader>

          <CardContent className='space-y-2 pt-0 pb-3'>
            {/* Filter bar — search + status. Search caps at xs so it
             *  doesn't dominate; chips wrap to a second line gracefully. */}
            <div className='border-border/40 flex flex-wrap items-center gap-2 border-t pt-2'>
              <div className='relative w-full max-w-xs'>
                <Search className='text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
                <Input
                  value={filters.search}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, search: e.target.value }))
                  }
                  placeholder='Search TO / material / bin / user…'
                  className='h-7 pl-8 text-[11px]'
                />
              </div>
              <div className='flex flex-wrap items-center gap-1'>
                <ListFilter className='text-muted-foreground mr-0.5 h-3 w-3' />
                <FilterChip
                  label='All'
                  active={filters.status === 'all'}
                  onClick={() => setFilters((f) => ({ ...f, status: 'all' }))}
                />
                <FilterChip
                  label='Confirmed'
                  active={filters.status === 'confirmed'}
                  onClick={() =>
                    setFilters((f) => ({ ...f, status: 'confirmed' }))
                  }
                  count={
                    movements.filter((m) => m.status === 'confirmed').length
                  }
                />
                <FilterChip
                  label='Pending'
                  active={filters.status === 'pending'}
                  onClick={() =>
                    setFilters((f) => ({ ...f, status: 'pending' }))
                  }
                  count={movements.filter((m) => m.status === 'pending').length}
                />
              </div>
            </div>

            {distinctMovementTypes.length > 0 && (
              <div className='flex flex-wrap items-center gap-1'>
                <span className='text-muted-foreground mr-0.5 text-[10px] font-semibold tracking-widest uppercase'>
                  Mvmt
                </span>
                <FilterChip
                  label='All'
                  active={filters.movementType === 'all'}
                  onClick={() =>
                    setFilters((f) => ({ ...f, movementType: 'all' }))
                  }
                />
                {distinctMovementTypes.map(([t, count]) => (
                  <FilterChip
                    key={t}
                    label={`${t} ${getMovementMeta(t).label}`}
                    active={filters.movementType === t}
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        movementType: f.movementType === t ? 'all' : t,
                      }))
                    }
                    count={count}
                  />
                ))}
              </div>
            )}

            {distinctStorageTypes.length > 0 && (
              <div className='flex flex-wrap items-center gap-1'>
                <span className='text-muted-foreground mr-0.5 text-[10px] font-semibold tracking-widest uppercase'>
                  Storage
                </span>
                <FilterChip
                  label='All'
                  active={filters.storageType === 'all'}
                  onClick={() =>
                    setFilters((f) => ({ ...f, storageType: 'all' }))
                  }
                />
                {distinctStorageTypes.map(([t, count]) => (
                  <FilterChip
                    key={t}
                    label={t}
                    active={filters.storageType === t}
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        storageType: f.storageType === t ? 'all' : t,
                      }))
                    }
                    count={count}
                  />
                ))}
              </div>
            )}

            {(filters.movementType !== 'all' ||
              filters.status !== 'all' ||
              filters.storageType !== 'all' ||
              filters.search) && (
              <div className='flex justify-end'>
                <Button
                  size='sm'
                  variant='ghost'
                  className='h-6 px-2 text-[11px]'
                  onClick={() => setFilters(INITIAL_FILTER)}
                >
                  <X className='mr-1 h-3 w-3' />
                  Clear filters
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Main area — Journey is a single bordered surface with rows
         *  divided by hairlines (no per-card margin). Timeline is a
         *  scroll surface with day-clusters separated by quiet
         *  hairlines instead of gradient lines. */}
        {filteredMovements.length === 0 ? (
          <EmptyState hasResult={true} isRunning={isRunning} />
        ) : mode === 'journey' ? (
          useJourneyVirtual ? (
            // Same wrapper logic as the non-virtualised branch:
            // border-x + border-t only, with the last (visible) card's
            // border-b acting as the wrapper bottom. Avoids a 2px
            // stack at the bottom of the scroll viewport.
            <div
              ref={journeyVirtualRef}
              className='border-border/40 bg-card/30 max-h-[70vh] overflow-y-auto rounded-md border-x border-t'
            >
              <div
                style={{
                  height: `${journeyRowVirtualizer.getTotalSize()}px`,
                  position: 'relative',
                  width: '100%',
                }}
              >
                {journeyRowVirtualizer.getVirtualItems().map((virtualItem) => {
                  const j = journeys[virtualItem.index]
                  return (
                    <div
                      key={j.toNumber}
                      ref={journeyRowVirtualizer.measureElement}
                      data-index={virtualItem.index}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <JourneyCard
                        toNumber={j.toNumber}
                        movements={j.movements}
                        onSelectMovement={setSelectedMovement}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            // Cards stack as direct children. Each carries its own
            // `border-b` hairline; the wrapper omits its own bottom
            // border so the last card's hairline doubles as the
            // wrapper's bottom edge (no 2px stack).
            <div
              ref={journeyScrollRef}
              className='border-border/40 bg-card/30 overflow-hidden rounded-md border-x border-t'
            >
              {journeys.map((j) => (
                <JourneyCard
                  key={j.toNumber}
                  toNumber={j.toNumber}
                  movements={j.movements}
                  onSelectMovement={setSelectedMovement}
                />
              ))}
            </div>
          )
        ) : (
          <Card className='border-border/40 bg-card/30 overflow-hidden shadow-none'>
            <CardContent className='p-2'>
              <ScrollArea className='max-h-[70vh] pr-2'>
                <div>
                  {timelineRows.map((cluster, clusterIdx) => (
                    <div
                      key={cluster.dayMs}
                      className={cn(
                        clusterIdx > 0 && 'border-border/30 mt-1 border-t pt-1'
                      )}
                    >
                      {/* Day header — minimal: small uppercase label,
                       *  inline count, hairline divider only. */}
                      <div className='bg-card/30 sticky top-0 z-10 -mx-2 flex items-center gap-2 px-2 py-1 backdrop-blur'>
                        <span className='text-muted-foreground text-[10px] font-semibold tracking-widest uppercase'>
                          {formatDayHeader(cluster.dayMs)}
                        </span>
                        <span className='text-muted-foreground/60 text-[10px] tabular-nums'>
                          ·{' '}
                          {cluster.movements.length === 1
                            ? '1 movement'
                            : `${cluster.movements.length} movements`}
                        </span>
                      </div>
                      <div className='pt-0.5'>
                        {cluster.movements.map((m, i) => (
                          <TimelineRow
                            key={`${m.toNumber}-${m.itemNumber}-${i}`}
                            movement={m}
                            onSelect={setSelectedMovement}
                            isLast={i === cluster.movements.length - 1}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        <DetailDrawer
          movement={selectedMovement}
          siblings={siblings}
          onClose={() => setSelectedMovement(null)}
          onSelectSibling={(m) => setSelectedMovement(m)}
        />
      </div>
    </TooltipProvider>
  )
}

// Created and developed by Jai Singh
