/**
 * Visitor Log Hooks
 *
 * Uses the Rust-based Smartsheet infrastructure to fetch and manage
 * the RR Visitation Log. Provides visitor-specific data transformation
 * and approval/denial actions.
 */
import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  CellData,
  ColumnData,
  RowData,
} from '@/lib/rust-core/smartsheet.service'
import {
  SMARTSHEET_QUERY_KEYS,
  useSmartsheetSheet,
  useUpdateCells,
} from '@/hooks/useSmartsheet'

// ==================== CONSTANTS ====================

export const VISITOR_LOG_SHEET_ID = 1260552974192516

export const DEFAULT_PAGE_SIZE = 50
export const INITIAL_LOAD_SIZE = 50

// ==================== TYPES ====================

export enum ApprovalStatus {
  PENDING = 'Pending',
  APPROVED = 'Approved',
  DENIED = 'Not Approved',
  BLANK = '',
}

export interface VisitorRecord {
  row_id: number
  name: string
  visitor_email: string
  company: string
  department: string
  arrival_date: string
  time_in_out: string
  check_in: string
  duration_hours: string
  check_out: string
  reason_scope: string
  ilc_poc: string
  backup_poc: string
  ilc_poc_appointment_count: string
  approval_status: ApprovalStatus
  response: string
  acknowledgement: string
  tooling_equipment: string
  us_person: boolean
  us_citizen: boolean
  request_date: string
  within_24_hours: boolean
  tka_asset_support: string
  check_in_helper: string
  created_at?: string
  modified_at?: string
}

export interface VisitorColumnMapping {
  name?: number
  visitor_email?: number
  company?: number
  department?: number
  arrival_date?: number
  time_in_out?: number
  check_in?: number
  duration_hours?: number
  check_out?: number
  reason_scope?: number
  ilc_poc?: number
  backup_poc?: number
  ilc_poc_appointment_count?: number
  approval_status?: number
  response?: number
  acknowledgement?: number
  tooling_equipment?: number
  us_person?: number
  us_citizen?: number
  request_date?: number
  within_24_hours?: number
  tka_asset_support?: number
  check_in_helper?: number
}

export type VisitorFilterStatus =
  | 'all'
  | 'this_week'
  | 'today'
  | 'pending'
  | 'approved'
  | 'denied'

export interface VisitorStats {
  total: number
  pending: number
  approved: number
  denied: number
  todayVisitors: number
  thisWeekVisitors: number
  checkedIn: number
}

/** Get the Monday (start) and Sunday (end) of the current week */
export function getCurrentWeekRange(): { start: Date; end: Date } {
  const now = new Date()
  const day = now.getDay() // 0=Sun, 1=Mon...
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { start: monday, end: sunday }
}

/**
 * Parse a date string as LOCAL midnight to avoid UTC timezone shift.
 * "2026-02-09" via `new Date()` = UTC midnight, which shifts to the
 * prior day in negative-offset (US) timezones. Splitting the parts avoids this.
 */
export function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null
  // YYYY-MM-DD
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  // MM/DD/YYYY
  const slash = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (slash)
    return new Date(Number(slash[3]), Number(slash[1]) - 1, Number(slash[2]))
  // Fallback
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Check if a date string falls within the current week (Mon-Sun) */
export function isCurrentWeek(dateStr: string): boolean {
  if (!dateStr) return false
  try {
    const { start, end } = getCurrentWeekRange()
    const d = parseLocalDate(dateStr)
    if (!d) return false
    return d >= start && d <= end
  } catch {
    return false
  }
}

// ==================== COLUMN MAPPING ====================

function buildColumnMapping(columns: ColumnData[]): VisitorColumnMapping {
  const mapping: VisitorColumnMapping = {}

  for (const col of columns) {
    const title = col.title
      .toLowerCase()
      .replace(/\s+/g, '_')
      // eslint-disable-next-line no-useless-escape
      .replace(/[()\/]/g, '')

    switch (title) {
      case 'name':
        mapping.name = col.id
        break
      case 'visitor_email':
        mapping.visitor_email = col.id
        break
      case 'company':
        mapping.company = col.id
        break
      case 'department':
        mapping.department = col.id
        break
      case 'arrival_date':
        mapping.arrival_date = col.id
        break
      case 'time_inout':
      case 'time_in_out':
        mapping.time_in_out = col.id
        break
      case 'check_in':
        // Distinguish between "Check In" and "Check In (Helper)"
        if (col.title === 'Check In') {
          mapping.check_in = col.id
        } else if (col.title === 'Check In (Helper)') {
          mapping.check_in_helper = col.id
        }
        break
      case 'check_in_helper':
        mapping.check_in_helper = col.id
        break
      case 'duration_hours':
        mapping.duration_hours = col.id
        break
      case 'check_out':
        mapping.check_out = col.id
        break
      case 'reasonscope_of_work':
      case 'reason_scope_of_work':
        mapping.reason_scope = col.id
        break
      case 'ilc_poc':
        mapping.ilc_poc = col.id
        break
      case 'backup_poc':
        mapping.backup_poc = col.id
        break
      case 'ilc_poc_appointment_count':
        mapping.ilc_poc_appointment_count = col.id
        break
      case 'approval_status':
        mapping.approval_status = col.id
        break
      case 'response':
        mapping.response = col.id
        break
      case 'acknowledgement':
        mapping.acknowledgement = col.id
        break
      case 'toolingequipmentmaterials':
      case 'tooling_equipment_materials':
        mapping.tooling_equipment = col.id
        break
      case 'us_person':
        mapping.us_person = col.id
        break
      case 'us_citizen':
        mapping.us_citizen = col.id
        break
      case 'request_date':
        mapping.request_date = col.id
        break
      case 'within_24-hours':
      case 'within_24_hours':
        mapping.within_24_hours = col.id
        break
      case 'tka_asset_support_needed':
        mapping.tka_asset_support = col.id
        break
    }
  }

  return mapping
}

function getCellValue(cells: CellData[], columnId: number | undefined): string {
  if (!columnId) return ''
  const cell = cells.find((c) => c.column_id === columnId)
  return (cell?.display_value ?? (cell?.value as string) ?? '') as string
}

function getCheckboxValue(
  cells: CellData[],
  columnId: number | undefined
): boolean {
  if (!columnId) return false
  const cell = cells.find((c) => c.column_id === columnId)
  if (!cell) return false
  const value = cell.value
  if (typeof value === 'boolean') return value
  if (typeof value === 'string')
    return value.toLowerCase() === 'true' || value === '1'
  if (typeof value === 'number') return value === 1
  return false
}

function normalizeApprovalStatus(raw: string | undefined): ApprovalStatus {
  if (!raw || raw.trim() === '') return ApprovalStatus.BLANK
  const lower = raw.toLowerCase().trim()
  if (lower === 'approved') return ApprovalStatus.APPROVED
  if (lower === 'denied' || lower === 'rejected' || lower === 'not approved')
    return ApprovalStatus.DENIED
  if (lower === 'pending') return ApprovalStatus.PENDING
  return raw as ApprovalStatus
}

function parseVisitorFromRow(
  row: RowData,
  mapping: VisitorColumnMapping
): VisitorRecord {
  const cells = row.cells || []
  return {
    row_id: row.id,
    name: getCellValue(cells, mapping.name),
    visitor_email: getCellValue(cells, mapping.visitor_email),
    company: getCellValue(cells, mapping.company),
    department: getCellValue(cells, mapping.department),
    arrival_date: getCellValue(cells, mapping.arrival_date),
    time_in_out: getCellValue(cells, mapping.time_in_out),
    check_in: getCellValue(cells, mapping.check_in),
    duration_hours: getCellValue(cells, mapping.duration_hours),
    check_out: getCellValue(cells, mapping.check_out),
    reason_scope: getCellValue(cells, mapping.reason_scope),
    ilc_poc: getCellValue(cells, mapping.ilc_poc),
    backup_poc: getCellValue(cells, mapping.backup_poc),
    ilc_poc_appointment_count: getCellValue(
      cells,
      mapping.ilc_poc_appointment_count
    ),
    approval_status: normalizeApprovalStatus(
      getCellValue(cells, mapping.approval_status)
    ),
    response: getCellValue(cells, mapping.response),
    acknowledgement: getCellValue(cells, mapping.acknowledgement),
    tooling_equipment: getCellValue(cells, mapping.tooling_equipment),
    us_person: getCheckboxValue(cells, mapping.us_person),
    us_citizen: getCheckboxValue(cells, mapping.us_citizen),
    request_date: getCellValue(cells, mapping.request_date),
    within_24_hours: getCheckboxValue(cells, mapping.within_24_hours),
    tka_asset_support: getCellValue(cells, mapping.tka_asset_support),
    check_in_helper: getCellValue(cells, mapping.check_in_helper),
    created_at: row.created_at,
    modified_at: row.modified_at,
  }
}

// ==================== HOOKS ====================

/**
 * Fetch visitor log records from the RR Visitation Log Smartsheet
 */
export function useVisitorLog(options?: {
  enabled?: boolean
  pageSize?: number
}) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  const [displayedCount, setDisplayedCount] = useState(INITIAL_LOAD_SIZE)

  const {
    data: sheetData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useSmartsheetSheet(VISITOR_LOG_SHEET_ID, {
    level: 1,
    enabled: options?.enabled ?? true,
  })

  const { allVisitors, columnMapping, totalCount } = useMemo(() => {
    if (!sheetData?.sheet) {
      return {
        allVisitors: [],
        columnMapping: {} as VisitorColumnMapping,
        totalCount: 0,
      }
    }

    const mapping = buildColumnMapping(sheetData.sheet.columns || [])
    const parsed = (sheetData.sheet.rows || [])
      .map((row) => parseVisitorFromRow(row, mapping))
      .filter((v) => v.name.trim() !== '') // Filter out empty rows

    return {
      allVisitors: parsed,
      columnMapping: mapping,
      totalCount: parsed.length,
    }
  }, [sheetData])

  const visitors = useMemo(() => {
    return allVisitors.slice(0, displayedCount)
  }, [allVisitors, displayedCount])

  const loadMore = useCallback(() => {
    setDisplayedCount((prev) => Math.min(prev + pageSize, totalCount))
  }, [pageSize, totalCount])

  const hasMore = displayedCount < totalCount

  const resetPagination = useCallback(() => {
    setDisplayedCount(INITIAL_LOAD_SIZE)
  }, [])

  // Compute stats
  const stats = useMemo<VisitorStats>(() => {
    const today = new Date().toISOString().split('T')[0]
    return {
      total: allVisitors.length,
      pending: allVisitors.filter(
        (v) =>
          v.approval_status === ApprovalStatus.PENDING ||
          v.approval_status === ApprovalStatus.BLANK
      ).length,
      approved: allVisitors.filter(
        (v) => v.approval_status === ApprovalStatus.APPROVED
      ).length,
      denied: allVisitors.filter(
        (v) => v.approval_status === ApprovalStatus.DENIED
      ).length,
      todayVisitors: allVisitors.filter((v) => {
        if (!v.arrival_date) return false
        try {
          return v.arrival_date.includes(today)
        } catch {
          return false
        }
      }).length,
      thisWeekVisitors: allVisitors.filter((v) => isCurrentWeek(v.arrival_date))
        .length,
      checkedIn: allVisitors.filter((v) => v.check_in && !v.check_out).length,
    }
  }, [allVisitors])

  return {
    visitors,
    allVisitors,
    columnMapping,
    columns: sheetData?.sheet?.columns || [],
    stats,
    isLoading,
    isFetching,
    error,
    refetch,
    totalCount,
    displayedCount,
    hasMore,
    loadMore,
    resetPagination,
  }
}

/**
 * Update visitor approval status (Approve / Deny)
 */
export function useUpdateApprovalStatus() {
  const queryClient = useQueryClient()
  const updateCellsMutation = useUpdateCells()
  const { columnMapping } = useVisitorLog()

  const updateApproval = async (
    rowId: number,
    status: ApprovalStatus,
    responseText?: string
  ) => {
    if (!columnMapping.approval_status) {
      throw new Error('Approval Status column not found in Smartsheet')
    }

    const cellUpdates: { column_id: number; value: string }[] = [
      { column_id: columnMapping.approval_status, value: status as string },
    ]

    // Optionally update Response column with a note
    if (responseText && columnMapping.response) {
      cellUpdates.push({
        column_id: columnMapping.response,
        value: responseText,
      })
    }

    const result = await updateCellsMutation.mutateAsync({
      sheetId: VISITOR_LOG_SHEET_ID,
      rowId,
      cellUpdates,
    })

    // Invalidate cache to refresh the data
    queryClient.invalidateQueries({
      queryKey: SMARTSHEET_QUERY_KEYS.sheet(VISITOR_LOG_SHEET_ID),
    })

    if (result.success) {
      toast.success(
        status === ApprovalStatus.APPROVED
          ? 'Visitor approved successfully'
          : 'Visitor denied'
      )
    }

    return result
  }

  return {
    updateApproval,
    isPending: updateCellsMutation.isPending,
  }
}

/**
 * Update a visitor record field
 */
export function useUpdateVisitorField() {
  const queryClient = useQueryClient()
  const updateCellsMutation = useUpdateCells()
  const { columnMapping } = useVisitorLog()

  const updateField = async (
    rowId: number,
    field: keyof VisitorColumnMapping,
    value: string | boolean
  ) => {
    const columnId = columnMapping[field]
    if (!columnId) {
      throw new Error(`${field} column not found in Smartsheet`)
    }

    const result = await updateCellsMutation.mutateAsync({
      sheetId: VISITOR_LOG_SHEET_ID,
      rowId,
      cellUpdates: [{ column_id: columnId, value }],
    })

    queryClient.invalidateQueries({
      queryKey: SMARTSHEET_QUERY_KEYS.sheet(VISITOR_LOG_SHEET_ID),
    })

    return result
  }

  return {
    updateField,
    isPending: updateCellsMutation.isPending,
  }
}
