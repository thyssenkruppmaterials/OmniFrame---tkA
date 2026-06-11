// Created and developed by Jai Singh
/**
 * CubiScan Inspector
 * Right-panel detail view for a selected measurement.
 * Shows dimensions, raw payload, audit trail, and reconciliation actions.
 */
import { useState } from 'react'
import { format } from 'date-fns'
import {
  Box,
  Check,
  Clock,
  FileText,
  RotateCcw,
  Scale,
  ShieldAlert,
  X,
} from 'lucide-react'
import type {
  CubiScanMeasurement,
  ReconciliationActionType,
} from '@/lib/cubiscan/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface CubiScanInspectorProps {
  measurement: CubiScanMeasurement | null
  onReconcile: (
    actionType: ReconciliationActionType,
    reason?: string
  ) => Promise<void>
  isReconciling: boolean
}

export function CubiScanInspector({
  measurement,
  onReconcile,
  isReconciling,
}: CubiScanInspectorProps) {
  const [reason, setReason] = useState('')

  if (!measurement) {
    return (
      <div className='flex h-full flex-col items-center justify-center px-6 py-16'>
        <FileText className='text-muted-foreground mb-3 h-10 w-10 opacity-40' />
        <p className='text-muted-foreground text-sm'>
          Select a measurement to inspect
        </p>
      </div>
    )
  }

  const m = measurement
  const dimLabel = `${Number(m.length).toFixed(1)} x ${Number(m.width).toFixed(1)} x ${Number(m.height).toFixed(1)} ${m.dimension_unit}`
  const volLabel = m.volume
    ? `${Number(m.volume).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${m.dimension_unit}\u00B3`
    : '—'
  const dimWtLabel = m.dimensional_weight
    ? `${Number(m.dimensional_weight).toFixed(2)} ${m.weight_unit}`
    : '—'
  const canAct = m.reconciliation_status === 'pending'

  const handleAction = async (action: ReconciliationActionType) => {
    await onReconcile(action, reason || undefined)
    setReason('')
  }

  return (
    <div className='flex h-full flex-col overflow-y-auto'>
      {/* Header */}
      <div className='border-b px-4 py-3'>
        <div className='flex items-center justify-between'>
          <h3 className='text-sm font-semibold'>Measurement Detail</h3>
          <Badge variant='secondary' className='text-[10px]'>
            {m.measurement_status.replace('_', ' ')}
          </Badge>
        </div>
        <p className='text-muted-foreground mt-0.5 font-mono text-xs'>
          {m.barcode_raw}
        </p>
      </div>

      {/* Dimensions Card */}
      <div className='space-y-4 p-4'>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='flex items-center gap-2 text-xs font-semibold tracking-wider uppercase'>
              <Box className='h-3.5 w-3.5' />
              Dimensions
            </CardTitle>
          </CardHeader>
          <CardContent className='grid grid-cols-2 gap-3 text-xs'>
            <DetailItem label='L x W x H' value={dimLabel} />
            <DetailItem
              label='Weight'
              value={`${Number(m.weight).toFixed(2)} ${m.weight_unit}`}
            />
            <DetailItem label='Volume' value={volLabel} />
            <DetailItem label='DIM Weight' value={dimWtLabel} />
            <DetailItem
              label='Stability'
              value={
                m.stability_score
                  ? `${(Number(m.stability_score) * 100).toFixed(0)}%`
                  : '—'
              }
            />
            <DetailItem label='DIM Factor' value={String(m.dim_factor)} />
          </CardContent>
        </Card>

        {/* Metadata */}
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='flex items-center gap-2 text-xs font-semibold tracking-wider uppercase'>
              <Clock className='h-3.5 w-3.5' />
              Metadata
            </CardTitle>
          </CardHeader>
          <CardContent className='grid grid-cols-2 gap-3 text-xs'>
            <DetailItem label='Material' value={m.material_number ?? '—'} />
            <DetailItem
              label='Description'
              value={m.material_description ?? '—'}
            />
            <DetailItem
              label='Reference'
              value={
                m.reference_type
                  ? `${m.reference_type}: ${m.reference_id}`
                  : '—'
              }
            />
            <DetailItem label='Operator' value={m.operator_name ?? '—'} />
            <DetailItem
              label='Measured'
              value={format(new Date(m.measured_at), 'MMM d, yyyy HH:mm:ss')}
            />
            <DetailItem
              label='Reconciliation'
              value={m.reconciliation_status}
            />
          </CardContent>
        </Card>

        {/* Notes */}
        {m.notes && (
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-xs font-semibold tracking-wider uppercase'>
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className='text-muted-foreground text-xs'>{m.notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Reconciliation Actions */}
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='flex items-center gap-2 text-xs font-semibold tracking-wider uppercase'>
              <Scale className='h-3.5 w-3.5' />
              Actions
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <Input
              placeholder='Reason (optional)'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className='h-8 text-xs'
              disabled={!canAct || isReconciling}
            />
            <div className='grid grid-cols-2 gap-2'>
              <Button
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                disabled={!canAct || isReconciling}
                onClick={() => handleAction('approve')}
              >
                <Check className='mr-1 h-3 w-3' />
                Approve
              </Button>
              <Button
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                disabled={!canAct || isReconciling}
                onClick={() => handleAction('reject')}
              >
                <X className='mr-1 h-3 w-3' />
                Reject
              </Button>
              <Button
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                disabled={!canAct || isReconciling}
                onClick={() => handleAction('quarantine')}
              >
                <ShieldAlert className='mr-1 h-3 w-3' />
                Quarantine
              </Button>
              <Button
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                disabled={isReconciling}
                onClick={() => handleAction('reprocess')}
              >
                <RotateCcw className='mr-1 h-3 w-3' />
                Reprocess
              </Button>
            </div>
            {m.reconciliation_status === 'approved' && (
              <Button
                size='sm'
                className='h-7 w-full text-xs'
                disabled={isReconciling}
                onClick={() => handleAction('apply')}
              >
                Apply to Master Data
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className='text-muted-foreground block text-[10px] tracking-wider uppercase'>
        {label}
      </span>
      <span className='font-medium'>{value}</span>
    </div>
  )
}

// Created and developed by Jai Singh
