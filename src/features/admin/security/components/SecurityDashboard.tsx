import { useState } from 'react'
import {
  IconAlertTriangle,
  IconDownload,
  IconRefresh,
  IconSettings,
  IconShield,
} from '@tabler/icons-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSecurityMonitoring } from '../hooks/use-security-monitoring'
import { ActiveThreats } from './ActiveThreats'
import { SecurityAlerts } from './SecurityAlerts'
import { SecurityMetrics } from './SecurityMetrics'
import { SecurityTimeline } from './SecurityTimeline'
import { ThreatMonitor } from './ThreatMonitor'

export function SecurityDashboard() {
  const [selectedTimeRange, setSelectedTimeRange] = useState(30)
  const { metrics, alerts, threats, isLoading, error } =
    useSecurityMonitoring(selectedTimeRange)

  const handleRefresh = () => {
    window.location.reload()
  }

  const timeRangeOptions = [
    { label: '24h', value: 1 },
    { label: '7d', value: 7 },
    { label: '30d', value: 30 },
    { label: '90d', value: 90 },
  ]

  if (error) {
    return (
      <div className='space-y-6'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center space-x-2'>
            <IconShield className='h-8 w-8 text-red-500' />
            <h1 className='text-3xl font-bold'>Security Dashboard</h1>
          </div>
        </div>
        <Alert variant='destructive'>
          <IconAlertTriangle className='h-4 w-4' />
          <AlertDescription>
            Failed to load security data. Please check your permissions and try
            again.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-2'>
          <IconShield className='h-8 w-8 text-blue-600' />
          <h1 className='text-3xl font-bold'>Security Dashboard</h1>
          {isLoading && (
            <Badge variant='secondary' className='ml-2'>
              Loading...
            </Badge>
          )}
        </div>
        <div className='flex items-center space-x-2'>
          {/* Time Range Selector */}
          <div className='flex items-center space-x-1 rounded-md border p-1'>
            {timeRangeOptions.map((option) => (
              <Button
                key={option.value}
                variant={
                  selectedTimeRange === option.value ? 'default' : 'ghost'
                }
                size='sm'
                onClick={() => setSelectedTimeRange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <Button variant='outline' size='sm' onClick={handleRefresh}>
            <IconRefresh className='mr-1 h-4 w-4' />
            Refresh
          </Button>

          <Button variant='outline' size='sm'>
            <IconDownload className='mr-1 h-4 w-4' />
            Export
          </Button>

          <Button variant='outline' size='sm'>
            <IconSettings className='mr-1 h-4 w-4' />
            Settings
          </Button>
        </div>
      </div>

      {/* Security Metrics Overview */}
      <SecurityMetrics metrics={metrics} isLoading={isLoading} />

      {/* Main Dashboard Tabs */}
      <Tabs defaultValue='overview' className='space-y-4'>
        <TabsList className='grid w-full grid-cols-5'>
          <TabsTrigger value='overview'>Overview</TabsTrigger>
          <TabsTrigger value='alerts'>
            Alerts
            {alerts.length > 0 && (
              <Badge variant='destructive' className='ml-2 h-5 w-5 p-0 text-xs'>
                {alerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value='threats'>
            Threats
            {threats.length > 0 && (
              <Badge variant='secondary' className='ml-2 h-5 w-5 p-0 text-xs'>
                {threats.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value='timeline'>Timeline</TabsTrigger>
          <TabsTrigger value='monitoring'>Monitoring</TabsTrigger>
        </TabsList>

        <TabsContent value='overview' className='space-y-4'>
          <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
            {/* Recent Alerts */}
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center'>
                  <IconAlertTriangle className='mr-2 h-5 w-5 text-orange-500' />
                  Recent Security Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SecurityAlerts
                  alerts={alerts.slice(0, 5)}
                  isLoading={isLoading}
                />
              </CardContent>
            </Card>

            {/* Active Threats */}
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center'>
                  <IconShield className='mr-2 h-5 w-5 text-red-500' />
                  Active Threats
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ActiveThreats
                  threats={threats.slice(0, 5)}
                  isLoading={isLoading}
                />
              </CardContent>
            </Card>
          </div>

          {/* Security Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Security Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <SecurityTimeline />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='alerts'>
          <Card>
            <CardHeader>
              <CardTitle>Security Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <SecurityAlerts
                alerts={alerts}
                isLoading={isLoading}
                showFilters
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='threats'>
          <Card>
            <CardHeader>
              <CardTitle>Threat Indicators</CardTitle>
            </CardHeader>
            <CardContent>
              <ActiveThreats
                threats={threats}
                isLoading={isLoading}
                showActions
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='timeline'>
          <Card>
            <CardHeader>
              <CardTitle>Security Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <SecurityTimeline expanded />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='monitoring'>
          <Card>
            <CardHeader>
              <CardTitle>Real-time Threat Monitoring</CardTitle>
            </CardHeader>
            <CardContent>
              <ThreatMonitor />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
