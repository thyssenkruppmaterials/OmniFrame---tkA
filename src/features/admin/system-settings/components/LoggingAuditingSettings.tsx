import { useState } from 'react'
import {
  IconClipboardList,
  IconDownload,
  IconEye,
  IconShield,
  IconTrash,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

export function LoggingAuditingSettings() {
  const [settings, setSettings] = useState({
    auditLogging: true,
    systemLogging: true,
    securityLogging: true,
    accessLogging: true,
    errorLogging: true,
    performanceLogging: false,
    debugLogging: false,
    logLevel: 'info',
    logRetention: 90,
    maxLogSize: 100,
    compressLogs: true,
    encryptLogs: false,
    realTimeAlerts: true,
    alertThreshold: 50,
    exportEnabled: true,
    logFormat: 'json',
  })

  const [auditCategories, setAuditCategories] = useState({
    userActions: { enabled: true, retention: 365 },
    dataChanges: { enabled: true, retention: 365 },
    systemEvents: { enabled: true, retention: 180 },
    securityEvents: { enabled: true, retention: 730 },
    apiAccess: { enabled: true, retention: 90 },
    adminActions: { enabled: true, retention: 1095 },
  })

  const [logStats, setLogStats] = useState({
    totalLogs: 1247893,
    todayLogs: 4521,
    errorCount: 23,
    warningCount: 156,
    diskUsage: 2.4,
    oldestLog: '2024-07-01',
    newestLog: '2024-09-26',
  })

  const handleSettingChange = (
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleCategoryChange = (
    category: keyof typeof auditCategories,
    field: string,
    value: string | number | boolean
  ) => {
    setAuditCategories((prev) => ({
      ...prev,
      [category]: { ...prev[category], [field]: value },
    }))
  }

  const exportLogs = (format: string) => {
    toast.loading(`Exporting logs in ${format.toUpperCase()} format...`, {
      id: 'export',
    })

    setTimeout(() => {
      toast.success(`Logs exported successfully! Download started.`, {
        id: 'export',
      })
    }, 2000)
  }

  const purgeLogs = () => {
    toast.loading('Purging old log files...', { id: 'purge' })

    setTimeout(() => {
      setLogStats((prev) => ({
        ...prev,
        totalLogs: prev.totalLogs - 50000,
        diskUsage: prev.diskUsage * 0.8,
        oldestLog: '2024-08-01',
      }))
      toast.success('Old logs purged successfully!', { id: 'purge' })
    }, 3000)
  }

  const runAuditReport = () => {
    toast.loading('Generating comprehensive audit report...', {
      id: 'audit-report',
    })

    setTimeout(() => {
      toast.success('Audit report generated and saved to exports/', {
        id: 'audit-report',
      })
    }, 4000)
  }

  const saveSettings = () => {
    localStorage.setItem(
      'logging-settings',
      JSON.stringify({ settings, auditCategories })
    )
    toast.success('Logging settings saved successfully!')
  }

  const getDiskUsageColor = () => {
    if (logStats.diskUsage >= 8) return 'text-red-500'
    if (logStats.diskUsage >= 5) return 'text-yellow-500'
    return 'text-green-500'
  }

  const getLogLevelBadgeVariant = (level: string) => {
    switch (level) {
      case 'error':
        return 'destructive'
      case 'warn':
        return 'default'
      case 'info':
        return 'secondary'
      case 'debug':
        return 'outline'
      default:
        return 'secondary'
    }
  }

  return (
    <div className='space-y-6'>
      {/* Logging Overview */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconClipboardList size={20} />
            Logging Overview
          </CardTitle>
          <CardDescription>
            Current logging status and system metrics.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-4'>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Total Logs
              </Label>
              <div className='text-lg font-semibold'>
                {logStats.totalLogs.toLocaleString()}
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>Today</Label>
              <div className='text-lg font-semibold text-blue-600'>
                {logStats.todayLogs.toLocaleString()}
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Errors Today
              </Label>
              <div className='text-lg font-semibold text-red-600'>
                {logStats.errorCount}
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Disk Usage
              </Label>
              <div className={`text-lg font-semibold ${getDiskUsageColor()}`}>
                {logStats.diskUsage}GB
              </div>
            </div>
          </div>

          <div className='space-y-2'>
            <div className='flex justify-between text-sm'>
              <span>Storage Usage</span>
              <span>
                {((logStats.diskUsage / 10) * 100).toFixed(1)}% of 10GB limit
              </span>
            </div>
            <Progress value={(logStats.diskUsage / 10) * 100} />
          </div>
        </CardContent>
      </Card>

      {/* General Logging Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconEye size={20} />
            Logging Configuration
          </CardTitle>
          <CardDescription>
            Configure general logging behavior and retention policies.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Log Level</Label>
              <Select
                value={settings.logLevel}
                onValueChange={(value) =>
                  handleSettingChange('logLevel', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='error'>Error</SelectItem>
                  <SelectItem value='warn'>Warning</SelectItem>
                  <SelectItem value='info'>Info</SelectItem>
                  <SelectItem value='debug'>Debug</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label>Log Format</Label>
              <Select
                value={settings.logFormat}
                onValueChange={(value) =>
                  handleSettingChange('logFormat', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='json'>JSON</SelectItem>
                  <SelectItem value='text'>Plain Text</SelectItem>
                  <SelectItem value='combined'>Combined</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Log Retention (days)</Label>
              <Input
                type='number'
                value={settings.logRetention}
                onChange={(e) =>
                  handleSettingChange('logRetention', parseInt(e.target.value))
                }
                min={1}
                max={3650}
              />
            </div>

            <div className='space-y-2'>
              <Label>Max Log File Size (MB)</Label>
              <Input
                type='number'
                value={settings.maxLogSize}
                onChange={(e) =>
                  handleSettingChange('maxLogSize', parseInt(e.target.value))
                }
                min={10}
                max={1000}
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-3'>
            {[
              { key: 'compressLogs', label: 'Compress Old Logs' },
              { key: 'encryptLogs', label: 'Encrypt Log Files' },
              { key: 'realTimeAlerts', label: 'Real-time Alerts' },
            ].map((option) => (
              <div key={option.key} className='flex items-center space-x-2'>
                <Switch
                  checked={
                    settings[option.key as keyof typeof settings] as boolean
                  }
                  onCheckedChange={(checked) =>
                    handleSettingChange(
                      option.key as keyof typeof settings,
                      checked
                    )
                  }
                />
                <Label className='text-sm'>{option.label}</Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Log Categories */}
      <Card>
        <CardHeader>
          <CardTitle>Log Categories</CardTitle>
          <CardDescription>
            Configure which types of events are logged and their retention
            periods.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
            {[
              {
                key: 'systemLogging',
                label: 'System Events',
                description: 'Application lifecycle, startup, shutdown',
              },
              {
                key: 'securityLogging',
                label: 'Security Events',
                description: 'Authentication, authorization, security alerts',
              },
              {
                key: 'accessLogging',
                label: 'Access Logs',
                description: 'HTTP requests, API calls, page views',
              },
              {
                key: 'errorLogging',
                label: 'Error Logs',
                description: 'Application errors, exceptions, crashes',
              },
              {
                key: 'performanceLogging',
                label: 'Performance Logs',
                description: 'Response times, resource usage',
              },
              {
                key: 'debugLogging',
                label: 'Debug Logs',
                description: 'Detailed diagnostic information',
              },
            ].map((category) => (
              <div
                key={category.key}
                className='space-y-3 rounded-lg border p-4'
              >
                <div className='flex items-center justify-between'>
                  <div className='space-y-1'>
                    <Label className='text-sm font-medium'>
                      {category.label}
                    </Label>
                    <p className='text-muted-foreground text-xs'>
                      {category.description}
                    </p>
                  </div>
                  <Switch
                    checked={
                      settings[category.key as keyof typeof settings] as boolean
                    }
                    onCheckedChange={(checked) =>
                      handleSettingChange(category.key, checked)
                    }
                  />
                </div>
                <Badge variant={getLogLevelBadgeVariant(settings.logLevel)}>
                  {settings.logLevel.toUpperCase()}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Audit Trail Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconShield size={20} />
            Audit Trail Configuration
          </CardTitle>
          <CardDescription>
            Configure audit logging for compliance and security monitoring.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Enable Audit Logging
              </Label>
              <p className='text-muted-foreground text-xs'>
                Track all user actions for compliance
              </p>
            </div>
            <Switch
              checked={settings.auditLogging}
              onCheckedChange={(checked) =>
                handleSettingChange('auditLogging', checked)
              }
            />
          </div>

          {settings.auditLogging && (
            <>
              <Separator />

              <div className='space-y-4'>
                <Label className='text-sm font-medium'>Audit Categories</Label>

                {Object.entries(auditCategories).map(
                  ([categoryKey, category]) => (
                    <div
                      key={categoryKey}
                      className='flex items-center justify-between rounded-lg border p-3'
                    >
                      <div className='space-y-1'>
                        <Label className='text-sm font-medium capitalize'>
                          {categoryKey.replace(/([A-Z])/g, ' $1').trim()}
                        </Label>
                        <p className='text-muted-foreground text-xs'>
                          Retention: {category.retention} days
                        </p>
                      </div>
                      <div className='flex items-center gap-4'>
                        <Input
                          type='number'
                          value={category.retention}
                          onChange={(e) =>
                            handleCategoryChange(
                              categoryKey as keyof typeof auditCategories,
                              'retention',
                              parseInt(e.target.value)
                            )
                          }
                          className='w-20'
                          min={30}
                          max={3650}
                        />
                        <Switch
                          checked={category.enabled}
                          onCheckedChange={(checked) =>
                            handleCategoryChange(
                              categoryKey as keyof typeof auditCategories,
                              'enabled',
                              checked
                            )
                          }
                        />
                      </div>
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Log Management Actions */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconDownload size={20} />
            Log Management
          </CardTitle>
          <CardDescription>
            Export, analyze, and manage log files.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2 md:grid-cols-4'>
            <Button variant='outline' onClick={() => exportLogs('csv')}>
              Export CSV
            </Button>
            <Button variant='outline' onClick={() => exportLogs('json')}>
              Export JSON
            </Button>
            <Button variant='outline' onClick={runAuditReport}>
              Audit Report
            </Button>
            <Button variant='outline' onClick={purgeLogs}>
              <IconTrash size={16} className='mr-1' />
              Purge Old Logs
            </Button>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Log Date Range</Label>
              <div className='text-muted-foreground text-sm'>
                {logStats.oldestLog} to {logStats.newestLog}
              </div>
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Export Options</Label>
              <div className='flex items-center space-x-2'>
                <Switch
                  checked={settings.exportEnabled}
                  onCheckedChange={(checked) =>
                    handleSettingChange('exportEnabled', checked)
                  }
                />
                <Label className='text-sm'>Allow log exports</Label>
              </div>
            </div>
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
