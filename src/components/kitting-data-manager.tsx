// Created and developed by Jai Singh
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
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  detectNonWarehouseBins,
  type NonWarehouseBinDetection,
} from '@/lib/kitting/non-warehouse-bins'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { logger } from '@/lib/utils/logger'
import { useKitUnreadNotes } from '@/hooks/use-kit-unread-notes'
import { useNonWarehouseBinPatterns } from '@/hooks/use-kitting-workflow-settings'
import {
  AddExpediteDialog,
  type ExpediteFormData,
} from '@/components/ui/add-expedite-dialog'
import {
  AddKitBuildPlanDialog,
  type KitBuildPlanFormData,
  type TransferOrderRecord,
} from '@/components/ui/add-kit-build-plan-dialog'
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
  KittingDataGrid,
  type KittingGridRow,
} from '@/components/ui/kitting-data-grid'
import { KpiGrid } from '@/components/ui/kpi-grid'
import { Separator } from '@/components/ui/separator'
import { StatTile } from '@/components/ui/stat-tile'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KitProductionTrackerDialog } from '@/components/kitting/kit-production-tracker'
import { NonWarehouseBinConfirmDialog } from '@/components/kitting/non-warehouse-bin-confirm-dialog'

interface KittingDataManagerProps {
  enableRealtime?: boolean
}

// Stand-alone single-part expedites are stamped engine_program = 'EXPEDITE'
// (see RRKittingDataService.addExpediteToKit mode 2). They get their own tab
// so they don't mix into the kit queues.
const isExpediteRow = (row: KittingGridRow) =>
  row.engine_program?.toUpperCase() === 'EXPEDITE'
// "Completed" must match what the Status column shows: the DERIVED stage
// (kit_stage_status), which treats on-dock as done — the canonical "on dock =
// done" invariant. Keying off the raw kit_build_status alone misses kits that
// reached the dock but whose stored status was never flipped to 'completed'
// (e.g. legacy rows left at 'printed'), so they'd show "Completed" yet stay in
// Open Work. Fall back to the raw status when no derived stage is present.
const isCompletedRow = (row: KittingGridRow) =>
  (row.kit_stage_status ?? row.kit_build_status)?.toLowerCase() === 'completed'

const KittingDataManager: React.FC<KittingDataManagerProps> = React.memo(
  ({ enableRealtime = true }) => {
    const [isVisible, setIsVisible] = useState(false)
    const [selectedKitSerialNumber, setSelectedKitSerialNumber] = useState<
      string | null
    >(null) // PRIMARY KEY for unique kit identification
    const [selectedKitPoNumber, setSelectedKitPoNumber] = useState<
      string | null
    >(null)
    // Position-based priority (#n) of the clicked row, forwarded to the audit
    // trail so its header matches the grid instead of the raw kit_priority.
    const [selectedDisplayPriority, setSelectedDisplayPriority] = useState<
      number | null
    >(null)
    const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
    const [localSearchQuery, setLocalSearchQuery] = useState('')
    // Which queue is shown:
    //   'open'      — active kit build plans (not completed, not expedites)
    //   'completed' — kits that have reached the dock (kit_build_status = 'completed')
    //   'expedites' — stand-alone single-part expedites (engine_program = 'EXPEDITE')
    // Splitting them keeps each queue uncluttered. See [[Kit-Build-Plan-Completed-Tab]].
    const [activeKitTab, setActiveKitTab] = useState<
      'open' | 'completed' | 'expedites'
    >('open')
    const [isLoading, setIsLoading] = useState(true)
    const [isAddPlanDialogOpen, setIsAddPlanDialogOpen] = useState(false)
    const [isAddExpediteDialogOpen, setIsAddExpediteDialogOpen] =
      useState(false)
    const [gridData, setGridData] = useState<KittingGridRow[]>([])
    const [statistics, setStatistics] = useState({
      totalRecords: 0,
      pendingCount: 0,
      inProgressCount: 0,
      completedCount: 0,
      completedTodayCount: 0,
      completedYesterdayCount: 0,
      completedThisWeekCount: 0,
    })
    const componentRef = useRef<HTMLDivElement>(null)

    // Configured non-warehouse bin patterns (org-level, default {NEEDBIN}).
    // Used by `handleAppendTOs` below to gate the append behind an ack
    // dialog when any clipboard-imported row references an external
    // plant bin. See migration 314 + [[Non-Warehouse-Bin-Acknowledgment]].
    const nonWarehouseBinPatterns = useNonWarehouseBinPatterns()

    // Per-user unread Kit Notes — drives the "New message" indicator column.
    // Mark-read happens when the audit trail opens (in KitProductionTracker).
    const { unreadSerials } = useKitUnreadNotes()

    // Pending-append state — when set, the confirm dialog is open and
    // the operator must tick the ack before the actual append runs.
    const [pendingAppend, setPendingAppend] = useState<{
      targetSerial: string
      targetLabel: string
      records: TransferOrderRecord[]
      detection: NonWarehouseBinDetection<TransferOrderRecord>
    } | null>(null)
    const [appendSubmitting, setAppendSubmitting] = useState(false)

    // Row click handler for viewing kit audit trail dialog
    const handleRowClick = useCallback(
      (row: KittingGridRow, displayPriority: number) => {
        setSelectedKitSerialNumber(row.kit_serial_number) // Use kit_serial_number as unique identifier
        setSelectedKitPoNumber(row.kit_po_number) // Keep PO for display purposes
        setSelectedDisplayPriority(displayPriority) // Match the grid's #n in the dialog
        setIsDetailsDialogOpen(true)
      },
      []
    )

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
          item.kit_stage_status?.toLowerCase().includes(searchLower) ||
          item.kit_flag_type?.toLowerCase().includes(searchLower) ||
          // Search through multiple active flags
          item.active_flags?.some((flag) =>
            flag.flagType.toLowerCase().includes(searchLower)
          )
      )
    }, [gridData, localSearchQuery])

    // Three queues, kept in separate tabs so each stays uncluttered:
    //   - Expedites: stand-alone single-part expedites (engine_program =
    //     'EXPEDITE', created by the Add Expedite flow without a matching kit).
    //   - Completed Kits: kits at the dock (kit_build_status = 'completed').
    //   - Open Work Kits: everything else (active build plans).
    // Expedites are excluded from both kit tabs regardless of status.
    const expediteData = useMemo(
      () => filteredData.filter((row) => isExpediteRow(row)),
      [filteredData]
    )
    const openWorkData = useMemo(
      () =>
        filteredData.filter(
          (row) => !isExpediteRow(row) && !isCompletedRow(row)
        ),
      [filteredData]
    )
    const completedData = useMemo(
      () =>
        filteredData.filter(
          (row) => !isExpediteRow(row) && isCompletedRow(row)
        ),
      [filteredData]
    )

    // Handler for priority changes when rows are reordered.
    // `reorderedRows` is the OPEN-WORK subset only (completed kits and
    // expedites live in separate read-only tabs and can't be reordered), so we
    // merge the reordered rows back with every other row by id — this keeps
    // the completed kits AND the expedites in local state instead of dropping
    // them before the next fetch.
    const handlePriorityChange = useCallback(
      async (reorderedRows: KittingGridRow[]) => {
        // Update local grid data optimistically for smooth UI
        const reorderedWithPriority = reorderedRows.map((row, index) => ({
          ...row,
          kit_priority: index + 1,
        }))
        setGridData((prev) => {
          const reorderedIds = new Set(reorderedRows.map((row) => row.id))
          const untouchedRows = prev.filter((row) => !reorderedIds.has(row.id))
          return [...reorderedWithPriority, ...untouchedRows]
        })

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
          kitCartColor: formData.kitCartColor,
          kitContainerType: formData.kitContainerType,
          chargeCode: formData.chargeCode,
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

    // Handler for Add Expedite Part dialog submission. Each imported TO row
    // becomes one stand-alone expedite part (Expedites tab).
    const handleAddExpedite = useCallback(
      async (formData: ExpediteFormData) => {
        const result = await RRKittingDataService.addExpeditePartsFromTOs(
          formData.importedTOs.map((to) => ({
            material: to.material,
            materialDescription: to.materialDescription,
            sourceTargetQty: to.sourceTargetQty,
            transferOrderNumber: to.transferOrderNumber,
          })),
          {
            deliveryTime: formData.deliveryTime,
            reasonCode: formData.reasonCode || undefined,
            requestedByDate: formData.requestedByDate,
          }
        )

        if (result.success) {
          toast.success(
            `Added ${result.created} expedite part${result.created === 1 ? '' : 's'}`,
            {
              description:
                result.failed > 0
                  ? `${result.failed} row${result.failed === 1 ? ' was' : 's were'} skipped (missing part number).`
                  : 'Each imported TO row was added to the Expedites tab.',
            }
          )
          setIsAddExpediteDialogOpen(false)
          fetchData()
        } else {
          toast.error('Failed to add expedite parts', {
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
          row.kit_stage_status || row.kit_build_status || '',
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

    /**
     * Run the actual append once detection / acknowledgement (if any)
     * is resolved. Split out from `handleAppendTOs` so the confirm
     * dialog's `onConfirm` can reuse the same code path without
     * re-parsing the clipboard.
     */
    const runAppendTOs = useCallback(
      async (
        targetSerial: string,
        records: TransferOrderRecord[]
      ): Promise<boolean> => {
        try {
          const result = await RRKittingDataService.appendTOsToKit(
            targetSerial,
            records
          )
          if (result.success) {
            if (result.insertedCount === 0) {
              toast.info('All TOs already exist for this kit')
            } else {
              toast.success(
                `Appended ${result.insertedCount} TO(s) to ${targetSerial}`,
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
            return true
          }
          toast.error('Failed to append TOs', {
            description: result.error,
          })
          return false
        } catch (err) {
          logger.error('[KittingDataManager] runAppendTOs error:', err)
          toast.error('Failed to append TOs')
          return false
        }
      },
      [fetchData]
    )

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

          // appendTOsToKit is now serial-scoped. If the operator selected
          // a kit row first (handleRowClick), prefer that serial. Otherwise
          // resolve the typed PO to a single kit serial — bail out with a
          // user-readable message when the PO maps to multiple kits so we
          // never silently attach TOs to the wrong kit.
          let targetSerial = selectedKitSerialNumber || ''
          if (!targetSerial) {
            const candidates =
              await RRKittingDataService.findKitSerialsByPoNumber(kitPoNumber)
            if (candidates.length === 0) {
              toast.error(`Kit PO ${kitPoNumber} not found`)
              return
            }
            if (candidates.length === 1) {
              targetSerial = candidates[0].kitSerialNumber
            } else {
              const promptMessage = candidates
                .map(
                  (c, i) =>
                    `${i + 1}. ${c.kitSerialNumber} — ${c.kitNumber || '(no kit number)'}`
                )
                .join('\n')
              const choice = window.prompt(
                `Kit PO ${kitPoNumber} has multiple kits. Type the kit serial number to append TOs to:\n\n${promptMessage}`
              )
              const chosen = candidates.find(
                (c) => c.kitSerialNumber === choice?.trim()
              )
              if (!chosen) {
                toast.warning('Append cancelled — no matching kit serial.')
                return
              }
              targetSerial = chosen.kitSerialNumber
            }
          }

          // External-plant-bin detection — if any of the clipboard-imported
          // TO rows reference a configured non-warehouse pattern, stash
          // the resolved targetSerial + records and open the confirm
          // dialog. The dialog's onConfirm dispatches `runAppendTOs`.
          const detection = detectNonWarehouseBins(
            records,
            nonWarehouseBinPatterns
          )
          if (detection.hasMatches) {
            setPendingAppend({
              targetSerial,
              targetLabel: `Append to ${targetSerial}`,
              records,
              detection,
            })
            return
          }

          await runAppendTOs(targetSerial, records)
        } catch (err) {
          logger.error('[KittingDataManager] appendTOs error:', err)
          toast.error('Failed to read clipboard')
        }
      },
      [nonWarehouseBinPatterns, runAppendTOs, selectedKitSerialNumber]
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

          {/* Completed — outbound-data-manager-style card: EST date-scoped
              Today / Yesterday / Last-7-days tiles (KpiGrid + StatTile),
              with the all-time total kept in the header. */}
          <Card className='group border-border/50 bg-card/50 relative overflow-hidden backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20'>
            <div className='absolute inset-0 bg-linear-to-br from-emerald-500/5 to-emerald-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
            <CardHeader className='relative flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
                <div className='flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 dark:bg-emerald-500/10'>
                  <CheckCircle2 className='h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400' />
                </div>
                Completed
              </CardTitle>
              <span
                className='text-muted-foreground/60 text-[10px] font-medium tracking-wider uppercase'
                title='Kits completed all-time'
              >
                {statistics.completedCount.toLocaleString()} all-time
              </span>
            </CardHeader>
            <CardContent className='relative pt-1 pb-4'>
              <KpiGrid columns={3} density='compact'>
                <StatTile
                  label='Today'
                  value={statistics.completedTodayCount}
                  accent='emerald'
                  valueTitle='Kits completed today'
                />
                <StatTile
                  label='Yesterday'
                  value={statistics.completedYesterdayCount}
                  accent='default'
                  valueTitle='Kits completed yesterday'
                />
                <StatTile
                  label='This Week'
                  value={statistics.completedThisWeekCount}
                  accent='sky'
                  valueTitle='Kits completed in the last 7 days'
                />
              </KpiGrid>
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

                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setIsAddExpediteDialogOpen(true)}
                      className='border-border hover:bg-accent'
                    >
                      <Zap className='mr-2 h-4 w-4' />
                      Add Expedite Part
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
              <Tabs
                value={activeKitTab}
                onValueChange={(value) =>
                  setActiveKitTab(value as 'open' | 'completed' | 'expedites')
                }
              >
                <TabsList className='mb-4'>
                  <TabsTrigger value='open'>
                    Open Work Kits
                    <Badge variant='secondary' className='ml-2'>
                      {openWorkData.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value='completed'>
                    Completed Kits
                    <Badge variant='secondary' className='ml-2'>
                      {completedData.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value='expedites'>
                    Expedites
                    <Badge variant='secondary' className='ml-2'>
                      {expediteData.length}
                    </Badge>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value='open'>
                  <KittingDataGrid
                    data={openWorkData}
                    isLoading={isLoading}
                    unreadKitSerials={unreadSerials}
                    onRowClick={handleRowClick}
                    onPriorityChange={handlePriorityChange}
                    emptyMessage='No open kit build plans. Click "Add to Kit Build Plan" to create one.'
                  />
                </TabsContent>

                <TabsContent value='completed'>
                  <KittingDataGrid
                    data={completedData}
                    isLoading={isLoading}
                    unreadKitSerials={unreadSerials}
                    onRowClick={handleRowClick}
                    reorderable={false}
                    emptyMessage='No completed kits yet. Kits move here once they reach the dock.'
                  />
                </TabsContent>

                <TabsContent value='expedites'>
                  <KittingDataGrid
                    data={expediteData}
                    isLoading={isLoading}
                    unreadKitSerials={unreadSerials}
                    onRowClick={handleRowClick}
                    reorderable={false}
                    emptyMessage='No expedite parts yet. Click "Add Expedite Part" to import Transfer Orders as expedites.'
                  />
                </TabsContent>
              </Tabs>

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

        {/* Add Expedite Part Dialog */}
        <AddExpediteDialog
          isOpen={isAddExpediteDialogOpen}
          onOpenChange={setIsAddExpediteDialogOpen}
          onSubmit={handleAddExpedite}
        />

        {/* Kit Build Audit Trail Dialog */}
        <KitProductionTrackerDialog
          open={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
          kitSerialNumber={selectedKitSerialNumber}
          kitPoNumber={selectedKitPoNumber}
          displayPriority={selectedDisplayPriority}
          onKitDeleted={fetchData}
        />

        {/* External-plant-bin acknowledgement dialog — opens when the
            clipboard-imported TO rows include a non-warehouse bin. */}
        <NonWarehouseBinConfirmDialog
          isOpen={!!pendingAppend}
          onOpenChange={(open) => {
            if (!open) setPendingAppend(null)
          }}
          detection={
            pendingAppend?.detection ?? {
              matches: [],
              patternsTriggered: [],
              binsTriggered: [],
              hasMatches: false,
            }
          }
          contextLabel={pendingAppend?.targetLabel}
          isSubmitting={appendSubmitting}
          onCancel={() => {
            toast.warning('Append cancelled — acknowledgement required.')
            setPendingAppend(null)
          }}
          onConfirm={async () => {
            if (!pendingAppend) return
            setAppendSubmitting(true)
            try {
              await runAppendTOs(
                pendingAppend.targetSerial,
                pendingAppend.records
              )
            } finally {
              setAppendSubmitting(false)
              setPendingAppend(null)
            }
          }}
        />
      </div>
    )
  }
)

KittingDataManager.displayName = 'KittingDataManager'

export default KittingDataManager

// Created and developed by Jai Singh
