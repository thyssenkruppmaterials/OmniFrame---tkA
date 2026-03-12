/**
 * Customer Portal Ticket Hooks
 *
 * Uses the same Rust-based Smartsheet infrastructure as the Sheet Manager tab.
 * Provides ticket-specific data transformation on top of raw sheet data.
 *
 * Performance optimizations:
 * - Pagination: Loads tickets in chunks (default 50)
 * - Lazy loading: Attachments/discussions loaded only when ticket is selected
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CellData,
  ColumnData,
  RowData,
} from '@/lib/rust-core/smartsheet.service'
import { logger } from '@/lib/utils/logger'
import {
  SMARTSHEET_QUERY_KEYS,
  useAddRows,
  useAttachUrlToRow,
  useCreateRowDiscussion,
  useRowAttachments,
  useRowDiscussions,
  useSmartsheetSheet,
  useUpdateCells,
  useUploadFileToRow,
} from '@/hooks/useSmartsheet'

// ==================== CONSTANTS ====================

// Ticket sheet ID - same as backend (api/routers/customer_tickets.py)
export const TICKET_SHEET_ID = 2987059899748228

// Pagination settings
export const DEFAULT_PAGE_SIZE = 50
export const INITIAL_LOAD_SIZE = 50

// ==================== TYPES ====================

/**
 * Ticket Status Enum
 *
 * Maps to all Smartsheet status values:
 * - Blank (empty) - handled as default/fallback
 * - Not Started
 * - In Progress
 * - Escalated
 * - Closed
 * - Reopened
 * - Cancelled
 * - Rejected
 *
 * Status groupings for stats/filters:
 * - "Open": NOT_STARTED, REOPENED, BLANK
 * - "Active": IN_PROGRESS, ESCALATED
 * - "Resolved": CLOSED, CANCELLED, REJECTED
 */
export enum TicketStatus {
  // Open statuses
  BLANK = '',
  NOT_STARTED = 'Not Started',
  REOPENED = 'Reopened',
  // Active statuses
  IN_PROGRESS = 'In Progress',
  ESCALATED = 'Escalated',
  // Resolved/Closed statuses
  CLOSED = 'Closed',
  CANCELLED = 'Cancelled',
  REJECTED = 'Rejected',
  // Legacy - keep for backward compatibility
  OPEN = 'Open',
  WAITING = 'Waiting',
  RESOLVED = 'Resolved',
}

export enum TicketPriority {
  LOW = 'Low',
  MEDIUM = 'Medium',
  HIGH = 'High',
  CRITICAL = 'Critical',
}

export enum TicketCategory {
  GENERAL = 'General',
  TECHNICAL = 'Technical',
  BILLING = 'Billing',
  SHIPPING = 'Shipping',
  PRODUCT = 'Product',
  OTHER = 'Other',
}

export interface Ticket {
  row_id: number
  ticket_id: string
  customer_id: string
  email: string
  subject: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  assigned_to?: string
  notes?: string
  created_at?: string
  updated_at?: string
  date_closed?: string
  date_reopened?: string
  tka_updates?: string
  rolls_royce_updates?: string
  resolution?: string
  ilc_department?: string
  requestor_department?: string
  requestor_name?: string
  requestor_email?: string
  plant?: string
  material_number?: string
  quantity?: string
  delivery_number?: string
  po_number?: string
  rma_number?: string
  qn_number?: string
  days_open?: number
  // Containment department fields
  containment?: boolean
  containment_date?: string
  // Quality department fields
  rtv?: boolean
  rtv_critical?: string
  rtv_date?: string
}

export interface TicketWithDetails extends Ticket {
  discussions: Discussion[]
  attachments: Attachment[]
}

export interface Discussion {
  id: number
  title?: string
  comment_count: number
  comments: Comment[]
  created_at?: string
  created_by?: { name?: string; email?: string }
}

export interface Comment {
  id: number
  text: string
  created_at?: string
  created_by?: { name?: string; email?: string }
  modified_at?: string
  attachments?: Attachment[]
}

export interface Attachment {
  id: number
  name: string
  attachment_type: string
  mime_type?: string
  size_in_kb?: number
  url?: string
  url_expires_in_millis?: number
  created_at?: string
  created_by?: { name?: string; email?: string }
}

export interface ColumnMapping {
  ticket_id?: number
  customer_id?: number
  customer_email?: number
  subject?: number
  description?: number
  status?: number
  priority?: number
  category?: number
  assigned_to?: number
  notes?: number
  created_date?: number
  updated_date?: number
  date_closed?: number
  date_reopened?: number
  tka_updates?: number
  rolls_royce_updates?: number
  resolution?: number
  ilc_department?: number
  requestor_department?: number
  requestor_name?: number
  requestor_email?: number
  plant?: number
  material_number?: number
  quantity?: number
  delivery_number?: number
  po_number?: number
  rma_number?: number
  qn_number?: number
  days_open?: number
  // Containment department fields
  containment?: number
  containment_date?: number
  // Quality department fields
  rtv?: number
  rtv_critical?: number
  rtv_date?: number
}

export interface PaginationState {
  pageIndex: number
  pageSize: number
  totalCount: number
  totalPages: number
}

// ==================== STATUS GROUPING HELPERS ====================

/**
 * Status groups for filtering and statistics
 * These group raw Smartsheet statuses into logical categories
 */
export const OPEN_STATUSES = [
  TicketStatus.NOT_STARTED,
  TicketStatus.REOPENED,
  TicketStatus.BLANK,
  TicketStatus.OPEN, // Legacy
] as const

export const ACTIVE_STATUSES = [
  TicketStatus.IN_PROGRESS,
  TicketStatus.ESCALATED,
  TicketStatus.WAITING, // Legacy
] as const

export const RESOLVED_STATUSES = [
  TicketStatus.CLOSED,
  TicketStatus.CANCELLED,
  TicketStatus.REJECTED,
  TicketStatus.RESOLVED, // Legacy
] as const

/** Check if a status belongs to the "Open" group */
export function isOpenStatus(status: TicketStatus | string): boolean {
  const openSet = new Set<string>(OPEN_STATUSES)
  return openSet.has(status) || !status || status === ''
}

/** Check if a status belongs to the "Active" group */
export function isActiveStatus(status: TicketStatus | string): boolean {
  const activeSet = new Set<string>(ACTIVE_STATUSES)
  return activeSet.has(status)
}

/** Check if a status belongs to the "Resolved" group */
export function isResolvedStatus(status: TicketStatus | string): boolean {
  const resolvedSet = new Set<string>(RESOLVED_STATUSES)
  return resolvedSet.has(status)
}

// ==================== COLUMN MAPPING ====================

function buildColumnMapping(columns: ColumnData[]): ColumnMapping {
  const mapping: ColumnMapping = {}

  for (const col of columns) {
    const title = col.title.toLowerCase().replace(/\s+/g, '_')

    switch (title) {
      case 'ticket_id':
      case 'request_id':
        mapping.ticket_id = col.id
        break
      case 'customer_id':
        mapping.customer_id = col.id
        break
      case 'customer_email':
      case 'email':
        mapping.customer_email = col.id
        break
      case 'subject':
        mapping.subject = col.id
        break
      case 'description':
      case 'request_notes':
        mapping.description = col.id
        break
      case 'status':
        mapping.status = col.id
        break
      case 'priority':
        mapping.priority = col.id
        break
      case 'category':
        mapping.category = col.id
        break
      case 'assigned_to':
        mapping.assigned_to = col.id
        break
      case 'notes':
      case 'internal_notes':
        mapping.notes = col.id
        break
      case 'created_date':
      case 'created_at':
        mapping.created_date = col.id
        break
      case 'updated_date':
      case 'updated_at':
        mapping.updated_date = col.id
        break
      case 'date_closed':
        mapping.date_closed = col.id
        break
      case 'date_reopened':
        mapping.date_reopened = col.id
        break
      case 'tka_updates':
        mapping.tka_updates = col.id
        break
      case 'rolls_royce_updates':
        mapping.rolls_royce_updates = col.id
        break
      case 'resolution':
        mapping.resolution = col.id
        break
      case 'ilc_department':
        mapping.ilc_department = col.id
        break
      case 'requestor_department':
        mapping.requestor_department = col.id
        break
      case 'requestor_name':
        mapping.requestor_name = col.id
        break
      case 'requestor_e-mail':
      case 'requestor_email':
        mapping.requestor_email = col.id
        break
      case 'plant':
        mapping.plant = col.id
        break
      case 'material_number':
        mapping.material_number = col.id
        break
      case 'quantity':
        mapping.quantity = col.id
        break
      case 'delivery_number':
        mapping.delivery_number = col.id
        break
      case 'po_number':
        mapping.po_number = col.id
        break
      case 'rma_number':
        mapping.rma_number = col.id
        break
      case 'qn_number':
        mapping.qn_number = col.id
        break
      case 'days_open':
        mapping.days_open = col.id
        break
      case 'containment':
        mapping.containment = col.id
        break
      case 'containment_date':
        mapping.containment_date = col.id
        break
      case 'rtv':
        mapping.rtv = col.id
        break
      case 'rtv_critical':
        mapping.rtv_critical = col.id
        break
      case 'rtv_date':
        mapping.rtv_date = col.id
        break
    }
  }

  return mapping
}

function getCellValue(
  cells: CellData[],
  columnId: number | undefined
): string | undefined {
  if (!columnId) return undefined
  const cell = cells.find((c) => c.column_id === columnId)
  return cell?.display_value ?? (cell?.value as string) ?? undefined
}

/**
 * Get checkbox/boolean value from a cell
 * Smartsheet checkboxes return boolean true/false in the value field
 */
function getCheckboxValue(
  cells: CellData[],
  columnId: number | undefined
): boolean {
  if (!columnId) return false
  const cell = cells.find((c) => c.column_id === columnId)
  if (!cell) return false

  // Smartsheet checkbox value can be: boolean true/false, string 'true'/'false', or number 1/0
  const value = cell.value
  if (typeof value === 'boolean') return value
  if (typeof value === 'string')
    return value.toLowerCase() === 'true' || value === '1'
  if (typeof value === 'number') return value === 1
  return false
}

/**
 * Normalize status value from Smartsheet
 * Handles blank/empty values and maps to enum
 */
function normalizeStatus(rawStatus: string | undefined): TicketStatus {
  if (!rawStatus || rawStatus.trim() === '') {
    return TicketStatus.BLANK
  }
  // Return the raw value as TicketStatus - it will be one of the enum values
  // or a legacy/unknown value that will still work with string comparisons
  return rawStatus as TicketStatus
}

function parseTicketFromRow(row: RowData, mapping: ColumnMapping): Ticket {
  const cells = row.cells || []
  const rawStatus = getCellValue(cells, mapping.status)

  return {
    row_id: row.id,
    ticket_id: getCellValue(cells, mapping.ticket_id) || `TKT-${row.id}`,
    customer_id: getCellValue(cells, mapping.customer_id) || '',
    email: getCellValue(cells, mapping.customer_email) || '',
    subject: getCellValue(cells, mapping.subject) || '',
    description: getCellValue(cells, mapping.description) || '',
    status: normalizeStatus(rawStatus),
    priority:
      (getCellValue(cells, mapping.priority) as TicketPriority) ||
      TicketPriority.MEDIUM,
    category:
      (getCellValue(cells, mapping.category) as TicketCategory) ||
      TicketCategory.GENERAL,
    assigned_to: getCellValue(cells, mapping.assigned_to),
    notes: getCellValue(cells, mapping.notes),
    created_at: row.created_at || getCellValue(cells, mapping.created_date),
    updated_at: row.modified_at || getCellValue(cells, mapping.updated_date),
    date_closed: getCellValue(cells, mapping.date_closed),
    date_reopened: getCellValue(cells, mapping.date_reopened),
    tka_updates: getCellValue(cells, mapping.tka_updates),
    rolls_royce_updates: getCellValue(cells, mapping.rolls_royce_updates),
    resolution: getCellValue(cells, mapping.resolution),
    ilc_department: getCellValue(cells, mapping.ilc_department),
    requestor_department: getCellValue(cells, mapping.requestor_department),
    requestor_name: getCellValue(cells, mapping.requestor_name),
    requestor_email: getCellValue(cells, mapping.requestor_email),
    plant: getCellValue(cells, mapping.plant),
    material_number: getCellValue(cells, mapping.material_number),
    quantity: getCellValue(cells, mapping.quantity),
    delivery_number: getCellValue(cells, mapping.delivery_number),
    po_number: getCellValue(cells, mapping.po_number),
    rma_number: getCellValue(cells, mapping.rma_number),
    qn_number: getCellValue(cells, mapping.qn_number),
    days_open: parseDaysOpen(getCellValue(cells, mapping.days_open)),
    // Containment department fields
    containment: getCheckboxValue(cells, mapping.containment),
    containment_date: getCellValue(cells, mapping.containment_date),
    // Quality department fields
    rtv: getCheckboxValue(cells, mapping.rtv),
    rtv_critical: getCellValue(cells, mapping.rtv_critical),
    rtv_date: getCellValue(cells, mapping.rtv_date),
  }
}

/**
 * Parse days_open value from Smartsheet cell
 * Handles string/number values and returns as number or undefined
 */
function parseDaysOpen(value: string | undefined): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const parsed = parseFloat(value)
  return isNaN(parsed) ? undefined : parsed
}

// ==================== HOOKS ====================

/**
 * Fetch tickets from the ticket sheet with pagination support (via Rust Core)
 *
 * Performance: Loads only basic ticket data (level=1), no attachments/discussions
 * Attachments/discussions are lazy-loaded when a ticket is selected
 */
/** Default auto-refresh cadence for the ticket sheet (30 seconds). */
const TICKET_REFETCH_INTERVAL = 30_000

export function useTickets(options?: {
  enabled?: boolean
  pageSize?: number
  refetchInterval?: number
}) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  const [displayedCount, setDisplayedCount] = useState(INITIAL_LOAD_SIZE)

  // Fetch sheet data without attachments/discussions for faster initial load.
  // Auto-refreshes every TICKET_REFETCH_INTERVAL ms so external changes
  // (e.g. another user editing RR Updates) are picked up automatically.
  const {
    data: sheetData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useSmartsheetSheet(TICKET_SHEET_ID, {
    level: 1, // Basic data only - no attachments/discussions
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? TICKET_REFETCH_INTERVAL,
    refetchIntervalInBackground: false, // pause when tab is hidden
  })

  const { allTickets, columnMapping, totalCount } = useMemo(() => {
    if (!sheetData?.sheet) {
      return { allTickets: [], columnMapping: {}, totalCount: 0 }
    }

    const mapping = buildColumnMapping(sheetData.sheet.columns || [])
    const parsedTickets = (sheetData.sheet.rows || []).map((row) =>
      parseTicketFromRow(row, mapping)
    )

    return {
      allTickets: parsedTickets,
      columnMapping: mapping,
      totalCount: parsedTickets.length,
    }
  }, [sheetData])

  // Paginated tickets for display
  const tickets = useMemo(() => {
    return allTickets.slice(0, displayedCount)
  }, [allTickets, displayedCount])

  // Load more tickets
  const loadMore = useCallback(() => {
    setDisplayedCount((prev) => Math.min(prev + pageSize, totalCount))
  }, [pageSize, totalCount])

  // Check if there are more tickets to load
  const hasMore = displayedCount < totalCount

  // Reset pagination
  const resetPagination = useCallback(() => {
    setDisplayedCount(INITIAL_LOAD_SIZE)
  }, [])

  return {
    tickets,
    allTickets, // Full list for filtering/stats
    columnMapping,
    columns: sheetData?.sheet?.columns || [],
    isLoading,
    isFetching,
    error,
    refetch,
    // Pagination
    totalCount,
    displayedCount,
    hasMore,
    loadMore,
    resetPagination,
  }
}

/**
 * Get a single ticket with full details (discussions + attachments)
 *
 * Lazy loading: Only fetches attachments/discussions when a ticket is selected
 */
export function useTicketDetails(
  rowId: number | null,
  options?: { enabled?: boolean }
) {
  const {
    allTickets,
    columnMapping,
    isLoading: ticketsLoading,
    error: ticketsError,
    refetch: refetchTickets,
  } = useTickets({
    enabled: options?.enabled ?? true,
  })

  // Lazy load discussions for this row - only when rowId is provided
  const {
    data: discussionsData,
    isLoading: discussionsLoading,
    refetch: refetchDiscussions,
  } = useRowDiscussions(
    TICKET_SHEET_ID,
    rowId || 0,
    !!rowId && (options?.enabled ?? true)
  )

  // Lazy load attachments for this row - only when rowId is provided
  const {
    data: attachmentsData,
    isLoading: attachmentsLoading,
    refetch: refetchAttachments,
  } = useRowAttachments(
    TICKET_SHEET_ID,
    rowId || 0,
    !!rowId && (options?.enabled ?? true)
  )

  const ticket = useMemo<TicketWithDetails | null>(() => {
    if (!rowId) return null

    const baseTicket = allTickets.find((t) => t.row_id === rowId)
    if (!baseTicket) return null

    const discussions: Discussion[] = (discussionsData?.discussions || []).map(
      (d) => ({
        id: d.id,
        title: d.title,
        comment_count: d.comments?.length || 0,
        comments: (d.comments || []).map((c) => ({
          id: c.id,
          text: c.text,
          created_at: c.created_at,
          created_by: c.created_by
            ? {
                name: c.created_by.name,
                email: c.created_by.email,
              }
            : undefined,
          modified_at: c.modified_at,
          attachments: [] as Attachment[],
        })),
        created_at: d.created_at,
        created_by: d.created_by
          ? {
              name: d.created_by.name,
              email: d.created_by.email,
            }
          : undefined,
      })
    )

    // Map raw Smartsheet attachments to our Attachment type
    const attachments: Attachment[] = (attachmentsData?.attachments || []).map(
      mapAttachment
    )

    return {
      ...baseTicket,
      discussions,
      attachments,
    }
  }, [rowId, allTickets, discussionsData, attachmentsData])

  const refetch = useCallback(() => {
    refetchDiscussions()
    refetchAttachments()
  }, [refetchDiscussions, refetchAttachments])

  // Loading state: initial load vs detail load
  const isInitialLoading = ticketsLoading
  const isDetailLoading = !!rowId && (discussionsLoading || attachmentsLoading)

  return {
    ticket,
    columnMapping,
    isLoading: isInitialLoading,
    isDetailLoading,
    error: ticketsError,
    refetch,
    refetchTickets,
  }
}

// Helper to map raw Smartsheet attachment to our Attachment type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAttachment(a: any): Attachment {
  const createdBy = a.createdBy as Record<string, unknown> | undefined
  return {
    id: a.id as number,
    name: a.name as string,
    attachment_type:
      (a.attachmentType as string) || (a.attachment_type as string) || 'FILE',
    mime_type: (a.mimeType as string) || (a.mime_type as string),
    size_in_kb: (a.sizeInKb as number) || (a.size_in_kb as number),
    url: a.url as string | undefined,
    url_expires_in_millis:
      (a.urlExpiresInMillis as number) || (a.url_expires_in_millis as number),
    created_at: (a.createdAt as string) || (a.created_at as string),
    created_by: createdBy
      ? {
          name: createdBy.name as string | undefined,
          email: createdBy.email as string | undefined,
        }
      : undefined,
  }
}

// ==================== PRODUCTIVITY TRACKING ====================

/**
 * Fire-and-forget tracking of user actions for the Activity Gantt and
 * Agent Productivity metrics. Writes directly to the ticket_user_actions
 * table via Supabase. Uses dynamic import to avoid circular dependencies.
 *
 * This is needed because the authenticated dashboard sends Smartsheet
 * operations through the Rust Core Service, bypassing the FastAPI
 * customer_tickets.py endpoints where server-side tracking lives.
 */
async function trackPortalAction(
  action_type: string,
  ticket_row_id: number,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const { supabase } = await import('@/lib/supabase/client')

    // Get the current session to extract user_id and organization_id
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.user?.id) return // Not authenticated, skip tracking

    // Get organization_id from user profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', session.user.id)
      .single()

    if (!profile?.organization_id) return // No org context, skip

    // Cast details to JSON-compatible type for Supabase
    const jsonDetails = (details ?? {}) as Record<
      string,
      string | number | boolean | null
    >

    await supabase.from('ticket_user_actions').insert({
      user_id: session.user.id,
      organization_id: profile.organization_id,
      ticket_row_id,
      action_type,
      details: jsonDetails,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  } catch (err) {
    // Fire-and-forget: never let tracking failures affect the user
    logger.debug('[PortalTracking] Failed to record action:', err)
  }
}

/**
 * Create a new ticket
 */
export function useCreateTicket() {
  const queryClient = useQueryClient()
  const addRowsMutation = useAddRows()
  const { columnMapping } = useTickets()

  const createTicket = async (data: {
    customer_id: string
    email: string
    subject: string
    description: string
    priority?: TicketPriority
    category?: TicketCategory
  }) => {
    // Generate ticket ID
    const ticketId = `TKT-${Date.now()}`
    const now = new Date().toISOString()

    // Build cells array
    const cells: { column_id: number; value: string }[] = []

    if (columnMapping.ticket_id) {
      cells.push({ column_id: columnMapping.ticket_id, value: ticketId })
    }
    if (columnMapping.customer_id) {
      cells.push({
        column_id: columnMapping.customer_id,
        value: data.customer_id,
      })
    }
    if (columnMapping.customer_email) {
      cells.push({ column_id: columnMapping.customer_email, value: data.email })
    }
    if (columnMapping.subject) {
      cells.push({ column_id: columnMapping.subject, value: data.subject })
    }
    if (columnMapping.description) {
      cells.push({
        column_id: columnMapping.description,
        value: data.description,
      })
    }
    if (columnMapping.status) {
      cells.push({
        column_id: columnMapping.status,
        value: TicketStatus.OPEN as string,
      })
    }
    if (columnMapping.priority) {
      cells.push({
        column_id: columnMapping.priority,
        value: (data.priority || TicketPriority.MEDIUM) as string,
      })
    }
    if (columnMapping.category) {
      cells.push({
        column_id: columnMapping.category,
        value: (data.category || TicketCategory.GENERAL) as string,
      })
    }
    if (columnMapping.created_date) {
      cells.push({ column_id: columnMapping.created_date, value: now })
    }
    if (columnMapping.updated_date) {
      cells.push({ column_id: columnMapping.updated_date, value: now })
    }

    const result = await addRowsMutation.mutateAsync({
      sheetId: TICKET_SHEET_ID,
      rowsData: [{ cells }],
      location: 'toBottom',
    })

    // Invalidate tickets cache
    queryClient.invalidateQueries({
      queryKey: SMARTSHEET_QUERY_KEYS.sheet(TICKET_SHEET_ID),
    })

    // Track action for productivity (fire-and-forget)
    trackPortalAction('ticket_create', 0, {
      ticket_id: ticketId,
      subject: data.subject,
      priority: data.priority,
      category: data.category,
    })

    return { success: result.success, ticketId }
  }

  return {
    createTicket,
    isPending: addRowsMutation.isPending,
  }
}

/**
 * Update ticket status
 */
export function useUpdateTicketStatus() {
  const queryClient = useQueryClient()
  const updateCellsMutation = useUpdateCells()
  const { columnMapping } = useTickets()

  const updateStatus = async (rowId: number, status: TicketStatus) => {
    if (!columnMapping.status) {
      throw new Error('Status column not found')
    }

    const cellUpdates: { column_id: number; value: string }[] = [
      { column_id: columnMapping.status, value: status as string },
    ]

    if (columnMapping.updated_date) {
      cellUpdates.push({
        column_id: columnMapping.updated_date,
        value: new Date().toISOString(),
      })
    }

    const result = await updateCellsMutation.mutateAsync({
      sheetId: TICKET_SHEET_ID,
      rowId,
      cellUpdates,
    })

    queryClient.invalidateQueries({
      queryKey: SMARTSHEET_QUERY_KEYS.sheet(TICKET_SHEET_ID),
    })

    // Track action for productivity (fire-and-forget)
    trackPortalAction('status_change', rowId, { new_status: status })

    return result
  }

  return {
    updateStatus,
    isPending: updateCellsMutation.isPending,
  }
}

/**
 * Update the ILC Department field for a ticket
 */
export function useUpdateILCDepartment() {
  const queryClient = useQueryClient()
  const updateCellsMutation = useUpdateCells()
  const { columnMapping } = useTickets()

  const updateILCDepartment = async (rowId: number, ilcDepartment: string) => {
    if (!columnMapping.ilc_department) {
      throw new Error('ILC Department column not found')
    }

    const cellUpdates: { column_id: number; value: string }[] = [
      { column_id: columnMapping.ilc_department, value: ilcDepartment },
    ]

    if (columnMapping.updated_date) {
      cellUpdates.push({
        column_id: columnMapping.updated_date,
        value: new Date().toISOString(),
      })
    }

    const result = await updateCellsMutation.mutateAsync({
      sheetId: TICKET_SHEET_ID,
      rowId,
      cellUpdates,
    })

    queryClient.invalidateQueries({
      queryKey: SMARTSHEET_QUERY_KEYS.sheet(TICKET_SHEET_ID),
    })

    // Track action for productivity (fire-and-forget)
    trackPortalAction('field_update', rowId, {
      field: 'ilc_department',
      value: ilcDepartment,
    })

    return result
  }

  return {
    updateILCDepartment,
    isPending: updateCellsMutation.isPending,
  }
}

/**
 * Update a ticket text field (TKA Updates, Resolution, etc.)
 * Appends new content with user signature to existing content
 */
export type TicketTextField = 'tka_updates' | 'resolution'

export function useUpdateTicketField() {
  const queryClient = useQueryClient()
  const updateCellsMutation = useUpdateCells()
  const { columnMapping } = useTickets()

  const updateField = async (
    rowId: number,
    field: TicketTextField,
    newContent: string,
    existingContent?: string
  ) => {
    const columnId = columnMapping[field]
    if (!columnId) {
      throw new Error(`${field} column not found`)
    }

    // Combine existing content with new content
    const combinedContent = existingContent
      ? `${existingContent}\n\n---\n${newContent}`
      : newContent

    const cellUpdates: { column_id: number; value: string }[] = [
      { column_id: columnId, value: combinedContent },
    ]

    if (columnMapping.updated_date) {
      cellUpdates.push({
        column_id: columnMapping.updated_date,
        value: new Date().toISOString(),
      })
    }

    const result = await updateCellsMutation.mutateAsync({
      sheetId: TICKET_SHEET_ID,
      rowId,
      cellUpdates,
    })

    queryClient.invalidateQueries({
      queryKey: SMARTSHEET_QUERY_KEYS.sheet(TICKET_SHEET_ID),
    })

    // Track action for productivity (fire-and-forget)
    trackPortalAction('field_update', rowId, {
      field,
      text_length: newContent.length,
    })

    return result
  }

  return {
    updateField,
    isPending: updateCellsMutation.isPending,
  }
}

/**
 * Add a comment to a ticket
 */
export function useAddTicketComment() {
  const queryClient = useQueryClient()
  const createDiscussionMutation = useCreateRowDiscussion()

  const addComment = async (rowId: number, text: string) => {
    const result = await createDiscussionMutation.mutateAsync({
      sheetId: TICKET_SHEET_ID,
      rowId,
      title: 'Comment',
      comment: text,
    })

    queryClient.invalidateQueries({
      queryKey: [
        ...SMARTSHEET_QUERY_KEYS.sheet(TICKET_SHEET_ID),
        'row',
        rowId,
        'discussions',
      ],
    })

    // Track action for productivity (fire-and-forget)
    trackPortalAction('comment', rowId, { text_length: text.length })

    return result
  }

  return {
    addComment,
    isPending: createDiscussionMutation.isPending,
  }
}

/**
 * Attach URL to a ticket
 */
export function useAttachTicketUrl() {
  const queryClient = useQueryClient()
  const attachUrlMutation = useAttachUrlToRow()

  const attachUrl = async (rowId: number, url: string, name: string) => {
    const result = await attachUrlMutation.mutateAsync({
      sheetId: TICKET_SHEET_ID,
      rowId,
      url,
      name,
    })

    queryClient.invalidateQueries({
      queryKey: [
        ...SMARTSHEET_QUERY_KEYS.sheet(TICKET_SHEET_ID),
        'row',
        rowId,
        'attachments',
      ],
    })

    // Track action for productivity (fire-and-forget)
    trackPortalAction('attachment', rowId, { url, name })

    return result
  }

  return {
    attachUrl,
    isPending: attachUrlMutation.isPending,
  }
}

/**
 * Upload file to a ticket
 */
export function useUploadTicketFile() {
  const queryClient = useQueryClient()
  const uploadFileMutation = useUploadFileToRow()

  const uploadFile = async (rowId: number, file: File) => {
    const result = await uploadFileMutation.mutateAsync({
      sheetId: TICKET_SHEET_ID,
      rowId,
      file,
    })

    queryClient.invalidateQueries({
      queryKey: [
        ...SMARTSHEET_QUERY_KEYS.sheet(TICKET_SHEET_ID),
        'row',
        rowId,
        'attachments',
      ],
    })

    // Track action for productivity (fire-and-forget)
    trackPortalAction('attachment', rowId, {
      file_name: file.name,
      file_size: file.size,
    })

    return result
  }

  return {
    uploadFile,
    isPending: uploadFileMutation.isPending,
  }
}

/**
 * Update a checkbox field (Containment, RTV)
 * Optionally auto-populates a date field when checked
 */
export type CheckboxField = 'containment' | 'rtv'

export function useUpdateCheckboxField() {
  const queryClient = useQueryClient()
  const updateCellsMutation = useUpdateCells()
  const { columnMapping } = useTickets()

  const updateCheckbox = async (
    rowId: number,
    field: CheckboxField,
    checked: boolean
  ) => {
    const columnId = columnMapping[field]
    if (!columnId) {
      throw new Error(`${field} column not found`)
    }

    const cellUpdates: { column_id: number; value: string | boolean }[] = [
      { column_id: columnId, value: checked },
    ]

    // Auto-populate date field when checkbox is checked
    if (field === 'containment' && checked && columnMapping.containment_date) {
      cellUpdates.push({
        column_id: columnMapping.containment_date,
        value: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
      })
    }

    if (columnMapping.updated_date) {
      cellUpdates.push({
        column_id: columnMapping.updated_date,
        value: new Date().toISOString(),
      })
    }

    const result = await updateCellsMutation.mutateAsync({
      sheetId: TICKET_SHEET_ID,
      rowId,
      cellUpdates,
    })

    queryClient.invalidateQueries({
      queryKey: SMARTSHEET_QUERY_KEYS.sheet(TICKET_SHEET_ID),
    })

    // Track action for productivity (fire-and-forget)
    trackPortalAction('field_update', rowId, { field, checked })

    return result
  }

  return {
    updateCheckbox,
    isPending: updateCellsMutation.isPending,
  }
}

// ==================== CUSTOMER PORTAL PRODUCTIVITY METRICS ====================

/**
 * Metrics for a single user's customer portal productivity.
 * Includes user profile data (name, email) joined from user_profiles table.
 */
export interface CustomerPortalMetric {
  user_id: string
  user_first_name: string | null
  user_last_name: string | null
  user_full_name: string | null
  user_email: string | null
  tickets_handled: number
  comments_made: number
  status_changes: number
  field_updates: number
  attachments_added: number
  tickets_created: number
  total_actions: number
  avg_response_time_ms: number
}

/**
 * Hook to fetch customer portal productivity metrics from the
 * get_customer_portal_metrics() RPC function.
 *
 * Returns per-user metrics: tickets handled, comments, status changes,
 * average response time, etc.
 */
export function useCustomerPortalMetrics(
  organizationId: string | undefined,
  startDate: Date,
  endDate: Date
) {
  return useQuery({
    queryKey: [
      'customer-portal-metrics',
      organizationId,
      startDate.toISOString(),
      endDate.toISOString(),
    ],
    queryFn: async () => {
      const { supabase: client } = await import('@/lib/supabase/client')
      const { data, error } = await client.rpc('get_customer_portal_metrics', {
        p_organization_id: organizationId!,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      })
      if (error) throw error
      return (data || []) as CustomerPortalMetric[]
    },
    enabled: !!organizationId,
    staleTime: 60000,
  })
}

// Re-export the sheet ID for components that need it
export { TICKET_SHEET_ID as SHEET_ID }
