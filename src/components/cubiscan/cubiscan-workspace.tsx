// Created and developed by Jai Singh
/**
 * CubiScan Workspace
 * Enterprise operations console: live-ops strip, compact metrics,
 * dense queue/history table with right-side inspector.
 */
import { useState, useCallback } from 'react'
import { RefreshCw, Wifi, WifiOff } from 'lucide-react'
import type {
  CubiScanMeasurement,
  ReconciliationActionType,
} from '@/lib/cubiscan/types'
import { cn } from '@/lib/utils'
import { useCubiScan } from '@/hooks/use-cubiscan'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CubiScanInspector } from './cubiscan-inspector'
import { CubiScanQueueTable } from './cubiscan-queue-table'
import { CubiScanToolbar } from './cubiscan-toolbar'

export default function CubiScanWorkspace() {
  const [selectedMeasurement, setSelectedMeasurement] =
    useState<CubiScanMeasurement | null>(null)

  const cubiscan = useCubiScan({ enableRealtime: true })

  const handleSelect = useCallback((m: CubiScanMeasurement) => {
    setSelectedMeasurement((prev) => (prev?.id === m.id ? null : m))
  }, [])

  const handleReconcile = useCallback(
    async (actionType: ReconciliationActionType, reason?: string) => {
      if (!selectedMeasurement) return
      await cubiscan.reconcile(selectedMeasurement.id, actionType, reason)
      setSelectedMeasurement(null)
    },
    [selectedMeasurement, cubiscan]
  )

  const stats = cubiscan.statistics

  return (
    <div className='flex h-full flex-col gap-0'>
      {/* Live-Ops Strip */}
      <div className='bg-muted/40 flex flex-wrap items-center gap-4 border-b px-4 py-2'>
        <div className='flex items-center gap-2'>
          {(stats?.live_devices ?? 0) > 0 ? (
            <>
              <Wifi className='h-3.5 w-3.5 text-green-500' />
              <span className='text-xs font-medium'>
                {stats?.live_devices} device
                {stats?.live_devices !== 1 ? 's' : ''} live
              </span>
            </>
          ) : (
            <>
              <WifiOff className='h-3.5 w-3.5 text-orange-500' />
              <span className='text-muted-foreground text-xs'>
                No devices online
              </span>
            </>
          )}
        </div>

        <div className='bg-border h-4 w-px' />

        <div className='flex items-center gap-4 text-xs'>
          <MetricPill
            label='Scans / 15m'
            value={stats?.scans_last_15_min ?? 0}
          />
          <MetricPill
            label='Needs Review'
            value={stats?.needs_review ?? 0}
            variant={(stats?.needs_review ?? 0) > 0 ? 'warning' : 'default'}
          />
          <MetricPill
            label='Failed'
            value={stats?.failed_ingests ?? 0}
            variant={
              (stats?.failed_ingests ?? 0) > 0 ? 'destructive' : 'default'
            }
          />
          <MetricPill
            label='Stale Devices'
            value={stats?.stale_devices ?? 0}
            variant={(stats?.stale_devices ?? 0) > 0 ? 'warning' : 'default'}
          />
          <MetricPill label='Today' value={stats?.today_measurements ?? 0} />
          <MetricPill label='Total' value={stats?.total_measurements ?? 0} />
        </div>

        <div className='ml-auto flex items-center gap-2'>
          <Button
            variant='ghost'
            size='sm'
            onClick={cubiscan.refetch}
            disabled={cubiscan.isFetching}
            className='h-7 w-7 p-0'
          >
            <RefreshCw
              className={cn(
                'h-3.5 w-3.5',
                cubiscan.isFetching && 'animate-spin'
              )}
            />
            <span className='sr-only'>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Main Content: Table + Inspector */}
      <div className='grid flex-1 gap-0 lg:grid-cols-[1fr_380px]'>
        {/* Left: Toolbar + Table */}
        <div className='flex flex-col overflow-hidden border-r'>
          <CubiScanToolbar
            searchQuery={cubiscan.searchQuery}
            onSearchChange={cubiscan.setSearchQuery}
            quickView={cubiscan.quickView}
            onQuickViewChange={cubiscan.setQuickView}
            measurementStatus={cubiscan.measurementStatusFilter}
            onMeasurementStatusChange={cubiscan.setMeasurementStatusFilter}
            reconciliationStatus={cubiscan.reconciliationStatusFilter}
            onReconciliationStatusChange={
              cubiscan.setReconciliationStatusFilter
            }
            devices={cubiscan.devices}
            deviceFilter={cubiscan.deviceFilter}
            onDeviceFilterChange={cubiscan.setDeviceFilter}
          />

          <CubiScanQueueTable
            measurements={cubiscan.measurements}
            totalRecords={cubiscan.totalRecords}
            currentPage={cubiscan.currentPage}
            totalPages={cubiscan.totalPages}
            pageSize={cubiscan.pageSize}
            onPageChange={cubiscan.setCurrentPage}
            selectedId={selectedMeasurement?.id}
            onSelect={handleSelect}
            isLoading={cubiscan.isLoading}
            isFetching={cubiscan.isFetching}
            error={cubiscan.error}
          />
        </div>

        {/* Right: Inspector */}
        <div className='hidden lg:block'>
          <CubiScanInspector
            measurement={selectedMeasurement}
            onReconcile={handleReconcile}
            isReconciling={cubiscan.isReconciling}
          />
        </div>
      </div>
    </div>
  )
}

function MetricPill({
  label,
  value,
  variant = 'default',
}: {
  label: string
  value: number
  variant?: 'default' | 'warning' | 'destructive'
}) {
  return (
    <div className='flex items-center gap-1.5'>
      <span className='text-muted-foreground'>{label}</span>
      <Badge
        variant={variant === 'destructive' ? 'destructive' : 'secondary'}
        className={cn(
          'h-5 px-1.5 text-[11px] font-semibold tabular-nums',
          variant === 'warning' &&
            'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
          variant === 'default' && ''
        )}
      >
        {value.toLocaleString()}
      </Badge>
    </div>
  )
}

// Created and developed by Jai Singh
