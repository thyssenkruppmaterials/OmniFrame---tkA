// Created and developed by Jai Singh
import { useRef, useEffect, useCallback, useMemo } from 'react'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  IconSearch,
  IconRefresh,
  IconBellRinging,
  IconInbox,
} from '@tabler/icons-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { useEntityFocus } from '@/hooks/use-entity-focus'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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
import { EntityFocusPill } from '@/components/presence/entity-focus-pill'
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
  hasMore?: boolean
  onLoadMore?: () => void
  totalCount?: number
  displayedCount?: number
  departmentFilter: string | null
  onDepartmentFilterChange: (dept: string | null) => void
  departments: string[]
  recentlyUpdatedRowIds?: Set<number>
  onClearUpdatedRow?: (rowId: number) => void
}

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

  // Tier 2 #1 — soft-locking pill on the currently-selected ticket.
  // Establishes a short-lived focus lease in `rust-work-service` so
  // colleagues editing the same ticket see "Sarah is editing"
  // immediately. Lease auto-expires 30s after the row deselects.
  // Pattern documented in Patterns/Entity-Focus-Soft-Locking.md.
  const { focusedUsers: focusedOnSelection } = useEntityFocus({
    entityKind: 'ticket',
    entityId: selectedTicketId,
  })

  const virtualizerKey = useMemo(() => {
    return `${statusFilter}-${departmentFilter ?? 'all'}-${searchQuery}`
  }, [statusFilter, departmentFilter, searchQuery])

  const virtualizer = useVirtualizer({
    count: tickets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TICKET_CARD_HEIGHT,
    overscan: 5,
    getItemKey: (index) => tickets[index]?.row_id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0
    }
  }, [virtualizerKey])

  const handleScroll = useCallback(() => {
    if (!parentRef.current || !hasMore || !onLoadMore) return

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current
    const scrollPercentage = (scrollTop + clientHeight) / scrollHeight

    if (scrollPercentage > 0.8) {
      onLoadMore()
    }
  }, [hasMore, onLoadMore])

  useEffect(() => {
    const scrollElement = parentRef.current
    if (!scrollElement) return

    scrollElement.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollElement.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  return (
    <Card className='flex h-full flex-col overflow-hidden'>
      <CardHeader className='space-y-3 border-b px-4 pt-4 pb-3'>
        {/* Title Row */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2.5'>
            <h2 className='text-base font-semibold tracking-tight'>
              Support Tickets
            </h2>
            {totalCount > 0 && (
              <span className='bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums'>
                {tickets.length.toLocaleString()} /{' '}
                {totalCount.toLocaleString()}
              </span>
            )}
          </div>
          <div className='flex items-center gap-1.5'>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              onClick={onRefresh}
              disabled={loading}
              title='Refresh tickets'
            >
              <IconRefresh
                className={cn('h-3.5 w-3.5', loading && 'animate-spin')}
              />
            </Button>
          </div>
        </div>

        {/* Search + Department Filter */}
        <div className='flex flex-wrap gap-2'>
          <div className='relative min-w-0 flex-1'>
            <IconSearch className='text-muted-foreground/60 absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
            <Input
              placeholder='Search tickets...'
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className='h-8 pl-8 text-xs'
            />
          </div>
          <Select
            value={departmentFilter ?? 'all'}
            onValueChange={(value) =>
              onDepartmentFilterChange(value === 'all' ? null : value)
            }
          >
            <SelectTrigger
              size='sm'
              className='h-8 w-[140px] max-w-full min-w-0 text-xs'
            >
              <SelectValue placeholder='All Depts' />
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

        {/* Status Filter Tabs */}
        <TicketStatusFilter
          value={statusFilter}
          onChange={onStatusFilterChange}
          stats={stats}
        />
      </CardHeader>

      <CardContent className='flex-1 overflow-hidden p-0'>
        <div ref={parentRef} className='h-[calc(100vh-340px)] overflow-auto'>
          {loading && tickets.length === 0 ? (
            <div className='space-y-px p-1'>
              {Array.from({ length: 6 }).map((_, i) => (
                <TicketCardSkeleton key={i} />
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-16'>
              <div className='bg-muted/50 mb-4 flex h-12 w-12 items-center justify-center rounded-full'>
                <IconInbox className='text-muted-foreground/50 h-6 w-6' />
              </div>
              <p className='text-foreground mb-1 text-sm font-medium'>
                No tickets found
              </p>
              <p className='text-muted-foreground text-xs'>
                {searchQuery
                  ? 'Try adjusting your search or filters'
                  : 'All clear — no tickets match this filter'}
              </p>
            </div>
          ) : (
            <div
              key={virtualizerKey}
              className='p-1'
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
                      focusedUsers={
                        selectedTicketId === ticket.row_id
                          ? focusedOnSelection
                          : undefined
                      }
                    />
                  </div>
                )
              })}
            </div>
          )}

          {hasMore && tickets.length > 0 && (
            <div className='border-t px-4 py-3 text-center'>
              <Button
                variant='ghost'
                size='sm'
                onClick={onLoadMore}
                disabled={loading}
                className='text-xs'
              >
                {loading
                  ? 'Loading...'
                  : `Load ${(totalCount - displayedCount).toLocaleString()} more`}
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

interface TicketCardProps {
  ticket: Ticket
  isSelected: boolean
  isRecentlyUpdated?: boolean
  onClick: () => void
  /**
   * Tier 2 #1 — when present, render the EntityFocusPill on the
   * card. Only the selected card receives this; other cards omit
   * the pill so we don't fan out a focus heartbeat for every
   * visible row. See `Patterns/Entity-Focus-Soft-Locking.md`.
   */
  focusedUsers?: import('@/lib/presence/types').PresenceUser[]
}

function TicketCard({
  ticket,
  isSelected,
  isRecentlyUpdated,
  onClick,
  focusedUsers,
}: TicketCardProps) {
  const timeAgo = ticket.created_at
    ? formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })
    : ''

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative mx-1 mb-0.5 flex cursor-pointer gap-3 rounded-lg px-3 py-2.5 transition-all duration-150',
        isSelected ? 'bg-primary/8 dark:bg-primary/15' : 'hover:bg-accent/60',
        isRecentlyUpdated && !isSelected && 'bg-blue-500/6 dark:bg-blue-500/10'
      )}
    >
      {/* Left accent bar */}
      <div
        className={cn(
          'mt-0.5 w-0.5 shrink-0 rounded-full transition-colors',
          isSelected
            ? 'bg-primary'
            : ticket.priority === 'High'
              ? 'bg-red-500'
              : ticket.priority === 'Medium'
                ? 'bg-amber-400'
                : ticket.priority === 'Low'
                  ? 'bg-emerald-500'
                  : 'bg-border'
        )}
      />

      {/* Content */}
      <div className='min-w-0 flex-1'>
        {/* Row 1: ID + Department + Status */}
        <div className='mb-1 flex items-center gap-2'>
          <span className='text-foreground shrink-0 text-xs font-semibold tracking-tight'>
            {ticket.ticket_id}
          </span>
          {ticket.ilc_department && (
            <span className='text-muted-foreground truncate text-[11px]'>
              {ticket.ilc_department}
            </span>
          )}
          <div className='ml-auto flex shrink-0 items-center gap-1.5'>
            {isRecentlyUpdated && (
              <IconBellRinging className='h-3.5 w-3.5 animate-pulse text-blue-500' />
            )}
            {focusedUsers && focusedUsers.length > 0 && (
              <EntityFocusPill users={focusedUsers} compact />
            )}
            <TicketStatusBadge
              status={ticket.status}
              className='h-5 px-1.5 py-0 text-[10px]'
            />
          </div>
        </div>

        {/* Row 2: Subject */}
        {ticket.subject && (
          <p className='text-foreground mb-0.5 line-clamp-1 text-[13px] leading-snug font-medium'>
            {ticket.subject}
          </p>
        )}

        {/* Row 3: Description preview */}
        {ticket.description && (
          <p className='text-muted-foreground mb-1.5 line-clamp-1 text-xs leading-relaxed'>
            {ticket.description}
          </p>
        )}

        {/* Row 4: Footer meta */}
        <div className='text-muted-foreground flex items-center gap-2 text-[11px]'>
          <span className='tabular-nums'>{timeAgo}</span>
          {ticket.requestor_name && (
            <>
              <span className='text-border'>·</span>
              <span className='text-foreground/70 truncate font-medium'>
                {ticket.requestor_name}
              </span>
            </>
          )}
          {ticket.email && !ticket.requestor_name && (
            <>
              <span className='text-border'>·</span>
              <span className='truncate'>{ticket.email}</span>
            </>
          )}
          {ticket.email && ticket.requestor_name && (
            <>
              <span className='text-border'>·</span>
              <span className='max-w-[100px] truncate' title={ticket.email}>
                {ticket.email}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TicketCardSkeleton() {
  return (
    <div className='mx-1 flex gap-3 rounded-lg px-3 py-2.5'>
      <Skeleton className='mt-0.5 h-12 w-0.5 rounded-full' />
      <div className='flex-1 space-y-2'>
        <div className='flex items-center gap-2'>
          <Skeleton className='h-3.5 w-20' />
          <Skeleton className='h-3.5 w-14' />
          <Skeleton className='ml-auto h-5 w-16 rounded-full' />
        </div>
        <Skeleton className='h-4 w-4/5' />
        <Skeleton className='h-3 w-3/5' />
        <div className='flex gap-2'>
          <Skeleton className='h-3 w-16' />
          <Skeleton className='h-3 w-24' />
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
