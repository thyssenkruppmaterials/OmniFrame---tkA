// Created and developed by Jai Singh
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, toZonedTime } from 'date-fns-tz'
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Camera,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  FileText,
  Loader2,
  Lock,
  MapPin,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Scan,
  Search,
  Target,
  Trash2,
  Upload,
  User,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import type {
  AssignmentHistoryRecord,
  CycleCountData,
  CycleCountDataWithUser,
  CycleCountPriority,
} from '@/lib/supabase/cycle-count.service'
import { CycleCountService } from '@/lib/supabase/cycle-count.service'
import type { DeferHistoryEntry } from '@/lib/supabase/defer-history.service'
import { locationValidationService } from '@/lib/supabase/location-validation.service'
import { materialValidationService } from '@/lib/supabase/material-validation.service'
import { workService } from '@/lib/supabase/work.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import type { WsEvent } from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'
import { ACTIVE_WORKERS_QUERY_KEY } from '@/hooks/use-active-workers'
import {
  BUILT_IN_COUNT_TYPE_OPTIONS,
  resolveCountTypeLabel,
  useCountTypeOptions,
} from '@/hooks/use-count-type-options'
import {
  CYCLE_COUNT_OPERATIONS_QUERY_KEY,
  CYCLE_COUNT_STATISTICS_QUERY_KEY,
  useCycleCountOperations,
} from '@/hooks/use-cycle-count-operations'
import {
  useDeferHistoryForCount,
  useDeferHistoryForOrg,
  useDistinctDeferUsers,
  type DistinctDeferUser,
} from '@/hooks/use-defer-history'
import { useActiveZones } from '@/hooks/use-zone-rules'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CycleCountImportProgressDialog } from '@/components/ui/cycle-count-import-progress-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { KpiGrid } from '@/components/ui/kpi-grid'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  ResponsiveDialog,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatTile as KpiStatTile } from '@/components/ui/stat-tile'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddCountsFromLX03Modal } from '@/components/add-counts-from-lx03-modal'
import { LiveOperatorStatus } from '@/components/live-operator-status'
import { UserAssignmentModal } from '@/components/user-assignment-modal'
import { WorkDistributionPanel } from '@/components/work-distribution-panel'

// EST Timezone formatting utility (formatDateTimeEST removed - was unused)

const formatDateEST = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A'

  try {
    // Date-only strings (YYYY-MM-DD) are business dates — display as-is without
    // timezone conversion to avoid the classic UTC-midnight off-by-one shift.
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      const [y, m, d] = dateString.split('-')
      return `${m}/${d}/${y}`
    }

    const date = new Date(dateString)
    const estTimezone = 'America/New_York'
    const zonedDate = toZonedTime(date, estTimezone)

    return format(zonedDate, 'MM/dd/yyyy', { timeZone: estTimezone })
  } catch (error) {
    logger.error('Date formatting error:', error)
    return 'Invalid Date'
  }
}

const formatTimestampEST = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A'

  try {
    const date = new Date(dateString)
    const estTimezone = 'America/New_York'
    const zonedDate = toZonedTime(date, estTimezone)

    return format(zonedDate, 'MM/dd/yyyy hh:mm a', { timeZone: estTimezone })
  } catch (error) {
    logger.error('Timestamp formatting error:', error)
    return 'Invalid Date'
  }
}

interface ManualCountsSearchProps {
  enableRealtime?: boolean
}

// TableColumn interface removed - was unused

interface SortConfig {
  key: string
  direction: 'asc' | 'desc'
}

/** Per-column filters (client-side, applied after global search). */
interface ManualCountsColumnFilters {
  countNumber: string
  countType: string
  priority: string
  location: string
  material: string
  systemQty: string
  countedQty: string
  variance: string
  partCheck: 'all' | 'match' | 'variance' | 'empty' | 'unverified'
  status: string
  counter: string
  countDate: string
  assignedTo: string
  deferredByUserIds: string[]
  includeClearedDefers: boolean
}

const INITIAL_MANUAL_COUNTS_COLUMN_FILTERS: ManualCountsColumnFilters = {
  countNumber: '',
  countType: '',
  priority: 'all',
  location: '',
  material: '',
  systemQty: '',
  countedQty: '',
  variance: '',
  partCheck: 'all',
  status: 'all',
  counter: '',
  countDate: '',
  assignedTo: '',
  deferredByUserIds: [],
  includeClearedDefers: true,
}

const MANUAL_COUNTS_STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending (incl. in progress)' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed (incl. approved / variance review)' },
  { value: 'variance_review', label: 'Variance review' },
  { value: 'approved', label: 'Approved' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'recount', label: 'Recount required' },
] as const

// Status values grouped under each card pill. The Count Status card pills
// (Pending / Completed) match every status in their respective group so
// the card totals are self-consistent (Total = Pending + Completed). The
// dropdown still exposes the granular statuses for narrower filtering.
const PENDING_GROUP_STATUSES = new Set<string>(['pending', 'in_progress'])
const COMPLETED_GROUP_STATUSES = new Set<string>([
  'completed',
  'approved',
  'variance_review',
])

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'pending':
      return 'bg-amber-500/15 text-amber-700 border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
    case 'in_progress':
      return 'bg-blue-500/15 text-blue-700 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20'
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
    case 'variance_review':
      return 'bg-orange-500/15 text-orange-700 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20'
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
    case 'cancelled':
      return 'bg-red-500/15 text-red-700 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'
    case 'recount':
      return 'bg-violet-500/15 text-violet-700 border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

// Count types are now sourced from `useCountTypeOptions()` — the dynamic list
// of workflow configs, unioned with BUILT_IN_COUNT_TYPE_OPTIONS. This keeps
// custom workflows created in Count Settings visible everywhere.

/**
 * Part Check badge — reads the fields populated by the
 * `part_number_verification` workflow step:
 *   - `scanned_material_number` : primary scanned value (generated column
 *                                  `part_variance` derives from this)
 *   - `scanned_parts`            : full list of parts found at the location
 *                                  (migration 220; can be multi-part)
 *   - `location_reported_empty`  : operator said no barcode was present
 *
 * Display rules:
 *   Match    → green "Match"
 *   Variance → red "Part Variance" + just the found part number. If more
 *              than one distinct wrong part was captured, shows "<first>
 *              +N more".
 *   Empty    → amber "Location Empty"
 *   Unverified → neutral dash
 */
const PartCheckBadge = ({
  item,
}: {
  item: {
    scanned_material_number?: string | null
    part_variance?: boolean | null
    location_reported_empty?: boolean | null
    scanned_parts?: unknown
  }
}) => {
  const empty = !!item.location_reported_empty
  const variance = item.part_variance === true
  const scannedParts = Array.isArray(item.scanned_parts)
    ? (item.scanned_parts as Array<{ part_number?: string }>)
    : []
  const distinctParts = Array.from(
    new Set(
      scannedParts
        .map((p) => (typeof p.part_number === 'string' ? p.part_number : ''))
        .filter(Boolean)
    )
  ) as string[]
  const primaryFound =
    (typeof item.scanned_material_number === 'string' &&
      item.scanned_material_number.trim()) ||
    distinctParts[0] ||
    ''
  const extraCount = Math.max(0, distinctParts.length - 1)

  if (variance) {
    return (
      <div className='flex flex-col gap-0.5'>
        <span className='inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400'>
          <AlertTriangle className='h-3 w-3' />
          Part Variance
        </span>
        <span className='text-muted-foreground font-mono text-[10px]'>
          {primaryFound || 'unknown'}
          {extraCount > 0 ? ` +${extraCount} more` : ''}
        </span>
      </div>
    )
  }
  if (primaryFound) {
    return (
      <span className='inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400'>
        <CheckCircle className='h-3 w-3' />
        Match
      </span>
    )
  }
  if (empty) {
    return (
      <span className='inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400'>
        <Archive className='h-3 w-3' />
        Location Empty
      </span>
    )
  }
  return (
    <span className='text-muted-foreground/40 text-[11px]'>— not verified</span>
  )
}

/**
 * Display label for a defer-history user (full name → username → email →
 * "Unknown user"). Centralised so the popover, modal, and filter strip
 * all render the same value.
 */
const formatDeferUserLabel = (
  entry: Pick<
    DeferHistoryEntry,
    'user_full_name' | 'user_username' | 'user_email'
  > & {
    user_id?: string | null
  }
): string => {
  return (
    (entry.user_full_name && entry.user_full_name.trim()) ||
    (entry.user_username && entry.user_username.trim()) ||
    (entry.user_email && entry.user_email.trim()) ||
    'Unknown user'
  )
}

const formatDeferTimestamp = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  return formatDateEST(iso)
}

/**
 * Wraps the existing "Skipped" pill in a Popover that lazily fetches the
 * count's full defer history. Shows the most recent 3 defers inline and a
 * "View all" affordance that opens the parent's `EditCountModal` (so the
 * Skip / Defer History section receives the same data).
 *
 * The fetch is gated on `popoverOpen` so closed badges add zero network
 * cost — defer history is strictly lazy.
 */
interface SkippedBadgePopoverProps {
  countId: string
  countNumber?: string | null
  variant?: 'pill' | 'subtle'
  onViewAll?: () => void
}

const SkippedBadgePopover: React.FC<SkippedBadgePopoverProps> = ({
  countId,
  countNumber,
  variant = 'pill',
  onViewAll,
}) => {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useDeferHistoryForCount(countId, open)

  const recent = (data ?? []).slice(0, 3)
  const totalCount = data?.length ?? 0
  const activeCount = (data ?? []).filter((d) => d.is_active).length

  const triggerClass =
    variant === 'pill'
      ? 'text-muted-foreground bg-muted/50 hover:bg-muted/80 rounded px-1 py-0.5 text-[9px] font-medium cursor-pointer transition-colors'
      : 'text-muted-foreground/80 hover:text-foreground pl-6 text-[10px] cursor-pointer transition-colors'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label='View skip / defer history'
          className={triggerClass}
          onClick={(e) => e.stopPropagation()}
        >
          Skipped
        </button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        sideOffset={6}
        className='w-80 p-0 text-xs'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
          <div className='flex flex-col'>
            <span className='text-muted-foreground text-[10px] font-semibold tracking-wider uppercase'>
              Skip / Defer history
            </span>
            {countNumber && (
              <span className='text-muted-foreground/80 font-mono text-[10px]'>
                {countNumber}
              </span>
            )}
          </div>
          <div className='flex flex-col items-end gap-0.5 text-[10px]'>
            <Badge variant='secondary' className='text-[10px]'>
              {totalCount} total
            </Badge>
            {activeCount > 0 && (
              <span className='text-amber-700 dark:text-amber-400'>
                {activeCount} active
              </span>
            )}
          </div>
        </div>
        <div className='max-h-[260px] overflow-auto px-3 py-2'>
          {isLoading ? (
            <div className='flex items-center justify-center py-3'>
              <Loader2 className='text-muted-foreground h-3.5 w-3.5 animate-spin' />
            </div>
          ) : recent.length === 0 ? (
            <p className='text-muted-foreground py-2 text-[11px]'>
              No defer history found.
            </p>
          ) : (
            <ul className='space-y-2'>
              {recent.map((entry) => (
                <li
                  key={entry.id}
                  className='border-border/50 border-b pb-2 last:border-0 last:pb-0'
                >
                  <div className='flex items-baseline justify-between gap-2'>
                    <span className='font-medium'>
                      {formatDeferUserLabel(entry)}
                    </span>
                    <span className='text-muted-foreground text-[10px] tabular-nums'>
                      {formatDeferTimestamp(entry.deferred_at)}
                    </span>
                  </div>
                  <div className='mt-0.5 flex items-center gap-1.5 text-[10px]'>
                    <Badge
                      variant='outline'
                      className={cn(
                        'px-1 py-0 text-[9px]',
                        entry.is_active
                          ? 'border-amber-500/40 text-amber-700 dark:text-amber-400'
                          : 'text-muted-foreground'
                      )}
                    >
                      {entry.is_active ? 'Active' : 'Cleared'}
                    </Badge>
                    {entry.defer_reason && (
                      <span className='text-muted-foreground/90 line-clamp-2'>
                        {entry.defer_reason}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {onViewAll && (data?.length ?? 0) > recent.length && (
          <div className='border-t px-3 py-1.5'>
            <button
              type='button'
              onClick={() => {
                setOpen(false)
                onViewAll()
              }}
              className='text-primary hover:text-primary/80 text-[11px] font-medium'
            >
              View all {data?.length} →
            </button>
          </div>
        )}
        {onViewAll &&
          (data?.length ?? 0) <= recent.length &&
          totalCount > 0 && (
            <div className='border-t px-3 py-1.5'>
              <button
                type='button'
                onClick={() => {
                  setOpen(false)
                  onViewAll()
                }}
                className='text-primary hover:text-primary/80 text-[11px] font-medium'
              >
                Open count details →
              </button>
            </div>
          )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Skip / Defer History block rendered inside `EditCountModal`. Lazily
 * fetches the full per-count history from `v_cycle_count_defer_history`
 * the first time the modal mounts for a given count.
 */
interface DeferHistorySectionProps {
  countId: string
}

const DeferHistorySection: React.FC<DeferHistorySectionProps> = ({
  countId,
}) => {
  const { data, isLoading, error } = useDeferHistoryForCount(countId, true)
  const entries = data ?? []
  const activeCount = entries.filter((e) => e.is_active).length

  if (!isLoading && entries.length === 0) return null

  return (
    <div className='bg-muted/20 rounded-xl border'>
      <div className='flex items-center justify-between border-b px-4 py-3'>
        <div className='flex items-center gap-1.5'>
          <RotateCcw className='text-muted-foreground h-3.5 w-3.5' />
          <span className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
            Skip / Defer History
          </span>
          <Badge variant='secondary' className='ml-1 text-[10px]'>
            {entries.length}
          </Badge>
          {activeCount > 0 && (
            <Badge
              variant='outline'
              className='ml-1 border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400'
            >
              {activeCount} active
            </Badge>
          )}
        </div>
      </div>
      <div className='px-4 py-3'>
        {isLoading ? (
          <div className='flex items-center justify-center py-4'>
            <Loader2 className='text-muted-foreground h-4 w-4 animate-spin' />
          </div>
        ) : error ? (
          <p className='text-xs text-red-600 dark:text-red-400'>
            Failed to load defer history.
          </p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-xs'>
              <thead>
                <tr className='text-muted-foreground border-b text-left text-[10px] tracking-wider uppercase'>
                  <th className='py-1.5 pr-3 font-medium'>User</th>
                  <th className='py-1.5 pr-3 font-medium'>Deferred at</th>
                  <th className='py-1.5 pr-3 font-medium'>Reason</th>
                  <th className='py-1.5 pr-3 font-medium'>Cleared at</th>
                  <th className='py-1.5 font-medium'>State</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    className={cn(
                      'border-border/40 border-b last:border-0',
                      idx % 2 === 1 && 'bg-muted/10'
                    )}
                  >
                    <td className='py-1.5 pr-3 font-medium'>
                      {formatDeferUserLabel(entry)}
                    </td>
                    <td className='text-muted-foreground py-1.5 pr-3 tabular-nums'>
                      {formatDeferTimestamp(entry.deferred_at)}
                    </td>
                    <td className='text-muted-foreground/90 py-1.5 pr-3'>
                      {entry.defer_reason || (
                        <span className='text-muted-foreground/40'>—</span>
                      )}
                    </td>
                    <td className='text-muted-foreground py-1.5 pr-3 tabular-nums'>
                      {entry.cleared_at ? (
                        formatDeferTimestamp(entry.cleared_at)
                      ) : (
                        <span className='text-muted-foreground/40'>—</span>
                      )}
                    </td>
                    <td className='py-1.5'>
                      <Badge
                        variant='outline'
                        className={cn(
                          'px-1.5 py-0 text-[10px]',
                          entry.is_active
                            ? 'border-amber-500/40 text-amber-700 dark:text-amber-400'
                            : 'text-muted-foreground'
                        )}
                      >
                        {entry.is_active ? 'Active' : 'Cleared'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Multi-select dropdown for the dashboard "Deferred by" filter. Populates
 * from the org-wide distinct deferring-user list (`useDistinctDeferUsers`).
 * Includes a sub-toggle "Include cleared defers?" so supervisors can scope
 * to currently-active defers only when needed.
 */
interface DeferredByFilterProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  users: DistinctDeferUser[]
  isLoading: boolean
  selectedUserIds: string[]
  includeCleared: boolean
  onChange: (next: string[]) => void
  onIncludeClearedChange: (next: boolean) => void
}

const DeferredByFilter: React.FC<DeferredByFilterProps> = ({
  open,
  onOpenChange,
  users,
  isLoading,
  selectedUserIds,
  includeCleared,
  onChange,
  onIncludeClearedChange,
}) => {
  const selectedSet = new Set(selectedUserIds)
  const selectedLabel =
    selectedUserIds.length === 0
      ? 'Deferred by'
      : selectedUserIds.length === 1
        ? (users.find((u) => u.user_id === selectedUserIds[0])
            ?.user_full_name ?? 'Deferred by 1')
        : `Deferred by ${selectedUserIds.length}`

  const toggle = (userId: string) => {
    if (selectedSet.has(userId)) {
      onChange(selectedUserIds.filter((id) => id !== userId))
    } else {
      onChange([...selectedUserIds, userId])
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant={selectedUserIds.length > 0 ? 'secondary' : 'outline'}
          size='sm'
          className='border-border/50 h-8 shrink-0 rounded-lg px-2.5 text-xs'
          aria-label='Filter by deferring user'
        >
          <UserMinus className='mr-1.5 h-3.5 w-3.5' />
          {selectedLabel}
          {selectedUserIds.length > 0 && (
            <Badge variant='outline' className='ml-1.5 px-1 py-0 text-[10px]'>
              {selectedUserIds.length}
            </Badge>
          )}
          <ChevronDown className='ml-1 h-3.5 w-3.5 opacity-60' />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' sideOffset={6} className='w-72 p-0 text-xs'>
        <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
          <span className='text-muted-foreground text-[10px] font-semibold tracking-wider uppercase'>
            Deferred by
          </span>
          {selectedUserIds.length > 0 && (
            <button
              type='button'
              onClick={() => onChange([])}
              className='text-muted-foreground hover:text-foreground text-[11px] underline-offset-2 hover:underline'
            >
              Clear
            </button>
          )}
        </div>
        <div className='border-b px-3 py-2'>
          <label className='flex cursor-pointer items-center gap-2 text-[11px]'>
            <Checkbox
              checked={includeCleared}
              onCheckedChange={(v) => onIncludeClearedChange(v === true)}
              aria-label='Include cleared defers'
            />
            <span className='text-muted-foreground'>
              Include cleared defers
            </span>
          </label>
        </div>
        <div className='max-h-[260px] overflow-auto py-1'>
          {isLoading ? (
            <div className='flex items-center justify-center py-3'>
              <Loader2 className='text-muted-foreground h-3.5 w-3.5 animate-spin' />
            </div>
          ) : users.length === 0 ? (
            <p className='text-muted-foreground px-3 py-2 text-[11px]'>
              No defer history yet.
            </p>
          ) : (
            users.map((u) => {
              const checked = selectedSet.has(u.user_id)
              return (
                <button
                  key={u.user_id}
                  type='button'
                  onClick={() => toggle(u.user_id)}
                  className={cn(
                    'hover:bg-muted/40 flex w-full items-center gap-2 px-3 py-1.5 text-left',
                    checked && 'bg-muted/30'
                  )}
                >
                  <Checkbox
                    checked={checked}
                    aria-label={`Toggle ${u.user_full_name ?? u.user_id}`}
                    className='pointer-events-none'
                  />
                  <span className='flex-1 truncate text-[11px] font-medium'>
                    {u.user_full_name || u.user_email || 'Unknown user'}
                  </span>
                  {u.user_email && u.user_full_name && (
                    <span className='text-muted-foreground/70 truncate text-[10px]'>
                      {u.user_email}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Legacy Add Count Modal Component (deprecated - replaced by LX03 modal)
// Kept for potential fallback or manual entry scenarios
interface AddCountModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (countData: Partial<CycleCountData>) => Promise<void>
}

// @ts-expect-error - Legacy component kept for reference, not currently used
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const AddCountModal: React.FC<AddCountModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [formData, setFormData] = useState<
    Partial<CycleCountData> & { priority?: CycleCountPriority }
  >({
    material_number: '',
    material_description: '',
    location: '',
    warehouse: '',
    system_quantity: 0,
    counted_quantity: undefined,
    unit_of_measure: 'EA',
    count_type: 'quantity_check',
    priority: 'normal',
    counter_name: '',
    count_reason: '',
    batch_number: '',
    notes: '',
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isValidatingLocation, setIsValidatingLocation] = useState(false)
  const [isValidatingMaterial, setIsValidatingMaterial] = useState(false)
  const [locationValidation, setLocationValidation] = useState<{
    isValid: boolean
    message?: string
  } | null>(null)
  const [materialValidation, setMaterialValidation] = useState<{
    isValid: boolean
    message?: string
    description?: string
  } | null>(null)

  // Calculate variance in real-time
  const varianceCalculation = useMemo(() => {
    if (formData.system_quantity != null && formData.counted_quantity != null) {
      const variance = formData.counted_quantity - formData.system_quantity
      let variancePercentage: number | null = null
      let requiresReview = false

      if (formData.system_quantity > 0) {
        variancePercentage =
          (Math.abs(variance) / formData.system_quantity) * 100
        requiresReview = variancePercentage > 10 || Math.abs(variance) > 10
      } else if (
        formData.system_quantity === 0 &&
        formData.counted_quantity !== 0
      ) {
        variancePercentage = null // Infinity case
        requiresReview = true
      }

      return { variance, variancePercentage, requiresReview }
    }
    return null
  }, [formData.system_quantity, formData.counted_quantity])

  // Validate location when it changes
  useEffect(() => {
    const validateLocation = async () => {
      if (!formData.location || formData.location.trim().length < 2) {
        setLocationValidation(null)
        return
      }

      setIsValidatingLocation(true)
      const result = await locationValidationService.validateLocationExists(
        formData.location
      )
      setLocationValidation({
        isValid: result.isValid,
        message: result.message,
      })
      setIsValidatingLocation(false)
    }

    const timer = setTimeout(validateLocation, 500) // Debounce
    return () => clearTimeout(timer)
  }, [formData.location])

  // Validate material when it changes
  useEffect(() => {
    const validateMaterial = async () => {
      if (
        !formData.material_number ||
        formData.material_number.trim().length < 2
      ) {
        setMaterialValidation(null)
        return
      }

      setIsValidatingMaterial(true)
      const result = await materialValidationService.validateMaterialExists(
        formData.material_number
      )
      setMaterialValidation({
        isValid: result.isValid,
        message: result.message,
        description: result.description,
      })

      // Auto-fill material description if found (uses functional update to avoid stale closure)
      if (result.description) {
        setFormData((prev) =>
          prev.material_description
            ? prev
            : { ...prev, material_description: result.description! }
        )
      }

      setIsValidatingMaterial(false)
    }

    const timer = setTimeout(validateMaterial, 500) // Debounce
    return () => clearTimeout(timer)
  }, [formData.material_number])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate required fields
    if (
      !formData.material_number ||
      !formData.location ||
      formData.system_quantity == null
    ) {
      toast.error('Please fill in all required fields')
      return
    }

    // Validate location exists
    if (locationValidation && !locationValidation.isValid) {
      toast.error(
        'Invalid location. Please verify the location exists in the warehouse system.'
      )
      return
    }

    // Warn if material doesn't exist (but allow submission)
    if (materialValidation && !materialValidation.isValid) {
      toast.warning(
        'Material not found in system. Count will be created but may need verification.'
      )
    }

    // Validate counted quantity if provided
    if (formData.counted_quantity != null && formData.counted_quantity < 0) {
      toast.error('Counted quantity cannot be negative')
      return
    }

    try {
      setIsSubmitting(true)
      await onSubmit(formData)

      // Reset form
      setFormData({
        material_number: '',
        material_description: '',
        location: '',
        warehouse: '',
        system_quantity: 0,
        counted_quantity: undefined,
        unit_of_measure: 'EA',
        count_type: 'cycle_count',
        priority: 'normal',
        counter_name: '',
        count_reason: '',
        batch_number: '',
        notes: '',
      })
      setLocationValidation(null)
      setMaterialValidation(null)
      onClose()
    } catch (error) {
      logger.error('Error submitting count:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Plus className='h-5 w-5' />
            Add New Count
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            {/* Material Number - Required */}
            <div>
              <Label htmlFor='material_number'>Material Number *</Label>
              <div className='relative'>
                <Input
                  id='material_number'
                  value={formData.material_number || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      material_number: e.target.value,
                    })
                  }
                  placeholder='Enter material number'
                  required
                  className={cn(
                    materialValidation !== null &&
                      (materialValidation.isValid
                        ? 'border-green-500'
                        : 'border-orange-500')
                  )}
                />
                {isValidatingMaterial && (
                  <Loader2 className='text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin' />
                )}
                {!isValidatingMaterial &&
                  materialValidation &&
                  (materialValidation.isValid ? (
                    <Check className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-green-500' />
                  ) : (
                    <AlertTriangle className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-orange-500' />
                  ))}
              </div>
              {materialValidation && (
                <p
                  className={cn(
                    'mt-1 text-xs',
                    materialValidation.isValid
                      ? 'text-green-600'
                      : 'text-orange-600'
                  )}
                >
                  {materialValidation.message}
                </p>
              )}
            </div>

            {/* Location - Required */}
            <div>
              <Label htmlFor='location'>Location *</Label>
              <div className='relative'>
                <Input
                  id='location'
                  value={formData.location || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, location: e.target.value })
                  }
                  placeholder='Enter location'
                  required
                  className={cn(
                    locationValidation !== null &&
                      (locationValidation.isValid
                        ? 'border-green-500'
                        : 'border-red-500')
                  )}
                />
                {isValidatingLocation && (
                  <Loader2 className='text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin' />
                )}
                {!isValidatingLocation &&
                  locationValidation &&
                  (locationValidation.isValid ? (
                    <Check className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-green-500' />
                  ) : (
                    <AlertTriangle className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-red-500' />
                  ))}
              </div>
              {locationValidation && (
                <p
                  className={cn(
                    'mt-1 text-xs',
                    locationValidation.isValid
                      ? 'text-green-600'
                      : 'text-red-600'
                  )}
                >
                  {locationValidation.message}
                </p>
              )}
            </div>

            {/* Material Description */}
            <div className='md:col-span-2'>
              <Label htmlFor='material_description'>Material Description</Label>
              <Input
                id='material_description'
                value={formData.material_description || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    material_description: e.target.value,
                  })
                }
                placeholder='Enter material description'
              />
            </div>

            {/* System Quantity - Required */}
            <div>
              <Label htmlFor='system_quantity'>System Quantity *</Label>
              <Input
                id='system_quantity'
                type='number'
                step='0.001'
                value={formData.system_quantity || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    system_quantity: parseFloat(e.target.value) || 0,
                  })
                }
                placeholder='0.000'
                required
              />
            </div>

            {/* Counted Quantity */}
            <div>
              <Label htmlFor='counted_quantity'>Counted Quantity</Label>
              <Input
                id='counted_quantity'
                type='number'
                step='0.001'
                value={formData.counted_quantity || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    counted_quantity: e.target.value
                      ? parseFloat(e.target.value)
                      : undefined,
                  })
                }
                placeholder='Enter counted quantity'
              />
            </div>

            {/* Variance Preview Card */}
            {varianceCalculation && (
              <div className='md:col-span-2'>
                <Card
                  className={cn(
                    'border-2',
                    varianceCalculation.requiresReview
                      ? 'border-orange-300 bg-orange-50 dark:bg-orange-950/20'
                      : 'border-green-300 bg-green-50 dark:bg-green-950/20'
                  )}
                >
                  <CardHeader className='pb-2'>
                    <CardTitle className='flex items-center gap-2 text-sm'>
                      {varianceCalculation.requiresReview ? (
                        <>
                          <AlertTriangle className='h-4 w-4 text-orange-600' />
                          <span className='text-orange-800 dark:text-orange-200'>
                            Variance Detected - Review Required
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className='h-4 w-4 text-green-600' />
                          <span className='text-green-800 dark:text-green-200'>
                            Variance Within Acceptable Range
                          </span>
                        </>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-2'>
                    <div className='grid grid-cols-3 gap-3 text-sm'>
                      <div>
                        <p className='text-muted-foreground text-xs'>
                          Variance
                        </p>
                        <p
                          className={cn(
                            'font-semibold',
                            varianceCalculation.variance > 0
                              ? 'text-orange-600'
                              : varianceCalculation.variance < 0
                                ? 'text-red-600'
                                : 'text-gray-600'
                          )}
                        >
                          {varianceCalculation.variance > 0 ? '+' : ''}
                          {varianceCalculation.variance}{' '}
                          {formData.unit_of_measure || 'EA'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground text-xs'>
                          Percentage
                        </p>
                        <p className='font-semibold text-orange-600'>
                          {varianceCalculation.variancePercentage === null
                            ? 'N/A (Zero base)'
                            : `${varianceCalculation.variancePercentage.toFixed(2)}%`}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground text-xs'>Status</p>
                        <Badge
                          variant={
                            varianceCalculation.requiresReview
                              ? 'destructive'
                              : 'default'
                          }
                          className='text-xs'
                        >
                          {varianceCalculation.requiresReview
                            ? 'Requires Recount'
                            : 'Acceptable'}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Priority Selection */}
            <div>
              <Label htmlFor='priority'>Priority Level</Label>
              <Select
                value={formData.priority || 'normal'}
                onValueChange={(value: CycleCountPriority) =>
                  setFormData({ ...formData, priority: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select priority level' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='critical'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-red-500'></div>
                      Critical
                    </div>
                  </SelectItem>
                  <SelectItem value='hot'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-orange-500'></div>
                      Hot
                    </div>
                  </SelectItem>
                  <SelectItem value='normal'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-blue-500'></div>
                      Normal
                    </div>
                  </SelectItem>
                  <SelectItem value='low'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-gray-500'></div>
                      Low
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Unit of Measure */}
            <div>
              <Label htmlFor='unit_of_measure'>Unit of Measure</Label>
              <Input
                id='unit_of_measure'
                value={formData.unit_of_measure || 'EA'}
                onChange={(e) =>
                  setFormData({ ...formData, unit_of_measure: e.target.value })
                }
                placeholder='EA'
              />
            </div>

            {/* Count Type Selection */}
            <div className='md:col-span-2'>
              <Label htmlFor='count_type'>Count Type *</Label>
              <Select
                value={formData.count_type || 'quantity_check'}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    count_type: value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select count type' />
                </SelectTrigger>
                <SelectContent>
                  {BUILT_IN_COUNT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-muted-foreground mt-1 text-xs'>
                Select the type of count to determine the appropriate workflow
              </p>
            </div>
          </div>

          <div className='flex justify-end gap-2 pt-4'>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className='mr-2 h-4 w-4' />
                  Add Count
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Edit Count Modal Component - Enhanced with Tabs and Better Organization
/**
 * Compact stat tile used in the redesigned `EditCountModal` header row.
 * Four variants keep the visual language consistent with the dashboard
 * badges: neutral (muted), info (blue), success (emerald), warning
 * (amber), danger (red).
 */
const StatTile = ({
  label,
  icon,
  variant = 'neutral',
  children,
}: {
  label: string
  icon?: React.ReactNode
  variant?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  children: React.ReactNode
}) => {
  const variantClass = {
    neutral: 'border-muted bg-muted/30',
    info: 'border-blue-500/30 bg-blue-500/5',
    success: 'border-emerald-500/30 bg-emerald-500/5',
    warning: 'border-amber-500/30 bg-amber-500/5',
    danger: 'border-red-500/30 bg-red-500/5',
  }[variant]
  return (
    <div className={cn('min-w-0 rounded-xl border p-3', variantClass)}>
      <div className='text-muted-foreground mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase'>
        {icon}
        {label}
      </div>
      <div className='text-sm'>{children}</div>
    </div>
  )
}

/**
 * Row in the "Scanned Parts" panel of the view-count dialog. Shows the
 * captured part number, quantity, capture method, and whether it matches
 * the expected material (green chip vs red chip).
 */
const ScannedPartRow = ({
  partNumber,
  quantity,
  method,
  expected,
  capturedAt,
}: {
  partNumber: string
  quantity?: number | null
  method: 'scan' | 'manual'
  expected: boolean
  capturedAt?: string
}) => (
  <div
    className={cn(
      'flex items-center justify-between gap-2 rounded-md border p-2 text-xs',
      expected
        ? 'border-emerald-500/30 bg-emerald-500/10'
        : 'border-red-500/30 bg-red-500/10'
    )}
  >
    <div className='min-w-0 flex-1'>
      <p className='flex items-center gap-1.5 font-mono font-semibold break-all'>
        {expected ? (
          <CheckCircle className='h-3 w-3 shrink-0 text-emerald-600' />
        ) : (
          <AlertTriangle className='h-3 w-3 shrink-0 text-red-600' />
        )}
        {partNumber}
      </p>
      <p className='text-muted-foreground mt-0.5 text-[10px]'>
        Qty {quantity ?? '—'} · {method}
        {capturedAt ? ` · ${formatTimestampEST(capturedAt)}` : ''}
      </p>
    </div>
  </div>
)

interface EditCountModalProps {
  isOpen: boolean
  onClose: () => void
  countData: CycleCountDataWithUser | null
  onInitiateRecount: (countId: string, reason?: string) => Promise<void>
  onApprove: (countId: string, countNumber: string) => Promise<void>
}

const EditCountModal: React.FC<EditCountModalProps> = ({
  isOpen,
  onClose,
  countData,
  onInitiateRecount,
  onApprove,
}) => {
  const { options: countTypeOptions } = useCountTypeOptions()
  const [recountReason, setRecountReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [assignmentHistory, setAssignmentHistory] = useState<
    AssignmentHistoryRecord[]
  >([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Reset state when modal opens + fetch assignment history
  React.useEffect(() => {
    if (isOpen && countData) {
      setRecountReason('')
      setAssignmentHistory([])

      if ((countData as any).reassignment_count > 0) {
        setHistoryLoading(true)
        const service = CycleCountService.getInstance()
        service
          .fetchAssignmentHistory(countData.id)
          .then(({ data }) => setAssignmentHistory(data))
          .finally(() => setHistoryLoading(false))
      }
    }
  }, [isOpen, countData])

  // Clean up body pointer-events when dialog closes
  React.useEffect(() => {
    if (!isOpen) {
      document.body.style.pointerEvents = ''
    }
  }, [isOpen])

  // Handle close with explicit state check
  const handleClose = React.useCallback(
    (open: boolean) => {
      if (!open) {
        onClose()
        setTimeout(() => {
          document.body.style.pointerEvents = ''
        }, 0)
      }
    },
    [onClose]
  )

  const handleInitiateRecount = async () => {
    if (!countData) return

    try {
      setIsSubmitting(true)
      await onInitiateRecount(countData.id, recountReason || undefined)
      setRecountReason('')
      onClose()
    } catch (error) {
      logger.error('Error initiating recount:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const [historyExpanded, setHistoryExpanded] = React.useState(false)
  // Auto-expand history only on the first reassignment so the timeline is
  // discoverable; for heavier rows the operator opens it on demand.
  React.useEffect(() => {
    if (!countData) return
    setHistoryExpanded(((countData as any).reassignment_count ?? 0) === 1)
  }, [countData])

  if (!countData) return null

  // Derived data surfaced in the redesigned layout.
  const scannedParts = Array.isArray(countData.scanned_parts)
    ? (countData.scanned_parts as Array<{
        part_number?: string
        quantity?: number
        method?: string
        captured_at?: string
      }>)
    : []
  const evidencePhotos = Array.isArray(countData.evidence_photo_urls)
    ? (countData.evidence_photo_urls as string[])
    : []
  const hasQtyVariance =
    countData.counted_quantity != null && countData.variance_quantity != null
  const locationEmpty = !!countData.location_reported_empty
  const hasPartVerification =
    !!countData.scanned_material_number ||
    scannedParts.length > 0 ||
    locationEmpty

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleClose} size='xl'>
      <ResponsiveDialogHeader className='sr-only'>
        <ResponsiveDialogTitle>Cycle Count Details</ResponsiveDialogTitle>
      </ResponsiveDialogHeader>

      {countData && (
        <>
          {/* ==== HERO HEADER ==== */}
          {/* pr-12 reserves space for the Dialog's absolute close (X) button
                which sits at top-4 right-4 on DialogContent. */}
          <div className='from-primary/10 via-background to-muted/40 border-b bg-linear-to-br p-5 pr-12'>
            <div className='flex items-start justify-between gap-4'>
              <div className='flex min-w-0 items-start gap-3'>
                <div className='from-primary/20 to-primary/5 rounded-xl bg-linear-to-br p-3'>
                  <Package className='text-primary h-6 w-6' />
                </div>
                <div className='min-w-0 flex-1'>
                  <h2 className='flex items-center gap-2 font-mono text-2xl leading-none font-bold'>
                    {countData.count_number}
                  </h2>
                  <p className='text-muted-foreground mt-1.5 text-sm'>
                    <span className='text-foreground font-mono font-semibold'>
                      {countData.material_number}
                    </span>
                    {countData.material_description && (
                      <span className='ml-1'>
                        · {countData.material_description}
                      </span>
                    )}
                  </p>
                  <div className='mt-2 flex flex-wrap items-center gap-1.5'>
                    <span className='bg-background/60 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium'>
                      <MapPin className='h-3 w-3' />
                      {countData.location}
                    </span>
                    <span className='bg-background/60 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium'>
                      {resolveCountTypeLabel(
                        countData.count_type,
                        countTypeOptions
                      ) ||
                        countData.count_type ||
                        'Quantity Check'}
                    </span>
                    <span className='bg-background/60 text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]'>
                      WH: {countData.warehouse || 'N/A'}
                    </span>
                    {countData.batch_number && (
                      <span className='bg-background/60 text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]'>
                        Batch: {countData.batch_number}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className='flex shrink-0 flex-col items-end gap-1.5'>
                <Badge
                  className={CycleCountService.getPriorityColor(
                    countData.priority || 'normal'
                  )}
                >
                  <span
                    className={cn(
                      'mr-1 inline-block h-1.5 w-1.5 rounded-full',
                      countData.priority === 'critical' &&
                        'animate-pulse bg-red-500',
                      countData.priority === 'hot' && 'bg-orange-500',
                      countData.priority === 'normal' && 'bg-blue-500',
                      countData.priority === 'low' && 'bg-gray-400',
                      !countData.priority && 'bg-blue-500'
                    )}
                  />
                  {CycleCountService.getPriorityLabel(
                    countData.priority || 'normal'
                  )}
                </Badge>
                <span className='text-muted-foreground font-mono text-[10px]'>
                  ID {countData.id.slice(0, 8)}
                </span>
              </div>
            </div>
          </div>

          {/* ==== SCROLLABLE BODY ==== */}
          <div className='flex-1 space-y-4 overflow-y-auto p-5'>
            {/* === Hero stat tiles === */}
            <div
              className={cn(
                'grid gap-3',
                hasPartVerification && hasQtyVariance
                  ? 'grid-cols-2 md:grid-cols-4'
                  : hasPartVerification || hasQtyVariance
                    ? 'grid-cols-3'
                    : 'grid-cols-3'
              )}
            >
              {/* Status tile */}
              <StatTile
                label='Status'
                variant={
                  countData.status === 'variance_review'
                    ? 'warning'
                    : countData.status === 'completed' ||
                        countData.status === 'approved'
                      ? 'success'
                      : 'neutral'
                }
                icon={
                  countData.status === 'completed' ||
                  countData.status === 'approved' ? (
                    <CheckCircle className='h-3.5 w-3.5' />
                  ) : countData.status === 'variance_review' ? (
                    <AlertTriangle className='h-3.5 w-3.5' />
                  ) : (
                    <Clock className='h-3.5 w-3.5' />
                  )
                }
              >
                <p className='font-semibold capitalize'>
                  {countData.status?.replace(/_/g, ' ') || '—'}
                </p>
                {countData.count_date ? (
                  <p className='text-muted-foreground mt-0.5 text-[10px]'>
                    {formatDateEST(countData.count_date)}
                    {countData.counter_name && ` · ${countData.counter_name}`}
                  </p>
                ) : (
                  <p className='text-muted-foreground mt-0.5 text-[10px]'>
                    Not yet counted
                  </p>
                )}
              </StatTile>

              {/* Part Check tile — only when part_verification was run */}
              {hasPartVerification && (
                <StatTile
                  label='Part Check'
                  variant={
                    countData.part_variance === true
                      ? 'danger'
                      : locationEmpty
                        ? 'warning'
                        : countData.scanned_material_number
                          ? 'success'
                          : 'neutral'
                  }
                  icon={
                    countData.part_variance === true ? (
                      <AlertTriangle className='h-3.5 w-3.5' />
                    ) : locationEmpty ? (
                      <Archive className='h-3.5 w-3.5' />
                    ) : countData.scanned_material_number ? (
                      <CheckCircle className='h-3.5 w-3.5' />
                    ) : (
                      <Search className='h-3.5 w-3.5' />
                    )
                  }
                >
                  {countData.part_variance === true ? (
                    <>
                      <p className='font-semibold'>Part Variance</p>
                      <p className='text-muted-foreground mt-0.5 font-mono text-[10px]'>
                        {countData.scanned_material_number}
                        {scannedParts.length > 1 &&
                          ` +${scannedParts.length - 1} more`}
                      </p>
                    </>
                  ) : locationEmpty ? (
                    <>
                      <p className='font-semibold'>Location Empty</p>
                      <p className='text-muted-foreground mt-0.5 text-[10px]'>
                        No barcode at location
                      </p>
                    </>
                  ) : countData.scanned_material_number ? (
                    <>
                      <p className='font-semibold'>Match</p>
                      <p className='text-muted-foreground mt-0.5 font-mono text-[10px]'>
                        {countData.scanned_material_number}
                      </p>
                    </>
                  ) : (
                    <p className='text-muted-foreground'>Not verified</p>
                  )}
                </StatTile>
              )}

              {/* Quantity Variance tile — only when we have a count */}
              {hasQtyVariance && (
                <StatTile
                  label='Qty Variance'
                  variant={
                    countData.requires_recount
                      ? 'danger'
                      : countData.variance_quantity === 0
                        ? 'success'
                        : 'warning'
                  }
                >
                  <div className='flex items-baseline gap-1.5'>
                    <span className='text-2xl font-bold tabular-nums'>
                      {countData.variance_quantity! > 0 ? '+' : ''}
                      {countData.variance_quantity}
                    </span>
                    <span className='text-muted-foreground text-[10px]'>
                      {countData.unit_of_measure || 'EA'}
                    </span>
                  </div>
                  <p className='text-muted-foreground mt-0.5 text-[10px]'>
                    {countData.system_quantity} expected ·{' '}
                    {countData.counted_quantity} counted
                    {countData.variance_percentage != null &&
                      ` · ${countData.variance_percentage.toFixed(1)}%`}
                  </p>
                </StatTile>
              )}

              {/* Assignment tile */}
              <StatTile
                label='Assigned'
                variant={countData.assigned_to_user ? 'info' : 'neutral'}
                icon={
                  countData.assigned_to_user ? (
                    <User className='h-3.5 w-3.5' />
                  ) : (
                    <UserMinus className='h-3.5 w-3.5' />
                  )
                }
              >
                {countData.assigned_to_user ? (
                  <>
                    <p className='truncate font-semibold'>
                      {countData.assigned_to_user.full_name}
                    </p>
                    <p className='text-muted-foreground mt-0.5 truncate text-[10px]'>
                      {countData.assigned_to_user.email}
                    </p>
                  </>
                ) : (
                  <>
                    <p className='text-muted-foreground'>Unassigned</p>
                    <p className='text-muted-foreground mt-0.5 text-[10px]'>
                      Available in the queue
                    </p>
                  </>
                )}
              </StatTile>
            </div>

            {/* === Three-column: Photo/Location | Details | Scanned Parts === */}
            <div className='grid gap-3 md:grid-cols-12'>
              {/* Photo / Location */}
              <div className='space-y-3 md:col-span-3'>
                <div className='bg-muted/20 relative overflow-hidden rounded-xl border'>
                  {evidencePhotos.length > 0 ? (
                    <a
                      href={evidencePhotos[0]}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='group block aspect-square'
                      title='Open full-size'
                    >
                      <img
                        src={evidencePhotos[0]}
                        alt={`${countData.count_number} evidence`}
                        className='h-full w-full object-cover transition-transform group-hover:scale-[1.02]'
                        loading='lazy'
                      />
                      {evidencePhotos.length > 1 && (
                        <span className='absolute top-2 right-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm'>
                          +{evidencePhotos.length - 1} more
                        </span>
                      )}
                    </a>
                  ) : (
                    <div className='bg-muted/30 flex aspect-square flex-col items-center justify-center p-4 text-center'>
                      <Camera className='text-muted-foreground/40 mb-2 h-12 w-12' />
                      <p className='text-muted-foreground text-xs'>
                        No photo available
                      </p>
                      <p className='text-muted-foreground/60 mt-0.5 text-[10px]'>
                        Evidence photos from the RF app appear here.
                      </p>
                    </div>
                  )}
                </div>
                <div className='bg-muted/20 rounded-xl border p-3 text-center'>
                  <p className='text-muted-foreground mb-1 flex items-center justify-center gap-1 text-[10px] font-semibold tracking-wider uppercase'>
                    <MapPin className='h-3 w-3' />
                    Location
                  </p>
                  <p className='font-mono text-base font-bold break-all'>
                    {countData.location}
                  </p>
                  {countData.resolved_zone && (
                    <p className='text-muted-foreground mt-0.5 text-[10px]'>
                      Zone {countData.resolved_zone}
                      {countData.resolved_aisle
                        ? ` · Aisle ${countData.resolved_aisle}`
                        : ''}
                    </p>
                  )}
                </div>
              </div>

              {/* Details */}
              <div className='bg-muted/20 rounded-xl border p-4 md:col-span-4'>
                <div className='mb-2.5 flex items-center gap-1.5'>
                  <FileText className='text-muted-foreground h-3.5 w-3.5' />
                  <span className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
                    Details
                  </span>
                </div>
                <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs'>
                  <dt className='text-muted-foreground'>Material</dt>
                  <dd className='font-mono font-medium'>
                    {countData.material_number}
                  </dd>
                  <dt className='text-muted-foreground'>UOM</dt>
                  <dd>{countData.unit_of_measure || 'EA'}</dd>
                  <dt className='text-muted-foreground'>System Qty</dt>
                  <dd className='tabular-nums'>
                    {countData.system_quantity}{' '}
                    {countData.unit_of_measure || 'EA'}
                  </dd>
                  <dt className='text-muted-foreground'>Counted Qty</dt>
                  <dd className='tabular-nums'>
                    {countData.counted_quantity != null ? (
                      <>
                        {countData.counted_quantity}{' '}
                        {countData.unit_of_measure || 'EA'}
                      </>
                    ) : (
                      <span className='text-muted-foreground italic'>
                        Not counted
                      </span>
                    )}
                  </dd>
                  <dt className='text-muted-foreground'>Created</dt>
                  <dd className='tabular-nums'>
                    {formatTimestampEST(countData.created_at)}
                  </dd>
                  <dt className='text-muted-foreground'>Updated</dt>
                  <dd className='tabular-nums'>
                    {formatTimestampEST(countData.updated_at)}
                  </dd>
                  {countData.counter_name && (
                    <>
                      <dt className='text-muted-foreground'>Counter</dt>
                      <dd>{countData.counter_name}</dd>
                    </>
                  )}
                </dl>
              </div>

              {/* Scanned Parts */}
              <div
                className={cn(
                  'rounded-xl border p-4 md:col-span-5',
                  countData.part_variance === true
                    ? 'border-red-500/30 bg-red-500/5'
                    : countData.scanned_material_number
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'bg-muted/20'
                )}
              >
                <div className='mb-2.5 flex items-center justify-between'>
                  <div className='flex items-center gap-1.5'>
                    <Scan className='text-muted-foreground h-3.5 w-3.5' />
                    <span className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
                      Scanned Parts
                    </span>
                  </div>
                  {scannedParts.length > 0 && (
                    <span className='text-muted-foreground text-[10px]'>
                      {scannedParts.length}{' '}
                      {scannedParts.length === 1 ? 'entry' : 'entries'}
                    </span>
                  )}
                </div>

                {scannedParts.length === 0 &&
                !countData.scanned_material_number &&
                !locationEmpty ? (
                  <div className='text-muted-foreground flex h-24 items-center justify-center text-xs'>
                    Part verification has not run for this count.
                  </div>
                ) : locationEmpty && scannedParts.length === 0 ? (
                  <div className='flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm'>
                    <Archive className='h-4 w-4 text-amber-600' />
                    <span className='font-medium text-amber-700 dark:text-amber-400'>
                      Location reported empty
                    </span>
                  </div>
                ) : (
                  <div className='max-h-[180px] space-y-1.5 overflow-y-auto pr-1'>
                    {/* Fall back to the primary scan field when scanned_parts is empty */}
                    {scannedParts.length === 0 &&
                      countData.scanned_material_number && (
                        <ScannedPartRow
                          partNumber={countData.scanned_material_number}
                          quantity={countData.counted_quantity ?? undefined}
                          method='scan'
                          expected={
                            countData.scanned_material_number ===
                            countData.material_number
                          }
                        />
                      )}
                    {scannedParts.map((p, i) => (
                      <ScannedPartRow
                        key={`${p.part_number}-${i}`}
                        partNumber={p.part_number ?? 'unknown'}
                        quantity={p.quantity}
                        method={p.method === 'manual' ? 'manual' : 'scan'}
                        expected={
                          (p.part_number ?? '').toUpperCase() ===
                          (countData.material_number ?? '').toUpperCase()
                        }
                        capturedAt={p.captured_at}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* === Found Part Transfer summary ===
                  `location` is the SOURCE (A) the operator picks from;
                  `transfer_destination_location` is the DESTINATION (B)
                  where they deliver; `counted_quantity` is the final
                  consolidated count at B. */}
            {countData.transfer_destination_location && (
              <div className='rounded-xl border border-sky-500/30 bg-sky-500/5 p-4'>
                <div className='mb-2.5 flex items-center gap-1.5'>
                  <MapPin className='h-3.5 w-3.5 text-sky-600 dark:text-sky-400' />
                  <span className='text-[11px] font-semibold tracking-wider text-sky-700 uppercase dark:text-sky-300'>
                    Found Part Transfer
                  </span>
                </div>
                <div className='grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm'>
                  <div className='bg-muted/40 min-w-0 rounded-md border border-dashed p-2 text-center'>
                    <p className='text-muted-foreground text-[10px] font-semibold tracking-wider uppercase'>
                      Pick From (source)
                    </p>
                    <p className='font-mono text-sm font-semibold break-all'>
                      {countData.location}
                    </p>
                    {countData.transfer_source_quantity != null && (
                      <p className='text-muted-foreground mt-0.5 text-[10px]'>
                        Picked{' '}
                        <span className='font-semibold'>
                          {countData.transfer_source_quantity}
                        </span>{' '}
                        {countData.unit_of_measure || 'EA'}
                      </p>
                    )}
                  </div>
                  <ArrowRight className='text-muted-foreground h-4 w-4 shrink-0' />
                  <div className='min-w-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-center'>
                    <p className='text-[10px] font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-300'>
                      Deliver To (destination)
                    </p>
                    <p className='font-mono text-sm font-semibold break-all'>
                      {countData.transfer_destination_location}
                    </p>
                    {countData.counted_quantity != null && (
                      <p className='text-muted-foreground mt-0.5 text-[10px]'>
                        Final{' '}
                        <span className='font-semibold'>
                          {countData.counted_quantity}
                        </span>{' '}
                        {countData.unit_of_measure || 'EA'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* === Notes === */}
            {countData.notes && (
              <div className='bg-muted/20 rounded-xl border p-4'>
                <div className='mb-1.5 flex items-center gap-1.5'>
                  <FileText className='text-muted-foreground h-3.5 w-3.5' />
                  <span className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
                    Notes
                  </span>
                </div>
                <p className='text-sm whitespace-pre-wrap'>{countData.notes}</p>
              </div>
            )}

            {/* === Additional Evidence Photos ===
                  The primary photo is already rendered large in the left
                  photo column. Here we show any extras as a compact
                  thumbnail strip. */}
            {evidencePhotos.length > 1 && (
              <div className='bg-muted/20 rounded-xl border p-4'>
                <div className='mb-2.5 flex items-center justify-between'>
                  <div className='flex items-center gap-1.5'>
                    <Camera className='text-muted-foreground h-3.5 w-3.5' />
                    <span className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
                      More Evidence Photos
                    </span>
                  </div>
                  <span className='text-muted-foreground text-[10px]'>
                    {evidencePhotos.length} total
                  </span>
                </div>
                <div className='grid grid-cols-6 gap-2 sm:grid-cols-8'>
                  {evidencePhotos.slice(1).map((url, i) => (
                    <a
                      key={url}
                      href={url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='group bg-muted relative aspect-square overflow-hidden rounded-md border'
                      title={`Photo ${i + 2}`}
                    >
                      <img
                        src={url}
                        alt={`Evidence photo ${i + 2}`}
                        className='h-full w-full object-cover transition-transform group-hover:scale-105'
                        loading='lazy'
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* === Assignment History === */}
            {((countData as any).reassignment_count ?? 0) > 0 && (
              <div className='bg-muted/20 rounded-xl border'>
                <button
                  type='button'
                  onClick={() => setHistoryExpanded((v) => !v)}
                  className='hover:bg-muted/40 flex w-full items-center justify-between rounded-t-xl p-4'
                >
                  <div className='flex items-center gap-1.5'>
                    <RefreshCw className='text-muted-foreground h-3.5 w-3.5' />
                    <span className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
                      Assignment History
                    </span>
                    <Badge variant='secondary' className='ml-1 text-[10px]'>
                      {(countData as any).reassignment_count} reassignment
                      {(countData as any).reassignment_count > 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground h-4 w-4 transition-transform',
                      historyExpanded && 'rotate-180'
                    )}
                  />
                </button>
                {historyExpanded && (
                  <div className='border-t px-4 py-3'>
                    {historyLoading ? (
                      <div className='flex items-center justify-center py-4'>
                        <Loader2 className='text-muted-foreground h-4 w-4 animate-spin' />
                      </div>
                    ) : assignmentHistory.length === 0 ? (
                      <p className='text-muted-foreground text-xs'>
                        No history available.
                      </p>
                    ) : (
                      <div className='relative space-y-2 pl-4'>
                        <div className='bg-border absolute top-1 bottom-0 left-[5px] w-px' />
                        {assignmentHistory.map((entry, idx) => (
                          <div key={entry.id} className='relative text-xs'>
                            <span
                              className={cn(
                                'absolute top-1 -left-[11px] h-2.5 w-2.5 rounded-full border-2',
                                idx === 0
                                  ? 'border-amber-500 bg-amber-500'
                                  : 'border-muted-foreground/40 bg-background'
                              )}
                            />
                            <div className='flex flex-wrap items-baseline gap-x-2'>
                              <span className='font-medium'>
                                {entry.previous_counter_name || 'Unassigned'}
                              </span>
                              <span className='text-muted-foreground'>→</span>
                              <span className='font-medium'>
                                {entry.new_counter_name || 'Unknown'}
                              </span>
                              <span className='text-muted-foreground ml-auto text-[10px] tabular-nums'>
                                {formatDateEST(entry.reassigned_at)}
                              </span>
                            </div>
                            <div className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]'>
                              {entry.previous_counted_quantity != null && (
                                <span>
                                  Was counted:{' '}
                                  <span className='font-medium'>
                                    {entry.previous_counted_quantity}
                                  </span>
                                </span>
                              )}
                              {entry.previous_status && (
                                <span className='capitalize'>
                                  Status:{' '}
                                  <span className='font-medium'>
                                    {entry.previous_status.replace(/_/g, ' ')}
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* === Skip / Defer history (lazy-fetched from
                    v_cycle_count_defer_history; migration 269) === */}
            <DeferHistorySection countId={countData.id} />

            {/* === Recount section (only if eligible) === */}
            {countData.status !== 'completed' &&
              countData.status !== 'approved' && (
                <div className='rounded-xl border border-orange-300 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950/20'>
                  <div className='mb-2.5 flex items-center gap-1.5'>
                    <RotateCcw className='h-3.5 w-3.5 text-orange-700 dark:text-orange-300' />
                    <span className='text-[11px] font-semibold tracking-wider text-orange-800 uppercase dark:text-orange-200'>
                      Initiate Recount
                    </span>
                  </div>
                  <p className='mb-3 text-xs text-orange-700/80 dark:text-orange-300/80'>
                    Send this count back to the queue for a different counter to
                    recount.
                  </p>
                  <div className='flex items-end gap-2'>
                    <div className='flex-1'>
                      <Label
                        htmlFor='recount_reason'
                        className='text-[10px] tracking-wide text-orange-800 uppercase dark:text-orange-200'
                      >
                        Reason (optional)
                      </Label>
                      <Input
                        id='recount_reason'
                        placeholder='e.g. Discrepancy found, verification needed'
                        value={recountReason}
                        onChange={(e) => setRecountReason(e.target.value)}
                        className='dark:bg-background mt-1 h-9 bg-white text-xs'
                      />
                    </div>
                    <Button
                      onClick={handleInitiateRecount}
                      disabled={isSubmitting}
                      variant='destructive'
                      size='sm'
                      className='h-9'
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                          Initiating…
                        </>
                      ) : (
                        <>
                          <RotateCcw className='mr-1.5 h-3.5 w-3.5' />
                          Recount
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
          </div>

          {/* ==== STICKY FOOTER ==== */}
          <div className='bg-background/95 supports-backdrop-filter:bg-background/80 flex items-center justify-between gap-4 border-t p-4 backdrop-blur-md'>
            <div className='text-muted-foreground flex items-center gap-2 text-[11px]'>
              <span className='bg-muted rounded px-1.5 py-0.5 font-mono'>
                {countData.id.substring(0, 8)}
              </span>
              {countData.updated_at && (
                <span className='hidden sm:inline'>
                  · Updated {formatTimestampEST(countData.updated_at)}
                </span>
              )}
            </div>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={onClose}
                className='min-w-[96px]'
              >
                Close
              </Button>
              {countData.status === 'variance_review' && (
                <Button
                  type='button'
                  size='sm'
                  disabled={isSubmitting}
                  className='min-w-[140px] bg-emerald-600 text-white hover:bg-emerald-700'
                  onClick={async () => {
                    setIsSubmitting(true)
                    await onApprove(countData.id, countData.count_number)
                    setIsSubmitting(false)
                    onClose()
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                      Approving…
                    </>
                  ) : (
                    <>
                      <Check className='mr-1.5 h-3.5 w-3.5' />
                      Approve Variance
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </ResponsiveDialog>
  )
}

const ManualCountsSearch: React.FC<ManualCountsSearchProps> = React.memo(
  ({ enableRealtime = true }) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [isVisible, setIsVisible] = useState(false)
    const [sortConfig] = useState<SortConfig>({
      key: 'created_at',
      direction: 'desc',
    })

    // Migration 252 review: "Pull Next preview" sort preset. When active,
    // sort the dashboard table the same way the Rust claim_next_cycle_count
    // ranks Phase 2 candidates so admins can see what the next operator
    // would actually receive. Mirrors: priority → unresolved last →
    // resolved zone/aisle/sequence → location → created_at.
    const [pullNextPreview, setPullNextPreview] = useState(false)

    const [columnFilters, setColumnFilters] =
      useState<ManualCountsColumnFilters>(() => ({
        ...INITIAL_MANUAL_COUNTS_COLUMN_FILTERS,
      }))

    // Add Counts from LX03 Modal state
    const [lx03ModalOpen, setLx03ModalOpen] = useState(false)

    // User Assignment Modal state
    const [assignmentModalOpen, setAssignmentModalOpen] = useState(false)
    const [selectedCount, setSelectedCount] =
      useState<CycleCountDataWithUser | null>(null)

    // Edit Count Modal state
    const [editCountModalOpen, setEditCountModalOpen] = useState(false)
    const [selectedCountForEdit, setSelectedCountForEdit] =
      useState<CycleCountDataWithUser | null>(null)

    // Bulk import count type prompt
    const [importCountTypeOpen, setImportCountTypeOpen] = useState(false)
    const [importCountType, setImportCountType] =
      useState<string>('quantity_check')

    // Local "user-dismissed" flag for the bulk-import progress dialog.
    // `useCycleCountOperations` clears `importProgress` to `null` ~3s after
    // completion; this lets the user close the modal earlier via the Done
    // button without racing the hook's timeout.
    const [importProgressDismissed, setImportProgressDismissed] =
      useState(false)

    // Multi-selection state
    const [selectedCountIds, setSelectedCountIds] = useState<Set<string>>(
      new Set()
    )
    const [selectAll, setSelectAll] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

    // Phase 7.7 — replaces blocking `prompt()` for recount completion.
    const [recountTarget, setRecountTarget] = useState<{
      id: string
      countNumber: string
    } | null>(null)
    const [recountQty, setRecountQty] = useState<string>('')

    // Work distribution panel state
    const [showOperatorStatus, setShowOperatorStatus] = useState(true)

    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 25

    // Live count-type options (built-in + org-specific custom workflows)
    const { options: countTypeOptions } = useCountTypeOptions()

    // Live roll-up of zones currently held by active counters (migration 225/229).
    // `onlineZones` excludes stale assignments where the operator is offline;
    // `stuckZones` is surfaced separately so supervisors can release them.
    const {
      onlineZones: activeZones,
      stuckZones,
      releaseAllStuck,
      isReleasing,
    } = useActiveZones()

    // Get current authenticated user and query client for WebSocket integration
    const { authState } = useUnifiedAuth()
    const queryClient = useQueryClient()

    // WebSocket event handler for queue updates
    const handleWsEvent = useCallback(
      (event: WsEvent) => {
        if (event.type === 'QueueStatsUpdated') {
          queryClient.invalidateQueries({
            queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
          })
        }
        if (
          event.type === 'TaskStatusChanged' ||
          event.type === 'TaskAssigned' ||
          event.type === 'PushedWork'
        ) {
          queryClient.invalidateQueries({
            queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
          })
        }
        if (event.type === 'WorkerStatusChanged') {
          queryClient.invalidateQueries({
            queryKey: [ACTIVE_WORKERS_QUERY_KEY],
          })
        }
      },
      [queryClient]
    )

    // Connect to WebSocket on mount if organization is available
    useEffect(() => {
      const orgId = authState?.profile?.organization_id
      if (!orgId || !enableRealtime) return

      workServiceWs.connect(orgId, handleWsEvent)

      return () => {
        workServiceWs.removeHandler(handleWsEvent)
      }
    }, [authState?.profile?.organization_id, enableRealtime, handleWsEvent])

    // Intersection Observer to only enable real-time updates when component is visible
    useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          setIsVisible(entry.isIntersecting)
        },
        {
          threshold: 0.1,
          rootMargin: '50px',
        }
      )

      if (componentRef.current) {
        observer.observe(componentRef.current)
      }

      return () => {
        observer.disconnect()
      }
    }, [])

    // Only enable real-time when component is visible and user wants it enabled
    const shouldEnableRealtime = enableRealtime && isVisible

    const {
      data: rawCycleData,
      filteredData,
      statistics,
      isLoading,
      error,
      searchQuery,
      setSearchQuery,
      refreshData,
      exportToCSV,
      createMultipleCycleCounts,
      importFromClipboard,
      importProgress,
      isImporting,
      assignCountToUser,
      unassignCount,
      updateCycleCountPriority,
      initiateRecount,
      completeRecount,
    } = useCycleCountOperations({ enableRealtime: shouldEnableRealtime })

    // Reset the local dismiss flag whenever a fresh import begins, so the
    // progress dialog re-opens for back-to-back imports instead of staying
    // hidden from the previous run.
    useEffect(() => {
      if (isImporting) {
        setImportProgressDismissed(false)
      }
    }, [isImporting])

    // Warn the user before a tab close / hard navigation while a bulk
    // import is still in flight — the loop in
    // `cycleCountService.importFromClipboard` is client-side row-by-row,
    // so navigating away mid-run leaves a partial import.
    useEffect(() => {
      if (!isImporting) return
      const handler = (e: BeforeUnloadEvent) => {
        e.preventDefault()
        // Required for cross-browser support — modern browsers ignore
        // the actual string but still need `returnValue` set to trigger
        // the native confirmation prompt.
        e.returnValue = ''
        return ''
      }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    }, [isImporting])

    const hasActiveColumnFilters = useMemo(() => {
      return (
        columnFilters.countNumber.trim() !== '' ||
        columnFilters.countType.trim() !== '' ||
        (columnFilters.priority && columnFilters.priority !== 'all') ||
        columnFilters.location.trim() !== '' ||
        columnFilters.material.trim() !== '' ||
        columnFilters.systemQty.trim() !== '' ||
        columnFilters.countedQty.trim() !== '' ||
        columnFilters.variance.trim() !== '' ||
        (columnFilters.partCheck && columnFilters.partCheck !== 'all') ||
        (columnFilters.status && columnFilters.status !== 'all') ||
        columnFilters.counter.trim() !== '' ||
        columnFilters.countDate.trim() !== '' ||
        columnFilters.assignedTo.trim() !== '' ||
        columnFilters.deferredByUserIds.length > 0
      )
    }, [columnFilters])

    // Lazy-load defer history for the org when one of three things wants it:
    //   1. The "Deferred by" filter has selections (filter-driven row scope).
    //   2. The "Deferred by" dropdown is open (populating the option list).
    //   3. The user is typing a search query of length >= 2 (so we can match
    //      against deferring-user names without bulking up the dashboard
    //      query).
    const [deferByDropdownOpen, setDeferByDropdownOpen] = useState(false)
    const deferByQueryEnabled =
      columnFilters.deferredByUserIds.length > 0 ||
      deferByDropdownOpen ||
      (searchQuery?.trim().length ?? 0) >= 2

    const { data: distinctDeferUsers = [], isLoading: deferUsersLoading } =
      useDistinctDeferUsers(deferByQueryEnabled, {
        includeCleared: columnFilters.includeClearedDefers,
      })

    const { data: orgDeferHistory = [] } = useDeferHistoryForOrg(
      { includeCleared: columnFilters.includeClearedDefers },
      deferByQueryEnabled
    )

    // Map<count_id, DeferHistoryEntry[]> for fast lookups inside the row
    // filter + the search predicate.
    const deferHistoryByCount = useMemo(() => {
      const map = new Map<string, DeferHistoryEntry[]>()
      for (const entry of orgDeferHistory) {
        if (!entry.count_id) continue
        const arr = map.get(entry.count_id) ?? []
        arr.push(entry)
        map.set(entry.count_id, arr)
      }
      return map
    }, [orgDeferHistory])

    const columnFilteredData = useMemo(() => {
      if (!filteredData?.length) return []

      const norm = (s: string) => s.trim().toLowerCase()
      const cellIncludes = (
        cell: string | null | undefined,
        needle: string
      ) => {
        if (!needle) return true
        return cell ? cell.toLowerCase().includes(needle) : false
      }

      return filteredData.filter((item) => {
        const cn = norm(columnFilters.countNumber)
        if (cn && !cellIncludes(item.count_number, cn)) return false

        const ct = norm(columnFilters.countType)
        if (ct) {
          const label = resolveCountTypeLabel(item.count_type, countTypeOptions)
          const raw = (item.count_type ?? '').toLowerCase()
          if (!label.toLowerCase().includes(ct) && !raw.includes(ct)) {
            return false
          }
        }

        if (
          columnFilters.priority &&
          columnFilters.priority !== 'all' &&
          (item.priority ?? 'normal') !== columnFilters.priority
        ) {
          return false
        }

        const loc = norm(columnFilters.location)
        if (loc) {
          // For transfer rows, match either the source (location) or the
          // destination — so typing either one in the filter surfaces
          // the row.
          const matches =
            cellIncludes(item.location, loc) ||
            (item.count_type === 'found_part_transfer' &&
              cellIncludes(item.transfer_destination_location, loc))
          if (!matches) return false
        }

        const mat = norm(columnFilters.material)
        if (mat && !cellIncludes(item.material_number, mat)) return false

        const sq = norm(columnFilters.systemQty)
        if (
          sq &&
          !String(item.system_quantity ?? '')
            .toLowerCase()
            .includes(sq)
        ) {
          return false
        }

        const cq = norm(columnFilters.countedQty)
        if (cq) {
          const countedStr =
            item.counted_quantity != null
              ? String(item.counted_quantity)
              : 'not counted'
          if (!countedStr.toLowerCase().includes(cq)) return false
        }

        const vr = norm(columnFilters.variance)
        if (vr) {
          const varStr =
            item.variance_quantity != null ? String(item.variance_quantity) : ''
          if (!varStr.toLowerCase().includes(vr)) return false
        }

        if (columnFilters.partCheck && columnFilters.partCheck !== 'all') {
          const empty = !!item.location_reported_empty
          const scanned =
            typeof item.scanned_material_number === 'string' &&
            item.scanned_material_number.trim() !== ''
          const variance = item.part_variance === true
          const match = scanned && !variance
          const verified = empty || scanned
          switch (columnFilters.partCheck) {
            case 'match':
              if (!match) return false
              break
            case 'variance':
              if (!variance) return false
              break
            case 'empty':
              if (!empty) return false
              break
            case 'unverified':
              if (verified) return false
              break
          }
        }

        if (columnFilters.status && columnFilters.status !== 'all') {
          const itemStatus = item.status ?? ''
          // 'pending' and 'completed' from the Count Status card are
          // group filters — they cover every status the card's totals
          // include. 'recount' is orthogonal to status and matches the
          // same predicate as `countsRequiringRecount` in the stats RPC.
          // Anything else is an exact-status match (in_progress,
          // variance_review, approved, cancelled, …).
          if (columnFilters.status === 'pending') {
            if (!PENDING_GROUP_STATUSES.has(itemStatus)) return false
          } else if (columnFilters.status === 'completed') {
            if (!COMPLETED_GROUP_STATUSES.has(itemStatus)) return false
          } else if (columnFilters.status === 'recount') {
            if (!item.requires_recount || item.recount_completed) return false
          } else if (itemStatus !== columnFilters.status) {
            return false
          }
        }

        const counterN = norm(columnFilters.counter)
        if (counterN && !cellIncludes(item.counter_name, counterN)) return false

        const dateN = norm(columnFilters.countDate)
        if (dateN) {
          const display = formatDateEST(item.count_date)
          const raw = (item.count_date ?? '').toLowerCase()
          if (!display.toLowerCase().includes(dateN) && !raw.includes(dateN)) {
            return false
          }
        }

        const assignN = norm(columnFilters.assignedTo)
        if (assignN) {
          const name = item.assigned_to_user?.full_name
          const email = item.assigned_to_user?.email
          if (!cellIncludes(name, assignN) && !cellIncludes(email, assignN)) {
            return false
          }
        }

        // "Deferred by" filter — match counts whose defer history (active or
        // cleared, per `includeClearedDefers`) includes any of the selected
        // user_ids.
        if (columnFilters.deferredByUserIds.length > 0) {
          const entries = deferHistoryByCount.get(item.id) ?? []
          const selected = new Set(columnFilters.deferredByUserIds)
          const match = entries.some(
            (e) =>
              selected.has(e.user_id) &&
              (columnFilters.includeClearedDefers || e.is_active)
          )
          if (!match) return false
        }

        return true
      })
    }, [filteredData, columnFilters, countTypeOptions, deferHistoryByCount])

    // Widen the visible rows when the search query matches a deferring-user
    // name / email / username / reason but NOT any other field already
    // covered by the upstream search predicate. Pulls extra rows from
    // `rawCycleData` (the unfiltered fetch) and applies the same column
    // filter pass to keep the table self-consistent.
    const searchExtendedIds = useMemo(() => {
      const out = new Set<string>()
      const sq = (searchQuery ?? '').trim().toLowerCase()
      if (sq.length < 2 || orgDeferHistory.length === 0) return out
      for (const entry of orgDeferHistory) {
        if (!entry.count_id) continue
        const fullName = (entry.user_full_name ?? '').toLowerCase()
        const email = (entry.user_email ?? '').toLowerCase()
        const username = (entry.user_username ?? '').toLowerCase()
        const reason = (entry.defer_reason ?? '').toLowerCase()
        if (
          fullName.includes(sq) ||
          email.includes(sq) ||
          username.includes(sq) ||
          reason.includes(sq)
        ) {
          out.add(entry.count_id)
        }
      }
      return out
    }, [searchQuery, orgDeferHistory])

    const finalFilteredData = useMemo(() => {
      if (searchExtendedIds.size === 0) return columnFilteredData
      const present = new Set(columnFilteredData.map((r) => r.id))
      const extras: CycleCountDataWithUser[] = []
      for (const row of rawCycleData) {
        if (searchExtendedIds.has(row.id) && !present.has(row.id)) {
          extras.push(row)
        }
      }
      return extras.length > 0
        ? [...columnFilteredData, ...extras]
        : columnFilteredData
    }, [columnFilteredData, rawCycleData, searchExtendedIds])

    const clearColumnFilters = useCallback(() => {
      setColumnFilters({ ...INITIAL_MANUAL_COUNTS_COLUMN_FILTERS })
    }, [])

    // Sort and paginate data — secondary sort on `id` guarantees a stable,
    // deterministic order even when the primary key has duplicate values
    // (e.g. bulk-imported rows with the same created_at timestamp).
    const sortedData = useMemo(() => {
      if (!finalFilteredData || finalFilteredData.length === 0) return []

      // Pull Next preview — mirror the Rust Phase 2 ORDER BY.
      if (pullNextPreview) {
        const priorityRank = (p: string | null | undefined) => {
          switch ((p ?? 'normal').toLowerCase()) {
            case 'critical':
              return 1
            case 'hot':
              return 2
            case 'normal':
              return 3
            case 'low':
              return 4
            default:
              return 5
          }
        }
        const isUnresolved = (src: string | null | undefined): number =>
          src && src !== 'unresolved' ? 0 : 1
        const cmpStr = (
          a: string | null | undefined,
          b: string | null | undefined
        ) => {
          const aMissing = !a
          const bMissing = !b
          if (aMissing && bMissing) return 0
          if (aMissing) return 1
          if (bMissing) return -1
          return a!.localeCompare(b!)
        }
        const cmpNum = (
          a: number | null | undefined,
          b: number | null | undefined
        ) => {
          if (a == null && b == null) return 0
          if (a == null) return 1
          if (b == null) return -1
          return a - b
        }
        return [...finalFilteredData].sort((a, b) => {
          const ar = a as Record<string, unknown>
          const br = b as Record<string, unknown>
          const pri = priorityRank(a.priority) - priorityRank(b.priority)
          if (pri !== 0) return pri
          const unr =
            isUnresolved(ar.resolution_source as string | null | undefined) -
            isUnresolved(br.resolution_source as string | null | undefined)
          if (unr !== 0) return unr
          const z = cmpStr(
            ar.resolved_zone as string | null | undefined,
            br.resolved_zone as string | null | undefined
          )
          if (z !== 0) return z
          const ai = cmpStr(
            ar.resolved_aisle as string | null | undefined,
            br.resolved_aisle as string | null | undefined
          )
          if (ai !== 0) return ai
          const seq = cmpNum(
            ar.resolved_sequence as number | null | undefined,
            br.resolved_sequence as number | null | undefined
          )
          if (seq !== 0) return seq
          const loc = cmpStr(a.location, b.location)
          if (loc !== 0) return loc
          const ca = (a.created_at ?? '') as string
          const cb = (b.created_at ?? '') as string
          if (ca < cb) return -1
          if (ca > cb) return 1
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        })
      }

      return [...finalFilteredData].sort((a, b) => {
        const aValue = a[sortConfig.key as keyof typeof a]
        const bValue = b[sortConfig.key as keyof typeof b]

        if (aValue == null && bValue == null) {
          // Fall through to tiebreaker
        } else if (aValue == null) {
          return sortConfig.direction === 'asc' ? -1 : 1
        } else if (bValue == null) {
          return sortConfig.direction === 'asc' ? 1 : -1
        } else if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1
        } else if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1
        }

        // Tiebreaker: sort by id to keep order deterministic across refetches
        if (a.id < b.id) return -1
        if (a.id > b.id) return 1
        return 0
      })
    }, [finalFilteredData, sortConfig, pullNextPreview])

    const paginatedData = useMemo(() => {
      const startIndex = (currentPage - 1) * recordsPerPage
      return sortedData.slice(startIndex, startIndex + recordsPerPage)
    }, [sortedData, currentPage, recordsPerPage])

    const totalPages = Math.ceil(sortedData.length / recordsPerPage)

    useEffect(() => {
      setCurrentPage(1)
      setSelectedCountIds(new Set())
      setSelectAll(false)
    }, [searchQuery, columnFilters])

    // Get selected counts data for the work distribution panel
    const selectedCounts = useMemo(() => {
      return filteredData.filter((count) => selectedCountIds.has(count.id))
    }, [filteredData, selectedCountIds])

    // Handle Add Counts from LX03
    const handleAddCountsFromLX03 = useCallback(
      async (
        counts: Array<{
          material_number: string
          location: string
          warehouse: string | null
          system_quantity: number
          count_type: string
          priority: string
          assigned_to?: string | null
        }>
      ) => {
        try {
          // count_type is free-form TEXT in the DB; priority is still an enum.
          const typedCounts = counts.map((c) => ({
            ...c,
            priority: c.priority as CycleCountPriority,
          }))
          await createMultipleCycleCounts(typedCounts)
          // Success toast is handled in the hook
        } catch (error) {
          logger.error('Error adding counts from LX03:', error)
          // Error toast is handled in the hook
        }
      },
      [createMultipleCycleCounts]
    )

    // Handle Assignment
    const handleOpenAssignmentModal = useCallback(
      (count: CycleCountDataWithUser) => {
        setSelectedCount(count)
        setAssignmentModalOpen(true)
      },
      []
    )

    // Assign a count. The zone-lock-aware legacy `assignCountToUser` write is
    // the source of truth (and cascades to work_tasks via the projection
    // trigger when shadow_write is ON). The work_tasks sync afterward is
    // best-effort, matched by `source_id` with no `updated_at` CAS — see
    // `workService.updateAssignment` for why a CAS on `work_tasks.updated_at`
    // mis-fired on nearly every row and wrongly aborted valid assignments.
    const handleAssignCount = useCallback(
      async (userId: string) => {
        if (!selectedCount) return
        const orgId = authState?.profile?.organization_id
        const countId = selectedCount.id

        try {
          await assignCountToUser(countId, userId)
          setAssignmentModalOpen(false)
          setSelectedCount(null)
        } catch (error) {
          logger.error('Error assigning count:', error)
          return
        }

        // Best-effort work_tasks sync for shadow_write-OFF orgs. Non-fatal.
        if (orgId) {
          try {
            await workService.updateAssignment({
              source_id: countId,
              organization_id: orgId,
              new_assignee: userId,
            })
          } catch (err) {
            logger.warn('work_tasks assignment sync failed (non-fatal):', err)
          }
        }
      },
      [selectedCount, assignCountToUser, authState?.profile?.organization_id]
    )

    const handleUnassignCount = useCallback(
      async (countId: string) => {
        try {
          await unassignCount(countId)
        } catch (error) {
          logger.error('Error unassigning count:', error)
        }
      },
      [unassignCount]
    )

    const handleUpdatePriority = useCallback(
      async (countId: string, priority: CycleCountPriority) => {
        try {
          await updateCycleCountPriority(countId, priority)
        } catch (error) {
          logger.error('Error updating priority:', error)
        }
      },
      [updateCycleCountPriority]
    )

    // Handle Edit Count
    const handleOpenEditModal = useCallback((count: CycleCountDataWithUser) => {
      setSelectedCountForEdit(count)
      setEditCountModalOpen(true)
    }, [])

    const handleInitiateRecount = useCallback(
      async (countId: string, reason?: string) => {
        try {
          await initiateRecount(countId, reason)
          setEditCountModalOpen(false)
          setSelectedCountForEdit(null)
        } catch (error) {
          logger.error('Error initiating recount:', error)
        }
      },
      [initiateRecount]
    )

    // Handle select all toggle
    const handleSelectAll = useCallback(() => {
      if (selectAll) {
        setSelectedCountIds(new Set())
        setSelectAll(false)
      } else {
        const allIds = new Set(paginatedData.map((count) => count.id))
        setSelectedCountIds(allIds)
        setSelectAll(true)
      }
    }, [selectAll, paginatedData])

    // Handle individual row selection
    const handleRowToggle = useCallback(
      (countId: string) => {
        setSelectedCountIds((prev) => {
          const newSet = new Set(prev)
          if (newSet.has(countId)) {
            newSet.delete(countId)
          } else {
            newSet.add(countId)
          }
          setSelectAll(
            newSet.size === paginatedData.length && paginatedData.length > 0
          )
          return newSet
        })
      },
      [paginatedData.length]
    )

    // Handle mass assignment
    const handleMassAssignment = useCallback(async () => {
      if (selectedCountIds.size === 0) {
        toast.error('Please select at least one count to assign')
        return
      }

      // Use first selected count for the modal
      const firstSelectedId = Array.from(selectedCountIds)[0]
      const firstCount = filteredData.find((c) => c.id === firstSelectedId)
      if (firstCount) {
        setSelectedCount(firstCount)
        setAssignmentModalOpen(true)
      }
    }, [selectedCountIds, filteredData])

    // Handle mass assignment confirmation.
    // Migration 252 review: Promise.allSettled so a single zone-blocked
    // row no longer aborts the whole batch. Aggregate ZONE_LOCKED /
    // ZONE_ASSIGNED reasons and surface them in one summary toast.
    // Migration 253 review: pass `{ silent: true }` so the underlying
    // mutation suppresses the per-row "Cycle count assigned
    // successfully" toast — the aggregate summary toast below is the
    // single source of truth for bulk feedback.
    const handleMassAssignConfirm = useCallback(
      async (userId: string) => {
        const ids = Array.from(selectedCountIds)
        const idToCount = new Map(filteredData.map((c) => [c.id, c]))
        const results = await Promise.allSettled(
          ids.map(async (countId) => {
            await assignCountToUser(countId, userId, { silent: true })
            return countId
          })
        )

        const succeeded: string[] = []
        const zoneBlockedZones = new Set<string>()
        const zoneAssignedZones = new Set<string>()
        const otherErrors: string[] = []

        results.forEach((res, idx) => {
          const countId = ids[idx]
          if (res.status === 'fulfilled') {
            succeeded.push(countId)
            return
          }
          const msg =
            res.reason instanceof Error
              ? res.reason.message
              : String(res.reason)
          const count = idToCount.get(countId)
          const zoneFromMessage = /Zone\s+"([^"]+)"/i.exec(msg)?.[1] ?? null
          const fallbackZone =
            zoneFromMessage ??
            (count?.location ? count.location.split('-')[0] : null)
          if (/ZONE_LOCKED/i.test(msg)) {
            if (fallbackZone) zoneBlockedZones.add(fallbackZone)
          } else if (/ZONE_ASSIGNED/i.test(msg)) {
            if (fallbackZone) zoneAssignedZones.add(fallbackZone)
          } else {
            otherErrors.push(`${count?.count_number ?? countId}: ${msg}`)
          }
        })

        const blocked = ids.length - succeeded.length

        if (succeeded.length > 0 && blocked === 0) {
          toast.success(
            `Assigned ${succeeded.length} count${succeeded.length !== 1 ? 's' : ''}`
          )
        } else if (succeeded.length > 0 && blocked > 0) {
          const reasons: string[] = []
          if (zoneBlockedZones.size > 0)
            reasons.push(
              `zone reserved: ${Array.from(zoneBlockedZones).join(', ')}`
            )
          if (zoneAssignedZones.size > 0)
            reasons.push(
              `zone assigned to others: ${Array.from(zoneAssignedZones).join(', ')}`
            )
          if (otherErrors.length > 0)
            reasons.push(`other: ${otherErrors.length}`)
          toast.warning(`Assigned ${succeeded.length}, blocked ${blocked}`, {
            description:
              reasons.length > 0
                ? reasons.join(' · ')
                : 'See console for details.',
            duration: 9000,
          })
          if (otherErrors.length > 0)
            logger.error('Mass assignment partial failures:', otherErrors)
        } else {
          const reasons: string[] = []
          if (zoneBlockedZones.size > 0)
            reasons.push(
              `Zone reserved: ${Array.from(zoneBlockedZones).join(', ')}`
            )
          if (zoneAssignedZones.size > 0)
            reasons.push(
              `Zone assigned to others: ${Array.from(zoneAssignedZones).join(', ')}`
            )
          toast.error('Failed to assign any counts', {
            description:
              reasons.length > 0
                ? reasons.join(' · ')
                : (otherErrors[0] ?? 'See console for details.'),
            duration: 9000,
          })
          logger.error('Mass assignment all failed:', { otherErrors })
        }

        setSelectedCountIds(new Set())
        setSelectAll(false)
        setAssignmentModalOpen(false)
        setSelectedCount(null)
      },
      [selectedCountIds, filteredData, assignCountToUser]
    )

    // Handle mass delete - show confirmation
    const handleMassDelete = useCallback(() => {
      if (selectedCountIds.size === 0) {
        toast.error('Please select at least one count to delete')
        return
      }
      setShowDeleteConfirm(true)
    }, [selectedCountIds.size])

    // Handle delete confirmation — Phase 7.5: route through workService so
    // the deletion goes through the canonical entry point. The service
    // dual-writes (work_tasks soft-delete + rr_cyclecount_data hard-delete)
    // so behaviour is identical regardless of the per-org
    // `work_tasks_shadow_write` flag state.
    const handleDeleteConfirm = useCallback(async () => {
      setShowDeleteConfirm(false)

      try {
        const idsToDelete = Array.from(selectedCountIds)
        const orgId = authState?.profile?.organization_id
        if (!orgId) {
          toast.error('Organization context required to delete counts')
          return
        }
        if (idsToDelete.length === 0) return

        const successCount = await workService.massDelete(idsToDelete, orgId)
        const errorCount = idsToDelete.length - successCount

        if (successCount > 0) {
          toast.success(`Successfully deleted ${successCount} count(s)`)
        }
        if (errorCount > 0) {
          toast.warning(
            `Failed to delete ${errorCount} count(s). Some rows may have already been removed.`
          )
        }

        setSelectedCountIds(new Set())
        setSelectAll(false)
        refreshData()
      } catch (error) {
        logger.error('Error in delete operation:', error)
        toast.error(
          `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }, [selectedCountIds, refreshData, authState?.profile?.organization_id])

    // Handle cleanup abandoned counts
    const handleCleanupAbandoned = useCallback(async () => {
      try {
        toast.info('Checking for abandoned counts...')

        // Call the RPC function to release abandoned counts (30 min threshold)
        const { data, error } = await supabase.rpc(
          'release_abandoned_cycle_counts' as never,
          {
            p_abandonment_threshold_minutes: 30,
            p_max_releases: 100,
          } as never
        )

        if (error) {
          toast.error(`Error cleaning up abandoned counts: ${error.message}`)
          return
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = data as any
        if (result && result.success) {
          const releasedCount = result.released_count || 0
          if (releasedCount > 0) {
            toast.success(
              `✓ Released ${releasedCount} abandoned count(s) back to PENDING status`
            )
            refreshData()
          } else {
            toast.success(
              '✓ No abandoned counts found (checked for counts idle > 30 min)'
            )
          }
        }
      } catch (error: unknown) {
        logger.error('Error cleaning up abandoned counts:', error)
        toast.error(
          `Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }, [refreshData])

    // Handle approve count — optimistic concurrency now lives on the
    // authoritative legacy `rr_cyclecount_data` write (the table + `updated_at`
    // the supervisor UI actually read). The caller passes the row's
    // `updated_at` captured at fetch time; a CAS miss means the row changed
    // (or was already approved) elsewhere, so we refresh instead of silently
    // overwriting. The `work_tasks` sync afterward is best-effort and matches
    // by `source_id` (no CAS) — see the note in `workService.approveVariance`
    // for why a CAS on `work_tasks.updated_at` mis-fired on nearly every row.
    const handleApproveCount = useCallback(
      async (
        countId: string,
        countNumber: string,
        expectedUpdatedAt: string | null = null
      ) => {
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          if (!user) {
            toast.error('User not authenticated')
            return
          }
          const orgId = authState?.profile?.organization_id
          if (!orgId) {
            toast.error('Organization context required to approve counts')
            return
          }

          const nowIso = new Date().toISOString()

          // Authoritative write + optimistic concurrency on the legacy row.
          let approveQuery = supabase
            .from('rr_cyclecount_data')
            .update(
              {
                status: 'approved',
                approved_by: user.id,
                approved_at: nowIso,
                updated_at: nowIso,
              },
              { count: 'exact' }
            )
            .eq('id', countId)
            .eq('organization_id', orgId)
          if (expectedUpdatedAt) {
            approveQuery = approveQuery.eq('updated_at', expectedUpdatedAt)
          }

          const { error, count } = await approveQuery

          if (error) {
            toast.error(`Failed to approve count: ${error.message}`)
            logger.error('Approve error:', error)
            return
          }

          // CAS miss: the row changed (or was already approved) since the UI
          // loaded it. Refresh so the supervisor sees the latest state.
          if (expectedUpdatedAt && (count ?? 0) === 0) {
            toast.error('Count was modified in another window — refreshing')
            refreshData()
            return
          }

          // Best-effort mirror to work_tasks for orgs where shadow_write is
          // OFF (when it is ON the legacy write above already cascades via the
          // projection trigger; this is idempotent). Never blocks the approval.
          try {
            await workService.approveVariance({
              source_id: countId,
              organization_id: orgId,
            })
          } catch (err) {
            logger.warn('work_tasks approval sync failed (non-fatal):', err)
          }

          toast.success(`✓ Count ${countNumber} approved successfully`)
          refreshData()
        } catch (error: unknown) {
          logger.error('Error approving count:', error)
          toast.error(
            `Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
      },
      [refreshData, authState?.profile?.organization_id]
    )

    // Handle export data
    const handleExportData = useCallback(() => {
      if (sortedData.length === 0) {
        toast.warning('No data to export')
        return
      }

      try {
        const csvContent = exportToCSV()

        // Download CSV file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute(
          'download',
          `cycle-counts-${new Date().toISOString().split('T')[0]}.csv`
        )
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        toast.success(`Exported ${sortedData.length} cycle counts`)
      } catch (error) {
        toast.error('Export failed')
        logger.error('Export error:', error)
      }
    }, [sortedData, exportToCSV])

    // Calculate additional metrics
    const normalCounts = useMemo(() => {
      if (!statistics?.priorityBreakdown) return 0
      return statistics.priorityBreakdown.normal || 0
    }, [statistics])

    // Calculate accuracy metrics
    const countAccuracy = useMemo(() => {
      if (!statistics) return 0
      const total = statistics.totalCounts || 0
      const accurate =
        (statistics.completedCounts || 0) -
        (statistics.countsRequiringRecount || 0)
      if (total === 0) return 0
      return Math.round((accurate / total) * 100)
    }, [statistics])

    const binAccuracy = useMemo(() => {
      if (!statistics) return 0
      const total = statistics.totalCounts || 0
      const accurate = total - (statistics.varianceReviewCounts || 0)
      if (total === 0) return 0
      return Math.round((accurate / total) * 100)
    }, [statistics])

    // Click handlers for the statistics card pills — each pill toggles a column
    // filter so the cards double as a quick-filter palette for the table below.
    const toggleStatusFilter = useCallback(
      (status: string) => {
        setColumnFilters((f) => ({
          ...f,
          status: f.status === status ? 'all' : status,
        }))
        setCurrentPage(1)
        setSelectedCountIds(new Set())
        setSelectAll(false)
      },
      [setColumnFilters]
    )

    const togglePriorityFilter = useCallback(
      (priority: string) => {
        setColumnFilters((f) => ({
          ...f,
          priority: f.priority === priority ? 'all' : priority,
        }))
        setCurrentPage(1)
        setSelectedCountIds(new Set())
        setSelectAll(false)
      },
      [setColumnFilters]
    )

    const clearStatusAndPriorityFilters = useCallback(() => {
      setColumnFilters((f) => ({ ...f, status: 'all', priority: 'all' }))
      setCurrentPage(1)
      setSelectedCountIds(new Set())
      setSelectAll(false)
    }, [setColumnFilters])

    const StatisticsCards = useMemo(() => {
      // Active states drive the visual ring on each clickable filter pill.
      const activeStatus = columnFilters.status
      const activePriority = columnFilters.priority
      const isStatusActive = (s: string) => activeStatus === s
      const isPriorityActive = (p: string) => activePriority === p
      const anyStatusFilterActive = activeStatus && activeStatus !== 'all'
      const anyPriorityFilterActive = activePriority && activePriority !== 'all'

      // Wrapper around <KpiStatTile> that makes the tile keyboard-accessible
      // and clickable for filter-pill behaviour. Keeps the focus ring on the
      // outer <button> so we don't fight StatTile's own surface styling.
      const pillButtonBase =
        'group/pill block w-full rounded-lg text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer'

      return (
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4'>
          {/* Card 1: Count Status */}
          <Card className='group border-border/50 bg-card/50 relative overflow-hidden backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20'>
            <div className='from-primary/5 to-primary/0 absolute inset-0 bg-linear-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
            <CardHeader className='relative flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
                <div className='flex h-6 w-6 items-center justify-center rounded-md bg-slate-500/10 dark:bg-slate-400/10'>
                  <Archive className='h-3.5 w-3.5 text-slate-600 dark:text-slate-400' />
                </div>
                Count Status
              </CardTitle>
              {anyStatusFilterActive ? (
                <button
                  type='button'
                  onClick={clearStatusAndPriorityFilters}
                  className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition-colors'
                  title='Clear status filter'
                >
                  Filtered · clear
                </button>
              ) : (
                <span className='text-muted-foreground/60 text-[10px] font-medium tracking-wider uppercase'>
                  Click to filter
                </span>
              )}
            </CardHeader>
            <CardContent className='relative pt-1 pb-4'>
              <KpiGrid columns={3} density='compact'>
                <button
                  type='button'
                  aria-pressed={!anyStatusFilterActive}
                  onClick={() => toggleStatusFilter('all')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-slate-500/40',
                    !anyStatusFilterActive &&
                      'ring-2 ring-slate-500/40 dark:ring-slate-400/40'
                  )}
                  title='Show all statuses (Pending + Completed)'
                >
                  <KpiStatTile
                    label='Total'
                    value={statistics?.totalCounts || 0}
                    accent='default'
                    valueTitle='Total non-cancelled counts — equals Pending + Completed'
                    className='h-full transition-colors hover:bg-slate-500/10 dark:hover:bg-slate-400/10'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isStatusActive('pending')}
                  onClick={() => toggleStatusFilter('pending')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-amber-500/40',
                    isStatusActive('pending') && 'ring-2 ring-amber-500/60'
                  )}
                  title='Filter table to Pending counts (pending + in progress)'
                >
                  <KpiStatTile
                    label='Pending'
                    value={statistics?.pendingCounts || 0}
                    accent='amber'
                    valueTitle='Counts still to be done: status = pending or in progress'
                    className='h-full transition-colors hover:bg-amber-500/15 dark:hover:bg-amber-500/15'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isStatusActive('completed')}
                  onClick={() => toggleStatusFilter('completed')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-emerald-500/40',
                    isStatusActive('completed') && 'ring-2 ring-emerald-500/60'
                  )}
                  title='Filter table to Completed counts (completed + approved + variance review)'
                >
                  <KpiStatTile
                    label='Completed'
                    value={statistics?.completedCounts || 0}
                    accent='emerald'
                    valueTitle='Counts that have been performed: status = completed, approved, or variance review'
                    className='h-full transition-colors hover:bg-emerald-500/15 dark:hover:bg-emerald-500/15'
                  />
                </button>
              </KpiGrid>
            </CardContent>
          </Card>

          {/* Card 2: Variance Metrics */}
          <Card
            className={cn(
              'group relative overflow-hidden backdrop-blur-sm transition-all duration-300 hover:shadow-lg',
              (statistics?.varianceReviewCounts || 0) > 0
                ? 'border-amber-500/30 bg-amber-500/5 hover:shadow-amber-500/10 dark:border-amber-500/20 dark:bg-amber-500/5 dark:hover:shadow-amber-500/5'
                : 'border-border/50 bg-card/50 hover:shadow-black/5 dark:hover:shadow-black/20'
            )}
          >
            <div className='absolute inset-0 bg-linear-to-br from-amber-500/5 to-orange-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
            <CardHeader className='relative flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md',
                    (statistics?.varianceReviewCounts || 0) > 0
                      ? 'bg-amber-500/15 dark:bg-amber-500/10'
                      : 'bg-slate-500/10 dark:bg-slate-400/10'
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      'h-3.5 w-3.5',
                      (statistics?.varianceReviewCounts || 0) > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-600 dark:text-slate-400'
                    )}
                  />
                </div>
                Variance Metrics
              </CardTitle>
              {(statistics?.varianceReviewCounts || 0) > 0 && (
                <span className='inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'>
                  Needs Review
                </span>
              )}
            </CardHeader>
            <CardContent className='relative pt-1 pb-4'>
              <KpiGrid columns={3} density='compact'>
                <button
                  type='button'
                  aria-pressed={isStatusActive('variance_review')}
                  onClick={() => toggleStatusFilter('variance_review')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-orange-500/40',
                    isStatusActive('variance_review') &&
                      'ring-2 ring-orange-500/60'
                  )}
                  title='Filter table to Variance Review counts'
                >
                  <KpiStatTile
                    label='Review'
                    value={statistics?.varianceReviewCounts || 0}
                    accent='orange'
                    className='h-full transition-colors hover:bg-orange-500/15 dark:hover:bg-orange-500/15'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isStatusActive('recount')}
                  onClick={() => toggleStatusFilter('recount')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-violet-500/40',
                    isStatusActive('recount') && 'ring-2 ring-violet-500/60'
                  )}
                  title='Filter table to Recount counts'
                >
                  <KpiStatTile
                    label='Recounts'
                    value={statistics?.countsRequiringRecount || 0}
                    accent='violet'
                    className='h-full transition-colors hover:bg-violet-500/15 dark:hover:bg-violet-500/15'
                  />
                </button>
                <KpiStatTile
                  label='Variance'
                  value={statistics?.totalVarianceValue || 0}
                  accent='default'
                  valueTitle='Total absolute variance value (sum across counts) — informational metric'
                />
              </KpiGrid>
            </CardContent>
          </Card>

          {/* Card 3: Priority Breakdown */}
          <Card
            className={cn(
              'group relative overflow-hidden backdrop-blur-sm transition-all duration-300 hover:shadow-lg',
              (statistics?.priorityBreakdown?.critical || 0) > 0
                ? 'border-red-500/30 bg-red-500/5 hover:shadow-red-500/10 dark:border-red-500/20 dark:bg-red-500/5 dark:hover:shadow-red-500/5'
                : 'border-border/50 bg-card/50 hover:shadow-black/5 dark:hover:shadow-black/20'
            )}
          >
            <div className='absolute inset-0 bg-linear-to-br from-red-500/5 to-rose-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
            <CardHeader className='relative flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md',
                    (statistics?.priorityBreakdown?.critical || 0) > 0
                      ? 'bg-red-500/15 dark:bg-red-500/10'
                      : 'bg-slate-500/10 dark:bg-slate-400/10'
                  )}
                >
                  <Target
                    className={cn(
                      'h-3.5 w-3.5',
                      (statistics?.priorityBreakdown?.critical || 0) > 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-600 dark:text-slate-400'
                    )}
                  />
                </div>
                Priority Breakdown
              </CardTitle>
              {anyPriorityFilterActive ? (
                <button
                  type='button'
                  onClick={() => togglePriorityFilter(activePriority)}
                  className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition-colors'
                  title='Clear priority filter'
                >
                  Filtered · clear
                </button>
              ) : (
                (statistics?.priorityBreakdown?.critical || 0) > 0 && (
                  <span className='inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-400'>
                    <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-red-500' />
                    {statistics?.priorityBreakdown?.critical} Critical
                  </span>
                )
              )}
            </CardHeader>
            <CardContent className='relative pt-1 pb-4'>
              <KpiGrid columns={3} density='compact'>
                <button
                  type='button'
                  aria-pressed={isPriorityActive('critical')}
                  onClick={() => togglePriorityFilter('critical')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-red-500/40',
                    isPriorityActive('critical') && 'ring-2 ring-red-500/60'
                  )}
                  title='Filter table to Critical priority'
                >
                  <KpiStatTile
                    label='Critical'
                    accent='rose'
                    format='raw'
                    value={
                      <span className='inline-flex items-center gap-1.5'>
                        <span
                          aria-hidden
                          className='h-2 w-2 animate-pulse rounded-full bg-red-500'
                        />
                        {(
                          statistics?.priorityBreakdown?.critical || 0
                        ).toLocaleString()}
                      </span>
                    }
                    valueTitle={String(
                      statistics?.priorityBreakdown?.critical || 0
                    )}
                    className='h-full transition-colors hover:bg-rose-500/15 dark:hover:bg-rose-500/15'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isPriorityActive('hot')}
                  onClick={() => togglePriorityFilter('hot')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-orange-500/40',
                    isPriorityActive('hot') && 'ring-2 ring-orange-500/60'
                  )}
                  title='Filter table to Hot priority'
                >
                  <KpiStatTile
                    label='Hot'
                    accent='orange'
                    format='raw'
                    value={
                      <span className='inline-flex items-center gap-1.5'>
                        <span
                          aria-hidden
                          className='h-2 w-2 rounded-full bg-orange-500'
                        />
                        {(
                          statistics?.priorityBreakdown?.hot || 0
                        ).toLocaleString()}
                      </span>
                    }
                    valueTitle={String(statistics?.priorityBreakdown?.hot || 0)}
                    className='h-full transition-colors hover:bg-orange-500/15 dark:hover:bg-orange-500/15'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isPriorityActive('normal')}
                  onClick={() => togglePriorityFilter('normal')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-blue-500/40',
                    isPriorityActive('normal') && 'ring-2 ring-blue-500/60'
                  )}
                  title='Filter table to Normal priority'
                >
                  <KpiStatTile
                    label='Normal'
                    accent='sky'
                    format='raw'
                    value={
                      <span className='inline-flex items-center gap-1.5'>
                        <span
                          aria-hidden
                          className='h-2 w-2 rounded-full bg-blue-500'
                        />
                        {normalCounts.toLocaleString()}
                      </span>
                    }
                    valueTitle={String(normalCounts)}
                    className='h-full transition-colors hover:bg-sky-500/15 dark:hover:bg-sky-500/15'
                  />
                </button>
              </KpiGrid>
            </CardContent>
          </Card>

          {/* Card 4: Accuracy Metrics */}
          <Card
            className={cn(
              'group relative overflow-hidden backdrop-blur-sm transition-all duration-300 hover:shadow-lg',
              countAccuracy >= 95
                ? 'border-emerald-500/30 bg-emerald-500/5 hover:shadow-emerald-500/10 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:hover:shadow-emerald-500/5'
                : 'border-border/50 bg-card/50 hover:shadow-black/5 dark:hover:shadow-black/20'
            )}
          >
            <div className='absolute inset-0 bg-linear-to-br from-emerald-500/5 to-green-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
            <CardHeader className='relative flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md',
                    countAccuracy >= 95
                      ? 'bg-emerald-500/15 dark:bg-emerald-500/10'
                      : 'bg-slate-500/10 dark:bg-slate-400/10'
                  )}
                >
                  <CheckCircle
                    className={cn(
                      'h-3.5 w-3.5',
                      countAccuracy >= 95
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-600 dark:text-slate-400'
                    )}
                  />
                </div>
                Accuracy Metrics
              </CardTitle>
            </CardHeader>
            <CardContent className='relative pt-1 pb-4'>
              <KpiGrid columns={2}>
                <KpiStatTile
                  label='Count Accuracy'
                  value={countAccuracy}
                  format='percent'
                  accent={
                    countAccuracy >= 95
                      ? 'emerald'
                      : countAccuracy >= 80
                        ? 'amber'
                        : 'rose'
                  }
                  hint={
                    <div className='whitespace-normal'>
                      <div className='bg-border/50 h-1.5 w-full overflow-hidden rounded-full'>
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-700',
                            countAccuracy >= 95
                              ? 'bg-emerald-500'
                              : countAccuracy >= 80
                                ? 'bg-amber-500'
                                : 'bg-red-500'
                          )}
                          style={{
                            width: `${Math.min(countAccuracy, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  }
                />
                <KpiStatTile
                  label='Bin Accuracy'
                  value={binAccuracy}
                  format='percent'
                  accent={
                    binAccuracy >= 95
                      ? 'emerald'
                      : binAccuracy >= 80
                        ? 'amber'
                        : 'rose'
                  }
                  hint={
                    <div className='whitespace-normal'>
                      <div className='bg-border/50 h-1.5 w-full overflow-hidden rounded-full'>
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-700',
                            binAccuracy >= 95
                              ? 'bg-emerald-500'
                              : binAccuracy >= 80
                                ? 'bg-amber-500'
                                : 'bg-red-500'
                          )}
                          style={{
                            width: `${Math.min(binAccuracy, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  }
                />
              </KpiGrid>
            </CardContent>
          </Card>
        </div>
      )
    }, [
      statistics,
      normalCounts,
      countAccuracy,
      binAccuracy,
      columnFilters.status,
      columnFilters.priority,
      toggleStatusFilter,
      togglePriorityFilter,
      clearStatusAndPriorityFilters,
    ])

    if (isLoading) {
      return (
        <Card className='border-border/50 bg-card/50 w-full backdrop-blur-sm'>
          <CardContent className='py-14'>
            <div className='flex flex-col items-center justify-center gap-3'>
              <Loader2 className='text-primary h-7 w-7 animate-spin' />
              <div className='text-center'>
                <p className='text-foreground text-sm font-medium'>
                  Loading cycle count data...
                </p>
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  Fetching your records
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )
    }

    if (error) {
      return (
        <Card className='border-border/50 bg-card/50 w-full backdrop-blur-sm'>
          <CardContent className='py-14'>
            <div className='flex flex-col items-center gap-3 text-center'>
              <div className='flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10'>
                <AlertTriangle className='h-6 w-6 text-red-600 dark:text-red-400' />
              </div>
              <div>
                <h3 className='text-foreground mb-1 text-sm font-semibold'>
                  Error Loading Data
                </h3>
                <p className='text-muted-foreground mx-auto mb-4 max-w-xs text-xs'>
                  {error.message ||
                    'Failed to load cycle count data. Please try again.'}
                </p>
                <Button onClick={refreshData} variant='outline' size='sm'>
                  <RotateCcw className='mr-1.5 h-3.5 w-3.5' />
                  Try Again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )
    }

    // Human-readable label for the active status filter chip.
    const statusFilterLabel =
      MANUAL_COUNTS_STATUS_FILTER_OPTIONS.find(
        (o) => o.value === columnFilters.status
      )?.label ?? columnFilters.status

    const priorityFilterLabel =
      columnFilters.priority.charAt(0).toUpperCase() +
      columnFilters.priority.slice(1)

    const showCardFilterBar =
      (columnFilters.status && columnFilters.status !== 'all') ||
      (columnFilters.priority && columnFilters.priority !== 'all')

    return (
      <div className='space-y-3' ref={componentRef}>
        {StatisticsCards}

        {/* Active card-filter strip — connects clickable cards to the table */}
        {showCardFilterBar && (
          <div className='border-border/50 bg-muted/30 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 backdrop-blur-sm'>
            <span className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
              Filtering table by
            </span>
            {columnFilters.status && columnFilters.status !== 'all' && (
              <button
                type='button'
                onClick={() => toggleStatusFilter(columnFilters.status)}
                className='inline-flex items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] font-semibold text-orange-700 transition-colors hover:bg-orange-500/15 dark:text-orange-400'
                title='Clear status filter'
              >
                <span className='text-muted-foreground/80 text-[10px] font-normal tracking-wider uppercase'>
                  Status:
                </span>
                {statusFilterLabel}
                <span className='text-muted-foreground/70 ml-0.5 text-[12px] leading-none'>
                  ×
                </span>
              </button>
            )}
            {columnFilters.priority && columnFilters.priority !== 'all' && (
              <button
                type='button'
                onClick={() => togglePriorityFilter(columnFilters.priority)}
                className='inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-500/15 dark:text-red-400'
                title='Clear priority filter'
              >
                <span className='text-muted-foreground/80 text-[10px] font-normal tracking-wider uppercase'>
                  Priority:
                </span>
                {priorityFilterLabel}
                <span className='text-muted-foreground/70 ml-0.5 text-[12px] leading-none'>
                  ×
                </span>
              </button>
            )}
            <span className='text-muted-foreground/70 text-[11px] tabular-nums'>
              · {finalFilteredData.length} of {filteredData.length} rows
            </span>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={clearStatusAndPriorityFilters}
              className='text-muted-foreground hover:text-foreground ml-auto h-6 px-2 text-[11px]'
            >
              Clear all
            </Button>
          </div>
        )}

        {showOperatorStatus && <LiveOperatorStatus />}

        {selectedCountIds.size > 0 && (
          <WorkDistributionPanel
            selectedCounts={selectedCounts}
            onPushComplete={() => {
              setSelectedCountIds(new Set())
              setSelectAll(false)
              refreshData()
            }}
          />
        )}

        <Card className='border-border/50 bg-card/50 w-full overflow-hidden backdrop-blur-sm'>
          <CardHeader className='border-border/50 border-b px-4 py-3'>
            <div className='flex flex-col gap-3'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-slate-500/10 dark:bg-slate-400/10'>
                    <Scan className='h-4 w-4 text-slate-600 dark:text-slate-400' />
                  </div>
                  <div>
                    <h2 className='text-foreground text-base leading-tight font-semibold'>
                      Inventory Counts
                    </h2>
                    <p className='text-muted-foreground text-[11px] tabular-nums'>
                      {sortedData.length} records
                    </p>
                  </div>
                </div>

                <div className='flex items-center gap-2'>
                  {activeZones.length > 0 && (
                    <div className='hidden items-center gap-1.5 md:flex'>
                      <Lock className='text-muted-foreground h-3 w-3' />
                      <span className='text-muted-foreground text-[11px] font-medium'>
                        Active zones:
                      </span>
                      <div className='flex items-center gap-1'>
                        {activeZones.slice(0, 6).map((z) => (
                          <span
                            key={`${z.zone}-${z.locked_by}`}
                            className='inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400'
                            title={`${z.locked_by_name || z.locked_by_email || 'Counter'} is working ${z.active_count_count} count${z.active_count_count === 1 ? '' : 's'} in zone ${z.zone} (online)`}
                          >
                            {z.zone}
                            <span className='text-muted-foreground text-[9px] font-normal'>
                              {z.locked_by_name?.split(' ')[0] ?? 'active'}
                            </span>
                          </span>
                        ))}
                        {activeZones.length > 6 && (
                          <span className='text-muted-foreground text-[10px]'>
                            +{activeZones.length - 6}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {stuckZones.length > 0 && (
                    <button
                      type='button'
                      disabled={isReleasing}
                      onClick={() => {
                        void releaseAllStuck(10)
                      }}
                      title='Assignments held by operators whose last heartbeat is > 10 minutes old. Click to release them back to the queue.'
                      className='hidden items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-700 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60 md:flex dark:text-amber-400'
                    >
                      <AlertTriangle className='h-3 w-3' />
                      <span className='text-[11px] font-semibold'>
                        {stuckZones.length} stuck
                      </span>
                      <span className='text-muted-foreground text-[10px]'>
                        release
                      </span>
                    </button>
                  )}
                  {selectedCountIds.size > 0 && (
                    <span className='inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'>
                      <CheckCircle className='h-3 w-3' />
                      {selectedCountIds.size} selected
                    </span>
                  )}
                </div>
              </div>

              <div className='flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center'>
                <div className='flex max-w-sm min-w-[200px] flex-1 items-center gap-2'>
                  <div className='relative flex-1'>
                    <Search className='text-muted-foreground/50 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                    <Input
                      placeholder='Search by part #, scanned part, serial, location, zone, counter, notes, qty…'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className='bg-muted/30 border-border/50 focus-visible:bg-background placeholder:text-muted-foreground/50 focus-visible:ring-ring h-9 rounded-lg pr-10 pl-9 text-sm focus-visible:ring-1'
                      title='Searches across material numbers, scanned part numbers (part verification), serial numbers, locations, zones, counters, notes, and exact quantity matches.'
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className='text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors'
                      >
                        <svg
                          className='h-3.5 w-3.5'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M6 18L18 6M6 6l12 12'
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                  {hasActiveColumnFilters && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='text-muted-foreground hover:text-foreground h-8 shrink-0 px-2 text-xs'
                      onClick={clearColumnFilters}
                    >
                      Clear filters
                    </Button>
                  )}
                  <DeferredByFilter
                    open={deferByDropdownOpen}
                    onOpenChange={setDeferByDropdownOpen}
                    users={distinctDeferUsers}
                    isLoading={deferUsersLoading}
                    selectedUserIds={columnFilters.deferredByUserIds}
                    includeCleared={columnFilters.includeClearedDefers}
                    onChange={(next) =>
                      setColumnFilters((f) => ({
                        ...f,
                        deferredByUserIds: next,
                      }))
                    }
                    onIncludeClearedChange={(next) =>
                      setColumnFilters((f) => ({
                        ...f,
                        includeClearedDefers: next,
                      }))
                    }
                  />
                </div>

                <div className='flex flex-wrap items-center gap-1.5'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setShowOperatorStatus(!showOperatorStatus)}
                    className={cn(
                      'h-8 rounded-lg px-2.5 text-xs',
                      showOperatorStatus
                        ? 'bg-blue-500/10 text-blue-700 hover:bg-blue-500/15 dark:text-blue-400'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Users className='mr-1.5 h-3.5 w-3.5' />
                    Operators
                  </Button>

                  <div className='bg-border/50 mx-0.5 hidden h-5 w-px sm:block' />

                  <Button
                    size='sm'
                    onClick={() => setLx03ModalOpen(true)}
                    className='h-8 rounded-lg px-3 text-xs shadow-sm'
                  >
                    <Plus className='mr-1.5 h-3.5 w-3.5' />
                    Add Counts
                  </Button>

                  <Button
                    variant={pullNextPreview ? 'secondary' : 'outline'}
                    size='sm'
                    onClick={() => setPullNextPreview((v) => !v)}
                    className='border-border/50 h-8 rounded-lg px-2.5 text-xs'
                    title='Sort the table the way the Rust claim_next_cycle_count Phase 2 ranker would — priority first, then unresolved, then resolved zone/aisle/sequence, then location.'
                  >
                    <Target className='mr-1.5 h-3.5 w-3.5' />
                    {pullNextPreview
                      ? 'Pull Next preview · ON'
                      : 'Pull Next preview'}
                  </Button>

                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleExportData}
                    className='border-border/50 h-8 rounded-lg px-2.5 text-xs'
                  >
                    <Download className='mr-1.5 h-3.5 w-3.5' />
                    Export
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='outline'
                        size='sm'
                        className='border-border/50 h-8 rounded-lg px-2 text-xs'
                      >
                        <MoreHorizontal className='h-3.5 w-3.5' />
                        <ChevronDown className='ml-1 h-3 w-3 opacity-50' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end' className='w-52'>
                      <DropdownMenuItem
                        onClick={() => setImportCountTypeOpen(true)}
                        disabled={isImporting}
                        className='cursor-pointer text-xs'
                      >
                        {isImporting ? (
                          <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                        ) : (
                          <Upload className='mr-2 h-3.5 w-3.5' />
                        )}
                        Import Bulk Counts
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={handleMassAssignment}
                        disabled={selectedCountIds.size === 0}
                        className={cn(
                          'cursor-pointer text-xs',
                          selectedCountIds.size === 0 && 'opacity-50'
                        )}
                      >
                        <Users className='mr-2 h-3.5 w-3.5' />
                        Assign Selected
                        {selectedCountIds.size > 0 && (
                          <span className='ml-auto rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400'>
                            {selectedCountIds.size}
                          </span>
                        )}
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={handleMassDelete}
                        disabled={selectedCountIds.size === 0}
                        className={cn(
                          'cursor-pointer text-xs text-red-600 dark:text-red-400',
                          selectedCountIds.size === 0 && 'opacity-50'
                        )}
                      >
                        <Trash2 className='mr-2 h-3.5 w-3.5' />
                        Delete Selected
                        {selectedCountIds.size > 0 && (
                          <span className='ml-auto rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium'>
                            {selectedCountIds.size}
                          </span>
                        )}
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={handleCleanupAbandoned}
                        className='cursor-pointer text-xs'
                      >
                        <Clock className='mr-2 h-3.5 w-3.5' />
                        Cleanup Abandoned
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={refreshData}
                        className='cursor-pointer text-xs'
                      >
                        <RotateCcw className='mr-2 h-3.5 w-3.5' />
                        Refresh Data
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className='p-0'>
            {filteredData.length === 0 ? (
              <div className='py-14 text-center'>
                <div className='bg-muted/50 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full'>
                  {searchQuery ? (
                    <Search className='text-muted-foreground/60 h-7 w-7' />
                  ) : (
                    <FileText className='text-muted-foreground/60 h-7 w-7' />
                  )}
                </div>
                <h3 className='text-foreground mb-1.5 text-base font-semibold'>
                  {searchQuery ? 'No Results Found' : 'No Count Data'}
                </h3>
                <p className='text-muted-foreground mx-auto mb-5 max-w-xs text-sm'>
                  {searchQuery
                    ? `No cycle counts match "${searchQuery}". Try adjusting your search terms.`
                    : 'No cycle counts have been recorded yet. Start by adding counts from an LX03 report.'}
                </p>
                <div className='flex items-center justify-center'>
                  {searchQuery ? (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setSearchQuery('')}
                    >
                      Clear Search
                    </Button>
                  ) : (
                    <Button size='sm' onClick={() => setLx03ModalOpen(true)}>
                      <Plus className='mr-1.5 h-3.5 w-3.5' />
                      Add First Count
                    </Button>
                  )}
                </div>
              </div>
            ) : finalFilteredData.length === 0 ? (
              <div className='py-14 text-center'>
                <div className='bg-muted/50 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full'>
                  <Search className='text-muted-foreground/60 h-7 w-7' />
                </div>
                <h3 className='text-foreground mb-1.5 text-base font-semibold'>
                  No rows match column filters
                </h3>
                <p className='text-muted-foreground mx-auto mb-5 max-w-xs text-sm'>
                  Try loosening or clearing column filters.
                </p>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={clearColumnFilters}
                >
                  Clear column filters
                </Button>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader className='bg-background sticky top-0 z-10'>
                    <TableRow className='border-border/50 bg-muted/40 hover:bg-muted/40 border-b'>
                      <TableHead className='w-10 py-2.5 pl-4'>
                        <Checkbox
                          checked={selectAll}
                          onCheckedChange={handleSelectAll}
                          aria-label='Select all counts'
                        />
                      </TableHead>
                      <TableHead className='text-muted-foreground w-[120px] py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Count #
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Count Type
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Priority
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Location
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Material
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-right text-[11px] font-semibold tracking-wider uppercase'>
                        System Qty
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-right text-[11px] font-semibold tracking-wider uppercase'>
                        Counted Qty
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-right text-[11px] font-semibold tracking-wider uppercase'>
                        Variance
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Part Check
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Status
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Counter
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Count Date
                      </TableHead>
                      <TableHead className='text-muted-foreground py-2.5 text-[11px] font-semibold tracking-wider uppercase'>
                        Assigned To
                      </TableHead>
                      <TableHead className='text-muted-foreground w-12 py-2.5 pr-4 text-center text-[11px] font-semibold tracking-wider uppercase'></TableHead>
                    </TableRow>
                    <TableRow className='border-border/30 bg-muted/20 hover:bg-muted/20 border-b'>
                      <TableHead className='p-1.5 pl-4' />
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by count number'
                          placeholder='Filter...'
                          value={columnFilters.countNumber}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              countNumber: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by count type'
                          placeholder='Filter...'
                          value={columnFilters.countType}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              countType: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 min-w-[100px] rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Select
                          value={columnFilters.priority}
                          onValueChange={(v) =>
                            setColumnFilters((f) => ({ ...f, priority: v }))
                          }
                        >
                          <SelectTrigger
                            aria-label='Filter by priority'
                            className='bg-background/50 border-border/30 h-7 w-full rounded-md text-[11px]'
                          >
                            <SelectValue placeholder='All' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='all'>All</SelectItem>
                            <SelectItem value='critical'>Critical</SelectItem>
                            <SelectItem value='hot'>Hot</SelectItem>
                            <SelectItem value='normal'>Normal</SelectItem>
                            <SelectItem value='low'>Low</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by location'
                          placeholder='Filter...'
                          value={columnFilters.location}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              location: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by material'
                          placeholder='Filter...'
                          value={columnFilters.material}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              material: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by system quantity'
                          placeholder='Filter...'
                          value={columnFilters.systemQty}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              systemQty: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 w-full min-w-[60px] rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by counted quantity'
                          placeholder='Filter...'
                          value={columnFilters.countedQty}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              countedQty: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 w-full min-w-[60px] rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by variance'
                          placeholder='Filter...'
                          value={columnFilters.variance}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              variance: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 w-full min-w-[56px] rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Select
                          value={columnFilters.partCheck ?? 'all'}
                          onValueChange={(v) =>
                            setColumnFilters((f) => ({
                              ...f,
                              partCheck: v as typeof columnFilters.partCheck,
                            }))
                          }
                        >
                          <SelectTrigger
                            aria-label='Filter by part check'
                            className='bg-background/50 border-border/30 h-7 w-full rounded-md text-[11px]'
                          >
                            <SelectValue placeholder='All' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='all'>All</SelectItem>
                            <SelectItem value='match'>Match</SelectItem>
                            <SelectItem value='variance'>
                              Part Variance
                            </SelectItem>
                            <SelectItem value='empty'>
                              Location Empty
                            </SelectItem>
                            <SelectItem value='unverified'>
                              Not Verified
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Select
                          value={columnFilters.status}
                          onValueChange={(v) =>
                            setColumnFilters((f) => ({ ...f, status: v }))
                          }
                        >
                          <SelectTrigger
                            aria-label='Filter by status'
                            className='bg-background/50 border-border/30 h-7 w-full rounded-md text-[11px]'
                          >
                            <SelectValue placeholder='All' />
                          </SelectTrigger>
                          <SelectContent>
                            {MANUAL_COUNTS_STATUS_FILTER_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by counter'
                          placeholder='Filter...'
                          value={columnFilters.counter}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              counter: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 min-w-[80px] rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by count date'
                          placeholder='Filter...'
                          value={columnFilters.countDate}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              countDate: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 min-w-[80px] rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5'>
                        <Input
                          aria-label='Filter by assigned user'
                          placeholder='Filter...'
                          value={columnFilters.assignedTo}
                          onChange={(e) =>
                            setColumnFilters((f) => ({
                              ...f,
                              assignedTo: e.target.value,
                            }))
                          }
                          className='bg-background/50 border-border/30 placeholder:text-muted-foreground/40 h-7 min-w-[80px] rounded-md text-[11px] focus-visible:ring-1'
                        />
                      </TableHead>
                      <TableHead className='p-1.5 pr-4' />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedData.map((item, index) => (
                      <TableRow
                        key={item.id}
                        className={cn(
                          'border-border/30 transition-colors duration-100',
                          'hover:bg-muted/40',
                          selectedCountIds.has(item.id)
                            ? 'bg-blue-500/5 hover:bg-blue-500/8 dark:bg-blue-500/5 dark:hover:bg-blue-500/8'
                            : index % 2 === 1
                              ? 'bg-muted/15'
                              : ''
                        )}
                      >
                        <TableCell className='py-2.5 pl-4'>
                          <Checkbox
                            checked={selectedCountIds.has(item.id)}
                            onCheckedChange={() => handleRowToggle(item.id)}
                            aria-label={`Select ${item.count_number}`}
                          />
                        </TableCell>
                        <TableCell className='py-2.5 font-mono text-xs font-medium'>
                          {item.count_number}
                        </TableCell>
                        <TableCell className='py-2.5'>
                          <span className='text-muted-foreground bg-muted/50 rounded-md px-1.5 py-0.5 text-[11px] font-medium'>
                            {resolveCountTypeLabel(
                              item.count_type,
                              countTypeOptions
                            ) || 'Quantity Check'}
                          </span>
                        </TableCell>
                        <TableCell className='py-2.5'>
                          <div className='flex items-center gap-1.5'>
                            <span
                              className={cn(
                                'h-2 w-2 shrink-0 rounded-full',
                                item.priority === 'critical' &&
                                  'animate-pulse bg-red-500',
                                item.priority === 'hot' && 'bg-orange-500',
                                item.priority === 'normal' && 'bg-blue-500',
                                item.priority === 'low' && 'bg-gray-400',
                                !item.priority && 'bg-blue-500'
                              )}
                            />
                            <span
                              className={cn(
                                'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                                CycleCountService.getPriorityColor(
                                  (item.priority as CycleCountPriority) ||
                                    'normal'
                                )
                              )}
                            >
                              {CycleCountService.getPriorityLabel(
                                (item.priority as CycleCountPriority) ||
                                  'normal'
                              )}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className='py-2.5 font-mono text-xs'>
                          {item.count_type === 'found_part_transfer' &&
                          item.transfer_destination_location ? (
                            <div className='flex items-center gap-1'>
                              <span>{item.location}</span>
                              <ArrowRight className='text-muted-foreground h-3 w-3 shrink-0' />
                              <span className='text-emerald-700 dark:text-emerald-400'>
                                {item.transfer_destination_location}
                              </span>
                            </div>
                          ) : (
                            item.location
                          )}
                        </TableCell>
                        <TableCell className='py-2.5 text-xs font-medium'>
                          {item.material_number}
                        </TableCell>
                        <TableCell className='py-2.5 text-right text-xs tabular-nums'>
                          <span className='font-medium'>
                            {item.system_quantity}
                          </span>
                          <span className='text-muted-foreground/60 ml-0.5 text-[10px]'>
                            {item.unit_of_measure}
                          </span>
                        </TableCell>
                        <TableCell className='py-2.5 text-right text-xs tabular-nums'>
                          {item.counted_quantity != null ? (
                            <>
                              <span className='font-medium'>
                                {item.counted_quantity}
                              </span>
                              <span className='text-muted-foreground/60 ml-0.5 text-[10px]'>
                                {item.unit_of_measure}
                              </span>
                            </>
                          ) : (
                            <span className='text-muted-foreground/50 text-[11px] italic'>
                              Not Counted
                            </span>
                          )}
                        </TableCell>
                        <TableCell className='py-2.5 text-right tabular-nums'>
                          {item.count_type === 'found_part_transfer' ? (
                            // Variance is meaningless for transfers —
                            // counted_quantity (at B) and
                            // system_quantity (at A) are different
                            // locations.
                            <span
                              className='text-muted-foreground/40 text-xs'
                              title='Not applicable for Found Part Transfer counts'
                            >
                              n/a
                            </span>
                          ) : item.variance_quantity != null ? (
                            <span
                              className={cn(
                                'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
                                item.variance_quantity > 0 &&
                                  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                                item.variance_quantity < 0 &&
                                  'bg-red-500/10 text-red-700 dark:text-red-400',
                                item.variance_quantity === 0 &&
                                  'text-muted-foreground bg-muted/50'
                              )}
                            >
                              {item.variance_quantity > 0 ? '+' : ''}
                              {item.variance_quantity}
                            </span>
                          ) : (
                            <span className='text-muted-foreground/40 text-xs'>
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className='py-2.5'>
                          <PartCheckBadge item={item} />
                        </TableCell>
                        <TableCell className='py-2.5'>
                          <div className='flex flex-col items-start gap-0.5'>
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium capitalize',
                                getStatusColor(item.status || '')
                              )}
                            >
                              {item.status === 'in_progress' && (
                                <Clock className='h-3 w-3' />
                              )}
                              {item.status === 'completed' && (
                                <CheckCircle className='h-3 w-3' />
                              )}
                              {item.status === 'variance_review' && (
                                <AlertTriangle className='h-3 w-3' />
                              )}
                              {item.status === 'pending' && (
                                <Clock className='h-3 w-3' />
                              )}
                              {item.status?.replace(/_/g, ' ')}
                            </span>
                            {/* "Skipped" is a per-user skip marker
                                    (stored in the underlying
                                    `cycle_count_operator_deferred_counts`
                                    table, but surfaced as "Skipped" in the
                                    UI). Only meaningful when the row is
                                    currently assigned. Click/hover opens a
                                    Popover with full per-operator history
                                    (migration 269 view). */}
                            {!!item.assigned_to &&
                              item.active_defer?.some(
                                (defer) => defer.is_active
                              ) && (
                                <SkippedBadgePopover
                                  countId={item.id}
                                  countNumber={item.count_number}
                                  onViewAll={() => handleOpenEditModal(item)}
                                />
                              )}
                          </div>
                        </TableCell>
                        <TableCell className='text-muted-foreground py-2.5 text-xs'>
                          <div className='flex flex-col items-start gap-0.5'>
                            {item.counter_name || (
                              <span className='opacity-40'>—</span>
                            )}
                            {/* "Reassigned" is context for the *current*
                                    assignee. Once the row is unassigned
                                    it's back in the open pool and the
                                    historical reassignment badge just adds
                                    noise. */}
                            {!!item.assigned_to &&
                              ((item as any).reassignment_count ?? 0) > 0 && (
                                <span className='inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'>
                                  <RefreshCw className='h-2.5 w-2.5' />
                                  Reassigned
                                  {((item as any).reassignment_count ?? 0) > 1
                                    ? ` x${(item as any).reassignment_count}`
                                    : ''}
                                </span>
                              )}
                          </div>
                        </TableCell>
                        <TableCell className='text-muted-foreground py-2.5 text-xs tabular-nums'>
                          {formatDateEST(item.count_date)}
                        </TableCell>
                        <TableCell className='py-2.5'>
                          {item.assigned_to_user ? (
                            <div className='flex flex-col items-start gap-0.5'>
                              <div className='flex items-center gap-1.5'>
                                <div className='flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/10'>
                                  <User className='h-3 w-3 text-blue-600 dark:text-blue-400' />
                                </div>
                                <span className='max-w-[110px] truncate text-xs font-medium text-blue-700 dark:text-blue-400'>
                                  {item.assigned_to_user.full_name}
                                </span>
                              </div>
                              {item.active_defer?.find(
                                (defer) => defer.is_active
                              ) && (
                                <span className='pl-6'>
                                  <SkippedBadgePopover
                                    countId={item.id}
                                    countNumber={item.count_number}
                                    variant='subtle'
                                    onViewAll={() => handleOpenEditModal(item)}
                                  />
                                </span>
                              )}
                            </div>
                          ) : (
                            (() => {
                              // Migration 252 review: when assigned_to is
                              // NULL but the row has an active defer
                              // record, show "Deferred (was X)" rather
                              // than "Unassigned" — a skip is not the
                              // same as a hard unassign and the prior
                              // assignee is meaningful context.
                              const lastDefer = item.active_defer?.find(
                                (defer) => defer.is_active
                              )
                              const lastAssignmentName =
                                ((item as Record<string, unknown>)
                                  .last_assignment_name as string | null) ??
                                ((item as Record<string, unknown>)
                                  .counter_name as string | null) ??
                                null
                              if (lastDefer) {
                                return (
                                  <div className='flex items-center gap-1.5'>
                                    <Badge
                                      variant='outline'
                                      className='gap-1 border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                                    >
                                      <RotateCcw className='h-2.5 w-2.5' />
                                      Deferred
                                      {lastAssignmentName
                                        ? ` (was ${lastAssignmentName})`
                                        : ''}
                                    </Badge>
                                  </div>
                                )
                              }
                              return (
                                <div className='text-muted-foreground/50 flex items-center gap-1.5'>
                                  <div className='bg-muted/50 flex h-5 w-5 shrink-0 items-center justify-center rounded-full'>
                                    <UserMinus className='h-3 w-3' />
                                  </div>
                                  <span className='text-xs'>Unassigned</span>
                                </div>
                              )
                            })()
                          )}
                        </TableCell>
                        <TableCell className='py-2.5 pr-4 text-center'>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant='ghost'
                                size='sm'
                                className='h-7 w-7 rounded-md p-0 opacity-60 hover:opacity-100'
                              >
                                <MoreHorizontal className='h-3.5 w-3.5' />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end' className='w-48'>
                              <DropdownMenuItem
                                onClick={() => handleOpenEditModal(item)}
                                className='cursor-pointer text-xs'
                              >
                                <Edit3 className='mr-2 h-3.5 w-3.5' />
                                View / Edit
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              {item.assigned_to ? (
                                <>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleOpenAssignmentModal(item)
                                    }
                                    className='cursor-pointer text-xs'
                                  >
                                    <UserCheck className='mr-2 h-3.5 w-3.5' />
                                    Reassign
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleUnassignCount(item.id)}
                                    className='cursor-pointer text-xs'
                                  >
                                    <UserMinus className='mr-2 h-3.5 w-3.5' />
                                    Unassign
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleOpenAssignmentModal(item)
                                  }
                                  className='cursor-pointer text-xs'
                                >
                                  <User className='mr-2 h-3.5 w-3.5' />
                                  Assign
                                </DropdownMenuItem>
                              )}

                              <DropdownMenuSeparator />

                              <DropdownMenuItem
                                onClick={() =>
                                  handleUpdatePriority(item.id, 'critical')
                                }
                                className='cursor-pointer text-xs'
                              >
                                <span className='mr-2 h-2 w-2 rounded-full bg-red-500' />
                                Set Critical
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleUpdatePriority(item.id, 'hot')
                                }
                                className='cursor-pointer text-xs'
                              >
                                <span className='mr-2 h-2 w-2 rounded-full bg-orange-500' />
                                Set Hot
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleUpdatePriority(item.id, 'normal')
                                }
                                className='cursor-pointer text-xs'
                              >
                                <span className='mr-2 h-2 w-2 rounded-full bg-blue-500' />
                                Set Normal
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleUpdatePriority(item.id, 'low')
                                }
                                className='cursor-pointer text-xs'
                              >
                                <span className='mr-2 h-2 w-2 rounded-full bg-gray-400' />
                                Set Low
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              {item.requires_recount &&
                                !item.recount_completed && (
                                  <DropdownMenuItem
                                    className='cursor-pointer text-xs'
                                    onClick={() => {
                                      setRecountQty('')
                                      setRecountTarget({
                                        id: item.id,
                                        countNumber: item.count_number,
                                      })
                                    }}
                                  >
                                    <RotateCcw className='mr-2 h-3.5 w-3.5' />
                                    Complete Recount
                                  </DropdownMenuItem>
                                )}
                              {item.status === 'variance_review' && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleApproveCount(
                                      item.id,
                                      item.count_number,
                                      item.updated_at ?? null
                                    )
                                  }
                                  className='cursor-pointer text-xs text-emerald-700 dark:text-emerald-400'
                                >
                                  <Check className='mr-2 h-3.5 w-3.5' />
                                  Approve Variance
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {totalPages > 1 && (
                  <div className='border-border/30 flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row'>
                    <p className='text-muted-foreground text-xs tabular-nums'>
                      <span className='text-foreground font-medium'>
                        {(currentPage - 1) * recordsPerPage + 1}
                      </span>
                      {' - '}
                      <span className='text-foreground font-medium'>
                        {Math.min(
                          currentPage * recordsPerPage,
                          sortedData.length
                        )}
                      </span>
                      {' of '}
                      <span className='text-foreground font-medium'>
                        {sortedData.length}
                      </span>
                    </p>

                    <div className='flex items-center gap-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() =>
                          setCurrentPage(Math.max(1, currentPage - 1))
                        }
                        disabled={currentPage === 1}
                        className='h-7 w-7 rounded-md p-0 disabled:opacity-30'
                      >
                        <ChevronLeft className='h-3.5 w-3.5' />
                      </Button>

                      <div className='flex items-center gap-0.5'>
                        {totalPages > 5 && currentPage > 3 && (
                          <>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => setCurrentPage(1)}
                              className='h-7 w-7 rounded-md p-0 text-xs'
                            >
                              1
                            </Button>
                            {currentPage > 4 && (
                              <span className='text-muted-foreground/50 px-1 text-xs'>
                                ...
                              </span>
                            )}
                          </>
                        )}

                        {Array.from(
                          { length: Math.min(5, totalPages) },
                          (_, i) => {
                            let pageNum = i + 1
                            if (totalPages > 5) {
                              if (
                                currentPage > 3 &&
                                currentPage < totalPages - 2
                              ) {
                                pageNum = currentPage - 2 + i
                              } else if (currentPage >= totalPages - 2) {
                                pageNum = totalPages - 4 + i
                              }
                            }

                            return (
                              <Button
                                key={pageNum}
                                variant='ghost'
                                size='sm'
                                onClick={() => setCurrentPage(pageNum)}
                                className={cn(
                                  'h-7 w-7 rounded-md p-0 text-xs tabular-nums transition-colors',
                                  currentPage === pageNum
                                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                )}
                              >
                                {pageNum}
                              </Button>
                            )
                          }
                        )}

                        {totalPages > 5 && currentPage < totalPages - 2 && (
                          <>
                            {currentPage < totalPages - 3 && (
                              <span className='text-muted-foreground/50 px-1 text-xs'>
                                ...
                              </span>
                            )}
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => setCurrentPage(totalPages)}
                              className='h-7 w-7 rounded-md p-0 text-xs'
                            >
                              {totalPages}
                            </Button>
                          </>
                        )}
                      </div>

                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() =>
                          setCurrentPage(Math.min(totalPages, currentPage + 1))
                        }
                        disabled={currentPage === totalPages}
                        className='h-7 w-7 rounded-md p-0 disabled:opacity-30'
                      >
                        <ChevronRight className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Add Counts from LX03 Modal */}
        <AddCountsFromLX03Modal
          isOpen={lx03ModalOpen}
          onClose={() => setLx03ModalOpen(false)}
          onSubmit={handleAddCountsFromLX03}
        />

        {/* Edit Count Modal */}
        <EditCountModal
          isOpen={editCountModalOpen}
          onClose={() => {
            setEditCountModalOpen(false)
            setSelectedCountForEdit(null)
          }}
          countData={selectedCountForEdit}
          onInitiateRecount={handleInitiateRecount}
          onApprove={handleApproveCount}
        />

        {/* User Assignment Modal */}
        <UserAssignmentModal
          isOpen={assignmentModalOpen}
          onClose={() => {
            setAssignmentModalOpen(false)
            setSelectedCount(null)
          }}
          onAssign={
            selectedCountIds.size > 1
              ? handleMassAssignConfirm
              : handleAssignCount
          }
          currentAssignee={
            selectedCount?.assigned_to_user as
              | { id: string; full_name: string; email: string }
              | undefined
          }
          countInfo={
            selectedCount
              ? {
                  id: selectedCount.id,
                  count_number:
                    selectedCountIds.size > 1
                      ? `${selectedCountIds.size} Selected Counts`
                      : selectedCount.count_number,
                  material_number:
                    selectedCountIds.size > 1
                      ? 'Multiple Items'
                      : selectedCount.material_number,
                  location:
                    selectedCountIds.size > 1
                      ? 'Multiple Locations'
                      : selectedCount.location,
                  priority: (selectedCount.priority ||
                    'normal') as CycleCountPriority,
                }
              : undefined
          }
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title='Delete Cycle Counts'
          description='Are you sure you want to delete the selected count(s)?'
          message={`You are about to delete ${selectedCountIds.size} cycle count(s). This action cannot be undone.`}
          variant='danger'
          confirmText='Delete'
          cancelText='Cancel'
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
          details={[
            `${selectedCountIds.size} count(s) will be permanently deleted`,
            'This will remove them from the database',
            'Audit logs will still contain the history',
          ]}
        />

        {/* Phase 7.7 — Recount Completion Dialog (replaces blocking prompt()) */}
        <Dialog
          open={recountTarget !== null}
          onOpenChange={(open) => {
            if (!open) setRecountTarget(null)
          }}
        >
          <DialogContent className='max-w-sm'>
            <DialogHeader>
              <DialogTitle>
                Complete Recount {recountTarget?.countNumber}
              </DialogTitle>
            </DialogHeader>
            <div className='space-y-3'>
              <label className='block space-y-1'>
                <span className='text-muted-foreground text-xs'>
                  Enter new counted quantity
                </span>
                <Input
                  type='number'
                  value={recountQty}
                  onChange={(e) => setRecountQty(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = Number(recountQty)
                      if (!recountTarget) return
                      if (!Number.isFinite(n)) {
                        toast.error('Enter a valid number')
                        return
                      }
                      completeRecount(
                        recountTarget.id,
                        n,
                        authState.profile?.full_name ||
                          authState.user?.email ||
                          'Unknown'
                      )
                      setRecountTarget(null)
                    }
                  }}
                />
              </label>
              <div className='flex justify-end gap-2'>
                <Button
                  variant='outline'
                  onClick={() => setRecountTarget(null)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const n = Number(recountQty)
                    if (!recountTarget) return
                    if (!Number.isFinite(n)) {
                      toast.error('Enter a valid number')
                      return
                    }
                    completeRecount(
                      recountTarget.id,
                      n,
                      authState.profile?.full_name ||
                        authState.user?.email ||
                        'Unknown'
                    )
                    setRecountTarget(null)
                  }}
                >
                  Save Recount
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Bulk Import Count Type Prompt */}
        <Dialog
          open={importCountTypeOpen}
          onOpenChange={setImportCountTypeOpen}
        >
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle className='flex items-center gap-2'>
                <Upload className='h-5 w-5' />
                Import Bulk Counts
              </DialogTitle>
            </DialogHeader>
            <div className='space-y-4 py-2'>
              <p className='text-muted-foreground text-sm'>
                Select the count type to apply to all imported rows. If a row in
                your clipboard data already has a count type column, that value
                will be used instead.
              </p>
              <div className='space-y-2'>
                <Label
                  htmlFor='import-count-type'
                  className='text-sm font-medium'
                >
                  Count Type
                </Label>
                <Select
                  value={importCountType}
                  onValueChange={setImportCountType}
                >
                  <SelectTrigger id='import-count-type'>
                    <SelectValue placeholder='Select count type' />
                  </SelectTrigger>
                  <SelectContent>
                    {countTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className='flex justify-end gap-2 pt-2'>
              <Button
                variant='outline'
                onClick={() => setImportCountTypeOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setImportCountTypeOpen(false)
                  importFromClipboard(importCountType)
                }}
              >
                <Upload className='mr-2 h-4 w-4' />
                Import from Clipboard
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Bulk import progress (driven by useCycleCountOperations) —
            opens automatically as soon as importFromClipboard kicks off
            and is non-dismissable until the row-by-row insert loop in
            cycleCountService.importFromClipboard finishes. */}
        <CycleCountImportProgressDialog
          isOpen={importProgress != null && !importProgressDismissed}
          progress={importProgress}
          onClose={() => setImportProgressDismissed(true)}
        />
      </div>
    )
  }
)

ManualCountsSearch.displayName = 'ManualCountsSearch'

export default ManualCountsSearch

// Created and developed by Jai Singh
