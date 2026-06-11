// Created and developed by Jai Singh
import {
  IconDeviceMobile,
  IconWifi,
  IconWifiOff,
  IconShieldCheck,
  IconCommand,
  IconAlertTriangle,
  IconCheckbox,
} from '@tabler/icons-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useFleetStatistics } from '../../hooks/use-device-inventory'
import { DeviceStatusDot } from '../shared/device-status-dot'

export function FleetOverviewTab() {
  const { data: stats, isLoading, error } = useFleetStatistics()

  if (error) {
    return (
      <Card>
        <CardContent className='py-8 text-center'>
          <p className='text-destructive text-sm'>
            Failed to load fleet statistics
          </p>
          <p className='text-muted-foreground mt-1 text-xs'>{String(error)}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-6'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'>
        <KpiCard
          title='Total Devices'
          value={isLoading ? '...' : String(stats?.total_devices ?? 0)}
          icon={<IconDeviceMobile className='h-4 w-4' />}
          loading={isLoading}
        />
        <KpiCard
          title='Online'
          value={isLoading ? '...' : String(stats?.online_devices ?? 0)}
          icon={<IconWifi className='h-4 w-4 text-green-500' />}
          accent='text-green-600 dark:text-green-400'
          loading={isLoading}
        />
        <KpiCard
          title='Offline'
          value={isLoading ? '...' : String(stats?.offline_devices ?? 0)}
          icon={<IconWifiOff className='h-4 w-4 text-gray-400' />}
          loading={isLoading}
        />
        <KpiCard
          title='Supervised'
          value={isLoading ? '...' : String(stats?.supervised_devices ?? 0)}
          icon={<IconShieldCheck className='h-4 w-4 text-blue-500' />}
          loading={isLoading}
        />
        <KpiCard
          title='Compliance'
          value={isLoading ? '...' : `${stats?.compliance_rate ?? 100}%`}
          icon={<IconCheckbox className='h-4 w-4 text-green-500' />}
          accent='text-green-600 dark:text-green-400'
          loading={isLoading}
        />
        <KpiCard
          title='Pending Cmds'
          value={isLoading ? '...' : String(stats?.pending_commands ?? 0)}
          icon={<IconCommand className='h-4 w-4 text-amber-500' />}
          loading={isLoading}
        />
      </div>

      <div className='grid gap-6 lg:grid-cols-3'>
        <Card className='lg:col-span-2'>
          <CardHeader>
            <CardTitle className='text-base'>Fleet Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className='space-y-3'>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className='bg-muted/30 h-12 animate-pulse rounded-lg'
                  />
                ))}
              </div>
            ) : (
              <div className='space-y-4'>
                <SummaryRow
                  label='Active Incidents'
                  value={stats?.active_incidents ?? 0}
                  warn={
                    stats?.active_incidents ? stats.active_incidents > 0 : false
                  }
                />
                <SummaryRow
                  label='Pending Approvals'
                  value={stats?.pending_approvals ?? 0}
                  warn={
                    stats?.pending_approvals
                      ? stats.pending_approvals > 0
                      : false
                  }
                />
                <SummaryRow
                  label='Avg Health Score'
                  value={stats?.average_health_score ?? 0}
                  suffix='/100'
                />
                <SummaryRow
                  label='Pending Devices'
                  value={stats?.pending_devices ?? 0}
                />
                <SummaryRow
                  label='Lost Devices'
                  value={stats?.lost_devices ?? 0}
                  warn={stats?.lost_devices ? stats.lost_devices > 0 : false}
                />

                <div className='border-t pt-4'>
                  <h4 className='text-muted-foreground mb-2 text-xs font-medium uppercase'>
                    Status Breakdown
                  </h4>
                  <div className='flex flex-wrap gap-4'>
                    <StatusChip
                      status='Online'
                      count={stats?.online_devices ?? 0}
                    />
                    <StatusChip
                      status='Offline'
                      count={stats?.offline_devices ?? 0}
                    />
                    <StatusChip
                      status='Pending'
                      count={stats?.pending_devices ?? 0}
                    />
                    <StatusChip
                      status='Lost'
                      count={stats?.lost_devices ?? 0}
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              <ActionItem
                label='Enroll New Device'
                description='Add a device via manual registration or MDM profile'
              />
              <ActionItem
                label='Run Inventory Sync'
                description='Query all devices for latest hardware info'
              />
              <ActionItem
                label='Compliance Check'
                description='Evaluate all devices against active policies'
              />
              <ActionItem
                label='Export Fleet Report'
                description='Download CSV of all managed devices'
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function KpiCard({
  title,
  value,
  icon,
  accent,
  loading,
}: {
  title: string
  value: string
  icon: React.ReactNode
  accent?: string
  loading?: boolean
}) {
  return (
    <Card>
      <CardContent className='pt-6'>
        <div className='flex items-center justify-between'>
          <p className='text-muted-foreground text-sm font-medium'>{title}</p>
          {icon}
        </div>
        <div className={`mt-2 text-2xl font-bold ${accent || ''}`}>
          {loading ? (
            <div className='bg-muted/50 h-8 w-16 animate-pulse rounded' />
          ) : (
            value
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryRow({
  label,
  value,
  suffix,
  warn,
}: {
  label: string
  value: number
  suffix?: string
  warn?: boolean
}) {
  return (
    <div className='flex items-center justify-between'>
      <div className='flex items-center gap-2'>
        {warn && <IconAlertTriangle className='h-4 w-4 text-amber-500' />}
        <span className='text-sm'>{label}</span>
      </div>
      <span
        className={`text-sm font-semibold ${warn ? 'text-amber-600 dark:text-amber-400' : ''}`}
      >
        {value}
        {suffix || ''}
      </span>
    </div>
  )
}

function StatusChip({
  status,
  count,
}: {
  status: 'Online' | 'Offline' | 'Pending' | 'Lost'
  count: number
}) {
  return (
    <div className='flex items-center gap-1.5 rounded-full border px-3 py-1'>
      <DeviceStatusDot status={status} size='sm' />
      <span className='text-xs font-medium'>{status}</span>
      <span className='text-muted-foreground text-xs'>({count})</span>
    </div>
  )
}

function ActionItem({
  label,
  description,
}: {
  label: string
  description: string
}) {
  return (
    <button className='hover:bg-muted/50 w-full rounded-lg border px-3 py-2.5 text-left transition-colors'>
      <p className='text-sm font-medium'>{label}</p>
      <p className='text-muted-foreground text-xs'>{description}</p>
    </button>
  )
}

// Created and developed by Jai Singh
