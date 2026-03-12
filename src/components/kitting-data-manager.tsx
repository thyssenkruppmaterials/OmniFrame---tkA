import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ClipboardPlus,
  Download,
  FileText,
  MoreHorizontal,
  Package,
  RefreshCw,
  Scan,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { logger } from '@/lib/utils/logger'
import {
  AddKitBuildPlanDialog,
  type KitBuildPlanFormData,
  type TransferOrderRecord,
} from '@/components/ui/add-kit-build-plan-dialog'
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
  KittingDataGrid,
  type KittingGridRow,
} from '@/components/ui/kitting-data-grid'
import { Separator } from '@/components/ui/separator'
import { KitProductionTrackerDialog } from '@/components/kitting/kit-production-tracker'

interface KittingDataManagerProps {
  enableRealtime?: boolean
}

const KittingDataManager: React.FC<KittingDataManagerProps> = React.memo(
  ({ enableRealtime = true }) => {
    const [isVisible, setIsVisible] = useState(false)
    const [selectedKitSerialNumber, setSelectedKitSerialNumber] = useState<
      string | null
    >(null) // PRIMARY KEY for unique kit identification
    const [selectedKitPoNumber, setSelectedKitPoNumber] = useState<
      string | null
    >(null)
    const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
    const [localSearchQuery, setLocalSearchQuery] = useState('')
    const [isLoading, setIsLoading] = useState(true)
    const [isAddPlanDialogOpen, setIsAddPlanDialogOpen] = useState(false)
    const [gridData, setGridData] = useState<KittingGridRow[]>([])
    const [statistics, setStatistics] = useState({
      totalRecords: 0,
      pendingCount: 0,
      inProgressCount: 0,
      completedCount: 0,
    })
    const componentRef = useRef<HTMLDivElement>(null)

    // Row click handler for viewing kit audit trail dialog
    const handleRowClick = useCallback((row: KittingGridRow) => {
      setSelectedKitSerialNumber(row.kit_serial_number) // Use kit_serial_number as unique identifier
      setSelectedKitPoNumber(row.kit_po_number) // Keep PO for display purposes
      setIsDetailsDialogOpen(true)
    }, [])

    // Fetch data from database
    const fetchData = useCallback(async () => {
      setIsLoading(true)
      try {
        const [data, stats] = await Promise.all([
          RRKittingDataService.getKitGridData(),
          RRKittingDataService.getStatistics(),
        ])
        setGridData(data)
        setStatistics(stats)
      } catch (error) {
        logger.error('Error fetching kitting data:', error)
        toast.error('Failed to load kitting data')
      }
      setIsLoading(false)
    }, [])

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

    // Initial data fetch
    useEffect(() => {
      fetchData()
    }, [fetchData])

    // Real-time subscription
    useEffect(() => {
      if (!enableRealtime || !isVisible) return

      const subscription = RRKittingDataService.subscribeToChanges(() => {
        fetchData()
      })

      return () => {
        subscription.unsubscribe()
      }
    }, [enableRealtime, isVisible, fetchData])

    // Filter data based on search query
    const filteredData = useMemo(() => {
      if (!localSearchQuery.trim()) return gridData

      const searchLower = localSearchQuery.toLowerCase()
      return gridData.filter(
        (item) =>
          item.kit_serial_number?.toLowerCase().includes(searchLower) || // Search by Kit Serial Number
          item.kit_po_number.toLowerCase().includes(searchLower) ||
          item.kit_number?.toLowerCase().includes(searchLower) ||
          String(item.kit_priority).includes(searchLower) ||
          item.kit_build_status?.toLowerCase().includes(searchLower) ||
          item.kit_flag_type?.toLowerCase().includes(searchLower) ||
          // Search through multiple active flags
          item.active_flags?.some((flag) =>
            flag.flagType.toLowerCase().includes(searchLower)
          )
      )
    }, [gridData, localSearchQuery])

    // Handler for priority changes when rows are reordered
    const handlePriorityChange = useCallback(
      async (reorderedRows: KittingGridRow[]) => {
        // Update local grid data optimistically for smooth UI
        setGridData(
          reorderedRows.map((row, index) => ({
            ...row,
            kit_priority: index + 1,
          }))
        )

        const result =
          await RRKittingDataService.updatePrioritiesSimple(reorderedRows)

        if (result.success) {
          toast.success('Priority order updated', {
            description: 'Kit build plan priorities have been saved.',
          })
          // Don't refetch immediately - let the optimistic update stay
          // The next realtime update or manual refresh will sync
        } else {
          toast.error('Failed to update priorities', {
            description: result.error || 'An unexpected error occurred.',
          })
          // Only revert on error by refetching original data
          fetchData()
        }
      },
      [fetchData]
    )

    // Handler for Add to Kit Build Plan dialog submission
    const handleAddToKitBuildPlan = useCallback(
      async (formData: KitBuildPlanFormData) => {
        const result = await RRKittingDataService.createKitBuildPlan({
          kitBuildNumber: formData.kitBuildNumber,
          kitPoNumber: formData.kitPoNumber,
          engineProgram: formData.engineProgram,
          kitNumber: formData.kitNumber,
          deliverToPlant: formData.deliverToPlant,
          dueDate: formData.dueDate,
          importedTOs: formData.importedTOs,
          incoraItems: formData.incoraItems,
          authorizedShipShortItems: formData.authorizedShipShortItems,
          kitDefinitionId: formData.kitDefinitionId,
          bomCoverage: formData.bomCoverage,
        })

        if (result.success) {
          toast.success('Kit build plan added successfully', {
            description: `Kit Build #${formData.kitBuildNumber} saved with ${result.recordCount} record${result.recordCount === 1 ? '' : 's'}.`,
          })

          // Show warning if kanban card creation failed
          if (result.kanbanError) {
            toast.warning('Kanban card not created', {
              description: result.kanbanError,
              duration: 8000, // Show longer so user notices
            })
          }

          setIsAddPlanDialogOpen(false)
          fetchData() // Refresh data
        } else {
          toast.error('Failed to save kit build plan', {
            description: result.error || 'An unexpected error occurred.',
          })
        }
      },
      [fetchData]
    )

    const handleExportData = useCallback(() => {
      // Export to CSV
      if (filteredData.length === 0) {
        toast.error('No data to export')
        return
      }

      const headers = [
        'Kit Serial #',
        'Kit PO Number',
        'Kit Number',
        'Priority',
        'Due Date',
        'Added By',
        'Added Date/Time',
        'Status',
        'Flags',
      ]
      const rows = filteredData.map((row) => {
        // Get flags from active_flags array, fall back to legacy single flag
        const flagList =
          row.active_flags?.length > 0
            ? row.active_flags.map((f) => f.flagType).join('; ')
            : row.kit_flag_type || ''

        return [
          row.kit_serial_number || '', // Kit Serial Number (unique identifier)
          row.kit_po_number,
          row.kit_number || '',
          row.kit_priority || '',
          row.due_date || '',
          row.kit_added_by_user || '',
          row.kit_added_create_date_time || '',
          row.kit_build_status || '',
          flagList,
        ]
      })

      const csvContent = [headers, ...rows]
        .map((row) => row.join(','))
        .join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kitting-data-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)

      toast.success('Data exported successfully')
    }, [filteredData])

    const handleRefreshData = useCallback(() => {
      fetchData()
      toast.success('Data refreshed')
    }, [fetchData])

    const handleAppendTOs = useCallback(
      async (kitPoNumber: string) => {
        try {
          const text = await navigator.clipboard.readText()
          if (!text.trim()) {
            toast.error('Clipboard is empty', {
              description: 'Copy TO rows from Excel first.',
            })
            return
          }

          const { parseClipboardData } =
            await import('@/components/ui/add-kit-build-plan-dialog')
          const records: TransferOrderRecord[] = parseClipboardData(text)
          if (records.length === 0) {
            toast.error('No valid TOs found on clipboard')
            return
          }

          const result = await RRKittingDataService.appendTOsToKit(
            kitPoNumber,
            records
          )
          if (result.success) {
            if (result.insertedCount === 0) {
              toast.info('All TOs already exist for this kit')
            } else {
              toast.success(
                `Appended ${result.insertedCount} TO(s) to ${kitPoNumber}`,
                {
                  description:
                    result.bomCoverageComplete === true
                      ? 'BOM coverage is now complete — Black Hat cleared.'
                      : result.bomCoverageComplete === false
                        ? 'BOM coverage still incomplete — Black Hat remains.'
                        : undefined,
                }
              )
            }
            fetchData()
          } else {
            toast.error('Failed to append TOs', {
              description: result.error,
            })
          }
        } catch (err) {
          logger.error('[KittingDataManager] appendTOs error:', err)
          toast.error('Failed to read clipboard')
        }
      },
      [fetchData]
    )

    // Memoized statistics cards
    const StatisticsCards = useMemo(
      () => (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Kit Status</CardTitle>
              <FileText className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-around space-x-4'>
                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {statistics.pendingCount}
                  </div>
                  <p className='text-muted-foreground text-xs'>Pending</p>
                </div>

                <Separator orientation='vertical' className='bg-border h-14' />

                <div className='text-center'>
                  <div className='text-2xl font-bold'>
                    {statistics.inProgressCount}
                  </div>
                  <p className='text-muted-foreground text-xs'>In Progress</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Total Records
              </CardTitle>
              <Scan className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics.totalRecords}
              </div>
              <p className='text-muted-foreground text-xs'>Total kit records</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Kit PO Numbers
              </CardTitle>
              <Package className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>{gridData.length}</div>
              <p className='text-muted-foreground text-xs'>
                Unique kit build plans
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Completed</CardTitle>
              <CheckCircle2 className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics.completedCount}
              </div>
              <p className='text-muted-foreground text-xs'>Kits completed</p>
            </CardContent>
          </Card>
        </div>
      ),
      [statistics, gridData.length]
    )

    return (
      <div ref={componentRef} className='space-y-6'>
        {/* Statistics Cards */}
        {StatisticsCards}

        {/* Main Content */}
        <div>
          {/* Data Table */}
          <Card className='bg-background border-border'>
            <CardHeader className='pb-4'>
              <div className='flex flex-col space-y-4'>
                {/* Main Header */}
                <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                  <div className='flex flex-1 flex-col items-start gap-4 sm:flex-row sm:items-center'>
                    <h2 className='text-foreground text-2xl font-semibold'>
                      Kit Build Plans
                    </h2>
                    <div className='relative max-w-sm flex-1'>
                      <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
                      <Input
                        placeholder='Search by PO number, kit number, status...'
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
                      onClick={() => setIsAddPlanDialogOpen(true)}
                      className='border-border hover:bg-accent'
                    >
                      <ClipboardPlus className='mr-2 h-4 w-4' />
                      Add to Kit Build Plan
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
                          onClick={handleExportData}
                          disabled={filteredData.length === 0}
                          className='hover:bg-accent'
                        >
                          <Download className='mr-2 h-4 w-4' />
                          Export CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={handleRefreshData}
                          className='hover:bg-accent'
                        >
                          <RefreshCw className='mr-2 h-4 w-4' />
                          Refresh Data
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setLocalSearchQuery('')}
                          className='hover:bg-accent'
                        >
                          Clear Search
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={async () => {
                            const kitPo = window.prompt(
                              'Enter Kit PO Number to append TOs to:'
                            )
                            if (kitPo?.trim()) {
                              await handleAppendTOs(kitPo.trim())
                            }
                          }}
                          className='hover:bg-accent'
                        >
                          <ClipboardPlus className='mr-2 h-4 w-4' />
                          Append TOs to Kit
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <KittingDataGrid
                data={filteredData}
                isLoading={isLoading}
                onRowClick={handleRowClick}
                onPriorityChange={handlePriorityChange}
              />

              {!isLoading &&
                filteredData.length > 0 &&
                enableRealtime &&
                isVisible && (
                  <div className='text-muted-foreground mt-4 flex items-center gap-2 text-sm'>
                    <span className='flex items-center gap-1 text-green-500'>
                      ● Live Updates Enabled
                    </span>
                  </div>
                )}
            </CardContent>
          </Card>
        </div>

        {/* Add to Kit Build Plan Dialog */}
        <AddKitBuildPlanDialog
          isOpen={isAddPlanDialogOpen}
          onOpenChange={setIsAddPlanDialogOpen}
          onSubmit={handleAddToKitBuildPlan}
        />

        {/* Kit Build Audit Trail Dialog */}
        <KitProductionTrackerDialog
          open={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
          kitSerialNumber={selectedKitSerialNumber}
          kitPoNumber={selectedKitPoNumber}
        />
      </div>
    )
  }
)

KittingDataManager.displayName = 'KittingDataManager'

export default KittingDataManager
