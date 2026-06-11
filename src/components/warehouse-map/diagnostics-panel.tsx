// Created and developed by Jai Singh
/**
 * DiagnosticsPanel — Sheet panel showing data-quality diagnostics for the
 * current map (orphan mappings, stale bins, ambiguous MLGT, duplicate labels).
 */
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { MapDiagnostics } from './types'

const service = WarehouseMapService.getInstance()

interface DiagnosticsPanelProps {
  mapId: string | null
  open: boolean
  onClose: () => void
}

export function DiagnosticsPanel({
  mapId,
  open,
  onClose,
}: DiagnosticsPanelProps) {
  const { data, isLoading, refetch, isRefetching } = useQuery<MapDiagnostics>({
    queryKey: ['warehouse-map-diagnostics', mapId],
    queryFn: () => service.getDiagnostics(mapId!),
    enabled: !!mapId && open,
  })

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side='right' className='flex w-md flex-col'>
        <SheetHeader>
          <SheetTitle className='flex items-center gap-2'>
            <AlertTriangle className='h-4 w-4' />
            Diagnostics
          </SheetTitle>
          <SheetDescription>
            Data-quality issues with the current map.
          </SheetDescription>
        </SheetHeader>

        <div className='flex items-center justify-between px-4 pt-2'>
          <div className='flex flex-wrap gap-1 text-xs'>
            <Badge variant='outline'>
              {data?.unmapped_bins.length ?? 0} unmapped
            </Badge>
            <Badge variant='outline'>
              {data?.orphaned_mappings.length ?? 0} orphan
            </Badge>
            <Badge variant='outline'>
              {data?.stale_bins.length ?? 0} stale
            </Badge>
            <Badge variant='outline'>
              {data?.ambiguous_mlgt_matches.length ?? 0} mlgt
            </Badge>
          </div>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className='h-3.5 w-3.5' />
          </Button>
        </div>

        <Tabs defaultValue='unmapped' className='flex flex-1 flex-col px-4'>
          <TabsList className='grid grid-cols-4'>
            <TabsTrigger value='unmapped'>Unmapped</TabsTrigger>
            <TabsTrigger value='orphan'>Orphan</TabsTrigger>
            <TabsTrigger value='stale'>Stale</TabsTrigger>
            <TabsTrigger value='other'>Other</TabsTrigger>
          </TabsList>

          <ScrollArea className='mt-2 flex-1 rounded border'>
            <TabsContent value='unmapped' className='m-0 p-2 text-xs'>
              {isLoading ? (
                <p className='text-muted-foreground p-2'>Loading…</p>
              ) : !data?.unmapped_bins.length ? (
                <p className='text-muted-foreground p-2'>None</p>
              ) : (
                <ul className='space-y-1'>
                  {data.unmapped_bins.map((u) => (
                    <li
                      key={u.storage_bin}
                      className='hover:bg-muted/50 flex items-center justify-between rounded px-2 py-1'
                    >
                      <span className='font-mono'>{u.storage_bin}</span>
                      <span className='text-muted-foreground'>
                        {u.storage_area} · stock {u.total_stock}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value='orphan' className='m-0 p-2 text-xs'>
              {!data?.orphaned_mappings.length ? (
                <p className='text-muted-foreground p-2'>None</p>
              ) : (
                <ul className='space-y-1'>
                  {data.orphaned_mappings.map((o) => (
                    <li
                      key={o.mapping_id}
                      className='flex items-center justify-between rounded px-2 py-1'
                    >
                      <span className='font-mono'>{o.storage_bin}</span>
                      <span className='text-muted-foreground'>
                        {o.rack_label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value='stale' className='m-0 p-2 text-xs'>
              {!data?.stale_bins.length ? (
                <p className='text-muted-foreground p-2'>None</p>
              ) : (
                <ul className='space-y-1'>
                  {data.stale_bins.map((s) => (
                    <li
                      key={s.storage_bin}
                      className='flex items-center justify-between rounded px-2 py-1'
                    >
                      <span className='font-mono'>{s.storage_bin}</span>
                      <span className='text-muted-foreground'>
                        {s.minutes_since_sync} min
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value='other' className='m-0 space-y-3 p-2 text-xs'>
              <div>
                <p className='mb-1 font-medium'>Ambiguous MLGT</p>
                {!data?.ambiguous_mlgt_matches.length ? (
                  <p className='text-muted-foreground'>None</p>
                ) : (
                  <ul>
                    {data.ambiguous_mlgt_matches.map((a) => (
                      <li key={a.storage_bin} className='font-mono'>
                        {a.storage_bin} ({a.match_count})
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className='mb-1 font-medium'>Duplicate rack labels</p>
                {!data?.duplicate_rack_labels.length ? (
                  <p className='text-muted-foreground'>None</p>
                ) : (
                  <ul>
                    {data.duplicate_rack_labels.map((d) => (
                      <li key={d} className='font-mono'>
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className='mb-1 font-medium'>Auto-map warnings</p>
                {!data?.pending_auto_map_warnings.length ? (
                  <p className='text-muted-foreground'>None</p>
                ) : (
                  <ul className='list-disc pl-4'>
                    {data.pending_auto_map_warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

// Created and developed by Jai Singh
