import { useState } from 'react'
import {
  IconClock,
  IconCloudDownload,
  IconDatabase,
  IconRefresh,
  IconShield,
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

export function BackupRecoverySettings() {
  const [settings, setSettings] = useState({
    autoBackupEnabled: true,
    backupFrequency: 'daily',
    backupTime: '02:00',
    backupRetention: 30,
    compressionEnabled: true,
    encryptionEnabled: true,
    storageLocation: 'local',
    cloudProvider: 'aws',
    awsAccessKey: '',
    awsSecretKey: '',
    awsBucket: '',
    incrementalBackups: true,
    verifyBackups: true,
    alertsEnabled: true,
    alertEmail: 'admin@company.com',
  })

  const [backupHistory, setBackupHistory] = useState([
    {
      id: 1,
      date: '2024-09-26T02:00:00Z',
      type: 'Auto',
      status: 'completed',
      size: '2.4GB',
    },
    {
      id: 2,
      date: '2024-09-25T02:00:00Z',
      type: 'Auto',
      status: 'completed',
      size: '2.3GB',
    },
    {
      id: 3,
      date: '2024-09-24T02:00:00Z',
      type: 'Manual',
      status: 'completed',
      size: '2.5GB',
    },
    {
      id: 4,
      date: '2024-09-23T02:00:00Z',
      type: 'Auto',
      status: 'failed',
      size: '0GB',
    },
  ])

  const [currentBackup, setCurrentBackup] = useState({
    inProgress: false,
    progress: 0,
    stage: '',
  })

  const handleSettingChange = (
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const startBackup = () => {
    setCurrentBackup({
      inProgress: true,
      progress: 0,
      stage: 'Initializing...',
    })
    toast.loading('Starting backup process...', { id: 'backup' })

    // Simulate backup progress
    let progress = 0
    const stages = [
      'Preparing database...',
      'Backing up user data...',
      'Backing up system files...',
      'Compressing backup...',
      'Encrypting backup...',
      'Uploading to storage...',
      'Verifying backup integrity...',
      'Backup completed!',
    ]

    const interval = setInterval(() => {
      progress += 12.5
      const stageIndex = Math.floor(progress / 12.5)

      setCurrentBackup({
        inProgress: progress < 100,
        progress,
        stage: stages[Math.min(stageIndex, stages.length - 1)],
      })

      if (progress >= 100) {
        clearInterval(interval)
        setBackupHistory((prev) => [
          {
            id: Date.now(),
            date: new Date().toISOString(),
            type: 'Manual',
            status: 'completed',
            size: '2.4GB',
          },
          ...prev,
        ])
        toast.success('Backup completed successfully!', { id: 'backup' })
      }
    }, 500)
  }

  const testRestore = () => {
    toast.loading('Testing restore process...', { id: 'restore-test' })

    setTimeout(() => {
      toast.success('Restore test completed successfully!', {
        id: 'restore-test',
      })
    }, 3000)
  }

  const saveSettings = () => {
    localStorage.setItem('backup-settings', JSON.stringify(settings))
    toast.success('Backup settings saved successfully!')
  }

  const getBackupHealth = () => {
    const recentBackups = backupHistory.slice(0, 7)
    const successful = recentBackups.filter(
      (b) => b.status === 'completed'
    ).length
    return Math.round((successful / recentBackups.length) * 100)
  }

  const backupHealth = getBackupHealth()

  return (
    <div className='space-y-6'>
      {/* Backup Status */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconDatabase size={20} />
            Backup Status
          </CardTitle>
          <CardDescription>
            Current backup status and health monitoring.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>Backup Health Score</Label>
            <Badge
              variant={
                backupHealth >= 90
                  ? 'default'
                  : backupHealth >= 70
                    ? 'secondary'
                    : 'destructive'
              }
            >
              {backupHealth}%
            </Badge>
          </div>

          <div className='bg-secondary h-2 w-full rounded-full'>
            <div
              className={`h-2 rounded-full transition-all duration-300 ${
                backupHealth >= 90
                  ? 'bg-green-500'
                  : backupHealth >= 70
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              }`}
              style={{ width: `${backupHealth}%` }}
            />
          </div>

          {currentBackup.inProgress && (
            <div className='space-y-2'>
              <div className='flex justify-between text-sm'>
                <span>Backup in progress...</span>
                <span>{currentBackup.progress}%</span>
              </div>
              <Progress value={currentBackup.progress} />
              <p className='text-muted-foreground text-xs'>
                {currentBackup.stage}
              </p>
            </div>
          )}

          <div className='grid gap-4 md:grid-cols-3'>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Last Backup
              </Label>
              <div className='text-sm font-semibold'>
                {new Date(backupHistory[0]?.date).toLocaleDateString()}
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Next Backup
              </Label>
              <div className='text-sm font-semibold'>
                {settings.autoBackupEnabled
                  ? `${settings.backupFrequency} at ${settings.backupTime}`
                  : 'Manual'}
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Total Storage
              </Label>
              <div className='text-sm font-semibold'>
                {backupHistory
                  .reduce((sum, backup) => sum + parseFloat(backup.size), 0)
                  .toFixed(1)}
                GB
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Backup Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconClock size={20} />
            Backup Configuration
          </CardTitle>
          <CardDescription>
            Configure automatic backup scheduling and behavior.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Enable Automatic Backups
              </Label>
              <p className='text-muted-foreground text-xs'>
                Schedule regular system backups
              </p>
            </div>
            <Switch
              checked={settings.autoBackupEnabled}
              onCheckedChange={(checked) =>
                handleSettingChange('autoBackupEnabled', checked)
              }
            />
          </div>

          {settings.autoBackupEnabled && (
            <>
              <Separator />

              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label>Backup Frequency</Label>
                  <Select
                    value={settings.backupFrequency}
                    onValueChange={(value) =>
                      handleSettingChange('backupFrequency', value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='hourly'>Hourly</SelectItem>
                      <SelectItem value='daily'>Daily</SelectItem>
                      <SelectItem value='weekly'>Weekly</SelectItem>
                      <SelectItem value='monthly'>Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-2'>
                  <Label>Backup Time</Label>
                  <Input
                    type='time'
                    value={settings.backupTime}
                    onChange={(e) =>
                      handleSettingChange('backupTime', e.target.value)
                    }
                  />
                </div>
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
            </>
          )}

          <div className='grid gap-4 md:grid-cols-3'>
            {[
              { key: 'compressionEnabled', label: 'Enable Compression' },
              { key: 'encryptionEnabled', label: 'Enable Encryption' },
              { key: 'incrementalBackups', label: 'Incremental Backups' },
            ].map((option) => (
              <div key={option.key} className='flex items-center space-x-2'>
                <Switch
                  checked={
                    settings[option.key as keyof typeof settings] as boolean
                  }
                  onCheckedChange={(checked) =>
                    handleSettingChange(option.key, checked)
                  }
                />
                <Label className='text-sm'>{option.label}</Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Storage Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconCloudDownload size={20} />
            Storage Configuration
          </CardTitle>
          <CardDescription>
            Configure backup storage location and cloud settings.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label>Storage Location</Label>
            <Select
              value={settings.storageLocation}
              onValueChange={(value) =>
                handleSettingChange('storageLocation', value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='local'>Local Storage</SelectItem>
                <SelectItem value='cloud'>Cloud Storage</SelectItem>
                <SelectItem value='both'>Local + Cloud</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(settings.storageLocation === 'cloud' ||
            settings.storageLocation === 'both') && (
            <>
              <Separator />

              <div className='space-y-2'>
                <Label>Cloud Provider</Label>
                <Select
                  value={settings.cloudProvider}
                  onValueChange={(value) =>
                    handleSettingChange('cloudProvider', value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='aws'>Amazon S3</SelectItem>
                    <SelectItem value='gcp'>Google Cloud Storage</SelectItem>
                    <SelectItem value='azure'>Azure Blob Storage</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label>Access Key</Label>
                  <Input
                    type='password'
                    value={settings.awsAccessKey}
                    onChange={(e) =>
                      handleSettingChange('awsAccessKey', e.target.value)
                    }
                    placeholder='AKIA...'
                  />
                </div>

                <div className='space-y-2'>
                  <Label>Secret Key</Label>
                  <Input
                    type='password'
                    value={settings.awsSecretKey}
                    onChange={(e) =>
                      handleSettingChange('awsSecretKey', e.target.value)
                    }
                    placeholder='••••••••'
                  />
                </div>
              </div>

              <div className='space-y-2'>
                <Label>Bucket/Container Name</Label>
                <Input
                  value={settings.awsBucket}
                  onChange={(e) =>
                    handleSettingChange('awsBucket', e.target.value)
                  }
                  placeholder='my-backup-bucket'
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Backup History */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconRefresh size={20} />
            Recent Backups
          </CardTitle>
          <CardDescription>
            History of recent backup operations and their status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='space-y-3'>
            {backupHistory.slice(0, 5).map((backup) => (
              <div
                key={backup.id}
                className='flex items-center justify-between rounded-lg border p-3'
              >
                <div className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <Label className='text-sm font-medium'>
                      {new Date(backup.date).toLocaleDateString()}
                    </Label>
                    <Badge
                      variant={
                        backup.status === 'completed'
                          ? 'default'
                          : 'destructive'
                      }
                    >
                      {backup.status}
                    </Badge>
                    <Badge variant='outline'>{backup.type}</Badge>
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    {new Date(backup.date).toLocaleTimeString()} • {backup.size}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  {backup.status === 'completed' && (
                    <Button variant='ghost' size='sm'>
                      Restore
                    </Button>
                  )}
                  <Button variant='ghost' size='sm'>
                    Details
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Backup Actions */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconShield size={20} />
            Backup Actions
          </CardTitle>
          <CardDescription>
            Manual backup operations and recovery testing.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2 md:grid-cols-3'>
            <Button onClick={startBackup} disabled={currentBackup.inProgress}>
              Start Backup Now
            </Button>
            <Button variant='outline' onClick={testRestore}>
              Test Restore
            </Button>
            <Button
              variant='outline'
              onClick={() => toast.info('Backup verification started')}
            >
              Verify Backups
            </Button>
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
