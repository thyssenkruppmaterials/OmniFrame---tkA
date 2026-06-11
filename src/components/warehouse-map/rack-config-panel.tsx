// Created and developed by Jai Singh
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wand2, Package } from 'lucide-react'
import { toast } from 'sonner'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import type { RackType, UnassignedBin, WarehouseRack } from './types'

interface RackConfigPanelProps {
  rackId: string | null
  mapId: string
  onClose: () => void
}

const RACK_TYPES: { value: RackType; label: string }[] = [
  { value: 'pallet', label: 'Pallet' },
  { value: 'shelving', label: 'Shelving' },
  { value: 'cantilever', label: 'Cantilever' },
  { value: 'flow', label: 'Flow' },
  { value: 'mezzanine', label: 'Mezzanine' },
]

const BIN_CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'racks', label: 'Racks' },
  { value: 'shelves', label: 'Shelves' },
  { value: 'kardex', label: 'Kardex' },
  { value: 'other', label: 'Other' },
] as const

type BinCategory = (typeof BIN_CATEGORIES)[number]['value']

const rackFormSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  rack_type: z.enum(['pallet', 'shelving', 'cantilever', 'flow', 'mezzanine']),
  rows: z.coerce.number().int().min(1).max(50),
  columns: z.coerce.number().int().min(1).max(50),
  aisle: z.string().nullable(),
})

type RackFormValues = z.infer<typeof rackFormSchema>

const service = WarehouseMapService.getInstance()

export function RackConfigPanel({
  rackId,
  mapId,
  onClose,
}: RackConfigPanelProps) {
  const queryClient = useQueryClient()
  const [binCategory, setBinCategory] = useState<BinCategory>('all')

  const { data: rack, isLoading: isRackLoading } =
    useQuery<WarehouseRack | null>({
      queryKey: ['warehouse-rack', rackId],
      queryFn: async () => {
        if (!rackId) return null
        const { data, error } = await (
          await import('@/lib/supabase/client')
        ).supabase
          .from('warehouse_racks')
          .select('*')
          .eq('id', rackId)
          .single()
        if (error) throw error
        return data as unknown as WarehouseRack
      },
      enabled: !!rackId,
    })

  const { data: unassignedBins = [], isLoading: isBinsLoading } = useQuery<
    UnassignedBin[]
  >({
    queryKey: ['warehouse-unassigned-bins', mapId, binCategory],
    queryFn: () =>
      service.getUnassignedBins(
        mapId,
        binCategory === 'all' ? undefined : binCategory
      ),
    enabled: !!mapId,
  })

  const { data: assignedCount = 0 } = useQuery<number>({
    queryKey: ['warehouse-rack-assigned-count', rackId],
    queryFn: async () => {
      if (!rackId) return 0
      const { count, error } = await (
        await import('@/lib/supabase/client')
      ).supabase
        .from('warehouse_location_mappings')
        .select('*', { count: 'exact', head: true })
        .eq('rack_id', rackId)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!rackId,
  })

  const form = useForm<RackFormValues>({
    resolver: zodResolver(rackFormSchema),
    values: rack
      ? {
          label: rack.label,
          rack_type: rack.rack_type,
          rows: rack.rows,
          columns: rack.columns,
          aisle: rack.aisle,
        }
      : undefined,
  })

  const updateRackMutation = useMutation({
    mutationFn: (values: RackFormValues) => {
      if (!rackId) throw new Error('No rack selected')
      return service.updateRack(rackId, values)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-rack', rackId] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-map-layout'] })
      toast.success('Rack updated')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to update rack')
    },
  })

  const autoMapMutation = useMutation({
    mutationFn: () => {
      if (!rack) throw new Error('No rack loaded')
      return service.createAutoMapRun(mapId, rack.aisle ?? rack.label)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-unassigned-bins'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-map-layout'] })
      toast.success('Auto-map run queued — check back shortly for results')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to start auto-map')
    },
  })

  const onSubmit = (values: RackFormValues) => {
    updateRackMutation.mutate(values)
  }

  return (
    <Sheet open={!!rackId} onOpenChange={() => onClose()}>
      <SheetContent side='right' className='flex w-full flex-col sm:max-w-md'>
        <SheetHeader>
          <SheetTitle>
            {isRackLoading
              ? 'Loading…'
              : rack
                ? `Rack: ${rack.label}`
                : 'Rack not found'}
          </SheetTitle>
          <SheetDescription className='sr-only'>
            Configuration panel for rack {rack?.label}
          </SheetDescription>
          {assignedCount > 0 && (
            <Badge variant='secondary' className='w-fit'>
              {assignedCount} assigned location{assignedCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </SheetHeader>

        {rack && (
          <div className='flex flex-1 flex-col gap-4 overflow-hidden px-4 pb-4'>
            {/* Rack properties form */}
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className='space-y-3'
              >
                <FormField
                  control={form.control}
                  name='label'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Label</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='rack_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {RACK_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='grid grid-cols-2 gap-3'>
                  <FormField
                    control={form.control}
                    name='rows'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rows</FormLabel>
                        <FormControl>
                          <Input type='number' min={1} max={50} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='columns'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Columns</FormLabel>
                        <FormControl>
                          <Input type='number' min={1} max={50} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name='aisle'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Aisle</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value || null)
                          }
                          placeholder='e.g. A-01'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type='submit'
                  size='sm'
                  className='w-full'
                  disabled={
                    updateRackMutation.isPending || !form.formState.isDirty
                  }
                >
                  {updateRackMutation.isPending ? 'Saving…' : 'Save Changes'}
                </Button>
              </form>
            </Form>

            <Separator />

            {/* Unassigned bins */}
            <div className='flex min-h-0 flex-1 flex-col gap-2'>
              <div className='flex items-center justify-between'>
                <h4 className='flex items-center gap-1.5 text-sm font-medium'>
                  <Package className='h-3.5 w-3.5' />
                  Unassigned Bins
                </h4>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => autoMapMutation.mutate()}
                  disabled={
                    autoMapMutation.isPending || unassignedBins.length === 0
                  }
                >
                  <Wand2 className='mr-1.5 h-3.5 w-3.5' />
                  {autoMapMutation.isPending ? 'Queuing…' : 'Auto-Map'}
                </Button>
              </div>

              <div className='flex flex-wrap gap-1'>
                {BIN_CATEGORIES.map((cat) => (
                  <Button
                    key={cat.value}
                    variant={binCategory === cat.value ? 'default' : 'outline'}
                    size='sm'
                    className='h-7 text-xs'
                    onClick={() => setBinCategory(cat.value)}
                  >
                    {cat.label}
                  </Button>
                ))}
              </div>

              <ScrollArea className='flex-1 rounded-md border'>
                <div className='p-2'>
                  {isBinsLoading ? (
                    <p className='text-muted-foreground p-2 text-center text-xs'>
                      Loading bins…
                    </p>
                  ) : unassignedBins.length === 0 ? (
                    <p className='text-muted-foreground p-2 text-center text-xs'>
                      No unassigned bins in this category.
                    </p>
                  ) : (
                    <ul className='space-y-1'>
                      {unassignedBins.map((bin) => (
                        <li
                          key={bin.storage_bin}
                          className='hover:bg-muted/50 flex items-center justify-between rounded-md px-2 py-1.5 text-sm'
                        >
                          <div className='min-w-0'>
                            <p className='truncate font-mono text-xs font-medium'>
                              {bin.storage_bin}
                            </p>
                            {bin.material && (
                              <p className='text-muted-foreground truncate text-[11px]'>
                                {bin.material}
                              </p>
                            )}
                          </div>
                          <span className='text-muted-foreground ml-2 shrink-0 text-xs tabular-nums'>
                            {bin.total_stock}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// Created and developed by Jai Singh
