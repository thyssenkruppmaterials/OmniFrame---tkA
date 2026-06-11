// Created and developed by Jai Singh
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
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
import type { Database } from '@/lib/supabase/database.types'
import {
  OutboundTODataService,
  type OutboundTOData,
} from '@/lib/supabase/outbound-to-data.service'
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

interface GRSDataManagerProps {
  enableRealtime?: boolean
  // GRS-specific filter configuration
  filterConfig?: {
    plants?: string[]
    warehouseNumbers?: string[]
    storageLocations?: string[]
    materialTypes?: string[]
    [key: string]: unknown
  }
}

interface TableColumn {
  id: string
  label: string
  key: keyof OutboundTOData
  width?: string
}

// Fixed column configuration for GRS
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
  { id: 'status', label: 'Status', key: 'status', width: 'w-28' },
]

// Fixed header component
function FixedTableHeader({ column }: { column: TableColumn }) {
  return (
    <TableHead className={`text-foreground font-medium ${column.width}`}>
      {column.label}
    </TableHead>
  )
}

// Status badge component
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

  // Enhanced status display names
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

const GRSDataManager: React.FC<GRSDataManagerProps> = React.memo(
  ({ enableRealtime = true, filterConfig: grsFilterConfig }) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [isVisible, setIsVisible] = useState(false)
    const [isWaveDialogOpen, setIsWaveDialogOpen] = useState(false)
    const [selectedItem, setSelectedItem] = useState<OutboundTOData | null>(
      null
    )
    const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
    const [isSmartImporting, setIsSmartImporting] = useState(false)
    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 25

    // Intersection Observer
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

    const shouldEnableRealtime = enableRealtime && isVisible
    const [localSearchQuery, setLocalSearchQuery] = useState('')

    const {
      data,
      isLoading,
      error,
      statistics,
      importFromClipboard,
      refreshData,
      isImporting,
    } = useOutboundTOData({
      enableRealtime: shouldEnableRealtime,
      searchQuery: localSearchQuery,
    })

    const fixedColumns = useMemo(() => FIXED_COLUMNS, [])

    // Filter data with GRS-specific filters
    const filteredData = useMemo(() => {
      let processedData = [...data]

      // Apply GRS-specific filtering
      if (grsFilterConfig) {
        if (grsFilterConfig.plants && grsFilterConfig.plants.length > 0) {
          processedData = processedData.filter(
            (item) =>
              item.plant &&
              grsFilterConfig.plants!.includes(item.plant.toUpperCase())
          )
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
          grsFilterConfig.storageLocations &&
          grsFilterConfig.storageLocations.length > 0
        ) {
          processedData = processedData.filter(
            (item) =>
              item.storage_location &&
              grsFilterConfig.storageLocations!.includes(
                item.storage_location.toUpperCase()
              )
          )
        }

        if (
          grsFilterConfig.materialTypes &&
          grsFilterConfig.materialTypes.length > 0
        ) {
          processedData = processedData.filter(
            (item) =>
              item.material &&
              grsFilterConfig.materialTypes!.some((type) =>
                item.material!.toUpperCase().startsWith(type.toUpperCase())
              )
          )
        }
      }

      // Hide final_packed by default
      return processedData.filter((item) => {
        const status = item.status?.toLowerCase() || ''
        const isFinalPacked =
          status === 'final_packed' || status === 'final packed'

        if (!localSearchQuery.trim()) {
          return !isFinalPacked
        }

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
          return true
        }

        return true
      })
    }, [data, localSearchQuery, grsFilterConfig])

    // Pagination calculations
    const totalRecords = filteredData.length
    const totalPages = Math.ceil(totalRecords / recordsPerPage)
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = startIndex + recordsPerPage
    const currentPageData = filteredData.slice(startIndex, endIndex)

    React.useEffect(() => {
      setCurrentPage(1)
    }, [localSearchQuery])

    // Handle import
    const handleImportData = useCallback(async () => {
      try {
        await importFromClipboard()
      } catch (error) {
        logger.error('Import failed:', error)
      }
    }, [importFromClipboard])

    // Handle Smart Import
    const handleSmartImport = useCallback(async () => {
      try {
        setIsSmartImporting(true)

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError || !session) {
          toast.error('Authentication required for Smart Import')
          return
        }

        const API_BASE_URL = (() => {
          if (window.location.origin === 'http://localhost:5173') {
            return 'http://localhost:8000'
          }
          return window.location.origin
        })()

        logger.log('🚀 GRS Smart Import: Starting...', { API_BASE_URL })
        toast.info('Fetching data from Smartsheet...', { duration: 2000 })

        const response = await fetch(
          `${API_BASE_URL}/api/smartsheet/import/outbound-data`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }
        )

        logger.log('📡 GRS Smart Import: API Response Status:', response.status)

        if (!response.ok) {
          const errorText = await response.text()
          logger.error('❌ GRS Smart Import: API Error Response:', errorText)
          let errorData
          try {
            errorData = JSON.parse(errorText)
          } catch {
            errorData = { detail: response.statusText }
          }
          throw new Error(
            errorData.detail ||
              `HTTP ${response.status}: ${response.statusText}`
          )
        }

        const result = await response.json()
        logger.log(
          '📦 GRS Smart Import: API Response Data (FULL):',
          JSON.stringify(result, null, 2)
        )

        if (!result || typeof result !== 'object') {
          throw new Error('Invalid response format from API')
        }

        const data = result.data || result

        if (!data.headers || !data.rows) {
          logger.error('❌ GRS Smart Import: Missing headers or rows:', data)
          throw new Error('Invalid data structure: missing headers or rows')
        }

        const { headers, rows, sheet_name, total_rows } = data

        logger.log(
          `✅ GRS Smart Import: Received ${rows?.length || 0} rows with ${headers?.length || 0} columns`
        )
        toast.success(
          `Fetched ${total_rows || rows.length} rows from Smartsheet${sheet_name ? ` "${sheet_name}"` : ''}`,
          { duration: 3000 }
        )

        const { OutboundTODataService } =
          await import('@/lib/supabase/outbound-to-data.service')
        const outboundService = OutboundTODataService.getInstance()

        const clipboardText = [
          headers.join('\t'),
          ...rows.map((row: string[]) => row.join('\t')),
        ].join('\n')

        logger.log('📋 GRS Smart Import: Writing to clipboard...', {
          headerCount: headers.length,
          rowCount: rows.length,
          sampleHeader: headers.slice(0, 3).join(', '),
        })

        await navigator.clipboard.writeText(clipboardText)

        toast.info('Importing data from Smartsheet...', { duration: 2000 })

        const importResult = await outboundService.importFromClipboard()
        logger.log('💾 GRS Smart Import: Import result:', importResult)

        if (importResult.success) {
          await refreshData()
        }
      } catch (error) {
        logger.error('❌ GRS Smart Import failed:', error)
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred'
        toast.error(`GRS Smart Import failed: ${errorMessage}`)
      } finally {
        setIsSmartImporting(false)
      }
    }, [refreshData])

    // Handle export
    const handleExportData = useCallback(() => {
      if (filteredData.length === 0) {
        toast.warning('No data to export')
        return
      }

      try {
        const csvHeaders = fixedColumns.map((col) => col.label)
        const csvContent = [
          csvHeaders.join(','),
          ...filteredData.map((row) =>
            fixedColumns
              .map((col) => {
                const value = row[col.key]
                return `"${value || ''}"`
              })
              .join(',')
          ),
        ].join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute(
          'download',
          `grs-data-${new Date().toISOString().split('T')[0]}.csv`
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

    // Handle Wave Delivery
    const handleWaveDeliveryScan = useCallback(
      async (
        deliveryNumber: string
      ): Promise<{ success: boolean; message: string }> => {
        try {
          const service = OutboundTODataService.getInstance()

          logger.log(
            `🔍 GRS Wave Scanner: Verifying delivery ${deliveryNumber}...`
          )
          const verification =
            await service.verifyDeliveryForWave(deliveryNumber)

          if (!verification.exists) {
            return {
              success: false,
              message: `Delivery ${deliveryNumber} not found in database`,
            }
          }

          if (!verification.allPending) {
            return {
              success: false,
              message: `Delivery ${deliveryNumber} is not in pending status (currently: ${verification.currentStatus})`,
            }
          }

          const updatedRows = await service.updateDeliveryStatus(
            deliveryNumber.toString(),
            'processing' as Database['public']['Enums']['outbound_status']
          )

          logger.log(
            `✅ GRS Wave Delivery: Successfully waved ${updatedRows.length} row(s) for delivery ${deliveryNumber}`
          )

          await refreshData()

          return {
            success: true,
            message: `Delivery ${deliveryNumber} successfully waved! (${updatedRows.length} line${updatedRows.length > 1 ? 's' : ''})`,
          }
        } catch (error) {
          logger.error('GRS Wave delivery scan failed:', error)
          return {
            success: false,
            message: `Failed to wave delivery ${deliveryNumber}. Please try again.`,
          }
        }
      },
      [refreshData]
    )

    // Format date
    const formatDate = (dateString: string | null) => {
      if (!dateString) return 'N/A'
      try {
        return formatDistanceToNow(new Date(dateString), { addSuffix: true })
      } catch {
        return dateString
      }
    }

    // Get cell content
    const getCellContent = (item: OutboundTOData, column: TableColumn) => {
      const value = item[column.key]

      switch (column.key) {
        case 'status':
          return <StatusBadge status={(value as string) || 'pending'} />
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
          return typeof value === 'string' || typeof value === 'number'
            ? value || 'N/A'
            : 'N/A'
      }
    }

    // State for user names and putback tickets
    const [userNames, setUserNames] = useState<Record<string, string>>({})
    const [putbackTickets, setPutbackTickets] = useState<
      Array<{
        id: string
        putback_number: string
        status: string
        created_by: string
        created_at: string
        material_number: string
        quantity_returned: number
      }>
    >([])

    // Fetch user names
    const fetchUserNames = useCallback(async (userIds: (string | null)[]) => {
      try {
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

        const nameMap: Record<string, string> = {}
        data?.forEach((user) => {
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

    // Fetch putback tickets
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

    // Handle view details
    const handleViewDetails = useCallback(
      async (item: OutboundTOData) => {
        setSelectedItem(item)
        setIsDetailsDialogOpen(true)

        const userIds: (string | null)[] = [
          item.uploaded_by || null,
          item.waved_by || null,
          item.picked_by || null,
          item.packed_by || null,
          item.shipped_by || null,
          item.final_packed_by || null,
        ]

        const names = await fetchUserNames(userIds)
        setUserNames(names)

        const tickets = await fetchPutbackTickets(item.delivery || '')
        setPutbackTickets(tickets)

        if (tickets.length > 0) {
          const ticketUserIds = tickets.map((t) => t.created_by).filter(Boolean)
          const ticketNames = await fetchUserNames(ticketUserIds)
          setUserNames((prev) => ({ ...prev, ...ticketNames }))
        }
      },
      [fetchUserNames, fetchPutbackTickets]
    )

    // Get user display name
    const getUserDisplayName = useCallback(
      (userId: string | null | undefined): string => {
        if (!userId) return 'Unknown'
        return userNames[userId] || userId
      },
      [userNames]
    )

    // Show error state
    if (error) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='p-6'>
            <div className='text-destructive text-center'>
              <p>Failed to load GRS outbound data: {error.message}</p>
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
                Delivery Status
              </CardTitle>
              <FileText className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {statistics?.pendingCount?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Pending</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {statistics?.wavedToday?.toLocaleString() || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Waved Today</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Picked Today
              </CardTitle>
              <Scan className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.pickedToday || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Deliveries picked today
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Packed Today
              </CardTitle>
              <Package className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.packedToday || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Deliveries packed today
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Final Packed Today
              </CardTitle>
              <CheckCircle2 className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.finalPackedToday || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Deliveries final packed today
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
                    GRS Transfer Orders
                  </h2>
                  <div className='relative max-w-sm flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
                    <Input
                      placeholder='Search orders, materials, status...'
                      value={localSearchQuery}
                      onChange={(e) => setLocalSearchQuery(e.target.value)}
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

                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setIsWaveDialogOpen(true)}
                    className='border-border hover:bg-accent'
                  >
                    <Zap className='mr-2 h-4 w-4' />
                    Wave Delivery
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
                        onClick={refreshData}
                        className='hover:bg-accent'
                      >
                        <Filter className='mr-2 h-4 w-4' />
                        Refresh Data
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setLocalSearchQuery('')}
                        className='hover:bg-accent'
                      >
                        Clear Search
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className='flex items-center justify-center py-12'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <span className='ml-2'>Loading GRS outbound data...</span>
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
                            ? 'No GRS outbound data found. Click "Import Data" to add records from clipboard.'
                            : 'No data found matching your search.'}
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
                  {localSearchQuery && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setLocalSearchQuery('')}
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
                GRS Delivery Audit Trail
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

GRSDataManager.displayName = 'GRSDataManager'

export default GRSDataManager

// Created and developed by Jai Singh
