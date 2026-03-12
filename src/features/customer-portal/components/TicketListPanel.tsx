/**
 * Ticket List Panel Component
 *
 * Left panel showing filterable list of tickets with preview cards.
 * Uses Rust Core Smartsheet service for data.
 *
 * Performance optimizations:
 * - Virtual scrolling for rendering only visible tickets
 * - Infinite scroll to load more tickets as user scrolls
 */
import { useRef, useEffect, useCallback, useMemo } from 'react'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  IconSearch,
  IconRefresh,
  IconMessageCircle,
  IconTicket,
  IconClock,
  IconCircleCheck,
  IconTrendingUp,
  IconBellRinging,
} from '@tabler/icons-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TicketStatusBadge } from '@/components/customer-portal/TicketStatusBadge'
import type { Ticket } from '../hooks/useTickets'
import type { TicketFilterStatus, TicketStats } from '../types'
import { CreateTicketDialog } from './CreateTicketDialog'
import { TicketStatusFilter } from './TicketStatusFilter'

interface TicketListPanelProps {
  tickets: Ticket[]
  loading: boolean
  selectedTicketId: number | null
  onSelectTicket: (id: number | null) => void
  statusFilter: TicketFilterStatus
  onStatusFilterChange: (status: TicketFilterStatus) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  stats?: TicketStats
  onRefresh: () => void
  // Pagination props
  hasMore?: boolean
  onLoadMore?: () => void
  totalCount?: number
  displayedCount?: number
  // Department filter props
  departmentFilter: string | null
  onDepartmentFilterChange: (dept: string | null) => void
  departments: string[]
  // Ticket update notification props
  recentlyUpdatedRowIds?: Set<number>
  onClearUpdatedRow?: (rowId: number) => void
}

// Estimated height for each ticket card - used as initial estimate before measurement
// Actual heights vary based on content, so we use dynamic measurement
const TICKET_CARD_HEIGHT = 116

export function TicketListPanel({
  tickets,
  loading,
  selectedTicketId,
  onSelectTicket,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
  stats,
  onRefresh,
  hasMore,
  onLoadMore,
  totalCount = 0,
  displayedCount = 0,
  departmentFilter,
  onDepartmentFilterChange,
  departments,
  recentlyUpdatedRowIds,
}: TicketListPanelProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)

  // Create a unique key that changes when filters change
  // This forces the virtualizer container to completely remount with fresh state
  const virtualizerKey = useMemo(() => {
    return `${statusFilter}-${departmentFilter ?? 'all'}-${searchQuery}`
  }, [statusFilter, departmentFilter, searchQuery])

  // Virtual list setup with dynamic height measurement
  const virtualizer = useVirtualizer({
    count: tickets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TICKET_CARD_HEIGHT,
    overscan: 5, // Render 5 extra items above/below visible area
    // Use getItemKey to ensure proper tracking when list changes
    getItemKey: (index) => tickets[index]?.row_id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Scroll to top when filters change
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0
    }
  }, [virtualizerKey])

  // Infinite scroll: load more when near bottom
  const handleScroll = useCallback(() => {
    if (!parentRef.current || !hasMore || !onLoadMore) return

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current
    const scrollPercentage = (scrollTop + clientHeight) / scrollHeight

    // Load more when scrolled 80% down
    if (scrollPercentage > 0.8) {
      onLoadMore()
    }
  }, [hasMore, onLoadMore])

  // Attach scroll listener
  useEffect(() => {
    const scrollElement = parentRef.current
    if (!scrollElement) return

    scrollElement.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollElement.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  return (
    <Card className='flex h-full flex-col'>
      <CardHeader className='space-y-4 pb-4'>
        <div className='flex items-center justify-between'>
          <div>
            <CardTitle className='text-lg'>Support Tickets</CardTitle>
            {totalCount > 0 && (
              <p className='text-muted-foreground mt-1 text-xs'>
                Showing {tickets.length.toLocaleString()} of{' '}
                {totalCount.toLocaleString()} tickets
              </p>
            )}
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant={loading ? 'default' : 'outline'}
              size={loading ? 'sm' : 'icon'}
              onClick={onRefresh}
              disabled={loading}
              className={cn(
                'overflow-hidden transition-all duration-300 ease-in-out',
                loading &&
                  'bg-primary/90 hover:bg-primary/90 text-primary-foreground min-w-[100px]'
              )}
            >
              <IconRefresh
                className={cn(
                  'h-4 w-4 transition-transform',
                  loading && 'animate-spin'
                )}
              />
              {loading && (
                <span className='ml-2 animate-pulse text-sm font-medium'>
                  Syncing...
                </span>
              )}
            </Button>
            <Select
              value={departmentFilter ?? 'all'}
              onValueChange={(value) =>
                onDepartmentFilterChange(value === 'all' ? null : value)
              }
            >
              <SelectTrigger size='sm' className='w-[160px]'>
                <SelectValue placeholder='All Departments' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Search Input */}
        <div className='relative'>
          <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search by email, ID, or subject...'
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className='pl-9'
          />
        </div>

        {/* Mini Stats Row */}
        {stats && (
          <div className='text-muted-foreground flex items-center gap-4 py-1 text-xs'>
            <div className='flex items-center gap-1.5'>
              <IconTicket className='h-3.5 w-3.5 text-blue-500' />
              <span className='text-foreground font-semibold'>
                {stats.open}
              </span>
              <span>Open</span>
            </div>
            <div className='bg-border h-3 w-px' />
            <div className='flex items-center gap-1.5'>
              <IconClock className='h-3.5 w-3.5 text-purple-500' />
              <span className='text-foreground font-semibold'>
                {stats.inProgress}
              </span>
              <span>Active</span>
            </div>
            <div className='bg-border h-3 w-px' />
            <div className='flex items-center gap-1.5'>
              <IconCircleCheck className='h-3.5 w-3.5 text-green-500' />
              <span className='text-foreground font-semibold'>
                {stats.resolvedToday}
              </span>
              <span>Resolved</span>
            </div>
            <div className='bg-border h-3 w-px' />
            <div className='flex items-center gap-1.5'>
              <IconTrendingUp className='h-3.5 w-3.5 text-orange-500' />
              <span className='text-foreground font-semibold'>
                {stats.avgResponseTime}
              </span>
              <span>Response</span>
            </div>
          </div>
        )}

        {/* Status Filter Tabs */}
        <TicketStatusFilter
          value={statusFilter}
          onChange={onStatusFilterChange}
          stats={stats}
        />
      </CardHeader>

      <CardContent className='flex-1 overflow-hidden p-0'>
        {/* Virtual Scroll Container */}
        <div
          ref={parentRef}
          className='h-[calc(100vh-380px)] overflow-auto px-4'
        >
          {loading && tickets.length === 0 ? (
            // Initial loading skeletons
            <div className='space-y-2 pb-4'>
              {Array.from({ length: 5 }).map((_, i) => (
                <TicketCardSkeleton key={i} />
              ))}
            </div>
          ) : tickets.length === 0 ? (
            // Empty state
            <div className='text-muted-foreground py-12 text-center'>
              <IconMessageCircle className='mx-auto mb-3 h-12 w-12 opacity-40' />
              <p className='font-medium'>No tickets found</p>
              <p className='text-sm'>
                {searchQuery
                  ? 'Try adjusting your search'
                  : 'Create a new ticket to get started'}
              </p>
            </div>
          ) : (
            // Virtual list - key forces complete re-render when filters change
            <div
              key={virtualizerKey}
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualItem) => {
                const ticket = tickets[virtualItem.index]
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <TicketCard
                      ticket={ticket}
                      isSelected={selectedTicketId === ticket.row_id}
                      isRecentlyUpdated={
                        recentlyUpdatedRowIds?.has(ticket.row_id) ?? false
                      }
                      onClick={() => onSelectTicket(ticket.row_id)}
                    />
                  </div>
                )
              })}
            </div>
          )}

          {/* Load more indicator */}
          {hasMore && tickets.length > 0 && (
            <div className='py-4 text-center'>
              <Button
                variant='outline'
                size='sm'
                onClick={onLoadMore}
                disabled={loading}
              >
                {loading
                  ? 'Loading...'
                  : `Load More (${(totalCount - displayedCount).toLocaleString()} remaining)`}
              </Button>
            </div>
          )}
        </div>
      </CardContent>

      <CreateTicketDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={() => {
          setCreateDialogOpen(false)
          onRefresh()
        }}
      />
    </Card>
  )
}

// Individual Ticket Card
interface TicketCardProps {
  ticket: Ticket
  isSelected: boolean
  isRecentlyUpdated?: boolean
  onClick: () => void
}

function TicketCard({
  ticket,
  isSelected,
  isRecentlyUpdated,
  onClick,
}: TicketCardProps) {
  const timeAgo = ticket.created_at
    ? formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })
    : ''

  return (
    <div
      onClick={onClick}
      className={cn(
        'mb-2 flex cursor-pointer overflow-hidden rounded-lg border transition-all',
        'hover:border-primary/50 hover:bg-accent/50',
        isSelected
          ? 'border-primary bg-primary/5 ring-primary/20 ring-1'
          : 'border-border bg-card',
        isRecentlyUpdated && 'animate-pulse ring-2 ring-blue-500 ring-offset-1'
      )}
    >
      {/* Priority indicator - left edge */}
      <div
        className={cn(
          'w-1 shrink-0',
          ticket.priority === 'High' && 'bg-red-500',
          ticket.priority === 'Medium' && 'bg-amber-500',
          ticket.priority === 'Low' && 'bg-green-500',
          !['High', 'Medium', 'Low'].includes(ticket.priority || '') &&
            'bg-muted-foreground'
        )}
        title={ticket.priority ? `Priority: ${ticket.priority}` : 'No priority'}
      />

      {/* Card content */}
      <div className='flex-1 p-3'>
        {/* Header: Ticket ID + ILC Department on left, Status on right */}
        <div className='mb-2 flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span
              className='border-border text-muted-foreground rounded border px-1.5 py-0.5 font-mono'
              style={{ fontSize: '0.96rem' }}
            >
              {ticket.ticket_id}
            </span>
            {ticket.ilc_department && (
              <span
                className='border-border text-muted-foreground rounded border px-1.5 py-0.5 font-mono'
                style={{ fontSize: '0.96rem' }}
              >
                {ticket.ilc_department}
              </span>
            )}
          </div>
          <div className='flex items-center gap-1.5'>
            {isRecentlyUpdated && (
              <span
                className='flex animate-pulse items-center gap-1 text-blue-500'
                title='Recently updated'
              >
                <IconBellRinging className='h-4 w-4' />
              </span>
            )}
            <TicketStatusBadge
              status={ticket.status}
              className='px-2 py-0 text-xs'
            />
          </div>
        </div>

        {/* Subject */}
        {ticket.subject && (
          <h4 className='mb-1 line-clamp-1 text-sm font-semibold'>
            {ticket.subject}
          </h4>
        )}

        {/* Description Preview */}
        {ticket.description && (
          <p className='text-muted-foreground mb-2 line-clamp-2 text-xs'>
            {ticket.description}
          </p>
        )}

        {/* Footer: Time, Requestor Name */}
        <div className='text-muted-foreground flex items-center justify-between text-xs'>
          <div className='flex items-center gap-3'>
            <span>{timeAgo}</span>
            {ticket.requestor_name && (
              <span className='text-foreground font-medium'>
                {ticket.requestor_name}
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {ticket.email && (
              <span className='max-w-[120px] truncate' title={ticket.email}>
                {ticket.email}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Skeleton loader for ticket cards
function TicketCardSkeleton() {
  return (
    <div className='border-border bg-card rounded-lg border p-3'>
      <div className='mb-2 flex items-center gap-2'>
        <Skeleton className='h-4 w-16' />
        <Skeleton className='h-5 w-14' />
        <Skeleton className='h-5 w-12' />
      </div>
      <Skeleton className='mb-1 h-5 w-3/4' />
      <Skeleton className='mb-1 h-4 w-full' />
      <Skeleton className='mb-3 h-4 w-2/3' />
      <div className='flex items-center justify-between'>
        <Skeleton className='h-3 w-20' />
        <Skeleton className='h-3 w-12' />
      </div>
    </div>
  )
}
