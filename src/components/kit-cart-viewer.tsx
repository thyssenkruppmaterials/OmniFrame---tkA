/**
 * Kit Cart Viewer Component
 *
 * Real-time viewer for Nefab PFC Trace kit cart data.
 * Displays kit cart status, location, and tracking information.
 *
 * @author Jai Singh
 * @date December 17, 2025
 * @version 1.0.0
 */
import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import {
  Battery,
  BatteryLow,
  BatteryMedium,
  BatteryFull,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  Loader2,
  MapPin,
  MoreHorizontal,
  Package,
  RefreshCw,
  Search,
  Boxes,
  Timer,
  Warehouse,
} from 'lucide-react'
import { useKitCartData, type NefabItem } from '@/hooks/use-kit-cart-data'
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
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ==================== TYPES ====================

interface KitCartViewerProps {
  /**
   * Enable real-time polling (default: true)
   */
  enablePolling?: boolean

  /**
   * Polling interval in milliseconds (default: 60000)
   */
  pollingInterval?: number

  /**
   * Only show kit cart types (default: false for all items)
   */
  kitCartsOnly?: boolean
}

interface TableColumn {
  id: string
  label: string
  key: keyof NefabItem | 'tracker' | 'location' | 'cartNumber'
  width?: string
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Parse cart name to extract base name and cart number suffix
 * Example: "CART 1107/MT7 Flow 5A-01" -> { baseName: "CART 1107/MT7 Flow 5A", cartNumber: "01" }
 */
function parseCartName(name: string): {
  baseName: string
  cartNumber: string | null
} {
  // Match pattern like "-01", "-02", "-03" at the end of the name
  const match = name.match(/^(.+)-(\d{2,})$/)
  if (match) {
    return {
      baseName: match[1],
      cartNumber: match[2],
    }
  }
  return {
    baseName: name,
    cartNumber: null,
  }
}

// ==================== COLUMN CONFIGURATION ====================

const COLUMNS: TableColumn[] = [
  { id: 'name', label: 'Cart Name', key: 'Name', width: 'w-48' },
  { id: 'cartNumber', label: 'Cart #', key: 'cartNumber', width: 'w-20' },
  { id: 'itemType', label: 'Type', key: 'ItemType', width: 'w-36' },
  { id: 'status', label: 'Status', key: 'StatusName', width: 'w-28' },
  {
    id: 'warehouse',
    label: 'Warehouse',
    key: 'StatusWarehouse',
    width: 'w-36',
  },
  { id: 'location', label: 'Location', key: 'location', width: 'w-28' },
  { id: 'tracker', label: 'Tracker', key: 'tracker', width: 'w-32' },
  { id: 'cycles', label: 'Cycles', key: 'Cycles', width: 'w-20' },
  { id: 'lastUpdate', label: 'Last Update', key: 'LastUpdate', width: 'w-32' },
]

// ==================== HELPER COMPONENTS ====================

/**
 * Status badge with color coding
 */
function StatusBadge({ status }: { status: string }) {
  const getStatusStyles = (status: string) => {
    const s = status.toLowerCase()
    if (s === 'inwarehouse')
      return 'bg-green-100 text-green-800 border-green-400'
    if (s === 'intransit') return 'bg-blue-100 text-blue-800 border-blue-400'
    if (s === 'atcustomer')
      return 'bg-purple-100 text-purple-800 border-purple-400'
    if (s === 'missing' || s === 'lost')
      return 'bg-red-100 text-red-800 border-red-400'
    if (s === 'maintenance')
      return 'bg-yellow-100 text-yellow-800 border-yellow-400'
    return 'bg-gray-100 text-gray-800 border-gray-300'
  }

  const formatStatus = (status: string) => {
    return status
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim()
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusStyles(status)}`}
    >
      {formatStatus(status)}
    </span>
  )
}

/**
 * Battery indicator component
 */
function BatteryIndicator({ level }: { level: number | undefined }) {
  if (level === undefined || level === null) {
    return <span className='text-muted-foreground'>-</span>
  }

  const Icon =
    level > 75 ? BatteryFull : level > 40 ? BatteryMedium : BatteryLow
  const color =
    level > 75
      ? 'text-green-600'
      : level > 40
        ? 'text-yellow-600'
        : 'text-red-600'

  return (
    <div className='flex items-center gap-1'>
      <Icon className={`h-4 w-4 ${color}`} />
      <span className={`text-xs ${color}`}>{level}%</span>
    </div>
  )
}

// ==================== MAIN COMPONENT ====================

const KitCartViewer: React.FC<KitCartViewerProps> = React.memo(
  ({ enablePolling = true, pollingInterval = 60000, kitCartsOnly = false }) => {
    // Local state
    const [currentPage, setCurrentPage] = useState(1)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedItem, setSelectedItem] = useState<NefabItem | null>(null)
    const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
    const [isVisible, setIsVisible] = useState(false)
    const [sortConfig, setSortConfig] = useState<{
      key: string
      direction: 'asc' | 'desc'
    }>({
      key: 'Name',
      direction: 'asc',
    })
    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 25

    // Intersection Observer for visibility-based polling
    useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          setIsVisible(entry.isIntersecting)
        },
        { threshold: 0.1, rootMargin: '50px' }
      )

      if (componentRef.current) {
        observer.observe(componentRef.current)
      }

      return () => {
        observer.disconnect()
      }
    }, [])

    // Fetch data with real-time polling
    const {
      items,
      isLoading,
      error,
      totalCount,
      cached,
      cacheAgeSeconds,
      isPolling,
      refreshData,
      statistics,
      itemTypes,
      setItemTypeFilter,
      currentFilter,
    } = useKitCartData({
      enablePolling: enablePolling && isVisible,
      pollingInterval,
      kitCartsOnly,
      searchQuery,
    })

    // Handle column sorting
    const handleSort = useCallback((key: string) => {
      setSortConfig((prevConfig) => ({
        key,
        direction:
          prevConfig.key === key && prevConfig.direction === 'asc'
            ? 'desc'
            : 'asc',
      }))
    }, [])

    // Sort items based on current sort config
    const sortedItems = useMemo(() => {
      const sorted = [...items]

      sorted.sort((a, b) => {
        let aValue: string | number | null = null
        let bValue: string | number | null = null

        switch (sortConfig.key) {
          case 'Name': {
            // Sort by base name, then by cart number
            const aName = parseCartName(a.Name)
            const bName = parseCartName(b.Name)
            const nameCompare = aName.baseName.localeCompare(bName.baseName)
            if (nameCompare !== 0) {
              return sortConfig.direction === 'asc' ? nameCompare : -nameCompare
            }
            // If base names are equal, sort by cart number
            aValue = aName.cartNumber ? parseInt(aName.cartNumber, 10) : 0
            bValue = bName.cartNumber ? parseInt(bName.cartNumber, 10) : 0
            break
          }
          case 'cartNumber': {
            const aCart = parseCartName(a.Name).cartNumber
            const bCart = parseCartName(b.Name).cartNumber
            aValue = aCart ? parseInt(aCart, 10) : 0
            bValue = bCart ? parseInt(bCart, 10) : 0
            break
          }
          case 'ItemType':
            aValue = a.ItemType?.Name || ''
            bValue = b.ItemType?.Name || ''
            break
          case 'StatusName':
            aValue = a.StatusName || ''
            bValue = b.StatusName || ''
            break
          case 'StatusWarehouse':
            aValue = a.StatusWarehouse?.Name || ''
            bValue = b.StatusWarehouse?.Name || ''
            break
          case 'location':
            aValue = a.Location?.Name || ''
            bValue = b.Location?.Name || ''
            break
          case 'tracker':
            aValue = a.Trackers?.[0]?.Battery ?? 0
            bValue = b.Trackers?.[0]?.Battery ?? 0
            break
          case 'Cycles':
            aValue = a.Cycles ?? 0
            bValue = b.Cycles ?? 0
            break
          case 'LastUpdate':
            aValue = a.LastUpdate ? new Date(a.LastUpdate).getTime() : 0
            bValue = b.LastUpdate ? new Date(b.LastUpdate).getTime() : 0
            break
          default:
            return 0
        }

        // Handle string comparison
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          const comparison = aValue.localeCompare(bValue)
          return sortConfig.direction === 'asc' ? comparison : -comparison
        }

        // Handle number comparison
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1
        return 0
      })

      return sorted
    }, [items, sortConfig])

    // Pagination
    const totalPages = Math.ceil(sortedItems.length / recordsPerPage)
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = startIndex + recordsPerPage
    const currentPageData = sortedItems.slice(startIndex, endIndex)

    // Reset to first page when search or sort changes
    useEffect(() => {
      setCurrentPage(1)
    }, [searchQuery, currentFilter, sortConfig])

    // Format date for display
    const formatDate = useCallback((dateString: string | null | undefined) => {
      if (!dateString) return 'N/A'
      try {
        return formatDistanceToNow(new Date(dateString), { addSuffix: true })
      } catch {
        return dateString
      }
    }, [])

    // Get cell content
    const getCellContent = useCallback(
      (item: NefabItem, column: TableColumn) => {
        const { baseName, cartNumber } = parseCartName(item.Name)

        switch (column.key) {
          case 'Name':
            return (
              <span
                className='font-medium'
                title={item.Description || item.Name}
              >
                {baseName}
              </span>
            )
          case 'cartNumber':
            return (
              <span className='text-center font-mono text-sm font-medium'>
                {cartNumber || '-'}
              </span>
            )
          case 'ItemType':
            return (
              <span className='text-sm'>
                {item.ItemType?.Name || 'Unknown'}
              </span>
            )
          case 'StatusName':
            return <StatusBadge status={item.StatusName || 'Unknown'} />
          case 'StatusWarehouse':
            return (
              <span className='text-sm'>
                {item.StatusWarehouse?.Name || 'N/A'}
              </span>
            )
          case 'location':
            return <span className='text-sm'>{item.Location?.Name || '-'}</span>
          case 'tracker':
            // eslint-disable-next-line no-case-declarations
            const tracker = item.Trackers?.[0]
            if (!tracker)
              return <span className='text-muted-foreground'>-</span>
            return <BatteryIndicator level={tracker.Battery} />
          case 'Cycles':
            return <span className='text-sm'>{item.Cycles ?? '-'}</span>
          case 'LastUpdate':
            return (
              <span className='text-muted-foreground text-sm'>
                {formatDate(item.LastUpdate)}
              </span>
            )
          default:
            return <span className='text-sm'>-</span>
        }
      },
      [formatDate]
    )

    // View details handler
    const handleViewDetails = useCallback((item: NefabItem) => {
      setSelectedItem(item)
      setIsDetailsDialogOpen(true)
    }, [])

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
      if (currentPage > 1) setCurrentPage(currentPage - 1)
    }, [currentPage])

    const goToNextPage = useCallback(() => {
      if (currentPage < totalPages) setCurrentPage(currentPage + 1)
    }, [currentPage, totalPages])

    // Statistics cards
    const StatisticsCards = useMemo(() => {
      if (!statistics) return null

      // Count by status
      const atCustomer = statistics.byStatus['AtCustomer'] || 0

      // Count at OmniFrame/ILC (Rolls-Royce ILC warehouse)
      const atOmniFrameILC = statistics.byWarehouse['Rolls-Royce ILC'] || 0

      // Count Kit Cart types at OmniFrame/ILC
      const kitCartsAtILC = items.filter(
        (item) =>
          item.StatusWarehouse?.Name === 'Rolls-Royce ILC' &&
          item.ItemType?.Name?.startsWith('Kit Cart')
      ).length

      // Get top warehouses
      const topWarehouses = Object.entries(statistics.byWarehouse)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)

      return (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Total Items</CardTitle>
              <Package className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics.totalItems.toLocaleString()}
              </div>
              <p className='text-muted-foreground text-xs'>
                {Object.keys(statistics.byItemType).length} types
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Location Status
              </CardTitle>
              <MapPin className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-2'>
                <div className='text-center'>
                  <div className='text-xl font-bold text-green-600'>
                    {atOmniFrameILC}
                  </div>
                  <p className='text-muted-foreground text-xs'>OmniFrame/ILC</p>
                </div>
                <Separator orientation='vertical' className='h-10' />
                <div className='text-center'>
                  <div className='text-xl font-bold text-blue-600'>
                    {kitCartsAtILC}
                  </div>
                  <p className='text-muted-foreground text-xs'>Kit Carts</p>
                </div>
                <Separator orientation='vertical' className='h-10' />
                <div className='text-center'>
                  <div className='text-xl font-bold text-purple-600'>
                    {atCustomer}
                  </div>
                  <p className='text-muted-foreground text-xs'>Customer</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Top Warehouses
              </CardTitle>
              <Warehouse className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='space-y-1'>
                {topWarehouses.map(([name, count]) => (
                  <div key={name} className='flex justify-between text-sm'>
                    <span className='max-w-[150px] truncate' title={name}>
                      {name}
                    </span>
                    <span className='font-medium'>{count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Data Status</CardTitle>
              <Timer className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground text-sm'>Cache</span>
                  <Badge variant={cached ? 'secondary' : 'default'}>
                    {cached ? `${cacheAgeSeconds}s ago` : 'Fresh'}
                  </Badge>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground text-sm'>Polling</span>
                  {isPolling ? (
                    <span className='flex items-center gap-1 text-sm text-blue-500'>
                      <Loader2 className='h-3 w-3 animate-spin' /> Updating
                    </span>
                  ) : enablePolling ? (
                    <span className='flex items-center gap-1 text-sm text-green-500'>
                      ● Live
                    </span>
                  ) : (
                    <span className='text-muted-foreground text-sm'>
                      Disabled
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }, [statistics, cached, cacheAgeSeconds, isPolling, enablePolling, items])

    // Error state
    if (error) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='p-6'>
            <div className='text-destructive text-center'>
              <p>Failed to load kit cart data: {error}</p>
              <Button onClick={refreshData} className='mt-4'>
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
              {/* Header Row */}
              <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                <div className='flex flex-1 flex-col items-start gap-4 sm:flex-row sm:items-center'>
                  <h2 className='text-foreground flex items-center gap-2 text-2xl font-semibold'>
                    <Boxes className='h-6 w-6' />
                    Kit Cart Tracker
                  </h2>

                  {/* Search */}
                  <div className='relative max-w-sm flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
                    <Input
                      placeholder='Search carts, locations, status...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className='bg-background border-border pl-10'
                    />
                  </div>
                </div>

                <div className='flex items-center gap-2'>
                  {/* Item Type Filter */}
                  <Select
                    value={currentFilter?.toString() || 'all'}
                    onValueChange={(value) =>
                      setItemTypeFilter(
                        value === 'all' ? null : parseInt(value)
                      )
                    }
                  >
                    <SelectTrigger className='w-[200px]'>
                      <SelectValue placeholder='All Types' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>All Types</SelectItem>
                      <DropdownMenuSeparator />
                      {itemTypes.map((type) => (
                        <SelectItem key={type.Id} value={type.Id.toString()}>
                          {type.Name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Refresh Button */}
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={refreshData}
                    disabled={isLoading}
                    className='border-border hover:bg-accent'
                  >
                    {isLoading ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : (
                      <RefreshCw className='mr-2 h-4 w-4' />
                    )}
                    Refresh
                  </Button>

                  {/* More Options */}
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
                      <DropdownMenuItem onClick={() => setSearchQuery('')}>
                        <Filter className='mr-2 h-4 w-4' />
                        Clear Filters
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setItemTypeFilter(null)}>
                        Clear Type Filter
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {isLoading && items.length === 0 ? (
              <div className='flex items-center justify-center py-12'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <span className='ml-2'>Loading kit cart data...</span>
              </div>
            ) : (
              <div className='border-border overflow-hidden rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-muted/50 hover:bg-muted/50'>
                      {COLUMNS.map((column) => {
                        const isSorted = sortConfig.key === column.key
                        return (
                          <TableHead
                            key={column.id}
                            className={`text-foreground font-medium ${column.width}`}
                          >
                            <button
                              onClick={() => handleSort(column.key)}
                              className='hover:text-foreground/80 flex w-full items-center gap-1 transition-colors'
                            >
                              {column.label}
                              {isSorted && (
                                <ChevronDown
                                  className={`h-3 w-3 transition-transform ${
                                    sortConfig.direction === 'asc'
                                      ? 'rotate-180'
                                      : ''
                                  }`}
                                />
                              )}
                            </button>
                          </TableHead>
                        )
                      })}
                      <TableHead className='text-foreground w-20 font-medium'>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentPageData.length > 0 ? (
                      currentPageData.map((item) => (
                        <TableRow key={item.Id} className='hover:bg-muted/50'>
                          {COLUMNS.map((column) => (
                            <TableCell key={column.id} className={column.width}>
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
                          colSpan={COLUMNS.length + 1}
                          className='text-muted-foreground py-8 text-center'
                        >
                          {searchQuery || currentFilter
                            ? 'No items found matching your filters.'
                            : 'No kit cart data available.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination Footer */}
            {!isLoading && (
              <div className='mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                <div className='text-muted-foreground flex items-center gap-4 text-sm'>
                  <span>
                    Showing {startIndex + 1}-
                    {Math.min(endIndex, sortedItems.length)} of{' '}
                    {sortedItems.length} items
                    {totalCount !== sortedItems.length &&
                      ` (filtered from ${totalCount} total)`}
                  </span>
                  {enablePolling && isVisible && (
                    <span className='flex items-center gap-1 text-green-500'>
                      ● Live Updates
                    </span>
                  )}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className='flex items-center gap-1'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={goToPreviousPage}
                      disabled={currentPage === 1}
                      className='h-8 w-8 p-0'
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
                                currentPage === pageNum ? 'default' : 'outline'
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
                      className='h-8 w-8 p-0'
                    >
                      <ChevronRight className='h-4 w-4' />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Item Details Dialog */}
        <Dialog
          open={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
        >
          <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
            <DialogHeader>
              <DialogTitle className='text-2xl font-bold'>
                Kit Cart Details
              </DialogTitle>
              <DialogDescription>
                Detailed information for {selectedItem?.Name}
              </DialogDescription>
            </DialogHeader>

            {selectedItem && (
              <div className='space-y-6'>
                {/* Basic Info */}
                <div className='bg-muted/50 grid grid-cols-2 gap-4 rounded-lg p-4 md:grid-cols-3'>
                  <div>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Name
                    </p>
                    <p className='text-lg font-semibold'>{selectedItem.Name}</p>
                  </div>
                  <div>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Type
                    </p>
                    <p className='text-lg font-semibold'>
                      {selectedItem.ItemType?.Name || 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <p className='text-muted-foreground text-sm font-medium'>
                      Status
                    </p>
                    <div className='mt-1'>
                      <StatusBadge
                        status={selectedItem.StatusName || 'Unknown'}
                      />
                    </div>
                  </div>
                  {selectedItem.Description && (
                    <div className='col-span-full'>
                      <p className='text-muted-foreground text-sm font-medium'>
                        Description
                      </p>
                      <p className='text-base'>{selectedItem.Description}</p>
                    </div>
                  )}
                </div>

                {/* Location Info */}
                <Card>
                  <CardHeader className='pb-3'>
                    <CardTitle className='flex items-center gap-2 text-base font-semibold'>
                      <MapPin className='h-4 w-4' />
                      Location Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className='grid grid-cols-2 gap-4'>
                      <div>
                        <p className='text-muted-foreground text-sm'>
                          Warehouse
                        </p>
                        <p className='font-medium'>
                          {selectedItem.StatusWarehouse?.Name || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground text-sm'>
                          Zone/Location
                        </p>
                        <p className='font-medium'>
                          {selectedItem.Location?.Name || 'N/A'}
                        </p>
                      </div>
                      {selectedItem.Trackers?.[0] && (
                        <>
                          <div>
                            <p className='text-muted-foreground text-sm'>
                              Coordinates
                            </p>
                            <p className='font-mono text-sm font-medium'>
                              {selectedItem.Trackers[0].Lat?.toFixed(5)},{' '}
                              {selectedItem.Trackers[0].Lng?.toFixed(5)}
                            </p>
                          </div>
                          <div>
                            <p className='text-muted-foreground text-sm'>
                              Location Source
                            </p>
                            <p className='font-medium'>
                              {selectedItem.Trackers[0].LocationSourceName ||
                                'N/A'}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Tracker Info */}
                {selectedItem.Trackers && selectedItem.Trackers.length > 0 && (
                  <Card>
                    <CardHeader className='pb-3'>
                      <CardTitle className='flex items-center gap-2 text-base font-semibold'>
                        <Battery className='h-4 w-4' />
                        Tracker Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {selectedItem.Trackers.map((tracker) => (
                        <div
                          key={tracker.Id}
                          className='grid grid-cols-2 gap-4 md:grid-cols-4'
                        >
                          <div>
                            <p className='text-muted-foreground text-sm'>
                              Tracker ID
                            </p>
                            <p className='font-mono text-sm font-medium'>
                              {tracker.ExternalId || tracker.Id}
                            </p>
                          </div>
                          <div>
                            <p className='text-muted-foreground text-sm'>
                              Battery
                            </p>
                            <BatteryIndicator level={tracker.Battery} />
                          </div>
                          <div>
                            <p className='text-muted-foreground text-sm'>
                              Last Update
                            </p>
                            <p className='text-sm font-medium'>
                              {tracker.LastUpdate
                                ? format(
                                    new Date(tracker.LastUpdate),
                                    'MMM dd, yyyy h:mm a'
                                  )
                                : 'N/A'}
                            </p>
                          </div>
                          <div>
                            <p className='text-muted-foreground text-sm'>
                              Accuracy
                            </p>
                            <p className='font-medium'>
                              {tracker.Radius ? `±${tracker.Radius}m` : 'N/A'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Usage Stats */}
                <Card>
                  <CardHeader className='pb-3'>
                    <CardTitle className='text-base font-semibold'>
                      Usage Statistics
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
                      <div>
                        <p className='text-muted-foreground text-sm'>Cycles</p>
                        <p className='text-xl font-bold'>
                          {selectedItem.Cycles ?? 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground text-sm'>Trips</p>
                        <p className='text-xl font-bold'>
                          {selectedItem.Trips ?? 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground text-sm'>
                          Custom Field 1
                        </p>
                        <p className='font-medium'>
                          {selectedItem.FreeField1Name || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground text-sm'>
                          Custom Field 2
                        </p>
                        <p className='font-medium'>
                          {selectedItem.FreeField2Name || 'N/A'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Last Update */}
                <div className='text-muted-foreground text-right text-sm'>
                  Last updated:{' '}
                  {selectedItem.LastUpdate
                    ? format(
                        new Date(selectedItem.LastUpdate),
                        'MMM dd, yyyy h:mm:ss a'
                      )
                    : 'N/A'}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    )
  }
)

KitCartViewer.displayName = 'KitCartViewer'

export default KitCartViewer
// Developer and Creator: Jai Singh
