/**
 * Visitor Log Management Panel
 *
 * Enterprise-grade visitor tracking interface that integrates with the
 * RR Visitation Log Smartsheet. Provides approval/denial workflows,
 * filtering, search, and detailed visitor records.
 */
import React, { useState, useMemo, useCallback } from 'react'
import {
  IconUsers,
  IconCheck,
  IconX,
  IconClock,
  IconSearch,
  IconRefresh,
  IconChevronDown,
  IconChevronRight,
  IconShieldCheck,
  IconAlertTriangle,
  IconCalendarEvent,
  IconBuilding,
  IconMail,
  IconUser,
  IconLoader2,
  IconFilter,
  IconClipboardList,
  IconToolsKitchen2,
  IconFlag,
  IconUserCheck,
  IconDoorEnter,
  IconDoorExit,
  IconCalendarWeek,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useVisitorLog,
  useUpdateApprovalStatus,
  isCurrentWeek,
  parseLocalDate,
  type VisitorRecord,
  type VisitorFilterStatus,
  ApprovalStatus,
} from '../hooks/useVisitorLog'

// ==================== STAT CARD ====================

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  active,
  onClick,
}: {
  title: string
  value: number
  icon: React.ElementType
  color: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-4 text-left transition-all duration-200',
        'hover:border-primary/30 hover:shadow-md',
        active
          ? 'border-primary bg-primary/5 ring-primary/20 shadow-sm ring-1'
          : 'bg-card border-border'
      )}
    >
      <div className={cn('rounded-lg p-2.5', color)}>
        <Icon className='h-4.5 w-4.5 text-white' />
      </div>
      <div className='min-w-0'>
        <p className='text-2xl font-bold tracking-tight tabular-nums'>
          {value}
        </p>
        <p className='text-muted-foreground truncate text-xs font-medium'>
          {title}
        </p>
      </div>
    </button>
  )
}

// ==================== APPROVAL BADGE ====================

function ApprovalBadge({ status }: { status: ApprovalStatus | string }) {
  switch (status) {
    case ApprovalStatus.APPROVED:
      return (
        <Badge className='border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'>
          <IconCheck className='h-3 w-3' />
          Approved
        </Badge>
      )
    case ApprovalStatus.DENIED:
      return (
        <Badge className='border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400'>
          <IconX className='h-3 w-3' />
          Denied
        </Badge>
      )
    case ApprovalStatus.PENDING:
      return (
        <Badge className='border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'>
          <IconClock className='h-3 w-3' />
          Pending
        </Badge>
      )
    default:
      return (
        <Badge variant='outline' className='text-muted-foreground'>
          <IconClock className='h-3 w-3' />
          Awaiting
        </Badge>
      )
  }
}

// ==================== US PERSON BADGE ====================

function ComplianceBadge({
  usPerson,
  usCitizen,
}: {
  usPerson: boolean
  usCitizen: boolean
}) {
  if (usCitizen) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge className='gap-1 border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400'>
              <IconFlag className='h-3 w-3' />
              US Citizen
            </Badge>
          </TooltipTrigger>
          <TooltipContent>US Citizen - Cleared for all access</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  if (usPerson) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge className='gap-1 border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400'>
              <IconUserCheck className='h-3 w-3' />
              US Person
            </Badge>
          </TooltipTrigger>
          <TooltipContent>US Person classification</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Badge variant='outline' className='text-muted-foreground gap-1'>
            <IconAlertTriangle className='h-3 w-3' />
            Non-US
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Non-US Person - May require escort</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ==================== VISITOR DETAIL DIALOG ====================

function VisitorDetailDialog({
  visitor,
  open,
  onOpenChange,
  onApprove,
  onDeny,
  isUpdating,
}: {
  visitor: VisitorRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApprove: (rowId: number, response?: string) => void
  onDeny: (rowId: number, response?: string) => void
  isUpdating: boolean
}) {
  const [responseText, setResponseText] = useState('')

  if (!visitor) return null

  const isPending =
    visitor.approval_status === ApprovalStatus.PENDING ||
    visitor.approval_status === ApprovalStatus.BLANK

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 text-lg'>
            <IconUser className='text-primary h-5 w-5' />
            Visitor Details
          </DialogTitle>
          <DialogDescription>
            Review and manage visitor access request
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='max-h-[55vh] pr-4'>
          <div className='space-y-6'>
            {/* Status & Compliance Section */}
            <div className='flex flex-wrap items-center gap-3'>
              <ApprovalBadge status={visitor.approval_status} />
              <ComplianceBadge
                usPerson={visitor.us_person}
                usCitizen={visitor.us_citizen}
              />
              {visitor.within_24_hours && (
                <Badge className='border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400'>
                  <IconAlertTriangle className='h-3 w-3' />
                  Within 24hrs
                </Badge>
              )}
            </div>

            {/* Visitor Information */}
            <div className='grid grid-cols-2 gap-4'>
              <DetailField icon={IconUser} label='Name' value={visitor.name} />
              <DetailField
                icon={IconMail}
                label='Email'
                value={visitor.visitor_email}
              />
              <DetailField
                icon={IconBuilding}
                label='Company'
                value={visitor.company}
              />
              <DetailField
                icon={IconClipboardList}
                label='Department'
                value={visitor.department}
              />
              <DetailField
                icon={IconCalendarEvent}
                label='Arrival Date'
                value={visitor.arrival_date}
              />
              <DetailField
                icon={IconCalendarEvent}
                label='Request Date'
                value={visitor.request_date}
              />
            </div>

            {/* Time & Duration */}
            <div className='bg-muted/30 space-y-3 rounded-lg border p-4'>
              <h4 className='text-foreground flex items-center gap-2 text-sm font-semibold'>
                <IconClock className='h-4 w-4' />
                Time & Duration
              </h4>
              <div className='grid grid-cols-3 gap-3'>
                <div>
                  <p className='text-muted-foreground text-xs'>Check In</p>
                  <p className='text-sm font-medium'>
                    {visitor.check_in || '—'}
                  </p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>Check Out</p>
                  <p className='text-sm font-medium'>
                    {visitor.check_out || '—'}
                  </p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>Duration</p>
                  <p className='text-sm font-medium'>
                    {visitor.duration_hours
                      ? `${visitor.duration_hours}h`
                      : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* POC Information */}
            <div className='bg-muted/30 space-y-3 rounded-lg border p-4'>
              <h4 className='text-foreground text-sm font-semibold'>
                Point of Contact
              </h4>
              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <p className='text-muted-foreground text-xs'>ILC POC</p>
                  <p className='text-sm font-medium'>
                    {visitor.ilc_poc || '—'}
                  </p>
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>Backup POC</p>
                  <p className='text-sm font-medium'>
                    {visitor.backup_poc || '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Purpose & Equipment */}
            <div className='space-y-3'>
              <DetailField
                icon={IconClipboardList}
                label='Reason / Scope of Work'
                value={visitor.reason_scope}
                fullWidth
              />
              {visitor.tooling_equipment && (
                <DetailField
                  icon={IconToolsKitchen2}
                  label='Tooling / Equipment / Materials'
                  value={visitor.tooling_equipment}
                  fullWidth
                />
              )}
              {visitor.tka_asset_support && (
                <DetailField
                  icon={IconShieldCheck}
                  label='TKA Asset Support Needed'
                  value={visitor.tka_asset_support}
                  fullWidth
                />
              )}
            </div>

            {/* Response/Acknowledgement */}
            {(visitor.response || visitor.acknowledgement) && (
              <div className='bg-muted/30 space-y-3 rounded-lg border p-4'>
                <h4 className='text-foreground text-sm font-semibold'>
                  Response & Acknowledgement
                </h4>
                {visitor.response && (
                  <div>
                    <p className='text-muted-foreground text-xs'>Response</p>
                    <p className='text-sm'>{visitor.response}</p>
                  </div>
                )}
                {visitor.acknowledgement && (
                  <div>
                    <p className='text-muted-foreground text-xs'>
                      Acknowledgement
                    </p>
                    <p className='text-sm'>{visitor.acknowledgement}</p>
                  </div>
                )}
              </div>
            )}

            {/* Response Input (for pending visitors) */}
            {isPending && (
              <div className='space-y-2'>
                <label className='text-foreground text-sm font-medium'>
                  Response Note (optional)
                </label>
                <Textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder='Add a note for the approval or denial...'
                  className='resize-none'
                  rows={3}
                />
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className='gap-2 sm:gap-0'>
          {isPending ? (
            <>
              <Button
                variant='outline'
                onClick={() => onOpenChange(false)}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={() => {
                  onDeny(visitor.row_id, responseText || undefined)
                  setResponseText('')
                }}
                disabled={isUpdating}
                className='gap-1.5'
              >
                {isUpdating ? (
                  <IconLoader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <IconX className='h-4 w-4' />
                )}
                Deny
              </Button>
              <Button
                onClick={() => {
                  onApprove(visitor.row_id, responseText || undefined)
                  setResponseText('')
                }}
                disabled={isUpdating}
                className='gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700'
              >
                {isUpdating ? (
                  <IconLoader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <IconCheck className='h-4 w-4' />
                )}
                Approve
              </Button>
            </>
          ) : (
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailField({
  icon: Icon,
  label,
  value,
  fullWidth,
}: {
  icon?: React.ElementType
  label: string
  value: string
  fullWidth?: boolean
}) {
  return (
    <div className={cn(fullWidth && 'col-span-2')}>
      <p className='text-muted-foreground mb-0.5 flex items-center gap-1 text-xs'>
        {Icon && <Icon className='h-3 w-3' />}
        {label}
      </p>
      <p className='text-foreground text-sm font-medium wrap-break-word whitespace-normal'>
        {value || '—'}
      </p>
    </div>
  )
}

// ==================== MAIN PANEL ====================

export function VisitorLogPanel() {
  const {
    allVisitors,
    stats,
    isLoading,
    isFetching,
    error,
    refetch,
    hasMore,
    loadMore,
  } = useVisitorLog()

  const { updateApproval } = useUpdateApprovalStatus()

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<VisitorFilterStatus>('all')
  const [selectedVisitor, setSelectedVisitor] = useState<VisitorRecord | null>(
    null
  )
  const [detailOpen, setDetailOpen] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [updatingRowId, setUpdatingRowId] = useState<number | null>(null)

  // Filter and search visitors
  const filteredVisitors = useMemo(() => {
    let list = allVisitors

    // Apply status / date filter
    switch (filter) {
      case 'pending':
        list = list.filter(
          (v) =>
            v.approval_status === ApprovalStatus.PENDING ||
            v.approval_status === ApprovalStatus.BLANK
        )
        break
      case 'approved':
        list = list.filter((v) => v.approval_status === ApprovalStatus.APPROVED)
        break
      case 'denied':
        list = list.filter((v) => v.approval_status === ApprovalStatus.DENIED)
        break
      case 'today': {
        const todayStr = new Date().toISOString().split('T')[0]
        list = list.filter((v) => {
          if (!v.arrival_date) return false
          const d = parseLocalDate(v.arrival_date)
          if (!d) return false
          const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          return dStr === todayStr
        })
        break
      }
      case 'this_week':
        list = list.filter((v) => isCurrentWeek(v.arrival_date))
        break
      case 'all':
      default:
        break
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.visitor_email.toLowerCase().includes(q) ||
          v.company.toLowerCase().includes(q) ||
          v.department.toLowerCase().includes(q) ||
          v.ilc_poc.toLowerCase().includes(q) ||
          v.reason_scope.toLowerCase().includes(q)
      )
    }

    return list
  }, [allVisitors, filter, search])

  // Group filtered visitors by arrival date for section headers
  const groupedVisitors = useMemo(() => {
    const groups: {
      label: string
      sortKey: string
      visitors: VisitorRecord[]
    }[] = []
    const map = new Map<string, VisitorRecord[]>()

    for (const v of filteredVisitors) {
      const key = v.arrival_date || '__no_date__'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(v)
    }

    /**
     * Parse a date string as LOCAL midnight to avoid UTC timezone shift.
     * "2026-02-09" via `new Date()` = UTC midnight which shifts to the
     * prior day in negative-offset timezones. Splitting the parts avoids this.
     */
    const parseLocalDate = (str: string): Date | null => {
      // Handle YYYY-MM-DD
      const parts = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (parts) {
        return new Date(
          Number(parts[1]),
          Number(parts[2]) - 1,
          Number(parts[3])
        )
      }
      // Handle MM/DD/YYYY
      const slashParts = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
      if (slashParts) {
        return new Date(
          Number(slashParts[3]),
          Number(slashParts[1]) - 1,
          Number(slashParts[2])
        )
      }
      // Fallback — let JS parse but force to local midnight
      const d = new Date(str)
      if (isNaN(d.getTime())) return null
      return new Date(d.getFullYear(), d.getMonth(), d.getDate())
    }

    // Sort groups by date ascending (soonest first)
    const entries = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === '__no_date__') return 1
      if (b[0] === '__no_date__') return -1
      const da = parseLocalDate(a[0])
      const db = parseLocalDate(b[0])
      if (da && db) return da.getTime() - db.getTime()
      return a[0].localeCompare(b[0])
    })

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)

    for (const [key, visitors] of entries) {
      let label = key
      if (key === '__no_date__') {
        label = 'No Date'
      } else {
        try {
          const d = parseLocalDate(key)
          if (d) {
            if (d.getTime() === today.getTime()) {
              label = 'Today'
            } else if (d.getTime() === yesterday.getTime()) {
              label = 'Yesterday'
            } else if (d.getTime() === tomorrow.getTime()) {
              label = 'Tomorrow'
            } else {
              label = d.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year:
                  d.getFullYear() !== today.getFullYear()
                    ? 'numeric'
                    : undefined,
              })
            }
          }
        } catch {
          // keep raw string
        }
      }
      groups.push({ label, sortKey: key, visitors })
    }

    return groups
  }, [filteredVisitors])

  const handleApprove = useCallback(
    async (rowId: number, response?: string) => {
      setUpdatingRowId(rowId)
      try {
        await updateApproval(rowId, ApprovalStatus.APPROVED, response)
        setDetailOpen(false)
      } finally {
        setUpdatingRowId(null)
      }
    },
    [updateApproval]
  )

  const handleDeny = useCallback(
    async (rowId: number, response?: string) => {
      setUpdatingRowId(rowId)
      try {
        await updateApproval(rowId, ApprovalStatus.DENIED, response)
        setDetailOpen(false)
      } finally {
        setUpdatingRowId(null)
      }
    },
    [updateApproval]
  )

  const toggleRowExpand = useCallback((rowId: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }, [])

  const openDetail = useCallback((visitor: VisitorRecord) => {
    setSelectedVisitor(visitor)
    setDetailOpen(true)
  }, [])

  // Loading state
  if (isLoading) {
    return (
      <div className='animate-in fade-in space-y-6 duration-300'>
        <div className='grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6'>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className='bg-muted/40 h-[88px] animate-pulse rounded-lg border'
            />
          ))}
        </div>
        <div className='bg-muted/40 h-12 animate-pulse rounded-lg' />
        <div className='bg-muted/40 h-[400px] animate-pulse rounded-lg' />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className='flex h-64 flex-col items-center justify-center gap-4'>
        <IconAlertTriangle className='text-destructive h-10 w-10' />
        <div className='space-y-1 text-center'>
          <p className='text-destructive font-medium'>
            Failed to load visitor log
          </p>
          <p className='text-muted-foreground text-sm'>
            {error instanceof Error
              ? error.message
              : 'Unable to connect to Smartsheet'}
          </p>
        </div>
        <Button variant='outline' onClick={() => refetch()} className='gap-2'>
          <IconRefresh className='h-4 w-4' />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className='animate-in fade-in space-y-5 duration-300'>
      {/* Stats Overview */}
      <div className='grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6'>
        <StatCard
          title='Total Visitors'
          value={stats.total}
          icon={IconUsers}
          color='bg-slate-600'
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <StatCard
          title='Pending Review'
          value={stats.pending}
          icon={IconClock}
          color='bg-amber-500'
          active={filter === 'pending'}
          onClick={() => setFilter('pending')}
        />
        <StatCard
          title='Approved'
          value={stats.approved}
          icon={IconCheck}
          color='bg-emerald-500'
          active={filter === 'approved'}
          onClick={() => setFilter('approved')}
        />
        <StatCard
          title='Denied'
          value={stats.denied}
          icon={IconX}
          color='bg-red-500'
          active={filter === 'denied'}
          onClick={() => setFilter('denied')}
        />
        <StatCard
          title="Today's Visitors"
          value={stats.todayVisitors}
          icon={IconCalendarEvent}
          color='bg-blue-500'
          active={filter === 'today'}
          onClick={() => setFilter(filter === 'today' ? 'all' : 'today')}
        />
        <StatCard
          title='Currently On-Site'
          value={stats.checkedIn}
          icon={IconDoorEnter}
          color='bg-violet-500'
        />
      </div>

      {/* Toolbar */}
      <div className='flex items-center gap-3'>
        <div className='relative max-w-sm flex-1'>
          <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search visitors, companies, POCs...'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='h-9 pl-9'
          />
        </div>
        <div className='ml-auto flex items-center gap-1.5'>
          <Button
            variant={filter === 'this_week' ? 'default' : 'outline'}
            size='sm'
            onClick={() =>
              setFilter(filter === 'this_week' ? 'all' : 'this_week')
            }
            className='h-9 gap-1.5'
          >
            <IconCalendarWeek className='h-4 w-4' />
            This Week
            <Badge
              variant='secondary'
              className={cn(
                'ml-0.5 h-5 min-w-[20px] px-1.5 text-[10px] font-bold',
                filter === 'this_week' &&
                  'bg-primary-foreground/20 text-primary-foreground'
              )}
            >
              {stats.thisWeekVisitors}
            </Badge>
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className='h-9 gap-1.5'
                >
                  <IconRefresh
                    className={cn('h-4 w-4', isFetching && 'animate-spin')}
                  />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload data from Smartsheet</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Results count */}
      <div className='text-muted-foreground flex items-center justify-between px-1 text-xs'>
        <span>
          Showing {filteredVisitors.length} of {allVisitors.length} visitor
          {allVisitors.length !== 1 ? 's' : ''}
          {filter === 'today' && ' — today'}
          {filter === 'this_week' && ' — current week'}
          {filter !== 'all' && (
            <button
              onClick={() => setFilter('all')}
              className='text-primary ml-2 hover:underline'
            >
              Clear filter
            </button>
          )}
        </span>
        {isFetching && !isLoading && (
          <span className='flex items-center gap-1'>
            <IconLoader2 className='h-3 w-3 animate-spin' />
            Syncing...
          </span>
        )}
      </div>

      {/* Visitor Table */}
      <Card className='overflow-hidden'>
        <ScrollArea className='w-full'>
          <Table>
            <TableHeader>
              <TableRow className='bg-muted/40'>
                <TableHead className='w-8' />
                <TableHead className='min-w-[160px]'>Visitor</TableHead>
                <TableHead className='min-w-[120px]'>Company</TableHead>
                <TableHead className='min-w-[100px]'>Arrival Date</TableHead>
                <TableHead className='min-w-[100px]'>ILC POC</TableHead>
                <TableHead className='min-w-[80px]'>Compliance</TableHead>
                <TableHead className='min-w-[100px]'>Status</TableHead>
                <TableHead className='min-w-[160px] text-right'>
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVisitors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <div className='flex flex-col items-center justify-center py-12 text-center'>
                      <IconFilter className='text-muted-foreground/50 mb-2 h-8 w-8' />
                      <p className='text-muted-foreground text-sm font-medium'>
                        No visitors found
                      </p>
                      <p className='text-muted-foreground/70 mt-1 text-xs'>
                        {search
                          ? 'Try a different search term'
                          : 'No visitor records match the current filter'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                groupedVisitors.map((group) => (
                  <React.Fragment key={`group-${group.sortKey}`}>
                    {/* Date section header */}
                    <TableRow className='hover:bg-transparent'>
                      <TableCell
                        colSpan={8}
                        className='bg-muted/50 border-b px-3 py-2'
                      >
                        <div className='flex items-center gap-2'>
                          <IconCalendarEvent className='text-muted-foreground h-3.5 w-3.5' />
                          <span className='text-muted-foreground text-xs font-semibold tracking-wider uppercase'>
                            {group.label}
                          </span>
                          <Badge
                            variant='secondary'
                            className='h-4.5 min-w-[20px] px-1.5 text-[10px] font-bold'
                          >
                            {group.visitors.length}
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                    {group.visitors.map((visitor) => {
                      const isExpanded = expandedRows.has(visitor.row_id)
                      const isPending =
                        visitor.approval_status === ApprovalStatus.PENDING ||
                        visitor.approval_status === ApprovalStatus.BLANK

                      return (
                        <React.Fragment key={visitor.row_id}>
                          <TableRow
                            className={cn(
                              'group cursor-pointer',
                              isPending && 'bg-amber-500/2',
                              isExpanded && 'border-b-0'
                            )}
                            onClick={() => toggleRowExpand(visitor.row_id)}
                          >
                            <TableCell className='w-8 pr-0'>
                              {isExpanded ? (
                                <IconChevronDown className='text-muted-foreground h-4 w-4' />
                              ) : (
                                <IconChevronRight className='text-muted-foreground h-4 w-4' />
                              )}
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className='text-sm font-medium'>
                                  {visitor.name || '—'}
                                </p>
                                <p className='text-muted-foreground max-w-[180px] truncate text-xs'>
                                  {visitor.visitor_email || '—'}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className='text-sm'>
                                  {visitor.company || '—'}
                                </p>
                                <p className='text-muted-foreground text-xs'>
                                  {visitor.department || ''}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className='text-sm'>
                                {visitor.arrival_date || '—'}
                              </p>
                            </TableCell>
                            <TableCell>
                              <p className='text-sm'>
                                {visitor.ilc_poc || '—'}
                              </p>
                            </TableCell>
                            <TableCell>
                              <ComplianceBadge
                                usPerson={visitor.us_person}
                                usCitizen={visitor.us_citizen}
                              />
                            </TableCell>
                            <TableCell>
                              <ApprovalBadge status={visitor.approval_status} />
                            </TableCell>
                            <TableCell className='text-right'>
                              <div
                                className='flex items-center justify-end gap-1.5'
                                onClick={(e) => e.stopPropagation()}
                              >
                                {isPending ? (
                                  <>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size='sm'
                                            variant='destructive'
                                            className='h-7 gap-1 px-2.5 text-xs'
                                            onClick={() =>
                                              handleDeny(visitor.row_id)
                                            }
                                            disabled={
                                              updatingRowId === visitor.row_id
                                            }
                                          >
                                            {updatingRowId ===
                                            visitor.row_id ? (
                                              <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
                                            ) : (
                                              <IconX className='h-3.5 w-3.5' />
                                            )}
                                            Deny
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Deny visitor access
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size='sm'
                                            className='h-7 gap-1 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700'
                                            onClick={() =>
                                              handleApprove(visitor.row_id)
                                            }
                                            disabled={
                                              updatingRowId === visitor.row_id
                                            }
                                          >
                                            {updatingRowId ===
                                            visitor.row_id ? (
                                              <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
                                            ) : (
                                              <IconCheck className='h-3.5 w-3.5' />
                                            )}
                                            Approve
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Approve visitor access
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </>
                                ) : (
                                  <Button
                                    size='sm'
                                    variant='ghost'
                                    className='h-7 px-2.5 text-xs'
                                    onClick={() => openDetail(visitor)}
                                  >
                                    View Details
                                  </Button>
                                )}
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  className='h-7 w-7 p-0'
                                  onClick={() => openDetail(visitor)}
                                >
                                  <IconChevronRight className='h-4 w-4' />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>

                          {/* Expanded detail row — rendered inline directly after the data row */}
                          {isExpanded && (
                            <TableRow className='border-b hover:bg-transparent'>
                              <TableCell colSpan={8} className='p-0'>
                                <div className='bg-muted/20 animate-in slide-in-from-top-1 px-6 py-4 duration-200'>
                                  {/* Reason / Scope — full width since it can be long */}
                                  <div className='mb-3 text-sm'>
                                    <p className='text-muted-foreground mb-0.5 text-xs'>
                                      Reason / Scope of Work
                                    </p>
                                    <p className='font-medium wrap-break-word whitespace-normal'>
                                      {visitor.reason_scope || '—'}
                                    </p>
                                  </div>

                                  {/* Short fields in a grid */}
                                  <div className='grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4'>
                                    <div>
                                      <p className='text-muted-foreground mb-0.5 text-xs'>
                                        Backup POC
                                      </p>
                                      <p className='font-medium wrap-break-word'>
                                        {visitor.backup_poc || '—'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className='text-muted-foreground mb-0.5 flex items-center gap-1 text-xs'>
                                        <IconDoorEnter className='h-3 w-3' />{' '}
                                        Check In
                                      </p>
                                      <p className='font-medium'>
                                        {visitor.check_in || '—'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className='text-muted-foreground mb-0.5 flex items-center gap-1 text-xs'>
                                        <IconDoorExit className='h-3 w-3' />{' '}
                                        Check Out
                                      </p>
                                      <p className='font-medium'>
                                        {visitor.check_out || '—'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className='text-muted-foreground mb-0.5 text-xs'>
                                        Duration
                                      </p>
                                      <p className='font-medium'>
                                        {visitor.duration_hours
                                          ? `${visitor.duration_hours} hours`
                                          : '—'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className='text-muted-foreground mb-0.5 text-xs'>
                                        TKA Asset Support
                                      </p>
                                      <p className='font-medium wrap-break-word'>
                                        {visitor.tka_asset_support || '—'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className='text-muted-foreground mb-0.5 text-xs'>
                                        Request Date
                                      </p>
                                      <p className='font-medium'>
                                        {visitor.request_date || '—'}
                                      </p>
                                    </div>
                                  </div>

                                  {/* Tooling / Equipment — full width since it can be long */}
                                  {visitor.tooling_equipment && (
                                    <div className='mt-3 text-sm'>
                                      <p className='text-muted-foreground mb-0.5 text-xs'>
                                        Tooling / Equipment / Materials
                                      </p>
                                      <p className='font-medium wrap-break-word whitespace-normal'>
                                        {visitor.tooling_equipment}
                                      </p>
                                    </div>
                                  )}

                                  {/* Approval actions & status bar */}
                                  <div className='bg-background mt-4 flex items-center justify-between rounded-lg border p-3'>
                                    <div className='flex items-center gap-3'>
                                      <span className='text-muted-foreground text-xs font-medium'>
                                        Approval Status:
                                      </span>
                                      <ApprovalBadge
                                        status={visitor.approval_status}
                                      />
                                    </div>
                                    <div className='flex items-center gap-2'>
                                      {isPending ? (
                                        <>
                                          <Button
                                            size='sm'
                                            variant='destructive'
                                            className='h-8 gap-1.5 px-3 text-xs'
                                            onClick={() =>
                                              handleDeny(visitor.row_id)
                                            }
                                            disabled={
                                              updatingRowId === visitor.row_id
                                            }
                                          >
                                            {updatingRowId ===
                                            visitor.row_id ? (
                                              <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
                                            ) : (
                                              <IconX className='h-3.5 w-3.5' />
                                            )}
                                            Deny Access
                                          </Button>
                                          <Button
                                            size='sm'
                                            className='h-8 gap-1.5 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700'
                                            onClick={() =>
                                              handleApprove(visitor.row_id)
                                            }
                                            disabled={
                                              updatingRowId === visitor.row_id
                                            }
                                          >
                                            {updatingRowId ===
                                            visitor.row_id ? (
                                              <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
                                            ) : (
                                              <IconCheck className='h-3.5 w-3.5' />
                                            )}
                                            Approve Access
                                          </Button>
                                        </>
                                      ) : (
                                        <>
                                          {visitor.approval_status ===
                                            ApprovalStatus.APPROVED && (
                                            <Button
                                              size='sm'
                                              variant='destructive'
                                              className='h-8 gap-1.5 px-3 text-xs'
                                              onClick={() =>
                                                handleDeny(visitor.row_id)
                                              }
                                              disabled={
                                                updatingRowId === visitor.row_id
                                              }
                                            >
                                              {updatingRowId ===
                                              visitor.row_id ? (
                                                <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
                                              ) : (
                                                <IconX className='h-3.5 w-3.5' />
                                              )}
                                              Revoke Approval
                                            </Button>
                                          )}
                                          {visitor.approval_status ===
                                            ApprovalStatus.DENIED && (
                                            <Button
                                              size='sm'
                                              className='h-8 gap-1.5 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700'
                                              onClick={() =>
                                                handleApprove(visitor.row_id)
                                              }
                                              disabled={
                                                updatingRowId === visitor.row_id
                                              }
                                            >
                                              {updatingRowId ===
                                              visitor.row_id ? (
                                                <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
                                              ) : (
                                                <IconCheck className='h-3.5 w-3.5' />
                                              )}
                                              Approve Access
                                            </Button>
                                          )}
                                        </>
                                      )}
                                      <div className='bg-border mx-1 h-5 w-px' />
                                      <Button
                                        size='sm'
                                        variant='outline'
                                        className='h-8 gap-1 text-xs'
                                        onClick={() => openDetail(visitor)}
                                      >
                                        Full Details
                                        <IconChevronRight className='h-3.5 w-3.5' />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </Card>

      {/* Load More */}
      {hasMore && filter === 'all' && !search && (
        <div className='flex justify-center'>
          <Button variant='outline' onClick={loadMore} className='gap-2'>
            Load More Visitors
            <IconChevronDown className='h-4 w-4' />
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <VisitorDetailDialog
        visitor={selectedVisitor}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onApprove={handleApprove}
        onDeny={handleDeny}
        isUpdating={
          selectedVisitor ? updatingRowId === selectedVisitor.row_id : false
        }
      />
    </div>
  )
}
