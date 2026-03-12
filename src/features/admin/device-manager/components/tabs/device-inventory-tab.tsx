import { useState } from 'react'
import {
  IconSearch,
  IconRefresh,
  IconPlus,
  IconChevronRight,
} from '@tabler/icons-react'
import { useDeviceManagerStore } from '@/stores/deviceManagerStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useDeviceList } from '../../hooks/use-device-inventory'
import type { MdmDevice, DeviceStatus } from '../../types/device-manager.types'
import { DeviceHealthBadge } from '../shared/device-health-badge'
import { DeviceIcon } from '../shared/device-icon'
import { DeviceStatusDot } from '../shared/device-status-dot'
import { TelemetryFreshnessBadge } from '../shared/telemetry-freshness-badge'

export function DeviceInventoryTab() {
  const [search, setSearch] = useState('')
  const { selectedDeviceId, setSelectedDevice } = useDeviceManagerStore()

  const { data, isLoading, error, refetch } = useDeviceList({
    search: search || undefined,
    page: 1,
    perPage: 50,
  })

  const devices: MdmDevice[] =
    data?.map((row: { device: MdmDevice }) => row.device) ?? []
  const totalCount = data?.[0]?.total_count ?? 0

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative min-w-[240px] flex-1'>
          <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search by name, serial, model, or UDID...'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='pl-9'
          />
        </div>
        <Button variant='outline' size='sm' onClick={() => refetch()}>
          <IconRefresh className='mr-1 h-4 w-4' />
          Refresh
        </Button>
        <Button size='sm'>
          <IconPlus className='mr-1 h-4 w-4' />
          Enroll Device
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className='py-6 text-center'>
            <p className='text-destructive text-sm'>Failed to load devices</p>
            <p className='text-muted-foreground mt-1 text-xs'>
              {String(error)}
            </p>
          </CardContent>
        </Card>
      )}

      <div className='grid gap-6 lg:grid-cols-[1fr_360px]'>
        <Card>
          <CardHeader className='pb-3'>
            <div className='flex items-center justify-between'>
              <CardTitle className='text-base'>
                Managed Devices
                <span className='text-muted-foreground ml-2 text-sm font-normal'>
                  ({totalCount})
                </span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className='space-y-2'>
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className='bg-muted/20 h-16 animate-pulse rounded-lg'
                  />
                ))}
              </div>
            ) : devices.length === 0 ? (
              <div className='py-12 text-center'>
                <p className='text-muted-foreground text-sm'>
                  No devices found
                </p>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {search
                    ? 'Try a different search term'
                    : 'Enroll your first device to get started'}
                </p>
              </div>
            ) : (
              <div className='space-y-1'>
                <div className='text-muted-foreground hidden items-center gap-4 px-3 py-2 text-xs font-medium uppercase md:flex'>
                  <div className='w-6' />
                  <div className='w-6' />
                  <div className='min-w-[160px] flex-1'>Device</div>
                  <div className='w-[120px]'>Model</div>
                  <div className='w-[80px]'>OS</div>
                  <div className='w-[80px]'>Health</div>
                  <div className='w-[80px]'>Battery</div>
                  <div className='w-[100px]'>Last Seen</div>
                  <div className='w-6' />
                </div>
                {devices.map((device) => (
                  <DeviceRow
                    key={device.id}
                    device={device}
                    selected={device.id === selectedDeviceId}
                    onClick={() =>
                      setSelectedDevice(
                        device.id === selectedDeviceId ? null : device.id
                      )
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <DeviceDetailPanel device={selectedDevice} />
      </div>
    </div>
  )
}

function DeviceRow({
  device,
  selected,
  onClick,
}: {
  device: MdmDevice
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left transition-colors ${
        selected
          ? 'bg-primary/5 border-primary/20 border'
          : 'hover:bg-muted/50 border border-transparent'
      }`}
    >
      <DeviceStatusDot status={device.status as DeviceStatus} />
      <DeviceIcon
        model={device.model}
        productName={device.product_name}
        size={20}
      />
      <div className='min-w-[160px] flex-1'>
        <p className='text-sm font-medium'>
          {device.device_name || 'Unnamed Device'}
        </p>
        <p className='text-muted-foreground text-xs'>
          {device.serial_number || device.udid || '—'}
        </p>
      </div>
      <div className='hidden w-[120px] md:block'>
        <p className='text-muted-foreground text-xs'>{device.model || '—'}</p>
      </div>
      <div className='hidden w-[80px] md:block'>
        <p className='text-muted-foreground text-xs'>
          {device.os_version || '—'}
        </p>
      </div>
      <div className='hidden w-[80px] md:block'>
        <DeviceHealthBadge score={device.health_score} size='sm' />
      </div>
      <div className='hidden w-[80px] md:block'>
        <p className='text-muted-foreground text-xs'>
          {device.battery_level != null ? `${device.battery_level}%` : '—'}
        </p>
      </div>
      <div className='hidden w-[100px] md:block'>
        <TelemetryFreshnessBadge lastCheckinAt={device.last_checkin_at} />
      </div>
      <IconChevronRight className='text-muted-foreground h-4 w-4' />
    </button>
  )
}

function DeviceDetailPanel({ device }: { device?: MdmDevice | null }) {
  if (!device) {
    return (
      <Card>
        <CardContent className='flex h-64 items-center justify-center'>
          <p className='text-muted-foreground text-sm'>
            Select a device to view details
          </p>
        </CardContent>
      </Card>
    )
  }

  const storageUsedPct =
    device.total_storage_bytes && device.available_storage_bytes
      ? Math.round(
          ((device.total_storage_bytes - device.available_storage_bytes) /
            device.total_storage_bytes) *
            100
        )
      : null

  const storageUsedGB =
    device.total_storage_bytes && device.available_storage_bytes
      ? (
          (device.total_storage_bytes - device.available_storage_bytes) /
          1e9
        ).toFixed(0)
      : null

  const storageTotalGB = device.total_storage_bytes
    ? (device.total_storage_bytes / 1e9).toFixed(0)
    : null

  return (
    <Card>
      <CardHeader className='pb-3'>
        <div className='flex items-center gap-3'>
          <DeviceIcon
            model={device.model}
            productName={device.product_name}
            size={28}
          />
          <div>
            <CardTitle className='text-base'>
              {device.device_name || 'Unnamed Device'}
            </CardTitle>
            <p className='text-muted-foreground text-xs'>{device.model}</p>
          </div>
          <div className='ml-auto'>
            <DeviceStatusDot status={device.status as DeviceStatus} showLabel />
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' className='flex-1 text-xs'>
            Lock
          </Button>
          <Button variant='outline' size='sm' className='flex-1 text-xs'>
            Locate
          </Button>
          <Button variant='outline' size='sm' className='flex-1 text-xs'>
            Info
          </Button>
        </div>

        <Section title='General'>
          <Detail label='Serial Number' value={device.serial_number} />
          <Detail label='UDID' value={device.udid} />
          <Detail label='Enrollment' value={device.enrollment_type} />
          <Detail label='Supervised' value={device.supervised ? 'Yes' : 'No'} />
          <Detail
            label='MDM Profile'
            value={device.mdm_profile_installed ? 'Installed' : 'Not Installed'}
          />
        </Section>

        <Section title='Hardware'>
          <Detail
            label='OS Version'
            value={
              device.os_version
                ? `${device.product_name} ${device.os_version}`
                : null
            }
          />
          <Detail
            label='Battery'
            value={
              device.battery_level != null
                ? `${device.battery_level}% (${device.battery_health || 'Unknown'})`
                : null
            }
          />
          <Detail
            label='Battery Cycles'
            value={
              device.battery_cycle_count != null
                ? String(device.battery_cycle_count)
                : null
            }
          />
          {storageUsedPct !== null && (
            <>
              <Detail
                label='Storage'
                value={`${storageUsedGB} / ${storageTotalGB} GB (${storageUsedPct}%)`}
              />
              <div className='mt-1'>
                <div className='bg-muted h-2 w-full rounded-full'>
                  <div
                    className={`h-2 rounded-full ${storageUsedPct > 90 ? 'bg-red-500' : storageUsedPct > 75 ? 'bg-amber-500' : 'bg-green-500'}`}
                    style={{ width: `${storageUsedPct}%` }}
                  />
                </div>
              </div>
            </>
          )}
        </Section>

        <Section title='Network'>
          <Detail label='IP Address' value={device.ip_address} />
          <Detail label='WiFi MAC' value={device.wifi_mac} />
          <Detail label='Carrier' value={device.carrier} />
          <Detail label='Roaming' value={device.is_roaming ? 'Yes' : 'No'} />
        </Section>

        <Section title='Security'>
          <Detail
            label='Passcode'
            value={
              device.passcode_compliant === true
                ? 'Compliant'
                : device.passcode_compliant === false
                  ? 'Non-Compliant'
                  : 'Unknown'
            }
          />
          <Detail
            label='Encrypted'
            value={
              device.encrypted === true
                ? 'Yes'
                : device.encrypted === false
                  ? 'No'
                  : 'Unknown'
            }
          />
          <Detail
            label='Activation Lock'
            value={device.activation_lock_enabled ? 'Enabled' : 'Disabled'}
          />
          <Detail
            label='Health Score'
            value={
              device.health_score != null ? `${device.health_score}/100` : null
            }
          />
        </Section>
      </CardContent>
    </Card>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h4 className='text-muted-foreground mb-2 border-b pb-1 text-xs font-semibold uppercase'>
        {title}
      </h4>
      <div className='space-y-1.5'>{children}</div>
    </div>
  )
}

function Detail({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className='flex items-center justify-between gap-2'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <span className='text-right text-xs font-medium'>{value || '—'}</span>
    </div>
  )
}
