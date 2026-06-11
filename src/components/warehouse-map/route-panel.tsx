// Created and developed by Jai Singh
/**
 * RoutePanel — Sheet panel for navigating from one bin to another (or many).
 * Issues `get_route` / `get_pick_tour` RPCs and feeds the result into the
 * store so the canvas RouteOverlay renders the polyline.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Navigation, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { WarehouseLocationMapping } from './types'

const service = WarehouseMapService.getInstance()

interface RoutePanelProps {
  mapId: string | null
  open: boolean
  mappings: WarehouseLocationMapping[]
  onClose: () => void
}

export function RoutePanel({
  mapId,
  open,
  mappings,
  onClose,
}: RoutePanelProps) {
  const setActiveRoute = useWarehouseMapStore((s) => s.setActiveRoute)
  const clearRoute = useWarehouseMapStore((s) => s.clearRoute)
  const activeRoute = useWarehouseMapStore((s) => s.activeRoute)
  const routeFromBin = useWarehouseMapStore((s) => s.routeFromBin)
  const setRouteFromBin = useWarehouseMapStore((s) => s.setRouteFromBin)

  const [fromInput, setFromInput] = useState(routeFromBin ?? '')
  const [toInput, setToInput] = useState('')
  const [tourBins, setTourBins] = useState<string[]>([])

  useEffect(() => {
    setFromInput(routeFromBin ?? '')
  }, [routeFromBin])

  const validBins = useMemo(() => {
    const set = new Set<string>()
    for (const m of mappings) set.add(m.storage_bin)
    return set
  }, [mappings])

  const routeMutation = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      service.getRoute(mapId!, from, to),
    onSuccess: (result) => {
      if (!result.found) {
        toast.error(result.reason ?? 'No path found')
        clearRoute()
        return
      }
      setActiveRoute(result)
      toast.success(
        `Route found · cost ${result.total_cost?.toFixed(1) ?? '?'}`
      )
    },
    onError: (err: Error) => toast.error(err.message ?? 'Routing failed'),
  })

  const tourMutation = useMutation({
    mutationFn: ({ from, bins }: { from: string; bins: string[] }) =>
      service.getPickTour(mapId!, from, bins),
    onSuccess: (result) => {
      if (!result.found || result.combined_polyline.length === 0) {
        toast.error('Could not connect all bins')
        return
      }
      setActiveRoute({
        found: true,
        polyline: result.combined_polyline,
        total_cost: result.total_cost,
      })
      toast.success(
        `Tour: ${result.visited}/${result.requested} bins · cost ${result.total_cost.toFixed(1)}`
      )
    },
    onError: (err: Error) => toast.error(err.message ?? 'Tour failed'),
  })

  const handleNavigate = () => {
    if (!fromInput || !toInput) return
    if (!validBins.has(fromInput) || !validBins.has(toInput)) {
      toast.error('Both bins must be mapped on this layout')
      return
    }
    setRouteFromBin(fromInput)
    routeMutation.mutate({ from: fromInput, to: toInput })
  }

  const handleAddTourBin = () => {
    if (!toInput || tourBins.includes(toInput)) return
    if (!validBins.has(toInput)) {
      toast.error('Bin not mapped')
      return
    }
    setTourBins((p) => [...p, toInput])
    setToInput('')
  }

  const handleRunTour = () => {
    if (!fromInput || tourBins.length === 0) return
    tourMutation.mutate({ from: fromInput, bins: tourBins })
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side='right' className='flex w-96 flex-col'>
        <SheetHeader>
          <SheetTitle className='flex items-center gap-2'>
            <Navigation className='h-4 w-4' />
            Navigate
          </SheetTitle>
          <SheetDescription>
            Pathfind across the aisle graph from one bin to another, or optimize
            a multi-bin tour.
          </SheetDescription>
        </SheetHeader>

        <div className='flex flex-col gap-3 px-4 py-4'>
          <div className='space-y-1'>
            <Label htmlFor='route-from' className='text-xs'>
              From bin
            </Label>
            <Input
              id='route-from'
              placeholder='e.g. AB-01-03'
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className='font-mono'
            />
          </div>

          <div className='space-y-1'>
            <Label htmlFor='route-to' className='text-xs'>
              To bin
            </Label>
            <div className='flex gap-1'>
              <Input
                id='route-to'
                placeholder='e.g. CD-04-02'
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                className='font-mono'
              />
              <Button
                variant='outline'
                size='icon'
                onClick={handleAddTourBin}
                title='Add to tour'
              >
                <Plus className='h-4 w-4' />
              </Button>
            </div>
          </div>

          <Button
            onClick={handleNavigate}
            disabled={
              !fromInput ||
              !toInput ||
              routeMutation.isPending ||
              tourMutation.isPending
            }
          >
            {routeMutation.isPending ? 'Routing…' : 'Navigate'}
          </Button>

          {tourBins.length > 0 && (
            <>
              <Separator />
              <div className='space-y-2'>
                <p className='text-sm font-medium'>Tour ({tourBins.length})</p>
                <ul className='flex flex-wrap gap-1'>
                  {tourBins.map((b) => (
                    <li key={b}>
                      <Badge
                        variant='outline'
                        className='gap-1 font-mono text-xs'
                      >
                        {b}
                        <button
                          type='button'
                          onClick={() =>
                            setTourBins((p) => p.filter((x) => x !== b))
                          }
                          className='hover:text-destructive'
                        >
                          <X className='h-3 w-3' />
                        </button>
                      </Badge>
                    </li>
                  ))}
                </ul>
                <div className='flex gap-2'>
                  <Button
                    onClick={handleRunTour}
                    disabled={tourMutation.isPending}
                    className='flex-1'
                  >
                    {tourMutation.isPending ? 'Optimizing…' : 'Optimize tour'}
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => setTourBins([])}
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            </>
          )}

          {activeRoute && (
            <>
              <Separator />
              <div className='space-y-1 text-sm'>
                <p className='font-medium'>Active route</p>
                <p className='text-muted-foreground text-xs'>
                  {activeRoute.polyline.length} waypoints
                  {activeRoute.total_cost
                    ? ` · cost ${activeRoute.total_cost.toFixed(1)}`
                    : ''}
                </p>
                <Button variant='outline' size='sm' onClick={clearRoute}>
                  Clear
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Created and developed by Jai Singh
