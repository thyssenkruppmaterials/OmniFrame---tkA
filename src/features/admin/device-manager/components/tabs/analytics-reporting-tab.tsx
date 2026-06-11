// Created and developed by Jai Singh
import { useState } from 'react'
import { IconDownload } from '@tabler/icons-react'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useFleetStatistics } from '../../hooks/use-device-inventory'
import { useCommandMetrics } from '../../hooks/use-mdm-commands'

const STATUS_COLORS: Record<string, string> = {
  Online: '#22c55e',
  Offline: '#9ca3af',
  Pending: '#eab308',
  Lost: '#ef4444',
  Supervised: '#3b82f6',
}

export function AnalyticsReportingTab() {
  const [days, setDays] = useState(7)
  const { data: stats, isLoading: loadingStats } = useFleetStatistics()
  const { data: cmdMetrics, isLoading: loadingCmds } = useCommandMetrics(days)

  const statusData = stats
    ? [
        { name: 'Online', value: stats.online_devices || 0 },
        { name: 'Offline', value: stats.offline_devices || 0 },
        { name: 'Pending', value: stats.pending_devices || 0 },
        { name: 'Lost', value: stats.lost_devices || 0 },
      ].filter((d) => d.value > 0)
    : []

  const commandTypeData = cmdMetrics?.by_type
    ? Object.entries(cmdMetrics.by_type as Record<string, number>).map(
        ([name, value]) => ({ name, value })
      )
    : []

  const commandSummaryData = cmdMetrics
    ? [
        { name: 'Completed', value: cmdMetrics.completed || 0 },
        { name: 'Failed', value: cmdMetrics.failed || 0 },
        { name: 'Pending', value: cmdMetrics.pending || 0 },
        { name: 'Expired', value: cmdMetrics.expired || 0 },
      ].filter((d) => d.value > 0)
    : []

  const handleExportCSV = () => {
    if (!stats) return
    const headers = ['Metric,Value']
    const rows = [
      `Total Devices,${stats.total_devices}`,
      `Online,${stats.online_devices}`,
      `Offline,${stats.offline_devices}`,
      `Supervised,${stats.supervised_devices}`,
      `Compliance Rate,${stats.compliance_rate}%`,
      `Avg Health Score,${stats.average_health_score}`,
      `Pending Commands,${stats.pending_commands}`,
      `Active Incidents,${stats.active_incidents}`,
    ]
    const csv = [...headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet-report-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div className='flex gap-1'>
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              variant={days === d ? 'default' : 'outline'}
              size='sm'
              className='h-7 text-xs'
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={handleExportCSV}
          disabled={!stats}
        >
          <IconDownload className='mr-1 h-4 w-4' />
          Export CSV
        </Button>
      </div>

      <div className='grid gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>
              Device Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingStats || statusData.length === 0 ? (
              <div className='flex h-56 items-center justify-center'>
                <p className='text-muted-foreground text-sm'>
                  {loadingStats ? 'Loading...' : 'No device data'}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width='100%' height={240}>
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey='value'
                    nameKey='name'
                    cx='50%'
                    cy='50%'
                    outerRadius={80}
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {statusData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={STATUS_COLORS[entry.name] || '#8884d8'}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>
              Command Results ({days}d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCmds || commandSummaryData.length === 0 ? (
              <div className='flex h-56 items-center justify-center'>
                <p className='text-muted-foreground text-sm'>
                  {loadingCmds ? 'Loading...' : 'No command data'}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width='100%' height={240}>
                <BarChart data={commandSummaryData}>
                  <CartesianGrid
                    strokeDasharray='3 3'
                    className='stroke-muted'
                  />
                  <XAxis dataKey='name' tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey='value' fill='#6366f1' radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className='lg:col-span-2'>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>
              Commands by Type ({days}d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCmds || commandTypeData.length === 0 ? (
              <div className='flex h-48 items-center justify-center'>
                <p className='text-muted-foreground text-sm'>
                  {loadingCmds ? 'Loading...' : 'No command type data'}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width='100%' height={200}>
                <BarChart data={commandTypeData} layout='vertical'>
                  <CartesianGrid
                    strokeDasharray='3 3'
                    className='stroke-muted'
                  />
                  <XAxis type='number' tick={{ fontSize: 11 }} />
                  <YAxis
                    dataKey='name'
                    type='category'
                    tick={{ fontSize: 10 }}
                    width={140}
                  />
                  <Tooltip />
                  <Bar dataKey='value' fill='#8b5cf6' radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
