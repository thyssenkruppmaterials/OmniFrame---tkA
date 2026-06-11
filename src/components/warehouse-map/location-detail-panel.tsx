// Created and developed by Jai Singh
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - New warehouse map tables not yet in generated database.types.ts
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wrench, PowerOff, RotateCcw, Copy, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { usePermissionStore } from '@/stores/permissionStore'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type {
  OperationalStatus,
  WarehouseLocationMapping,
  LocationStatusLogEntry,
} from './types'
import { STATUS_COLORS, STATUS_BADGE_TEXT } from './types'

interface LocationDetailPanelProps {
  mappingId: string | null
  mapId: string
  readOnly: boolean
  onClose: () => void
}

type StatusAction = 'maintenance' | 'shutdown' | 'active'

const STATUS_ACTION_META: Record<
  StatusAction,
  {
    label: string
    target: OperationalStatus
    variant: 'default' | 'destructive'
  }
> = {
  maintenance: {
    label: 'Send to Maintenance',
    target: 'maintenance',
    variant: 'default',
  },
  shutdown: { label: 'Shut Down', target: 'shutdown', variant: 'destructive' },
  active: { label: 'Reactivate', target: 'active', variant: 'default' },
}

const service = WarehouseMapService.getInstance()

export function LocationDetailPanel({
  mappingId,
  mapId,
  readOnly,
  onClose,
}: LocationDetailPanelProps) {
  const queryClient = useQueryClient()
  const hasPermission = usePermissionStore((s) => s.hasPermission)
  const canManage = hasPermission('manage', 'warehouse_maps')

  const [statusAction, setStatusAction] = useState<StatusAction | null>(null)
  const [reason, setReason] = useState('')

  const { data: mapping, isLoading: isMappingLoading } =
    useQuery<WarehouseLocationMapping | null>({
      queryKey: ['warehouse-mapping', mappingId],
      queryFn: async () => {
        if (!mappingId) return null
        const { data, error } = await (
          await import('@/lib/supabase/client')
        ).supabase
          .from('warehouse_location_mappings')
          .select('*')
          .eq('id', mappingId)
          .single()
        if (error) throw error
        return data as unknown as WarehouseLocationMapping
      },
      enabled: !!mappingId,
    })

  const { data: statusLog = [] } = useQuery<LocationStatusLogEntry[]>({
    queryKey: ['warehouse-status-log', mappingId],
    queryFn: () => service.getStatusLog(mappingId!),
    enabled: !!mappingId,
  })

  const { data: stockData } = useQuery({
    queryKey: ['warehouse-location-stock', mappingId, mapId],
    queryFn: async () => {
      if (!mappingId) return null
      const { data, error } = await (
        await import('@/lib/supabase/client')
      ).supabase.rpc('get_windowed_location_details', {
        p_map_id: mapId,
        p_mapping_ids: [mappingId],
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return row as {
        total_stock: number | null
        available_stock: number | null
        material_summary: string | null
      } | null
    },
    enabled: !!mappingId,
  })

  const statusMutation = useMutation({
    mutationFn: async ({
      target,
      statusReason,
    }: {
      target: OperationalStatus
      statusReason: string
    }) => {
      if (!mapping) throw new Error('No mapping loaded')
      return service.updateLocationStatus(
        mapping.id,
        target,
        statusReason,
        mapping.updated_at
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-mapping', mappingId],
      })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-status-log', mappingId],
      })
      queryClient.invalidateQueries({ queryKey: ['warehouse-map-layout'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-map-stats'] })
      toast.success('Location status updated')
      setStatusAction(null)
      setReason('')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to update status')
    },
  })

  const handleConfirm = () => {
    if (!statusAction) return
    const meta = STATUS_ACTION_META[statusAction]
    statusMutation.mutate({ target: meta.target, statusReason: reason })
  }

  const handleCopyBin = () => {
    if (mapping?.storage_bin) {
      navigator.clipboard.writeText(mapping.storage_bin)
      toast.success('Bin ID copied')
    }
  }

  const currentStatus = mapping?.operational_status ?? 'active'
  const showActions = !readOnly && canManage && mapping

  return (
    <>
      <Sheet open={!!mappingId} onOpenChange={() => onClose()}>
        <SheetContent side='right' className='flex w-full flex-col sm:max-w-md'>
          <SheetHeader>
            {isMappingLoading ? (
              <SheetTitle>Loading…</SheetTitle>
            ) : mapping ? (
              <>
                <div className='flex items-center gap-2'>
                  <SheetTitle className='font-mono text-base'>
                    {mapping.storage_bin}
                  </SheetTitle>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-6 w-6'
                    onClick={handleCopyBin}
                  >
                    <Copy className='h-3.5 w-3.5' />
                  </Button>
                </div>
                <SheetDescription className='sr-only'>
                  Location detail for {mapping.storage_bin}
                </SheetDescription>
                <Badge
                  className='w-fit'
                  style={{
                    backgroundColor: STATUS_COLORS[currentStatus],
                    color: '#fff',
                  }}
                >
                  {STATUS_BADGE_TEXT[currentStatus]}
                </Badge>
              </>
            ) : (
              <SheetTitle>Location not found</SheetTitle>
            )}
          </SheetHeader>

          {mapping && (
            <div className='flex flex-1 flex-col gap-4 overflow-hidden px-4 pb-4'>
              {/* Stock card */}
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm'>Stock</CardTitle>
                </CardHeader>
                <CardContent className='grid grid-cols-2 gap-3 text-sm'>
                  <div>
                    <p className='text-muted-foreground text-xs'>Total</p>
                    <p className='font-medium'>
                      {stockData?.total_stock ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className='text-muted-foreground text-xs'>Available</p>
                    <p className='font-medium'>
                      {stockData?.available_stock ?? '—'}
                    </p>
                  </div>
                  <div className='col-span-2'>
                    <p className='text-muted-foreground text-xs'>Material</p>
                    <p className='truncate font-medium'>
                      {stockData?.material_summary ?? '—'}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Status actions */}
              {showActions && (
                <div className='flex flex-wrap gap-2'>
                  {currentStatus !== 'maintenance' && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setStatusAction('maintenance')}
                    >
                      <Wrench className='mr-1.5 h-3.5 w-3.5' />
                      Send to Maintenance
                    </Button>
                  )}
                  {currentStatus !== 'shutdown' && (
                    <Button
                      variant='outline'
                      size='sm'
                      className='text-destructive border-destructive/30'
                      onClick={() => setStatusAction('shutdown')}
                    >
                      <PowerOff className='mr-1.5 h-3.5 w-3.5' />
                      Shut Down
                    </Button>
                  )}
                  {currentStatus !== 'active' && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setStatusAction('active')}
                    >
                      <RotateCcw className='mr-1.5 h-3.5 w-3.5' />
                      Reactivate
                    </Button>
                  )}
                </div>
              )}

              {/* Audit log */}
              <div className='flex min-h-0 flex-1 flex-col'>
                <h4 className='mb-2 flex items-center gap-1.5 text-sm font-medium'>
                  <Clock className='h-3.5 w-3.5' />
                  Status History
                </h4>
                <ScrollArea className='flex-1 rounded-md border'>
                  <div className='p-3'>
                    {statusLog.length === 0 ? (
                      <p className='text-muted-foreground text-xs'>
                        No status changes recorded.
                      </p>
                    ) : (
                      <ol className='border-border relative border-l pl-4'>
                        {statusLog.map((entry) => (
                          <li key={entry.id} className='mb-4 last:mb-0'>
                            <span
                              className='border-background absolute -left-1.5 h-3 w-3 rounded-full border-2'
                              style={{
                                backgroundColor:
                                  STATUS_COLORS[entry.new_status],
                              }}
                            />
                            <p className='text-xs font-medium'>
                              {STATUS_BADGE_TEXT[entry.old_status]} →{' '}
                              {STATUS_BADGE_TEXT[entry.new_status]}
                            </p>
                            {entry.reason && (
                              <p className='text-muted-foreground mt-0.5 text-xs'>
                                {entry.reason}
                              </p>
                            )}
                            <p className='text-muted-foreground mt-0.5 text-[11px]'>
                              {new Date(entry.changed_at).toLocaleString()} ·{' '}
                              {entry.changed_by}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Status change confirmation dialog */}
      <AlertDialog
        open={!!statusAction}
        onOpenChange={(open) => {
          if (!open) {
            setStatusAction(null)
            setReason('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusAction
                ? STATUS_ACTION_META[statusAction].label
                : 'Change Status'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will change the operational status of{' '}
              <strong className='font-mono'>{mapping?.storage_bin}</strong>.
              Provide a reason for the change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder='Reason for status change…'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={statusMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim() || statusMutation.isPending}
              onClick={handleConfirm}
              className={
                statusAction === 'shutdown'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
            >
              {statusMutation.isPending ? 'Updating…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// Created and developed by Jai Singh
