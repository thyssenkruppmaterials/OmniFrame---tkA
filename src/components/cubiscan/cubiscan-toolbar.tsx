// Created and developed by Jai Singh
/**
 * CubiScan Toolbar
 * Search, quick views, status filters, device filter, and export.
 */
import { Download, Search } from 'lucide-react'
import { toast } from 'sonner'
import type {
  CubiScanDevice,
  CubiScanQuickView,
  MeasurementStatus,
  ReconciliationStatus,
} from '@/lib/cubiscan/types'
import { cubiscanService } from '@/lib/supabase/cubiscan.service'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface CubiScanToolbarProps {
  searchQuery: string
  onSearchChange: (q: string) => void
  quickView: CubiScanQuickView
  onQuickViewChange: (v: CubiScanQuickView) => void
  measurementStatus: MeasurementStatus | undefined
  onMeasurementStatusChange: (s: MeasurementStatus | undefined) => void
  reconciliationStatus: ReconciliationStatus | undefined
  onReconciliationStatusChange: (s: ReconciliationStatus | undefined) => void
  devices: CubiScanDevice[]
  deviceFilter: string | undefined
  onDeviceFilterChange: (d: string | undefined) => void
}

const QUICK_VIEWS: { id: CubiScanQuickView; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'failed', label: 'Failed' },
]

export function CubiScanToolbar({
  searchQuery,
  onSearchChange,
  quickView,
  onQuickViewChange,
  measurementStatus,
  onMeasurementStatusChange,
  reconciliationStatus,
  onReconciliationStatusChange,
  devices,
  deviceFilter,
  onDeviceFilterChange,
}: CubiScanToolbarProps) {
  const handleExport = async () => {
    try {
      const data = await cubiscanService.exportMeasurements({
        measurement_status: measurementStatus,
        reconciliation_status: reconciliationStatus,
      })
      const csv = convertToCSV(data as unknown as Record<string, unknown>[])
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cubiscan-export-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${data.length} records`)
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className='flex flex-col gap-2 border-b px-4 py-3'>
      {/* Quick Views */}
      <div className='flex items-center gap-1'>
        {QUICK_VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => onQuickViewChange(v.id)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              quickView === v.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Search + Filters */}
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-[200px] flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search barcode, material, description...'
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className='h-8 pl-9 text-sm'
          />
        </div>

        <Select
          value={measurementStatus ?? '__all__'}
          onValueChange={(v) =>
            onMeasurementStatusChange(
              v === '__all__' ? undefined : (v as MeasurementStatus)
            )
          }
        >
          <SelectTrigger className='h-8 w-[140px] max-w-full min-w-0 text-xs'>
            <SelectValue placeholder='Status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='__all__'>All Statuses</SelectItem>
            <SelectItem value='received'>Received</SelectItem>
            <SelectItem value='parsed'>Parsed</SelectItem>
            <SelectItem value='parse_failed'>Parse Failed</SelectItem>
            <SelectItem value='validated'>Validated</SelectItem>
            <SelectItem value='mismatch'>Mismatch</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={reconciliationStatus ?? '__all__'}
          onValueChange={(v) =>
            onReconciliationStatusChange(
              v === '__all__' ? undefined : (v as ReconciliationStatus)
            )
          }
        >
          <SelectTrigger className='h-8 w-[150px] max-w-full min-w-0 text-xs'>
            <SelectValue placeholder='Reconciliation' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='__all__'>All Reconciliation</SelectItem>
            <SelectItem value='pending'>Pending</SelectItem>
            <SelectItem value='approved'>Approved</SelectItem>
            <SelectItem value='applied'>Applied</SelectItem>
            <SelectItem value='rejected'>Rejected</SelectItem>
            <SelectItem value='quarantined'>Quarantined</SelectItem>
          </SelectContent>
        </Select>

        {devices.length > 0 && (
          <Select
            value={deviceFilter ?? '__all__'}
            onValueChange={(v) =>
              onDeviceFilterChange(v === '__all__' ? undefined : v)
            }
          >
            <SelectTrigger className='h-8 w-[140px] max-w-full min-w-0 text-xs'>
              <SelectValue placeholder='Device' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='__all__'>All Devices</SelectItem>
              {devices.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.device_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant='outline'
          size='sm'
          onClick={handleExport}
          className='h-8 text-xs'
        >
          <Download className='mr-1.5 h-3.5 w-3.5' />
          Export
        </Button>
      </div>
    </div>
  )
}

function convertToCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return ''
  const keys = Object.keys(data[0])
  const header = keys.join(',')
  const rows = data.map((row) =>
    keys
      .map((k) => {
        const val = row[k]
        if (val == null) return ''
        const str = String(val)
        return str.includes(',') || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str
      })
      .join(',')
  )
  return [header, ...rows].join('\n')
}

// Created and developed by Jai Singh
