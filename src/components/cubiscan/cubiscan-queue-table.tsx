// Created and developed by Jai Singh
/**
 * CubiScan Queue Table
 * Dense, scannable table with sticky header, zebra rows,
 * tabular numerics, composed dimension cells, and pagination.
 */
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
} from 'lucide-react'
import type { CubiScanMeasurement } from '@/lib/cubiscan/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface CubiScanQueueTableProps {
  measurements: CubiScanMeasurement[]
  totalRecords: number
  currentPage: number
  totalPages: number
  pageSize: number
  onPageChange: (page: number) => void
  selectedId?: string
  onSelect: (m: CubiScanMeasurement) => void
  isLoading: boolean
  isFetching: boolean
  error: Error | null
}

const STATUS_STYLES: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  parsed:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  parse_failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  validated:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  mismatch:
    'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  superseded: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const RECON_STYLES: Record<string, string> = {
  pending:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  approved:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  applied:
    'bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  quarantined:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  overridden:
    'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
}

export function CubiScanQueueTable({
  measurements,
  totalRecords,
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  selectedId,
  onSelect,
  isLoading,
  isFetching,
  error,
}: CubiScanQueueTableProps) {
  if (error) {
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-2 py-16'>
        <AlertTriangle className='text-destructive h-8 w-8' />
        <p className='text-destructive text-sm font-medium'>
          Failed to load measurements
        </p>
        <p className='text-muted-foreground text-xs'>{error.message}</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='flex flex-1 items-center justify-center py-16'>
        <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
      </div>
    )
  }

  if (measurements.length === 0) {
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-3 py-16'>
        <Package className='text-muted-foreground h-12 w-12 opacity-50' />
        <div className='text-center'>
          <p className='text-sm font-medium'>No measurements found</p>
          <p className='text-muted-foreground mt-1 text-xs'>
            Measurements will appear here when the CubiScan bridge sends data
          </p>
        </div>
      </div>
    )
  }

  const start = (currentPage - 1) * pageSize + 1
  const end = Math.min(currentPage * pageSize, totalRecords)

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='min-h-0 min-w-0 flex-1'>
        <Table>
          <TableHeader className='bg-background sticky top-0 z-10'>
            <TableRow>
              <TableHead className='w-[90px] text-xs'>Status</TableHead>
              <TableHead className='w-[100px] text-xs'>Recon</TableHead>
              <TableHead className='min-w-[140px] text-xs'>Barcode</TableHead>
              <TableHead className='min-w-[100px] text-xs'>Material</TableHead>
              <TableHead className='w-[180px] text-xs'>
                Dimensions (L x W x H)
              </TableHead>
              <TableHead className='w-[80px] text-right text-xs'>
                Weight
              </TableHead>
              <TableHead className='w-[80px] text-right text-xs'>
                DIM Wt
              </TableHead>
              <TableHead className='w-[100px] text-xs'>Operator</TableHead>
              <TableHead className='w-[110px] text-xs'>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {measurements.map((m, i) => (
              <TableRow
                key={m.id}
                onClick={() => onSelect(m)}
                className={cn(
                  'cursor-pointer transition-colors',
                  selectedId === m.id
                    ? 'bg-primary/5 border-l-primary border-l-2'
                    : i % 2 === 0
                      ? 'hover:bg-muted/50'
                      : 'bg-muted/20 hover:bg-muted/50'
                )}
              >
                <TableCell className='py-2'>
                  <Badge
                    variant='secondary'
                    className={cn(
                      'text-[10px] font-medium',
                      STATUS_STYLES[m.measurement_status] ?? ''
                    )}
                  >
                    {m.measurement_status.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className='py-2'>
                  <Badge
                    variant='secondary'
                    className={cn(
                      'text-[10px] font-medium',
                      RECON_STYLES[m.reconciliation_status] ?? ''
                    )}
                  >
                    {m.reconciliation_status}
                  </Badge>
                </TableCell>
                <TableCell className='py-2'>
                  <span className='font-mono text-xs font-medium'>
                    {m.barcode_raw}
                  </span>
                  {m.barcode_normalized &&
                    m.barcode_normalized !== m.barcode_raw && (
                      <span className='text-muted-foreground ml-1 text-[10px]'>
                        ({m.barcode_normalized})
                      </span>
                    )}
                </TableCell>
                <TableCell className='py-2'>
                  <span className='text-xs'>{m.material_number ?? '—'}</span>
                </TableCell>
                <TableCell className='py-2'>
                  <span className='font-mono text-xs tabular-nums'>
                    {Number(m.length).toFixed(1)} x {Number(m.width).toFixed(1)}{' '}
                    x {Number(m.height).toFixed(1)}{' '}
                    <span className='text-muted-foreground'>
                      {m.dimension_unit}
                    </span>
                  </span>
                </TableCell>
                <TableCell className='py-2 text-right'>
                  <span className='font-mono text-xs tabular-nums'>
                    {Number(m.weight).toFixed(2)}
                  </span>
                  <span className='text-muted-foreground ml-0.5 text-[10px]'>
                    {m.weight_unit}
                  </span>
                </TableCell>
                <TableCell className='py-2 text-right'>
                  <span className='font-mono text-xs tabular-nums'>
                    {m.dimensional_weight
                      ? Number(m.dimensional_weight).toFixed(2)
                      : '—'}
                  </span>
                </TableCell>
                <TableCell className='py-2'>
                  <span className='text-muted-foreground text-xs'>
                    {m.operator_name ?? '—'}
                  </span>
                </TableCell>
                <TableCell className='py-2'>
                  <span className='text-muted-foreground text-xs'>
                    {formatDistanceToNow(new Date(m.measured_at), {
                      addSuffix: true,
                    })}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className='flex items-center justify-between border-t px-4 py-2'>
        <span className='text-muted-foreground text-xs'>
          {start}–{end} of {totalRecords.toLocaleString()}
        </span>
        <div className='flex items-center gap-1'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1 || isFetching}
            className='h-7 w-7 p-0'
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <span className='text-xs tabular-nums'>
            {currentPage} / {totalPages}
          </span>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages || isFetching}
            className='h-7 w-7 p-0'
          >
            <ChevronRight className='h-4 w-4' />
          </Button>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
