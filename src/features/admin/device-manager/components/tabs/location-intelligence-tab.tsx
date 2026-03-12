import { useState } from 'react'
import {
  IconMapPin,
  IconSearch,
  IconPlus,
  IconRefresh,
  IconHistory,
  IconCurrentLocation,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useDeviceList } from '../../hooks/use-device-inventory'
import {
  useLatestLocations,
  useLocationHistory,
} from '../../hooks/use-device-locations'
import { useGeofences } from '../../hooks/use-geofencing'
import type {
  MdmDevice,
  DeviceStatus,
  DeviceLocation,
  Geofence,
} from '../../types/device-manager.types'
import { DeviceStatusDot } from '../shared/device-status-dot'

export function LocationIntelligenceTab() {
  const [search, setSearch] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [mode, setMode] = useState<'latest' | 'history'>('latest')

  const {
    data: locations,
    isLoading: loadingLocations,
    refetch: refetchLocations,
  } = useLatestLocations()
  const { data: history } = useLocationHistory({
    deviceId: mode === 'history' ? selectedDeviceId : null,
    limit: 50,
  })
  const { data: geofences, isLoading: loadingGeofences } = useGeofences()
  const { data: devicesData } = useDeviceList({ perPage: 100 })

  const devices: MdmDevice[] =
    devicesData?.map((r: { device: MdmDevice }) => r.device) ?? []
  const locationMap = new Map<string, DeviceLocation>()
  for (const loc of locations || []) {
    if (!locationMap.has(loc.device_id)) locationMap.set(loc.device_id, loc)
  }

  const filteredDevices = devices.filter(
    (d) =>
      !search ||
      d.device_name?.toLowerCase().includes(search.toLowerCase()) ||
      d.serial_number?.toLowerCase().includes(search.toLowerCase())
  )

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)
  const selectedLocation = selectedDeviceId
    ? locationMap.get(selectedDeviceId)
    : null

  return (
    <div className='grid gap-6 lg:grid-cols-[1fr_300px]'>
      <div className='space-y-4'>
        <div className='flex items-center gap-2'>
          <Button
            variant={mode === 'latest' ? 'default' : 'outline'}
            size='sm'
            onClick={() => setMode('latest')}
          >
            <IconCurrentLocation className='mr-1 h-3.5 w-3.5' />
            Latest
          </Button>
          <Button
            variant={mode === 'history' ? 'default' : 'outline'}
            size='sm'
            onClick={() => setMode('history')}
          >
            <IconHistory className='mr-1 h-3.5 w-3.5' />
            History
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='ml-auto'
            onClick={() => refetchLocations()}
          >
            <IconRefresh className='h-3.5 w-3.5' />
          </Button>
        </div>

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>
              {mode === 'latest'
                ? 'Device Locations'
                : `Location History${selectedDevice ? ` - ${selectedDevice.device_name}` : ''}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='bg-muted/20 flex aspect-[16/9] items-center justify-center rounded-lg border'>
              <div className='text-center'>
                <IconMapPin className='text-muted-foreground mx-auto h-8 w-8' />
                <p className='text-muted-foreground mt-2 text-sm'>
                  Interactive map will render here
                </p>
                <p className='text-muted-foreground text-xs'>
                  Leaflet integration pending (Phase B)
                </p>
                {selectedLocation && (
                  <p className='mt-2 text-xs font-medium'>
                    Selected: {selectedLocation.latitude.toFixed(4)},{' '}
                    {selectedLocation.longitude.toFixed(4)}
                  </p>
                )}
                <p className='text-muted-foreground mt-1 text-xs'>
                  {locationMap.size} device{locationMap.size !== 1 ? 's' : ''}{' '}
                  with location data
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {mode === 'latest' && (
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base'>Latest Positions</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingLocations ? (
                <div className='space-y-2'>
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className='bg-muted/30 h-10 animate-pulse rounded-lg'
                    />
                  ))}
                </div>
              ) : locationMap.size === 0 ? (
                <p className='text-muted-foreground py-6 text-center text-sm'>
                  No location data available
                </p>
              ) : (
                <div className='max-h-64 space-y-1 overflow-y-auto'>
                  {Array.from(locationMap.entries()).map(([deviceId, loc]) => {
                    const dev = devices.find((d) => d.id === deviceId)
                    return (
                      <button
                        key={deviceId}
                        onClick={() =>
                          setSelectedDeviceId(
                            deviceId === selectedDeviceId ? null : deviceId
                          )
                        }
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${deviceId === selectedDeviceId ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                      >
                        <IconMapPin className='h-3 w-3 shrink-0 text-blue-500' />
                        <span className='truncate font-medium'>
                          {dev?.device_name || deviceId.slice(0, 8)}
                        </span>
                        <span className='text-muted-foreground ml-auto'>
                          {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {mode === 'history' && selectedDeviceId && (
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base'>
                History Trail ({(history || []).length} points)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(history || []).length === 0 ? (
                <p className='text-muted-foreground py-6 text-center text-sm'>
                  No history for this device
                </p>
              ) : (
                <div className='max-h-64 space-y-1 overflow-y-auto'>
                  {(history || []).map((loc: DeviceLocation) => (
                    <div
                      key={loc.id}
                      className='flex items-center gap-2 text-xs'
                    >
                      <span className='text-muted-foreground w-[130px]'>
                        {new Date(loc.timestamp).toLocaleString()}
                      </span>
                      <span>
                        {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                      </span>
                      {loc.speed != null && (
                        <span className='text-muted-foreground'>
                          {loc.speed.toFixed(1)} m/s
                        </span>
                      )}
                      <span className='text-muted-foreground ml-auto text-[10px]'>
                        {loc.source}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className='pb-3'>
            <div className='flex items-center justify-between'>
              <CardTitle className='text-base'>
                Geofences ({(geofences || []).length})
              </CardTitle>
              <Button size='sm' className='h-7 text-xs'>
                <IconPlus className='mr-1 h-3 w-3' />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingGeofences ? (
              <div className='space-y-2'>
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className='bg-muted/30 h-12 animate-pulse rounded-lg'
                  />
                ))}
              </div>
            ) : (geofences || []).length === 0 ? (
              <p className='text-muted-foreground py-6 text-center text-sm'>
                No geofences configured
              </p>
            ) : (
              <div className='grid gap-2 sm:grid-cols-2'>
                {(geofences || []).map((g: Geofence) => (
                  <div key={g.id} className='rounded-lg border p-3'>
                    <div className='flex items-center justify-between'>
                      <p className='text-xs font-medium'>{g.name}</p>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${g.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}
                      >
                        {g.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <p className='text-muted-foreground text-[10px]'>
                      {g.geometry_type} - {g.alert_type} alert
                    </p>
                    {g.radius_meters && (
                      <p className='text-muted-foreground text-[10px]'>
                        Radius: {g.radius_meters}m
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>Devices</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='relative'>
            <IconSearch className='text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
            <Input
              placeholder='Search...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='h-8 pl-8 text-xs'
            />
          </div>
          <div className='max-h-[500px] space-y-1 overflow-y-auto'>
            {filteredDevices.map((d) => {
              const hasLoc = locationMap.has(d.id)
              return (
                <button
                  key={d.id}
                  onClick={() => {
                    setSelectedDeviceId(d.id === selectedDeviceId ? null : d.id)
                    setMode(d.id !== selectedDeviceId ? 'latest' : mode)
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    d.id === selectedDeviceId
                      ? 'bg-primary/10'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <DeviceStatusDot
                    status={d.status as DeviceStatus}
                    size='sm'
                  />
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-xs font-medium'>
                      {d.device_name || 'Unnamed'}
                    </p>
                    <p className='text-muted-foreground text-[10px]'>
                      {d.model}
                    </p>
                  </div>
                  {hasLoc ? (
                    <IconMapPin className='h-3 w-3 text-blue-500' />
                  ) : (
                    <span className='text-muted-foreground text-[10px]'>
                      No loc
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
