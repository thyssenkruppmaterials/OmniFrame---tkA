/**
 * LL01 Warehouse Activity Report — shared data model (2026-06-01).
 *
 * Pure transform from an `LL01RunResult` into a render-agnostic report model
 * consumed by BOTH the PDF (`ll01-report-pdf.ts`) and Excel
 * (`ll01-report-excel.ts`) generators, so the two outputs never drift. No DOM
 * / exceljs imports here — keep it unit-testable.
 *
 * Content (per the report spec): the Plant × Category heatmap + one aging
 * breakdown per category (Plant × >30/>60/>90 cumulative buckets, calendar-
 * quarter spread, top users). No trend.
 */
import {
  LL01_AGING_DATE_KEY,
  LL01_CATEGORY_META,
  LL01_PLANTS,
  LL01_USER_FIELD,
  bucketizeLL01Aging,
  classifyLL01Severity,
  ll01QuarterLabel,
  ll01QuarterSortKey,
  type LL01CategoryKey,
  type LL01RunResult,
  type LL01Severity,
} from '../components/warehouse-activity-monitor-types'

/** Traffic-light palette shared by both renderers. Hex for CSS; the Excel
 *  generator strips `#` and prepends `FF` for ARGB. Light fills so the report
 *  reads well on white paper. */
export const LL01_SEVERITY_COLORS: Record<
  LL01Severity,
  { bg: string; text: string; border: string }
> = {
  green: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  amber: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  red: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
}

export interface LL01ReportCell {
  plant: string
  count: number
  severity: LL01Severity
}

export interface LL01ReportHeatmapRow {
  key: LL01CategoryKey
  label: string
  cells: LL01ReportCell[]
  total: number
  severity: LL01Severity
}

export interface LL01ReportAgingPlantRow {
  plant: string
  gt30: number
  gt60: number
  gt90: number
  dated: number
  undated: number
}

export interface LL01ReportAgingSection {
  key: LL01CategoryKey
  label: string
  anchorKey: string
  userField: string | null
  byPlant: LL01ReportAgingPlantRow[]
  totals: {
    gt30: number
    gt60: number
    gt90: number
    dated: number
    undated: number
  }
  quarters: Array<{ quarter: string; total: number }>
  span: { oldest: string; newest: string } | null
  topUsers: Array<{ user: string; count: number }>
  totalRecords: number
}

export interface LL01ReportModel {
  ranAt: string
  agentId: string
  generatedAt: string
  plants: string[]
  totalRecords: number
  payloadVersion: number
  supportsAging: boolean
  heatmap: LL01ReportHeatmapRow[]
  plantTotals: Array<{ plant: string; total: number }>
  grandTotal: number
  aging: LL01ReportAgingSection[]
}

const EMPTY_BUCKETS = { gt30: 0, gt60: 0, gt90: 0, dated: 0, undated: 0 }

export function buildLL01ReportModel(result: LL01RunResult): LL01ReportModel {
  const plants =
    result.plants && result.plants.length > 0 ? result.plants : [...LL01_PLANTS]
  const catByKey = new Map((result.categories ?? []).map((c) => [c.key, c]))
  const payloadVersion = result.payload_version ?? 1
  const supportsAging = payloadVersion >= 2

  const heatmap: LL01ReportHeatmapRow[] = LL01_CATEGORY_META.map((meta) => {
    const cat = catByKey.get(meta.key)
    const cells = plants.map((plant) => {
      const count = cat?.counts_by_plant?.[plant] ?? 0
      return {
        plant,
        count,
        severity: classifyLL01Severity(count, meta.thresholds),
      }
    })
    const total = cells.reduce((s, c) => s + c.count, 0)
    return {
      key: meta.key,
      label: meta.label,
      cells,
      total,
      severity: classifyLL01Severity(total, meta.thresholds),
    }
  })

  const plantTotals = plants.map((plant) => ({
    plant,
    total: heatmap.reduce(
      (s, row) => s + (row.cells.find((c) => c.plant === plant)?.count ?? 0),
      0
    ),
  }))
  const grandTotal = heatmap.reduce((s, row) => s + row.total, 0)

  const aging: LL01ReportAgingSection[] = LL01_CATEGORY_META.map((meta) => {
    const cat = catByKey.get(meta.key)
    const anchorKey = LL01_AGING_DATE_KEY[meta.key]
    const userField = LL01_USER_FIELD[meta.key]
    const rows = cat?.rows ?? []

    const byPlant = plants.map((plant) => {
      const slice = rows.filter((r) => String(r._plant ?? '') === plant)
      return { plant, ...bucketizeLL01Aging(slice, anchorKey) }
    })
    const totals = byPlant.reduce(
      (acc, b) => ({
        gt30: acc.gt30 + b.gt30,
        gt60: acc.gt60 + b.gt60,
        gt90: acc.gt90 + b.gt90,
        dated: acc.dated + b.dated,
        undated: acc.undated + b.undated,
      }),
      { ...EMPTY_BUCKETS }
    )

    const perQuarter = new Map<string, number>()
    let oldest: { k: number; l: string } | null = null
    let newest: { k: number; l: string } | null = null
    for (const row of rows) {
      const label = ll01QuarterLabel(row[anchorKey])
      if (!label) continue
      perQuarter.set(label, (perQuarter.get(label) ?? 0) + 1)
      const k = ll01QuarterSortKey(label)
      if (!oldest || k < oldest.k) oldest = { k, l: label }
      if (!newest || k > newest.k) newest = { k, l: label }
    }
    const quarters = [...perQuarter.entries()]
      .map(([quarter, total]) => ({ quarter, total }))
      .sort(
        (a, b) => ll01QuarterSortKey(a.quarter) - ll01QuarterSortKey(b.quarter)
      )

    let topUsers: Array<{ user: string; count: number }> = []
    if (userField) {
      const counts = new Map<string, number>()
      for (const row of rows) {
        const u = String(row[userField] ?? '').trim()
        if (!u) continue
        counts.set(u, (counts.get(u) ?? 0) + 1)
      }
      topUsers = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([user, count]) => ({ user, count }))
    }

    return {
      key: meta.key,
      label: meta.label,
      anchorKey,
      userField,
      byPlant,
      totals,
      quarters,
      span: oldest && newest ? { oldest: oldest.l, newest: newest.l } : null,
      topUsers,
      totalRecords: cat?.total ?? rows.length,
    }
  })

  return {
    ranAt: result.ran_at,
    agentId: result.agent_id,
    generatedAt: new Date().toISOString(),
    plants,
    totalRecords: grandTotal,
    payloadVersion,
    supportsAging,
    heatmap,
    plantTotals,
    grandTotal,
    aging,
  }
}

/** `Warehouse-Activity-Monitor_2026-06-01_0512` style stem (no extension). */
export function ll01ReportFilenameStem(model: LL01ReportModel): string {
  const d = new Date(model.ranAt)
  const valid = !Number.isNaN(d.getTime()) ? d : new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(
    valid.getDate()
  )}_${pad(valid.getHours())}${pad(valid.getMinutes())}`
  return `Warehouse-Activity-Monitor_${stamp}`
}
