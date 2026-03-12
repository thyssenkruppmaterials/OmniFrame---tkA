import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, toZonedTime } from 'date-fns-tz'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Loader2,
  MoreHorizontal,
  Package,
  Search,
  Truck,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import type { GRSGRIPProcessingWithUser } from '@/lib/supabase/grs-grip-processing.service'
import { logger } from '@/lib/utils/logger'
import { useGRSGRIPProcessing } from '@/hooks/use-grs-grip-processing'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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

interface GRSGRIPProcessingSearchProps {
  enableRealtime?: boolean
}

interface TableColumn {
  id: string
  label: string
  key: keyof GRSGRIPProcessingWithUser[0]
  width?: string
  sortable?: boolean
}

interface SortConfig {
  key: keyof GRSGRIPProcessingWithUser[0]
  direction: 'asc' | 'desc'
}

// Default column configuration for GRS GRIP processing operations
const DEFAULT_COLUMNS: TableColumn[] = [
  {
    id: 'created_at',
    label: 'Processing Started',
    key: 'created_at',
    width: 'w-36',
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
    id: 'batch_number',
    label: 'Batch Number',
    key: 'batch_number',
    width: 'w-28',
    sortable: true,
  },
  {
    id: 'processing_location',
    label: 'Location',
    key: 'processing_location',
    width: 'w-32',
    sortable: true,
  },
  {
    id: 'processed_by',
    label: 'Processed By',
    key: 'processed_by',
    width: 'w-28',
    sortable: true,
  },
  {
    id: 'processing_status',
    label: 'Status',
    key: 'processing_status',
    width: 'w-28',
    sortable: true,
  },
  {
    id: 'grip_stage',
    label: 'GRIP Stage',
    key: 'grip_stage',
    width: 'w-32',
    sortable: true,
  },
  {
    id: 'grip_priority',
    label: 'Priority',
    key: 'grip_priority',
    width: 'w-24',
    sortable: true,
  },
  {
    id: 'is_quality_hold',
    label: 'Quality Hold',
    key: 'is_quality_hold',
    width: 'w-24',
    sortable: true,
  },
  {
    id: 'processed_quantity',
    label: 'Processed Qty',
    key: 'processed_quantity',
    width: 'w-28',
    sortable: true,
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
  onSort: (key: keyof GRSGRIPProcessingWithUser[0]) => void
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

// Quality Hold badge component
function QualityHoldBadge({
  isQualityHold,
}: {
  isQualityHold?: boolean | null
}) {
  if (isQualityHold === null || isQualityHold === undefined) {
    return <span className='text-muted-foreground'>N/A</span>
  }

  return (
    <Badge
      variant={isQualityHold ? 'destructive' : 'secondary'}
      className={
        isQualityHold
          ? 'border-red-300 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
          : 'border-gray-300 bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
      }
    >
      {isQualityHold ? 'On Hold' : 'Normal'}
    </Badge>
  )
}

// Priority badge component
function PriorityBadge({ priority }: { priority?: string | null }) {
  if (!priority) {
    return <span className='text-muted-foreground'>N/A</span>
  }

  const getPriorityColor = (priority: string) => {
    switch (priority.toUpperCase()) {
      case 'HIGH':
        return 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-300'
      case 'NORMAL':
        return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900 dark:text-blue-300'
      case 'LOW':
        return 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  return (
    <Badge
      variant='outline'
      className={`capitalize ${getPriorityColor(priority)}`}
    >
      {priority.toLowerCase()}
    </Badge>
  )
}

// Status badge component
function StatusBadge({ status }: { status?: string | null }) {
  if (!status) {
    return <span className='text-muted-foreground'>N/A</span>
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-300'
      case 'in progress':
      case 'processing':
        return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900 dark:text-blue-300'
      case 'quality hold':
      case 'on hold':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-300'
      case 'rejected':
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  return (
    <Badge variant='outline' className={`capitalize ${getStatusColor(status)}`}>
      {status}
    </Badge>
  )
}

const GRSGRIPProcessingSearch: React.FC<GRSGRIPProcessingSearchProps> =
  React.memo(({ enableRealtime = true }) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [isVisible, setIsVisible] = useState(false)
    const [sortConfig, setSortConfig] = useState<SortConfig>({
      key: 'created_at',
      direction: 'desc',
    })

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

    // Only enable real-time when component is visible and user wants it enabled
    const shouldEnableRealtime = enableRealtime && isVisible

    const {
      data,
      filteredData,
      statistics,
      isLoading,
      error,
      searchQuery,
      setSearchQuery,
      refreshData,
      exportToCSV,
    } = useGRSGRIPProcessing({ enableRealtime: shouldEnableRealtime })

    // Sort and paginate data
    const sortedData = useMemo(() => {
      const processedData = [...filteredData]

      // Apply sorting
      if (sortConfig) {
        processedData.sort((a, b) => {
          const aValue = (a as Record<string, unknown>)[sortConfig.key]
          const bValue = (b as Record<string, unknown>)[sortConfig.key]

          // Handle null/undefined values
          if (aValue === null || aValue === undefined) return 1
          if (bValue === null || bValue === undefined) return -1

          // Handle different data types
          let comparison = 0
          if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
            comparison = aValue === bValue ? 0 : aValue ? -1 : 1
          } else if (
            sortConfig.key.toString().includes('_date') ||
            sortConfig.key.toString().includes('_at')
          ) {
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

    // Pagination calculations
    const totalRecords = sortedData.length
    const totalPages = Math.ceil(totalRecords / recordsPerPage)
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = startIndex + recordsPerPage
    const currentPageData = sortedData.slice(startIndex, endIndex)

    // Sorting handler
    const handleSort = useCallback(
      (key: keyof GRSGRIPProcessingWithUser[0]) => {
        setSortConfig((prevConfig) => ({
          key,
          direction:
            prevConfig?.key === key && prevConfig.direction === 'asc'
              ? 'desc'
              : 'asc',
        }))
      },
      []
    )

    // Reset to first page when search changes
    React.useEffect(() => {
      setCurrentPage(1)
    }, [searchQuery])

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
          `grs-grip-processing-operations-${new Date().toISOString().split('T')[0]}.csv`
        )
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        toast.success(
          `Exported ${sortedData.length} GRS GRIP processing operations`
        )
      } catch (error) {
        toast.error('Export failed')
        logger.error('Export error:', error)
      }
    }, [sortedData, exportToCSV])

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

    // Get cell content based on column
    const getCellContent = (
      item: GRSGRIPProcessingWithUser[0],
      column: TableColumn
    ) => {
      const value = item[column.key]

      switch (column.key) {
        case 'processing_status':
          return <StatusBadge status={value as string} />
        case 'is_quality_hold':
          return <QualityHoldBadge isQualityHold={value as boolean} />
        case 'grip_priority':
          return <PriorityBadge priority={value as string} />
        case 'created_at':
        case 'updated_at':
        case 'processing_started_at':
        case 'processing_completed_at':
          return formatDateTimeEST(value as string)
        case 'received_quantity':
        case 'processed_quantity':
        case 'rejected_quantity':
          return value ? `${value} ${item.unit_of_measure || ''}`.trim() : 'N/A'
        case 'grip_stage':
          return value ? (
            <span className='font-medium capitalize'>
              {String(value).replace(/_/g, ' ').toLowerCase()}
            </span>
          ) : (
            'N/A'
          )
        case 'grip_workflow_type':
          return value ? (
            <span className='text-muted-foreground capitalize'>
              {String(value).replace(/_/g, ' ').toLowerCase()}
            </span>
          ) : (
            'N/A'
          )
        default:
          // Ensure we never try to render objects as JSX
          if (value && typeof value === 'object') {
            return 'N/A'
          }
          return value || 'N/A'
      }
    }

    // Memoized statistics cards to prevent unnecessary re-renders
    const StatisticsCards = useMemo(
      () => (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Total Processing
              </CardTitle>
              <Zap className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.totalProcessing || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                {statistics?.todayProcessing || 0} started today
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Materials</CardTitle>
              <Package className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.uniqueMaterials || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Unique materials processing
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Operators</CardTitle>
              <Truck className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.uniqueOperators || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Active GRS GRIP operators
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Quality Holds
              </CardTitle>
              <AlertTriangle className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.qualityHoldProcessing || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Operations on quality hold
              </p>
            </CardContent>
          </Card>
        </div>
      ),
      [statistics]
    )

    return (
      <div ref={componentRef} className='space-y-6'>
        {/* Error State */}
        {error ? (
          <Card className='bg-background border-border w-full'>
            <CardContent className='p-6'>
              <div className='text-destructive text-center'>
                <p>
                  Failed to load GRS GRIP processing operations data:{' '}
                  {error.message}
                </p>
                <Button onClick={refreshData} className='mt-4'>
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
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
                        GRS GRIP Processing Search
                      </h2>
                      <div className='relative max-w-sm flex-1'>
                        <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
                        <Input
                          placeholder='Search materials, operators, locations...'
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
                        onClick={handleExportData}
                        disabled={sortedData.length === 0}
                        className='border-border hover:bg-accent'
                      >
                        <Download className='mr-2 h-4 w-4' />
                        Export
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
                    <span className='ml-2'>
                      Loading GRS GRIP processing operations data...
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
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {currentPageData.length > 0 ? (
                          currentPageData.map((item) => (
                            <TableRow
                              key={item.id}
                              className='hover:bg-muted/50'
                            >
                              {DEFAULT_COLUMNS.map((column) => (
                                <TableCell
                                  key={column.id}
                                  className={`${column.width} ${
                                    column.key === 'material_number'
                                      ? 'text-foreground font-medium'
                                      : column.key === 'batch_number'
                                        ? 'text-foreground font-mono'
                                        : column.key === 'processed_by'
                                          ? 'text-foreground'
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
                              {data.length === 0
                                ? 'No GRS GRIP processing operations found.'
                                : 'No data found matching your search criteria.'}
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
                        Showing {startIndex + 1}-
                        {Math.min(endIndex, totalRecords)} of {totalRecords}{' '}
                        entries
                        {totalRecords !== data.length &&
                          ` (filtered from ${data.length} total)`}
                      </span>
                      {enableRealtime && (
                        <span className='flex items-center gap-1 text-green-500'>
                          ● Live Updates
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
          </>
        )}
      </div>
    )
  })

GRSGRIPProcessingSearch.displayName = 'GRSGRIPProcessingSearch'

export default GRSGRIPProcessingSearch
