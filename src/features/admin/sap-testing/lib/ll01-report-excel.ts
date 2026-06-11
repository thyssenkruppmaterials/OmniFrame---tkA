/**
 * LL01 Warehouse Activity Report — Excel (.xlsx) generator (2026-06-01).
 *
 * Styled workbook via the project's existing (lazy, bundle-exempt) `exceljs`:
 *   - "Heatmap" sheet: Plant × Category grid with traffic-light fills + totals.
 *   - "Aging" sheet: one stacked section per category (Plant × >30/>60/>90
 *     cumulative buckets, quarter spread, top users). No trend.
 *
 * Consumes the shared `LL01ReportModel` so it never drifts from the PDF.
 */
// exceljs is loaded lazily at call time (see `generateLL01Excel`) so it never
// lands in the initial bundle.
import type ExcelJSNS from 'exceljs'
import type { LL01Severity } from '../components/warehouse-activity-monitor-types'
import {
  LL01_SEVERITY_COLORS,
  ll01ReportFilenameStem,
  type LL01ReportModel,
  type LL01ReportAgingSection,
} from './ll01-report'

type Worksheet = ExcelJSNS.Worksheet
type FillPattern = ExcelJSNS.FillPattern

const INK = 'FF1E293B'
const ACCENT = 'FF4F46E5'
const MUTED = 'FF64748B'
const BORDER = 'FFE2E8F0'
const HEAD_TEXT = 'FFFFFFFF'

function argb(hex: string): string {
  return 'FF' + hex.replace('#', '').toUpperCase()
}

function solid(hex: string): FillPattern {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: hex } }
}

function severityFill(sev: LL01Severity): FillPattern {
  return solid(argb(LL01_SEVERITY_COLORS[sev].bg))
}

function severityFont(sev: LL01Severity): Partial<ExcelJSNS.Font> {
  return { color: { argb: argb(LL01_SEVERITY_COLORS[sev].text) }, bold: true }
}

const THIN = { style: 'thin' as const, color: { argb: BORDER } }
const ALL_THIN = { top: THIN, left: THIN, bottom: THIN, right: THIN }

function headerCells(ws: Worksheet, rowNum: number, count: number): void {
  const row = ws.getRow(rowNum)
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c)
    cell.fill = solid(INK)
    cell.font = { bold: true, color: { argb: HEAD_TEXT }, size: 10 }
    cell.alignment = {
      horizontal: c === 1 ? 'left' : 'center',
      vertical: 'middle',
    }
    cell.border = ALL_THIN
  }
}

function writeHeatmapSheet(ws: Worksheet, model: LL01ReportModel): void {
  const colCount = model.plants.length + 2 // Category + plants + Total
  ws.columns = [
    { width: 30 },
    ...model.plants.map(() => ({ width: 12 })),
    { width: 12 },
  ]

  ws.mergeCells(1, 1, 1, colCount)
  const title = ws.getCell(1, 1)
  title.value = 'Warehouse Activity Monitor — LL01'
  title.font = { bold: true, size: 16, color: { argb: INK } }
  ws.getRow(1).height = 24

  ws.mergeCells(2, 1, 2, colCount)
  const sub = ws.getCell(2, 1)
  sub.value = `Run ${new Date(model.ranAt).toLocaleString()} · ${model.totalRecords.toLocaleString()} flagged records · ${model.plants.length} plants`
  sub.font = { size: 10, color: { argb: MUTED } }

  const headRow = 4
  const head = ws.getRow(headRow)
  head.getCell(1).value = 'Category'
  model.plants.forEach((p, i) => (head.getCell(2 + i).value = p))
  head.getCell(colCount).value = 'Total'
  headerCells(ws, headRow, colCount)

  let r = headRow + 1
  for (const row of model.heatmap) {
    const xlRow = ws.getRow(r)
    const labelCell = xlRow.getCell(1)
    labelCell.value = row.label
    labelCell.font = { bold: false }
    labelCell.border = ALL_THIN
    labelCell.alignment = { vertical: 'middle' }
    row.cells.forEach((c, i) => {
      const cell = xlRow.getCell(2 + i)
      cell.value = c.count
      cell.fill = severityFill(c.severity)
      cell.font = severityFont(c.severity)
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = ALL_THIN
    })
    const totalCell = xlRow.getCell(colCount)
    totalCell.value = row.total
    totalCell.fill = severityFill(row.severity)
    totalCell.font = severityFont(row.severity)
    totalCell.alignment = { horizontal: 'center', vertical: 'middle' }
    totalCell.border = ALL_THIN
    r++
  }

  const totalsRow = ws.getRow(r)
  totalsRow.getCell(1).value = 'Total'
  model.plantTotals.forEach(
    (p, i) => (totalsRow.getCell(2 + i).value = p.total)
  )
  totalsRow.getCell(colCount).value = model.grandTotal
  for (let c = 1; c <= colCount; c++) {
    const cell = totalsRow.getCell(c)
    cell.font = { bold: true, color: { argb: INK } }
    cell.fill = solid('FFF1F5F9')
    cell.alignment = {
      horizontal: c === 1 ? 'left' : 'center',
      vertical: 'middle',
    }
    cell.border = {
      ...ALL_THIN,
      top: { style: 'medium', color: { argb: 'FFCBD5E1' } },
    }
  }

  ws.views = [{ state: 'frozen', ySplit: headRow }]
}

function writeAgingSection(
  ws: Worksheet,
  section: LL01ReportAgingSection,
  startRow: number,
  colCount: number,
  supportsAging: boolean
): number {
  let r = startRow

  ws.mergeCells(r, 1, r, colCount)
  const titleCell = ws.getCell(r, 1)
  titleCell.value = section.label
  titleCell.font = { bold: true, size: 12, color: { argb: HEAD_TEXT } }
  titleCell.fill = solid(ACCENT)
  titleCell.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(r).height = 20
  r++

  ws.mergeCells(r, 1, r, colCount)
  const metaCell = ws.getCell(r, 1)
  metaCell.value = supportsAging
    ? `${section.totalRecords.toLocaleString()} records · aged by ${section.anchorKey.replace(/_/g, ' ')}${section.span ? ` · ${section.span.oldest} → ${section.span.newest}` : ''}`
    : `${section.totalRecords.toLocaleString()} records · aging requires a current (v2) agent run`
  metaCell.font = { size: 9, italic: true, color: { argb: MUTED } }
  r++

  if (!supportsAging) {
    r++ // spacer
    return r
  }

  // Plant × bucket header
  const headCols = ['Plant', '>30d', '>60d', '>90d', 'Dated', 'Undated']
  const head = ws.getRow(r)
  headCols.forEach((h, i) => (head.getCell(1 + i).value = h))
  headerCells(ws, r, headCols.length)
  r++

  for (const b of section.byPlant) {
    const row = ws.getRow(r)
    row.getCell(1).value = b.plant
    row.getCell(2).value = b.gt30
    row.getCell(3).value = b.gt60
    row.getCell(4).value = b.gt90
    row.getCell(5).value = b.dated
    row.getCell(6).value = b.undated
    for (let c = 1; c <= 6; c++) {
      const cell = row.getCell(c)
      cell.alignment = { horizontal: c === 1 ? 'left' : 'center' }
      cell.border = ALL_THIN
      if (c >= 2 && c <= 4) {
        const count = [b.gt30, b.gt60, b.gt90][c - 2]
        const pct = b.dated > 0 ? count / b.dated : 0
        if (count > 0) {
          cell.fill = severityFill(
            pct < 0.05 ? 'green' : pct < 0.2 ? 'amber' : 'red'
          )
        }
      } else if (c > 4) {
        cell.font = { color: { argb: MUTED } }
      }
    }
    r++
  }
  const t = section.totals
  const totalsRow = ws.getRow(r)
  ;['Total', t.gt30, t.gt60, t.gt90, t.dated, t.undated].forEach(
    (v, i) => (totalsRow.getCell(1 + i).value = v)
  )
  for (let c = 1; c <= 6; c++) {
    const cell = totalsRow.getCell(c)
    cell.font = { bold: true, color: { argb: INK } }
    cell.fill = solid('FFF1F5F9')
    cell.alignment = { horizontal: c === 1 ? 'left' : 'center' }
    cell.border = ALL_THIN
  }
  r++

  // Quarter spread (single line)
  if (section.quarters.length > 0) {
    ws.mergeCells(r, 1, r, colCount)
    const q = ws.getCell(r, 1)
    q.value =
      'By quarter: ' +
      section.quarters.map((x) => `${x.quarter} (${x.total})`).join('  ·  ')
    q.font = { size: 9, color: { argb: INK } }
    r++
  }

  // Top users
  if (section.userField && section.topUsers.length > 0) {
    const uh = ws.getRow(r)
    uh.getCell(1).value = `Top users (${section.userField})`
    uh.getCell(2).value = 'Records'
    headerCells(ws, r, 2)
    r++
    for (const u of section.topUsers) {
      const row = ws.getRow(r)
      row.getCell(1).value = u.user
      row.getCell(2).value = u.count
      row.getCell(1).border = ALL_THIN
      row.getCell(2).border = ALL_THIN
      row.getCell(2).alignment = { horizontal: 'center' }
      r++
    }
  }

  r += 2 // spacer before next section
  return r
}

export async function generateLL01Excel(model: LL01ReportModel): Promise<void> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.default.Workbook()
  workbook.creator = 'OmniFrame'
  workbook.created = new Date()

  const heatmap = workbook.addWorksheet('Heatmap', {
    views: [{ showGridLines: false }],
  })
  writeHeatmapSheet(heatmap, model)

  const aging = workbook.addWorksheet('Aging', {
    views: [{ showGridLines: false }],
  })
  aging.columns = [
    { width: 22 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ]
  let r = 1
  for (const section of model.aging) {
    r = writeAgingSection(aging, section, r, 6, model.supportsAging)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${ll01ReportFilenameStem(model)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
