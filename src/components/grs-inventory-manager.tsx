// Created and developed by Jai Singh
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Camera,
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
  Scan,
  Search,
  X,
  ZoomIn,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import type { SQ01Data } from '@/lib/supabase/sq01-data.service'
import { logger } from '@/lib/utils/logger'
import { useSQ01Data } from '@/hooks/use-sq01-data'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Interface for unknown batches
interface UnknownBatch {
  id: string
  found_at_location: string
  batch_number: string
  material_number?: string
  serial_number?: string
  grs_notes?: string
  photo_url?: string
  found_by_name?: string
  found_at: string
  // Flag to identify this as unknown batch
  is_unknown_batch: true
}

interface GRSInventoryManagerProps {
  enableRealtime?: boolean
}

interface TableColumn {
  id: string
  label: string
  key: keyof SQ01Data | 'quantity' | 'quantity_status'
  width?: string
}

// Fixed column configuration for GRS Inventory
const FIXED_COLUMNS: TableColumn[] = [
  {
    id: 'conf_cert_ref',
    label: 'Location',
    key: 'conf_cert_ref',
    width: 'w-32',
  },
  { id: 'material', label: 'Material', key: 'material', width: 'w-28' },
  { id: 'batch', label: 'Batch', key: 'batch', width: 'w-28' },
  {
    id: 'grs_scan_status',
    label: 'GRS Scan Status',
    key: 'grs_scan_status',
    width: 'w-32',
  },
  { id: 'serial_number', label: 'Serial', key: 'serial_number', width: 'w-28' },
  { id: 'quantity', label: 'Quantity', key: 'quantity', width: 'w-24' },
  {
    id: 'grs_scanned_by_name',
    label: 'Scanned By',
    key: 'grs_scanned_by_name',
    width: 'w-32',
  },
  {
    id: 'grs_location_scan_completed_at',
    label: 'Date Scanned',
    key: 'grs_location_scan_completed_at',
    width: 'w-32',
  },
]

// Fixed header component
function FixedTableHeader({ column }: { column: TableColumn }) {
  return (
    <TableHead className={`text-foreground font-medium ${column.width}`}>
      {column.label}
    </TableHead>
  )
}

// Status badge component for GRS Scan Status
function GRSScanStatusBadge({ status }: { status: string | null }) {
  const getStatusStyles = (status: string | null) => {
    if (!status) return 'bg-gray-300 text-gray-800 border-gray-400'

    switch (status.toLowerCase()) {
      case 'scanned':
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-400'
      case 'pending':
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-400'
      case 'not_found':
      case 'missing':
        return 'bg-red-100 text-red-800 border-red-400'
      case 'verified':
        return 'bg-blue-100 text-blue-800 border-blue-400'
      case 'unknown_batch':
        return 'bg-orange-100 text-orange-800 border-orange-400'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  const getStatusDisplayName = (status: string | null) => {
    if (!status) return 'N/A'
    if (status.toLowerCase() === 'unknown_batch') return 'Unknown Batch'
    return status.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusStyles(status)}`}
    >
      {getStatusDisplayName(status)}
    </span>
  )
}

const GRSInventoryManager: React.FC<GRSInventoryManagerProps> = React.memo(
  ({ enableRealtime = true }) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [isVisible, setIsVisible] = useState(false)
    const [selectedItem, setSelectedItem] = useState<
      SQ01Data | UnknownBatch | null
    >(null)
    const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
    const [photoUrl, setPhotoUrl] = useState<string | null>(null)
    const [loadingPhoto, setLoadingPhoto] = useState(false)
    const [showUnknownBatches, setShowUnknownBatches] = useState(true)
    const [unknownBatches, setUnknownBatches] = useState<UnknownBatch[]>([])
    const [isPhotoExpanded, setIsPhotoExpanded] = useState(false)
    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 25

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

    // Only enable real-time when component is visible
    const shouldEnableRealtime = enableRealtime && isVisible

    // Local search query state
    const [localSearchQuery, setLocalSearchQuery] = useState('')

    const { data, isLoading, error, statistics, refreshData } = useSQ01Data({
      enableRealtime: shouldEnableRealtime,
      searchQuery: localSearchQuery,
      scannedOnly: true, // Only fetch scanned records for performance optimization
    })

    // Fetch unknown batches
    const fetchUnknownBatches = useCallback(async () => {
      try {
        const { data: unknownData, error: unknownError } = await supabase
          .from('grs_unknown_batches')
          .select('*')
          .order('found_at', { ascending: false })

        if (unknownError) {
          logger.error('Error fetching unknown batches:', unknownError)
          toast.error('Failed to load unknown batches')
          setUnknownBatches([])
          return
        }

        // Transform to match our interface
        const transformed: UnknownBatch[] = (unknownData || []).map(
          (batch) => ({
            id: batch.id,
            found_at_location: batch.found_at_location,
            batch_number: batch.batch_number,
            material_number: batch.material_number || undefined,
            serial_number: batch.serial_number || undefined,
            grs_notes: batch.grs_notes || undefined,
            photo_url: batch.photo_url || undefined,
            found_by_name: batch.found_by_name || undefined,
            found_at: batch.found_at ?? new Date().toISOString(),
            is_unknown_batch: true as const,
          })
        )

        setUnknownBatches(transformed)
      } catch (error) {
        logger.error('Error fetching unknown batches:', error)
        setUnknownBatches([])
      }
    }, [])

    // Fetch unknown batches on mount and when toggle changes
    useEffect(() => {
      if (showUnknownBatches) {
        fetchUnknownBatches()
      }
    }, [showUnknownBatches, fetchUnknownBatches])

    // Keyboard shortcut to close expanded photo (ESC key)
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && isPhotoExpanded) {
          setIsPhotoExpanded(false)
        }
      }

      if (isPhotoExpanded) {
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
      }
    }, [isPhotoExpanded])

    // Use fixed columns
    const fixedColumns = useMemo(() => FIXED_COLUMNS, [])

    // Merge regular inventory with unknown batches
    const mergedData = useMemo(() => {
      if (!showUnknownBatches) {
        return data
      }

      // Convert unknown batches to match SQ01Data structure for display
      const unknownBatchesAsInventory = unknownBatches.map(
        (batch) =>
          ({
            id: batch.id,
            conf_cert_ref: batch.found_at_location,
            material: batch.material_number || 'UNKNOWN',
            material_description: 'Unknown Batch - Found During Cycle Count',
            batch: batch.batch_number,
            serial_number: batch.serial_number || null,
            plant: null,
            sloc: null,
            val_type: null,
            unrestricted: 0,
            blocked: 0,
            in_qual_insp: 0,
            confirmed_yield: null,
            ext_mov_avg_price: null,
            shelf_life_exp_date: null,
            last_gr: null,
            created_on: null,
            general_info: null,
            created_at: batch.found_at,
            updated_at: batch.found_at,
            grs_scan_status: 'UNKNOWN_BATCH',
            grs_scanned_at: batch.found_at,
            grs_scanned_by: null,
            grs_scanned_by_name: batch.found_by_name || null,
            grs_location_scan_completed_at: batch.found_at,
            grs_actual_location_found: batch.found_at_location,
            grs_notes: batch.grs_notes || null,
            // Add flag to identify unknown batches
            is_unknown_batch: true,
            photo_url: batch.photo_url,
          }) as SQ01Data & { is_unknown_batch: boolean; photo_url?: string }
      )

      // Combine and sort by date (newest first)
      return [...data, ...unknownBatchesAsInventory].sort((a, b) => {
        const dateA = new Date(
          a.grs_location_scan_completed_at || a.created_at || 0
        ).getTime()
        const dateB = new Date(
          b.grs_location_scan_completed_at || b.created_at || 0
        ).getTime()
        return dateB - dateA
      })
    }, [data, unknownBatches, showUnknownBatches])

    // Filter data (no special filters for now)
    const filteredData = useMemo(() => {
      return mergedData
    }, [mergedData])

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

    // Handle export data with current column order
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
          ...filteredData.map((row: SQ01Data) =>
            fixedColumns
              .map((col) => {
                let value: string | number
                if (col.key === 'quantity') {
                  // Get quantity with blocked logic
                  const unrestricted = row.unrestricted || 0
                  const blocked = row.blocked || 0
                  value = unrestricted > 0 ? unrestricted : blocked
                } else {
                  value = (row[col.key as keyof SQ01Data] ?? '') as
                    | string
                    | number
                }
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
          `grs-inventory-${new Date().toISOString().split('T')[0]}.csv`
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

    // Optimized pagination handlers
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

    // Format date for display - exact timestamp
    const formatDate = (dateString: string | null) => {
      if (!dateString) return 'N/A'
      try {
        return format(new Date(dateString), 'MMM dd, yyyy h:mm:ss a')
      } catch {
        return dateString
      }
    }

    // Get cell content based on column
    const getCellContent = (item: SQ01Data, column: TableColumn) => {
      const value = item[column.key as keyof SQ01Data]

      switch (column.key) {
        case 'grs_scan_status':
          return <GRSScanStatusBadge status={(value as string) || null} />
        case 'grs_location_scan_completed_at':
          return formatDate(value as string)
        case 'quantity': {
          // Logic: Use unrestricted if > 0, otherwise use blocked
          const unrestricted = item.unrestricted || 0
          const blocked = item.blocked || 0
          const displayQty = unrestricted > 0 ? unrestricted : blocked
          const isBlocked = unrestricted === 0 && blocked > 0

          return (
            <div className='flex items-center gap-2'>
              <span
                className={
                  isBlocked ? 'font-semibold text-red-600' : 'text-foreground'
                }
              >
                {displayQty}
              </span>
              {isBlocked && (
                <Badge variant='destructive' className='text-xs'>
                  Blocked
                </Badge>
              )}
            </div>
          )
        }
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

    // Fetch photo for unknown batch
    const fetchPhotoForItem = useCallback(
      async (item: SQ01Data | UnknownBatch) => {
        setLoadingPhoto(true)
        try {
          // Check if item is unknown batch with photo already attached
          const itemWithPhoto = item as Record<string, unknown>
          if (itemWithPhoto.is_unknown_batch && itemWithPhoto.photo_url) {
            setPhotoUrl(itemWithPhoto.photo_url as string | null)
            setLoadingPhoto(false)
            return
          }

          // For regular inventory, try to find matching unknown batch photo
          if (
            !('batch' in item) ||
            !('conf_cert_ref' in item) ||
            !item.batch ||
            !item.conf_cert_ref
          ) {
            setPhotoUrl(null)
            setLoadingPhoto(false)
            return
          }

          const { data, error } = await supabase
            .from('grs_unknown_batches')
            .select('photo_url')
            .eq('batch_number', item.batch)
            .eq('found_at_location', item.conf_cert_ref)
            .maybeSingle()

          if (error) {
            logger.error('Error fetching photo:', error)
            setPhotoUrl(null)
            return
          }

          setPhotoUrl(data?.photo_url || null)
        } catch (error) {
          logger.error('Error fetching photo:', error)
          setPhotoUrl(null)
        } finally {
          setLoadingPhoto(false)
        }
      },
      []
    )

    // Handle view details click
    const handleViewDetails = useCallback(
      async (item: SQ01Data | UnknownBatch) => {
        setSelectedItem(item)
        setIsDetailsDialogOpen(true)
        fetchPhotoForItem(item)
      },
      [fetchPhotoForItem]
    )

    // Memoized statistics cards (must be before early return per rules-of-hooks)
    const StatisticsCards = useMemo(
      () => (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Total Items</CardTitle>
              <FileText className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.total?.toLocaleString() || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Total inventory items
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Scanned Items
              </CardTitle>
              <Scan className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.scannedCount || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Items with GRS scan
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Error Tracking
              </CardTitle>
              <AlertTriangle className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                {/* Blocked Items */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-red-600'>
                    {statistics?.blockedScanned || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Blocked</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                {/* Quality Hold Items */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-yellow-600'>
                    {statistics?.qualityHoldScanned || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>QA Hold</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                {/* Missing Serial Items */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-orange-600'>
                    {statistics?.missingSerialScanned || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>No Serial</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Inventory Metrics
              </CardTitle>
              <DatabaseIcon className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                {/* Locations Counted */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-blue-600'>
                    {statistics?.locationsScanned || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Counted</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                {/* Locations Remaining */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-gray-600'>
                    {statistics?.locationsRemaining || 0}
                  </div>
                  <p className='text-muted-foreground text-xs'>Remaining</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                {/* Location Accuracy */}
                <div className='text-center'>
                  <div className='text-2xl font-bold text-green-600'>
                    {statistics?.locationsScanned &&
                    statistics.locationsScanned > 0
                      ? (
                          (1 -
                            (statistics.locationsWithErrors || 0) /
                              statistics.locationsScanned) *
                          100
                        ).toFixed(1)
                      : '0.0'}
                    %
                  </div>
                  <p className='text-muted-foreground text-xs'>Loc Acc</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ),
      [statistics]
    )

    // Show error state
    if (error) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='p-6'>
            <div className='text-destructive text-center'>
              <p>Failed to load GRS inventory data: {error.message}</p>
              <Button onClick={() => refreshData()} className='mt-4'>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    }

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
                    GRS Inventory
                  </h2>
                  <div className='relative max-w-sm flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
                    <Input
                      placeholder='Search materials, locations, batches...'
                      value={localSearchQuery}
                      onChange={(e) => setLocalSearchQuery(e.target.value)}
                      className='bg-background border-border pl-10'
                    />
                  </div>
                </div>

                <div className='flex items-center gap-2'>
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
                      className='bg-background border-border w-64'
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
                        onClick={() => refreshData()}
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

                      <DropdownMenuSeparator />

                      {/* Show Issues Toggle */}
                      <div className='px-2 py-2'>
                        <div className='flex items-center justify-between gap-3 rounded-md border border-orange-200 bg-orange-50/50 px-2 py-1.5 dark:border-orange-800 dark:bg-orange-950/20'>
                          <div className='flex items-center gap-2'>
                            <AlertTriangle className='h-4 w-4 text-orange-600 dark:text-orange-400' />
                            <Label
                              htmlFor='show-unknown-batches'
                              className='cursor-pointer text-sm whitespace-nowrap'
                            >
                              Show Issues ({unknownBatches.length})
                            </Label>
                          </div>
                          <Switch
                            id='show-unknown-batches'
                            checked={showUnknownBatches}
                            onCheckedChange={setShowUnknownBatches}
                          />
                        </div>
                      </div>
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
                <span className='ml-2'>Loading GRS inventory data...</span>
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
                      currentPageData.map((item) => {
                        const isUnknownBatch =
                          (item as Record<string, unknown>).is_unknown_batch ===
                          true
                        return (
                          <TableRow
                            key={item.id}
                            className={`hover:bg-muted/50 ${isUnknownBatch ? 'bg-orange-50/50 dark:bg-orange-950/20' : ''}`}
                          >
                            {fixedColumns.map((column) => (
                              <TableCell
                                key={column.id}
                                className={`${column.width} ${
                                  column.key === 'material'
                                    ? 'text-foreground font-medium'
                                    : column.key === 'material_description'
                                      ? 'text-muted-foreground'
                                      : 'text-foreground'
                                }`}
                              >
                                {column.key === 'conf_cert_ref' &&
                                isUnknownBatch ? (
                                  <div className='flex items-center gap-2'>
                                    <AlertTriangle className='h-4 w-4 text-orange-600 dark:text-orange-400' />
                                    {getCellContent(item, column)}
                                  </div>
                                ) : (
                                  getCellContent(item, column)
                                )}
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
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={fixedColumns.length + 1}
                          className='text-muted-foreground py-8 text-center'
                        >
                          {data.length === 0
                            ? 'No GRS inventory data found.'
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
                    onClick={() => refreshData()}
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

        {/* Item Details Dialog - Baseball Card Style */}
        <Dialog
          open={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
        >
          <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
            <DialogHeader className='sr-only'>
              <DialogTitle>GRS Inventory Item Details</DialogTitle>
              <DialogDescription>
                Complete information for location{' '}
                {selectedItem && 'conf_cert_ref' in selectedItem
                  ? selectedItem.conf_cert_ref
                  : selectedItem && 'found_at_location' in selectedItem
                    ? selectedItem.found_at_location
                    : 'N/A'}
              </DialogDescription>
            </DialogHeader>

            {selectedItem && (
              <div className='space-y-4'>
                {/* Material Information Header - Uniform Style */}
                <Card className='border-muted border-2'>
                  <CardHeader className='pb-3'>
                    <div className='flex items-start justify-between'>
                      <div className='flex-1'>
                        <CardTitle className='mb-2 flex items-center gap-2 text-2xl font-bold'>
                          <Package className='h-6 w-6' />
                          {'material' in selectedItem
                            ? selectedItem.material || 'Unknown Material'
                            : selectedItem.material_number ||
                              'Unknown Material'}
                        </CardTitle>
                        <p className='text-muted-foreground text-sm'>
                          {'material_description' in selectedItem
                            ? selectedItem.material_description ||
                              'No description available'
                            : 'No description available'}
                        </p>
                      </div>
                      <Badge variant='secondary' className='ml-4'>
                        Plant:{' '}
                        {'plant' in selectedItem
                          ? selectedItem.plant || 'N/A'
                          : 'N/A'}
                      </Badge>
                    </div>
                  </CardHeader>
                </Card>

                {/* Baseball Card Body */}
                <div className='grid grid-cols-3 gap-6 px-2'>
                  {/* Left Column - Photo */}
                  <div className='col-span-1'>
                    <Card className='border-muted border-2'>
                      <CardContent className='p-4'>
                        <div
                          className={`relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 ${
                            photoUrl && !loadingPhoto
                              ? 'group cursor-pointer'
                              : ''
                          }`}
                          onClick={() =>
                            photoUrl &&
                            !loadingPhoto &&
                            setIsPhotoExpanded(true)
                          }
                        >
                          {loadingPhoto ? (
                            <div className='flex flex-col items-center gap-2'>
                              <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
                              <p className='text-muted-foreground text-sm'>
                                Loading photo...
                              </p>
                            </div>
                          ) : photoUrl ? (
                            <>
                              <img
                                src={photoUrl}
                                alt='GRS Cycle Count Photo'
                                className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-105'
                              />
                              {/* Hover Overlay */}
                              <div className='absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-300 group-hover:bg-black/20'>
                                <div className='rounded-full bg-white/90 p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:bg-gray-900/90'>
                                  <ZoomIn className='h-6 w-6 text-gray-900 dark:text-white' />
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className='text-muted-foreground flex flex-col items-center gap-2'>
                              <Camera className='h-12 w-12' />
                              <p className='px-4 text-center text-xs'>
                                No photo available
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Location Badge - Prominently Displayed */}
                        <div className='mt-4 text-center'>
                          <p className='text-muted-foreground mb-1 text-xs'>
                            LOCATION
                          </p>
                          <div className='bg-primary text-primary-foreground rounded-lg px-4 py-2 text-xl font-bold'>
                            {'conf_cert_ref' in selectedItem
                              ? selectedItem.conf_cert_ref || 'N/A'
                              : 'found_at_location' in selectedItem
                                ? selectedItem.found_at_location || 'N/A'
                                : 'N/A'}
                          </div>
                        </div>

                        {/* Batch Number */}
                        <div className='mt-3 text-center'>
                          <p className='text-muted-foreground mb-1 text-xs'>
                            BATCH
                          </p>
                          <p className='font-mono text-lg font-semibold'>
                            {'batch' in selectedItem
                              ? selectedItem.batch || 'N/A'
                              : selectedItem.batch_number || 'N/A'}
                          </p>
                        </div>

                        {/* Serial Number */}
                        {selectedItem.serial_number && (
                          <div className='mt-3 text-center'>
                            <p className='text-muted-foreground mb-1 text-xs'>
                              SERIAL NUMBER
                            </p>
                            <p className='font-mono text-sm'>
                              {selectedItem.serial_number}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Middle & Right Columns - Stats */}
                  <div className='col-span-2 space-y-4'>
                    {/* Quantity Stats - Baseball Card Style */}
                    <Card className='border-muted border-2'>
                      <CardHeader className='pb-3'>
                        <CardTitle className='flex items-center gap-2 text-lg font-bold'>
                          <Package className='h-5 w-5' />
                          INVENTORY STATS
                        </CardTitle>
                      </CardHeader>
                      <CardContent className='pt-4'>
                        <div className='grid grid-cols-3 gap-6'>
                          <div className='text-center'>
                            <p className='text-muted-foreground mb-2 text-xs font-semibold'>
                              UNRESTRICTED
                            </p>
                            <div className='rounded-lg bg-green-100 p-4 dark:bg-green-900/30'>
                              <p className='text-4xl font-bold text-green-700 dark:text-green-400'>
                                {'unrestricted' in selectedItem
                                  ? selectedItem.unrestricted || 0
                                  : 0}
                              </p>
                            </div>
                          </div>
                          <div className='text-center'>
                            <p className='text-muted-foreground mb-2 text-xs font-semibold'>
                              BLOCKED
                            </p>
                            <div className='rounded-lg bg-red-100 p-4 dark:bg-red-900/30'>
                              <p className='text-4xl font-bold text-red-700 dark:text-red-400'>
                                {'blocked' in selectedItem
                                  ? selectedItem.blocked || 0
                                  : 0}
                              </p>
                            </div>
                          </div>
                          <div className='text-center'>
                            <p className='text-muted-foreground mb-2 text-xs font-semibold'>
                              QA INSPECTION
                            </p>
                            <div className='rounded-lg bg-yellow-100 p-4 dark:bg-yellow-900/30'>
                              <p className='text-4xl font-bold text-yellow-700 dark:text-yellow-400'>
                                {'in_qual_insp' in selectedItem
                                  ? selectedItem.in_qual_insp || 0
                                  : 0}
                              </p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* GRS Scan Information */}
                    <Card className='border-muted border-2'>
                      <CardHeader className='pb-3'>
                        <CardTitle className='flex items-center gap-2 text-lg font-bold'>
                          <Scan className='h-5 w-5' />
                          GRS SCAN DETAILS
                        </CardTitle>
                      </CardHeader>
                      <CardContent className='pt-4'>
                        <div className='grid grid-cols-2 gap-4'>
                          <div>
                            <p className='text-muted-foreground mb-1 text-xs font-semibold'>
                              STATUS
                            </p>
                            <GRSScanStatusBadge
                              status={
                                'grs_scan_status' in selectedItem
                                  ? selectedItem.grs_scan_status
                                  : null
                              }
                            />
                          </div>
                          <div>
                            <p className='text-muted-foreground mb-1 text-xs font-semibold'>
                              SCANNED BY
                            </p>
                            <p className='font-medium'>
                              {'grs_scanned_by_name' in selectedItem
                                ? selectedItem.grs_scanned_by_name || 'N/A'
                                : selectedItem.found_by_name || 'N/A'}
                            </p>
                          </div>
                          <div className='col-span-2'>
                            <p className='text-muted-foreground mb-1 text-xs font-semibold'>
                              SCAN COMPLETED
                            </p>
                            <p className='text-sm font-medium'>
                              {'grs_location_scan_completed_at' in
                                selectedItem &&
                              selectedItem.grs_location_scan_completed_at
                                ? format(
                                    new Date(
                                      selectedItem.grs_location_scan_completed_at
                                    ),
                                    'MMM dd, yyyy h:mm:ss a'
                                  )
                                : 'Not completed'}
                            </p>
                          </div>
                          {'grs_actual_location_found' in selectedItem &&
                            selectedItem.grs_actual_location_found && (
                              <div className='col-span-2'>
                                <p className='text-muted-foreground mb-1 text-xs font-semibold'>
                                  ACTUAL LOCATION FOUND
                                </p>
                                <Badge variant='outline' className='font-mono'>
                                  {selectedItem.grs_actual_location_found}
                                </Badge>
                              </div>
                            )}
                          {'grs_notes' in selectedItem &&
                            selectedItem.grs_notes && (
                              <div className='col-span-2'>
                                <p className='text-muted-foreground mb-1 text-xs font-semibold'>
                                  NOTES
                                </p>
                                <p className='bg-muted/50 rounded p-2 text-sm'>
                                  {selectedItem.grs_notes}
                                </p>
                              </div>
                            )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Additional Info - Condensed */}
                    <Card className='border-muted border-2'>
                      <CardHeader className='pb-3'>
                        <CardTitle className='flex items-center gap-2 text-lg font-bold'>
                          <FileText className='h-5 w-5' />
                          ADDITIONAL INFO
                        </CardTitle>
                      </CardHeader>
                      <CardContent className='pt-4'>
                        <div className='grid grid-cols-3 gap-4 text-sm'>
                          <div>
                            <p className='text-muted-foreground text-xs font-semibold'>
                              Storage Loc
                            </p>
                            <p className='font-medium'>
                              {'sloc' in selectedItem
                                ? selectedItem.sloc || 'N/A'
                                : 'N/A'}
                            </p>
                          </div>
                          <div>
                            <p className='text-muted-foreground text-xs font-semibold'>
                              Val. Type
                            </p>
                            <p className='font-medium'>
                              {'val_type' in selectedItem
                                ? selectedItem.val_type || 'N/A'
                                : 'N/A'}
                            </p>
                          </div>
                          <div>
                            <p className='text-muted-foreground text-xs font-semibold'>
                              Confirmed Yield
                            </p>
                            <p className='font-medium'>
                              {'confirmed_yield' in selectedItem
                                ? selectedItem.confirmed_yield || 'N/A'
                                : 'N/A'}
                            </p>
                          </div>
                          <div>
                            <p className='text-muted-foreground text-xs font-semibold'>
                              Shelf Life Exp
                            </p>
                            <p className='font-medium'>
                              {'shelf_life_exp_date' in selectedItem &&
                              selectedItem.shelf_life_exp_date
                                ? format(
                                    new Date(selectedItem.shelf_life_exp_date),
                                    'MMM dd, yyyy'
                                  )
                                : 'N/A'}
                            </p>
                          </div>
                          <div>
                            <p className='text-muted-foreground text-xs font-semibold'>
                              Last GR
                            </p>
                            <p className='font-medium'>
                              {'last_gr' in selectedItem && selectedItem.last_gr
                                ? format(
                                    new Date(selectedItem.last_gr),
                                    'MMM dd, yyyy'
                                  )
                                : 'N/A'}
                            </p>
                          </div>
                          <div>
                            <p className='text-muted-foreground text-xs font-semibold'>
                              Last Updated
                            </p>
                            <p className='font-medium'>
                              {'updated_at' in selectedItem &&
                              selectedItem.updated_at
                                ? format(
                                    new Date(selectedItem.updated_at),
                                    'MMM dd, yyyy'
                                  )
                                : 'N/A'}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Full-Screen Photo Viewer with Beautiful Animations */}
        <AnimatePresence>
          {isPhotoExpanded && photoUrl && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className='fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4 backdrop-blur-sm'
              onClick={() => setIsPhotoExpanded(false)}
            >
              {/* Close Button */}
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ delay: 0.1, duration: 0.2 }}
                onClick={() => setIsPhotoExpanded(false)}
                className='group absolute top-4 right-4 z-[101] rounded-full bg-white/10 p-3 backdrop-blur-md transition-all duration-200 hover:bg-white/20'
              >
                <X className='h-6 w-6 text-white transition-transform duration-300 group-hover:rotate-90' />
              </motion.button>

              {/* Photo Container */}
              <motion.div
                initial={{ scale: 0.5, opacity: 0, y: 50 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.5, opacity: 0, y: 50 }}
                transition={{
                  type: 'spring',
                  stiffness: 300,
                  damping: 30,
                  duration: 0.4,
                }}
                className='relative max-h-[90vh] max-w-6xl'
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={photoUrl}
                  alt='GRS Cycle Count Photo - Expanded View'
                  className='h-full w-full rounded-lg object-contain shadow-2xl'
                />

                {/* Photo Info Overlay */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.3 }}
                  className='absolute right-0 bottom-0 left-0 rounded-b-lg bg-gradient-to-t from-black/80 to-transparent p-6'
                >
                  <div className='text-white'>
                    <p className='text-sm font-medium opacity-80'>
                      GRS Cycle Count Photo
                    </p>
                    <p className='text-lg font-bold'>
                      {selectedItem && 'material' in selectedItem
                        ? selectedItem.material || 'Unknown Material'
                        : selectedItem && 'material_number' in selectedItem
                          ? selectedItem.material_number || 'Unknown Material'
                          : 'Unknown Material'}{' '}
                      - Batch:{' '}
                      {selectedItem && 'batch' in selectedItem
                        ? selectedItem.batch || 'N/A'
                        : selectedItem && 'batch_number' in selectedItem
                          ? selectedItem.batch_number || 'N/A'
                          : 'N/A'}
                    </p>
                    <p className='mt-1 text-sm opacity-80'>
                      Location:{' '}
                      {selectedItem && 'conf_cert_ref' in selectedItem
                        ? selectedItem.conf_cert_ref || 'N/A'
                        : selectedItem && 'found_at_location' in selectedItem
                          ? selectedItem.found_at_location || 'N/A'
                          : 'N/A'}
                    </p>
                  </div>
                </motion.div>
              </motion.div>

              {/* Instructions */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.3 }}
                className='absolute bottom-4 left-1/2 -translate-x-1/2 transform text-sm text-white/60'
              >
                Click anywhere or press ESC to close
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }
)

GRSInventoryManager.displayName = 'GRSInventoryManager'

export default GRSInventoryManager

// Created and developed by Jai Singh
