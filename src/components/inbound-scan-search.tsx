// Created and developed by Jai Singh
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, toZonedTime } from 'date-fns-tz'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Flame,
  Loader2,
  MapPin,
  MoreHorizontal,
  Package,
  Plus,
  Scan,
  Search,
  Trash2,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  hotPartAlertService,
  MATCH_TYPE_LABELS,
  PRIORITY_LABELS,
  type HotPartAlert,
} from '@/lib/supabase/hot-part-alert.service'
import type {
  InboundScansWithUser,
  InboundScanWithTransfer,
} from '@/lib/supabase/inbound-scan.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useInboundScans } from '@/hooks/use-inbound-scans'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { DropOffAreaManagerDialog } from '@/components/inbound/drop-off-area-manager-dialog'

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

// EST Timezone formatting utility
const formatDateTimeEST = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A'

  try {
    const date = new Date(dateString)
    const estTimezone = 'America/New_York'
    const zonedDate = toZonedTime(date, estTimezone)

    // Format: MM/dd/yyyy h:mm:ss a (12-hour format with AM/PM)
    return format(zonedDate, 'MM/dd/yyyy h:mm:ss a', { timeZone: estTimezone })
  } catch (error) {
    logger.error('Date formatting error:', error)
    return 'Invalid Date'
  }
}

interface InboundScanSearchProps {
  enableRealtime?: boolean
}

type TransferVirtualKey = 'drop_off_area' | 'dropped_off_by' | 'accepted_by'

type TableColumnKey = keyof InboundScansWithUser[0] | TransferVirtualKey

interface TableColumn {
  id: string
  label: string
  key: TableColumnKey
  width?: string
  sortable?: boolean
}

interface SortConfig {
  key: keyof InboundScansWithUser[0]
  direction: 'asc' | 'desc'
}

// Default column configuration for inbound scans
const DEFAULT_COLUMNS: TableColumn[] = [
  {
    id: 'scanned_at',
    label: 'Scanned At',
    key: 'scanned_at',
    width: 'w-36',
    sortable: true,
  },
  {
    id: 'scanned_by',
    label: 'Scanned By',
    key: 'scanned_by_profile',
    width: 'w-32',
    sortable: false,
  },
  {
    id: 'tka_batch_number',
    label: 'TKA Batch Number',
    key: 'tka_batch_number',
    width: 'w-32',
    sortable: true,
  },
  {
    id: 'so_line_rma_afa',
    label: 'SO/Line, RMA/AFA #',
    key: 'so_line_rma_afa',
    width: 'w-36',
    sortable: true,
  },
  {
    id: 'tracking_number',
    label: 'Tracking Number',
    key: 'tracking_number',
    width: 'w-32',
    sortable: true,
  },
  {
    id: 'material_number',
    label: 'Material Number',
    key: 'material_number',
    width: 'w-32',
    sortable: true,
  },
  {
    id: 'quantity',
    label: 'Quantity',
    key: 'quantity',
    width: 'w-24',
    sortable: true,
  },
  {
    id: 'hot_truck',
    label: 'Hot Truck',
    key: 'hot_truck',
    width: 'w-24',
    sortable: true,
  },
  {
    id: 'drop_off_area',
    label: 'Drop-off Area',
    key: 'drop_off_area',
    width: 'w-40',
    sortable: false,
  },
  {
    id: 'dropped_off_by',
    label: 'Dropped off by',
    key: 'dropped_off_by',
    width: 'w-40',
    sortable: false,
  },
  {
    id: 'accepted_by',
    label: 'Accepted by',
    key: 'accepted_by',
    width: 'w-40',
    sortable: false,
  },
]

// Sortable table header component
function SortableTableHeader({
  column,
  sortConfig,
  onSort,
}: {
  column: TableColumn
  sortConfig: SortConfig | null
  onSort: (key: keyof InboundScansWithUser[0]) => void
}) {
  const isSortable =
    column.sortable === true && !isTransferVirtualKey(column.key)
  const isSorted =
    isSortable &&
    sortConfig?.key === (column.key as keyof InboundScansWithUser[0])
  const sortDirection = isSorted ? sortConfig?.direction : null

  return (
    <TableHead className={`text-foreground font-medium ${column.width}`}>
      <div className='flex items-center gap-1'>
        {isSortable ? (
          <button
            onClick={() => onSort(column.key as keyof InboundScansWithUser[0])}
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

function isTransferVirtualKey(key: TableColumnKey): key is TransferVirtualKey {
  return (
    key === 'drop_off_area' || key === 'dropped_off_by' || key === 'accepted_by'
  )
}

// Hot truck badge component
function HotTruckBadge({ isHotTruck }: { isHotTruck?: boolean | null }) {
  if (isHotTruck === null || isHotTruck === undefined) {
    return <span className='text-muted-foreground'>N/A</span>
  }

  return (
    <Badge
      variant={isHotTruck ? 'destructive' : 'secondary'}
      className={
        isHotTruck
          ? 'border-red-300 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
          : 'border-gray-300 bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
      }
    >
      {isHotTruck ? 'Hot' : 'Normal'}
    </Badge>
  )
}

// ─── Hot Part Alert Management Dialog ───────────────────────────────────────
function HotPartAlertDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [alerts, setAlerts] = useState<HotPartAlert[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // New alert form state
  const [newMatchValue, setNewMatchValue] = useState('')
  const [newMatchType, setNewMatchType] =
    useState<HotPartAlert['match_type']>('any')
  const [newPriority, setNewPriority] =
    useState<HotPartAlert['priority']>('high')
  const [newNotes, setNewNotes] = useState('')

  // Load alerts when dialog opens
  useEffect(() => {
    if (open) {
      loadAlerts()
    }
  }, [open])

  const loadAlerts = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await hotPartAlertService.fetchAlerts()
      if (error) {
        toast.error('Failed to load hot part alerts')
        logger.error('Error loading alerts:', error)
      } else {
        setAlerts(data)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateAlert = async () => {
    if (!newMatchValue.trim()) {
      toast.error('Match value is required')
      return
    }

    setIsCreating(true)
    try {
      const { data, error } = await hotPartAlertService.createAlert({
        match_value: newMatchValue,
        match_type: newMatchType,
        priority: newPriority,
        notes: newNotes || undefined,
      })

      if (error) {
        if (error.code === '23505') {
          toast.error('This alert rule already exists')
        } else {
          toast.error('Failed to create alert')
        }
        logger.error('Error creating alert:', error)
      } else if (data) {
        toast.success('Hot Part Alert created')
        setAlerts((prev) => [data, ...prev])
        resetForm()
      }
    } finally {
      setIsCreating(false)
    }
  }

  const handleToggleAlert = async (id: string, isActive: boolean) => {
    const { error } = await hotPartAlertService.toggleAlert(id, isActive)
    if (error) {
      toast.error('Failed to update alert')
    } else {
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, is_active: isActive } : a))
      )
      toast.success(isActive ? 'Alert activated' : 'Alert deactivated')
    }
  }

  const handleDeleteAlert = async (id: string) => {
    setDeletingId(id)
    try {
      const { success, error } = await hotPartAlertService.deleteAlert(id)
      if (error || !success) {
        toast.error('Failed to delete alert')
      } else {
        setAlerts((prev) => prev.filter((a) => a.id !== id))
        toast.success('Alert deleted')
      }
    } finally {
      setDeletingId(null)
    }
  }

  const resetForm = () => {
    setNewMatchValue('')
    setNewMatchType('any')
    setNewPriority('high')
    setNewNotes('')
    setShowAddForm(false)
  }

  const priorityColors: Record<string, string> = {
    critical:
      'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
    high: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700',
    normal:
      'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[85vh] flex-col overflow-hidden sm:max-w-[700px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Flame className='h-5 w-5 text-orange-500' />
            Hot Part Alert Management
          </DialogTitle>
          <DialogDescription>
            Configure alerts for priority parts. When a scanned value matches an
            alert rule (even as a substring), RF operators receive an immediate
            visual alert to receive and putaway the item right away.
          </DialogDescription>
        </DialogHeader>

        <div className='flex-1 space-y-4 overflow-y-auto py-2'>
          {/* Add New Alert Section */}
          {!showAddForm ? (
            <Button
              variant='outline'
              className='w-full border-dashed border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/20'
              onClick={() => setShowAddForm(true)}
            >
              <Plus className='mr-2 h-4 w-4' />
              Add New Hot Part Alert
            </Button>
          ) : (
            <Card className='border-orange-200 dark:border-orange-800'>
              <CardContent className='space-y-3 pt-4'>
                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                  <div className='space-y-1.5'>
                    <label className='text-sm font-medium'>Match Value *</label>
                    <Input
                      placeholder='e.g., 12345, SO-001, 1Z999...'
                      value={newMatchValue}
                      onChange={(e) => setNewMatchValue(e.target.value)}
                      className='border-orange-200 focus-visible:ring-orange-500 dark:border-orange-800'
                    />
                    <p className='text-muted-foreground text-xs'>
                      Matches even if the scanned value contains additional text
                    </p>
                  </div>

                  <div className='space-y-1.5'>
                    <label className='text-sm font-medium'>Match Field</label>
                    <Select
                      value={newMatchType}
                      onValueChange={(v) =>
                        setNewMatchType(v as HotPartAlert['match_type'])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(MATCH_TYPE_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='space-y-1.5'>
                    <label className='text-sm font-medium'>Priority</label>
                    <Select
                      value={newPriority}
                      onValueChange={(v) =>
                        setNewPriority(v as HotPartAlert['priority'])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PRIORITY_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='space-y-1.5'>
                    <label className='text-sm font-medium'>
                      Notes (optional)
                    </label>
                    <Textarea
                      placeholder='Instructions for the operator...'
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      className='h-[38px] min-h-[38px] resize-none'
                    />
                  </div>
                </div>

                <div className='flex justify-end gap-2 pt-1'>
                  <Button variant='ghost' size='sm' onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button
                    size='sm'
                    onClick={handleCreateAlert}
                    disabled={!newMatchValue.trim() || isCreating}
                    className='bg-orange-600 text-white hover:bg-orange-700'
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className='mr-1 h-4 w-4 animate-spin' />{' '}
                        Creating...
                      </>
                    ) : (
                      <>
                        <Flame className='mr-1 h-4 w-4' /> Create Alert
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Alerts List */}
          {isLoading ? (
            <div className='flex items-center justify-center py-8'>
              <Loader2 className='h-6 w-6 animate-spin text-orange-500' />
              <span className='text-muted-foreground ml-2'>
                Loading alerts...
              </span>
            </div>
          ) : alerts.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center'>
              <AlertTriangle className='mx-auto mb-2 h-10 w-10 text-orange-300' />
              <p className='font-medium'>No hot part alerts configured</p>
              <p className='mt-1 text-sm'>
                Add an alert above to start monitoring priority parts
              </p>
            </div>
          ) : (
            <div className='space-y-2'>
              <div className='flex items-center justify-between px-1'>
                <span className='text-muted-foreground text-sm font-medium'>
                  {alerts.filter((a) => a.is_active).length} active /{' '}
                  {alerts.length} total alerts
                </span>
              </div>
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border p-3 transition-all',
                    alert.is_active
                      ? 'bg-card border-border'
                      : 'bg-muted/30 border-muted opacity-60'
                  )}
                >
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <code className='rounded bg-orange-100 px-2 py-0.5 font-mono text-sm font-bold dark:bg-orange-900/30'>
                        {alert.match_value}
                      </code>
                      <Badge variant='outline' className='text-xs'>
                        {MATCH_TYPE_LABELS[alert.match_type]}
                      </Badge>
                      <Badge
                        className={cn(
                          'text-xs',
                          priorityColors[alert.priority]
                        )}
                      >
                        {PRIORITY_LABELS[alert.priority]}
                      </Badge>
                    </div>
                    {alert.notes && (
                      <p className='text-muted-foreground mt-1 truncate text-xs'>
                        {alert.notes}
                      </p>
                    )}
                  </div>

                  <div className='flex shrink-0 items-center gap-2'>
                    <Switch
                      checked={alert.is_active}
                      onCheckedChange={(checked) =>
                        handleToggleAlert(alert.id, checked)
                      }
                    />
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0'
                      onClick={() => handleDeleteAlert(alert.id)}
                      disabled={deletingId === alert.id}
                    >
                      {deletingId === alert.id ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : (
                        <Trash2 className='h-4 w-4' />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className='border-t pt-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const InboundScanSearch: React.FC<InboundScanSearchProps> = React.memo(
  ({ enableRealtime = true }) => {
    const [isVisible, setIsVisible] = useState(false)
    const [sortConfig, setSortConfig] = useState<SortConfig>({
      key: 'scanned_at',
      direction: 'desc',
    })
    const [hotPartAlertDialogOpen, setHotPartAlertDialogOpen] = useState(false)
    const [dropOffAreaDialogOpen, setDropOffAreaDialogOpen] = useState(false)
    const componentRef = useRef<HTMLDivElement>(null)

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

    // Use hook with server-side pagination (FAST - < 300ms)
    const {
      filteredData,
      statistics,
      isLoading,
      isFetching,
      isPageTransition, // True when showing old data while fetching new page
      isExporting,
      error,
      searchQuery,
      setSearchQuery,
      refreshData,
      exportAllToCSV,
      isUsingRust,
      // Server-side pagination from hook
      totalRecords,
      currentPage,
      totalPages,
      pageSize: recordsPerPage,
      setCurrentPage,
    } = useInboundScans({ enableRealtime: shouldEnableRealtime })

    // Only show full loading state on initial load, not on page transitions
    const showFullLoading = isLoading && !isPageTransition

    // Sort the current page data (client-side sorting of server-fetched page)
    const sortedData = useMemo(() => {
      const processedData = [...filteredData]

      // Apply sorting to the current page only
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
          } else if (
            typeof aValue === 'boolean' &&
            typeof bValue === 'boolean'
          ) {
            comparison = aValue === bValue ? 0 : aValue ? -1 : 1
          } else if (sortConfig.key.toString().includes('_at')) {
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
    }, [filteredData, sortConfig])

    // Current page data is already fetched from server - just use sortedData
    const currentPageData = sortedData
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = Math.min(startIndex + recordsPerPage, totalRecords)

    // Sorting handler
    const handleSort = useCallback((key: keyof InboundScansWithUser[0]) => {
      setSortConfig((prevConfig) => ({
        key,
        direction:
          prevConfig?.key === key && prevConfig.direction === 'asc'
            ? 'desc'
            : 'asc',
      }))
    }, [])

    // Handle export data - exports ALL records, not just current page
    const handleExportData = useCallback(async () => {
      if (totalRecords === 0) {
        toast.warning('No data to export')
        return
      }

      try {
        toast.info(
          `Fetching all ${totalRecords.toLocaleString()} records for export...`
        )

        const result = await exportAllToCSV()

        if (!result) {
          return // Error already shown by exportAllToCSV
        }

        const { csv: csvContent, count } = result

        // Download CSV file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute(
          'download',
          `inbound-scans-${new Date().toISOString().split('T')[0]}.csv`
        )
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        toast.success(`Exported ${count.toLocaleString()} scans successfully`)
      } catch (error) {
        toast.error('Export failed')
        logger.error('Export error:', error)
      }
    }, [totalRecords, exportAllToCSV])

    // Pagination handlers (server-side pagination via hook)
    const goToPage = useCallback(
      (page: number) => {
        if (page >= 1 && page <= totalPages) {
          setCurrentPage(page)
        }
      },
      [totalPages, setCurrentPage]
    )

    const goToPreviousPage = useCallback(() => {
      if (currentPage > 1) {
        setCurrentPage(currentPage - 1)
      }
    }, [currentPage, setCurrentPage])

    const goToNextPage = useCallback(() => {
      if (currentPage < totalPages) {
        setCurrentPage(currentPage + 1)
      }
    }, [currentPage, totalPages, setCurrentPage])

    // Get cell content based on column
    const getCellContent = (
      item: InboundScanWithTransfer,
      column: TableColumn
    ) => {
      if (isTransferVirtualKey(column.key)) {
        const transfer = item.latest_transfer
        if (!transfer) {
          return <span className='text-muted-foreground'>—</span>
        }

        switch (column.key) {
          case 'drop_off_area':
            return (
              <div className='flex flex-col gap-0.5'>
                <Badge
                  variant='outline'
                  className='w-fit border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                >
                  {transfer.area_name || 'Unknown area'}
                </Badge>
                {transfer.area_barcode && (
                  <span
                    className='text-muted-foreground font-mono text-[10px]'
                    title={transfer.area_barcode}
                  >
                    {transfer.area_barcode}
                  </span>
                )}
              </div>
            )
          case 'dropped_off_by':
            return (
              <div className='flex flex-col gap-0.5'>
                <span className='text-foreground text-sm'>
                  {transfer.dropped_off_by_name ||
                    transfer.dropped_off_by_email ||
                    'Unknown user'}
                </span>
                <span className='text-muted-foreground text-[10px]'>
                  {formatDateTimeEST(transfer.dropped_off_at)}
                </span>
              </div>
            )
          case 'accepted_by':
            return (
              <div className='flex flex-col gap-0.5'>
                <span className='text-foreground text-sm font-medium'>
                  {transfer.associate_name ||
                    transfer.associate_email ||
                    'Unknown associate'}
                </span>
                {transfer.associate_email && (
                  <span
                    className='text-muted-foreground truncate font-mono text-[10px]'
                    title={transfer.associate_email}
                  >
                    {transfer.associate_email}
                  </span>
                )}
              </div>
            )
        }
      }

      const scanKey = column.key as keyof InboundScansWithUser[0]
      const value = item[scanKey]

      switch (scanKey) {
        case 'hot_truck':
          return <HotTruckBadge isHotTruck={value as boolean} />
        case 'quantity':
          return value !== null && value !== undefined ? `${value}` : 'N/A'
        case 'scanned_at':
        case 'created_at':
          return formatDateTimeEST(value as string)
        case 'scanned_by_profile':
          // eslint-disable-next-line no-case-declarations
          const profile = value as
            | { full_name?: string; email?: string }
            | null
            | undefined
          return profile?.full_name || profile?.email || 'N/A'
        case 'notes':
          return value ? (
            <span
              className='block max-w-[200px] truncate'
              title={value as string}
            >
              {value as string}
            </span>
          ) : (
            'N/A'
          )
        default:
          return value != null && typeof value !== 'object'
            ? String(value)
            : 'N/A'
      }
    }

    // Show error state
    if (error) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='p-6'>
            <div className='text-destructive text-center'>
              <p>Failed to load inbound scan data: {error.message}</p>
              <Button onClick={refreshData} className='mt-4'>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    }

    // Memoized statistics cards to prevent unnecessary re-renders
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const StatisticsCards = useMemo(
      () => (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Total Scanned Today
              </CardTitle>
              <Scan className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.todayScans || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                {statistics?.totalScans || 0} total scans
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Weekly Average
              </CardTitle>
              <Package className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.weeklyAverage || 0}
              </div>
              <p className='text-muted-foreground text-xs'>Scans per week</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                {statistics?.dayOfWeekName || 'Today'}'s Average
              </CardTitle>
              <MapPin className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.dayOfWeekAverage || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Average for {statistics?.dayOfWeekName || 'this day'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Hot Truck</CardTitle>
              <Truck className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.hotTruckScans || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Priority hot truck items
              </p>
            </CardContent>
          </Card>
        </div>
      ),
      [statistics]
    )

    return (
      <div ref={componentRef} className='space-y-6'>
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
                    Inbound Scan Search
                  </h2>
                  <div className='relative max-w-sm flex-1'>
                    <Search
                      className={cn(
                        'absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 transform',
                        isUsingRust ? 'text-blue-500' : 'text-muted-foreground'
                      )}
                    />
                    <RustPoweredSearchInput
                      placeholder='Search scans, materials, locations...'
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
                    onClick={handleExportData}
                    disabled={totalRecords === 0 || isExporting}
                    className='border-border hover:bg-accent'
                  >
                    {isExporting ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : (
                      <Download className='mr-2 h-4 w-4' />
                    )}
                    {isExporting ? 'Exporting...' : 'Export All'}
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
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDropOffAreaDialogOpen(true)}
                        className='text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/20'
                      >
                        <MapPin className='mr-2 h-4 w-4' />
                        Manage Drop-off Areas
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setHotPartAlertDialogOpen(true)}
                        className='text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950/20'
                      >
                        <Flame className='mr-2 h-4 w-4' />
                        Hot Part Alert
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {showFullLoading ? (
              <div className='flex items-center justify-center py-12'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <span className='ml-2'>Loading inbound scan data...</span>
              </div>
            ) : (
              <div className='relative'>
                {/* Subtle loading overlay for page transitions */}
                {isPageTransition && (
                  <div className='bg-background/50 absolute inset-0 z-10 flex items-center justify-center rounded-md'>
                    <div className='bg-background/90 flex items-center gap-2 rounded-full border px-4 py-2 shadow-sm'>
                      <Loader2 className='h-4 w-4 animate-spin text-blue-500' />
                      <span className='text-muted-foreground text-sm'>
                        Loading page {currentPage}...
                      </span>
                    </div>
                  </div>
                )}
                <div
                  className={cn(
                    'border-border overflow-hidden rounded-md border transition-opacity duration-150',
                    isPageTransition && 'opacity-60'
                  )}
                >
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
                                  column.key === 'material_number'
                                    ? 'text-foreground font-medium'
                                    : column.key === 'notes'
                                      ? 'text-muted-foreground'
                                      : 'text-foreground'
                                }`}
                              >
                                {getCellContent(item, column)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={DEFAULT_COLUMNS.length}
                            className='text-muted-foreground py-8 text-center'
                          >
                            {totalRecords === 0 && !searchQuery
                              ? 'No inbound scan data found.'
                              : 'No data found matching your search criteria.'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {!showFullLoading && (
              <div className='mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                {/* Left side: Info and status indicators */}
                <div className='text-muted-foreground flex items-center gap-4 text-sm'>
                  <span>
                    Showing {totalRecords > 0 ? startIndex + 1 : 0}-
                    {Math.min(endIndex, totalRecords)} of{' '}
                    {totalRecords.toLocaleString()} entries
                    {searchQuery && ' (filtered)'}
                  </span>
                  {enableRealtime && (
                    <span className='flex items-center gap-1 text-green-500'>
                      ● Live Updates
                    </span>
                  )}
                  {isUsingRust && (
                    <span className='flex items-center gap-1 text-blue-500'>
                      ● Rust-Powered
                    </span>
                  )}
                  {isPageTransition && (
                    <span className='flex items-center gap-1 text-amber-500'>
                      <Loader2 className='h-3 w-3 animate-spin' /> Loading...
                    </span>
                  )}
                  {sortConfig && !isPageTransition && (
                    <span className='flex items-center gap-1 text-purple-600'>
                      ● Sorted by{' '}
                      {
                        DEFAULT_COLUMNS.find(
                          (col) => col.key === sortConfig.key
                        )?.label
                      }{' '}
                      ({sortConfig.direction === 'asc' ? 'A-Z' : 'Z-A'})
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
                        disabled={currentPage === 1 || isPageTransition}
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
                                disabled={isPageTransition}
                                className={cn(
                                  'h-8 w-8 p-0 text-xs transition-all',
                                  isPageTransition &&
                                    currentPage === pageNum &&
                                    'animate-pulse'
                                )}
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
                        disabled={
                          currentPage === totalPages || isPageTransition
                        }
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
                    disabled={isFetching}
                    className='border-border'
                  >
                    {isFetching ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      'Refresh'
                    )}
                  </Button>
                  {searchQuery && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setSearchQuery('')}
                      className='border-border'
                    >
                      Clear Search
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hot Part Alert Management Dialog */}
        <HotPartAlertDialog
          open={hotPartAlertDialogOpen}
          onOpenChange={setHotPartAlertDialogOpen}
        />

        {/* Drop-off Area Management Dialog */}
        <DropOffAreaManagerDialog
          open={dropOffAreaDialogOpen}
          onOpenChange={setDropOffAreaDialogOpen}
        />
      </div>
    )
  }
)

InboundScanSearch.displayName = 'InboundScanSearch'

export default InboundScanSearch

// Created and developed by Jai Singh
