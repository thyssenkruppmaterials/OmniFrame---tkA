// Created and developed by Jai Singh
/**
 * FloorSwitcher — vertical pills for switching the active map floor.
 * Reads/writes `currentFloor` in the warehouse map store.
 */
import { useMemo } from 'react'
import { Layers } from 'lucide-react'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { MapLayoutResponse } from './types'

interface FloorSwitcherProps {
  layout: MapLayoutResponse | null
  className?: string
}

export function FloorSwitcher({ layout, className }: FloorSwitcherProps) {
  const currentFloor = useWarehouseMapStore((s) => s.currentFloor)
  const setCurrentFloor = useWarehouseMapStore((s) => s.setCurrentFloor)

  const floors = useMemo(() => {
    const set = new Set<number>()
    set.add(0)
    for (const z of layout?.zones ?? []) set.add(z.floor_level)
    return Array.from(set).sort((a, b) => b - a)
  }, [layout])

  if (floors.length <= 1) return null

  return (
    <div
      className={cn(
        'bg-card/90 absolute top-4 right-4 z-10 flex flex-col gap-1 rounded-lg border p-2 shadow-md backdrop-blur-sm',
        className
      )}
      role='tablist'
      aria-label='Floor switcher'
    >
      <div className='text-muted-foreground flex items-center gap-1 px-1 text-[10px] tracking-wide uppercase'>
        <Layers className='h-3 w-3' />
        Floor
      </div>
      {floors.map((f) => (
        <Button
          key={f}
          variant={currentFloor === f ? 'secondary' : 'ghost'}
          size='sm'
          className='h-7 w-12 px-1'
          onClick={() => setCurrentFloor(f)}
          role='tab'
          aria-selected={currentFloor === f}
        >
          {f === 0 ? 'G' : f > 0 ? `${f}` : `B${Math.abs(f)}`}
        </Button>
      ))}
    </div>
  )
}

// Created and developed by Jai Singh
