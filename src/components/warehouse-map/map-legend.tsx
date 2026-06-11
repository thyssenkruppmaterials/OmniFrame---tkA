// Created and developed by Jai Singh
import { useQuery } from '@tanstack/react-query'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DataLayer, MapStatistics } from './types'
import { STATUS_COLORS, STATUS_BADGE_TEXT } from './types'

interface MapLegendProps {
  mapId: string | null
}

const LAYER_LABELS: Record<DataLayer, string> = {
  status: 'Operational Status',
  stock: 'Stock Level',
  utilization: 'Utilization',
  activity: 'Activity',
}

const STATUS_LEGEND = [
  {
    key: 'active',
    label: STATUS_BADGE_TEXT.active,
    color: STATUS_COLORS.active,
  },
  {
    key: 'maintenance',
    label: STATUS_BADGE_TEXT.maintenance,
    color: STATUS_COLORS.maintenance,
  },
  {
    key: 'shutdown',
    label: STATUS_BADGE_TEXT.shutdown,
    color: STATUS_COLORS.shutdown,
  },
  {
    key: 'reserved',
    label: STATUS_BADGE_TEXT.reserved,
    color: STATUS_COLORS.reserved,
  },
  {
    key: 'blocked',
    label: STATUS_BADGE_TEXT.blocked,
    color: STATUS_COLORS.blocked,
  },
] as const

const STOCK_GRADIENT_STOPS = ['#f8fafc', '#bfdbfe', '#3b82f6', '#1d4ed8']
const UTILIZATION_GRADIENT_STOPS = ['#22c55e', '#eab308', '#f97316', '#ef4444']

const service = WarehouseMapService.getInstance()

export function MapLegend({ mapId }: MapLegendProps) {
  const activeDataLayer = useWarehouseMapStore((s) => s.activeDataLayer)

  const { data: stats } = useQuery<MapStatistics>({
    queryKey: ['warehouse-map-stats', mapId],
    queryFn: () => service.getMapStatistics(mapId!),
    enabled: !!mapId,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return (
    <Card className='absolute bottom-4 left-4 z-10 w-56 shadow-md'>
      <CardHeader className='px-3 pt-3 pb-1'>
        <CardTitle className='text-xs font-semibold'>
          {LAYER_LABELS[activeDataLayer]}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-2 px-3 pb-3'>
        {activeDataLayer === 'status' && <StatusLegend />}
        {activeDataLayer === 'stock' && (
          <GradientLegend
            stops={STOCK_GRADIENT_STOPS}
            low='Empty'
            high='Full'
          />
        )}
        {activeDataLayer === 'utilization' && (
          <GradientLegend
            stops={UTILIZATION_GRADIENT_STOPS}
            low='Low'
            high='High'
          />
        )}
        {activeDataLayer === 'activity' && <ActivityLegend />}

        {stats && (
          <p className='text-muted-foreground border-t pt-2 text-[11px] leading-relaxed'>
            {(stats.total_locations ?? 0).toLocaleString()} locations
            {(stats.maintenance_count ?? 0) > 0 &&
              ` · ${stats.maintenance_count} maintenance`}
            {(stats.shutdown_count ?? 0) > 0 &&
              ` · ${stats.shutdown_count} shutdown`}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function StatusLegend() {
  return (
    <ul className='space-y-1'>
      {STATUS_LEGEND.map(({ key, label, color }) => (
        <li key={key} className='flex items-center gap-2 text-xs'>
          <span
            className='inline-block h-2.5 w-2.5 shrink-0 rounded-full'
            style={{ backgroundColor: color }}
          />
          {label}
        </li>
      ))}
    </ul>
  )
}

function GradientLegend({
  stops,
  low,
  high,
}: {
  stops: string[]
  low: string
  high: string
}) {
  const gradient = `linear-gradient(to right, ${stops.join(', ')})`

  return (
    <div className='space-y-1'>
      <div
        className='h-2.5 w-full rounded-sm'
        style={{ background: gradient }}
      />
      <div className='text-muted-foreground flex justify-between text-[11px]'>
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  )
}

function ActivityLegend() {
  return (
    <ul className='space-y-1'>
      <li className='flex items-center gap-2 text-xs'>
        <span className='relative flex h-2.5 w-2.5'>
          <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75' />
          <span className='relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500' />
        </span>
        Recent activity
      </li>
      <li className='flex items-center gap-2 text-xs'>
        <span className='inline-block h-2.5 w-2.5 rounded-full bg-slate-300' />
        No recent activity
      </li>
    </ul>
  )
}

// Created and developed by Jai Singh
