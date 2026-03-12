import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  Upload,
  Download,
  MoreHorizontal,
  Search,
  Filter,
  ChevronDown,
  Loader2,
  TrendingUp,
  Package,
  FileText,
  ChevronLeft,
  ChevronRight,
  X,
  Ruler,
} from 'lucide-react'
import { toast } from 'sonner'
import type { MaterialMasterData } from '@/lib/supabase/material-master-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useMaterialMasterData } from '@/hooks/use-material-master-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ImportConfirmDialog } from '@/components/ui/import-confirm-dialog'
import { Input } from '@/components/ui/input'
import { MaterialMasterImportProgressDialog } from '@/components/ui/material-master-import-progress-dialog'
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

interface MaterialMasterDataManagerProps {
  enableRealtime?: boolean
}

interface TableColumn {
  id: string
  label: string
  key: keyof MaterialMasterData
  width?: string
}

interface FilterConfig {
  [key: string]: string | string[]
}

// Column configuration for Material Master Data
const MATERIAL_MASTER_COLUMNS: TableColumn[] = [
  { id: 'material', label: 'Material', key: 'material', width: 'w-32' },
  {
    id: 'warehouse_number',
    label: 'Warehouse Number',
    key: 'warehouse_number',
    width: 'w-32',
  },
  {
    id: 'storage_type',
    label: 'Storage Type',
    key: 'storage_type',
    width: 'w-28',
  },
  {
    id: 'storage_bin',
    label: 'Storage Bin',
    key: 'storage_bin',
    width: 'w-28',
  },
  { id: 'length', label: 'Length', key: 'length', width: 'w-20' },
  { id: 'width', label: 'Width', key: 'width', width: 'w-20' },
  { id: 'height', label: 'Height', key: 'height', width: 'w-20' },
  { id: 'weight', label: 'Weight', key: 'weight', width: 'w-20' },
  { id: 'min_quantity', label: 'Min Qty', key: 'min_quantity', width: 'w-20' },
  { id: 'max_quantity', label: 'Max Qty', key: 'max_quantity', width: 'w-20' },
  { id: 'crl_status', label: 'CRL Status', key: 'crl_status', width: 'w-24' },
]

// Fixed header component with sorting
function FixedTableHeader({
  column,
  sortConfig,
  onSort,
}: {
  column: TableColumn
  sortConfig: { key: keyof MaterialMasterData; direction: 'asc' | 'desc' }
  onSort: (key: keyof MaterialMasterData) => void
}) {
  const isSorted = sortConfig.key === column.key
  const sortDirection = sortConfig.direction

  return (
    <TableHead className={`text-foreground font-medium ${column.width}`}>
      <div className='flex items-center gap-1'>
        <button
          onClick={() => onSort(column.key)}
          className='hover:text-foreground/80 flex items-center gap-1 transition-colors'
        >
          {column.label}
          {isSorted &&
            (sortDirection === 'asc' ? (
              <ChevronDown className='h-3 w-3 rotate-180' />
            ) : (
              <ChevronDown className='h-3 w-3' />
            ))}
        </button>
      </div>
    </TableHead>
  )
}

const MaterialMasterDataManager: React.FC<MaterialMasterDataManagerProps> =
  React.memo(({ enableRealtime = true }) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [isVisible, setIsVisible] = useState(false)
    const [filterConfig, setFilterConfig] = useState<FilterConfig>({})
    const [sortConfig, setSortConfig] = useState<{
      key: keyof MaterialMasterData
      direction: 'asc' | 'desc'
    }>({
      key: 'created_at',
      direction: 'desc',
    })
    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 50
    const [showImportConfirmDialog, setShowImportConfirmDialog] =
      useState(false)
    const [pendingImportRowCount, setPendingImportRowCount] = useState(0) // Increased for large datasets

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

    const {
      data,
      isLoading,
      error,
      statistics,
      importFromClipboard,
      refreshData,
      isImporting,
      importProgress,
      showProgressDialog,
      setShowProgressDialog,
      searchQuery,
      setSearchQuery,
      isUsingRust,
    } = useMaterialMasterData({
      enableRealtime: shouldEnableRealtime,
      searchQuery: '',
    })

    // Debug data flow
    logger.log(`🎯 COMPONENT: Received ${data.length} records from hook`)
    logger.log(
      '🔍 COMPONENT: First few record IDs:',
      data.slice(0, 3).map((r) => r.id)
    )

    // Use fixed columns
    const fixedColumns = useMemo(() => MATERIAL_MASTER_COLUMNS, [])

    // Filter and search handlers
    const handleClearFilters = useCallback(() => {
      setFilterConfig({})
      setCurrentPage(1)
    }, [])

    const handleSort = useCallback((key: keyof MaterialMasterData) => {
      setSortConfig((prevConfig) => ({
        key,
        direction:
          prevConfig?.key === key && prevConfig.direction === 'asc'
            ? 'desc'
            : 'asc',
      }))
    }, [])

    // Sort, filter, and search data
    const sortedAndFilteredData = useMemo(() => {
      let processedData = [...data]

      logger.log(
        `🔍 COMPONENT: Processing ${data.length} records with search: "${searchQuery}"`
      )

      // Apply column filters
      Object.entries(filterConfig).forEach(([key, value]) => {
        if (value) {
          if (Array.isArray(value)) {
            // Multi-select filtering: item must match any of the selected values
            if (value.length > 0) {
              processedData = processedData.filter(
                (item: Record<string, unknown>) => {
                  const itemValue = item[key]
                  return itemValue && value.includes(String(itemValue))
                }
              )
            }
          } else {
            // Single value filtering (text/number/select)
            if (typeof value === 'string' && value.trim()) {
              processedData = processedData.filter(
                (item: Record<string, unknown>) => {
                  const itemValue = item[key]
                  if (!itemValue) return false

                  // For number fields, do exact match
                  if (typeof itemValue === 'number') {
                    return String(itemValue) === value.trim()
                  }

                  // For text fields, do case-insensitive contains
                  return String(itemValue)
                    .toLowerCase()
                    .includes(value.toLowerCase())
                }
              )
            }
          }
        }
      })

      // Apply search query (searches across multiple key fields)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        processedData = processedData.filter((item: MaterialMasterData) => {
          const matchesSearch =
            item.material?.toLowerCase().includes(query) ||
            item.warehouse_number?.toLowerCase().includes(query) ||
            item.storage_type?.toLowerCase().includes(query) ||
            item.storage_bin?.toLowerCase().includes(query) ||
            item.crl_status?.toLowerCase().includes(query)

          return matchesSearch
        })
      }

      // Apply sorting
      if (sortConfig.key) {
        processedData.sort((a, b) => {
          const aValue = a[sortConfig.key]
          const bValue = b[sortConfig.key]

          let comparison = 0

          if (aValue === null || aValue === undefined) {
            comparison = bValue === null || bValue === undefined ? 0 : 1
          } else if (bValue === null || bValue === undefined) {
            comparison = -1
          } else if (typeof aValue === 'number' && typeof bValue === 'number') {
            comparison = aValue - bValue
          } else {
            const aStr = String(aValue).toLowerCase()
            const bStr = String(bValue).toLowerCase()
            comparison = aStr < bStr ? -1 : aStr > bStr ? 1 : 0
          }

          return sortConfig.direction === 'desc' ? -comparison : comparison
        })
      }

      logger.log(
        `📋 COMPONENT: After filtering and sorting: ${processedData.length} records`
      )
      return processedData
    }, [data, searchQuery, filterConfig, sortConfig])

    // Pagination calculations
    const totalRecords = sortedAndFilteredData.length
    const totalPages = Math.ceil(totalRecords / recordsPerPage)
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = startIndex + recordsPerPage
    const currentPageData = sortedAndFilteredData.slice(startIndex, endIndex)

    // Debug pagination
    logger.log(
      `📄 COMPONENT: Pagination - Total: ${totalRecords}, Pages: ${totalPages}, Current Page: ${currentPage}`
    )
    logger.log(
      `📄 COMPONENT: Showing records ${startIndex + 1}-${Math.min(endIndex, totalRecords)} of ${totalRecords}`
    )
    logger.log(
      `📄 COMPONENT: Current page data: ${currentPageData.length} records`
    )

    // Reset to first page when search or filters change
    React.useEffect(() => {
      setCurrentPage(1)
    }, [searchQuery, filterConfig])

    // Handle import from clipboard with large dataset support and upsert logic
    const handleImportData = useCallback(async () => {
      try {
        // Check clipboard size first
        const text = await navigator.clipboard.readText()
        const lines = text.trim().split('\n')
        const rowCount = lines.length - 1 // Exclude header row

        if (rowCount > 50000) {
          // Show custom confirmation dialog for very large datasets
          setPendingImportRowCount(rowCount)
          setShowImportConfirmDialog(true)
          return
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
        // Create CSV content with fixed column order
        const csvHeaders = fixedColumns.map((col) => col.label)
        const csvContent = [
          csvHeaders.join(','),
          ...sortedAndFilteredData.map((row: MaterialMasterData) =>
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
          `material-master-data-${new Date().toISOString().split('T')[0]}.csv`
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
    }, [sortedAndFilteredData, fixedColumns])

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
    const getCellContent = (item: MaterialMasterData, column: TableColumn) => {
      const value = item[column.key]

      switch (column.key) {
        case 'length':
        case 'width':
        case 'height':
        case 'weight':
        case 'min_quantity':
        case 'max_quantity':
          return typeof value === 'number'
            ? value.toLocaleString()
            : value || 'N/A'
        case 'crl_status':
          return value ? (
            <Badge
              variant={
                String(value).toLowerCase().includes('active')
                  ? 'default'
                  : 'secondary'
              }
            >
              {value}
            </Badge>
          ) : (
            'N/A'
          )
        default:
          return typeof value === 'string' || typeof value === 'number'
            ? value || 'N/A'
            : 'N/A'
      }
    }

    // Show error state
    if (error) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='p-6'>
            <div className='text-destructive text-center'>
              <p>Failed to load Material Master data: {error.message}</p>
              <Button onClick={() => refreshData()} className='mt-4'>
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
                Total Records
              </CardTitle>
              <FileText className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>{statistics?.total || 0}</div>
              <p className='text-muted-foreground text-xs'>
                {statistics?.todayCount || 0} added today
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
                Unique materials tracked
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Warehouses</CardTitle>
              <TrendingUp className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.uniqueWarehouses || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Different warehouses managed
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                With Dimensions
              </CardTitle>
              <Ruler className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.recordsWithDimensions || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Records with L/W/H data
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
                    Material Master Data
                  </h2>
                  <div className='relative max-w-sm flex-1'>
                    <Search
                      className={cn(
                        'absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 transform',
                        isUsingRust ? 'text-blue-500' : 'text-muted-foreground'
                      )}
                    />
                    <RustPoweredSearchInput
                      placeholder='Search materials, warehouses, bins...'
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

                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleExportData}
                    disabled={sortedAndFilteredData.length === 0}
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
                        onClick={() => refreshData()}
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
            </div>
          </CardHeader>

          <CardContent>
            {/* Active Filters Indicator */}
            {Object.keys(filterConfig).some((key) => {
              const value = filterConfig[key]
              return Array.isArray(value)
                ? value.length > 0
                : Boolean(value && (value as string).trim())
            }) && (
              <div className='mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950'>
                <div className='flex items-center justify-between'>
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
              </div>
            )}
            {isLoading ? (
              <div className='flex items-center justify-center py-12'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <span className='ml-2'>
                  Loading Material Master data... (This may take a moment for
                  large datasets)
                </span>
              </div>
            ) : (
              <div className='border-border overflow-hidden rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-muted/50 hover:bg-muted/50'>
                      {fixedColumns.map((column) => (
                        <FixedTableHeader
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
                          {fixedColumns.map((column) => (
                            <TableCell
                              key={column.id}
                              className={`${column.width} ${
                                column.key === 'material'
                                  ? 'text-foreground font-medium'
                                  : column.key === 'warehouse_number'
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
                          colSpan={fixedColumns.length}
                          className='text-muted-foreground py-12 text-center'
                        >
                          {data.length === 0
                            ? 'No Material Master data available. Use Import Data to upload your dataset.'
                            : 'No records found matching your search or filters.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Enhanced Pagination for Large Datasets */}
            {totalPages > 1 && (
              <div className='flex flex-col items-center justify-between gap-4 pt-4 sm:flex-row'>
                <div className='text-muted-foreground text-sm'>
                  Showing {startIndex + 1}-{Math.min(endIndex, totalRecords)} of{' '}
                  <span className='font-semibold'>
                    {totalRecords.toLocaleString()}
                  </span>{' '}
                  records
                  {totalRecords !== data.length &&
                    ` (filtered from ${data.length.toLocaleString()} total)`}
                  {totalRecords > 100000 && (
                    <span className='ml-2 text-blue-600'>📊 Large Dataset</span>
                  )}
                </div>

                <div className='flex items-center space-x-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={goToPreviousPage}
                    disabled={currentPage <= 1}
                    className='border-border'
                  >
                    <ChevronLeft className='h-4 w-4' />
                    Previous
                  </Button>

                  <div className='flex items-center space-x-1'>
                    {/* Show first page */}
                    {currentPage > 3 && (
                      <>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => goToPage(1)}
                          className='border-border'
                        >
                          1
                        </Button>
                        {currentPage > 4 && (
                          <span className='text-muted-foreground'>...</span>
                        )}
                      </>
                    )}

                    {/* Show current page range */}
                    {Array.from({ length: Math.min(3, totalPages) }, (_, i) => {
                      const pageNum =
                        Math.max(1, Math.min(currentPage - 1, totalPages - 2)) +
                        i
                      if (pageNum > totalPages || pageNum < 1) return null

                      return (
                        <Button
                          key={pageNum}
                          variant={
                            pageNum === currentPage ? 'default' : 'outline'
                          }
                          size='sm'
                          onClick={() => goToPage(pageNum)}
                          className={
                            pageNum === currentPage ? '' : 'border-border'
                          }
                        >
                          {pageNum.toLocaleString()}
                        </Button>
                      )
                    })}

                    {/* Show last page */}
                    {currentPage < totalPages - 2 && (
                      <>
                        {currentPage < totalPages - 3 && (
                          <span className='text-muted-foreground'>...</span>
                        )}
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => goToPage(totalPages)}
                          className='border-border'
                        >
                          {totalPages.toLocaleString()}
                        </Button>
                      </>
                    )}
                  </div>

                  <Button
                    variant='outline'
                    size='sm'
                    onClick={goToNextPage}
                    disabled={currentPage >= totalPages}
                    className='border-border'
                  >
                    Next
                    <ChevronRight className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Import Confirmation Dialog */}
        <ImportConfirmDialog
          isOpen={showImportConfirmDialog}
          rowCount={pendingImportRowCount}
          operation='upsert'
          datasetName='material master data'
          onConfirm={handleConfirmImport}
          onCancel={handleCancelImport}
          isProcessing={isImporting}
        />

        {/* Import Progress Dialog */}
        <MaterialMasterImportProgressDialog
          isOpen={showProgressDialog}
          progress={importProgress}
          onClose={() => setShowProgressDialog(false)}
        />
      </div>
    )
  })

MaterialMasterDataManager.displayName = 'MaterialMasterDataManager'

export default MaterialMasterDataManager
