// Created and developed by Jai Singh
import { useState } from 'react'
import {
  IconDatabase,
  IconRefresh,
  IconTool,
  IconTrash,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export function SystemMaintenanceSettings() {
  const [settings, setSettings] = useState({
    maintenanceMode: false,
    maintenanceMessage:
      'System is currently under maintenance. Please check back later.',
    autoMaintenance: true,
    maintenanceWindow: '02:00-04:00',
    maintenanceDay: 'Sunday',
    backupEnabled: true,
    backupFrequency: 'daily',
    backupRetention: 30,
    cleanupEnabled: true,
    logRetention: 90,
    tempFileCleanup: true,
    cacheCleanup: true,
    systemHealthCheck: true,
    healthCheckInterval: 5,
    diskSpaceThreshold: 85,
    memoryThreshold: 80,
  })

  const [systemStatus, setSystemStatus] = useState({
    diskUsage: 65,
    memoryUsage: 45,
    cpuUsage: 25,
    lastMaintenance: '2024-09-20T02:30:00Z',
    nextMaintenance: '2024-09-27T02:00:00Z',
    uptime: '15 days, 3 hours',
  })

  const handleSettingChange = (
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const toggleMaintenanceMode = (enabled: boolean) => {
    handleSettingChange('maintenanceMode', enabled)
    if (enabled) {
      toast.warning('System maintenance mode enabled')
    } else {
      toast.success('System maintenance mode disabled')
    }
  }

  const runMaintenance = () => {
    toast.loading('Running system maintenance...', { id: 'maintenance' })

    setTimeout(() => {
      setSystemStatus((prev) => ({
        ...prev,
        lastMaintenance: new Date().toISOString(),
        diskUsage: Math.max(prev.diskUsage - 10, 20),
        memoryUsage: Math.max(prev.memoryUsage - 15, 15),
      }))
      toast.success('System maintenance completed successfully!', {
        id: 'maintenance',
      })
    }, 3000)
  }

  const clearCache = () => {
    toast.loading('Clearing system cache...', { id: 'cache' })

    setTimeout(() => {
      toast.success('System cache cleared successfully!', { id: 'cache' })
    }, 1500)
  }

  const cleanupLogs = () => {
    toast.loading('Cleaning up old log files...', { id: 'logs' })

    setTimeout(() => {
      toast.success('Log files cleaned up successfully!', { id: 'logs' })
    }, 2000)
  }

  const saveSettings = () => {
    localStorage.setItem('maintenance-settings', JSON.stringify(settings))
    toast.success('Maintenance settings saved successfully!')
  }

  const getStatusColor = (usage: number, threshold: number) => {
    if (usage >= threshold) return 'text-red-500'
    if (usage >= threshold * 0.8) return 'text-yellow-500'
    return 'text-green-500'
  }

  return (
    <div className='space-y-6'>
      {/* System Status */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconTool size={20} />
            System Status
          </CardTitle>
          <CardDescription>
            Current system health and resource usage.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-3'>
            <div className='space-y-2 text-center'>
              <Label className='text-sm font-medium'>Disk Usage</Label>
              <div
                className={`text-2xl font-bold ${getStatusColor(systemStatus.diskUsage, settings.diskSpaceThreshold)}`}
              >
                {systemStatus.diskUsage}%
              </div>
              <div className='bg-secondary h-2 w-full rounded-full'>
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    systemStatus.diskUsage >= settings.diskSpaceThreshold
                      ? 'bg-red-500'
                      : systemStatus.diskUsage >=
                          settings.diskSpaceThreshold * 0.8
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                  }`}
                  style={{ width: `${systemStatus.diskUsage}%` }}
                />
              </div>
            </div>

            <div className='space-y-2 text-center'>
              <Label className='text-sm font-medium'>Memory Usage</Label>
              <div
                className={`text-2xl font-bold ${getStatusColor(systemStatus.memoryUsage, settings.memoryThreshold)}`}
              >
                {systemStatus.memoryUsage}%
              </div>
              <div className='bg-secondary h-2 w-full rounded-full'>
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    systemStatus.memoryUsage >= settings.memoryThreshold
                      ? 'bg-red-500'
                      : systemStatus.memoryUsage >=
                          settings.memoryThreshold * 0.8
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                  }`}
                  style={{ width: `${systemStatus.memoryUsage}%` }}
                />
              </div>
            </div>

            <div className='space-y-2 text-center'>
              <Label className='text-sm font-medium'>CPU Usage</Label>
              <div className='text-2xl font-bold text-blue-500'>
                {systemStatus.cpuUsage}%
              </div>
              <div className='bg-secondary h-2 w-full rounded-full'>
                <div
                  className='h-2 rounded-full bg-blue-500 transition-all duration-300'
                  style={{ width: `${systemStatus.cpuUsage}%` }}
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>System Uptime</Label>
              <p className='text-lg font-semibold'>{systemStatus.uptime}</p>
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Last Maintenance</Label>
              <p className='text-lg font-semibold'>
                {new Date(systemStatus.lastMaintenance).toLocaleDateString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Maintenance Mode */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconRefresh size={20} />
            Maintenance Mode
          </CardTitle>
          <CardDescription>
            Control system maintenance mode and user access.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Enable Maintenance Mode
              </Label>
              <p className='text-muted-foreground text-xs'>
                Block user access with maintenance message
              </p>
            </div>
            <Switch
              checked={settings.maintenanceMode}
              onCheckedChange={toggleMaintenanceMode}
            />
          </div>

          {settings.maintenanceMode && (
            <div className='space-y-2'>
              <Label>Maintenance Message</Label>
              <Textarea
                value={settings.maintenanceMessage}
                onChange={(e) =>
                  handleSettingChange('maintenanceMessage', e.target.value)
                }
                rows={3}
                placeholder='Enter message to display to users during maintenance...'
              />
            </div>
          )}

          <Separator />

          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Scheduled Maintenance
              </Label>
              <p className='text-muted-foreground text-xs'>
                Automatically enter maintenance mode during scheduled windows
              </p>
            </div>
            <Switch
              checked={settings.autoMaintenance}
              onCheckedChange={(checked) =>
                handleSettingChange('autoMaintenance', checked)
              }
            />
          </div>

          {settings.autoMaintenance && (
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label>Maintenance Day</Label>
                <Select
                  value={settings.maintenanceDay}
                  onValueChange={(value) =>
                    handleSettingChange('maintenanceDay', value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='Sunday'>Sunday</SelectItem>
                    <SelectItem value='Monday'>Monday</SelectItem>
                    <SelectItem value='Tuesday'>Tuesday</SelectItem>
                    <SelectItem value='Wednesday'>Wednesday</SelectItem>
                    <SelectItem value='Thursday'>Thursday</SelectItem>
                    <SelectItem value='Friday'>Friday</SelectItem>
                    <SelectItem value='Saturday'>Saturday</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-2'>
                <Label>Maintenance Window</Label>
                <Input
                  value={settings.maintenanceWindow}
                  onChange={(e) =>
                    handleSettingChange('maintenanceWindow', e.target.value)
                  }
                  placeholder='02:00-04:00'
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cleanup Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconTrash size={20} />
            System Cleanup
          </CardTitle>
          <CardDescription>
            Configure automatic cleanup of logs, cache, and temporary files.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center space-x-2'>
            <Switch
              checked={settings.cleanupEnabled}
              onCheckedChange={(checked) =>
                handleSettingChange('cleanupEnabled', checked)
              }
            />
            <Label className='text-sm'>Enable Automatic Cleanup</Label>
          </div>

          {settings.cleanupEnabled && (
            <>
              <Separator />

              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label>Log Retention (days)</Label>
                  <Input
                    type='number'
                    value={settings.logRetention}
                    onChange={(e) =>
                      handleSettingChange(
                        'logRetention',
                        parseInt(e.target.value)
                      )
                    }
                    min={1}
                    max={365}
                  />
                </div>

                <div className='space-y-2'>
                  <Label>Backup Retention (days)</Label>
                  <Input
                    type='number'
                    value={settings.backupRetention}
                    onChange={(e) =>
                      handleSettingChange(
                        'backupRetention',
                        parseInt(e.target.value)
                      )
                    }
                    min={1}
                    max={365}
                  />
                </div>
              </div>

              <div className='grid gap-4 md:grid-cols-2'>
                <div className='flex items-center space-x-2'>
                  <Switch
                    checked={settings.tempFileCleanup}
                    onCheckedChange={(checked) =>
                      handleSettingChange('tempFileCleanup', checked)
                    }
                  />
                  <Label className='text-sm'>Clean Temporary Files</Label>
                </div>

                <div className='flex items-center space-x-2'>
                  <Switch
                    checked={settings.cacheCleanup}
                    onCheckedChange={(checked) =>
                      handleSettingChange('cacheCleanup', checked)
                    }
                  />
                  <Label className='text-sm'>Clean Application Cache</Label>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Manual Actions */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconDatabase size={20} />
            Manual Maintenance Actions
          </CardTitle>
          <CardDescription>
            Perform immediate maintenance tasks and system operations.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2 md:grid-cols-3'>
            <Button variant='outline' onClick={runMaintenance}>
              Run Full Maintenance
            </Button>
            <Button variant='outline' onClick={clearCache}>
              Clear System Cache
            </Button>
            <Button variant='outline' onClick={cleanupLogs}>
              Cleanup Log Files
            </Button>
          </div>

          <div className='text-muted-foreground text-xs'>
            <p>
              Next scheduled maintenance:{' '}
              {new Date(systemStatus.nextMaintenance).toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className='flex justify-end space-x-2'>
        <Button variant='outline'>Reset to Defaults</Button>
        <Button onClick={saveSettings}>Save Settings</Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
