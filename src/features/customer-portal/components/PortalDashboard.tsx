/**
 * Customer Portal Dashboard Component
 *
 * Main dashboard view with KPI cards and split-view ticket management.
 * Uses Rust Core Smartsheet service for high-performance operations.
 *
 * Performance optimizations:
 * - Pagination: Loads 50 tickets initially, more on scroll
 * - Virtual scrolling: Only renders visible tickets
 * - Lazy loading: Attachments/discussions loaded on ticket select
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { IconAlertCircle } from '@tabler/icons-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { useTicketUpdates } from '../hooks/useTicketUpdates'
import { useTickets } from '../hooks/useTickets'
import type { TicketFilterStatus, TicketStats } from '../types'
import { isActiveStatus, isOpenStatus, isResolvedStatus } from '../types'
import { TicketDetailPanel } from './TicketDetailPanel'
import { TicketListPanel } from './TicketListPanel'

export function PortalDashboard() {
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<TicketFilterStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null)

  // Fetch tickets via Rust Core Smartsheet service with pagination.
  // Auto-refreshes every 30s so external changes are picked up.
  const {
    allTickets,
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
  } = useTickets()

  // Throttled toast for ticket update notifications (max 1 per 10 seconds)
  const lastToastTimeRef = useRef(0)

  const handleUpdatesDetected = useCallback((rowIds: number[]) => {
    const now = Date.now()
    if (now - lastToastTimeRef.current > 10000) {
      lastToastTimeRef.current = now
      toast.info(
        `${rowIds.length} ticket${rowIds.length === 1 ? '' : 's'} updated`,
        {
          duration: 4000,
        }
      )
    }
  }, [])

  // Detect externally-changed rows by comparing updated_at timestamps
  // across consecutive React Query refetches (Option B — no webhook dependency).
  const { recentlyUpdatedRowIds, clearUpdatedRow, suppressRow } =
    useTicketUpdates(allTickets, {
      onUpdatesDetected: handleUpdatesDetected,
    })

  // Get unique departments from all tickets
  const departments = useMemo(() => {
    const depts = new Set<string>()
    allTickets.forEach((t) => {
      if (t.ilc_department) depts.add(t.ilc_department)
    })
    return Array.from(depts).sort()
  }, [allTickets])

  // Filter tickets by department first
  const departmentFilteredTickets = useMemo(() => {
    if (!departmentFilter) return allTickets
    return allTickets.filter((t) => t.ilc_department === departmentFilter)
  }, [allTickets, departmentFilter])

  // Calculate statistics from department-filtered tickets
  // Uses status grouping helpers to properly categorize all Smartsheet statuses:
  // - Open: Not Started, Reopened, Blank
  // - Active: In Progress, Escalated
  // - Resolved: Closed, Cancelled, Rejected
  const stats: TicketStats = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Count by status groups (includes all Smartsheet statuses)
    const open = departmentFilteredTickets.filter((t) =>
      isOpenStatus(t.status)
    ).length
    const inProgress = departmentFilteredTickets.filter((t) =>
      isActiveStatus(t.status)
    ).length
    const waiting = 0 // Legacy - kept for backward compatibility, now part of Active
    const resolved = departmentFilteredTickets.filter((t) =>
      isResolvedStatus(t.status)
    ).length
    const closed = resolved // Alias for resolved group

    // Count resolved today (any status in the resolved group)
    const resolvedToday = departmentFilteredTickets.filter((t) => {
      if (!isResolvedStatus(t.status)) return false
      if (!t.updated_at) return false
      const updatedDate = new Date(t.updated_at)
      updatedDate.setHours(0, 0, 0, 0)
      return updatedDate.getTime() === today.getTime()
    }).length

    return {
      total: departmentFilteredTickets.length,
      open,
      inProgress,
      waiting,
      resolved,
      closed,
      resolvedToday,
      avgResponseTime: '< 2h', // Placeholder - would need actual calculation
    }
  }, [departmentFilteredTickets])

  // Filter tickets based on status and search (from department-filtered tickets)
  // Uses status grouping to filter by logical categories:
  // - 'open': Not Started, Reopened, Blank
  // - 'in_progress': In Progress, Escalated
  // - 'resolved': Closed, Cancelled, Rejected
  const filteredTickets = useMemo(() => {
    let result = departmentFilteredTickets

    // Status filter using grouping helpers
    if (statusFilter !== 'all') {
      switch (statusFilter) {
        case 'open':
          result = result.filter((t) => isOpenStatus(t.status))
          break
        case 'in_progress':
        case 'waiting': // Legacy - treat waiting as active
          result = result.filter((t) => isActiveStatus(t.status))
          break
        case 'resolved':
        case 'closed': // Alias for resolved
          result = result.filter((t) => isResolvedStatus(t.status))
          break
      }
    }

    // Search filter - searches across all relevant ticket fields
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (t) =>
          // Primary identifiers
          t.ticket_id?.toLowerCase().includes(query) ||
          t.customer_id?.toLowerCase().includes(query) ||
          t.email?.toLowerCase().includes(query) ||
          // Content fields
          t.subject?.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query) ||
          // Requestor information
          t.requestor_name?.toLowerCase().includes(query) ||
          t.requestor_email?.toLowerCase().includes(query) ||
          t.requestor_department?.toLowerCase().includes(query) ||
          // Department/Assignment
          t.ilc_department?.toLowerCase().includes(query) ||
          t.assigned_to?.toLowerCase().includes(query) ||
          // Reference numbers
          t.material_number?.toLowerCase().includes(query) ||
          t.plant?.toLowerCase().includes(query) ||
          t.delivery_number?.toLowerCase().includes(query) ||
          t.po_number?.toLowerCase().includes(query) ||
          t.rma_number?.toLowerCase().includes(query) ||
          t.qn_number?.toLowerCase().includes(query) ||
          // Updates and notes
          t.tka_updates?.toLowerCase().includes(query) ||
          t.rolls_royce_updates?.toLowerCase().includes(query) ||
          t.resolution?.toLowerCase().includes(query) ||
          t.notes?.toLowerCase().includes(query)
      )
    }

    return result
  }, [departmentFilteredTickets, statusFilter, searchQuery])

  // Handle refresh - reset pagination too
  const handleRefresh = useCallback(() => {
    resetPagination()
    refetch()
  }, [resetPagination, refetch])

  if (error) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <Card className='border-destructive'>
          <CardContent className='pt-6'>
            <div className='space-y-2 text-center'>
              <IconAlertCircle className='text-destructive mx-auto h-8 w-8' />
              <p className='text-destructive font-semibold'>
                Failed to load tickets
              </p>
              <p className='text-muted-foreground text-sm'>{error.message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Split View: Ticket List + Detail */}
      <div className='grid min-h-[600px] grid-cols-1 gap-4 lg:grid-cols-5'>
        {/* Left Panel - Ticket List (40%) */}
        <div className='lg:col-span-2'>
          <TicketListPanel
            tickets={filteredTickets}
            loading={isLoading || isFetching}
            selectedTicketId={selectedTicketId}
            onSelectTicket={setSelectedTicketId}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            stats={stats}
            onRefresh={handleRefresh}
            // Pagination props
            hasMore={
              hasMore &&
              !searchQuery &&
              statusFilter === 'all' &&
              !departmentFilter
            }
            onLoadMore={loadMore}
            totalCount={
              statusFilter === 'all' && !searchQuery && !departmentFilter
                ? totalCount
                : filteredTickets.length
            }
            displayedCount={displayedCount}
            // Department filter props
            departmentFilter={departmentFilter}
            onDepartmentFilterChange={setDepartmentFilter}
            departments={departments}
            // Ticket update notification props
            recentlyUpdatedRowIds={recentlyUpdatedRowIds}
            onClearUpdatedRow={clearUpdatedRow}
          />
        </div>

        {/* Right Panel - Ticket Detail (60%) */}
        <div className='lg:col-span-3'>
          <TicketDetailPanel
            ticketId={selectedTicketId}
            onClose={() => setSelectedTicketId(null)}
            isTicketUpdated={
              selectedTicketId
                ? recentlyUpdatedRowIds.has(selectedTicketId)
                : false
            }
            onAcknowledgeUpdate={() => {
              if (selectedTicketId) clearUpdatedRow(selectedTicketId)
            }}
            onSuppressNotification={suppressRow}
          />
        </div>
      </div>
    </div>
  )
}
