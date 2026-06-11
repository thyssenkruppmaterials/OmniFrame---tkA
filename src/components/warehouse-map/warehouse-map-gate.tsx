// Created and developed by Jai Singh
import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldOff, MapPinOff } from 'lucide-react'
import { usePermissionStore } from '@/stores/permissionStore'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { WarehouseMapSkeleton } from './warehouse-map-skeleton'

const WarehouseLocationMap = lazy(() => import('./warehouse-location-map'))

export default function WarehouseMapGate() {
  const hasPermission = usePermissionStore((state) => state.hasPermission)
  const isPermissionLoading = usePermissionStore((state) => state.isLoading)
  const canRead = hasPermission('read', 'warehouse_maps')

  const {
    data: settings,
    isLoading: isSettingsLoading,
    isError,
  } = useQuery({
    queryKey: ['warehouse-map-settings'],
    queryFn: async () => {
      const result = await WarehouseMapService.getInstance().getSettings()
      return result ?? null
    },
    staleTime: 60_000,
  })

  if (isSettingsLoading || isPermissionLoading) {
    return <WarehouseMapSkeleton />
  }

  if (isError || !canRead) {
    return (
      <div className='flex h-[calc(100vh-200px)] items-center justify-center p-8'>
        <Alert variant='destructive' className='max-w-lg'>
          <ShieldOff className='h-4 w-4' />
          <AlertDescription>
            You do not have permission to view the warehouse map. Contact your
            administrator to request <strong>warehouse_maps:read</strong>{' '}
            access.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!settings?.enabled) {
    const fallback = settings?.fallback_mode ?? 'placeholder'

    if (fallback === 'list') {
      return (
        <div className='flex h-[calc(100vh-200px)] items-center justify-center p-8'>
          <p className='text-muted-foreground'>List fallback mode</p>
        </div>
      )
    }

    if (fallback !== 'map') {
      return (
        <div className='flex h-[calc(100vh-200px)] items-center justify-center p-8'>
          <div className='bg-card flex max-w-md flex-col items-center gap-4 rounded-xl border p-10 text-center shadow-sm'>
            <MapPinOff className='text-muted-foreground h-10 w-10' />
            <h2 className='text-lg font-semibold'>Warehouse Map Not Enabled</h2>
            <p className='text-muted-foreground text-sm'>
              The interactive warehouse map has not been enabled for your
              organisation. Reach out to an administrator to turn it on.
            </p>
          </div>
        </div>
      )
    }
  }

  const readOnly = settings?.read_only_mode ?? false

  return (
    <Suspense fallback={<WarehouseMapSkeleton />}>
      <WarehouseLocationMap settings={settings!} readOnly={readOnly} />
    </Suspense>
  )
}

// Created and developed by Jai Singh
