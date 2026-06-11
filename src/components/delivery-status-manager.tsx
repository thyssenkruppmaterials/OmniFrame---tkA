// Created and developed by Jai Singh
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Download,
  Eye,
  FileText,
  Filter,
  FilterX,
  Loader2,
  MoreHorizontal,
  Package,
  Search,
  Settings,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { DeliveryStatusData } from '@/lib/supabase/delivery-status.service'
import { deliveryStatusService } from '@/lib/supabase/delivery-status.service'
import type { AdvancedFilterConfig } from '@/lib/types/advanced-filter.types'
import { cn } from '@/lib/utils'
import {
  applyAdvancedFilters,
  createEmptyFilterConfig,
  countActiveFilters,
} from '@/lib/utils/advanced-filter.utils'
import { logger } from '@/lib/utils/logger'
import { useDeliveryStatus } from '@/hooks/use-delivery-status'
// import { DeliveryStatusFilterDialog } from '@/components/ui/delivery-status-filter-dialog'; // Replaced with AdvancedDeliveryFilterDialog (November 9, 2025)
import { AdvancedDeliveryFilterDialog } from '@/components/ui/advanced-delivery-filter-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DispositionEditorDialog } from '@/components/ui/disposition-editor-dialog'
import { DispositionSelect } from '@/components/ui/disposition-select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ImportConfirmDialog } from '@/components/ui/import-confirm-dialog'
import { ImportProgressDialog } from '@/components/ui/import-progress-dialog'
import { Input } from '@/components/ui/input'
import { KpiGrid } from '@/components/ui/kpi-grid'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { StatTile } from '@/components/ui/stat-tile'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Rust-powered search input with rotating light beam border effect
const RustPoweredSearchInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { isRustEnabled?: boolean }
>(({ className, isRustEnabled, ...props }, ref) => {
  if (!isRustEnabled) {
    return (
      <Input
        ref={ref}
        className={cn('bg-background border-border pl-10', className)}
        {...props}
      />
    )
  }

  return (
    <div className='relative'>
      {/* Outer container for the rotating gradient - sized larger than input */}
      <div className='absolute -inset-[1px] overflow-hidden rounded-md'>
        {/* Spinning gradient layer - needs to be large enough to cover corners when rotating */}
        <div
          className='absolute top-1/2 left-1/2 h-[200%] w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_3s_linear_infinite]'
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, transparent 80deg, rgba(59, 130, 246, 0.15) 85deg, rgba(59, 130, 246, 0.4) 88deg, rgba(37, 99, 235, 0.7) 90deg, rgba(59, 130, 246, 0.4) 92deg, rgba(59, 130, 246, 0.15) 95deg, transparent 100deg, transparent 360deg)',
          }}
        />
      </div>
      {/* Inner solid background that masks the center, leaving only the border visible */}
      <div className='bg-background absolute inset-[1px] rounded-[5px]' />
      {/* Actual input - relative to appear above the mask */}
      <Input
        ref={ref}
        className={cn(
          'relative border-transparent bg-transparent pl-10 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0',
          className
        )}
        {...props}
      />
    </div>
  )
})
RustPoweredSearchInput.displayName = 'RustPoweredSearchInput'

interface DeliveryStatusManagerProps {
  enableRealtime?: boolean
}

interface TableColumn {
  id: string
  label: string
  key: keyof DeliveryStatusData
  width?: string
  sortable?: boolean
  filterable?: boolean
}

interface SortConfig {
  key: keyof DeliveryStatusData
  direction: 'asc' | 'desc'
}

interface FilterConfig {
  [key: string]: string | string[]
}

// Default column configuration for delivery status - Reordered as per user request (November 1, 2025)
// Order: Delivery Priority, Delivery, Shipping Point, Customer, Delivery Creation Date, Days Open, Status, Disposition
// Removed: Actual Goods Movement Date, External Identification 1
const DEFAULT_COLUMNS: TableColumn[] = [
  {
    id: 'delivery_priority',
    label: 'Delivery Priority',
    key: 'delivery_priority',
    width: 'w-32',
    sortable: true,
    filterable: true,
  },
  {
    id: 'delivery',
    label: 'Delivery',
    key: 'delivery',
    width: 'w-32',
    sortable: true,
    filterable: true,
  },
  {
    id: 'shipping_point',
    label: 'Shipping Point',
    key: 'shipping_point',
    width: 'w-32',
    sortable: true,
    filterable: true,
  },
  {
    id: 'customer_name',
    label: 'Customer',
    key: 'customer_name',
    width: 'w-48',
    sortable: true,
    filterable: true,
  },
  {
    id: 'delivery_creation_date',
    label: 'Delivery Creation Date',
    key: 'delivery_creation_date',
    width: 'w-36',
    sortable: true,
    filterable: false,
  },
  {
    id: 'days_open',
    label: 'Days Open',
    key: 'days_open',
    width: 'w-24',
    sortable: true,
    filterable: false,
  },
  {
    id: 'status',
    label: 'Status',
    key: 'status',
    width: 'w-28',
    sortable: true,
    filterable: true,
  },
  {
    id: 'dispositions',
    label: 'Disposition',
    key: 'dispositions',
    width: 'w-36',
    sortable: false,
    filterable: false,
  },
]

// Clean table header component with sorting only
function SortableTableHeader({
  column,
  sortConfig,
  onSort,
}: {
  column: TableColumn
  sortConfig: SortConfig | null
  onSort: (key: keyof DeliveryStatusData) => void
}) {
  const isSorted = sortConfig?.key === column.key
  const sortDirection = isSorted ? sortConfig?.direction : null

  return (
    <TableHead className={`text-foreground font-medium ${column.width}`}>
      <div className='flex items-center gap-1'>
        {column.sortable ? (
          <button
            onClick={() => onSort(column.key)}
            className='hover:text-foreground/80 flex items-center gap-1 transition-colors'
          >
            {column.label}
            {isSorted &&
              (sortDirection === 'asc' ? (
                <ChevronUp className='h-3 w-3' />
              ) : (
                <ChevronDown className='h-3 w-3' />
              ))}
          </button>
        ) : (
          <span>{column.label}</span>
        )}
      </div>
    </TableHead>
  )
}

// Status badge component
function StatusBadge({ status }: { status?: string }) {
  const getStatusVariant = (status?: string) => {
    switch (status) {
      case 'pending':
        return 'outline'
      case 'processing':
        return 'secondary'
      case 'picked':
        return 'default'
      case 'picked_short':
        return 'secondary'
      case 'picked_bulk':
        return 'secondary'
      case 'not_in_location':
        return 'destructive'
      case 'completed':
        return 'default'
      case 'cancelled':
        return 'destructive'
      case 'on_hold':
        return 'secondary'
      case 'packed':
        return 'default'
      case 'final_packed':
        return 'default'
      case 'shipped':
        return 'default'
      default:
        return 'outline'
    }
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
      case 'processing':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
      case 'picked':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
      case 'picked_short':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
      case 'picked_bulk':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300'
      case 'not_in_location':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
      case 'packed':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300'
      case 'final_packed':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300'
      case 'shipped':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
      case 'cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  // Enhanced status display names for better user experience
  const getStatusDisplayName = (status?: string) => {
    if (!status) return 'No Status'

    switch (status.toLowerCase()) {
      case 'picked_short':
        return 'Picked Short'
      case 'picked_bulk':
        return 'Picked Bulk'
      case 'not_in_location':
        return 'Not In Location'
      case 'final_packed':
        return 'Final Packed'
      case 'on_hold':
        return 'On Hold'
      default:
        return status.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())
    }
  }

  return (
    <Badge
      variant={getStatusVariant(status)}
      className={`${getStatusColor(status)}`}
    >
      {getStatusDisplayName(status)}
    </Badge>
  )
}

const DeliveryStatusManager: React.FC<DeliveryStatusManagerProps> = React.memo(
  ({ enableRealtime = true }) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [isVisible, setIsVisible] = useState(false)
    const [sortConfig, setSortConfig] = useState<SortConfig>({
      key: 'delivery_creation_date',
      direction: 'asc',
    })
    const [filterConfig, setFilterConfig] = useState<FilterConfig>({})
    const [advancedFilterConfig, setAdvancedFilterConfig] =
      useState<AdvancedFilterConfig>(createEmptyFilterConfig())
    const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
    const [isDispositionEditorOpen, setIsDispositionEditorOpen] =
      useState(false)
    const [showOpenOnly, setShowOpenOnly] = useState(true) // Default to Open Only mode (November 1, 2025)
    const [showJS01Only, setShowJS01Only] = useState(false) // JS01 filter mode (November 5, 2025)
    const [showDeletedOnly, setShowDeletedOnly] = useState(false) // Show Deleted filter mode (November 9, 2025)

    // Stat-card click filter (May 5, 2026) — mirrors the clickable-pill pattern
    // used in the Inventory Counts tab. A single source of truth for which
    // metric pill is currently driving the table filter.
    type CardFilter =
      | { type: 'shippingPoint'; value: 'oe' | 'irna' }
      | { type: 'daysOpen'; value: 'over30' | 'over12' | 'over4' }
      | {
          type: 'tka'
          value: 'liftFan' | 'wawf' | 'placeholder'
        }
      | null
    const [cardFilter, setCardFilter] = useState<CardFilter>(null)
    const [selectedItem, setSelectedItem] = useState<DeliveryStatusData | null>(
      null
    )
    const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 25

    // PGI Date filter state (November 9, 2025)
    const [pgiSelectedDate, setPgiSelectedDate] = useState<Date>(new Date())
    const [pgiCount, setPgiCount] = useState<number>(0)
    const [isPgiCalendarOpen, setIsPgiCalendarOpen] = useState(false)
    const [isLoadingPgi, setIsLoadingPgi] = useState(false)
    const [showImportConfirmDialog, setShowImportConfirmDialog] =
      useState(false)
    const [pendingImportRowCount, setPendingImportRowCount] = useState(0)

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

    const { authState } = useUnifiedAuth()
    const organizationId = authState.profile?.organization_id

    const {
      data,
      isLoading,
      error,
      statistics,
      importFromClipboard,
      refreshData,
      isImporting,
      importProgress,
      searchQuery,
      setSearchQuery,
      isUsingRust,
    } = useDeliveryStatus({
      enableRealtime: shouldEnableRealtime,
      searchQuery: '',
      // `openOnly` is NEVER bypassed by a TKA card filter. Bypassing forces
      // a fetch of the entire org (~98k rows) that truncates at the 10k row
      // limit and makes the Total/OE/IRNA/Days Open card counts shift
      // incorrectly because the cards compute from this main `data` array.
      //
      // Instead, when the LiftFan card is active, the LiftFan rows are
      // pulled in by a *separate* secondary query below
      // (`liftFanRowsQuery`) and merged into the table's data only — the
      // cards keep computing from the stable openOnly dataset.
      //
      // WAWF rows live in the openOnly dataset already (41/42 are in OE+IRNA
      // shipping points; the lone outlier is acknowledged in the comment on
      // `tkaNonControllableCounts`), so WAWF clicks don't need any bypass.
      openOnly: showOpenOnly && !showJS01Only && !showDeletedOnly,
      includeDeleted: showDeletedOnly, // Include deleted deliveries when in Show Deleted mode (November 9, 2025)
    })

    // Secondary query: fetch LiftFan rows when the LiftFan TKA card is
    // active. The server's `openOnly` filter excludes LiftFan by name, so
    // LiftFan rows would otherwise be invisible to the table. Cards keep
    // their stable openOnly source (above), so this query has no effect
    // on card counts — only on what the table renders.
    const isLiftFanCardActive =
      cardFilter?.type === 'tka' && cardFilter.value === 'liftFan'
    const { data: liftFanRows = [] } = useQuery({
      queryKey: ['delivery-status-liftfan-rows', organizationId] as const,
      queryFn: () => deliveryStatusService.fetchLiftFanRows(),
      enabled: !!organizationId && isLiftFanCardActive,
      staleTime: 60_000,
    })

    // Table data source = stable openOnly data ∪ LiftFan rows (when active).
    // `data` (used by all card calcs) is unchanged.
    const tableData = useMemo(() => {
      if (!isLiftFanCardActive || liftFanRows.length === 0) return data
      const seen = new Set(data.map((d) => d.id))
      const merged = [...data]
      for (const r of liftFanRows) {
        if (!seen.has(r.id)) merged.push(r)
      }
      return merged
    }, [data, liftFanRows, isLiftFanCardActive])

    // Pre-load dispositions IMMEDIATELY when data arrives to prevent sequential popping
    // Also auto-assign DCMA and WAWF dispositions (November 9, 2025)
    useEffect(() => {
      if (organizationId && !isLoading) {
        // Eagerly load dispositions before table renders
        // This populates the global cache so all cells load instantly
        deliveryStatusService.getDispositions(organizationId).catch(() => {
          // Silent failure - cells will show em dash gracefully
        })

        // Auto-assign dispositions for LiftFan and WAWF deliveries
        // This runs in the background and doesn't block UI
        deliveryStatusService
          .autoAssignDispositions()
          .then((result) => {
            if (result.assigned > 0) {
              logger.log(
                `✅ Auto-assigned dispositions to ${result.assigned} deliveries`
              )
              // Refresh data to show updated dispositions
              refreshData()
            }
          })
          .catch(() => {
            // Silent failure
          })
      }
    }, [organizationId, isLoading, refreshData])

    // Load PGI count when date changes (November 9, 2025)
    useEffect(() => {
      const loadPgiCount = async () => {
        setIsLoadingPgi(true)
        try {
          const count =
            await deliveryStatusService.getDeliveriesPGIForDate(pgiSelectedDate)
          setPgiCount(count)
        } catch (error) {
          logger.error('Failed to load PGI count:', error)
          setPgiCount(0)
        } finally {
          setIsLoadingPgi(false)
        }
      }

      loadPgiCount()
    }, [pgiSelectedDate])

    // Sort and filter data
    const sortedAndFilteredData = useMemo(() => {
      // `tableData` = openOnly `data` ∪ LiftFan rows (when LiftFan card is
      // active). All cards continue to read from `data`, so card counts stay
      // stable regardless of which TKA card is clicked.
      let processedData = [...tableData]

      // Show Deleted mode - show ONLY deleted deliveries (November 9, 2025)
      if (showDeletedOnly) {
        processedData = processedData.filter(
          (item) =>
            item.is_deleted === true ||
            item.disposition_name?.toUpperCase() === 'DELETED'
        )
      }
      // JS01 filter mode - show only JS01 shipping point
      else if (showJS01Only) {
        processedData = processedData.filter(
          (item) => item.shipping_point?.toUpperCase() === 'JS01'
        )
      }
      // Open Only mode - show OE + IRNA shipping points, non-completed
      // EXCLUDE "Ship in Place - LiftFan JPO Depot" (November 9, 2025)
      // EXCLUDE deliveries with "Deleted" disposition (November 10, 2025)
      // EXCLUDE WAWF rows from default view (May 7, 2026) — they belong to
      //   the TKA Non-Controllable section. The WAWF card click filter below
      //   explicitly opts back into showing them.
      else if (showOpenOnly) {
        // Filter out deliveries with "Deleted" disposition regardless of search state
        // This ensures deleted dispositions never show in Open Only mode
        processedData = processedData.filter((item) => {
          const isNotDeleted =
            item.disposition_name?.toUpperCase() !== 'DELETED'
          return isNotDeleted
        })

        // Filter out WAWF rows so they don't double-count against the TKA
        // Non-Controllable section. Bypass when the WAWF card is itself the
        // active card filter (so users can drill into WAWF rows from there).
        const isWawfCardActive =
          cardFilter?.type === 'tka' && cardFilter.value === 'wawf'
        if (!isWawfCardActive) {
          processedData = processedData.filter(
            (item) =>
              !item.external_identification_1?.toUpperCase().includes('WAWF')
          )
        }

        // Additional filtering when search is active (search bypasses openOnly database filter)
        if (searchQuery.trim()) {
          // OE shipping points + IRNA
          const oeIrnaShippingPoints = [
            'PDCE',
            'NMP1',
            'NME1',
            'KY01',
            'DCSP',
            'IRNA',
          ]

          // Filter for OE+IRNA and non-completed status
          // Exclude Ship in Place - LiftFan JPO Depot
          processedData = processedData.filter((item) => {
            const isNotCompleted = item.status?.toLowerCase() !== 'completed'
            const isOeOrIrna =
              item.shipping_point &&
              oeIrnaShippingPoints.includes(item.shipping_point.toUpperCase())
            const isNotLiftFan =
              item.customer_name !== 'Ship in Place - LiftFan JPO Depot'
            return isNotCompleted && isOeOrIrna && isNotLiftFan
          })
        }
      }

      // Apply stat-card pill filter (May 5, 2026)
      // Mirrors the inventory counts tab: each clickable card pill applies a
      // narrow secondary filter on top of whatever mode (Open Only / All /
      // JS01 / Deleted) is active.
      if (cardFilter) {
        const oeShippingPoints = ['PDCE', 'NMP1', 'NME1', 'KY01', 'DCSP']
        if (cardFilter.type === 'shippingPoint') {
          if (cardFilter.value === 'oe') {
            processedData = processedData.filter(
              (item) =>
                item.shipping_point &&
                oeShippingPoints.includes(item.shipping_point.toUpperCase())
            )
          } else if (cardFilter.value === 'irna') {
            processedData = processedData.filter(
              (item) => item.shipping_point?.toUpperCase() === 'IRNA'
            )
          }
        } else if (cardFilter.type === 'daysOpen') {
          // Cumulative thresholds: each card answers "how many deliveries
          // are at least N days old?", matching the literal ">N Days"
          // labels on the cards. The buckets intentionally overlap — a
          // 290-day-old delivery satisfies all three filters.
          processedData = processedData.filter((item) => {
            if (item.days_open === null || item.days_open === undefined)
              return false
            if (cardFilter.value === 'over30') return item.days_open > 30
            if (cardFilter.value === 'over12') return item.days_open > 12
            if (cardFilter.value === 'over4') return item.days_open > 4
            return false
          })
        } else if (cardFilter.type === 'tka') {
          // The TKA cards count *open* (no AGM) and *non-soft-deleted* rows
          // — see `getStatistics()` in delivery-status.service.ts. When a
          // TKA card is active the server-side `openOnly` flag is bypassed
          // (see `useDeliveryStatus({ openOnly: ..., cardFilter?.type !==
          // 'tka' })`), so `data` contains is_deleted=true and AGM-set rows
          // that the table must drop client-side to keep the card count and
          // the visible row count in sync.
          const isOpenAndNotSoftDeleted = (item: DeliveryStatusData) =>
            !item.actual_goods_movement_date && !item.is_deleted
          if (cardFilter.value === 'liftFan') {
            processedData = processedData.filter(
              (item) =>
                item.customer_name === 'Ship in Place - LiftFan JPO Depot' &&
                isOpenAndNotSoftDeleted(item)
            )
          } else if (cardFilter.value === 'wawf') {
            processedData = processedData.filter(
              (item) =>
                item.external_identification_1
                  ?.toUpperCase()
                  .includes('WAWF') && isOpenAndNotSoftDeleted(item)
            )
          } else if (cardFilter.value === 'placeholder') {
            // "TBD" pill — currently no rows are tagged as TBD; reserved for
            // future placeholder logic. Filter to nothing so the table reads
            // as empty (matching the "0" on the card).
            processedData = []
          }
        }
      }

      // Apply advanced filters (November 9, 2025)
      if (advancedFilterConfig.groups.length > 0) {
        processedData = applyAdvancedFilters(
          processedData,
          advancedFilterConfig
        )
      }

      // Apply legacy column filters (kept for backwards compatibility)
      Object.entries(filterConfig).forEach(([key, value]) => {
        if (value) {
          if (Array.isArray(value)) {
            // Multi-select filtering: item must match any of the selected values
            if (value.length > 0) {
              processedData = processedData.filter((item) => {
                const itemValue = item[key as keyof DeliveryStatusData]
                return itemValue && value.includes(String(itemValue))
              })
            }
          } else {
            // Single value filtering: original logic
            processedData = processedData.filter((item) => {
              const itemValue = item[key as keyof DeliveryStatusData]
              return (
                itemValue &&
                String(itemValue).toLowerCase().includes(value.toLowerCase())
              )
            })
          }
        }
      })

      // Apply search query filter - Updated November 1, 2025 to match new column order
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        processedData = processedData.filter(
          (item) =>
            item.delivery?.toLowerCase().includes(query) ||
            item.customer_name?.toLowerCase().includes(query) ||
            item.status?.toLowerCase().includes(query) ||
            item.delivery_priority?.toLowerCase().includes(query) ||
            item.shipping_point?.toLowerCase().includes(query) ||
            (item.days_open != null &&
              item.days_open.toString().includes(query))
        )
      }

      // Apply sorting
      if (sortConfig) {
        processedData.sort((a, b) => {
          const aValue = a[sortConfig.key]
          const bValue = b[sortConfig.key]

          // Handle null/undefined values
          if (aValue === null || aValue === undefined) return 1
          if (bValue === null || bValue === undefined) return -1

          // Handle different data types
          let comparison = 0
          if (typeof aValue === 'number' && typeof bValue === 'number') {
            comparison = aValue - bValue
          } else if (sortConfig.key.includes('_date')) {
            // Handle date fields specially
            const aDate = new Date(aValue as string)
            const bDate = new Date(bValue as string)
            comparison = aDate.getTime() - bDate.getTime()
          } else {
            // Convert to string for comparison
            const aStr = String(aValue).toLowerCase()
            const bStr = String(bValue).toLowerCase()
            comparison = aStr < bStr ? -1 : aStr > bStr ? 1 : 0
          }

          return sortConfig.direction === 'desc' ? -comparison : comparison
        })
      }

      return processedData
    }, [
      tableData,
      filterConfig,
      advancedFilterConfig,
      searchQuery,
      sortConfig,
      showOpenOnly,
      showJS01Only,
      showDeletedOnly,
      cardFilter,
    ])

    // Pagination calculations
    const totalRecords = sortedAndFilteredData.length
    const totalPages = Math.ceil(totalRecords / recordsPerPage)
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = startIndex + recordsPerPage
    const currentPageData = sortedAndFilteredData.slice(startIndex, endIndex)

    // Card counts must mirror what the table actually shows in `showOpenOnly`
    // mode (the default view) so a user clicking a card sees the same number
    // of rows in the table as the card claims. The canonical filter chain
    // matches `sortedAndFilteredData`'s open-only branch:
    //
    //   - shipping_point IN OE + IRNA
    //   - customer_name <> 'Ship in Place - LiftFan JPO Depot'  (TKA card)
    //   - external_identification_1 NOT LIKE '%WAWF%'           (TKA card)
    //   - status <> 'completed'  (i.e. no actual_goods_movement_date)
    //   - disposition_name <> 'DELETED'
    //
    // The four card groups (Total Deliveries / Days Open / TKA / PGI) are
    // designed to describe **non-overlapping** populations. LiftFan and WAWF
    // rows belong exclusively to the TKA Non-Controllable card and must be
    // excluded from Total/OE/IRNA and Days Open so the same row is never
    // double-counted across two card groups.
    //
    // Defining the chain explicitly here (instead of relying on the server's
    // `openOnly` flag) is intentional: that flag is bypassed when a TKA
    // Non-Controllable card filter is active, so `data` may contain rows
    // outside this scope. The cards must still describe the open-OE+IRNA
    // population regardless.
    const OE_SHIPPING_POINTS = useMemo(
      () => ['PDCE', 'NMP1', 'NME1', 'KY01', 'DCSP'],
      []
    )
    const openOeIrnaDeliveries = useMemo(() => {
      return data.filter((item) => {
        const sp = item.shipping_point?.toUpperCase()
        const isOeOrIrna =
          !!sp && (OE_SHIPPING_POINTS.includes(sp) || sp === 'IRNA')
        const isOpen = item.status?.toLowerCase() !== 'completed'
        const isNotLiftFan =
          item.customer_name !== 'Ship in Place - LiftFan JPO Depot'
        const isNotWawf = !item.external_identification_1
          ?.toUpperCase()
          .includes('WAWF')
        const isNotDeletedDisposition =
          item.disposition_name?.toUpperCase() !== 'DELETED'
        return (
          isOeOrIrna &&
          isOpen &&
          isNotLiftFan &&
          isNotWawf &&
          isNotDeletedDisposition
        )
      })
    }, [data, OE_SHIPPING_POINTS])

    const shippingPointCounts = useMemo(() => {
      return {
        oe: openOeIrnaDeliveries.filter(
          (item) =>
            item.shipping_point &&
            OE_SHIPPING_POINTS.includes(item.shipping_point.toUpperCase())
        ).length,
        irna: openOeIrnaDeliveries.filter(
          (item) => item.shipping_point?.toUpperCase() === 'IRNA'
        ).length,
        total: openOeIrnaDeliveries.length,
      }
    }, [openOeIrnaDeliveries, OE_SHIPPING_POINTS])

    // Cumulative aging counts — each value answers "how many open OE/IRNA
    // deliveries are at least N days old?", matching the ">N Days" card
    // labels and the cumulative click-filter logic above. Buckets overlap
    // by design (a 290-day delivery is counted in all three).
    const daysOpenCounts = useMemo(() => {
      const hasDaysOpen = (item: DeliveryStatusData) =>
        item.days_open !== null && item.days_open !== undefined
      return {
        over30: openOeIrnaDeliveries.filter(
          (item) => hasDaysOpen(item) && (item.days_open as number) > 30
        ).length,
        over12: openOeIrnaDeliveries.filter(
          (item) => hasDaysOpen(item) && (item.days_open as number) > 12
        ).length,
        over4: openOeIrnaDeliveries.filter(
          (item) => hasDaysOpen(item) && (item.days_open as number) > 4
        ).length,
      }
    }, [openOeIrnaDeliveries])

    // TKA Non-Controllable counts now come from statistics (full dataset)
    // This ensures accurate counts even when Open Only filter is active (November 9, 2025)
    const tkaNonControllableCounts = useMemo(() => {
      return (
        statistics?.tkaNonControllable || {
          liftFan: 0,
          wawf: 0,
          placeholder: 0,
        }
      )
    }, [statistics])

    // Sorting and filtering handlers
    const handleSort = useCallback((key: keyof DeliveryStatusData) => {
      setSortConfig((prevConfig) => ({
        key,
        direction:
          prevConfig?.key === key && prevConfig.direction === 'asc'
            ? 'desc'
            : 'asc',
      }))
    }, [])

    // Legacy filter handler - no longer needed with advanced filters (November 9, 2025)
    // const handleFilter = useCallback((key: string, value: string | string[]) => {
    //   setFilterConfig(prevConfig => ({
    //     ...prevConfig,
    //     [key]: value
    //   }));
    //   setCurrentPage(1); // Reset to first page when filtering
    // }, []);

    // Reset to first page when search changes
    React.useEffect(() => {
      setCurrentPage(1)
    }, [searchQuery])

    // Reset to first page when a stat-card pill filter is toggled (May 5, 2026)
    React.useEffect(() => {
      setCurrentPage(1)
    }, [cardFilter])

    // Clear all filters
    const handleClearFilters = useCallback(() => {
      setFilterConfig({})
      setCardFilter(null)
      setCurrentPage(1)
    }, [])

    // Handle import from clipboard with large dataset detection
    const handleImportData = useCallback(async () => {
      try {
        // Check clipboard size first for large dataset warning
        if (navigator.clipboard?.readText) {
          const clipboardText = await navigator.clipboard.readText()
          const lines = clipboardText.trim().split('\n')
          const rowCount = lines.length - 1 // Subtract header row

          // Show custom confirmation dialog for very large imports
          if (rowCount > 50000) {
            setPendingImportRowCount(rowCount)
            setShowImportConfirmDialog(true)
            return
          }
        }

        await importFromClipboard()
      } catch (error) {
        logger.error('Import failed:', error)
      }
    }, [importFromClipboard])

    // Handle confirmed import after user accepts the dialog
    const handleConfirmImport = useCallback(async () => {
      setShowImportConfirmDialog(false)
      await importFromClipboard()
    }, [importFromClipboard])

    // Handle cancelled import
    const handleCancelImport = useCallback(() => {
      setShowImportConfirmDialog(false)
      setPendingImportRowCount(0)
    }, [])

    // Handle export data with current sorting and filtering
    const handleExportData = useCallback(() => {
      if (sortedAndFilteredData.length === 0) {
        toast.warning('No data to export')
        return
      }

      try {
        // Create CSV content with default columns
        const csvHeaders = DEFAULT_COLUMNS.map((col) => col.label)
        const csvContent = [
          csvHeaders.join(','),
          ...sortedAndFilteredData.map((row) =>
            DEFAULT_COLUMNS.map((col) => {
              const value = row[col.key]
              return `"${value || ''}"`
            }).join(',')
          ),
        ].join('\n')

        // Download CSV file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute(
          'download',
          `delivery-status-${new Date().toISOString().split('T')[0]}.csv`
        )
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        toast.success(`Exported ${sortedAndFilteredData.length} records`)
      } catch (error) {
        toast.error('Export failed')
        logger.error('Export error:', error)
      }
    }, [sortedAndFilteredData])

    // Optimized pagination handlers using useCallback
    const goToPage = useCallback(
      (page: number) => {
        if (page >= 1 && page <= totalPages) {
          setCurrentPage(page)
        }
      },
      [totalPages]
    )

    const goToPreviousPage = useCallback(() => {
      if (currentPage > 1) {
        setCurrentPage(currentPage - 1)
      }
    }, [currentPage])

    const goToNextPage = useCallback(() => {
      if (currentPage < totalPages) {
        setCurrentPage(currentPage + 1)
      }
    }, [currentPage, totalPages])

    // Handle view details click
    const handleViewDetails = useCallback((item: DeliveryStatusData) => {
      setSelectedItem(item)
      setIsDetailsDialogOpen(true)
    }, [])

    // Get cell content based on column
    const getCellContent = (item: DeliveryStatusData, column: TableColumn) => {
      const value = item[column.key]

      switch (column.key) {
        case 'status':
          return <StatusBadge status={value as string} />
        case 'dispositions':
          return (
            <DispositionSelect
              deliveryId={item.id}
              currentDispositionId={value as string | null}
              onDispositionChange={() => {
                // Don't trigger full refresh - let optimistic update handle it
                // Silent update in background without reloading entire table
              }}
            />
          )
        case 'days_open':
          return value !== null ? `${value} days` : 'N/A'
        case 'delivery_creation_date':
        case 'delivery_change_date':
        case 'actual_goods_movement_date':
        case 'shipment_create_date':
        case 'transfer_order_create_date':
        case 'transfer_order_confirm_date':
          return value ? new Date(value as string).toLocaleDateString() : 'N/A'
        case 'customer_name':
          return (
            <span
              className='block max-w-[200px] truncate'
              title={(value as string) || ''}
            >
              {value || 'N/A'}
            </span>
          )
        default:
          return value || 'N/A'
      }
    }

    // Show error state
    if (error) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='p-6'>
            <div className='text-destructive text-center'>
              <p>Failed to load delivery status data: {error.message}</p>
              <Button onClick={refreshData} className='mt-4'>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    }

    // Memoized statistics cards (May 5, 2026 redesign)
    // Mirrors the clickable-pill pattern from the Inventory Counts tab so each
    // numeric pill doubles as a quick-filter for the table below.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const StatisticsCards = useMemo(() => {
      const isShippingPointActive = (v: 'oe' | 'irna') =>
        cardFilter?.type === 'shippingPoint' && cardFilter.value === v
      const anyShippingPointActive = cardFilter?.type === 'shippingPoint'

      const isDaysOpenActive = (v: 'over30' | 'over12' | 'over4') =>
        cardFilter?.type === 'daysOpen' && cardFilter.value === v
      const anyDaysOpenActive = cardFilter?.type === 'daysOpen'

      const isTkaActive = (v: 'liftFan' | 'wawf' | 'placeholder') =>
        cardFilter?.type === 'tka' && cardFilter.value === v
      const anyTkaActive = cardFilter?.type === 'tka'

      // Wrapping <button> shared style. StatTile owns the surface tint;
      // the outer button only carries the focus ring + active filter ring.
      const pillButtonBase =
        'group/pill block w-full rounded-lg text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer'

      const toggleShippingPoint = (value: 'oe' | 'irna') =>
        setCardFilter((curr) =>
          curr?.type === 'shippingPoint' && curr.value === value
            ? null
            : { type: 'shippingPoint', value }
        )

      const toggleDaysOpen = (value: 'over30' | 'over12' | 'over4') =>
        setCardFilter((curr) =>
          curr?.type === 'daysOpen' && curr.value === value
            ? null
            : { type: 'daysOpen', value }
        )

      const toggleTka = (value: 'liftFan' | 'wawf' | 'placeholder') =>
        setCardFilter((curr) =>
          curr?.type === 'tka' && curr.value === value
            ? null
            : { type: 'tka', value }
        )

      return (
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4'>
          {/* Card 1: Total Deliveries (shipping-point breakdown) */}
          <Card className='group border-border/50 bg-card/50 relative overflow-hidden backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20'>
            <div className='from-primary/5 to-primary/0 absolute inset-0 bg-linear-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
            <CardHeader className='relative flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
                <div className='flex h-6 w-6 items-center justify-center rounded-md bg-slate-500/10 dark:bg-slate-400/10'>
                  <FileText className='h-3.5 w-3.5 text-slate-600 dark:text-slate-400' />
                </div>
                Total Deliveries
              </CardTitle>
              {anyShippingPointActive ? (
                <button
                  type='button'
                  onClick={() => setCardFilter(null)}
                  className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition-colors'
                  title='Clear shipping point filter'
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
                  aria-pressed={!anyShippingPointActive}
                  onClick={() => setCardFilter(null)}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-slate-500/40',
                    !anyShippingPointActive &&
                      'ring-2 ring-slate-500/40 dark:ring-slate-400/40'
                  )}
                  title='Show OE + IRNA combined'
                >
                  <StatTile
                    label='Open'
                    value={shippingPointCounts.oe + shippingPointCounts.irna}
                    accent='default'
                    className='h-full transition-colors hover:bg-slate-500/10 dark:hover:bg-slate-400/10'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isShippingPointActive('oe')}
                  onClick={() => toggleShippingPoint('oe')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-sky-500/40',
                    isShippingPointActive('oe') && 'ring-2 ring-sky-500/60'
                  )}
                  title='Filter table to OE shipping points'
                >
                  <StatTile
                    label='OE'
                    value={shippingPointCounts.oe}
                    accent='sky'
                    className='h-full transition-colors hover:bg-sky-500/15 dark:hover:bg-sky-500/15'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isShippingPointActive('irna')}
                  onClick={() => toggleShippingPoint('irna')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-emerald-500/40',
                    isShippingPointActive('irna') &&
                      'ring-2 ring-emerald-500/60'
                  )}
                  title='Filter table to IRNA shipping point'
                >
                  <StatTile
                    label='IRNA'
                    value={shippingPointCounts.irna}
                    accent='emerald'
                    className='h-full transition-colors hover:bg-emerald-500/15 dark:hover:bg-emerald-500/15'
                  />
                </button>
              </KpiGrid>
            </CardContent>
          </Card>

          {/* Card 2: Days Open (mutually-exclusive aging buckets) */}
          <Card
            className={cn(
              'group relative overflow-hidden backdrop-blur-sm transition-all duration-300 hover:shadow-lg',
              daysOpenCounts.over30 > 0
                ? 'border-red-500/30 bg-red-500/5 hover:shadow-red-500/10 dark:border-red-500/20 dark:bg-red-500/5 dark:hover:shadow-red-500/5'
                : 'border-border/50 bg-card/50 hover:shadow-black/5 dark:hover:shadow-black/20'
            )}
          >
            <div className='absolute inset-0 bg-linear-to-br from-red-500/5 to-orange-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
            <CardHeader className='relative flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md',
                    daysOpenCounts.over30 > 0
                      ? 'bg-red-500/15 dark:bg-red-500/10'
                      : 'bg-slate-500/10 dark:bg-slate-400/10'
                  )}
                >
                  <Clock
                    className={cn(
                      'h-3.5 w-3.5',
                      daysOpenCounts.over30 > 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-600 dark:text-slate-400'
                    )}
                  />
                </div>
                Days Open
              </CardTitle>
              {anyDaysOpenActive ? (
                <button
                  type='button'
                  onClick={() => setCardFilter(null)}
                  className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition-colors'
                  title='Clear days-open filter'
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
                  aria-pressed={isDaysOpenActive('over30')}
                  onClick={() => toggleDaysOpen('over30')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-red-500/40',
                    isDaysOpenActive('over30') && 'ring-2 ring-red-500/60'
                  )}
                  title='Filter table to deliveries over 30 days open'
                >
                  <StatTile
                    label='>30 Days'
                    value={daysOpenCounts.over30}
                    accent='rose'
                    className='h-full transition-colors hover:bg-rose-500/15 dark:hover:bg-rose-500/15'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isDaysOpenActive('over12')}
                  onClick={() => toggleDaysOpen('over12')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-orange-500/40',
                    isDaysOpenActive('over12') && 'ring-2 ring-orange-500/60'
                  )}
                  title='Filter table to deliveries 13–30 days open'
                >
                  <StatTile
                    label='>12 Days'
                    value={daysOpenCounts.over12}
                    accent='orange'
                    className='h-full transition-colors hover:bg-orange-500/15 dark:hover:bg-orange-500/15'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isDaysOpenActive('over4')}
                  onClick={() => toggleDaysOpen('over4')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-amber-500/40',
                    isDaysOpenActive('over4') && 'ring-2 ring-amber-500/60'
                  )}
                  title='Filter table to deliveries 5–12 days open'
                >
                  <StatTile
                    label='>4 Days'
                    value={daysOpenCounts.over4}
                    accent='amber'
                    className='h-full transition-colors hover:bg-amber-500/15 dark:hover:bg-amber-500/15'
                  />
                </button>
              </KpiGrid>
            </CardContent>
          </Card>

          {/* Card 3: TKA Non-Controllable (LiftFan / WAWF / TBD) */}
          <Card
            className={cn(
              'group relative overflow-hidden backdrop-blur-sm transition-all duration-300 hover:shadow-lg',
              tkaNonControllableCounts.liftFan + tkaNonControllableCounts.wawf >
                0
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
                    tkaNonControllableCounts.liftFan +
                      tkaNonControllableCounts.wawf >
                      0
                      ? 'bg-amber-500/15 dark:bg-amber-500/10'
                      : 'bg-slate-500/10 dark:bg-slate-400/10'
                  )}
                >
                  <AlertCircle
                    className={cn(
                      'h-3.5 w-3.5',
                      tkaNonControllableCounts.liftFan +
                        tkaNonControllableCounts.wawf >
                        0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-600 dark:text-slate-400'
                    )}
                  />
                </div>
                TKA Non-Controllable
              </CardTitle>
              {anyTkaActive ? (
                <button
                  type='button'
                  onClick={() => setCardFilter(null)}
                  className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition-colors'
                  title='Clear TKA filter'
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
                  aria-pressed={isTkaActive('liftFan')}
                  onClick={() => toggleTka('liftFan')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-violet-500/40',
                    isTkaActive('liftFan') && 'ring-2 ring-violet-500/60'
                  )}
                  title='Filter table to LiftFan JPO Depot deliveries'
                >
                  <StatTile
                    label='LiftFan'
                    value={tkaNonControllableCounts.liftFan}
                    accent='violet'
                    className='h-full transition-colors hover:bg-violet-500/15 dark:hover:bg-violet-500/15'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isTkaActive('wawf')}
                  onClick={() => toggleTka('wawf')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-amber-500/40',
                    isTkaActive('wawf') && 'ring-2 ring-amber-500/60'
                  )}
                  title='Filter table to WAWF deliveries (no goods movement)'
                >
                  <StatTile
                    label='WAWF'
                    value={tkaNonControllableCounts.wawf}
                    accent='amber'
                    className='h-full transition-colors hover:bg-amber-500/15 dark:hover:bg-amber-500/15'
                  />
                </button>
                <button
                  type='button'
                  aria-pressed={isTkaActive('placeholder')}
                  onClick={() => toggleTka('placeholder')}
                  className={cn(
                    pillButtonBase,
                    'focus-visible:ring-slate-500/40',
                    isTkaActive('placeholder') &&
                      'ring-2 ring-slate-500/40 dark:ring-slate-400/40'
                  )}
                  title='Filter table to TBD placeholder deliveries'
                >
                  <StatTile
                    label='TBD'
                    value={tkaNonControllableCounts.placeholder}
                    accent='default'
                    className='h-full transition-colors hover:bg-slate-500/10 dark:hover:bg-slate-400/10'
                  />
                </button>
              </KpiGrid>
            </CardContent>
          </Card>

          {/* Card 4: Deliveries PGI — date-driven counter (calendar IS the filter) */}
          <Card className='group border-border/50 bg-card/50 relative overflow-hidden backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20'>
            <div className='absolute inset-0 bg-linear-to-br from-purple-500/5 to-purple-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
            <CardHeader className='relative flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
                <div className='flex h-6 w-6 items-center justify-center rounded-md bg-purple-500/15 dark:bg-purple-500/10'>
                  <Truck className='h-3.5 w-3.5 text-purple-600 dark:text-purple-400' />
                </div>
                Deliveries PGI
              </CardTitle>
              <Popover
                open={isPgiCalendarOpen}
                onOpenChange={setIsPgiCalendarOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-6 gap-1 px-2 text-xs'
                  >
                    <CalendarIcon className='h-3 w-3' />
                    {format(pgiSelectedDate, 'MMM d')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className='w-auto p-0' align='start'>
                  <Calendar
                    mode='single'
                    selected={pgiSelectedDate}
                    onSelect={(date) => {
                      if (date) {
                        setPgiSelectedDate(date)
                        setIsPgiCalendarOpen(false)
                      }
                    }}
                    captionLayout='dropdown'
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </CardHeader>
            <CardContent className='relative pt-1 pb-4'>
              <StatTile
                label='Actual Goods Movement Date'
                accent='violet'
                format='raw'
                value={
                  isLoadingPgi ? (
                    <Loader2 className='inline h-7 w-7 animate-spin' />
                  ) : (
                    pgiCount.toLocaleString()
                  )
                }
                valueTitle={String(pgiCount)}
              />
            </CardContent>
          </Card>
        </div>
      )
    }, [
      shippingPointCounts,
      daysOpenCounts,
      tkaNonControllableCounts,
      pgiCount,
      isLoadingPgi,
      pgiSelectedDate,
      isPgiCalendarOpen,
      cardFilter,
    ])

    return (
      <div ref={componentRef} className='space-y-6'>
        {/* Import Confirmation Dialog */}
        <ImportConfirmDialog
          isOpen={showImportConfirmDialog}
          rowCount={pendingImportRowCount}
          operation='clear'
          datasetName='delivery status data'
          onConfirm={handleConfirmImport}
          onCancel={handleCancelImport}
          isProcessing={isImporting}
        />

        {/* Import Progress Dialog */}
        <ImportProgressDialog
          isOpen={isImporting && !!importProgress}
          progress={importProgress}
          onClose={() => {
            // Only allow closing when import is completed - managed by hook
          }}
        />

        {/* Filter Dialog */}
        <AdvancedDeliveryFilterDialog
          isOpen={isFilterDialogOpen}
          onOpenChange={setIsFilterDialogOpen}
          filterConfig={advancedFilterConfig}
          onFilterChange={(config) => setAdvancedFilterConfig(config)}
          onClearAllFilters={() =>
            setAdvancedFilterConfig(createEmptyFilterConfig())
          }
          data={data}
        />

        {/* Disposition Editor Dialog */}
        <DispositionEditorDialog
          isOpen={isDispositionEditorOpen}
          onOpenChange={setIsDispositionEditorOpen}
          onDispositionsChange={refreshData}
        />

        {/* Statistics Cards */}
        {StatisticsCards}

        {/* Data Table */}
        <Card className='bg-background border-border w-full'>
          <CardHeader className='pb-4'>
            <div className='flex flex-col space-y-4'>
              {/* Main Header */}
              <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                <div className='flex flex-1 flex-col items-start gap-4 sm:flex-row sm:items-center'>
                  <h2 className='text-foreground text-2xl font-semibold'>
                    Delivery Status
                  </h2>
                  <div className='relative max-w-sm flex-1'>
                    <Search
                      className={cn(
                        'absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 transform',
                        isUsingRust ? 'text-blue-500' : 'text-muted-foreground'
                      )}
                    />
                    <RustPoweredSearchInput
                      placeholder='Search deliveries, customers, status...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      isRustEnabled={isUsingRust}
                    />
                  </div>
                </div>

                <div className='flex items-center gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleImportData}
                    disabled={isImporting}
                    className='border-border hover:bg-accent'
                  >
                    {isImporting ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : (
                      <Upload className='mr-2 h-4 w-4' />
                    )}
                    Import Data
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='outline'
                        size='sm'
                        className='border-border hover:bg-accent'
                      >
                        <MoreHorizontal className='mr-2 h-4 w-4' />
                        More
                        <ChevronDown className='ml-2 h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='end'
                      className='bg-background border-border'
                    >
                      <DropdownMenuItem
                        onClick={() => setIsFilterDialogOpen(true)}
                        className='hover:bg-accent'
                      >
                        <Filter className='mr-2 h-4 w-4' />
                        Advanced Filters
                        {countActiveFilters(advancedFilterConfig) > 0 && (
                          <Badge
                            variant='secondary'
                            className='ml-2 px-1.5 py-0.5 text-xs'
                          >
                            {countActiveFilters(advancedFilterConfig)}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleExportData}
                        disabled={sortedAndFilteredData.length === 0}
                        className='hover:bg-accent'
                      >
                        <Download className='mr-2 h-4 w-4' />
                        Export
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowOpenOnly(!showOpenOnly)
                          setShowJS01Only(false) // Disable JS01 when toggling Open Only
                          setShowDeletedOnly(false) // Disable Show Deleted when toggling Open Only
                        }}
                        className='hover:bg-accent'
                      >
                        <FilterX className='mr-2 h-4 w-4' />
                        {showOpenOnly ? 'Show All' : 'Open Only'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowJS01Only(!showJS01Only)
                          setShowOpenOnly(false) // Disable Open Only when toggling JS01
                          setShowDeletedOnly(false) // Disable Show Deleted when toggling JS01
                        }}
                        className='hover:bg-accent'
                      >
                        <Filter className='mr-2 h-4 w-4' />
                        {showJS01Only ? 'Clear JS01 Filter' : 'Show JS01'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowDeletedOnly(!showDeletedOnly)
                          setShowOpenOnly(false) // Disable Open Only when toggling Show Deleted
                          setShowJS01Only(false) // Disable JS01 when toggling Show Deleted
                        }}
                        className='hover:bg-accent'
                      >
                        <Trash2 className='mr-2 h-4 w-4' />
                        {showDeletedOnly
                          ? 'Clear Deleted Filter'
                          : 'Show Deleted'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setIsDispositionEditorOpen(true)}
                        className='hover:bg-accent'
                      >
                        <Settings className='mr-2 h-4 w-4' />
                        Editor
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={refreshData}
                        className='hover:bg-accent'
                      >
                        <Package className='mr-2 h-4 w-4' />
                        Refresh Data
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSearchQuery('')}
                        className='hover:bg-accent'
                      >
                        <Search className='mr-2 h-4 w-4' />
                        Clear Search
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleClearFilters}
                        className='hover:bg-accent'
                      >
                        <Filter className='mr-2 h-4 w-4' />
                        Clear Filters
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Filter Status */}
              {Object.keys(filterConfig).some((key) => {
                const value = filterConfig[key]
                return Array.isArray(value)
                  ? value.length > 0
                  : Boolean(value && (value as string).trim())
              }) && (
                <div className='flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 dark:border-blue-800 dark:bg-blue-950'>
                  <span className='text-sm text-blue-800 dark:text-blue-200'>
                    {
                      Object.values(filterConfig).filter((v) => {
                        return Array.isArray(v)
                          ? v.length > 0
                          : Boolean(v && (v as string).trim())
                      }).length
                    }{' '}
                    filter(s) applied.
                  </span>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleClearFilters}
                    className='h-7'
                  >
                    <X className='mr-1 h-3 w-3' />
                    Clear All Filters
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className='flex items-center justify-center py-12'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <span className='ml-2'>Loading delivery status data...</span>
              </div>
            ) : (
              <div className='border-border overflow-hidden rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-muted/50 hover:bg-muted/50'>
                      {DEFAULT_COLUMNS.map((column) => (
                        <SortableTableHeader
                          key={column.id}
                          column={column}
                          sortConfig={sortConfig}
                          onSort={handleSort}
                        />
                      ))}
                      <TableHead className='text-foreground w-20 font-medium'>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentPageData.length > 0 ? (
                      currentPageData.map((item) => (
                        <TableRow key={item.id} className='hover:bg-muted/50'>
                          {DEFAULT_COLUMNS.map((column) => (
                            <TableCell
                              key={column.id}
                              className={`${column.width} ${
                                column.key === 'delivery'
                                  ? 'text-foreground font-medium'
                                  : column.key === 'customer_name'
                                    ? 'text-muted-foreground'
                                    : 'text-foreground'
                              }`}
                            >
                              {getCellContent(item, column)}
                            </TableCell>
                          ))}
                          <TableCell className='w-20'>
                            <Button
                              variant='outline'
                              size='icon'
                              aria-label='View Details'
                              onClick={() => handleViewDetails(item)}
                              className='h-8 w-8'
                            >
                              <Eye className='h-4 w-4' />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={DEFAULT_COLUMNS.length + 1}
                          className='text-muted-foreground py-8 text-center'
                        >
                          {data.length === 0
                            ? 'No delivery status data found. Click "Import Data" to add records from clipboard.'
                            : 'No data found matching your search or filters.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {!isLoading && (
              <div className='mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                {/* Left side: Info and status indicators */}
                <div className='text-muted-foreground flex items-center gap-4 text-sm'>
                  <span>
                    Showing {startIndex + 1}-{Math.min(endIndex, totalRecords)}{' '}
                    of {totalRecords} entries
                    {totalRecords !== data.length &&
                      ` (filtered from ${data.length} total)`}
                  </span>
                  {enableRealtime && (
                    <span className='flex items-center gap-1 text-green-500'>
                      ● Live Updates
                    </span>
                  )}
                  {Object.keys(filterConfig).some((key) => {
                    const value = filterConfig[key]
                    return Array.isArray(value)
                      ? value.length > 0
                      : Boolean(value)
                  }) && (
                    <span className='flex items-center gap-1 text-blue-600'>
                      ● Filters Active
                    </span>
                  )}
                  {sortConfig && (
                    <span className='flex items-center gap-1 text-purple-600'>
                      ● Sorted by{' '}
                      {
                        DEFAULT_COLUMNS.find(
                          (col) => col.key === sortConfig.key
                        )?.label
                      }{' '}
                      (
                      {sortConfig.direction === 'asc'
                        ? 'oldest first'
                        : 'newest first'}
                      )
                    </span>
                  )}
                </div>

                {/* Right side: Pagination and actions */}
                <div className='flex items-center gap-2'>
                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className='mr-4 flex items-center gap-1'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={goToPreviousPage}
                        disabled={currentPage === 1}
                        className='border-border h-8 w-8 p-0'
                      >
                        <ChevronLeft className='h-4 w-4' />
                      </Button>

                      <div className='flex items-center gap-1'>
                        {/* Show page numbers */}
                        {Array.from(
                          { length: Math.min(5, totalPages) },
                          (_, i) => {
                            let pageNum
                            if (totalPages <= 5) {
                              pageNum = i + 1
                            } else if (currentPage <= 3) {
                              pageNum = i + 1
                            } else if (currentPage >= totalPages - 2) {
                              pageNum = totalPages - 4 + i
                            } else {
                              pageNum = currentPage - 2 + i
                            }

                            return (
                              <Button
                                key={pageNum}
                                variant={
                                  currentPage === pageNum
                                    ? 'default'
                                    : 'outline'
                                }
                                size='sm'
                                onClick={() => goToPage(pageNum)}
                                className='h-8 w-8 p-0 text-xs'
                              >
                                {pageNum}
                              </Button>
                            )
                          }
                        )}
                      </div>

                      <Button
                        variant='outline'
                        size='sm'
                        onClick={goToNextPage}
                        disabled={currentPage === totalPages}
                        className='border-border h-8 w-8 p-0'
                      >
                        <ChevronRight className='h-4 w-4' />
                      </Button>
                    </div>
                  )}

                  {/* Action buttons */}
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={refreshData}
                    className='border-border'
                  >
                    Refresh
                  </Button>
                  {(searchQuery ||
                    Object.keys(filterConfig).some(
                      (key) => filterConfig[key]
                    )) && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => {
                        setSearchQuery('')
                        handleClearFilters()
                      }}
                      className='border-border'
                    >
                      Clear All Filters
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delivery Audit Trail Dialog - Enhanced with rr_all_deliveries data */}
        <ResponsiveDialog
          open={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
          size='xl'
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className='text-2xl font-bold'>
              Delivery Audit Trail
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Complete delivery information and workflow history for delivery{' '}
              {selectedItem?.delivery}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {selectedItem && (
            <ResponsiveDialogBody className='space-y-6'>
              {/* Basic Delivery Information */}
              <Card className='bg-muted/50'>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-lg font-semibold'>
                    Delivery Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='grid grid-cols-2 gap-4 text-sm lg:grid-cols-4'>
                    <div>
                      <p className='text-muted-foreground'>Delivery Number</p>
                      <p className='text-base font-semibold'>
                        {selectedItem.delivery || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Delivery Priority</p>
                      <p className='text-base font-semibold'>
                        {selectedItem.delivery_priority || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Transfer Order</p>
                      <p className='text-base font-semibold'>
                        {selectedItem.transfer_order_number || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Current Status</p>
                      <div className='mt-1'>
                        <StatusBadge status={selectedItem.status} />
                      </div>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Shipping Point</p>
                      <p className='text-base font-medium'>
                        {selectedItem.shipping_point || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Customer Name</p>
                      <p className='text-base font-medium'>
                        {selectedItem.customer_name || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Ship to Party</p>
                      <p className='text-base font-medium'>
                        {selectedItem.ship_to_party || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Days Open</p>
                      <p className='text-base font-semibold text-orange-600'>
                        {selectedItem.days_open !== null
                          ? `${selectedItem.days_open} days`
                          : 'N/A'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Warehouse & Logistics Information */}
              <Card>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-lg font-semibold'>
                    Warehouse & Logistics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='grid grid-cols-2 gap-4 text-sm lg:grid-cols-4'>
                    <div>
                      <p className='text-muted-foreground'>Warehouse Number</p>
                      <p className='text-base font-medium'>
                        {selectedItem.warehouse_number || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        Sales Organization
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.sales_organization || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Delivery Block</p>
                      <p className='text-base font-medium'>
                        {selectedItem.delivery_block || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        Goods Movement Status
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.goods_movement_status || 'N/A'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Timeline Information */}
              <Card>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-lg font-semibold'>
                    Timeline & Dates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='grid grid-cols-2 gap-4 text-sm lg:grid-cols-3'>
                    <div>
                      <p className='text-muted-foreground'>
                        Delivery Creation Date
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.delivery_creation_date
                          ? format(
                              new Date(selectedItem.delivery_creation_date),
                              'MMM dd, yyyy'
                            )
                          : 'N/A'}
                      </p>
                      {selectedItem.delivery_create_time && (
                        <p className='text-muted-foreground text-xs'>
                          Time: {selectedItem.delivery_create_time}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        Transfer Order Create Date
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.transfer_order_create_date
                          ? format(
                              new Date(selectedItem.transfer_order_create_date),
                              'MMM dd, yyyy'
                            )
                          : 'N/A'}
                      </p>
                      {selectedItem.transfer_order_create_time && (
                        <p className='text-muted-foreground text-xs'>
                          Time: {selectedItem.transfer_order_create_time}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        Transfer Order Confirm Date
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.transfer_order_confirm_date
                          ? format(
                              new Date(
                                selectedItem.transfer_order_confirm_date
                              ),
                              'MMM dd, yyyy'
                            )
                          : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        Delivery Change Date
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.delivery_change_date
                          ? format(
                              new Date(selectedItem.delivery_change_date),
                              'MMM dd, yyyy'
                            )
                          : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        Actual Goods Movement Date
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.actual_goods_movement_date
                          ? format(
                              new Date(selectedItem.actual_goods_movement_date),
                              'MMM dd, yyyy'
                            )
                          : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        Shipment Create Date
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.shipment_create_date
                          ? format(
                              new Date(selectedItem.shipment_create_date),
                              'MMM dd, yyyy'
                            )
                          : 'N/A'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Personnel Information */}
              <Card>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-lg font-semibold'>
                    Personnel & Attribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='grid grid-cols-2 gap-4 text-sm lg:grid-cols-3'>
                    <div>
                      <p className='text-muted-foreground'>
                        Delivery Created By
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.delivery_created_name || 'N/A'}
                      </p>
                      {selectedItem.delivery_created_by && (
                        <p className='text-muted-foreground font-mono text-xs'>
                          ID: {selectedItem.delivery_created_by}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        Delivery Changed By
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.delivery_changed_by_name || 'N/A'}
                      </p>
                      {selectedItem.delivery_change_by && (
                        <p className='text-muted-foreground font-mono text-xs'>
                          ID: {selectedItem.delivery_change_by}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        Shipment Created By
                      </p>
                      <p className='text-base font-medium'>
                        {selectedItem.shipment_created_name || 'N/A'}
                      </p>
                      {selectedItem.shipment_create_by && (
                        <p className='text-muted-foreground font-mono text-xs'>
                          ID: {selectedItem.shipment_create_by}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Shipment Information */}
              {selectedItem.shipment_number && (
                <Card>
                  <CardHeader className='pb-3'>
                    <CardTitle className='text-lg font-semibold'>
                      Shipment Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className='grid grid-cols-2 gap-4 text-sm lg:grid-cols-3'>
                      <div>
                        <p className='text-muted-foreground'>Shipment Number</p>
                        <p className='font-mono text-base font-semibold'>
                          {selectedItem.shipment_number}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>
                          External Identification 1
                        </p>
                        <p className='text-base font-medium'>
                          {selectedItem.external_identification_1 || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>
                          Shipment Created
                        </p>
                        <p className='text-base font-medium'>
                          {selectedItem.shipment_create_date
                            ? format(
                                new Date(selectedItem.shipment_create_date),
                                'MMM dd, yyyy'
                              )
                            : 'N/A'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Record Tracking */}
              <Card>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-lg font-semibold'>
                    Record Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='grid grid-cols-2 gap-4 text-sm lg:grid-cols-4'>
                    <div>
                      <p className='text-muted-foreground'>Record Created</p>
                      <p className='text-base font-medium'>
                        {format(
                          new Date(selectedItem.created_at),
                          'MMM dd, yyyy h:mm a'
                        )}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {formatDistanceToNow(
                          new Date(selectedItem.created_at),
                          { addSuffix: true }
                        )}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Last Updated</p>
                      <p className='text-base font-medium'>
                        {format(
                          new Date(selectedItem.updated_at),
                          'MMM dd, yyyy h:mm a'
                        )}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {formatDistanceToNow(
                          new Date(selectedItem.updated_at),
                          { addSuffix: true }
                        )}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Record ID</p>
                      <p className='text-muted-foreground font-mono text-xs'>
                        {selectedItem.id}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>Organization ID</p>
                      <p className='text-muted-foreground font-mono text-xs'>
                        {selectedItem.organization_id}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </ResponsiveDialogBody>
          )}
        </ResponsiveDialog>
      </div>
    )
  }
)

DeliveryStatusManager.displayName = 'DeliveryStatusManager'

export default DeliveryStatusManager

// Created and developed by Jai Singh
