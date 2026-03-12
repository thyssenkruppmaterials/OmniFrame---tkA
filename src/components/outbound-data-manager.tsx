import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database as DatabaseIcon,
  Download,
  Eye,
  FileText,
  Filter,
  Loader2,
  MoreHorizontal,
  Package,
  RotateCcw,
  Scan,
  Search,
  Upload,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import type { Database, PutbackTicket } from '@/lib/supabase/database.types'
import {
  OutboundTODataService,
  type OutboundTOData,
} from '@/lib/supabase/outbound-to-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useOutboundTOData } from '@/hooks/use-outbound-to-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { WaveDeliveryDialog } from '@/components/ui/wave-delivery-dialog'

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

interface OutboundDataManagerProps {
  enableRealtime?: boolean
}

interface TableColumn {
  id: string
  label: string
  key: keyof OutboundTOData
  width?: string
}

// Fixed column configuration as requested by user
const FIXED_COLUMNS: TableColumn[] = [
  { id: 'delivery', label: 'Delivery', key: 'delivery', width: 'w-24' },
  {
    id: 'transfer_order_number',
    label: 'Transfer Order Number',
    key: 'transfer_order_number',
    width: 'w-32',
  },
  {
    id: 'transfer_order_priority',
    label: 'Transfer Order Priority',
    key: 'transfer_order_priority',
    width: 'w-32',
  },
  { id: 'material', label: 'Material', key: 'material', width: 'w-28' },
  {
    id: 'material_description',
    label: 'Description',
    key: 'material_description',
    width: 'w-48',
  },
  {
    id: 'source_target_qty',
    label: 'Quantity',
    key: 'source_target_qty',
    width: 'w-24',
  },
  { id: 'status', label: 'Status', key: 'status', width: 'w-36' },
]

// Fixed header component (no drag-and-drop functionality)
function FixedTableHeader({ column }: { column: TableColumn }) {
  return (
    <TableHead className={`text-foreground font-medium ${column.width}`}>
      {column.label}
    </TableHead>
  )
}

// Status badge component (read-only - updated through workflow actions)
function StatusBadge({ status }: { status: string }) {
  const getStatusStyles = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'bg-gray-300 text-gray-800 border-gray-400'
      case 'processing':
        return 'bg-teal-100 text-teal-800 border-teal-400'
      case 'picked':
        return 'bg-blue-100 text-blue-800 border-blue-400'
      case 'picked_short':
      case 'short_pick':
      case 'short pick':
        return 'bg-yellow-300 text-yellow-800 border-2 border-pink-500'
      case 'picked_bulk':
      case 'split_pick':
      case 'split pick':
        return 'bg-orange-100 text-orange-800 border-orange-400'
      case 'not_in_location':
      case 'not in location':
        return 'bg-red-100 text-red-800 border-2 border-red-500'
      case 'packed':
        return 'bg-blue-500 text-white border-blue-600'
      case 'shipped':
        return 'bg-green-200 text-green-800 border-green-400'
      case 'final_packed':
      case 'final packed':
        return 'bg-green-800 text-white border-green-900'
      case 'completed':
        return 'bg-green-200 text-green-800 border-green-400'
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-400'
      case 'on_hold':
      case 'on hold':
        return 'bg-yellow-100 text-yellow-800 border-yellow-400'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  // Enhanced status display names for better user experience
  const getStatusDisplayName = (status: string) => {
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
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusStyles(status)}`}
    >
      {getStatusDisplayName(status)}
    </span>
  )
}

const OutboundDataManager: React.FC<OutboundDataManagerProps> = React.memo(
  ({ enableRealtime = true }) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [isVisible, setIsVisible] = useState(false)
    const [isWaveDialogOpen, setIsWaveDialogOpen] = useState(false)
    const [selectedItem, setSelectedItem] = useState<OutboundTOData | null>(
      null
    )
    const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
    const [isSmartImporting, setIsSmartImporting] = useState(false)
    const [isModifyDialogOpen, setIsModifyDialogOpen] = useState(false)
    const [modifySearchIdentifier, setModifySearchIdentifier] = useState('')
    const [modifySearchResults, setModifySearchResults] = useState<
      OutboundTOData[]
    >([])
    const [isSearching, setIsSearching] = useState(false)
    const [editingItem, setEditingItem] = useState<OutboundTOData | null>(null)
    const [editQuantity, setEditQuantity] = useState('')
    const [editStatus, setEditStatus] = useState('')
    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 25

    // Intersection Observer to only enable real-time updates when component is visible
    useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          setIsVisible(entry.isIntersecting)
        },
        {
          threshold: 0.1, // Component is visible when 10% is in viewport
          rootMargin: '50px', // Start loading slightly before component is visible
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

    // Local search query state for input control
    const [localSearchQuery, setLocalSearchQuery] = useState('')

    // Critical filter state (November 18, 2025)
    const [showCriticalOnly, setShowCriticalOnly] = useState(false)

    // Status filter states for stat card filters (January 2026)
    const [showWavedOnly, setShowWavedOnly] = useState(false)
    const [showPickedOnly, setShowPickedOnly] = useState(false)
    const [showShippedOnly, setShowShippedOnly] = useState(false)

    // Status-filtered data from database (bypasses 1000 row limit)
    const [statusFilteredData, setStatusFilteredData] = useState<
      OutboundTOData[]
    >([])
    const [isLoadingStatusFilter, setIsLoadingStatusFilter] = useState(false)

    const {
      data,
      isLoading,
      error,
      statistics,
      importFromClipboard,
      refreshData,
      isImporting,
      isUsingRust,
    } = useOutboundTOData({
      enableRealtime: shouldEnableRealtime,
      searchQuery: localSearchQuery,
    })

    // Fetch status-filtered data directly from database when a status filter is active
    // This bypasses the 1000 row limit to match stat card counts exactly
    useEffect(() => {
      const fetchStatusFilteredData = async () => {
        const service = OutboundTODataService.getInstance()
        const cutoffDate = '2026-01-01'

        try {
          setIsLoadingStatusFilter(true)

          if (showCriticalOnly) {
            // Fetch critical deliveries using dedicated service method
            const result = await service.fetchCriticalDeliveries()
            setStatusFilteredData(result)
          } else if (showWavedOnly) {
            const result = await service.fetchByStatuses(
              ['processing'],
              cutoffDate
            )
            setStatusFilteredData(result)
          } else if (showPickedOnly) {
            // Matches stat card: picked, picked_short, picked_bulk
            const result = await service.fetchByStatuses(
              ['picked', 'picked_short', 'picked_bulk'],
              cutoffDate
            )
            setStatusFilteredData(result)
          } else if (showShippedOnly) {
            const result = await service.fetchByStatuses(
              ['shipped'],
              cutoffDate
            )
            setStatusFilteredData(result)
          } else {
            setStatusFilteredData([])
          }
        } catch (error) {
          logger.error('Error fetching status-filtered data:', error)
          toast.error('Failed to fetch filtered data')
          setStatusFilteredData([])
        } finally {
          setIsLoadingStatusFilter(false)
        }
      }

      if (
        showCriticalOnly ||
        showWavedOnly ||
        showPickedOnly ||
        showShippedOnly
      ) {
        fetchStatusFilteredData()
      } else {
        setStatusFilteredData([])
      }
    }, [showCriticalOnly, showWavedOnly, showPickedOnly, showShippedOnly])

    // Use fixed columns (no reordering allowed)
    const fixedColumns = useMemo(() => FIXED_COLUMNS, [])

    // Filter data to hide 'final_packed' status by default
    // Search is now handled at database level by the hook
    const filteredData = useMemo(() => {
      // When a status filter is active, use the database-fetched data instead of local filtering
      // This ensures the count matches the stat cards exactly (no 1000 row limit)
      if (
        showCriticalOnly ||
        showWavedOnly ||
        showPickedOnly ||
        showShippedOnly
      ) {
        return statusFilteredData
      }

      return data.filter((item) => {
        const status =
          ((item as Record<string, unknown>).status as string)?.toLowerCase() ||
          ''
        const isFinalPacked =
          status === 'final_packed' || status === 'final packed'

        // If no search query, hide final_packed items by default
        if (!localSearchQuery.trim()) {
          return !isFinalPacked
        }

        // If searching for status-related terms, show all results from database
        const searchLower = localSearchQuery.toLowerCase().replace(/\s+/g, '')
        const statusSearchTerms = [
          'finalpack',
          'finalpacked',
          'packed',
          'shipped',
          'pending',
          'processing',
          'picked',
          'completed',
          'cancelled',
          'onhold',
          'status',
        ]
        const isStatusSearch = statusSearchTerms.some((term) =>
          searchLower.includes(term)
        )

        if (isStatusSearch) {
          // When searching for status, show ALL results including final_packed
          return true
        }

        // For non-status searches, only show final_packed if it matches the search
        // (database already filtered, so just include all results)
        return true
      })
    }, [
      data,
      localSearchQuery,
      showCriticalOnly,
      showWavedOnly,
      showPickedOnly,
      showShippedOnly,
      statusFilteredData,
    ])

    // Pagination calculations
    const totalRecords = filteredData.length
    const totalPages = Math.ceil(totalRecords / recordsPerPage)
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = startIndex + recordsPerPage
    const currentPageData = filteredData.slice(startIndex, endIndex)

    // Reset to first page when search changes
    React.useEffect(() => {
      setCurrentPage(1)
    }, [localSearchQuery])

    // No drag-and-drop handlers needed for fixed columns

    // Handle import from clipboard
    const handleImportData = useCallback(async () => {
      try {
        await importFromClipboard()
      } catch (error) {
        logger.error('Import failed:', error)
      }
    }, [importFromClipboard])

    // Handle Smart Import from Smartsheet (uses Rust service when available for 10x performance)
    const handleSmartImport = useCallback(async () => {
      try {
        setIsSmartImporting(true)

        // Get auth token from Supabase
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError || !session) {
          toast.error('Authentication required for Smart Import')
          return
        }

        // Import the hybrid service dynamically to avoid circular dependencies
        const { hybridSmartsheetService } =
          await import('@/lib/rust-core/smartsheet.service')

        logger.log(
          '🚀 Smart Import: Starting with hybrid service (Rust + Python fallback)...'
        )
        toast.info('Fetching data from Smartsheet...', { duration: 2000 })

        // Use hybrid service - tries Rust first, falls back to Python
        const result = await hybridSmartsheetService.importOutboundData(
          session.access_token,
          {
            use_cache: true,
          }
        )

        logger.log(
          `📡 Smart Import: Response from ${result.source} service in ${result.execution_time_ms}ms`
        )

        if (result.source === 'rust') {
          logger.log('🦀 Smart Import: Using high-performance Rust backend')
        } else {
          logger.log('🐍 Smart Import: Using Python backend (fallback)')
        }

        logger.log(
          '📦 Smart Import: API Response Data (FULL):',
          JSON.stringify(result, null, 2)
        )

        // Check if we have data
        if (!result || typeof result !== 'object' || !result.success) {
          throw new Error('Invalid response format from API')
        }

        // Use the normalized data from hybrid service
        const data = result.data

        if (!data.headers || !data.rows) {
          logger.error('❌ Smart Import: Missing headers or rows:', data)
          throw new Error('Invalid data structure: missing headers or rows')
        }

        const { headers, rows, sheet_name, total_rows } = data

        logger.log(
          `✅ Smart Import: Received ${rows?.length || 0} rows with ${headers?.length || 0} columns`
        )
        toast.success(
          `Fetched ${total_rows || rows.length} rows from Smartsheet${sheet_name ? ` "${sheet_name}"` : ''}`,
          { duration: 3000 }
        )

        // Import the data using the service layer
        const { OutboundTODataService } =
          await import('@/lib/supabase/outbound-to-data.service')
        const outboundService = OutboundTODataService.getInstance()

        // Transform the Smartsheet data to clipboard format
        const clipboardText = [
          headers.join('\t'),
          ...rows.map((row: string[]) => row.join('\t')),
        ].join('\n')

        logger.log('📋 Smart Import: Writing to clipboard...', {
          headerCount: headers.length,
          rowCount: rows.length,
          sampleHeader: headers.slice(0, 3).join(', '),
        })

        // Write to clipboard
        await navigator.clipboard.writeText(clipboardText)

        toast.info('Importing data from Smartsheet...', { duration: 2000 })

        // Call the import method
        const importResult = await outboundService.importFromClipboard()
        logger.log('💾 Smart Import: Import result:', importResult)

        if (importResult.success) {
          // Refresh the data
          await refreshData()
        }
      } catch (error) {
        logger.error('❌ Smart Import failed:', error)
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred'
        toast.error(`Smart Import failed: ${errorMessage}`)
      } finally {
        setIsSmartImporting(false)
      }
    }, [refreshData])

    // Handle export data with current column order (memoized)
    const handleExportData = useCallback(() => {
      if (filteredData.length === 0) {
        toast.warning('No data to export')
        return
      }

      try {
        // Create CSV content with fixed column order
        const csvHeaders = fixedColumns.map((col) => col.label)
        const csvContent = [
          csvHeaders.join(','),
          ...filteredData.map((row: Record<string, unknown>) =>
            fixedColumns
              .map((col) => {
                const value = row[col.key]
                return `"${value || ''}"`
              })
              .join(',')
          ),
        ].join('\n')

        // Download CSV file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute(
          'download',
          `outbound-to-data-${new Date().toISOString().split('T')[0]}.csv`
        )
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        toast.success(`Exported ${filteredData.length} records`)
      } catch (error) {
        toast.error('Export failed')
        logger.error('Export error:', error)
      }
    }, [filteredData, fixedColumns])

    // Modify TO handlers
    const handleSearchModify = useCallback(async () => {
      if (!modifySearchIdentifier.trim()) {
        toast.error('Please enter a Delivery # or Transfer Order #')
        return
      }

      try {
        setIsSearching(true)
        const service = OutboundTODataService.getInstance()
        const results = await service.searchByDeliveryOrTO(
          modifySearchIdentifier
        )

        setModifySearchResults(results)

        if (results.length === 0) {
          toast.info(`No records found for "${modifySearchIdentifier}"`)
        } else {
          toast.success(`Found ${results.length} record(s)`)
        }
      } catch (error) {
        logger.error('Search error:', error)
        toast.error('Failed to search records')
      } finally {
        setIsSearching(false)
      }
    }, [modifySearchIdentifier])

    const handleStartEdit = useCallback((item: OutboundTOData) => {
      setEditingItem(item)
      setEditQuantity(item.source_target_qty?.toString() || '')
      setEditStatus(item.status || 'pending')
    }, [])

    const handleCancelEdit = useCallback(() => {
      setEditingItem(null)
      setEditQuantity('')
      setEditStatus('')
    }, [])

    const handleUpdateItem = useCallback(async () => {
      if (!editingItem) return

      try {
        const service = OutboundTODataService.getInstance()
        const updates: Record<string, unknown> = {}

        // Update quantity if changed
        if (
          editQuantity &&
          editQuantity !== editingItem.source_target_qty?.toString()
        ) {
          updates.source_target_qty = parseFloat(editQuantity)
        }

        // Update status if changed
        if (editStatus && editStatus !== editingItem.status) {
          updates.status = editStatus
        }

        if (Object.keys(updates).length === 0) {
          toast.info('No changes to save')
          handleCancelEdit()
          return
        }

        await service.updateOutboundData(editingItem.id, updates)

        // Refresh the data
        await refreshData()

        // Re-search to update results
        await handleSearchModify()

        toast.success('Record updated successfully')
        handleCancelEdit()
      } catch (error) {
        logger.error('Update error:', error)
        toast.error('Failed to update record')
      }
    }, [
      editingItem,
      editQuantity,
      editStatus,
      handleCancelEdit,
      handleSearchModify,
      refreshData,
    ])

    const handleDeleteItem = useCallback(
      async (item: OutboundTOData) => {
        if (
          !confirm(
            `Are you sure you want to delete this record?\n\nDelivery: ${item.delivery}\nMaterial: ${item.material}\nQuantity: ${item.source_target_qty}`
          )
        ) {
          return
        }

        try {
          const service = OutboundTODataService.getInstance()
          await service.deleteOutboundData(item.id)

          // Refresh the data
          await refreshData()

          // Re-search to update results
          await handleSearchModify()

          toast.success('Record deleted successfully')
        } catch (error) {
          logger.error('Delete error:', error)
          toast.error('Failed to delete record')
        }
      },
      [handleSearchModify, refreshData]
    )

    const handleCloseModifyDialog = useCallback(() => {
      setIsModifyDialogOpen(false)
      setModifySearchIdentifier('')
      setModifySearchResults([])
      handleCancelEdit()
    }, [handleCancelEdit])

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

    // Status updates are now handled through workflow actions only

    // Handle Wave Delivery scanning
    const handleWaveDeliveryScan = useCallback(
      async (
        deliveryNumber: string
      ): Promise<{ success: boolean; message: string }> => {
        try {
          // Get the service instance
          const service = OutboundTODataService.getInstance()

          // ✅ FIX: Query database directly instead of searching loaded data
          // This ensures we can find deliveries even if they're not in the current 1000-row limit
          logger.log(`🔍 Wave Scanner: Verifying delivery ${deliveryNumber}...`)
          const verification =
            await service.verifyDeliveryForWave(deliveryNumber)

          if (!verification.exists) {
            return {
              success: false,
              message: `Delivery ${deliveryNumber} not found in database`,
            }
          }

          // Check if ALL rows of the delivery are in pending status
          if (!verification.allPending) {
            return {
              success: false,
              message: `Delivery ${deliveryNumber} is not in pending status (currently: ${verification.currentStatus})`,
            }
          }

          // Update ALL rows of the delivery to processing
          const updatedRows = await service.updateDeliveryStatus(
            deliveryNumber.toString(),
            'processing' as Database['public']['Enums']['outbound_status']
          )

          logger.log(
            `✅ Wave Delivery: Successfully waved ${updatedRows.length} row(s) for delivery ${deliveryNumber}`
          )

          // Refresh the data to show updated status
          await refreshData()

          return {
            success: true,
            message: `Delivery ${deliveryNumber} successfully waved! (${updatedRows.length} line${updatedRows.length > 1 ? 's' : ''})`,
          }
        } catch (error) {
          logger.error('Wave delivery scan failed:', error)
          return {
            success: false,
            message: `Failed to wave delivery ${deliveryNumber}. Please try again.`,
          }
        }
      },
      [refreshData]
    )

    // Format date for display
    const formatDate = (dateString: string | null) => {
      if (!dateString) return 'N/A'
      try {
        return formatDistanceToNow(new Date(dateString), { addSuffix: true })
      } catch {
        return dateString
      }
    }

    // Get the relevant timestamp for a status
    const getStatusTimestamp = (item: OutboundTOData): string | null => {
      const status = item.status?.toLowerCase() || ''
      switch (status) {
        case 'processing':
          return item.waved_at || null
        case 'picked':
        case 'picked_short':
        case 'picked_bulk':
        case 'short_pick':
        case 'split_pick':
          return item.picked_at || null
        case 'packed':
          return item.packed_at || null
        case 'shipped':
          return item.shipped_at || null
        case 'final_packed':
          return item.final_packed_at || null
        default:
          return item.updated_at || null
      }
    }

    // Get cell content based on column
    const getCellContent = (item: OutboundTOData, column: TableColumn) => {
      const value = item[column.key]

      switch (column.key) {
        case 'status':
          // eslint-disable-next-line no-case-declarations
          const statusTimestamp = getStatusTimestamp(item)
          return (
            <div className='flex flex-col gap-0.5'>
              <StatusBadge status={(value as string) || 'pending'} />
              {statusTimestamp && (
                <span className='text-muted-foreground text-[10px] whitespace-nowrap'>
                  {formatDistanceToNow(new Date(statusTimestamp), {
                    addSuffix: true,
                  })}
                </span>
              )}
            </div>
          )
        case 'created_at':
          return formatDate(value as string)
        case 'material_description':
          return (
            <span
              className='block max-w-[200px] truncate'
              title={(value as string) || ''}
            >
              {(value as string) || 'N/A'}
            </span>
          )
        default:
          // Ensure we return a string value for all other columns
          return typeof value === 'string' || typeof value === 'number'
            ? value || 'N/A'
            : 'N/A'
      }
    }

    // State for user names
    const [userNames, setUserNames] = useState<Record<string, string>>({})
    // State for putback tickets
    const [putbackTickets, setPutbackTickets] = useState<PutbackTicket[]>([])

    // Fetch user names by UUIDs
    const fetchUserNames = useCallback(async (userIds: (string | null)[]) => {
      try {
        // Filter out null values and get unique IDs
        const uniqueIds = [
          ...new Set(userIds.filter((id) => id !== null)),
        ] as string[]

        if (uniqueIds.length === 0) return {}

        const { data, error } = await supabase
          .from('user_profiles')
          .select('id, first_name, last_name, full_name, email')
          .in('id', uniqueIds)

        if (error) {
          logger.error('Error fetching user names:', error)
          return {}
        }

        // Create a map of user ID to display name
        const nameMap: Record<string, string> = {}
        data?.forEach((user) => {
          // Priority: full_name > first_name + last_name > email
          if (user.full_name) {
            nameMap[user.id] = user.full_name
          } else if (user.first_name && user.last_name) {
            nameMap[user.id] = `${user.first_name} ${user.last_name}`
          } else if (user.first_name) {
            nameMap[user.id] = user.first_name
          } else {
            nameMap[user.id] = user.email || user.id
          }
        })

        return nameMap
      } catch (error) {
        logger.error('Error in fetchUserNames:', error)
        return {}
      }
    }, [])

    // Fetch putback tickets for a delivery
    const fetchPutbackTickets = useCallback(async (deliveryId: string) => {
      try {
        const { data, error } = await supabase
          .from('putback_tickets')
          .select('*')
          .eq('delivery_id', deliveryId)
          .order('created_at', { ascending: false })

        if (error) {
          logger.error('Error fetching putback tickets:', error)
          return []
        }

        return data || []
      } catch (error) {
        logger.error('Error in fetchPutbackTickets:', error)
        return []
      }
    }, [])

    // Handle view details click
    const handleViewDetails = useCallback(
      async (item: OutboundTOData) => {
        setSelectedItem(item)
        setIsDetailsDialogOpen(true)

        // Fetch user names for all user IDs in this delivery
        const userIds: (string | null)[] = [
          item.uploaded_by || null,
          item.waved_by || null,
          item.picked_by || null,
          item.packed_by || null,
          item.shipped_by || null,
          item.final_packed_by || null,
          item.wawf_placed_by || null,
        ]

        const names = await fetchUserNames(userIds)
        setUserNames(names)

        // Fetch putback tickets for this delivery
        const tickets = await fetchPutbackTickets(item.delivery || '')
        setPutbackTickets(tickets)

        // If we have putback tickets, also fetch user names for ticket creators
        if (tickets.length > 0) {
          const ticketUserIds = tickets.map((t) => t.created_by).filter(Boolean)
          const ticketNames = await fetchUserNames(ticketUserIds)
          setUserNames((prev) => ({ ...prev, ...ticketNames }))
        }
      },
      [fetchUserNames, fetchPutbackTickets]
    )

    // Helper function to get user name or fallback
    const getUserDisplayName = useCallback(
      (userId: string | null | undefined): string => {
        if (!userId) return 'Unknown'
        return userNames[userId] || userId // Fallback to UUID if name not loaded yet
      },
      [userNames]
    )

    // No sensors needed for fixed columns

    // Show error state
    if (error) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='p-6'>
            <div className='text-destructive text-center'>
              <p>Failed to load outbound data: {error.message}</p>
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
                Delivery Status
              </CardTitle>
              <FileText className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                {/* Pending Deliveries */}
                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {statistics?.pendingCount?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Pending</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                {/* Waved Today */}
                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {statistics?.wavedToday?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Waved Today</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                {/* Critical Deliveries */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-red-600'>
                    {statistics?.criticalDeliveries?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Critical</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Picks Available
              </CardTitle>
              <Scan className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                {/* Waved (Ready to Pick) */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-teal-600'>
                    {statistics?.picksAvailable?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Waved</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                {/* Picked Today */}
                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {statistics?.pickedToday?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Picked Today</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Packing Available
              </CardTitle>
              <Package className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                {/* Picked (Ready to Pack) */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-blue-600'>
                    {statistics?.packingAvailable?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Picked</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                {/* Packed Today */}
                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {statistics?.packedToday?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Packed Today</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Deliveries Shipped Today
              </CardTitle>
              <CheckCircle2 className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                {/* Shipped (Ready for Final Pack) */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-purple-600'>
                    {statistics?.shippedAvailable?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Shipped</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                {/* Final Packed Today */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-green-600'>
                    {statistics?.finalPackedToday?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    Final Packed Today
                  </p>
                </div>
              </div>
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
                    Outbound Transfer Orders
                  </h2>
                  <div className='relative max-w-sm flex-1'>
                    <Search
                      className={cn(
                        'absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 transform',
                        isUsingRust ? 'text-blue-500' : 'text-muted-foreground'
                      )}
                    />
                    <RustPoweredSearchInput
                      placeholder='Search orders, materials, status...'
                      value={localSearchQuery}
                      onChange={(e) => setLocalSearchQuery(e.target.value)}
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

                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setIsWaveDialogOpen(true)}
                    className='border-border hover:bg-accent'
                  >
                    <Zap className='mr-2 h-4 w-4' />
                    Wave Delivery
                  </Button>

                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setIsModifyDialogOpen(true)}
                    className='border-border hover:bg-accent'
                  >
                    <FileText className='mr-2 h-4 w-4' />
                    Modify TO
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='outline'
                        size='sm'
                        className='border-border hover:bg-accent'
                        disabled={isSmartImporting}
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
                        onClick={handleExportData}
                        disabled={filteredData.length === 0}
                        className='hover:bg-accent'
                      >
                        <Download className='mr-2 h-4 w-4' />
                        Export
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleSmartImport}
                        disabled={isSmartImporting}
                        className='hover:bg-accent'
                      >
                        {isSmartImporting ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            Smart Import (Processing...)
                          </>
                        ) : (
                          <>
                            <DatabaseIcon className='mr-2 h-4 w-4' />
                            Smart Import
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowCriticalOnly(!showCriticalOnly)
                          // Clear other status filters when toggling critical
                          setShowWavedOnly(false)
                          setShowPickedOnly(false)
                          setShowShippedOnly(false)
                          setCurrentPage(1) // Reset to first page when filter changes
                        }}
                        className='hover:bg-accent'
                      >
                        <AlertTriangle
                          className={`mr-2 h-4 w-4 ${showCriticalOnly ? 'text-red-600' : ''}`}
                        />
                        {showCriticalOnly ? 'Show All' : 'Critical Only'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowWavedOnly(!showWavedOnly)
                          // Clear other filters when toggling this one
                          setShowCriticalOnly(false)
                          setShowPickedOnly(false)
                          setShowShippedOnly(false)
                          setCurrentPage(1)
                        }}
                        className='hover:bg-accent'
                      >
                        <Zap
                          className={`mr-2 h-4 w-4 ${showWavedOnly ? 'text-teal-600' : ''}`}
                        />
                        {showWavedOnly ? 'Show All' : 'Waved Only'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowPickedOnly(!showPickedOnly)
                          // Clear other filters when toggling this one
                          setShowCriticalOnly(false)
                          setShowWavedOnly(false)
                          setShowShippedOnly(false)
                          setCurrentPage(1)
                        }}
                        className='hover:bg-accent'
                      >
                        <Scan
                          className={`mr-2 h-4 w-4 ${showPickedOnly ? 'text-blue-600' : ''}`}
                        />
                        {showPickedOnly ? 'Show All' : 'Picked Only'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowShippedOnly(!showShippedOnly)
                          // Clear other filters when toggling this one
                          setShowCriticalOnly(false)
                          setShowWavedOnly(false)
                          setShowPickedOnly(false)
                          setCurrentPage(1)
                        }}
                        className='hover:bg-accent'
                      >
                        <CheckCircle2
                          className={`mr-2 h-4 w-4 ${showShippedOnly ? 'text-purple-600' : ''}`}
                        />
                        {showShippedOnly ? 'Show All' : 'Shipped Only'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={refreshData}
                        className='hover:bg-accent'
                      >
                        <Filter className='mr-2 h-4 w-4' />
                        Refresh Data
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setLocalSearchQuery('')
                          // Also clear all status filters
                          setShowCriticalOnly(false)
                          setShowWavedOnly(false)
                          setShowPickedOnly(false)
                          setShowShippedOnly(false)
                          setCurrentPage(1)
                        }}
                        className='hover:bg-accent'
                      >
                        Clear All Filters
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Fixed columns - no reordering needed */}
            </div>
          </CardHeader>

          <CardContent>
            {isLoading || isLoadingStatusFilter ? (
              <div className='flex items-center justify-center py-12'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <span className='ml-2'>
                  {isLoadingStatusFilter
                    ? 'Loading filtered data...'
                    : 'Loading outbound data...'}
                </span>
              </div>
            ) : (
              <div className='border-border overflow-hidden rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-muted/50 hover:bg-muted/50'>
                      {fixedColumns.map((column) => (
                        <FixedTableHeader key={column.id} column={column} />
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
                          {fixedColumns.map((column) => (
                            <TableCell
                              key={column.id}
                              className={`${column.width} ${
                                column.key === 'transfer_order_number'
                                  ? 'text-foreground font-medium'
                                  : column.key === 'material_description'
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
                          colSpan={fixedColumns.length + 1}
                          className='text-muted-foreground py-8 text-center'
                        >
                          {data.length === 0
                            ? 'No outbound data found. Click "Import Data" to add records from clipboard.'
                            : 'No data found matching your search.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {!(isLoading || isLoadingStatusFilter) && (
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
                  {(localSearchQuery ||
                    showCriticalOnly ||
                    showWavedOnly ||
                    showPickedOnly ||
                    showShippedOnly) && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => {
                        setLocalSearchQuery('')
                        setShowCriticalOnly(false)
                        setShowWavedOnly(false)
                        setShowPickedOnly(false)
                        setShowShippedOnly(false)
                        setCurrentPage(1)
                      }}
                      className='border-border'
                    >
                      Clear Filter
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delivery Details Dialog */}
        <Dialog
          open={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
        >
          <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
            <DialogHeader>
              <DialogTitle className='text-2xl font-bold'>
                Delivery Audit Trail
              </DialogTitle>
              <DialogDescription>
                Complete workflow history and timestamps for delivery{' '}
                {selectedItem?.delivery}
              </DialogDescription>
            </DialogHeader>

            {selectedItem && (
              <div className='space-y-6'>
                {/* Basic Information */}
                <div className='bg-muted/50 grid grid-cols-2 gap-4 rounded-lg p-4'>
                  <div>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Delivery Number
                    </p>
                    <p className='text-lg font-semibold'>
                      {selectedItem.delivery || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Transfer Order
                    </p>
                    <p className='text-lg font-semibold'>
                      {selectedItem.transfer_order_number || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Material
                    </p>
                    <p className='text-lg font-semibold'>
                      {selectedItem.material || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Quantity
                    </p>
                    <p className='text-lg font-semibold'>
                      {selectedItem.source_target_qty || 'N/A'}
                    </p>
                  </div>
                  <div className='col-span-2'>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Description
                    </p>
                    <p className='text-base'>
                      {selectedItem.material_description || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Current Status
                    </p>
                    <div className='mt-1'>
                      <StatusBadge status={selectedItem.status || 'pending'} />
                    </div>
                  </div>
                  <div>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Storage Bin
                    </p>
                    <p className='text-base'>
                      {selectedItem.source_storage_bin || 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Workflow Audit Trail */}
                <div className='space-y-4'>
                  <div>
                    <h3 className='text-lg font-semibold'>Workflow History</h3>
                    <p className='text-muted-foreground text-sm'>
                      Chronological workflow progression with user attribution
                    </p>
                  </div>

                  {/* 3-Column Grid for Workflow Stages */}
                  <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
                    {/* Waved Stage */}
                    <Card
                      className={
                        selectedItem.waved_at
                          ? 'border-yellow-500'
                          : 'border-border opacity-60'
                      }
                    >
                      <CardHeader className='pb-3'>
                        <div className='flex items-center justify-between'>
                          <CardTitle className='flex items-center gap-2 text-base font-semibold'>
                            <Zap className='h-4 w-4' />
                            Waved
                          </CardTitle>
                          {selectedItem.waved_at && (
                            <Badge variant='default' className='bg-yellow-600'>
                              Completed
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className='space-y-2'>
                        {selectedItem.waved_at ? (
                          <div className='grid grid-cols-2 gap-2 text-sm'>
                            <div>
                              <p className='text-muted-foreground'>Waved By</p>
                              <p className='font-medium'>
                                {getUserDisplayName(selectedItem.waved_by)}
                              </p>
                            </div>
                            <div>
                              <p className='text-muted-foreground'>Waved At</p>
                              <p className='font-medium whitespace-nowrap'>
                                {format(
                                  new Date(selectedItem.waved_at),
                                  'MMM dd, yyyy h:mm:ss a'
                                )}
                              </p>
                              <p className='text-muted-foreground text-xs'>
                                {formatDistanceToNow(
                                  new Date(selectedItem.waved_at),
                                  { addSuffix: true }
                                )}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className='text-muted-foreground text-sm'>
                            Not yet waved
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Picked Stage */}
                    <Card
                      className={
                        selectedItem.picked_at
                          ? 'border-indigo-500'
                          : 'border-border opacity-60'
                      }
                    >
                      <CardHeader className='pb-3'>
                        <div className='flex items-center justify-between'>
                          <CardTitle className='flex items-center gap-2 text-base font-semibold'>
                            <Scan className='h-4 w-4' />
                            Picked
                          </CardTitle>
                          {selectedItem.picked_at && (
                            <Badge variant='default' className='bg-indigo-600'>
                              Completed
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className='space-y-2'>
                        {selectedItem.picked_at ? (
                          <div className='grid grid-cols-2 gap-2 text-sm'>
                            <div>
                              <p className='text-muted-foreground'>Picked By</p>
                              <p className='font-medium'>
                                {getUserDisplayName(selectedItem.picked_by)}
                              </p>
                            </div>
                            <div>
                              <p className='text-muted-foreground'>Picked At</p>
                              <p className='font-medium whitespace-nowrap'>
                                {format(
                                  new Date(selectedItem.picked_at),
                                  'MMM dd, yyyy h:mm:ss a'
                                )}
                              </p>
                              <p className='text-muted-foreground text-xs'>
                                {formatDistanceToNow(
                                  new Date(selectedItem.picked_at),
                                  { addSuffix: true }
                                )}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className='text-muted-foreground text-sm'>
                            Not yet picked
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Putback Ticket Stage */}
                    {putbackTickets.length > 0 && (
                      <Card className='border-orange-500'>
                        <CardHeader className='pb-3'>
                          <div className='flex items-center justify-between'>
                            <CardTitle className='flex items-center gap-2 text-base font-semibold'>
                              <RotateCcw className='h-4 w-4' />
                              Putback Tickets ({putbackTickets.length})
                            </CardTitle>
                            <Badge variant='default' className='bg-orange-600'>
                              Has Putbacks
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className='space-y-3'>
                          {putbackTickets.map((ticket, index) => (
                            <div
                              key={ticket.id}
                              className={`${index > 0 ? 'border-border border-t pt-3' : ''}`}
                            >
                              <div className='grid grid-cols-2 gap-2 text-sm'>
                                <div>
                                  <p className='text-muted-foreground'>
                                    Ticket Number
                                  </p>
                                  <p className='font-mono font-medium text-orange-600'>
                                    {ticket.putback_number}
                                  </p>
                                </div>
                                <div>
                                  <p className='text-muted-foreground'>
                                    Status
                                  </p>
                                  <Badge
                                    variant='outline'
                                    className={
                                      ticket.status === 'open'
                                        ? 'border-yellow-400 bg-yellow-100 text-yellow-800'
                                        : ticket.status === 'in_progress'
                                          ? 'border-blue-400 bg-blue-100 text-blue-800'
                                          : ticket.status === 'completed'
                                            ? 'border-green-400 bg-green-100 text-green-800'
                                            : 'border-red-400 bg-red-100 text-red-800'
                                    }
                                  >
                                    {ticket.status === 'in_progress'
                                      ? 'In Progress'
                                      : ticket.status.charAt(0).toUpperCase() +
                                        ticket.status.slice(1)}
                                  </Badge>
                                </div>
                                <div>
                                  <p className='text-muted-foreground'>
                                    Created By
                                  </p>
                                  <p className='font-medium'>
                                    {getUserDisplayName(ticket.created_by)}
                                  </p>
                                </div>
                                <div>
                                  <p className='text-muted-foreground'>
                                    Created At
                                  </p>
                                  <p className='font-medium whitespace-nowrap'>
                                    {format(
                                      new Date(ticket.created_at),
                                      'MMM dd, yyyy h:mm:ss a'
                                    )}
                                  </p>
                                  <p className='text-muted-foreground text-xs'>
                                    {formatDistanceToNow(
                                      new Date(ticket.created_at),
                                      { addSuffix: true }
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <p className='text-muted-foreground'>
                                    Material
                                  </p>
                                  <p className='font-medium'>
                                    {ticket.material_number}
                                  </p>
                                </div>
                                <div>
                                  <p className='text-muted-foreground'>
                                    Quantity Returned
                                  </p>
                                  <p className='font-medium'>
                                    {ticket.quantity_returned}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}

                    {/* Packed Stage */}
                    <Card
                      className={
                        selectedItem.packed_at
                          ? 'border-blue-500'
                          : 'border-border opacity-60'
                      }
                    >
                      <CardHeader className='pb-3'>
                        <div className='flex items-center justify-between'>
                          <CardTitle className='flex items-center gap-2 text-base font-semibold'>
                            <Package className='h-4 w-4' />
                            Packed
                          </CardTitle>
                          {selectedItem.packed_at && (
                            <Badge variant='default' className='bg-blue-500'>
                              Completed
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className='space-y-2'>
                        {selectedItem.packed_at ? (
                          <>
                            <div className='grid grid-cols-2 gap-2 text-sm'>
                              <div>
                                <p className='text-muted-foreground'>
                                  Packed By
                                </p>
                                <p className='font-medium'>
                                  {getUserDisplayName(selectedItem.packed_by)}
                                </p>
                              </div>
                              <div>
                                <p className='text-muted-foreground'>
                                  Packed At
                                </p>
                                <p className='font-medium whitespace-nowrap'>
                                  {format(
                                    new Date(selectedItem.packed_at),
                                    'MMM dd, yyyy h:mm:ss a'
                                  )}
                                </p>
                                <p className='text-muted-foreground text-xs'>
                                  {formatDistanceToNow(
                                    new Date(selectedItem.packed_at),
                                    { addSuffix: true }
                                  )}
                                </p>
                              </div>
                            </div>
                            {selectedItem.package_length && (
                              <div className='text-sm'>
                                <p className='text-muted-foreground'>
                                  Package Dimensions
                                </p>
                                <p className='font-medium'>
                                  {selectedItem.package_length}" ×{' '}
                                  {selectedItem.package_width}" ×{' '}
                                  {selectedItem.package_height}"
                                  {selectedItem.package_weight &&
                                    ` • ${selectedItem.package_weight} lbs`}
                                </p>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className='text-muted-foreground text-sm'>
                            Not yet packed
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Shipped Stage */}
                    <Card
                      className={
                        selectedItem.shipped_at
                          ? 'border-purple-500'
                          : 'border-border opacity-60'
                      }
                    >
                      <CardHeader className='pb-3'>
                        <div className='flex items-center justify-between'>
                          <CardTitle className='flex items-center gap-2 text-base font-semibold'>
                            <Zap className='h-4 w-4' />
                            Shipped
                          </CardTitle>
                          {selectedItem.shipped_at && (
                            <Badge variant='default' className='bg-purple-600'>
                              Completed
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className='space-y-2'>
                        {selectedItem.shipped_at ? (
                          <>
                            <div className='grid grid-cols-2 gap-2 text-sm'>
                              <div>
                                <p className='text-muted-foreground'>
                                  Shipped By
                                </p>
                                <p className='font-medium'>
                                  {getUserDisplayName(selectedItem.shipped_by)}
                                </p>
                              </div>
                              <div>
                                <p className='text-muted-foreground'>
                                  Shipped At
                                </p>
                                <p className='font-medium whitespace-nowrap'>
                                  {format(
                                    new Date(selectedItem.shipped_at),
                                    'MMM dd, yyyy h:mm:ss a'
                                  )}
                                </p>
                                <p className='text-muted-foreground text-xs'>
                                  {formatDistanceToNow(
                                    new Date(selectedItem.shipped_at),
                                    { addSuffix: true }
                                  )}
                                </p>
                              </div>
                            </div>
                            {selectedItem.tracking_number && (
                              <div className='text-sm'>
                                <p className='text-muted-foreground'>
                                  Tracking Number
                                </p>
                                <p className='font-mono font-medium'>
                                  {selectedItem.tracking_number}
                                </p>
                              </div>
                            )}
                            {selectedItem.shipper_type && (
                              <div className='text-sm'>
                                <p className='text-muted-foreground'>
                                  Shipper Type
                                </p>
                                <p className='font-medium'>
                                  {selectedItem.shipper_type}
                                </p>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className='text-muted-foreground text-sm'>
                            Not yet shipped
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Final Packed Stage */}
                    <Card
                      className={
                        selectedItem.final_packed_at
                          ? 'border-green-500'
                          : 'border-border opacity-60'
                      }
                    >
                      <CardHeader className='pb-3'>
                        <div className='flex items-center justify-between'>
                          <CardTitle className='flex items-center gap-2 text-base font-semibold'>
                            <CheckCircle2 className='h-4 w-4' />
                            Final Packed
                          </CardTitle>
                          {selectedItem.final_packed_at && (
                            <Badge variant='default' className='bg-green-600'>
                              Completed
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className='space-y-2'>
                        {selectedItem.final_packed_at ? (
                          <>
                            <div className='grid grid-cols-2 gap-2 text-sm'>
                              <div>
                                <p className='text-muted-foreground'>
                                  Final Packed By
                                </p>
                                <p className='font-medium'>
                                  {getUserDisplayName(
                                    selectedItem.final_packed_by
                                  )}
                                </p>
                              </div>
                              <div>
                                <p className='text-muted-foreground'>
                                  Final Packed At
                                </p>
                                <p className='font-medium whitespace-nowrap'>
                                  {format(
                                    new Date(selectedItem.final_packed_at),
                                    'MMM dd, yyyy h:mm:ss a'
                                  )}
                                </p>
                                <p className='text-muted-foreground text-xs'>
                                  {formatDistanceToNow(
                                    new Date(selectedItem.final_packed_at),
                                    { addSuffix: true }
                                  )}
                                </p>
                              </div>
                            </div>
                            {(selectedItem.requires_8130_3 ||
                              selectedItem.has_8130_3 ||
                              selectedItem.is_8130_3_signed) && (
                              <div className='text-sm'>
                                <p className='text-muted-foreground'>
                                  8130-3 Compliance
                                </p>
                                <div className='mt-1 flex flex-wrap gap-2'>
                                  {selectedItem.requires_8130_3 && (
                                    <Badge variant='outline'>
                                      Requires 8130-3
                                    </Badge>
                                  )}
                                  {selectedItem.has_8130_3 && (
                                    <Badge
                                      variant='default'
                                      className='bg-blue-500'
                                    >
                                      Has 8130-3
                                    </Badge>
                                  )}
                                  {selectedItem.is_8130_3_signed && (
                                    <Badge
                                      variant='default'
                                      className='bg-green-600'
                                    >
                                      8130-3 Signed
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className='text-muted-foreground text-sm'>
                            Not yet final packed
                          </p>
                        )}
                      </CardContent>
                    </Card>
                    {/* WAWF Stage */}
                    {(selectedItem.wawf_status ||
                      selectedItem.shipper_type === 'wawf') && (
                      <Card
                        className={
                          selectedItem.wawf_status
                            ? selectedItem.wawf_status ===
                              'complete_tka_process'
                              ? 'border-green-500'
                              : 'border-amber-500'
                            : 'border-border opacity-60'
                        }
                      >
                        <CardHeader className='pb-3'>
                          <div className='flex items-center justify-between'>
                            <CardTitle className='flex items-center gap-2 text-base font-semibold'>
                              <FileText className='h-4 w-4' />
                              WAWF
                            </CardTitle>
                            {selectedItem.wawf_status && (
                              <Badge
                                variant='default'
                                className={
                                  selectedItem.wawf_status ===
                                  'complete_tka_process'
                                    ? 'bg-green-600'
                                    : 'bg-amber-600'
                                }
                              >
                                {selectedItem.wawf_status ===
                                'complete_tka_process'
                                  ? 'TKA Complete'
                                  : selectedItem.wawf_status ===
                                      'ready_for_nefab'
                                    ? 'Ready for NeFab'
                                    : 'Staged to NeFab'}
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className='space-y-2'>
                          {selectedItem.wawf_status ? (
                            <>
                              <div className='grid grid-cols-2 gap-2 text-sm'>
                                <div>
                                  <p className='text-muted-foreground'>
                                    Placed into WAWF By
                                  </p>
                                  <p className='font-medium'>
                                    {getUserDisplayName(
                                      selectedItem.wawf_placed_by
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <p className='text-muted-foreground'>
                                    WAWF Date/Time
                                  </p>
                                  {selectedItem.wawf_placed_at ? (
                                    <>
                                      <p className='font-medium whitespace-nowrap'>
                                        {format(
                                          new Date(selectedItem.wawf_placed_at),
                                          'MMM dd, yyyy h:mm:ss a'
                                        )}
                                      </p>
                                      <p className='text-muted-foreground text-xs'>
                                        {formatDistanceToNow(
                                          new Date(selectedItem.wawf_placed_at),
                                          { addSuffix: true }
                                        )}
                                      </p>
                                    </>
                                  ) : (
                                    <p className='font-medium'>N/A</p>
                                  )}
                                </div>
                              </div>
                              <div className='text-sm'>
                                <p className='text-muted-foreground'>
                                  WAWF Delivery Status
                                </p>
                                <p className='font-medium capitalize'>
                                  {selectedItem.wawf_status.replace(/_/g, ' ')}
                                </p>
                              </div>
                            </>
                          ) : (
                            <p className='text-muted-foreground text-sm'>
                              WAWF not yet processed
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                  {/* End 3-Column Grid */}
                </div>

                {/* Additional Information */}
                <Card>
                  <CardHeader className='pb-3'>
                    <CardTitle className='text-base font-semibold'>
                      Additional Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-2 text-sm'>
                    <div className='grid grid-cols-2 gap-4'>
                      <div>
                        <p className='text-muted-foreground'>Plant</p>
                        <p className='font-medium'>
                          {selectedItem.plant || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>Warehouse</p>
                        <p className='font-medium'>
                          {selectedItem.warehouse_number || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>Batch</p>
                        <p className='font-medium'>
                          {selectedItem.batch || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>
                          Storage Location
                        </p>
                        <p className='font-medium'>
                          {selectedItem.storage_location || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>Record Created</p>
                        <p className='font-medium'>
                          {format(
                            new Date(selectedItem.created_at),
                            'MMM dd, yyyy h:mm a'
                          )}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground'>Last Updated</p>
                        <p className='font-medium'>
                          {format(
                            new Date(selectedItem.updated_at),
                            'MMM dd, yyyy h:mm a'
                          )}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Modify TO Dialog */}
        <Dialog
          open={isModifyDialogOpen}
          onOpenChange={(open) => {
            if (!open) handleCloseModifyDialog()
          }}
        >
          <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
            <DialogHeader>
              <DialogTitle className='text-2xl font-bold'>
                Modify Transfer Order Data
              </DialogTitle>
              <DialogDescription>
                Search by Delivery # or Transfer Order # to edit or delete
                records
              </DialogDescription>
            </DialogHeader>

            <div className='space-y-6'>
              {/* Search Section */}
              <div className='space-y-3'>
                <div className='flex gap-2'>
                  <div className='relative flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
                    <Input
                      placeholder='Enter Delivery # or Transfer Order #'
                      value={modifySearchIdentifier}
                      onChange={(e) =>
                        setModifySearchIdentifier(e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSearchModify()
                        }
                      }}
                      className='bg-background border-border pl-10'
                    />
                  </div>
                  <Button
                    onClick={handleSearchModify}
                    disabled={isSearching || !modifySearchIdentifier.trim()}
                  >
                    {isSearching ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className='mr-2 h-4 w-4' />
                        Search
                      </>
                    )}
                  </Button>
                </div>
                <p className='text-muted-foreground text-xs'>
                  Enter a delivery number (e.g., 65144223) or transfer order
                  number to find matching records
                </p>
              </div>

              {/* Search Results */}
              {modifySearchResults.length > 0 && (
                <div className='space-y-3'>
                  <div className='flex items-center justify-between'>
                    <h3 className='text-lg font-semibold'>
                      Search Results ({modifySearchResults.length})
                    </h3>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => {
                        setModifySearchResults([])
                        setModifySearchIdentifier('')
                      }}
                    >
                      Clear Results
                    </Button>
                  </div>

                  <div className='overflow-hidden rounded-lg border'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Delivery</TableHead>
                          <TableHead>Transfer Order</TableHead>
                          <TableHead>Material</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Quantity</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className='text-right'>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {modifySearchResults.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className='font-medium'>
                              {item.delivery}
                            </TableCell>
                            <TableCell>
                              {item.transfer_order_number || 'N/A'}
                            </TableCell>
                            <TableCell>{item.material}</TableCell>
                            <TableCell className='max-w-[200px] truncate'>
                              {item.material_description}
                            </TableCell>
                            <TableCell>
                              {editingItem?.id === item.id ? (
                                <Input
                                  type='number'
                                  value={editQuantity}
                                  onChange={(e) =>
                                    setEditQuantity(e.target.value)
                                  }
                                  className='w-24'
                                  min='0'
                                  step='0.01'
                                />
                              ) : (
                                item.source_target_qty
                              )}
                            </TableCell>
                            <TableCell>
                              {editingItem?.id === item.id ? (
                                <select
                                  value={editStatus}
                                  onChange={(e) =>
                                    setEditStatus(e.target.value)
                                  }
                                  className='rounded border px-2 py-1 text-sm'
                                >
                                  <option value='pending'>Pending</option>
                                  <option value='processing'>Processing</option>
                                  <option value='picked'>Picked</option>
                                  <option value='picked_short'>
                                    Picked Short
                                  </option>
                                  <option value='picked_bulk'>
                                    Picked Bulk
                                  </option>
                                  <option value='packed'>Packed</option>
                                  <option value='final_packed'>
                                    Final Packed
                                  </option>
                                  <option value='shipped'>Shipped</option>
                                  <option value='not_in_location'>
                                    Not In Location
                                  </option>
                                  <option value='on_hold'>On Hold</option>
                                  <option value='cancelled'>Cancelled</option>
                                  <option value='completed'>Completed</option>
                                </select>
                              ) : (
                                <StatusBadge
                                  status={item.status || 'pending'}
                                />
                              )}
                            </TableCell>
                            <TableCell className='text-right'>
                              {editingItem?.id === item.id ? (
                                <div className='flex justify-end gap-1'>
                                  <Button
                                    size='sm'
                                    onClick={handleUpdateItem}
                                    className='h-8'
                                  >
                                    <CheckCircle2 className='mr-1 h-3 w-3' />
                                    Save
                                  </Button>
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    onClick={handleCancelEdit}
                                    className='h-8'
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <div className='flex justify-end gap-1'>
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    onClick={() => handleStartEdit(item)}
                                    className='h-8'
                                  >
                                    <FileText className='mr-1 h-3 w-3' />
                                    Edit
                                  </Button>
                                  <Button
                                    size='sm'
                                    variant='destructive'
                                    onClick={() => handleDeleteItem(item)}
                                    className='h-8'
                                  >
                                    Delete
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Instructions when no results */}
              {modifySearchResults.length === 0 && (
                <div className='text-muted-foreground py-8 text-center'>
                  <FileText className='mx-auto mb-3 h-12 w-12 opacity-50' />
                  <p className='text-sm'>
                    Search for a Delivery # or Transfer Order # to view and edit
                    records
                  </p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Wave Delivery Dialog */}
        <WaveDeliveryDialog
          isOpen={isWaveDialogOpen}
          onOpenChange={setIsWaveDialogOpen}
          onScanDelivery={handleWaveDeliveryScan}
        />
      </div>
    )
  }
)

OutboundDataManager.displayName = 'OutboundDataManager'

export default OutboundDataManager
