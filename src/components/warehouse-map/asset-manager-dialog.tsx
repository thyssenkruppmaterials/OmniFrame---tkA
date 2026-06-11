// Created and developed by Jai Singh
/**
 * AssetManagerDialog — manage warehouse assets (forklifts, operators, robots,
 * etc.) and simulate position updates for live-tracking demos.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Truck, Plus, Trash2, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type { AssetKind, WarehouseAsset } from './types'

const KIND_OPTIONS: { value: AssetKind; label: string; color: string }[] = [
  { value: 'forklift', label: 'Forklift', color: '#f59e0b' },
  { value: 'operator', label: 'Operator', color: '#22c55e' },
  { value: 'cart', label: 'Cart', color: '#3b82f6' },
  { value: 'pallet_jack', label: 'Pallet jack', color: '#06b6d4' },
  { value: 'robot', label: 'Robot', color: '#a855f7' },
  { value: 'sensor', label: 'Sensor', color: '#94a3b8' },
  { value: 'other', label: 'Other', color: '#64748b' },
]

const service = WarehouseMapService.getInstance()

interface AssetManagerDialogProps {
  mapId: string
  open: boolean
  onClose: () => void
}

export function AssetManagerDialog({
  mapId,
  open,
  onClose,
}: AssetManagerDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AssetKind>('forklift')

  const { data: assets = [] } = useQuery<WarehouseAsset[]>({
    queryKey: ['warehouse-assets', mapId],
    queryFn: () => service.listAssets(mapId),
    enabled: !!mapId && open,
  })

  const createMutation = useMutation({
    mutationFn: () => {
      const meta = KIND_OPTIONS.find((o) => o.value === kind)
      return service.createAsset({
        map_id: mapId,
        display_name: name.trim() || meta?.label || 'Asset',
        kind,
        color: meta?.color ?? null,
      })
    },
    onSuccess: () => {
      toast.success('Asset created')
      queryClient.invalidateQueries({ queryKey: ['warehouse-assets', mapId] })
      setName('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => service.deleteAsset(id),
    onSuccess: () => {
      toast.success('Asset removed')
      queryClient.invalidateQueries({ queryKey: ['warehouse-assets', mapId] })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-asset-positions', mapId],
      })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const ingestMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      service.ingestAssetPosition({
        asset_id: id,
        x: 200 + Math.random() * 500,
        y: 200 + Math.random() * 400,
        floor_level: 0,
        heading_deg: Math.random() * 360,
        speed_mps: 1 + Math.random() * 2,
        source: 'manual',
      }),
    onSuccess: () => {
      toast.success('Position ingested')
      queryClient.invalidateQueries({
        queryKey: ['warehouse-asset-positions', mapId],
      })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Truck className='h-4 w-4' />
            Asset manager
          </DialogTitle>
          <DialogDescription>
            Track forklifts, operators, and equipment on the map. Ingest a
            position via{' '}
            <code className='bg-muted rounded px-1 text-xs'>
              ingest_asset_position
            </code>{' '}
            (called by your BLE / UWB / scanner integration in production, or
            simulated below).
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1'>
              <Label htmlFor='asset-name' className='text-xs'>
                Name
              </Label>
              <Input
                id='asset-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. Forklift 12'
              />
            </div>
            <div className='space-y-1'>
              <Label className='text-xs'>Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as AssetKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className='flex items-center gap-2'>
                        <span
                          className='inline-block h-2 w-2 rounded-full'
                          style={{ backgroundColor: opt.color }}
                        />
                        {opt.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className='w-full'
          >
            <Plus className='mr-1 h-3.5 w-3.5' />
            {createMutation.isPending ? 'Creating…' : 'Create asset'}
          </Button>

          <Separator />

          <p className='text-muted-foreground text-xs'>
            {assets.length} asset{assets.length === 1 ? '' : 's'} on this map
          </p>
          <ScrollArea className='max-h-72 rounded border'>
            <ul className='divide-border divide-y'>
              {assets.length === 0 && (
                <li className='text-muted-foreground p-3 text-center text-sm'>
                  No assets yet. Create one above.
                </li>
              )}
              {assets.map((a) => {
                const opt = KIND_OPTIONS.find((o) => o.value === a.kind)
                return (
                  <li
                    key={a.id}
                    className='hover:bg-muted/40 flex items-center gap-2 px-3 py-2 text-sm'
                  >
                    <span
                      className='inline-block h-2.5 w-2.5 shrink-0 rounded-full'
                      style={{
                        backgroundColor: a.color ?? opt?.color ?? '#64748b',
                      }}
                    />
                    <span className='flex-1 truncate'>{a.display_name}</span>
                    <Badge variant='outline' className='capitalize'>
                      {a.kind.replace('_', ' ')}
                    </Badge>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7'
                      title='Simulate position'
                      onClick={() => ingestMutation.mutate({ id: a.id })}
                      disabled={ingestMutation.isPending}
                    >
                      <MapPin className='h-3.5 w-3.5' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='hover:text-destructive h-7 w-7'
                      onClick={() => deleteMutation.mutate(a.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
