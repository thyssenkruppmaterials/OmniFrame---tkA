/**
 * Putback Log Search Component - October 20, 2025
 *
 * Comprehensive search and management interface for putback tickets.
 * Updated to match Putaway Log Search design exactly.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, toZonedTime } from 'date-fns-tz'
import {
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  Package,
  Search,
  Truck,
  XCircle,
} from 'lucide-react'
import type { PutbackTicketWithUser } from '@/lib/supabase/putback-log.service'
import { cn } from '@/lib/utils'
import { usePutbackLog } from '@/hooks/use-putback-log'
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
    const zonedDate = toZonedTime(date, 'America/New_York')
    return format(zonedDate, 'MM/dd/yyyy h:mm:ss a', {
      timeZone: 'America/New_York',
    })
  } catch {
    return 'Invalid Date'
  }
}

interface PutbackLogSearchProps {
  enableRealtime?: boolean
}

interface TableColumn {
  id: string
  label: string
  sortable: boolean
  width?: string
  key: keyof PutbackTicketWithUser
}

interface SortConfig {
  key: keyof PutbackTicketWithUser
  direction: 'asc' | 'desc'
}

// Default columns configuration
const DEFAULT_COLUMNS: TableColumn[] = [
  {
    id: 'putback_number',
    label: 'Putback Number',
    sortable: true,
    width: 'w-40',
    key: 'putback_number',
  },
  {
    id: 'delivery_id',
    label: 'Delivery ID',
    sortable: true,
    width: 'w-36',
    key: 'delivery_id',
  },
  {
    id: 'material_number',
    label: 'Material Number',
    sortable: true,
    width: 'w-48',
    key: 'material_number',
  },
  {
    id: 'created_by',
    label: 'Created By',
    sortable: true,
    width: 'w-44',
    key: 'creator_name',
  },
  {
    id: 'quantity_returned',
    label: 'Quantity Returned',
    sortable: true,
    width: 'w-32',
    key: 'quantity_returned',
  },
  {
    id: 'processed_by',
    label: 'Processed By',
    sortable: true,
    width: 'w-44',
    key: 'processor_name',
  },
  {
    id: 'status',
    label: 'Putback Status',
    sortable: true,
    width: 'w-32',
    key: 'status',
  },
]

const PutbackLogSearch: React.FC<PutbackLogSearchProps> = React.memo(
  ({ enableRealtime = true }) => {
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
    } = usePutbackLog({ enableRealtime: shouldEnableRealtime })

    // Sort and paginate data
    const sortedData = useMemo(() => {
      const processedData = [...filteredData]

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

    // Pagination calculations
    const totalRecords = sortedData.length
    const totalPages = Math.ceil(totalRecords / recordsPerPage)
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = startIndex + recordsPerPage
    const currentPageData = sortedData.slice(startIndex, endIndex)

    // Pagination handlers
    const goToPage = useCallback((page: number) => {
      setCurrentPage(page)
    }, [])

    const goToNextPage = useCallback(() => {
      if (currentPage < totalPages) {
        setCurrentPage(currentPage + 1)
      }
    }, [currentPage, totalPages])

    const goToPreviousPage = useCallback(() => {
      if (currentPage > 1) {
        setCurrentPage(currentPage - 1)
      }
    }, [currentPage])

    // Sorting handler
    const handleSort = useCallback((key: keyof PutbackTicketWithUser) => {
      setSortConfig((prevConfig) => ({
        key,
        direction:
          prevConfig?.key === key && prevConfig.direction === 'asc'
            ? 'desc'
            : 'asc',
      }))
    }, [])

    // Reset to first page when search changes
    useEffect(() => {
      setCurrentPage(1)
    }, [searchQuery])

    // Sortable table header component
    const SortableTableHeader: React.FC<{
      column: TableColumn
      sortConfig: SortConfig | null
      onSort: (key: keyof PutbackTicketWithUser) => void
    }> = ({ column, sortConfig, onSort }) => {
      const isSorted = sortConfig?.key === column.key
      const isAscending = isSorted && sortConfig.direction === 'asc'

      return (
        <TableHead
          className={cn(
            column.width,
            column.sortable && 'hover:bg-muted/50 cursor-pointer select-none'
          )}
          onClick={() => column.sortable && onSort(column.key)}
        >
          <Button
            variant='ghost'
            size='sm'
            className='h-8 p-0 font-medium hover:bg-transparent'
          >
            {column.label}
            {column.sortable && (
              <>
                {isSorted ? (
                  isAscending ? (
                    <ChevronUp className='ml-2 h-4 w-4' />
                  ) : (
                    <ChevronDown className='ml-2 h-4 w-4' />
                  )
                ) : (
                  <ChevronDown className='ml-2 h-4 w-4 opacity-20' />
                )}
              </>
            )}
          </Button>
        </TableHead>
      )
    }

    // Render status badge
    const renderStatusBadge = (status: string) => {
      switch (status) {
        case 'open':
          return (
            <Badge
              variant='outline'
              className='border-yellow-300 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-100'
            >
              Open
            </Badge>
          )
        case 'completed':
          return (
            <Badge
              variant='outline'
              className='border-green-300 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100'
            >
              Completed
            </Badge>
          )
        case 'cancelled':
          return (
            <Badge
              variant='outline'
              className='border-red-300 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100'
            >
              Cancelled
            </Badge>
          )
        default:
          return <Badge variant='outline'>{status}</Badge>
      }
    }

    // Cell content renderer
    const getCellContent = (
      ticket: PutbackTicketWithUser,
      column: TableColumn
    ) => {
      switch (column.key) {
        case 'putback_number':
          return (
            <div className='flex items-center'>
              <FileText className='mr-2 h-4 w-4 text-blue-500' />
              {ticket.putback_number}
            </div>
          )
        case 'delivery_id':
          return ticket.delivery_id
        case 'material_number':
          return (
            <div>
              <div className='font-medium'>{ticket.material_number}</div>
              {ticket.material_description && (
                <div className='text-muted-foreground max-w-[200px] truncate text-xs'>
                  {ticket.material_description}
                </div>
              )}
            </div>
          )
        case 'creator_name':
          return (
            <div>
              <div className='font-medium'>
                {ticket.creator_name || ticket.creator_email || 'Unknown'}
              </div>
              <div className='text-muted-foreground text-xs'>
                {formatDateTimeEST(ticket.created_at)}
              </div>
            </div>
          )
        case 'quantity_returned':
          return (
            <div className='text-right font-medium'>
              {ticket.quantity_returned.toLocaleString()}
            </div>
          )
        case 'processor_name':
          return ticket.processed_by ? (
            <div>
              <div className='font-medium'>
                {ticket.processor_name || ticket.processor_email || 'Unknown'}
              </div>
              <div className='text-muted-foreground text-xs'>
                {formatDateTimeEST(ticket.processed_at)}
              </div>
            </div>
          ) : (
            <span className='text-muted-foreground text-sm'>Not processed</span>
          )
        case 'status':
          return renderStatusBadge(ticket.status)
        default:
          return 'N/A'
      }
    }

    if (error) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='p-6'>
            <div className='flex h-96 items-center justify-center'>
              <div className='space-y-4 text-center'>
                <XCircle className='text-destructive mx-auto h-16 w-16' />
                <p className='text-lg font-semibold'>
                  Error loading putback tickets
                </p>
                <p className='text-muted-foreground text-sm'>{error.message}</p>
                <Button onClick={refreshData}>Retry</Button>
              </div>
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
                Total Putback Tickets
              </CardTitle>
              <FileText className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics.totalTickets.toLocaleString()}
              </div>
              <p className='text-muted-foreground mt-1 text-xs'>
                All time putback tickets
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Today's Tickets
              </CardTitle>
              <Package className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics.todayTickets.toLocaleString()}
              </div>
              <p className='text-muted-foreground mt-1 text-xs'>
                Created today
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Open Tickets
              </CardTitle>
              <Truck className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics.openTickets.toLocaleString()}
              </div>
              <p className='text-muted-foreground mt-1 text-xs'>
                Awaiting processing
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Completed</CardTitle>
              <CheckCircle className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics.completedTickets.toLocaleString()}
              </div>
              <p className='text-muted-foreground mt-1 text-xs'>
                Successfully processed
              </p>
            </CardContent>
          </Card>
        </div>
      ),
      [statistics]
    )

    return (
      <div className='space-y-6' ref={componentRef}>
        {/* Statistics Cards */}
        {StatisticsCards}

        {/* Data Table Card */}
        <Card className='bg-background border-border w-full'>
          <CardHeader className='pb-4'>
            <div className='flex flex-col space-y-4'>
              {/* Main Header */}
              <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                <div className='flex flex-1 flex-col items-start gap-4 sm:flex-row sm:items-center'>
                  <h2 className='text-foreground text-2xl font-semibold'>
                    Putback Log Search
                  </h2>
                  <div className='relative max-w-sm flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
                    <Input
                      placeholder='Search putback tickets...'
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
                    onClick={exportToCSV}
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
                      {searchQuery && (
                        <DropdownMenuItem
                          onClick={() => setSearchQuery('')}
                          className='hover:bg-accent'
                        >
                          <Search className='mr-2 h-4 w-4' />
                          Clear Search
                        </DropdownMenuItem>
                      )}
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
                <span className='ml-2'>Loading putback tickets...</span>
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
                      currentPageData.map((ticket) => (
                        <TableRow key={ticket.id} className='hover:bg-muted/50'>
                          {DEFAULT_COLUMNS.map((column) => (
                            <TableCell
                              key={column.id}
                              className={cn(
                                column.width,
                                column.key === 'material_number' &&
                                  'text-foreground font-medium',
                                column.key === 'quantity_returned' &&
                                  'text-right'
                              )}
                            >
                              {getCellContent(ticket, column)}
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
                            ? 'No putback tickets found.'
                            : 'No data found matching your search criteria.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {!isLoading && totalRecords > 0 && (
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

                  {/* Refresh button */}
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={refreshData}
                    className='border-border hover:bg-accent'
                  >
                    Refresh
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }
)

PutbackLogSearch.displayName = 'PutbackLogSearch'

export default PutbackLogSearch
