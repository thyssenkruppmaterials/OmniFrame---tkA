// Created and developed by Jai Singh
/**
 * Types + constants for LL01 Warehouse Activity Monitor (2026-05-22).
 * Keep plant list in lockstep with `LL01_PLANTS` in
 * `omni_agent/ll01_warehouse_activity_monitor.py`.
 */

export type LL01CategoryKey =
  | 'open_to'
  | 'open_tr'
  | 'open_posting'
  | 'critical_delivery'
  | 'negative_stock'
  | 'interim_stock'
  | 'critical_stock_production'

export type LL01Severity = 'green' | 'amber' | 'red'

export interface LL01CategoryThresholds {
  green: number
  amber: number
}

export interface LL01CategoryResult {
  key: LL01CategoryKey
  label: string
  thresholds: LL01CategoryThresholds
  counts_by_plant: Record<string, number>
  total: number
  rows: Record<string, unknown>[]
}

export interface LL01SnapshotRow {
  ran_at: string
  plant: string
  category: LL01CategoryKey
  count: number
  snapshot_run_id?: string
}

export interface LL01RunError {
  plant: string
  category: string
  step: string
  detail: string
}

export interface LL01RunResult {
  ok: boolean
  /**
   * Worker payload version. v1 = original counts/heatmap shape (2026-05-22).
   * v2 = additive aging anchor fields (`created_on`, `created_by`) on
   * `open_to`/`open_tr`/`open_posting` plus `payload_version` echoed in
   * the response (2026-05-27). The Aging tab requires v2; older runs
   * fall back to a "Re-run on a current agent build" placeholder.
   */
  payload_version?: number
  snapshot_run_id: string
  ran_at: string
  agent_id: string
  duration_ms: number
  plants: string[]
  categories: LL01CategoryResult[]
  errors: LL01RunError[]
}

export interface LL01Progress {
  running: boolean
  plant_index: number
  plant_total: number
  category_index: number
  category_total: number
  label: string
  elapsed_sec: number
}

/**
 * A saved run as listed by the history date picker. This is the slim INDEX
 * shape (no `categories` payload) read from `ll01_activity_runs`; the full
 * `LL01RunResult` is fetched lazily on selection. Persisted by the agent on
 * every run (migration 333) and kept indefinitely.
 */
export interface LL01RunIndexEntry {
  snapshot_run_id: string
  ran_at: string
  ok: boolean
}

/** Matches the agent's per-plant progress line, e.g. `[ll01] Plant 2/5: JSM`,
 *  relayed to the browser via `WsEvent::SapAgentConsoleLine`. */
const LL01_PLANT_LINE_RE = /\[ll01\]\s*Plant\s+(\d+)\s*\/\s*(\d+)\s*:\s*(.+)/i

export interface LL01PlantLine {
  plantIndex: number
  plantTotal: number
  plant: string
}

/**
 * Pure parser for the agent's `[ll01] Plant X/Y: PLANT` console line. Returns
 * null when the line isn't a recognisable LL01 plant tick (so an unexpected
 * line is ignored rather than throwing). Drives the FLEET-mode progress bar
 * from the relayed console stream — see `useLL01FleetProgress`.
 */
export function parseLL01PlantLine(message: string): LL01PlantLine | null {
  const m = LL01_PLANT_LINE_RE.exec(message)
  if (!m) return null
  const plantIndex = Number(m[1])
  const plantTotal = Number(m[2])
  const plant = m[3].trim()
  if (
    !Number.isFinite(plantIndex) ||
    !Number.isFinite(plantTotal) ||
    plantTotal <= 0 ||
    plantIndex <= 0
  ) {
    return null
  }
  return { plantIndex, plantTotal, plant }
}

/** Default plants — matches agent `LL01_PLANTS`. */
export const LL01_PLANTS: readonly string[] = [
  'JSF',
  'JSM',
  'PDC',
  'WH5',
  'WH8',
]

export const LL01_CATEGORY_META: ReadonlyArray<{
  key: LL01CategoryKey
  label: string
  thresholds: LL01CategoryThresholds
  rowIndex: number
}> = [
  {
    key: 'open_to',
    label: 'Open Transfer Orders',
    thresholds: { green: 100, amber: 500 },
    rowIndex: 3,
  },
  {
    key: 'open_tr',
    label: 'Open Transfer Requirements',
    thresholds: { green: 500, amber: 2000 },
    rowIndex: 4,
  },
  {
    key: 'open_posting',
    label: 'Open Posting Changes',
    thresholds: { green: 50, amber: 200 },
    rowIndex: 5,
  },
  {
    key: 'critical_delivery',
    label: 'Critical Deliveries',
    thresholds: { green: 25, amber: 100 },
    rowIndex: 6,
  },
  {
    key: 'negative_stock',
    label: 'Negative Stock',
    thresholds: { green: 25, amber: 100 },
    rowIndex: 7,
  },
  {
    key: 'interim_stock',
    label: 'Interim Stock w/o Movement',
    thresholds: { green: 100, amber: 500 },
    rowIndex: 8,
  },
  {
    key: 'critical_stock_production',
    label: 'Critical Stock in Production',
    thresholds: { green: 25, amber: 100 },
    rowIndex: 9,
  },
]

/** Drilldown column order per category (SAP header labels). */
export const LL01_DRILLDOWN_COLUMNS: Record<LL01CategoryKey, string[]> = {
  open_to: [
    'to_number',
    'item',
    'company',
    'warehouse',
    'movement_type',
    'material',
    'source_target_qty',
    'source_storage_type',
    'source_bin',
    'dest_storage_type',
    'dest_bin',
    'plant',
    'created_on',
    'created_by',
  ],
  open_tr: [
    'tr_number',
    'item',
    'warehouse',
    'movement_type',
    'material',
    'tr_quantity',
    'source_type',
    'plant',
    'storage_location',
    'created_on',
  ],
  open_posting: [
    'posting_change_no',
    'warehouse',
    'movement_type',
    'material',
    'plant',
    'storage_location',
    'user',
    'posting_change_qty',
    'created_on',
  ],
  critical_delivery: [
    'warehouse',
    'delivery',
    'shipping_point',
    'delivery_type',
    'ship_to',
    'number_of_packages',
    'loading_date',
    'created_on',
    'created_by',
    'delivery_priority',
    'delivery_date',
    'external_delivery_id',
  ],
  negative_stock: [
    'material',
    'tr_number',
    'plant',
    'warehouse',
    'storage_type',
    'storage_bin',
    'total_stock',
    'base_unit',
    'last_movement_date',
    'last_movement_time',
  ],
  interim_stock: [
    'warehouse',
    'material',
    'plant',
    'storage_type',
    'storage_bin',
    'total_stock',
    'base_unit',
    'last_movement_date',
    'last_movement_time',
    'aging_days',
  ],
  critical_stock_production: [
    'material',
    'plant',
    'storage_type',
    'storage_bin',
    'total_stock',
    'base_unit',
    'last_movement_date',
    'last_movement_time',
    'available_stock',
    'goods_receipt_date',
  ],
}

export function classifyLL01Severity(
  count: number,
  thresholds: LL01CategoryThresholds
): LL01Severity {
  if (count <= thresholds.green) return 'green'
  if (count <= thresholds.amber) return 'amber'
  return 'red'
}

export function trendArrow(
  current: number,
  prior: number | null | undefined
): 'up' | 'flat' | 'down' | null {
  if (prior == null || prior === 0) return null
  const deltaPct = ((current - prior) / prior) * 100
  if (deltaPct > 10) return 'up'
  if (deltaPct < -10) return 'down'
  return 'flat'
}

/* -------------------------------------------------------------------------
 * Aging-tab metadata (2026-05-27)
 *
 * The Aging tab derives every aggregate from the live row payload. These
 * maps tell the UI which row field to read for two cross-cutting axes:
 *
 *   - `LL01_AGING_DATE_KEY` — anchor date for "today − date" days math.
 *   - `LL01_USER_FIELD`     — the SAP user column, when present.
 *
 * Categories whose underlying SAP list lacks a user column map to `null`,
 * which the UI uses to render a clear "Not available for this category"
 * fallback instead of an empty table.
 *
 * Source: Patterns/LL01-Aging-Breakdown.md (verified against
 * MacWindowsBridge/LL01_Worker_Full/LL01 Stack.xlsx).
 * ------------------------------------------------------------------------- */
export const LL01_AGING_DATE_KEY: Record<LL01CategoryKey, string> = {
  open_to: 'created_on',
  open_tr: 'created_on',
  open_posting: 'created_on',
  critical_delivery: 'created_on',
  negative_stock: 'last_movement_date',
  interim_stock: 'last_movement_date',
  critical_stock_production: 'last_movement_date',
}

export const LL01_USER_FIELD: Record<LL01CategoryKey, string | null> = {
  open_to: 'created_by',
  open_tr: null,
  open_posting: 'user',
  critical_delivery: 'created_by',
  negative_stock: null,
  interim_stock: null,
  critical_stock_production: null,
}

export interface LL01AgingBuckets {
  /** Cumulative count: items aged ≥ 30 days (includes >60 and >90). */
  gt30: number
  /** Cumulative count: items aged ≥ 60 days (includes >90). */
  gt60: number
  /** Cumulative count: items aged ≥ 90 days. */
  gt90: number
  /** Items with a parseable anchor date (denominator for percentages). */
  dated: number
  /** Items where the row lacked a parseable anchor date. */
  undated: number
}

const MS_PER_DAY = 86_400_000

/**
 * Cumulative aging buckets for a slice of rows. `>30` includes anything
 * `>60`, which includes `>90` — see Patterns/LL01-Aging-Breakdown.md for
 * the rationale (operations leadership reads "over 30" as a gate, not
 * a discrete bin). Discrete bins are derivable as
 *   `30-60 = gt30 - gt60`, `60-90 = gt60 - gt90`.
 */
export function bucketizeLL01Aging(
  rows: ReadonlyArray<Record<string, unknown>>,
  anchorKey: string,
  now: number = Date.now()
): LL01AgingBuckets {
  let gt30 = 0
  let gt60 = 0
  let gt90 = 0
  let dated = 0
  let undated = 0
  for (const row of rows) {
    const raw = row[anchorKey]
    if (raw == null || raw === '') {
      undated += 1
      continue
    }
    const ts = new Date(String(raw)).getTime()
    if (!Number.isFinite(ts)) {
      undated += 1
      continue
    }
    dated += 1
    const days = (now - ts) / MS_PER_DAY
    if (days >= 30) gt30 += 1
    if (days >= 60) gt60 += 1
    if (days >= 90) gt90 += 1
  }
  return { gt30, gt60, gt90, dated, undated }
}

/** Calendar quarter label `YYYY-Qn` for an ISO date string, or `null`. */
export function ll01QuarterLabel(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  const ts = new Date(String(raw)).getTime()
  if (!Number.isFinite(ts)) return null
  const d = new Date(ts)
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return `${d.getUTCFullYear()}-Q${q}`
}

/** Sort key for `YYYY-Qn` strings — `2024-Q4` < `2025-Q1`. */
export function ll01QuarterSortKey(label: string): number {
  const m = /^(\d{4})-Q([1-4])$/.exec(label)
  if (!m) return 0
  return Number(m[1]) * 4 + Number(m[2])
}

// Created and developed by Jai Singh
