// GRS Delivery Status Manager - Updated November 9, 2025 for GRS shipping points
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
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
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { DeliveryStatusData } from '@/lib/supabase/delivery-status.service'
import { deliveryStatusService } from '@/lib/supabase/delivery-status.service'
import type { AdvancedFilterConfig } from '@/lib/types/advanced-filter.types'
import {
  applyAdvancedFilters,
  createEmptyFilterConfig,
  countActiveFilters,
} from '@/lib/utils/advanced-filter.utils'
import { logger } from '@/lib/utils/logger'
import { useDeliveryStatus } from '@/hooks/use-delivery-status'
import { AdvancedDeliveryFilterDialog } from '@/components/ui/advanced-delivery-filter-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface GRSDeliveryStatusManagerProps {
  enableRealtime?: boolean
  // GRS-specific filter configuration
  filterConfig?: {
    shippingPoints?: string[]
    plants?: string[]
    warehouseNumbers?: string[]
    excludeCustomers?: string[]
    [key: string]: unknown
  }
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

// Default column configuration for GRS delivery status
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

const GRSDeliveryStatusManager: React.FC<GRSDeliveryStatusManagerProps> =
  React.memo(({ enableRealtime = true, filterConfig: grsFilterConfig }) => {
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
    const [showOpenOnly, setShowOpenOnly] = useState(true)
    const [showJS01Only, setShowJS01Only] = useState(false)
    const [showDeletedOnly, setShowDeletedOnly] = useState(false)
    const [selectedItem, setSelectedItem] = useState<DeliveryStatusData | null>(
      null
    )
    const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 25

    // PGI Date filter state
    const [pgiSelectedDate, setPgiSelectedDate] = useState<Date>(new Date())
    const [pgiCount, setPgiCount] = useState<number>(0)
    const [showImportConfirmDialog, setShowImportConfirmDialog] =
      useState(false)
    const [pendingImportRowCount, setPendingImportRowCount] = useState(0)
    const [isPgiCalendarOpen, setIsPgiCalendarOpen] = useState(false)
    const [isLoadingPgi, setIsLoadingPgi] = useState(false)

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

    // Use the standard hook which now has increased limit (100000)
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
    } = useDeliveryStatus({
      enableRealtime: shouldEnableRealtime,
      searchQuery: '',
      openOnly: false, // GRS handles filtering at component level
      includeDeleted: showDeletedOnly,
    })

    // Add debug logging
    useEffect(() => {
      if (data.length > 0) {
        const grsShippingPoints = [
          '8109',
          '8209',
          '8309',
          '8409',
          'INCR',
          'IADS',
          'KYCR',
        ]
        const grsRecords = data.filter(
          (d) =>
            d.shipping_point &&
            grsShippingPoints.includes(d.shipping_point.toUpperCase())
        )
        const openGrsRecords = grsRecords.filter(
          (d) =>
            !d.goods_movement_status ||
            !d.goods_movement_status.toUpperCase().includes('C')
        )
        logger.log(
          `🔍 GRS Component: ${data.length} total records, ${grsRecords.length} GRS shipping points, ${openGrsRecords.length} open`
        )
      }
    }, [data])

    // Pre-load dispositions IMMEDIATELY when data arrives
    useEffect(() => {
      if (organizationId && !isLoading) {
        deliveryStatusService.getDispositions(organizationId).catch(() => {
          // Silent failure
        })

        deliveryStatusService
          .autoAssignDispositions()
          .then((result) => {
            if (result.assigned > 0) {
              logger.log(
                `✅ GRS Auto-assigned dispositions to ${result.assigned} deliveries`
              )
              refreshData()
            }
          })
          .catch(() => {
            // Silent failure
          })
      }
    }, [organizationId, isLoading, refreshData])

    // Load PGI count when date changes
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

    // Sort and filter data with GRS-specific filtering
    const sortedAndFilteredData = useMemo(() => {
      let processedData = [...data]

      // Apply GRS-specific filtering
      if (grsFilterConfig) {
        if (
          grsFilterConfig.shippingPoints &&
          grsFilterConfig.shippingPoints.length > 0
        ) {
          processedData = processedData.filter(
            (item) =>
              item.shipping_point &&
              grsFilterConfig.shippingPoints!.includes(
                item.shipping_point.toUpperCase()
              )
          )
        }

        if (grsFilterConfig.plants && grsFilterConfig.plants.length > 0) {
          processedData = processedData.filter((item) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const plant = (item as any).plant as string | undefined
            return (
              plant && grsFilterConfig.plants!.includes(plant.toUpperCase())
            )
          })
        }

        if (
          grsFilterConfig.warehouseNumbers &&
          grsFilterConfig.warehouseNumbers.length > 0
        ) {
          processedData = processedData.filter(
            (item) =>
              item.warehouse_number &&
              grsFilterConfig.warehouseNumbers!.includes(
                item.warehouse_number.toUpperCase()
              )
          )
        }

        if (
          grsFilterConfig.excludeCustomers &&
          grsFilterConfig.excludeCustomers.length > 0
        ) {
          processedData = processedData.filter(
            (item) =>
              !item.customer_name ||
              !grsFilterConfig.excludeCustomers!.some((customer) =>
                item
                  .customer_name!.toUpperCase()
                  .includes(customer.toUpperCase())
              )
          )
        }
      }

      // Show Deleted mode
      if (showDeletedOnly) {
        processedData = processedData.filter(
          (item) =>
            item.is_deleted === true ||
            item.disposition_name?.toUpperCase() === 'DELETED'
        )
      }
      // JS01 filter mode
      else if (showJS01Only) {
        processedData = processedData.filter(
          (item) => item.shipping_point?.toUpperCase() === 'JS01'
        )
      }
      // Open Only mode - GRS specific shipping points
      // Applied when showOpenOnly is true
      // Open = goods_movement_status does NOT contain 'C'
      else if (showOpenOnly) {
        // GRS shipping points: 8109, 8209, 8309, 8409, INCR, IADS, KYCR
        const grsShippingPoints = [
          '8109',
          '8209',
          '8309',
          '8409',
          'INCR',
          'IADS',
          'KYCR',
        ]

        processedData = processedData.filter((item) => {
          // Open = goods_movement_status does NOT contain 'C'
          const isOpen =
            !item.goods_movement_status ||
            !item.goods_movement_status.toUpperCase().includes('C')
          const isGrsShippingPoint =
            item.shipping_point &&
            grsShippingPoints.includes(item.shipping_point.toUpperCase())
          return isOpen && isGrsShippingPoint
        })
      }

      // Apply advanced filters
      if (advancedFilterConfig.groups.length > 0) {
        processedData = applyAdvancedFilters(
          processedData,
          advancedFilterConfig
        )
      }

      // Apply legacy column filters
      Object.entries(filterConfig).forEach(([key, value]) => {
        if (value) {
          if (Array.isArray(value)) {
            if (value.length > 0) {
              processedData = processedData.filter((item) => {
                const itemValue = item[key as keyof DeliveryStatusData]
                return itemValue && value.includes(String(itemValue))
              })
            }
          } else {
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

      // Apply search query filter
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

          if (aValue === null || aValue === undefined) return 1
          if (bValue === null || bValue === undefined) return -1

          let comparison = 0
          if (typeof aValue === 'number' && typeof bValue === 'number') {
            comparison = aValue - bValue
          } else if (sortConfig.key.includes('_date')) {
            const aDate = new Date(aValue as string)
            const bDate = new Date(bValue as string)
            comparison = aDate.getTime() - bDate.getTime()
          } else {
            const aStr = String(aValue).toLowerCase()
            const bStr = String(bValue).toLowerCase()
            comparison = aStr < bStr ? -1 : aStr > bStr ? 1 : 0
          }

          return sortConfig.direction === 'desc' ? -comparison : comparison
        })
      }

      return processedData
    }, [
      data,
      filterConfig,
      advancedFilterConfig,
      searchQuery,
      sortConfig,
      showOpenOnly,
      showJS01Only,
      showDeletedOnly,
      grsFilterConfig,
    ])

    // Pagination calculations
    const totalRecords = sortedAndFilteredData.length
    const totalPages = Math.ceil(totalRecords / recordsPerPage)
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = startIndex + recordsPerPage
    const currentPageData = sortedAndFilteredData.slice(startIndex, endIndex)

    // Calculate shipping point-specific counts (GRS-specific)
    // UNSERV = 8109, 8209, 8309, 8409, INCR, IADS
    // SERV = KYCR
    // Open = goods_movement_status does NOT contain 'C'
    const shippingPointCounts = useMemo(() => {
      // Filter for GRS shipping points first
      const grsShippingPoints = [
        '8109',
        '8209',
        '8309',
        '8409',
        'INCR',
        'IADS',
        'KYCR',
      ]
      const grsDeliveries = data.filter(
        (item) =>
          item.shipping_point &&
          grsShippingPoints.includes(item.shipping_point.toUpperCase())
      )

      // Open = goods_movement_status does NOT contain 'C'
      const openDeliveries = grsDeliveries.filter(
        (item) =>
          !item.goods_movement_status ||
          !item.goods_movement_status.toUpperCase().includes('C')
      )

      const unservShippingPoints = [
        '8109',
        '8209',
        '8309',
        '8409',
        'INCR',
        'IADS',
      ]
      const servShippingPoints = ['KYCR']

      return {
        unserv: openDeliveries.filter(
          (item) =>
            item.shipping_point &&
            unservShippingPoints.includes(item.shipping_point.toUpperCase())
        ).length,
        serv: openDeliveries.filter(
          (item) =>
            item.shipping_point &&
            servShippingPoints.includes(item.shipping_point.toUpperCase())
        ).length,
        total: openDeliveries.length,
      }
    }, [data])

    // Calculate days open counts for GRS deliveries
    // GRS shipping points: 8109, 8209, 8309, 8409, INCR, IADS, KYCR
    // Open = goods_movement_status does NOT contain 'C'
    const daysOpenCounts = useMemo(() => {
      // Filter for GRS shipping points first
      const grsShippingPoints = [
        '8109',
        '8209',
        '8309',
        '8409',
        'INCR',
        'IADS',
        'KYCR',
      ]
      const grsDeliveries = data.filter((item) => {
        const shippingPoint = item.shipping_point?.toUpperCase()
        return shippingPoint && grsShippingPoints.includes(shippingPoint)
      })

      // Open = goods_movement_status does NOT contain 'C'
      const openGrsDeliveries = grsDeliveries.filter(
        (item) =>
          !item.goods_movement_status ||
          !item.goods_movement_status.toUpperCase().includes('C')
      )

      return {
        over30: openGrsDeliveries.filter(
          (item) =>
            item.days_open !== null &&
            item.days_open !== undefined &&
            item.days_open > 30
        ).length,
        over12: openGrsDeliveries.filter(
          (item) =>
            item.days_open !== null &&
            item.days_open !== undefined &&
            item.days_open > 12 &&
            item.days_open <= 30
        ).length,
        over4: openGrsDeliveries.filter(
          (item) =>
            item.days_open !== null &&
            item.days_open !== undefined &&
            item.days_open > 4 &&
            item.days_open <= 12
        ).length,
      }
    }, [data])

    // TKA Non-Controllable counts from statistics
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

    // Reset to first page when search changes
    React.useEffect(() => {
      setCurrentPage(1)
    }, [searchQuery])

    // Clear all filters
    const handleClearFilters = useCallback(() => {
      setFilterConfig({})
      setCurrentPage(1)
    }, [])

    // Handle import from clipboard
    const handleImportData = useCallback(async () => {
      try {
        if (navigator.clipboard?.readText) {
          const clipboardText = await navigator.clipboard.readText()
          const lines = clipboardText.trim().split('\n')
          const rowCount = lines.length - 1

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

    // Handle export data
    const handleExportData = useCallback(() => {
      if (sortedAndFilteredData.length === 0) {
        toast.warning('No data to export')
        return
      }

      try {
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

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute(
          'download',
          `grs-delivery-status-${new Date().toISOString().split('T')[0]}.csv`
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

    // Pagination handlers
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

    // Handle view details
    const handleViewDetails = useCallback((item: DeliveryStatusData) => {
      setSelectedItem(item)
      setIsDetailsDialogOpen(true)
    }, [])

    // Get cell content
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
                // Silent update in background
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
              <p>Failed to load GRS delivery status data: {error.message}</p>
              <Button onClick={refreshData} className='mt-4'>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    }

    // Memoized statistics cards
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const StatisticsCards = useMemo(
      () => (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Total Deliveries
              </CardTitle>
              <FileText className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {(
                      shippingPointCounts.unserv + shippingPointCounts.serv
                    ).toLocaleString()}
                  </div>
                  <p className='text-muted-foreground text-xs'>Open</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {shippingPointCounts.unserv.toLocaleString()}
                  </div>
                  <p className='text-muted-foreground text-xs'>UNSERV</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {shippingPointCounts.serv.toLocaleString()}
                  </div>
                  <p className='text-muted-foreground text-xs'>SERV</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Days Open</CardTitle>
              <Users className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {daysOpenCounts.over30.toLocaleString()}
                  </div>
                  <p className='text-muted-foreground text-xs'>&gt;30 Days</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {daysOpenCounts.over12.toLocaleString()}
                  </div>
                  <p className='text-muted-foreground text-xs'>&gt;12 Days</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {daysOpenCounts.over4.toLocaleString()}
                  </div>
                  <p className='text-muted-foreground text-xs'>&gt;4 Days</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                TKA Non-Controllable
              </CardTitle>
              <AlertCircle className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {tkaNonControllableCounts.liftFan.toLocaleString()}
                  </div>
                  <p className='text-muted-foreground text-xs'>LiftFan</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {tkaNonControllableCounts.wawf.toLocaleString()}
                  </div>
                  <p className='text-muted-foreground text-xs'>WAWF</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {tkaNonControllableCounts.placeholder.toLocaleString()}
                  </div>
                  <p className='text-muted-foreground text-xs'>TBD</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <div className='flex flex-1 items-center gap-2'>
                <CardTitle className='text-sm font-medium'>
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
              </div>
              <Truck className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {isLoadingPgi ? (
                  <Loader2 className='inline h-6 w-6 animate-spin' />
                ) : (
                  pgiCount.toLocaleString()
                )}
              </div>
              <p className='text-muted-foreground text-xs'>
                Actual Goods Movement Date
              </p>
            </CardContent>
          </Card>
        </div>
      ),
      [
        shippingPointCounts,
        daysOpenCounts,
        tkaNonControllableCounts,
        pgiCount,
        isLoadingPgi,
        pgiSelectedDate,
        isPgiCalendarOpen,
      ]
    )

    return (
      <div ref={componentRef} className='space-y-6'>
        {/* Import Confirmation Dialog */}
        <ImportConfirmDialog
          isOpen={showImportConfirmDialog}
          rowCount={pendingImportRowCount}
          operation='clear'
          datasetName='GRS delivery status data'
          onConfirm={handleConfirmImport}
          onCancel={handleCancelImport}
          isProcessing={isImporting}
        />

        {/* Import Progress Dialog */}
        <ImportProgressDialog
          isOpen={isImporting && !!importProgress}
          progress={importProgress}
          onClose={() => {}}
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
                    GRS Delivery Status
                  </h2>
                  <div className='relative max-w-sm flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
                    <Input
                      placeholder='Search deliveries, customers, status...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className='bg-background border-border pl-10'
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
                          setShowJS01Only(false)
                          setShowDeletedOnly(false)
                        }}
                        className='hover:bg-accent'
                      >
                        <FilterX className='mr-2 h-4 w-4' />
                        {showOpenOnly ? 'Show All' : 'Open Only'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowJS01Only(!showJS01Only)
                          setShowOpenOnly(false)
                          setShowDeletedOnly(false)
                        }}
                        className='hover:bg-accent'
                      >
                        <Filter className='mr-2 h-4 w-4' />
                        {showJS01Only ? 'Clear JS01 Filter' : 'Show JS01'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setShowDeletedOnly(!showDeletedOnly)
                          setShowOpenOnly(false)
                          setShowJS01Only(false)
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
                <span className='ml-2'>
                  Loading GRS delivery status data...
                </span>
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
                            ? 'No GRS delivery status data found. Click "Import Data" to add records from clipboard.'
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
                {/* Left side: Info */}
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

                {/* Right side: Pagination */}
                <div className='flex items-center gap-2'>
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

        {/* Delivery Details Dialog */}
        <Dialog
          open={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
        >
          <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
            <DialogHeader>
              <DialogTitle className='text-2xl font-bold'>
                GRS Delivery Audit Trail
              </DialogTitle>
              <DialogDescription>
                Complete delivery information and workflow history for delivery{' '}
                {selectedItem?.delivery}
              </DialogDescription>
            </DialogHeader>

            {selectedItem && (
              <div className='space-y-6'>
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
                        <p className='text-muted-foreground'>
                          Delivery Priority
                        </p>
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
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    )
  })

GRSDeliveryStatusManager.displayName = 'GRSDeliveryStatusManager'

export default GRSDeliveryStatusManager
